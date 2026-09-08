import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  copyPixelSelection,
  createPixelSelection,
  drawPixelLineMutable,
  floodFill,
  movePixelSelection,
  pastePixelSelection,
  readPixel,
} from "../../core/pixelImage";
import { useAnimationDocumentStore } from "../../stores/animationDocumentStore";
import type { Asset } from "../../types/asset";
import type {
  PixelClipboard,
  PixelImage,
  PixelPoint,
  PixelSelection,
  RgbaColor,
} from "../../types/pixelImage";

type PixelTool = "pencil" | "eraser" | "fill" | "eyedropper" | "selection";
const MAX_EDITABLE_PIXELS = 4 * 1024 * 1024;
const PIXEL_TOOL_LABELS: Record<PixelTool, string> = {
  pencil: "铅笔",
  eraser: "橡皮",
  fill: "填充",
  eyedropper: "取色",
  selection: "选区",
};

interface Props {
  asset: Asset;
  onClose: () => void;
}

interface ReadContentImage {
  pngDataUrl: string;
  width: number;
  height: number;
}

interface WrittenContentRevision {
  sourcePath: string;
  width: number;
  height: number;
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function colorFromHex(value: string): RgbaColor {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
    255,
  ];
}

function colorToHex(color: RgbaColor) {
  return `#${color
    .slice(0, 3)
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function decodePixelImage(dataUrl: string): Promise<PixelImage> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("无法解码待编辑图片"));
    image.src = dataUrl;
  });
  if (image.naturalWidth * image.naturalHeight > MAX_EDITABLE_PIXELS) {
    throw new Error("图片超过像素编辑器 4M 像素上限");
  }
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("浏览器不支持 Canvas 2D");
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: pixels.data };
}

function encodePixelImage(image: PixelImage) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器不支持 Canvas 2D");
  context.putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0,
  );
  return canvas.toDataURL("image/png");
}

export function PixelEditorDialog({ asset, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<PixelImage | null>(null);
  const lastPointRef = useRef<PixelPoint | null>(null);
  const drawingRef = useRef(false);
  const selectionStartRef = useRef<PixelPoint | null>(null);
  const selectingRef = useRef(false);
  const clipboardRef = useRef<PixelClipboard | null>(null);
  const commitInFlightRef = useRef(false);
  const [image, setImage] = useState<PixelImage | null>(null);
  const [tool, setTool] = useState<PixelTool>("pencil");
  const [color, setColor] = useState("#f97316");
  const [zoom, setZoom] = useState(8);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<PixelSelection | null>(null);
  const [hasClipboard, setHasClipboard] = useState(false);
  const documentState = useAnimationDocumentStore((state) => state.document);
  const animation = documentState?.animations[0];
  const cel = animation?.cels.find(
    (candidate) => candidate.id === (asset.documentCelId ?? asset.id),
  );
  const content = documentState?.contentRevisions.find(
    (candidate) => candidate.id === cel?.contentRevisionId,
  );
  const layer = animation?.layers.find((candidate) => candidate.id === cel?.layerId);

  const updateImage = useCallback((next: PixelImage) => {
    imageRef.current = next;
    setImage(next);
  }, []);

  useEffect(() => {
    if (!content) {
      setError("所选画格没有可编辑内容");
      return;
    }
    let cancelled = false;
    setError(null);
    setBusy(true);
    invoke<ReadContentImage>("read_content_image", { filePath: content.sourcePath })
      .then((result) => decodePixelImage(result.pngDataUrl))
      .then((loaded) => {
        if (!cancelled) updateImage(loaded);
      })
      .catch((loadError) => {
        if (!cancelled) setError(describeError(loadError));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [content?.id, content?.sourcePath, updateImage]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.putImageData(
      new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
      0,
      0,
    );
  }, [image]);

  const commit = useCallback(
    async (next: PixelImage) => {
      if (commitInFlightRef.current) return false;
      const sourceDocument = useAnimationDocumentStore.getState().document;
      const sourceAnimation = sourceDocument?.animations[0];
      const sourceCel = sourceAnimation?.cels.find(
        (candidate) => candidate.id === (asset.documentCelId ?? asset.id),
      );
      const sourceContent = sourceDocument?.contentRevisions.find(
        (candidate) => candidate.id === sourceCel?.contentRevisionId,
      );
      if (!sourceDocument || !sourceAnimation || !sourceCel || !sourceContent) {
        setError("动画文档已切换，无法保存本次笔划");
        return false;
      }
      commitInFlightRef.current = true;
      setBusy(true);
      setError(null);
      const revisionId = crypto.randomUUID();
      try {
        const written = await invoke<WrittenContentRevision>("write_content_revision", {
          projectId: sourceDocument.projectId,
          revisionId,
          pngDataUrl: encodePixelImage(next),
        });
        const latest = useAnimationDocumentStore.getState().document;
        const latestCel = latest?.animations[0]?.cels.find(
          (candidate) => candidate.id === sourceCel.id,
        );
        if (
          latest?.projectId !== sourceDocument.projectId ||
          latestCel?.contentRevisionId !== sourceContent.id
        ) {
          throw new Error("保存期间画格内容已变化；新版本已保留但未自动切换");
        }
        useAnimationDocumentStore.getState().execute({
          type: "set_cel_content",
          animationId: sourceAnimation.id,
          celId: sourceCel.id,
          contentRevision: {
            id: revisionId,
            materialId: sourceContent.materialId,
            sourcePath: written.sourcePath,
            width: written.width,
            height: written.height,
            createdAt: Date.now(),
          },
        });
        return true;
      } catch (saveError) {
        setError(describeError(saveError));
        return false;
      } finally {
        commitInFlightRef.current = false;
        setBusy(false);
      }
    },
    [asset.documentCelId, asset.id],
  );

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): PixelPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.floor(((event.clientX - rect.left) / rect.width) * event.currentTarget.width),
      y: Math.floor(((event.clientY - rect.top) / rect.height) * event.currentTarget.height),
    };
  };

  const drawTo = (point: PixelPoint) => {
    const current = imageRef.current;
    const previous = lastPointRef.current;
    if (!current || !previous) return;
    const paint = tool === "eraser" ? ([0, 0, 0, 0] as const) : colorFromHex(color);
    drawPixelLineMutable(current, previous, point, paint);
    updateImage({ ...current });
    lastPointRef.current = point;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!imageRef.current || busy || commitInFlightRef.current) return;
    const point = pointFromEvent(event);
    if (tool === "selection") {
      event.currentTarget.setPointerCapture(event.pointerId);
      selectingRef.current = true;
      selectionStartRef.current = point;
      setSelection(createPixelSelection(imageRef.current, point, point));
      return;
    }
    if (tool === "eyedropper") {
      const sampled = readPixel(imageRef.current, point);
      if (sampled) setColor(colorToHex(sampled));
      return;
    }
    if (layer?.locked) return;
    if (tool === "fill") {
      const next = floodFill(imageRef.current, point, colorFromHex(color));
      if (next !== imageRef.current) {
        updateImage(next);
        void commit(next);
      }
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastPointRef.current = point;
    updateImage({
      ...imageRef.current,
      data: new Uint8ClampedArray(imageRef.current.data),
    });
    drawTo(point);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (selectingRef.current && selectionStartRef.current && imageRef.current) {
      setSelection(
        createPixelSelection(
          imageRef.current,
          selectionStartRef.current,
          pointFromEvent(event),
        ),
      );
      return;
    }
    if (!drawingRef.current || busy) return;
    drawTo(pointFromEvent(event));
  };

  const finishStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (selectingRef.current) {
      selectingRef.current = false;
      selectionStartRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const next = imageRef.current;
    if (next) void commit(next);
  };

  const handleCopySelection = useCallback(() => {
    const current = imageRef.current;
    if (!current || !selection) return;
    clipboardRef.current = copyPixelSelection(current, selection);
    setHasClipboard(true);
  }, [selection]);

  const handlePasteSelection = useCallback(async () => {
    const current = imageRef.current;
    const clipboard = clipboardRef.current;
    if (!current || !clipboard || busy || commitInFlightRef.current || layer?.locked) return;
    const destination = selection ?? { x: 0, y: 0, width: 1, height: 1 };
    const pasted = pastePixelSelection(current, clipboard, destination);
    updateImage(pasted.image);
    setSelection(pasted.selection);
    if (!(await commit(pasted.image))) {
      updateImage(current);
      setSelection(selection);
    }
  }, [busy, commit, layer?.locked, selection, updateImage]);

  const handleMoveSelection = useCallback(
    async (deltaX: number, deltaY: number) => {
      const current = imageRef.current;
      if (!current || !selection || busy || commitInFlightRef.current || layer?.locked) return;
      const moved = movePixelSelection(current, selection, deltaX, deltaY);
      if (moved.image === current) return;
      updateImage(moved.image);
      setSelection(moved.selection);
      if (!(await commit(moved.image))) {
        updateImage(current);
        setSelection(selection);
      }
    },
    [busy, commit, layer?.locked, selection, updateImage],
  );

  useEffect(() => {
    if (tool !== "selection") return;
    const handleSelectionKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
        event.preventDefault();
        handleCopySelection();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
        event.preventDefault();
        void handlePasteSelection();
        return;
      }
      const movement = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }[event.key];
      if (!movement) return;
      event.preventDefault();
      void handleMoveSelection(movement[0], movement[1]);
    };
    window.addEventListener("keydown", handleSelectionKeyDown);
    return () => window.removeEventListener("keydown", handleSelectionKeyDown);
  }, [handleCopySelection, handleMoveSelection, handlePasteSelection, tool]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-gray-950/95"
      role="dialog"
      aria-modal="true"
      data-frameforge-block-shortcuts="true"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-2 overflow-x-auto border-b border-gray-700 bg-gray-900 px-4 py-2">
        <strong className="mr-2 text-sm text-white">像素编辑 · {asset.name}</strong>
        {(["pencil", "eraser", "fill", "eyedropper", "selection"] as PixelTool[]).map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={`rounded px-3 py-1 text-xs ${
              tool === candidate ? "bg-orange-600 text-white" : "bg-gray-800 text-gray-300"
            }`}
            onClick={() => setTool(candidate)}
            disabled={busy}
          >
            {PIXEL_TOOL_LABELS[candidate]}
          </button>
        ))}
        {tool === "selection" && (
          <div className="flex items-center gap-1 border-l border-gray-700 pl-2">
            <button type="button" className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 disabled:opacity-40" onClick={handleCopySelection} disabled={!selection || busy}>复制</button>
            <button type="button" className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 disabled:opacity-40" onClick={() => void handlePasteSelection()} disabled={!hasClipboard || busy || layer?.locked}>粘贴</button>
            {([
              ["←", -1, 0, "向左移动选区"],
              ["↑", 0, -1, "向上移动选区"],
              ["↓", 0, 1, "向下移动选区"],
              ["→", 1, 0, "向右移动选区"],
            ] as const).map(([label, deltaX, deltaY, ariaLabel]) => (
              <button
                key={label}
                type="button"
                aria-label={ariaLabel}
                className="h-6 w-6 rounded bg-gray-800 text-xs text-gray-300 disabled:opacity-40"
                onClick={() => void handleMoveSelection(deltaX, deltaY)}
                disabled={!selection || busy || layer?.locked}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <input
          type="color"
          value={color}
          onChange={(event) => setColor(event.target.value)}
          className="h-7 w-9 rounded border border-gray-600 bg-transparent"
          aria-label="绘制颜色"
        />
        <label className="ml-2 flex items-center gap-2 text-xs text-gray-400">
          缩放
          <input
            type="range"
            min="1"
            max="32"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
          {zoom}×
        </label>
        <span className="ml-auto text-xs text-gray-400">
          {layer?.locked ? "图层已锁定" : busy ? "正在保存内容版本…" : "每次笔划自动保存"}
        </span>
        <button
          type="button"
          className="rounded bg-gray-700 px-3 py-1 text-xs text-white hover:bg-gray-600"
          onClick={onClose}
          disabled={busy}
        >
          完成
        </button>
      </div>
      {error && (
        <div className="border-b border-red-800 bg-red-950 px-4 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
      <div
        className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-8"
        style={{
          backgroundColor: "#111827",
          backgroundImage:
            "linear-gradient(45deg,#1f2937 25%,transparent 25%),linear-gradient(-45deg,#1f2937 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#1f2937 75%),linear-gradient(-45deg,transparent 75%,#1f2937 75%)",
          backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
          backgroundSize: "16px 16px",
        }}
      >
        {image ? (
          <div
            className="relative flex-none border border-gray-500 shadow-2xl"
            style={{ width: image.width * zoom, height: image.height * zoom }}
          >
            <canvas
              ref={canvasRef}
              className="block"
              style={{
                width: image.width * zoom,
                height: image.height * zoom,
                imageRendering: "pixelated",
                cursor: tool === "eyedropper" || tool === "selection" ? "crosshair" : "cell",
                touchAction: "none",
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={finishStroke}
              onPointerCancel={finishStroke}
            />
            {selection && (
              <div
                className="pointer-events-none absolute border border-cyan-300 outline outline-1 outline-gray-950"
                style={{
                  left: selection.x * zoom,
                  top: selection.y * zoom,
                  width: selection.width * zoom,
                  height: selection.height * zoom,
                }}
              />
            )}
            {zoom >= 6 && (
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage:
                    "linear-gradient(to right,rgba(148,163,184,.22) 1px,transparent 1px),linear-gradient(to bottom,rgba(148,163,184,.22) 1px,transparent 1px)",
                  backgroundSize: `${zoom}px ${zoom}px`,
                }}
              />
            )}
          </div>
        ) : (
          <span className="text-sm text-gray-500">{busy ? "正在加载…" : "没有可编辑图片"}</span>
        )}
      </div>
    </div>
  );
}
