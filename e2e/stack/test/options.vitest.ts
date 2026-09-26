import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readStackState } from '../src/client.js';
import { STACK_ROOT } from '../src/paths.js';
import { chooseWire, DEFAULT_PORT_BASE, optionsFromEnv, planStack } from '../src/stack.js';

describe('stack options from FC_STACK_* variables', () => {
  it('is empty when nothing is set', () => {
    expect(optionsFromEnv({})).toEqual({});
  });

  it('reads every supported variable', () => {
    expect(
      optionsFromEnv({
        FC_STACK_PORT_BASE: '9480',
        FC_STACK_CATALOG_SIZE: '300',
        FC_STACK_WEB_DIST: '/d',
        FC_STACK_WEB_IMAGE: 'fc-mobile-web:local',
        FC_STACK_NGINX_CONF: '/n.conf',
        FC_STACK_PG_IMAGE: 'postgres:17.11-bookworm',
        FC_STACK_PG_LOCALE: 'C.UTF-8',
        FC_STACK_STATE_DIR: '/s',
        FC_STACK_SPINE_WIRE: 'h2c',
      }),
    ).toEqual({
      portBase: 9480,
      catalogSize: 300,
      webDist: '/d',
      webImage: 'fc-mobile-web:local',
      nginxConf: '/n.conf',
      pgImage: 'postgres:17.11-bookworm',
      pgLocale: 'C.UTF-8',
      stateDir: '/s',
      spineWire: 'h2c',
    });
  });

  it('ignores empty strings and an unknown wire', () => {
    expect(optionsFromEnv({ FC_STACK_WEB_IMAGE: '', FC_STACK_SPINE_WIRE: 'h3' })).toEqual({});
  });
});

describe('state file', () => {
  it('reads nothing when no stack is up', () => {
    expect(readStackState(mkdtempSync(path.join(tmpdir(), 'stack-none-')))).toBeUndefined();
  });
});

describe('stack plan', () => {
  it('lays out fixed ports from the base, a localhost origin and repo-local dirs', () => {
    const plan = planStack({});
    expect(plan.ports).toEqual({ edge: 8480, issuer: 8481, coordinator: 8482, spineH2c: 8483, spineH1: 8484, openfga: 8485, control: 8489 });
    expect(DEFAULT_PORT_BASE).toBe(8480);
    expect(plan.origin).toBe('http://localhost:8480');
    expect(plan.stateDir).toBe(path.join(STACK_ROOT, '.state'));
    expect(plan.cacheDir).toBe(path.join(STACK_ROOT, 'node_modules', '.cache', 'fc-mobile-stack'));
    expect(typeof plan.log).toBe('function');
  });

  it('honours overrides', () => {
    const log = (): void => undefined;
    const plan = planStack({ portBase: 9000, stateDir: '/s', cacheDir: '/c', log });
    expect(plan.ports.control).toBe(9009);
    expect(plan.origin).toBe('http://localhost:9000');
    expect(plan).toMatchObject({ stateDir: '/s', cacheDir: '/c', log });
  });

  it('prints through console.log by default', () => {
    const lines: unknown[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => lines.push(args.join(' '));
    try {
      planStack({}).log('hello');
    } finally {
      console.log = original;
    }
    expect(lines).toEqual(['[stack] hello']);
  });

  it('chooses the spine wire explicitly or from the checkout', () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'stack-wire-'));
    expect(chooseWire('h1', empty)).toBe('h1');
    expect(chooseWire('h2c', empty)).toBe('h2c');
    expect(chooseWire('auto', empty)).toBe('h2c');
    expect(chooseWire(undefined, empty)).toBe('h2c');
  });
});
