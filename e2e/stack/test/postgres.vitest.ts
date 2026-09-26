import { mkdtempSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectedBytewise, startPostgres, type StackPostgres } from '../src/postgres.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'coordinator');
const migrations = { migrationsDir: path.join(FIXTURE, 'migrations'), scriptsDir: path.join(FIXTURE, 'scripts') };

describe('locale expectation', () => {
  it.each([
    ['C', true],
    ['C.UTF-8', true],
    ['POSIX', true],
    ['en_US.UTF-8', false],
    ['de_DE.UTF-8', false],
  ])('%s compares bytewise: %s', (locale, bytewise) => {
    expect(expectedBytewise(locale)).toBe(bytewise);
  });
});

describe('stack Postgres (testcontainers, glibc image, pinned locale)', () => {
  let pg: StackPostgres;

  beforeAll(async () => {
    pg = await startPostgres(migrations);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('pins en_US.UTF-8 by default and proves the collation is linguistic, not bytewise', () => {
    expect(pg.image).toMatch(/^postgres:17\.\d+-trixie$/);
    expect(pg.locale).toEqual({ requested: 'en_US.UTF-8', collate: 'en_US.UTF-8', ctype: 'en_US.UTF-8', bytewise: false });
  });

  it('runs the migrations as the non-superuser owner and grants the app role its rows', async () => {
    expect(pg.migrateOutput).toContain('applied=2');
    expect(await pg.psql('INSERT INTO probe VALUES ($$v1$$) RETURNING version', 'app')).toBe('v1');
    expect(await pg.psql('SELECT rolsuper FROM pg_roles WHERE rolname = current_user', 'migrator')).toBe('f');
    expect(await pg.psql('SELECT current_user', 'app')).toBe('coordinator');
  });

  it('surfaces a failing statement with the role that ran it', async () => {
    await expect(pg.psql('CREATE TABLE app_ddl (i int)', 'app')).rejects.toThrow(/psql as app failed: .*permission denied/);
  });

  it('hands out a DATABASE_URL for the app role on the mapped port', () => {
    const url = new URL(pg.databaseUrl);
    expect(url.username).toBe('coordinator');
    expect(url.pathname).toBe('/fccoord');
    expect(Number(url.port)).toBeGreaterThan(0);
  });
});

describe('stack Postgres locale guard', () => {
  it('reports bytewise comparison under C.UTF-8, the prod pg-spine locale', async () => {
    const pg = await startPostgres({ ...migrations, locale: 'C.UTF-8' });
    try {
      expect(pg.locale).toMatchObject({ collate: 'C.UTF-8', bytewise: true });
    } finally {
      await pg.stop();
    }
  });

  it('refuses an image whose libc ignores the requested collation (musl)', async () => {
    await expect(startPostgres({ ...migrations, image: 'postgres:17-alpine' })).rejects.toThrow(/locale pin not in effect/);
  });

  it('fails loudly when a migration fails', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'stack-mig-'));
    cpSync(migrations.migrationsDir, dir, { recursive: true });
    writeFileSync(path.join(dir, '0002_broken.sql'), 'CREATE TABLE probe (x int);\n');
    await expect(startPostgres({ ...migrations, migrationsDir: dir })).rejects.toThrow(/migrate failed/);
  });
});
