import { promises as fs } from 'fs';
import { dirname } from 'path';
import type { PortEvent } from '../shared/types';

const MAX_MEMORY_EVENTS = 1000;
const COMPACT_AT_BYTES = 5 * 1024 * 1024;

export class EventStore {
  private recent: PortEvent[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(dirname(this.filePath), { recursive: true });
      const content = await fs.readFile(this.filePath, 'utf8');
      this.recent = content
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-MAX_MEMORY_EVENTS)
        .map((line) => parseEvent(line))
        .filter((event): event is PortEvent => event !== null);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[EventStore] Failed to load event history:', error);
      }
      this.recent = [];
    }
  }

  getRecent(limit = 500): PortEvent[] {
    const safeLimit = Math.max(0, Math.min(MAX_MEMORY_EVENTS, Math.floor(limit)));
    return this.recent.slice(-safeLimit);
  }

  append(events: PortEvent[]): Promise<void> {
    if (events.length === 0) return this.writeQueue;
    this.recent.push(...events);
    if (this.recent.length > MAX_MEMORY_EVENTS) {
      this.recent.splice(0, this.recent.length - MAX_MEMORY_EVENTS);
    }
    const lines = `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
    this.writeQueue = this.writeQueue
      .then(async () => {
        try {
          await fs.appendFile(this.filePath, lines, 'utf8');
          const stat = await fs.stat(this.filePath);
          if (stat.size > COMPACT_AT_BYTES) await this.compact();
        } catch (error) {
          console.error('[EventStore] Failed to persist events:', error);
        }
      })
      .catch((error) => console.error('[EventStore] Write queue failed:', error));
    return this.writeQueue;
  }

  private async compact(): Promise<void> {
    const content = `${this.recent.map((event) => JSON.stringify(event)).join('\n')}\n`;
    const temporaryPath = `${this.filePath}.tmp`;
    try {
      await fs.writeFile(temporaryPath, content, 'utf8');
      await fs.rename(temporaryPath, this.filePath);
    } catch (error) {
      console.error('[EventStore] Failed to compact history:', error);
      try {
        await fs.unlink(temporaryPath);
      } catch (cleanupError) {
        if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error('[EventStore] Failed to remove temporary history:', cleanupError);
        }
      }
    }
  }
}

function parseEvent(line: string): PortEvent | null {
  try {
    const event = JSON.parse(line) as Partial<PortEvent>;
    if (
      event.schemaVersion !== 1 ||
      !Number.isSafeInteger(event.sequence) ||
      typeof event.timestamp !== 'number' ||
      typeof event.observationId !== 'string' ||
      !event.port ||
      ![
        'port.opened',
        'port.closed',
        'port.changed',
        'port.owner-changed',
        'port.exposure-changed',
      ].includes(String(event.type))
    ) {
      return null;
    }
    return event as PortEvent;
  } catch {
    return null;
  }
}
