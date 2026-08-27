import type { Exposure, PortEntry } from './types';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', 'localhost']);
const ALL_INTERFACE_ADDRESSES = new Set(['0.0.0.0', '::', '*']);

export function classifyExposure(address: string): Exposure {
  const normalized = address.trim().toLowerCase();
  if (LOOPBACK_ADDRESSES.has(normalized) || normalized.startsWith('127.')) return 'loopback';
  if (ALL_INTERFACE_ADDRESSES.has(normalized)) return 'all-interfaces';
  return 'lan';
}

export function withObservationFields(
  entry: Omit<PortEntry, 'exposure' | 'attributes' | 'annotations'>,
): PortEntry {
  return {
    ...entry,
    exposure: classifyExposure(entry.localAddress),
    attributes: {},
    annotations: [],
  };
}
