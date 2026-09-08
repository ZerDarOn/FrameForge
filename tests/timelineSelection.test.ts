import assert from "node:assert/strict";
import test from "node:test";
import { selectTimelineAsset } from "../src/core/timelineSelection.ts";

test("plain timeline selection replaces the previous selection", () => {
  assert.deepEqual(
    selectTimelineAsset({ primaryId: "a", selectedIds: ["a", "b"] }, "c"),
    { primaryId: "c", selectedIds: ["c"] },
  );
});

test("additive timeline selection toggles ids and maintains a primary id", () => {
  const added = selectTimelineAsset({ primaryId: "a", selectedIds: ["a"] }, "b", true);
  assert.deepEqual(added, { primaryId: "b", selectedIds: ["a", "b"] });
  assert.deepEqual(selectTimelineAsset(added, "b", true), {
    primaryId: "a",
    selectedIds: ["a"],
  });
});
