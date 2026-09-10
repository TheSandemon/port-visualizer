import type { ProcessAncestor } from '../shared/types';

const MAX_DEPTH = 8;

export interface AncestorSource {
  name: string;
  parentPid: number | null;
}

/**
 * Walk from a process up to its root, nearest parent first. Stops on a cycle
 * or a recycled-PID loop, which Windows can produce when a parent exits and
 * its PID is reassigned. Pure — unit tested.
 */
export function buildAncestors(
  pid: number,
  parentPid: number | null,
  lookup: (pid: number) => AncestorSource | null,
): ProcessAncestor[] {
  const chain: ProcessAncestor[] = [];
  const seen = new Set<number>([pid]);

  let current = parentPid;
  while (current !== null && current > 0 && chain.length < MAX_DEPTH) {
    if (seen.has(current)) break;
    seen.add(current);
    const info = lookup(current);
    if (!info) break;
    chain.push({ pid: current, name: info.name });
    current = info.parentPid;
  }

  return chain;
}
