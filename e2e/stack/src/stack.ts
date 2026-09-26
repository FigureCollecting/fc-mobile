// Starts the stack in dependency order and tears down whatever started if a
// later piece fails. The state file is the contract with other processes:
// Playwright workers read URLs and the control API from it.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildCatalog, DEFAULT_CATALOG_SEED, type Catalog } from './catalog.js';
import {
  coordinatorEnv,
  detectSpineWire,
  prepareCheckout,
  refuseIfPortHeld,
  resolveCheckout,
  rotateLog,
  startCoordinator,
  type Checkout,
  type CoordinatorProcess,
  type Env,
} from './coordinator.js';
import { startControl, type Control } from './control.js';
import { startEdge, type Edge } from './edge.js';
import { generateEntitlementKey } from './entitlement.js';
import { CACHE_DIR, REPO_ROOT, STACK_ROOT } from './paths.js';
import { startMockIssuer, USER_A, USER_B, type MockIssuer, type StackUser } from './issuer.js';
import { startFakeOpenFga, type FakeOpenFga } from './openfga.js';
import { identifyProcess } from './procs.js';
import { startPostgres, type LocaleReport, type StackPostgres } from './postgres.js';
import { startFakeSpine, type FakeSpine } from './spine.js';
import { startWeb, type StackWeb } from './web.js';

export const DEFAULT_PORT_BASE = 8480;
export const OPENFGA_STORE_ID = '01JSTACKSTORE000000000000000';
export const INVENTORY_OBJECT = 'app:figurecollecting';

export interface StackOptions {
  portBase?: number;
  stateDir?: string;
  cacheDir?: string;
  webDist?: string;
  webImage?: string;
  nginxConf?: string;
  coordinatorDir?: string;
  coordinatorRef?: string;
  coordinatorEnv?: Record<string, string>;
  spineWire?: 'h2c' | 'h1' | 'auto';
  pgImage?: string;
  pgLocale?: string;
  catalogSize?: number;
  /** Users entitled to inventory_levels in the fake OpenFGA. Default: user A only. */
  entitled?: string[];
  log?: (line: string) => void;
}

export interface StackState {
  pid: number;
  /** processStartTime(pid) when this file was written; guards `stack:down` against a reused pid. */
  startTime: number;
  origin: string;
  controlUrl: string;
  issuer: {
    issuer: string;
    clientId: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    revocationEndpoint: string;
    userinfoEndpoint: string;
    endSessionEndpoint: string;
    jwksUri: string;
  };
  users: StackUser[];
  coordinator: { url: string; dir: string; source: Checkout['source']; ref?: string; spineWire: 'h2c' | 'h1' };
  spine: { h2cUrl: string; h1Url: string };
  openfga: { url: string; storeId: string };
  web: { url: string; image: string };
  postgres: { databaseUrl: string; migratorUrl: string; image: string; locale: LocaleReport };
  catalog: { size: number; seed: number; file: string };
  logs: { coordinator: string };
}

export interface Stack {
  state: StackState;
  stateFile: string;
  catalog: Catalog;
  issuer: MockIssuer;
  spine: FakeSpine;
  openfga: FakeOpenFga;
  postgres: StackPostgres;
  web: StackWeb;
  coordinator: CoordinatorProcess;
  edge: Edge;
  control: Control;
  /** Start the web container again after a stop and repoint the edge at its new port. */
  startWeb(): Promise<void>;
  stop(): Promise<void>;
}

/** Stack options from FC_STACK_* variables; explicit options win. */
export function optionsFromEnv(env: Env = process.env): StackOptions {
  const out: StackOptions = {};
  const num = (key: string): number | undefined => (env[key] === undefined ? undefined : Number(env[key]));
  const portBase = num('FC_STACK_PORT_BASE');
  if (portBase !== undefined) out.portBase = portBase;
  const size = num('FC_STACK_CATALOG_SIZE');
  if (size !== undefined) out.catalogSize = size;
  const text: Array<[keyof StackOptions, string]> = [
    ['webDist', 'FC_STACK_WEB_DIST'],
    ['webImage', 'FC_STACK_WEB_IMAGE'],
    ['nginxConf', 'FC_STACK_NGINX_CONF'],
    ['pgImage', 'FC_STACK_PG_IMAGE'],
    ['pgLocale', 'FC_STACK_PG_LOCALE'],
    ['stateDir', 'FC_STACK_STATE_DIR'],
  ];
  for (const [option, key] of text) {
    const value = env[key];
    if (value !== undefined && value !== '') (out as Record<string, unknown>)[option] = value;
  }
  const wire = env['FC_STACK_SPINE_WIRE'];
  if (wire === 'h2c' || wire === 'h1' || wire === 'auto') out.spineWire = wire;
  return out;
}

export interface StackPlan {
  ports: { edge: number; issuer: number; coordinator: number; spineH2c: number; spineH1: number; openfga: number; control: number };
  origin: string;
  stateDir: string;
  cacheDir: string;
  log: (line: string) => void;
}

/** Ports, directories and the public origin, before anything starts. */
export function planStack(options: StackOptions): StackPlan {
  const base = options.portBase ?? DEFAULT_PORT_BASE;
  return {
    ports: { edge: base, issuer: base + 1, coordinator: base + 2, spineH2c: base + 3, spineH1: base + 4, openfga: base + 5, control: base + 9 },
    origin: `http://localhost:${base}`,
    stateDir: options.stateDir ?? path.join(STACK_ROOT, '.state'),
    cacheDir: options.cacheDir ?? CACHE_DIR,
    log: options.log ?? ((line: string) => console.log(`[stack] ${line}`)),
  };
}

/** Where the running coordinator's process group is recorded, for `stack:down` after a crash. */
export function coordinatorPidFile(stateDir: string): string {
  return path.join(stateDir, 'coordinator.pid');
}

/** Fetch and install the coordinator checkout the stack would run (`cli.ts checkout`). */
export function prepareCoordinator(options: StackOptions): Checkout {
  const { cacheDir, log } = planStack(options);
  const checkout = resolveCheckout({ dir: options.coordinatorDir, ref: options.coordinatorRef }, process.env, cacheDir);
  log(`coordinator checkout: ${checkout.dir} (${checkout.source === 'ref' ? checkout.ref : 'directory'})`);
  prepareCheckout(checkout);
  return checkout;
}

/** The spine wire to hand the coordinator: explicit, or read from its spine client. */
export function chooseWire(option: StackOptions['spineWire'], dir: string): 'h2c' | 'h1' {
  return option === undefined || option === 'auto' ? detectSpineWire(dir) : option;
}

export async function startStack(options: StackOptions = {}): Promise<Stack> {
  const { ports, origin, stateDir, cacheDir, log } = planStack(options);
  mkdirSync(path.join(stateDir, 'logs'), { recursive: true });
  const coordinatorLog = path.join(stateDir, 'logs', 'coordinator.log');
  // Before anything else starts: the previous run's log moves to .1 instead of
  // being lost, and a held coordinator port fails here rather than after the
  // checkout and the containers are up.
  rotateLog(coordinatorLog);
  await refuseIfPortHeld(ports.coordinator);
  const cleanups: Array<() => Promise<void>> = [];
  const teardown = async (): Promise<void> => {
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch (err) {
        log(`teardown: ${(err as Error).message}`);
      }
    }
    cleanups.length = 0;
  };

  try {
    const checkout = prepareCoordinator({ ...options, cacheDir, log });
    const ref = checkout.source === 'ref' ? checkout.ref : undefined;
    const wire = chooseWire(options.spineWire, checkout.dir);

    const catalog = buildCatalog({ size: options.catalogSize });
    const catalogFile = path.join(stateDir, 'catalog.json');
    writeFileSync(
      catalogFile,
      JSON.stringify({
        heads: catalog.heads.map((p) => ({
          headId: p.productId,
          name: p.display.name,
          gtin14s: p.identifiers.flatMap((i) => (i.gtin14 === null ? [] : [i.gtin14])),
          mfcId: p.identifiers.find((i) => i.site === 'mfc')?.value,
        })),
        merged: catalog.merged.map((m) => ({ productId: m.productId, redirectTo: m.redirectTo, headId: catalog.resolveHead(m.productId) })),
        holdings: catalog.holdings,
      }),
    );

    log('postgres: starting');
    const postgres = await startPostgres({
      migrationsDir: path.join(checkout.dir, 'migrations'),
      scriptsDir: path.join(checkout.dir, 'scripts'),
      image: options.pgImage,
      locale: options.pgLocale,
    });
    cleanups.push(() => postgres.stop());
    log(`postgres: ${postgres.image} ${postgres.locale.collate} (bytewise=${String(postgres.locale.bytewise)})`);

    const entitlementKey = generateEntitlementKey('ent-stack');
    const issuer = await startMockIssuer({
      port: ports.issuer,
      redirectUris: [`${origin}/callback`, 'http://localhost:5173/callback'],
      allowedOrigins: [origin, 'http://localhost:5173'],
    });
    cleanups.push(() => issuer.close());
    const spine = await startFakeSpine({ catalog, keys: entitlementKey.keys, h2cPort: ports.spineH2c, h1Port: ports.spineH1 });
    cleanups.push(() => spine.close());
    const openfgaToken = 'stack-openfga-preshared';
    const openfga = await startFakeOpenFga({
      port: ports.openfga,
      storeId: OPENFGA_STORE_ID,
      token: openfgaToken,
      tuples: (options.entitled ?? [USER_A.sub]).map((sub) => ({ user: `user:${sub}`, relation: 'inventory_levels', object: INVENTORY_OBJECT })),
    });
    cleanups.push(() => openfga.close());

    log('web: starting');
    const web = await startWeb({
      dist: options.webDist ?? path.join(REPO_ROOT, 'dist'),
      image: options.webImage,
      nginxConf: options.nginxConf,
    });
    cleanups.push(() => web.stop());

    log(`coordinator: starting (spine wire ${wire})`);
    const coordinator = await startCoordinator({
      dir: checkout.dir,
      port: ports.coordinator,
      logFile: coordinatorLog,
      pidFile: coordinatorPidFile(stateDir),
      log,
      env: coordinatorEnv({
        port: ports.coordinator,
        databaseUrl: postgres.databaseUrl,
        issuer: issuer.issuer,
        audience: issuer.clientId,
        jwksUri: issuer.jwksUri,
        origin,
        spineUrl: { h2c: spine.h2cUrl, h1: spine.h1Url }[wire],
        openfga: { url: openfga.url, storeId: OPENFGA_STORE_ID, token: openfgaToken },
        entitlement: { pem: entitlementKey.privatePem, kid: entitlementKey.kid },
        extra: options.coordinatorEnv,
      }),
    });
    cleanups.push(() => coordinator.stop());

    const edge = await startEdge({ port: ports.edge, coordinator: coordinator.url, web: web.url });
    cleanups.push(() => edge.close());

    const stateFile = path.join(stateDir, 'stack.json');
    const state: StackState = {
      pid: process.pid,
      startTime: identifyProcess(process.pid)?.startTime ?? -1,
      origin,
      controlUrl: `http://127.0.0.1:${ports.control}`,
      issuer: {
        issuer: issuer.issuer,
        clientId: issuer.clientId,
        authorizationEndpoint: issuer.authorizationEndpoint,
        tokenEndpoint: issuer.tokenEndpoint,
        revocationEndpoint: issuer.revocationEndpoint,
        userinfoEndpoint: issuer.userinfoEndpoint,
        endSessionEndpoint: issuer.endSessionEndpoint,
        jwksUri: issuer.jwksUri,
      },
      users: [USER_A, USER_B],
      coordinator: {
        url: coordinator.url,
        dir: checkout.dir,
        source: checkout.source,
        ref,
        spineWire: wire,
      },
      spine: { h2cUrl: spine.h2cUrl, h1Url: spine.h1Url },
      openfga: { url: openfga.url, storeId: OPENFGA_STORE_ID },
      web: { url: web.url, image: web.image },
      postgres: { databaseUrl: postgres.databaseUrl, migratorUrl: postgres.migratorUrl, image: postgres.image, locale: postgres.locale },
      catalog: { size: catalog.heads.length, seed: DEFAULT_CATALOG_SEED, file: catalogFile },
      logs: { coordinator: coordinatorLog },
    };

    let stopping: Promise<void> | undefined;
    const stack: Stack = {
      state,
      stateFile,
      catalog,
      issuer,
      spine,
      openfga,
      postgres,
      web,
      coordinator,
      edge,
      control: undefined as unknown as Control,
      startWeb: async () => {
        await web.start();
        edge.setUpstream('web', web.url);
        state.web.url = web.url;
      },
      stop: () => {
        stopping ??= (async () => {
          await teardown();
          rmSync(stateFile, { force: true });
          log('stopped');
        })();
        return stopping;
      },
    };
    stack.control = await startControl(stack, ports.control);
    cleanups.push(() => stack.control.close());
    writeFileSync(stateFile, JSON.stringify(state, null, 2));
    log(`up: ${origin} (control ${state.controlUrl})`);
    return stack;
  } catch (err) {
    await teardown();
    throw err;
  }
}
