import { describe, expect, it } from 'vitest';
import {
  blockRuleName,
  firewallKey,
  parseFirewallRules,
  parseNetshRules,
} from '../src/main/firewall';
import { buildAncestors } from '../src/main/process-tree';

describe('parseFirewallRules', () => {
  it('maps single ports and comma lists to dispositions', () => {
    const statuses = parseFirewallRules(
      JSON.stringify([
        { Name: 'Allow web', Action: 'Allow', Protocol: 'TCP', LocalPort: '80,443' },
        { Name: 'Block dev', Action: 'Block', Protocol: 'TCP', LocalPort: '3000' },
      ]),
    );

    expect(statuses.get('TCP:80')?.disposition).toBe('allowed');
    expect(statuses.get('TCP:443')?.disposition).toBe('allowed');
    expect(statuses.get('TCP:3000')).toMatchObject({
      disposition: 'blocked',
      ruleNames: ['Block dev'],
    });
  });

  it('lets a block rule win over an allow rule on the same port', () => {
    const statuses = parseFirewallRules(
      JSON.stringify([
        { Name: 'Allow web', Action: 'Allow', Protocol: 'TCP', LocalPort: '443' },
        { Name: 'Block web', Action: 'Block', Protocol: 'TCP', LocalPort: '443' },
      ]),
    );
    expect(statuses.get('TCP:443')?.disposition).toBe('blocked');
    expect(statuses.get('TCP:443')?.ruleNames).toEqual(['Allow web', 'Block web']);
  });

  it('expands narrow ranges and applies Any to both protocols', () => {
    const statuses = parseFirewallRules(
      JSON.stringify([{ Name: 'Range', Action: 'Allow', Protocol: 'Any', LocalPort: '5000-5002' }]),
    );
    expect(statuses.get('TCP:5001')?.disposition).toBe('allowed');
    expect(statuses.get('UDP:5002')?.disposition).toBe('allowed');
    expect(statuses.has('TCP:5003')).toBe(false);
  });

  it('drops wide ranges and non-numeric port keywords', () => {
    const statuses = parseFirewallRules(
      JSON.stringify([
        { Name: 'Ephemeral', Action: 'Allow', Protocol: 'TCP', LocalPort: '1024-65535' },
        { Name: 'Any port', Action: 'Allow', Protocol: 'TCP', LocalPort: 'Any' },
        { Name: 'Rpc', Action: 'Allow', Protocol: 'TCP', LocalPort: 'RPC' },
      ]),
    );
    expect(statuses.size).toBe(0);
  });

  it('handles empty output and the single-object form', () => {
    expect(parseFirewallRules('').size).toBe(0);
    const single = parseFirewallRules(
      JSON.stringify({ Name: 'One', Action: 'Block', Protocol: 'UDP', LocalPort: '53' }),
    );
    expect(single.get('UDP:53')?.disposition).toBe('blocked');
  });
});

describe('parseNetshRules', () => {
  // Verbatim shape of `netsh advfirewall firewall show rule name=all dir=in`.
  const output = [
    'Rule Name:                            ChatGPT',
    '----------------------------------------------------------------------',
    'Enabled:                              Yes',
    'Direction:                            In',
    'Profiles:                             Domain,Private,Public',
    'LocalIP:                              Any',
    'Protocol:                             TCP',
    'LocalPort:                            8081-8083',
    'RemotePort:                           Any',
    'Action:                               Allow',
    '',
    'Rule Name:                            Blocked dev port',
    '----------------------------------------------------------------------',
    'Enabled:                              Yes',
    'Direction:                            In',
    'Protocol:                             TCP',
    'LocalPort:                            3000',
    'Action:                               Block',
    '',
    'Rule Name:                            Disabled legacy rule',
    '----------------------------------------------------------------------',
    'Enabled:                              No',
    'Direction:                            In',
    'Protocol:                             TCP',
    'LocalPort:                            9999',
    'Action:                               Allow',
    '',
  ].join('\r\n');

  it('reads the real netsh block format', () => {
    const statuses = parseNetshRules(output);
    expect(statuses.get('TCP:8081')?.disposition).toBe('allowed');
    expect(statuses.get('TCP:8083')).toMatchObject({
      disposition: 'allowed',
      ruleNames: ['ChatGPT'],
    });
    expect(statuses.get('TCP:3000')?.disposition).toBe('blocked');
  });

  it('skips disabled rules', () => {
    expect(parseNetshRules(output).has('TCP:9999')).toBe(false);
  });

  it('returns nothing for unparseable or empty output', () => {
    expect(parseNetshRules('').size).toBe(0);
    expect(parseNetshRules('Regelname: Etwas\r\nAktiviert: Ja').size).toBe(0);
  });
});

describe('firewall naming', () => {
  it('builds stable keys and rule names', () => {
    expect(firewallKey('TCP', 443)).toBe('TCP:443');
    expect(blockRuleName('UDP', 53)).toBe('Port Visualizer block UDP 53');
  });
});

describe('buildAncestors', () => {
  const tree = new Map([
    [100, { name: 'node', parentPid: 50 }],
    [50, { name: 'pwsh', parentPid: 20 }],
    [20, { name: 'explorer', parentPid: null }],
  ]);
  const lookup = (pid: number) => tree.get(pid) ?? null;

  it('walks from nearest parent to root', () => {
    expect(buildAncestors(100, 50, lookup)).toEqual([
      { pid: 50, name: 'pwsh' },
      { pid: 20, name: 'explorer' },
    ]);
  });

  it('returns nothing when there is no parent', () => {
    expect(buildAncestors(20, null, lookup)).toEqual([]);
    expect(buildAncestors(20, 0, lookup)).toEqual([]);
  });

  it('stops on a recycled-PID cycle instead of looping', () => {
    const cyclic = new Map([
      [1, { name: 'a', parentPid: 2 }],
      [2, { name: 'b', parentPid: 1 }],
    ]);
    expect(buildAncestors(1, 2, (pid) => cyclic.get(pid) ?? null)).toEqual([
      { pid: 2, name: 'b' },
    ]);
  });

  it('stops when a parent is not in the process map', () => {
    expect(buildAncestors(100, 999, lookup)).toEqual([]);
  });
});
