// Chromium drops the requests it has in flight (net::ERR_NETWORK_CHANGED) when the host's IP
// addresses change. A container gives the host a new interface whose IPv6 link-local address the
// kernel announces only once duplicate address detection is done, a second or two after the
// container already answers: a page load at that moment loses its scripts, and the app never boots.
// Removing a container withdraws its address before docker returns. So whoever starts a container
// for a browser test waits here first.
import { readFile } from 'node:fs/promises';

const IFA_F_DADFAILED = 0x08;
const IFA_F_TENTATIVE = 0x40;

/** Each interface with an address still in duplicate address detection, from /proc/net/if_inet6. */
export function tentativeInterfaces(ifInet6: string): string[] {
  return ifInet6
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields.length >= 6 && (parseInt(fields[4] as string, 16) & (IFA_F_TENTATIVE | IFA_F_DADFAILED)) === IFA_F_TENTATIVE)
    .map((fields) => fields[5] as string);
}

export interface SettleOptions {
  read?: () => Promise<string>;
  timeoutMs?: number;
  pollMs?: number;
}

/**
 * Returns once the host has announced every new address (none is tentative), or after `timeoutMs`
 * when one stays tentative; at once where /proc/net/if_inet6 cannot be read (no IPv6, not Linux).
 */
export async function hostAddressesSettled({
  read = () => readFile('/proc/net/if_inet6', 'utf8'),
  timeoutMs = 10_000,
  pollMs = 50,
}: SettleOptions = {}): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let table: string;
    try {
      table = await read();
    } catch {
      return;
    }
    if (tentativeInterfaces(table).length === 0 || Date.now() >= deadline) return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
