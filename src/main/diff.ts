import type { PortEntry, ScanDiff } from '../shared/types';

/**
 * Compare two scans by entry id. Pure function — unit tested.
 * `changedIds` covers entries present in both scans whose state differs
 * (e.g. ESTABLISHED -> TIME_WAIT).
 */
export function diffScans(previous: PortEntry[], next: PortEntry[]): ScanDiff {
  const prevById = new Map(previous.map((p) => [p.id, p]));
  const nextIds = new Set(next.map((p) => p.id));

  const addedIds: string[] = [];
  const changedIds: string[] = [];

  for (const entry of next) {
    const before = prevById.get(entry.id);
    if (!before) {
      addedIds.push(entry.id);
    } else if (before.state !== entry.state) {
      changedIds.push(entry.id);
    }
  }

  const removed = previous.filter((p) => !nextIds.has(p.id));

  return {
    addedIds,
    removedIds: removed.map((p) => p.id),
    changedIds,
    removed,
  };
}
