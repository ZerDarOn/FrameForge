import assert from "node:assert/strict";
import test from "node:test";
import { isGlobalShortcutAllowed } from "../src/core/keyboardScope.ts";
import { decideCloseAction } from "../src/core/unsavedClose.ts";

test("close waits for an in-flight save and confirms after failure", () => {
  assert.equal(decideCloseAction({ hasDocument: true, saveStatus: "saving", documentRevision: 2, persistedRevision: 1 }), "wait");
  assert.equal(decideCloseAction({ hasDocument: true, saveStatus: "error", documentRevision: 2, persistedRevision: 1 }), "confirm");
  assert.equal(decideCloseAction({ hasDocument: true, saveStatus: "saved", documentRevision: 2, persistedRevision: 2 }), "allow");
});

test("pixel editor and text fields block global timeline shortcuts", () => {
  assert.equal(isGlobalShortcutAllowed("CANVAS", true), false);
  assert.equal(isGlobalShortcutAllowed("INPUT", false), false);
  assert.equal(isGlobalShortcutAllowed("CANVAS", false), true);
});
