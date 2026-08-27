import { describe, expect, it } from 'vitest';
import { classifyExposure } from '../src/shared/observation';
import { redactCommandLine } from '../src/shared/redaction';

describe('classifyExposure', () => {
  it('separates loopback, concrete LAN and wildcard bindings', () => {
    expect(classifyExposure('127.0.0.1')).toBe('loopback');
    expect(classifyExposure('::1')).toBe('loopback');
    expect(classifyExposure('192.168.1.25')).toBe('lan');
    expect(classifyExposure('0.0.0.0')).toBe('all-interfaces');
    expect(classifyExposure('::')).toBe('all-interfaces');
  });
});

describe('redactCommandLine', () => {
  it('redacts flag, environment and URL credentials', () => {
    const input =
      'server --api-key secret OPENAI_API_KEY=sk-value --token="another" https://user:pass@example.test';
    const output = redactCommandLine(input);
    expect(output).not.toContain('secret');
    expect(output).not.toContain('sk-value');
    expect(output).not.toContain('another');
    expect(output).not.toContain('pass');
    expect(output?.match(/<redacted>/g)).toHaveLength(4);
  });
});
