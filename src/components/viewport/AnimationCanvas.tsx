import { useEffect, useRef, useState } from "react";
import { AnimationCanvasRenderer } from "../../engines/animationCanvasRenderer";
import type { AnimationDocument } from "../../types/animationDocument";

interface AnimationCanvasProps {
  document: AnimationDocument;
  animationId: string;
  tick: number;
  className?: string;
}

const renderer = new AnimationCanvasRenderer();

export function AnimationCanvas({
  document,
  animationId,
  tick,
  className,
}: AnimationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    renderer
      .renderFrame(document, animationId, tick, canvas)
      .then(() => {
        if (!cancelled) setError(null);
      })
      .catch((renderError: unknown) => {
        if (!cancelled) {
          setError(renderError instanceof Error ? renderError.message : String(renderError));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [animationId, document, tick]);

  return (
    <div className={className}>
      <canvas
        ref={canvasRef}
        className="h-full w-full object-contain [image-rendering:pixelated]"
        aria-label={`动画预览，第 ${tick} 帧`}
      />
      {error && (
        <div className="absolute inset-x-4 bottom-4 rounded bg-red-950/90 p-2 text-xs text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}
