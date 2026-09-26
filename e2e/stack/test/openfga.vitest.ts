import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Code, ConnectError, createClient, type Client } from '@connectrpc/connect';
import { createConnectTransport, createGrpcTransport } from '@connectrpc/connect-node';
import { OpenFGAService } from '../src/gen/openfga/v1/openfga_service_pb.js';
import { startFakeOpenFga, type FakeOpenFga } from '../src/openfga.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const auth = { authorization: 'Bearer stack-openfga-token' };
const tuple = (sub: string) => ({ user: `user:${sub}`, relation: 'inventory_levels', object: 'app:figurecollecting' });

describe('fake OpenFGA (gRPC Check on h2c)', () => {
  let fga: FakeOpenFga;
  let client: Client<typeof OpenFGAService>;

  beforeAll(async () => {
    fga = await startFakeOpenFga({
      storeId: 'stack-store',
      token: 'stack-openfga-token',
      tuples: [tuple(A)],
    });
    client = createClient(OpenFGAService, createGrpcTransport({ baseUrl: fga.url }));
  });
  afterAll(async () => {
    await fga.close();
  });

  it('allows a seeded tuple and denies an absent one', async () => {
    expect((await client.check({ storeId: 'stack-store', tupleKey: tuple(A) }, { headers: auth })).allowed).toBe(true);
    expect((await client.check({ storeId: 'stack-store', tupleKey: tuple(B) }, { headers: auth })).allowed).toBe(false);
    expect(fga.calls.at(-1)).toMatchObject({ user: `user:${B}`, allowed: false, relation: 'inventory_levels' });
  });

  it('writes and deletes tuples at runtime', async () => {
    fga.write(tuple(B));
    expect(fga.tuples()).toContainEqual(tuple(B));
    expect((await client.check({ storeId: 'stack-store', tupleKey: tuple(B) }, { headers: auth })).allowed).toBe(true);
    fga.remove(tuple(B));
    expect((await client.check({ storeId: 'stack-store', tupleKey: tuple(B) }, { headers: auth })).allowed).toBe(false);
  });

  it('refuses a wrong or missing preshared key as UNAUTHENTICATED', async () => {
    for (const headers of [{ authorization: 'Bearer nope' }, {}] as Array<Record<string, string>>) {
      const err = await client.check({ storeId: 'stack-store', tupleKey: tuple(A) }, { headers }).catch((e: unknown) => ConnectError.from(e));
      expect((err as ConnectError).code).toBe(Code.Unauthenticated);
    }
  });

  it('refuses an unknown store and a missing tuple key as INVALID_ARGUMENT', async () => {
    const wrongStore = await client.check({ storeId: 'other', tupleKey: tuple(A) }, { headers: auth }).catch((e: unknown) => ConnectError.from(e));
    expect((wrongStore as ConnectError).code).toBe(Code.InvalidArgument);
    const noKey = await client.check({ storeId: 'stack-store' }, { headers: auth }).catch((e: unknown) => ConnectError.from(e));
    expect((noKey as ConnectError).code).toBe(Code.InvalidArgument);
  });

  it('speaks HTTP/2 only, so an HTTP/1.1 client fails', async () => {
    const h1 = createClient(OpenFGAService, createConnectTransport({ baseUrl: fga.url, httpVersion: '1.1' }));
    await expect(h1.check({ storeId: 'stack-store', tupleKey: tuple(A) }, { headers: auth })).rejects.toThrow();
  });

  it('starts with no tuples by default', async () => {
    const empty = await startFakeOpenFga({ storeId: 's', token: 't' });
    expect(empty.tuples()).toEqual([]);
    await empty.close();
  });
});
