import { describe, expect, it } from 'vitest';
import {
  applyKnowledgePacks,
  parseKnowledgePack,
} from '../src/main/knowledge-packs';
import type { PortEntry } from '../src/shared/types';

const observation: PortEntry = {
  id: 'socket-1',
  protocol: 'TCP',
  localAddress: '127.0.0.1',
  localPort: 11434,
  remoteAddress: null,
  remotePort: null,
  state: 'LISTENING',
  pid: 42,
  processName: 'ollama',
  processPath: null,
  memory: 0,
  parentPid: null,
  commandLine: 'ollama serve',
  serviceLabel: 'ollama',
  exposure: 'loopback',
  attributes: {},
  annotations: [],
};

describe('knowledge packs', () => {
  it('parses declarative rules and attaches provenance', () => {
    const pack = parseKnowledgePack({
      schemaVersion: 1,
      id: 'test.dynamic-service',
      name: 'Dynamic service',
      version: 2,
      enabledByDefault: true,
      rules: [
        {
          id: 'by-process-and-port',
          when: {
            all: [
              { field: 'process.name', contains: 'OLLAMA' },
              { field: 'endpoint.port', oneOf: [11434] },
            ],
          },
          annotate: { 'service.kind': 'model-api' },
          confidence: 0.9,
        },
      ],
    });

    expect(pack).not.toBeNull();
    applyKnowledgePacks([observation], [pack!]);
    expect(observation.annotations).toEqual([
      {
        namespace: 'test.dynamic-service',
        values: { 'service.kind': 'model-api' },
        source: 'pack:test.dynamic-service@2/by-process-and-port',
        confidence: 0.9,
      },
    ]);
  });

  it('rejects executable or malformed rules', () => {
    expect(parseKnowledgePack({ schemaVersion: 1, id: '../bad' })).toBeNull();
  });
});
