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
  applyPixelPalette,
  reducePixelImagesPalette,
  reducePixelPalette,
  removeColorAsTransparency,
  suggestPixelBackgroundColor,
  type PaletteReductionResult,
  type PixelBackgroundSuggestion,
  type PixelPaletteAnalysis,
  type TransparencyCleanupResult,
} from "../../core/pixelCleanup";
import { useAnimationDocumentStore } from "../../stores/animationDocumentStore";
import { useTimelineStore } from "../../stores/timelineStore";
import type { Asset } from "../../types/asset";
import type { ContentRevision } from "../../types/animationDocument";
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
const MAX_BATCH_CLEANUP_CELS = 64;
const MAX_BATCH_PALETTE_PIXELS = 8 * 1024 * 1024;
const MAX_PALETTE_DITHER_STRENGTH = 64;
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
  const [paletteDitherStrength, setPaletteDitherStrength] = useState(0);
  const [paletteAnalysis, setPaletteAnalysis] = useState<PixelPaletteAnalysis | null>(null);
  const [backgroundSuggestion, setBackgroundSuggestion] =
    useState<PixelBackgroundSuggestion | null>(null);
  const [cleanupPreview, setCleanupPreview] = useState<CleanupPreview | null>(null);
  const [showCleanupPreview, setShowCleanupPreview] = useState(true);
  const [applyToSelection, setApplyToSelection] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ completed: number; total: number } | null>(
    null,
  );
  const [batchPalettePreviewSignature, setBatchPalettePreviewSignature] = useState<string | null>(
    null,
  );
  const selectedAssetIds = useTimelineStore((state) => state.selectedAssetIds);
  const documentState = useAnimationDocumentStore((state) => state.document);
  const animation = documentState?.animations[0];
  const cel = animation?.cels.find(
    (candidate) => candidate.id === (asset.documentCelId ?? asset.id),
  );
  const content = documentState?.contentRevisions.find(
    (candidate) => candidate.id === cel?.contentRevisionId,
  );
  const layer = animation?.layers.find((candidate) => candidate.id === cel?.layerId);
  const cleanupSelectionIds = new Set([cel?.id, ...selectedAssetIds].filter(Boolean));
  const cleanupSelectionCels =
    animation?.cels.filter((candidate) => cleanupSelectionIds.has(candidate.id)) ?? [];
  const cleanupSelectionHasLockedLayer = cleanupSelectionCels.some(
    (candidate) =>
      animation?.layers.find((candidateLayer) => candidateLayer.id === candidate.layerId)?.locked,
  );
  const batchCleanupRequested =
    applyToSelection && cleanupSelectionCels.length > 1;
  const currentBatchPaletteSignature = documentState
    ? [
        documentState.projectId,
        paletteSize,
        paletteDitherStrength,
        ...cleanupSelectionCels
          .map((candidate) => `${candidate.id}:${candidate.contentRevisionId}`)
          .sort(),
      ].join("|")
    : "";

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
      setBackgroundSuggestion(suggestPixelBackgroundColor(current));
      setCleanupColor(analysis.colors[0] ? colorToHex(analysis.colors[0].color) : "#000000");
      setCleanupTolerance(0);
      setPaletteSize(Math.max(2, Math.min(16, analysis.uniqueColorCount ?? 16)));
      setPaletteDitherStrength(0);
      setCleanupMode("transparency");
      setApplyToSelection(false);
      setBatchProgress(null);
      setBatchPalettePreviewSignature(null);
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
    setBatchPalettePreviewSignature(null);
  };

  const handleCleanupToleranceChange = (value: number) => {
    setCleanupTolerance(value);
    setCleanupPreview(null);
    setBatchPalettePreviewSignature(null);
  };

  const handleUseBackgroundSuggestion = () => {
    if (!backgroundSuggestion) return;
    setCleanupColor(colorToHex(backgroundSuggestion.color));
    setCleanupTolerance(backgroundSuggestion.recommendedTolerance);
    setCleanupPreview(null);
    setBatchPalettePreviewSignature(null);
  };

  const handleCleanupModeChange = (value: CleanupMode) => {
    setCleanupMode(value);
    setCleanupPreview(null);
    setBatchPalettePreviewSignature(null);
    setShowCleanupPreview(true);
  };

  const handlePaletteSizeChange = (value: number) => {
    setPaletteSize(value);
    setCleanupPreview(null);
    setBatchPalettePreviewSignature(null);
  };

  const handlePaletteDitherStrengthChange = (value: number) => {
    setPaletteDitherStrength(value);
    setCleanupPreview(null);
    setBatchPalettePreviewSignature(null);
  };

  const handleApplyToSelectionChange = (checked: boolean) => {
    setApplyToSelection(checked);
    setCleanupPreview(null);
    setBatchPalettePreviewSignature(null);
  };

  const handleCreateCleanupPreview = async () => {
    const current = imageRef.current;
    if (!current) return;
    if (cleanupMode === "palette" && batchCleanupRequested) {
      const sourceDocument = useAnimationDocumentStore.getState().document;
      const sourceAnimation = sourceDocument?.animations[0];
      const sourceCel = sourceAnimation?.cels.find(
        (candidate) => candidate.id === (asset.documentCelId ?? asset.id),
      );
      if (!sourceDocument || !sourceAnimation || !sourceCel) {
        setError("动画文档已切换，无法生成共享色板预览");
        return;
      }
      const targetIds = new Set(useTimelineStore.getState().selectedAssetIds);
      targetIds.add(sourceCel.id);
      const targetCels = sourceAnimation.cels.filter((candidate) => targetIds.has(candidate.id));
      const previewSignature = [
        sourceDocument.projectId,
        paletteSize,
        paletteDitherStrength,
        ...targetCels
          .map((candidate) => `${candidate.id}:${candidate.contentRevisionId}`)
          .sort(),
      ].join("|");
      const layerById = new Map(
        sourceAnimation.layers.map((candidate) => [candidate.id, candidate]),
      );
      if (targetCels.length > MAX_BATCH_CLEANUP_CELS) {
        setError(`单次最多处理 ${MAX_BATCH_CLEANUP_CELS} 个画格`);
        return;
      }
      if (targetCels.some((candidate) => layerById.get(candidate.layerId)?.locked)) {
        setError("所选画格包含锁定图层，无法生成共享色板预览");
        return;
      }
      const contentById = new Map(
        sourceDocument.contentRevisions.map((candidate) => [candidate.id, candidate]),
      );
      const uniqueContents = new Map<string, ContentRevision>();
      for (const targetCel of targetCels) {
        const targetContent = contentById.get(targetCel.contentRevisionId);
        if (!targetContent) {
          setError(`画格 ${targetCel.id} 缺少内容版本`);
          return;
        }
        uniqueContents.set(targetContent.id, targetContent);
      }

      console.info("[FrameForge] shared palette preview started", {
        projectId: sourceDocument.projectId,
        targetCelCount: targetCels.length,
        uniqueContentCount: uniqueContents.size,
        paletteSize,
        ditherStrength: paletteDitherStrength,
      });
      setBusy(true);
      setError(null);
      setBatchProgress({ completed: 0, total: uniqueContents.size });
      let outcome = "failed";
      let totalPixels = 0;
      try {
        const orderedContents = [...uniqueContents.values()];
        const images: PixelImage[] = [];
        for (let index = 0; index < orderedContents.length; index += 1) {
          const sourceContent = orderedContents[index];
          const sourceImage =
            sourceContent.id === sourceCel.contentRevisionId
              ? current
              : await invoke<ReadContentImage>("read_content_image", {
                  filePath: sourceContent.sourcePath,
                }).then((result) => decodePixelImage(result.pngDataUrl));
          totalPixels += sourceImage.width * sourceImage.height;
          if (totalPixels > MAX_BATCH_PALETTE_PIXELS) {
            throw new Error("共享色板预览累计像素超过 8M 上限，请减少所选画格");
          }
          images.push(sourceImage);
          setBatchProgress({ completed: index + 1, total: orderedContents.length });
        }
        const reduced = reducePixelImagesPalette(images, paletteSize, {
          ditherStrength: paletteDitherStrength,
        });
        const latestDocument = useAnimationDocumentStore.getState().document;
        const latestAnimation = latestDocument?.animations.find(
          (candidate) => candidate.id === sourceAnimation.id,
        );
        const latestTargetCels = targetCels.map((sourceTargetCel) =>
          latestAnimation?.cels.find((candidate) => candidate.id === sourceTargetCel.id),
        );
        const latestSignature = latestDocument
          ? [
              latestDocument.projectId,
              paletteSize,
              paletteDitherStrength,
              ...latestTargetCels
                .filter((candidate) => candidate !== undefined)
                .map((candidate) => `${candidate.id}:${candidate.contentRevisionId}`)
                .sort(),
            ].join("|")
          : "";
        if (
          latestTargetCels.some((candidate) => candidate === undefined) ||
          latestSignature !== previewSignature
        ) {
          throw new Error("生成预览期间项目或画格内容已变化，请重试");
        }
        const currentIndex = orderedContents.findIndex(
          (candidate) => candidate.id === sourceCel.contentRevisionId,
        );
        if (currentIndex < 0) throw new Error("当前画格不在共享色板范围内");
        setCleanupPreview({
          image: reduced.images[currentIndex],
          changedPixels: reduced.changedPixels[currentIndex],
          palette: reduced.palette,
        });
        setBatchPalettePreviewSignature(previewSignature);
        setShowCleanupPreview(true);
        outcome = "ready";
      } catch (previewError) {
        setCleanupPreview(null);
        setBatchPalettePreviewSignature(null);
        setError(describeError(previewError));
      } finally {
        console.info("[FrameForge] shared palette preview ended", {
          projectId: sourceDocument.projectId,
          outcome,
          totalPixels,
        });
        setBusy(false);
        setBatchProgress(null);
      }
      return;
    }
    try {
      setCleanupPreview(
        cleanupMode === "transparency"
          ? removeColorAsTransparency(current, colorFromHex(cleanupColor), cleanupTolerance)
          : reducePixelPalette(current, paletteSize, {
              ditherStrength: paletteDitherStrength,
            }),
      );
      setShowCleanupPreview(true);
      setBatchPalettePreviewSignature(null);
      setError(null);
    } catch (previewError) {
      setError(describeError(previewError));
    }
  };

  const handleCloseCleanup = () => {
    setCleanupOpen(false);
    setApplyToSelection(false);
    setBatchProgress(null);
    setBatchPalettePreviewSignature(null);
    setCleanupPreview(null);
    setPaletteAnalysis(null);
    setBackgroundSuggestion(null);
  };

  const applyCleanupToSelection = async () => {
    const sourceDocument = useAnimationDocumentStore.getState().document;
    const sourceAnimation = sourceDocument?.animations[0];
    const sourceCel = sourceAnimation?.cels.find(
      (candidate) => candidate.id === (asset.documentCelId ?? asset.id),
    );
    if (!sourceDocument || !sourceAnimation || !sourceCel || !imageRef.current) {
      setError("动画文档已切换，无法执行批量清理");
      return false;
    }

    const targetIds = new Set(useTimelineStore.getState().selectedAssetIds);
    targetIds.add(sourceCel.id);
    const targetCels = sourceAnimation.cels.filter((candidate) => targetIds.has(candidate.id));
    const sourceBatchPaletteSignature = [
      sourceDocument.projectId,
      paletteSize,
      paletteDitherStrength,
      ...targetCels
        .map((candidate) => `${candidate.id}:${candidate.contentRevisionId}`)
        .sort(),
    ].join("|");
    if (
      cleanupMode === "palette" &&
      (batchPalettePreviewSignature !== sourceBatchPaletteSignature ||
        !cleanupPreview ||
        !("palette" in cleanupPreview))
    ) {
      setError("所选画格或内容已变化，请重新生成共享色板预览");
      return false;
    }
    if (targetCels.length < 2) {
      console.info("[FrameForge] batch pixel cleanup skipped", {
        projectId: sourceDocument.projectId,
        targetCelCount: targetCels.length,
        reason: "insufficient-selection",
      });
      setError("请先在时间线中选择至少两个画格");
      return false;
    }
    if (targetCels.length > MAX_BATCH_CLEANUP_CELS) {
      console.info("[FrameForge] batch pixel cleanup skipped", {
        projectId: sourceDocument.projectId,
        targetCelCount: targetCels.length,
        reason: "selection-limit",
      });
      setError(`单次最多清理 ${MAX_BATCH_CLEANUP_CELS} 个画格`);
      return false;
    }
    const layerById = new Map(sourceAnimation.layers.map((candidate) => [candidate.id, candidate]));
    if (targetCels.some((candidate) => layerById.get(candidate.layerId)?.locked)) {
      console.info("[FrameForge] batch pixel cleanup skipped", {
        projectId: sourceDocument.projectId,
        targetCelCount: targetCels.length,
        reason: "locked-layer",
      });
      setError("所选画格包含锁定图层，批量清理已取消");
      return false;
    }

    const contentById = new Map(
      sourceDocument.contentRevisions.map((candidate) => [candidate.id, candidate]),
    );
    const uniqueContents = new Map<string, ContentRevision>();
    for (const targetCel of targetCels) {
      const targetContent = contentById.get(targetCel.contentRevisionId);
      if (!targetContent) {
        setError(`画格 ${targetCel.id} 缺少内容版本，批量清理已取消`);
        return false;
      }
      uniqueContents.set(targetContent.id, targetContent);
    }

    const logContext = {
      projectId: sourceDocument.projectId,
      targetCelCount: targetCels.length,
      uniqueContentCount: uniqueContents.size,
      mode: cleanupMode,
      parameter: cleanupMode === "transparency" ? cleanupTolerance : paletteSize,
      ditherStrength: cleanupMode === "palette" ? paletteDitherStrength : undefined,
    };
    console.info("[FrameForge] batch pixel cleanup started", logContext);
    commitInFlightRef.current = true;
    setBusy(true);
    setError(null);
    setBatchProgress({ completed: 0, total: uniqueContents.size });
    let outcome = "failed";
    let preparedRevisionCount = 0;
    let changedCelCount = 0;

    try {
      const targetColor = colorFromHex(cleanupColor);
      const sharedPalette =
        cleanupMode === "palette" && cleanupPreview && "palette" in cleanupPreview
          ? cleanupPreview.palette
          : null;
      const preparedByContentId = new Map<string, ContentRevision>();
      let currentPreparedImage: PixelImage | null = null;
      let completed = 0;
      for (const sourceContent of uniqueContents.values()) {
        const sourceImage =
          sourceContent.id === sourceCel.contentRevisionId
            ? imageRef.current
            : await invoke<ReadContentImage>("read_content_image", {
                filePath: sourceContent.sourcePath,
              }).then((result) => decodePixelImage(result.pngDataUrl));
        if (!sourceImage) throw new Error("当前画格图片尚未加载完成");
        const cleaned =
          cleanupMode === "transparency"
            ? removeColorAsTransparency(sourceImage, targetColor, cleanupTolerance)
            : applyPixelPalette(sourceImage, sharedPalette ?? [], {
                ditherStrength: paletteDitherStrength,
              });
        if (cleaned.changedPixels > 0) {
          const revisionId = crypto.randomUUID();
          const written = await invoke<WrittenContentRevision>("write_content_revision", {
            projectId: sourceDocument.projectId,
            revisionId,
            pngDataUrl: encodePixelImage(cleaned.image),
          });
          preparedByContentId.set(sourceContent.id, {
            id: revisionId,
            materialId: sourceContent.materialId,
            sourcePath: written.sourcePath,
            width: written.width,
            height: written.height,
            createdAt: Date.now(),
          });
          if (sourceContent.id === sourceCel.contentRevisionId) {
            currentPreparedImage = cleaned.image;
          }
          preparedRevisionCount += 1;
        }
        completed += 1;
        setBatchProgress({ completed, total: uniqueContents.size });
      }

      const entries = targetCels.flatMap((targetCel) => {
        const prepared = preparedByContentId.get(targetCel.contentRevisionId);
        return prepared
          ? [{ celId: targetCel.id, contentRevision: prepared }]
          : [];
      });
      changedCelCount = entries.length;
      if (entries.length === 0) {
        outcome = "no-op";
        setError(
          cleanupMode === "transparency"
            ? "所选画格中没有匹配目标颜色的像素"
            : "所选画格已经符合目标共享色板",
        );
        return false;
      }

      const latestDocument = useAnimationDocumentStore.getState().document;
      const latestAnimation = latestDocument?.animations.find(
        (candidate) => candidate.id === sourceAnimation.id,
      );
      const contentChanged = targetCels.some(
        (sourceTargetCel) =>
          latestAnimation?.cels.find((candidate) => candidate.id === sourceTargetCel.id)
            ?.contentRevisionId !== sourceTargetCel.contentRevisionId,
      );
      if (latestDocument?.projectId !== sourceDocument.projectId || contentChanged) {
        throw new Error("批量处理期间项目或画格内容已变化；新文件已保留但未自动切换");
      }

      useAnimationDocumentStore.getState().execute({
        type: "set_cel_contents",
        animationId: sourceAnimation.id,
        entries,
      });
      const appliedAnimation = useAnimationDocumentStore
        .getState()
        .document?.animations.find((candidate) => candidate.id === sourceAnimation.id);
      const expectedContentByCelId = new Map(
        entries.map((entry) => [entry.celId, entry.contentRevision.id]),
      );
      const didApply = entries.every(
        (entry) =>
          appliedAnimation?.cels.find((candidate) => candidate.id === entry.celId)
            ?.contentRevisionId === expectedContentByCelId.get(entry.celId),
      );
      if (!didApply) {
        throw new Error("项目会话已失效，批量内容未切换");
      }
      if (currentPreparedImage) updateImage(currentPreparedImage);
      outcome = "applied";
      return true;
    } catch (batchError) {
      setError(describeError(batchError));
      return false;
    } finally {
      console.info("[FrameForge] batch pixel cleanup ended", {
        ...logContext,
        outcome,
        preparedRevisionCount,
        changedCelCount,
      });
      commitInFlightRef.current = false;
      setBusy(false);
      setBatchProgress(null);
    }
  };

  const handleApplyCleanup = async () => {
    const current = imageRef.current;
    if (
      !current ||
      !cleanupPreview ||
      (cleanupPreview.changedPixels === 0 && !batchCleanupRequested) ||
      busy ||
      layer?.locked ||
      (batchCleanupRequested && cleanupSelectionHasLockedLayer)
    ) {
      return;
    }
    if (batchCleanupRequested) {
      const applied = await applyCleanupToSelection();
      if (applied) handleCloseCleanup();
      return;
    }
    const logContext = {
      projectId: useAnimationDocumentStore.getState().document?.projectId,
      celId: cel?.id,
      changedPixelCount: cleanupPreview.changedPixels,
      mode: cleanupMode,
      parameter: cleanupMode === "transparency" ? cleanupTolerance : paletteSize,
      ditherStrength: cleanupMode === "palette" ? paletteDitherStrength : undefined,
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
              disabled={busy}
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
              disabled={busy}
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
              disabled={busy}
            >
              压缩颜色
            </button>
          </div>

          {cleanupMode === "transparency" && (
            <>
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

              {backgroundSuggestion ? (
                <div className="mb-3 rounded border border-cyan-900 bg-cyan-950/40 p-2 text-xs">
                  <div className="flex items-center justify-between gap-2 text-cyan-200">
                    <span>边缘背景建议</span>
                    <button
                      type="button"
                      className="rounded bg-cyan-800 px-2 py-1 text-white hover:bg-cyan-700"
                      onClick={handleUseBackgroundSuggestion}
                      disabled={busy}
                    >
                      采用建议
                    </button>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-gray-400">
                    <span
                      className="h-4 w-4 rounded border border-gray-600"
                      style={{ backgroundColor: colorToHex(backgroundSuggestion.color) }}
                    />
                    <span>
                      {colorToHex(backgroundSuggestion.color).toUpperCase()} · 主色范围 {backgroundSuggestion.matchedEdgePixels}/
                      {backgroundSuggestion.opaqueEdgePixels} 个边缘像素（
                      {Math.round(backgroundSuggestion.confidence * 100)}%）· 建议容差 ±
                      {backgroundSuggestion.recommendedTolerance}
                    </span>
                  </div>
                  {backgroundSuggestion.confidence < 0.6 && (
                    <div className="mt-1 text-amber-400">
                      边缘颜色较分散，请仔细检查建议参数下的预览。
                    </div>
                  )}
                </div>
              ) : (
                <div className="mb-3 rounded bg-gray-800 px-2 py-1.5 text-xs text-gray-500">
                  边缘没有非透明像素，未生成背景色建议。
                </div>
              )}
            </>
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
                  disabled={busy}
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
                  disabled={busy}
                />
              </label>

              {cleanupSelectionCels.length > 1 && (
                <div className="mb-3 rounded border border-gray-700 bg-gray-800/70 p-2">
                  <label className="flex items-start gap-2 text-xs text-gray-300">
                    <input
                      type="checkbox"
                      checked={applyToSelection}
                      onChange={(event) => handleApplyToSelectionChange(event.target.checked)}
                      disabled={busy}
                      className="mt-0.5 accent-orange-500"
                    />
                    <span>
                      应用到已选的 {cleanupSelectionCels.length} 个画格
                      <span className="mt-1 block text-[11px] leading-4 text-gray-500">
                        当前画格用于预览；应用时使用相同颜色和容差处理全部所选画格。
                      </span>
                    </span>
                  </label>
                  {cleanupSelectionCels.length > MAX_BATCH_CLEANUP_CELS && (
                    <div className="mt-2 text-[11px] text-red-400">
                      单次最多处理 {MAX_BATCH_CLEANUP_CELS} 个画格
                    </div>
                  )}
                  {cleanupSelectionHasLockedLayer && (
                    <div className="mt-2 text-[11px] text-amber-400">
                      选择中包含锁定图层，批量应用将被拒绝
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
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
                  disabled={busy}
                />
              </label>

              <label className="mb-3 block text-xs text-gray-400">
                <span className="mb-1 flex justify-between">
                  <span>有序抖动</span>
                  <span>
                    {paletteDitherStrength === 0 ? "关闭" : paletteDitherStrength}
                  </span>
                </span>
                <input
                  type="range"
                  min="0"
                  max={MAX_PALETTE_DITHER_STRENGTH}
                  step="4"
                  value={paletteDitherStrength}
                  onChange={(event) =>
                    handlePaletteDitherStrengthChange(Number(event.target.value))
                  }
                  className="w-full accent-orange-500"
                  disabled={busy}
                />
                <span className="mt-1 block text-[11px] leading-4 text-gray-500">
                  使用固定 4×4 图案缓解色带；关闭时保持原有压色结果。
                </span>
              </label>

              {cleanupSelectionCels.length > 1 && (
                <div className="mb-3 rounded border border-gray-700 bg-gray-800/70 p-2">
                  <label className="flex items-start gap-2 text-xs text-gray-300">
                    <input
                      type="checkbox"
                      checked={applyToSelection}
                      onChange={(event) => handleApplyToSelectionChange(event.target.checked)}
                      disabled={busy}
                      className="mt-0.5 accent-orange-500"
                    />
                    <span>
                      共享色板应用到 {cleanupSelectionCels.length} 个画格
                      <span className="mt-1 block text-[11px] leading-4 text-gray-500">
                        预览会分析全部所选画格，累计最多 8M 像素，并在每帧使用同一套色板。
                      </span>
                    </span>
                  </label>
                  {cleanupSelectionCels.length > MAX_BATCH_CLEANUP_CELS && (
                    <div className="mt-2 text-[11px] text-red-400">
                      单次最多处理 {MAX_BATCH_CLEANUP_CELS} 个画格
                    </div>
                  )}
                  {cleanupSelectionHasLockedLayer && (
                    <div className="mt-2 text-[11px] text-amber-400">
                      选择中包含锁定图层，批量应用将被拒绝
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <button
            type="button"
            className="mb-3 w-full rounded bg-gray-700 px-3 py-2 text-xs text-white hover:bg-gray-600"
            onClick={() => void handleCreateCleanupPreview()}
            disabled={busy}
          >
            {cleanupMode === "transparency" ? "生成透明预览" : "生成压色预览"}
          </button>

          {batchProgress && (
            <div className="mb-3 rounded bg-gray-800 px-3 py-2 text-xs text-cyan-300">
              正在处理内容 {batchProgress.completed}/{batchProgress.total}
            </div>
          )}

          {cleanupPreview && (
            <div className="space-y-3">
              <div className="rounded bg-gray-800 px-3 py-2 text-xs text-gray-300">
                {cleanupMode === "transparency"
                  ? `将清除 ${cleanupPreview.changedPixels} 个像素`
                  : batchCleanupRequested
                    ? `当前画格将调整 ${cleanupPreview.changedPixels} 个像素`
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
              {batchCleanupRequested &&
                cleanupMode === "palette" &&
                batchPalettePreviewSignature !== currentBatchPaletteSignature && (
                  <div className="rounded bg-amber-950 px-3 py-2 text-xs text-amber-300">
                    所选画格或内容已变化，请重新生成共享色板预览
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
                disabled={
                  busy ||
                  layer?.locked ||
                  (batchCleanupRequested &&
                    (cleanupSelectionHasLockedLayer ||
                      cleanupSelectionCels.length > MAX_BATCH_CLEANUP_CELS ||
                      (cleanupMode === "palette" &&
                        batchPalettePreviewSignature !== currentBatchPaletteSignature))) ||
                  (cleanupPreview.changedPixels === 0 && !batchCleanupRequested)
                }
              >
                {layer?.locked
                  ? "图层已锁定"
                  : batchCleanupRequested
                    ? `应用到 ${cleanupSelectionCels.length} 个画格`
                    : "应用为新内容版本"}
              </button>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
