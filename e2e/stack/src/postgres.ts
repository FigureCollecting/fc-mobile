// Postgres on a glibc image with the locale pinned at initdb. The en_US.UTF-8
// default is a linguistic collation, so version ordering done in SQL without
// COLLATE "C" fails here instead of passing by accident; C.UTF-8 mirrors prod.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

export const DEFAULT_PG_IMAGE = 'postgres:17.11-trixie';
export const DEFAULT_PG_LOCALE = 'en_US.UTF-8';
export const DATABASE = 'fccoord';
export const MIGRATOR = 'fc_coordinator_migrator';
/** 0000_grants.sql names the app role literally, so this is not a choice. */
export const APP_ROLE = 'coordinator';
const MIGRATOR_PASSWORD = 'stack-migrator';
const APP_PASSWORD = 'stack-app';

export interface PostgresOptions {
  migrationsDir: string;
  /** Directory holding migrate.sh (the coordinator's scripts/). */
  scriptsDir: string;
  image?: string;
  locale?: string;
}

export interface LocaleReport {
  requested: string;
  collate: string;
  ctype: string;
  /** Whether 'B' < 'a', i.e. the database compares text bytewise. */
  bytewise: boolean;
}

export interface StackPostgres {
  image: string;
  databaseUrl: string;
  migratorUrl: string;
  locale: LocaleReport;
  migrateOutput: string;
  psql(sql: string, role: 'app' | 'migrator' | 'superuser'): Promise<string>;
  stop(): Promise<void>;
}

/** C and POSIX (with or without a codeset) are the bytewise collations. */
export function expectedBytewise(locale: string): boolean {
  return /^(C|POSIX)(\.|$)/.test(locale);
}

export async function startPostgres(options: PostgresOptions): Promise<StackPostgres> {
  const image = options.image ?? DEFAULT_PG_IMAGE;
  const locale = options.locale ?? DEFAULT_PG_LOCALE;
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(image)
    .withDatabase('bootstrap')
    .withUsername('postgres')
    .withPassword('postgres')
    .withEnvironment({ POSTGRES_INITDB_ARGS: `--locale=${locale} --encoding=UTF8`, LANG: locale })
    .withCopyDirectoriesToContainer([
      { source: options.migrationsDir, target: '/stack/migrations' },
      { source: options.scriptsDir, target: '/stack/scripts' },
    ])
    .start();

  const users = { app: APP_ROLE, migrator: MIGRATOR, superuser: 'postgres' } as const;
  const psql = async (sql: string, role: keyof typeof users, db = DATABASE): Promise<string> => {
    const run = await container.exec(['psql', '-U', users[role], '-d', db, '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql]);
    if (run.exitCode !== 0) throw new Error(`psql as ${role} failed: ${run.output.trim()}`);
    return run.stdout.trim();
  };

  try {
    await psql(`CREATE ROLE ${MIGRATOR} LOGIN PASSWORD '${MIGRATOR_PASSWORD}' NOSUPERUSER`, 'superuser', 'postgres');
    await psql(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}' NOSUPERUSER`, 'superuser', 'postgres');
    await psql(`CREATE DATABASE ${DATABASE} OWNER ${MIGRATOR}`, 'superuser', 'postgres');

    const [collate = '', ctype = ''] = (
      await psql(`SELECT datcollate || '|' || datctype FROM pg_database WHERE datname = current_database()`, 'superuser')
    ).split('|');
    const bytewise = (await psql(`SELECT 'B' < 'a'`, 'superuser')) === 't';
    if (collate !== locale || bytewise !== expectedBytewise(locale)) {
      throw new Error(
        `locale pin not in effect: ${image} reports ${collate} but compares ${bytewise ? 'bytewise' : 'linguistically'}`,
      );
    }

    const migrate = await container.exec(['sh', '/stack/scripts/migrate.sh', '/stack/migrations'], {
      env: { PGUSER: MIGRATOR, PGPASSWORD: MIGRATOR_PASSWORD, PGDATABASE: DATABASE },
    });
    if (migrate.exitCode !== 0) throw new Error(`migrate failed (exit ${migrate.exitCode}): ${migrate.output.trim()}`);

    const hostPort = `${container.getHost()}:${container.getMappedPort(5432)}`;
    return {
      image,
      databaseUrl: `postgres://${APP_ROLE}:${APP_PASSWORD}@${hostPort}/${DATABASE}`,
      migratorUrl: `postgres://${MIGRATOR}:${MIGRATOR_PASSWORD}@${hostPort}/${DATABASE}`,
      locale: { requested: locale, collate, ctype, bytewise },
      migrateOutput: migrate.output,
      psql: (sql, role) => psql(sql, role),
      stop: async () => {
        await container.stop();
      },
    };
  } catch (err) {
    await container.stop();
    throw err;
  }
}
