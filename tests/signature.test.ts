import { describe, expect, it } from 'vitest';
import { extractPublisher, parseSignatureOutput } from '../src/main/signature';
import { publisherText } from '../src/shared/export';
import type { PortEntry } from '../src/shared/types';

function entry(signature: PortEntry['signature']): PortEntry {
  return {
    id: 'TCP|0.0.0.0|443|10|',
    protocol: 'TCP',
    localAddress: '0.0.0.0',
    localPort: 443,
    remoteAddress: null,
    remotePort: null,
    state: 'LISTENING',
    pid: 10,
    processName: 'svc',
    processPath: 'C:\\svc.exe',
    memory: 0,
    parentPid: null,
    commandLine: null,
    serviceLabel: null,
    exposure: 'all-interfaces',
    attributes: {},
    annotations: [],
    signature,
  };
}

describe('extractPublisher', () => {
  it('reads the common name out of a certificate subject', () => {
    expect(extractPublisher('CN=Microsoft Corporation, O=Microsoft, C=US')).toBe(
      'Microsoft Corporation',
    );
  });

  it('handles a quoted common name containing a comma', () => {
    expect(extractPublisher('CN="Contoso, Inc.", O=Contoso')).toBe('Contoso, Inc.');
  });

  it('falls back to the raw subject when there is no CN', () => {
    expect(extractPublisher('O=Someone')).toBe('O=Someone');
    expect(extractPublisher(null)).toBeNull();
  });
});

describe('parseSignatureOutput', () => {
  it('maps Authenticode statuses and keeps the publisher', () => {
    const results = parseSignatureOutput(
      JSON.stringify([
        { Path: 'C:\\a.exe', Status: 'Valid', Subject: 'CN=Acme Ltd, O=Acme' },
        { Path: 'C:\\b.exe', Status: 'NotSigned', Subject: null },
        { Path: 'C:\\c.exe', Status: 'HashMismatch', Subject: 'CN=Acme Ltd' },
        { Path: 'C:\\d.exe', Status: 'NotTrusted', Subject: 'CN=Self Signed' },
      ]),
    );

    expect(results.get('C:\\a.exe')).toMatchObject({ status: 'valid', publisher: 'Acme Ltd' });
    expect(results.get('C:\\b.exe')).toMatchObject({ status: 'unsigned', publisher: null });
    expect(results.get('C:\\c.exe')).toMatchObject({ status: 'tampered', publisher: 'Acme Ltd' });
    expect(results.get('C:\\d.exe')).toMatchObject({
      status: 'untrusted',
      publisher: 'Self Signed',
    });
  });

  it('accepts the single-object form PowerShell emits for one file', () => {
    const results = parseSignatureOutput(
      JSON.stringify({ Path: 'C:\\only.exe', Status: 'Valid', Subject: 'CN=Solo' }),
    );
    expect(results.size).toBe(1);
    expect(results.get('C:\\only.exe')?.publisher).toBe('Solo');
  });

  it('ignores rows without a path and empty output', () => {
    expect(parseSignatureOutput('').size).toBe(0);
    expect(parseSignatureOutput(JSON.stringify([{ Status: 'Valid' }])).size).toBe(0);
  });
});

describe('publisherText', () => {
  it('always yields a display string, including before the check completes', () => {
    expect(publisherText(entry(undefined))).toBe('Checking…');
    expect(publisherText(entry(null))).toBe('Checking…');
    expect(
      publisherText(entry({ publisher: 'Acme Ltd', status: 'valid', checkedAt: 1 })),
    ).toBe('Acme Ltd');
    expect(publisherText(entry({ publisher: null, status: 'unsigned', checkedAt: 1 }))).toBe(
      'Unsigned',
    );
    expect(publisherText(entry({ publisher: null, status: 'unavailable', checkedAt: 1 }))).toBe(
      'Unknown publisher',
    );
  });
});
