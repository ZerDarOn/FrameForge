import { useAnalysisStore } from "../../stores/analysisStore";
import { useTimelineStore } from "../../stores/timelineStore";

interface Props {
  imageRect: { x: number; y: number; width: number; height: number } | null;
}

export function AnalysisOverlay({ imageRect }: Props) {
  const reports = useAnalysisStore((s) => s.reports);
  const activeReportId = useAnalysisStore((s) => s.activeReportId);
  const currentFrame = useTimelineStore((s) => s.currentFrame);

  const report = reports.find((r) => r.id === activeReportId);
  if (!report || !imageRect) return null;

  const displacement = report.displacement.find((d) => d.frameIndex === currentFrame);
  const flicker = report.flickerFrames.find((f) => f.frameIndex === currentFrame);

  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      {displacement && displacement.magnitude > 1.0 && (
        <svg className="absolute inset-0 w-full h-full">
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#ef4444" />
            </marker>
          </defs>
          <line
            x1={imageRect.x + imageRect.width / 2}
            y1={imageRect.y + imageRect.height / 2}
            x2={imageRect.x + imageRect.width / 2 + displacement.dx * 20}
            y2={imageRect.y + imageRect.height / 2 + displacement.dy * 20}
            stroke="#ef4444"
            strokeWidth={2}
            markerEnd="url(#arrowhead)"
          />
          <text
            x={imageRect.x + imageRect.width / 2 + displacement.dx * 20 + 10}
            y={imageRect.y + imageRect.height / 2 + displacement.dy * 20}
            fill="#ef4444"
            fontSize="10"
          >
            {displacement.magnitude.toFixed(1)}px
          </text>
        </svg>
      )}

      {flicker && flicker.severity !== "low" && (
        <div
          className="absolute border-2 rounded"
          style={{
            left: imageRect.x,
            top: imageRect.y,
            width: imageRect.width,
            height: imageRect.height,
            borderColor: flicker.severity === "high" ? "#3b82f6" : "#60a5fa",
            backgroundColor: flicker.severity === "high" ? "rgba(59,130,246,0.1)" : "rgba(96,165,250,0.05)",
          }}
        />
      )}
    </div>
  );
}
