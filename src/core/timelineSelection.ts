export interface TimelineAssetSelection {
  primaryId: string | null;
  selectedIds: string[];
}

export function selectTimelineAsset(
  current: TimelineAssetSelection,
  assetId: string | null,
  additive = false,
): TimelineAssetSelection {
  if (!assetId) return { primaryId: null, selectedIds: [] };
  if (!additive) return { primaryId: assetId, selectedIds: [assetId] };
  if (!current.selectedIds.includes(assetId)) {
    return {
      primaryId: assetId,
      selectedIds: [...current.selectedIds, assetId],
    };
  }
  const selectedIds = current.selectedIds.filter((id) => id !== assetId);
  return {
    primaryId:
      current.primaryId === assetId
        ? selectedIds[selectedIds.length - 1] ?? null
        : current.primaryId,
    selectedIds,
  };
}
