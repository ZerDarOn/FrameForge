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
import {
  analyzePixelPalette,
  reducePixelPalette,
  removeColorAsTransparency,
  type PaletteReductionResult,
  type PixelPaletteAnalysis,
  type TransparencyCleanupResult,
} from "../../core/pixelCleanup";
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
type CleanupMode = "transparency" | "palette";
type CleanupPreview = TransparencyCleanupResult | PaletteReductionResult;
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
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupMode, setCleanupMode] = useState<CleanupMode>("transparency");
  const [cleanupColor, setCleanupColor] = useState("#000000");
  const [cleanupTolerance, setCleanupTolerance] = useState(0);
  const [paletteSize, setPaletteSize] = useState(16);
  const [paletteAnalysis, setPaletteAnalysis] = useState<PixelPaletteAnalysis | null>(null);
  const [cleanupPreview, setCleanupPreview] = useState<CleanupPreview | null>(null);
  const [showCleanupPreview, setShowCleanupPreview] = useState(true);
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

  const displayedImage =
    cleanupOpen && cleanupPreview && showCleanupPreview ? cleanupPreview.image : image;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !displayedImage) return;
    canvas.width = displayedImage.width;
    canvas.height = displayedImage.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.putImageData(
      new ImageData(
        new Uint8ClampedArray(displayedImage.data),
        displayedImage.width,
        displayedImage.height,
      ),
      0,
      0,
    );
  }, [displayedImage]);

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

  const handleOpenCleanup = () => {
    const current = imageRef.current;
    if (!current || busy) return;
    try {
      const analysis = analyzePixelPalette(current, 16);
      setPaletteAnalysis(analysis);
      setCleanupColor(analysis.colors[0] ? colorToHex(analysis.colors[0].color) : "#000000");
      setCleanupTolerance(0);
      setPaletteSize(Math.max(2, Math.min(16, analysis.uniqueColorCount ?? 16)));
      setCleanupMode("transparency");
      setCleanupPreview(null);
      setShowCleanupPreview(true);
      setCleanupOpen(true);
      setSelection(null);
      setError(null);
    } catch (analysisError) {
      setError(describeError(analysisError));
    }
  };

  const handleCleanupColorChange = (value: string) => {
    setCleanupColor(value);
    setCleanupPreview(null);
  };

  const handleCleanupToleranceChange = (value: number) => {
    setCleanupTolerance(value);
    setCleanupPreview(null);
  };

  const handleCleanupModeChange = (value: CleanupMode) => {
    setCleanupMode(value);
    setCleanupPreview(null);
    setShowCleanupPreview(true);
  };

  const handlePaletteSizeChange = (value: number) => {
    setPaletteSize(value);
    setCleanupPreview(null);
  };

  const handleCreateCleanupPreview = () => {
    const current = imageRef.current;
    if (!current) return;
    try {
      setCleanupPreview(
        cleanupMode === "transparency"
          ? removeColorAsTransparency(current, colorFromHex(cleanupColor), cleanupTolerance)
          : reducePixelPalette(current, paletteSize),
      );
      setShowCleanupPreview(true);
      setError(null);
    } catch (previewError) {
      setError(describeError(previewError));
    }
  };

  const handleCloseCleanup = () => {
    setCleanupOpen(false);
    setCleanupPreview(null);
    setPaletteAnalysis(null);
  };

  const handleApplyCleanup = async () => {
    const current = imageRef.current;
    if (
      !current ||
      !cleanupPreview ||
      cleanupPreview.changedPixels === 0 ||
      busy ||
      layer?.locked
    ) {
      return;
    }
    const logContext = {
      projectId: useAnimationDocumentStore.getState().document?.projectId,
      celId: cel?.id,
      changedPixelCount: cleanupPreview.changedPixels,
      mode: cleanupMode,
      parameter: cleanupMode === "transparency" ? cleanupTolerance : paletteSize,
    };
    console.info("[FrameForge] pixel cleanup started", logContext);
    updateImage(cleanupPreview.image);
    const applied = await commit(cleanupPreview.image);
    if (applied) handleCloseCleanup();
    else updateImage(current);
    console.info("[FrameForge] pixel cleanup ended", {
      ...logContext,
      outcome: applied ? "applied" : "reverted",
    });
  };

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
    if (!imageRef.current || busy || cleanupOpen || commitInFlightRef.current) return;
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
    if (!current || !clipboard || busy || cleanupOpen || commitInFlightRef.current || layer?.locked) return;
    const destination = selection ?? { x: 0, y: 0, width: 1, height: 1 };
    const pasted = pastePixelSelection(current, clipboard, destination);
    updateImage(pasted.image);
    setSelection(pasted.selection);
    if (!(await commit(pasted.image))) {
      updateImage(current);
      setSelection(selection);
    }
  }, [busy, cleanupOpen, commit, layer?.locked, selection, updateImage]);

  const handleMoveSelection = useCallback(
    async (deltaX: number, deltaY: number) => {
      const current = imageRef.current;
      if (!current || !selection || busy || cleanupOpen || commitInFlightRef.current || layer?.locked) return;
      const moved = movePixelSelection(current, selection, deltaX, deltaY);
      if (moved.image === current) return;
      updateImage(moved.image);
      setSelection(moved.selection);
      if (!(await commit(moved.image))) {
        updateImage(current);
        setSelection(selection);
      }
    },
    [busy, cleanupOpen, commit, layer?.locked, selection, updateImage],
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
            disabled={busy || cleanupOpen}
          >
            {PIXEL_TOOL_LABELS[candidate]}
          </button>
        ))}
        <button
          type="button"
          className={`rounded px-3 py-1 text-xs ${
            cleanupOpen ? "bg-cyan-700 text-white" : "bg-gray-800 text-gray-300"
          }`}
          onClick={cleanupOpen ? handleCloseCleanup : handleOpenCleanup}
          disabled={busy || !image}
        >
          像素清理
        </button>
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
          disabled={cleanupOpen}
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
                cursor: cleanupOpen
                  ? "default"
                  : tool === "eyedropper" || tool === "selection"
                    ? "crosshair"
                    : "cell",
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
      {cleanupOpen && paletteAnalysis && (
        <aside className="absolute right-4 top-14 z-10 w-72 rounded-lg border border-gray-700 bg-gray-900 p-4 shadow-2xl">
          <div className="mb-3 flex items-center justify-between">
            <strong className="text-sm text-white">调色板与透明清理</strong>
            <button
              type="button"
              className="text-gray-500 hover:text-white"
              onClick={handleCloseCleanup}
              aria-label="关闭清理面板"
            >
              ×
            </button>
          </div>

          <div className="mb-3 text-[11px] leading-5 text-gray-500">
            非透明像素 {paletteAnalysis.opaquePixels} · 已透明 {paletteAnalysis.transparentPixels}
            <br />
            颜色数 {paletteAnalysis.uniqueColorCount ?? "超过分析上限"}
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              className={`rounded px-2 py-1.5 text-xs ${
                cleanupMode === "transparency"
                  ? "bg-cyan-700 text-white"
                  : "bg-gray-800 text-gray-400"
              }`}
              onClick={() => handleCleanupModeChange("transparency")}
            >
              透明色
            </button>
            <button
              type="button"
              className={`rounded px-2 py-1.5 text-xs ${
                cleanupMode === "palette"
                  ? "bg-cyan-700 text-white"
                  : "bg-gray-800 text-gray-400"
              }`}
              onClick={() => handleCleanupModeChange("palette")}
            >
              压缩颜色
            </button>
          </div>

          {cleanupMode === "transparency" && (
            <div className="mb-3">
              <div className="mb-1 text-xs text-gray-400">常用颜色</div>
              <div className="grid grid-cols-8 gap-1">
                {paletteAnalysis.colors.map((entry) => {
                  const hex = colorToHex(entry.color);
                  return (
                    <button
                      key={`${hex}-${entry.color[3]}`}
                      type="button"
                      className={`h-6 rounded border ${
                        cleanupColor === hex ? "border-white" : "border-gray-600"
                      }`}
                      style={{ backgroundColor: hex, opacity: entry.color[3] / 255 }}
                      onClick={() => handleCleanupColorChange(hex)}
                      title={`${hex} · ${entry.count} 像素`}
                      aria-label={`选择颜色 ${hex}，${entry.count} 像素`}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {cleanupMode === "transparency" ? (
            <>
              <label className="mb-3 flex items-center gap-2 text-xs text-gray-400">
                目标颜色
                <input
                  type="color"
                  value={cleanupColor}
                  onChange={(event) => handleCleanupColorChange(event.target.value)}
                  className="h-7 w-10 rounded border border-gray-600 bg-transparent"
                />
                <span>{cleanupColor.toUpperCase()}</span>
              </label>

              <label className="mb-3 block text-xs text-gray-400">
                <span className="mb-1 flex justify-between">
                  <span>RGB 每通道容差</span>
                  <span>{cleanupTolerance}</span>
                </span>
                <input
                  type="range"
                  min="0"
                  max="64"
                  step="1"
                  value={cleanupTolerance}
                  onChange={(event) =>
                    handleCleanupToleranceChange(Number(event.target.value))
                  }
                  className="w-full accent-orange-500"
                />
              </label>
            </>
          ) : (
            <label className="mb-3 block text-xs text-gray-400">
              <span className="mb-1 flex justify-between">
                <span>目标颜色数</span>
                <span>{paletteSize}</span>
              </span>
              <input
                type="range"
                min="2"
                max="32"
                step="1"
                value={paletteSize}
                onChange={(event) => handlePaletteSizeChange(Number(event.target.value))}
                className="w-full accent-orange-500"
              />
            </label>
          )}

          <button
            type="button"
            className="mb-3 w-full rounded bg-gray-700 px-3 py-2 text-xs text-white hover:bg-gray-600"
            onClick={handleCreateCleanupPreview}
          >
            {cleanupMode === "transparency" ? "生成透明预览" : "生成压色预览"}
          </button>

          {cleanupPreview && (
            <div className="space-y-3">
              <div className="rounded bg-gray-800 px-3 py-2 text-xs text-gray-300">
                {cleanupMode === "transparency"
                  ? `将清除 ${cleanupPreview.changedPixels} 个像素`
                  : `将调整 ${cleanupPreview.changedPixels} 个像素`}
              </div>
              {"palette" in cleanupPreview && cleanupPreview.palette.length > 0 && (
                <div>
                  <div className="mb-1 text-xs text-gray-400">
                    输出调色板 · {cleanupPreview.palette.length} 色
                  </div>
                  <div className="grid grid-cols-8 gap-1">
                    {cleanupPreview.palette.map((entry) => {
                      const hex = colorToHex(entry);
                      return (
                        <span
                          key={hex}
                          className="h-6 rounded border border-gray-600"
                          style={{ backgroundColor: hex }}
                          title={hex}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`rounded px-2 py-1 text-xs ${
                    !showCleanupPreview ? "bg-cyan-700 text-white" : "bg-gray-800 text-gray-400"
                  }`}
                  onClick={() => setShowCleanupPreview(false)}
                >
                  原图
                </button>
                <button
                  type="button"
                  className={`rounded px-2 py-1 text-xs ${
                    showCleanupPreview ? "bg-cyan-700 text-white" : "bg-gray-800 text-gray-400"
                  }`}
                  onClick={() => setShowCleanupPreview(true)}
                >
                  预览
                </button>
              </div>
              <button
                type="button"
                className="w-full rounded bg-orange-600 px-3 py-2 text-xs font-medium text-white hover:bg-orange-500 disabled:opacity-40"
                onClick={() => void handleApplyCleanup()}
                disabled={busy || layer?.locked || cleanupPreview.changedPixels === 0}
              >
                {layer?.locked ? "图层已锁定" : "应用为新内容版本"}
              </button>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
