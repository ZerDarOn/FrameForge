import { useState, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";
import { useGenerationStore } from "../../stores/generationStore";
import { useProjectStore } from "../../stores/projectStore";
import { useTimelineStore } from "../../stores/timelineStore";
import { useAiConfigStore } from "../../stores/aiConfigStore";
import { listen } from "@tauri-apps/api/event";

const STYLES = [
  { value: "8bit", label: "8-bit" },
  { value: "16bit", label: "16-bit" },
  { value: "32bit", label: "32-bit" },
  { value: "hd", label: "HD" },
];

const SIZES = [
  { w: 32, h: 32 },
  { w: 64, h: 64 },
  { w: 128, h: 128 },
  { w: 256, h: 256 },
];

export function AiGenerationPanel() {
  const project = useProjectStore((s) => s.project);
  const assets = useGenerationStore((s) => s.assets);
  const isGenerating = useGenerationStore((s) => s.isGenerating);
  const progress = useGenerationStore((s) => s.progress);
  const error = useGenerationStore((s) => s.error);
  const generate = useGenerationStore((s) => s.generate);
  const loadAssets = useGenerationStore((s) => s.loadAssets);
  const deleteAsset = useGenerationStore((s) => s.deleteAsset);
  const addToTimeline = useGenerationStore((s) => s.addToTimeline);

  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [style, setStyle] = useState("16bit");
  const [sizeIndex, setSizeIndex] = useState(1);
  const [variants, setVariants] = useState(1);
  const [provider, setProvider] = useState<string>("openai");

  const aiConfig = useAiConfigStore((s) => s.config);
  const loadConfig = useAiConfigStore((s) => s.loadConfig);

  // 获取可用的生成 Provider
  const generationProviders = aiConfig?.providers.filter(
    (p) => p.enabled && p.capabilities.includes("TextToPixel")
  ) ?? [];

  useEffect(() => {
    if (project) loadAssets(project.id);
    loadConfig();
  }, [project, loadAssets, loadConfig]);

  // 监听生成进度
  useEffect(() => {
    const unlisten = listen<{ stage: string; current: number; total: number }>(
      "generation-progress",
      (event) => {
        useGenerationStore.setState({ progress: event.payload });
      }
    );
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const handleGenerate = () => {
    if (!project || !prompt.trim()) return;
    generate(project.id, {
      prompt: prompt.trim(),
      negativePrompt: negativePrompt.trim() || undefined,
      style,
      width: SIZES[sizeIndex].w,
      height: SIZES[sizeIndex].h,
      numVariants: variants,
      provider,
    });
  };

  const handleAddToTimeline = async (assetId: string) => {
    if (!project) return;
    try {
      const trackId = await addToTimeline(assetId, null, project.id);
      // 刷新时间线
      const tracks = await invoke("get_project_tracks", { projectId: project.id });
      useTimelineStore.getState().setTracks(tracks as any[]);
      console.log("已添加到轨道:", trackId);
    } catch (err) {
      console.error("添加到时间线失败:", err);
    }
  };

  return (
    <div className="flex flex-col h-full text-xs">
      {/* 生成控制 */}
      <div className="p-3 space-y-2.5 border-b border-gray-800">
        <div>
          <textarea
            className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-200 resize-none focus:outline-none focus:border-orange-400"
            rows={2}
            placeholder="描述你想要的像素画..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div>
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded px-2.5 py-1 text-[10px] text-gray-400 focus:outline-none focus:border-orange-400"
            placeholder="反向提示（可选）"
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
          />
        </div>

        {/* 风格选择 */}
        <div>
          <div className="text-gray-500 text-[10px] mb-1">风格</div>
          <div className="flex gap-1">
            {STYLES.map((s) => (
              <button
                key={s.value}
                className={`flex-1 py-1 rounded text-[10px] ${
                  style === s.value
                    ? "bg-orange-600/30 text-orange-400 border border-orange-400"
                    : "bg-gray-800 text-gray-500 hover:bg-gray-700"
                }`}
                onClick={() => setStyle(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* 尺寸 */}
        <div>
          <div className="text-gray-500 text-[10px] mb-1">尺寸</div>
          <div className="flex gap-1">
            {SIZES.map((s, i) => (
              <button
                key={i}
                className={`flex-1 py-1 rounded text-[10px] ${
                  sizeIndex === i
                    ? "bg-orange-600/30 text-orange-400 border border-orange-400"
                    : "bg-gray-800 text-gray-500 hover:bg-gray-700"
                }`}
                onClick={() => setSizeIndex(i)}
              >
                {s.w}x{s.h}
              </button>
            ))}
          </div>
        </div>

        {/* 变体数 */}
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-[10px]">变体</span>
          <div className="flex gap-1">
            {[1, 2, 4].map((v) => (
              <button
                key={v}
                className={`px-2 py-0.5 rounded text-[10px] ${
                  variants === v
                    ? "bg-orange-600/30 text-orange-400"
                    : "bg-gray-800 text-gray-500"
                }`}
                onClick={() => setVariants(v)}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* 后端选择 */}
        {generationProviders.length > 0 && (
          <div>
            <div className="text-gray-500 text-[10px] mb-1">后端</div>
            <div className="flex gap-1">
              {generationProviders.map((p) => (
                <button
                  key={p.id}
                  className={`flex-1 py-1 rounded text-[10px] ${
                    provider === p.id
                      ? "bg-orange-600/30 text-orange-400 border border-orange-400"
                      : "bg-gray-800 text-gray-500 hover:bg-gray-700"
                  }`}
                  onClick={() => setProvider(p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="text-[10px] text-red-400 bg-red-900/20 rounded px-2 py-1">
            {error}
          </div>
        )}

        {/* 进度 */}
        {isGenerating && progress && (
          <div>
            <div className="text-[10px] text-gray-500 mb-1">
              {progress.stage === "generating" && `生成中 ${progress.current}/${progress.total}...`}
              {progress.stage === "done" && "生成完成"}
            </div>
            <div className="w-full bg-gray-800 rounded-full h-1">
              <div
                className="bg-orange-500 h-1 rounded-full transition-all"
                style={{ width: `${(progress.current / Math.max(progress.total, 1)) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* 生成按钮 */}
        <button
          className="w-full py-2 bg-orange-600 hover:bg-orange-500 rounded text-xs font-medium text-white disabled:opacity-50"
          onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim()}
        >
          {isGenerating ? "生成中..." : "生成像素画"}
        </button>
      </div>

      {/* 生成历史 */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="text-gray-500 text-[10px] mb-2">生成历史 ({assets.length})</div>
        {assets.length === 0 ? (
          <div className="text-[10px] text-gray-700 text-center py-4">暂无生成资产</div>
        ) : (
          <div className="space-y-2">
            {assets.map((asset) => (
              <div key={asset.id} className="bg-gray-800/50 rounded p-2 space-y-1.5">
                <div className="flex items-start gap-2">
                  <img
                    src={convertFileSrc(asset.filePath)}
                    alt={asset.name}
                    className="w-12 h-12 object-contain bg-gray-900 rounded border border-gray-700"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-gray-300 truncate">{asset.name}</div>
                    <div className="text-[9px] text-gray-600 truncate">{asset.prompt}</div>
                    <div className="text-[9px] text-gray-600">
                      {asset.style} | {asset.width}x{asset.height} | seed: {asset.seed ?? "?"}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    className="flex-1 py-1 bg-gray-700 hover:bg-gray-600 rounded text-[10px] text-gray-300"
                    onClick={() => handleAddToTimeline(asset.id)}
                  >
                    + 时间线
                  </button>
                  <button
                    className="px-2 py-1 bg-gray-700 hover:bg-red-900/50 rounded text-[10px] text-gray-400"
                    onClick={() => deleteAsset(asset.id)}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
