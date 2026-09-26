import { calculateJwkThumbprint } from 'jose';
import type { PublicJwk } from './dpop';

export interface DeviceKeyRecord {
  sub: string;
  /** Non-extractable: usable to sign in this origin, never exportable, even to an XSS. */
  privateKey: CryptoKey;
  jwk: PublicJwk;
  jkt: string;
  createdAt: number;
  /** Set once POST /api/auth/devices has enrolled the key. */
  deviceId?: string;
  enrolledAt?: string;
}

export async function generateDeviceKey(sub: string, createdAt: number): Promise<DeviceKeyRecord> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const full = await crypto.subtle.exportKey('jwk', pair.publicKey);
  // The proof header carries the bare public key (kty, crv, x, y), not WebCrypto's ext/key_ops.
  const jwk: PublicJwk = { kty: 'EC', crv: 'P-256', x: full.x as string, y: full.y as string };
  return { sub, privateKey: pair.privateKey, jwk, jkt: await calculateJwkThumbprint(jwk), createdAt };
}
