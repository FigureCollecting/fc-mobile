import { describe, expect, it, vi } from 'vitest';
import { hostAddressesSettled, tentativeInterfaces } from '../src/hostNetwork.js';

// /proc/net/if_inet6: address, ifindex, prefix length, scope, flags (hex), interface name.
const line = (name: string, flags: string): string => `fe800000000000003c22b1fffe0a8b7c 1f 40 20 ${flags} ${name.padStart(8)}`;
const settled = [line('lo', '80'), line('eth0', '80'), line('docker0', '80')].join('\n') + '\n';
const announcing = (name: string): string => `${settled}${line(name, 'c0')}\n`;

describe('tentativeInterfaces', () => {
  it('names each interface whose address is still in duplicate address detection', () => {
    expect(tentativeInterfaces(settled)).toEqual([]);
    expect(tentativeInterfaces(announcing('veth5f1c2a9'))).toEqual(['veth5f1c2a9']);
    expect(tentativeInterfaces(`${line('veth1', '40')}\n${line('veth2', 'c4')}\n`)).toEqual(['veth1', 'veth2']);
  });

  it('leaves out an address whose detection failed: it stays tentative and is never announced', () => {
    expect(tentativeInterfaces(`${line('wlan0', 'c8')}\n`)).toEqual([]);
  });

  it('reads nothing from an empty table', () => {
    expect(tentativeInterfaces('')).toEqual([]);
  });
});

describe('hostAddressesSettled', () => {
  it('returns at once when no address is tentative', async () => {
    const read = vi.fn(async () => settled);
    await hostAddressesSettled({ read });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("waits while a new container's address is tentative and returns once the host has announced it", async () => {
    const tables = [announcing('veth5f1c2a9'), announcing('veth5f1c2a9'), settled];
    const read = vi.fn(async () => tables.shift() ?? settled);
    await hostAddressesSettled({ read, pollMs: 1 });
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('gives up after timeoutMs, without failing, when an address stays tentative', async () => {
    const read = vi.fn(async () => announcing('veth5f1c2a9'));
    const started = Date.now();
    await hostAddressesSettled({ read, timeoutMs: 30, pollMs: 5 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(30);
    expect(read.mock.calls.length).toBeGreaterThan(1);
  });

  it('returns at once where the table cannot be read (no IPv6, or not Linux)', async () => {
    const read = vi.fn(async () => Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })));
    await hostAddressesSettled({ read });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('reads /proc/net/if_inet6 by default', async () => {
    await expect(hostAddressesSettled({ timeoutMs: 0 })).resolves.toBeUndefined();
  });
});
