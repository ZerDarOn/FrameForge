export function isGlobalShortcutAllowed(targetTagName: string | null, hasBlockingSurface: boolean) {
  if (hasBlockingSurface) return false;
  return targetTagName !== "INPUT" && targetTagName !== "TEXTAREA";
}
