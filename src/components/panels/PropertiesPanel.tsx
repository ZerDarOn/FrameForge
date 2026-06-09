import { useUIStore } from "../../stores/uiStore";
import { useTimelineStore } from "../../stores/timelineStore";
import { invoke } from "@tauri-apps/api/core";

export function PropertiesPanel() {
  const tab = useUIStore((s) => s.propertiesTab);
  const setTab = useUIStore((s) => s.setPropertiesTab);
  const selectedAssetId = useTimelineStore((s) => s.selectedAssetId);
  const tracks = useTimelineStore((s) => s.tracks);

  // 查找选中的资产
  let selectedAsset = null;
  let selectedTrack = null;
  for (const track of tracks) {
    const asset = track.assets.find((a) => a.id === selectedAssetId);
    if (asset) {
      selectedAsset = asset;
      selectedTrack = track;
      break;
    }
  }

  const tabs = [
    { key: "info" as const, label: "帧信息" },
    { key: "baseline" as const, label: "基准点" },
    { key: "ai" as const, label: "AI检测" },
    { key: "transform" as const, label: "变换" },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-900">
      <div className="flex border-b border-gray-700">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`flex-1 py-2 text-xs ${
              tab === t.key
                ? "text-orange-400 border-b-2 border-orange-400"
                : "text-gray-500 hover:text-gray-300"
            }`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 text-xs">
        {!selectedAsset ? (
          <div className="text-center text-gray-600 py-8">
            选择一帧查看属性
          </div>
        ) : tab === "info" ? (
          <FrameInfo asset={selectedAsset} track={selectedTrack!} />
        ) : tab === "transform" ? (
          <TransformInfo asset={selectedAsset} />
        ) : tab === "baseline" ? (
          <BaselineInfo />
        ) : tab === "ai" ? (
          <div className="text-center text-gray-600 py-4">
            AI分析功能将在后续版本实现
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FrameInfo({ asset, track }: { asset: any; track: any }) {
  return (
    <div className="space-y-3">
      <Section title="基本信息">
        <Row label="文件名" value={asset.name} />
        <Row label="轨道" value={track.name} />
        <Row label="位置" value={`帧 ${asset.startFrame}`} />
        <Row label="尺寸" value={asset.width > 0 ? `${asset.width} x ${asset.height}` : "未知"} />
        <Row label="匹配帧率" value={asset.matchedFps ? "是" : "否"} />
        {asset.sourceTimestamp > 0 && (
          <Row label="时间戳" value={`${(asset.sourceTimestamp / 1000).toFixed(2)}s`} />
        )}
      </Section>
      <Section title="文件路径">
        <div className="text-gray-500 break-all bg-gray-800 p-2 rounded text-[10px]">
          {asset.sourcePath}
        </div>
      </Section>
    </div>
  );
}

function TransformInfo({ asset }: { asset: any }) {
  const updateAsset = useTimelineStore((s) => s.updateAsset);

  const handleUpdate = (field: string, value: number) => {
    if (!asset) return;
    const track = useTimelineStore.getState().tracks.find((t) =>
      t.assets.some((a) => a.id === asset.id)
    );
    if (track) {
      updateAsset(track.id, asset.id, { [field]: value });
      // 同步后端
      const a = { ...asset, [field]: value };
      invoke("update_asset_transform", {
        assetId: asset.id,
        transformX: a.transformX,
        transformY: a.transformY,
        transformScaleX: a.transformScaleX,
        transformScaleY: a.transformScaleY,
        transformRotation: a.transformRotation,
        alignmentDx: a.alignmentDx,
        alignmentDy: a.alignmentDy,
      }).catch(console.error);
    }
  };

  return (
    <div className="space-y-3">
      <Section title="位移">
        <SliderRow label="X" value={asset.transformX} min={-500} max={500} onChange={(v) => handleUpdate("transformX", v)} />
        <SliderRow label="Y" value={asset.transformY} min={-500} max={500} onChange={(v) => handleUpdate("transformY", v)} />
      </Section>
      <Section title="缩放">
        <SliderRow label="X" value={asset.transformScaleX} min={0.1} max={3} step={0.1} onChange={(v) => handleUpdate("transformScaleX", v)} />
        <SliderRow label="Y" value={asset.transformScaleY} min={0.1} max={3} step={0.1} onChange={(v) => handleUpdate("transformScaleY", v)} />
      </Section>
      <Section title="旋转">
        <SliderRow label="角度" value={asset.transformRotation} min={-180} max={180} onChange={(v) => handleUpdate("transformRotation", v)} />
      </Section>
      <Section title="对齐偏移">
        <SliderRow label="DX" value={asset.alignmentDx} min={-100} max={100} onChange={(v) => handleUpdate("alignmentDx", v)} />
        <SliderRow label="DY" value={asset.alignmentDy} min={-100} max={100} onChange={(v) => handleUpdate("alignmentDy", v)} />
      </Section>
    </div>
  );
}

function BaselineInfo() {
  return (
    <div className="text-center text-gray-600 py-4">
      <div className="mb-2">在画面上点击设定基准点</div>
      <div className="text-[10px] text-gray-700">
        基准点用于对齐参考，可以是点、线或区域
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-gray-400 font-medium mb-1.5">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-300">{value}</span>
    </div>
  );
}

function SliderRow({ label, value, min, max, step = 1, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-500 w-6">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 accent-orange-500 h-1"
      />
      <span className="text-gray-400 w-10 text-right text-[10px]">{value.toFixed(step < 1 ? 1 : 0)}</span>
    </div>
  );
}
