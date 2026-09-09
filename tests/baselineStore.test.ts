import assert from "node:assert/strict";
import test from "node:test";
import { restoreBaselinePoints } from "../src/stores/baselineStore.ts";

test("stored baseline points regain deterministic marker colors", () => {
  const restored = restoreBaselinePoints([
    {
      id: "first",
      name: "First",
      type: "point",
      coordinates: [0.25, 0.75],
      frameIndex: 0,
    },
    {
      id: "second",
      name: "Second",
      type: "line",
      coordinates: [0.1, 0.8, 0.9, 0.8],
      frameIndex: 1,
    },
  ]);

  assert.deepEqual(restored.map((point) => point.color), ["#f97316", "#22c55e"]);
  assert.deepEqual(restored[0].coordinates, [0.25, 0.75]);
});
