// RFC 9449 proofs, signed in-page with the non-extractable device key.
import { SignJWT } from 'jose';
import { sha256Base64url } from './pkce';

export interface PublicJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

export interface DpopKey {
  privateKey: CryptoKey;
  jwk: PublicJwk;
}

export interface ProofClaims {
  method: string;
  /** Origin + path, no query or fragment. */
  htu: string;
  /** Seconds, already corrected to the server's clock. */
  iat: number;
  accessToken?: string;
  nonce?: string;
}

export async function createDpopProof(key: DpopKey, claims: ProofClaims): Promise<string> {
  const payload: Record<string, string> = {
    htm: claims.method.toUpperCase(),
    htu: claims.htu,
    jti: crypto.randomUUID(),
  };
  if (claims.accessToken !== undefined) payload['ath'] = await sha256Base64url(claims.accessToken);
  if (claims.nonce !== undefined) payload['nonce'] = claims.nonce;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: { ...key.jwk } })
    .setIssuedAt(claims.iat)
    .sign(key.privateKey);
}

/** The `error` of a `WWW-Authenticate: DPoP error="..."` challenge. */
export function dpopChallengeError(header: string | null): string | undefined {
  if (header === null || !/^DPoP\b/i.test(header)) return undefined;
  return /\berror="([^"]*)"/.exec(header)?.[1];
}
