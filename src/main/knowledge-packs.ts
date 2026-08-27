import { app } from 'electron';
import { promises as fs } from 'fs';
import { join } from 'path';
import type { Annotation, JsonValue, KnowledgePackSummary, PortEntry } from '../shared/types';

type Origin = KnowledgePackSummary['origin'];
type FieldName =
  | 'process.name'
  | 'process.path'
  | 'process.commandLine'
  | 'endpoint.protocol'
  | 'endpoint.address'
  | 'endpoint.port'
  | 'endpoint.state'
  | 'endpoint.exposure'
  | 'service.label';

interface Condition {
  field: FieldName;
  equals?: string | number;
  contains?: string;
  oneOf?: Array<string | number>;
  min?: number;
  max?: number;
}

interface Rule {
  id: string;
  when: { all: Condition[] };
  annotate: Record<string, JsonValue>;
  confidence?: number;
}

interface KnowledgePack {
  schemaVersion: 1;
  id: string;
  name: string;
  version: number;
  enabledByDefault: boolean;
  rules: Rule[];
  origin: Origin;
}

interface LoadedPacks {
  packs: KnowledgePack[];
  summaries: KnowledgePackSummary[];
}

export class KnowledgePackRegistry {
  async enrich(ports: PortEntry[], enabled: boolean): Promise<LoadedPacks> {
    if (!enabled) return { packs: [], summaries: [] };

    const packs = await this.load();
    applyKnowledgePacks(ports, packs);

    return {
      packs,
      summaries: packs.map((pack) => ({
        id: pack.id,
        name: pack.name,
        version: pack.version,
        ruleCount: pack.rules.length,
        origin: pack.origin,
      })),
    };
  }

  private async load(): Promise<KnowledgePack[]> {
    const builtIn = app.isPackaged
      ? join(process.resourcesPath, 'resources', 'packs')
      : join(app.getAppPath(), 'resources', 'packs');
    const locations: Array<[Origin, string]> = [
      ['built-in', builtIn],
      ['user', join(app.getPath('userData'), 'packs')],
      ['workspace', join(process.cwd(), '.portviz', 'packs')],
    ];

    const byId = new Map<string, KnowledgePack>();
    for (const [origin, directory] of locations) {
      for (const pack of await readDirectory(directory, origin)) {
        if (pack.enabledByDefault) byId.set(pack.id, pack);
        else byId.delete(pack.id);
      }
    }
    return [...byId.values()];
  }
}

async function readDirectory(directory: string, origin: Origin): Promise<KnowledgePack[]> {
  try {
    const names = (await fs.readdir(directory)).filter((name) => name.endsWith('.json')).sort();
    const packs: KnowledgePack[] = [];
    for (const name of names) {
      try {
        const raw = JSON.parse(await fs.readFile(join(directory, name), 'utf8')) as unknown;
        const pack = parseKnowledgePack(raw, origin);
        if (pack) packs.push(pack);
      } catch (error) {
        console.error(`[KnowledgePacks] Failed to load ${join(directory, name)}:`, error);
      }
    }
    return packs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`[KnowledgePacks] Failed to read ${directory}:`, error);
    }
    return [];
  }
}

export function parseKnowledgePack(
  raw: unknown,
  origin: Origin = 'user',
): KnowledgePack | null {
  if (!isRecord(raw) || raw.schemaVersion !== 1) return null;
  if (
    typeof raw.id !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]{2,80}$/.test(raw.id) ||
    typeof raw.name !== 'string' ||
    typeof raw.version !== 'number' ||
    !Number.isSafeInteger(raw.version) ||
    typeof raw.enabledByDefault !== 'boolean' ||
    !Array.isArray(raw.rules)
  ) {
    return null;
  }

  const rules = raw.rules.map(parseRule).filter((rule): rule is Rule => rule !== null);
  return {
    schemaVersion: 1,
    id: raw.id,
    name: raw.name.slice(0, 120),
    version: raw.version,
    enabledByDefault: raw.enabledByDefault,
    rules,
    origin,
  };
}

export function applyKnowledgePacks(ports: PortEntry[], packs: KnowledgePack[]): void {
  for (const port of ports) {
    port.annotations = [];
    for (const pack of packs) {
      for (const rule of pack.rules) {
        if (!rule.when.all.every((condition) => matches(port, condition))) continue;
        const annotation: Annotation = {
          namespace: pack.id,
          values: rule.annotate,
          source: `pack:${pack.id}@${pack.version}/${rule.id}`,
          ...(rule.confidence === undefined ? {} : { confidence: rule.confidence }),
        };
        port.annotations.push(annotation);
      }
    }
  }
}

function parseRule(raw: unknown): Rule | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !isRecord(raw.when)) return null;
  if (!Array.isArray(raw.when.all) || !isRecord(raw.annotate)) return null;
  const conditions = raw.when.all
    .map(parseCondition)
    .filter((condition): condition is Condition => condition !== null);
  if (conditions.length === 0 || conditions.length !== raw.when.all.length) return null;
  const annotate: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(raw.annotate)) {
    if (/^[a-z0-9][a-z0-9._-]{1,80}$/.test(key) && isJsonValue(value)) annotate[key] = value;
  }
  if (Object.keys(annotate).length === 0) return null;
  const confidence =
    typeof raw.confidence === 'number' && raw.confidence >= 0 && raw.confidence <= 1
      ? raw.confidence
      : undefined;
  return { id: raw.id.slice(0, 80), when: { all: conditions }, annotate, confidence };
}

function parseCondition(raw: unknown): Condition | null {
  if (!isRecord(raw) || typeof raw.field !== 'string' || !FIELDS.has(raw.field as FieldName))
    return null;
  const condition: Condition = { field: raw.field as FieldName };
  if (typeof raw.equals === 'string' || typeof raw.equals === 'number')
    condition.equals = raw.equals;
  if (typeof raw.contains === 'string') condition.contains = raw.contains.slice(0, 200);
  if (
    Array.isArray(raw.oneOf) &&
    raw.oneOf.every((value) => typeof value === 'string' || typeof value === 'number')
  ) {
    condition.oneOf = raw.oneOf.slice(0, 100);
  }
  if (typeof raw.min === 'number' && Number.isFinite(raw.min)) condition.min = raw.min;
  if (typeof raw.max === 'number' && Number.isFinite(raw.max)) condition.max = raw.max;
  return Object.keys(condition).length > 1 ? condition : null;
}

function matches(port: PortEntry, condition: Condition): boolean {
  const value = fieldValue(port, condition.field);
  const normalized = typeof value === 'string' ? value.toLowerCase() : value;
  if (condition.equals !== undefined) {
    const expected =
      typeof condition.equals === 'string' ? condition.equals.toLowerCase() : condition.equals;
    if (normalized !== expected) return false;
  }
  if (condition.contains !== undefined) {
    if (typeof normalized !== 'string' || !normalized.includes(condition.contains.toLowerCase()))
      return false;
  }
  if (condition.oneOf) {
    const expected = condition.oneOf.map((item) =>
      typeof item === 'string' ? item.toLowerCase() : item,
    );
    if (!expected.includes(normalized as string | number)) return false;
  }
  if (condition.min !== undefined && (typeof value !== 'number' || value < condition.min))
    return false;
  if (condition.max !== undefined && (typeof value !== 'number' || value > condition.max))
    return false;
  return true;
}

function fieldValue(port: PortEntry, field: FieldName): string | number {
  switch (field) {
    case 'process.name':
      return port.processName;
    case 'process.path':
      return port.processPath ?? '';
    case 'process.commandLine':
      return port.commandLine ?? '';
    case 'endpoint.protocol':
      return port.protocol;
    case 'endpoint.address':
      return port.localAddress;
    case 'endpoint.port':
      return port.localPort;
    case 'endpoint.state':
      return port.state;
    case 'endpoint.exposure':
      return port.exposure;
    case 'service.label':
      return port.serviceLabel ?? '';
  }
}

const FIELDS = new Set<FieldName>([
  'process.name',
  'process.path',
  'process.commandLine',
  'endpoint.protocol',
  'endpoint.address',
  'endpoint.port',
  'endpoint.state',
  'endpoint.exposure',
  'service.label',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}
