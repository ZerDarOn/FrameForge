import { useState, useEffect } from "react";
import { useAiConfigStore } from "../../stores/aiConfigStore";

interface Props {
  onClose: () => void;
}

export function AiSettingsDialog({ onClose }: Props) {
  const config = useAiConfigStore((s) => s.config);
  const loadConfig = useAiConfigStore((s) => s.loadConfig);
  const setApiKey = useAiConfigStore((s) => s.setApiKey);
  const toggleProvider = useAiConfigStore((s) => s.toggleProvider);
  const setDefaultProvider = useAiConfigStore((s) => s.setDefaultProvider);

  const [openaiKey, setOpenaiKey] = useState("");
  const [stabilityKey, setStabilityKey] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  if (!config) return null;

  const openai = config.providers.find((p) => p.id === "openai");
  const stability = config.providers.find((p) => p.id === "stability");

  const handleSaveKey = async (providerId: string, key: string) => {
    if (!key.trim()) return;
    await setApiKey(providerId, key.trim());
    setTestResult(`${providerId} Key 已保存`);
    setTimeout(() => setTestResult(null), 2000);
    if (providerId === "openai") setOpenaiKey("");
    if (providerId === "stability") setStabilityKey("");
  };

  return (
    <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-6 w-[480px] shadow-2xl max-h-[80vh] overflow-y-auto">
        <h2 className="text-lg font-bold text-white mb-4">AI 设置</h2>

        {/* 审查分析 Provider */}
        <div className="mb-5">
          <h3 className="text-sm font-medium text-gray-300 mb-2">审查分析</h3>
          <div className="space-y-2">
            <ProviderRow
              name="本地 ONNX"
              enabled={config.providers.find((p) => p.id === "local-onnx")?.enabled ?? false}
              onToggle={() => toggleProvider("local-onnx")}
              description="位移/闪烁检测（本地运行，无需网络）"
            />
            <ProviderRow
              name="OpenAI"
              enabled={openai?.enabled ?? false}
              onToggle={() => toggleProvider("openai")}
              description="一致性检查 + 修复建议（需 API Key）"
            />
          </div>
          <div className="mt-2">
            <div className="text-[10px] text-gray-500 mb-1">默认分析后端</div>
            <select
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300"
              value={config.defaultAnalysisProvider}
              onChange={(e) => setDefaultProvider("analysis", e.target.value)}
            >
              {config.providers.filter((p) => p.capabilities.some((c) => ["DisplacementDetection", "FlickerDetection", "ConsistencyCheck"].includes(c))).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 像素画生成 Provider */}
        <div className="mb-5">
          <h3 className="text-sm font-medium text-gray-300 mb-2">像素画生成</h3>
          <div className="space-y-2">
            <ProviderRow
              name="OpenAI DALL-E"
              enabled={openai?.enabled ?? false}
              onToggle={() => toggleProvider("openai")}
              description="DALL-E 3 图像生成"
            />
            <ProviderRow
              name="Stability AI"
              enabled={stability?.enabled ?? false}
              onToggle={() => toggleProvider("stability")}
              description="Stable Diffusion XL（支持 pixel-art 风格预设）"
            />
          </div>
          <div className="mt-2">
            <div className="text-[10px] text-gray-500 mb-1">默认生成后端</div>
            <select
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300"
              value={config.defaultGenerationProvider}
              onChange={(e) => setDefaultProvider("generation", e.target.value)}
            >
              {config.providers.filter((p) => p.capabilities.includes("TextToPixel")).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* API 密钥 */}
        <div className="mb-5">
          <h3 className="text-sm font-medium text-gray-300 mb-2">API 密钥</h3>
          <div className="space-y-3">
            <KeyInput
              label="OpenAI API Key"
              placeholder="sk-..."
              value={openaiKey}
              onChange={setOpenaiKey}
              hasKey={!!config.apiKeys["openai"]}
              onSave={() => handleSaveKey("openai", openaiKey)}
            />
            <KeyInput
              label="Stability AI API Key"
              placeholder="sk-..."
              value={stabilityKey}
              onChange={setStabilityKey}
              hasKey={!!config.apiKeys["stability"]}
              onSave={() => handleSaveKey("stability", stabilityKey)}
            />
          </div>
        </div>

        {/* 反馈 */}
        {testResult && (
          <div className="mb-4 p-2 bg-green-900/30 text-green-400 rounded text-xs">
            {testResult}
          </div>
        )}

        <div className="flex gap-3">
          <button
            className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 rounded text-sm text-gray-300"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

function ProviderRow({ name, enabled, onToggle, description }: {
  name: string; enabled: boolean; onToggle: () => void; description: string;
}) {
  return (
    <div className="flex items-center gap-3 bg-gray-800/50 rounded px-3 py-2">
      <button
        className={`w-8 h-4 rounded-full relative transition-colors ${enabled ? "bg-orange-500" : "bg-gray-600"}`}
        onClick={onToggle}
      >
        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${enabled ? "left-4.5" : "left-0.5"}`} />
      </button>
      <div className="flex-1">
        <div className="text-xs text-gray-300">{name}</div>
        <div className="text-[10px] text-gray-600">{description}</div>
      </div>
    </div>
  );
}

function KeyInput({ label, placeholder, value, onChange, hasKey, onSave }: {
  label: string; placeholder: string; value: string;
  onChange: (v: string) => void; hasKey: boolean; onSave: () => void;
}) {
  return (
    <div>
      <div className="text-[10px] text-gray-500 mb-1">{label}</div>
      <div className="flex gap-2">
        <input
          type="password"
          className="flex-1 bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-orange-400"
          placeholder={hasKey ? "已配置（输入新 Key 替换）" : placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300 disabled:opacity-50"
          onClick={onSave}
          disabled={!value.trim()}
        >
          保存
        </button>
      </div>
    </div>
  );
}
