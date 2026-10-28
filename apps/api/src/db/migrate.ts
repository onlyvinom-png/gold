import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';
import { logger } from '../utils/logger.js';

function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, '../migrations'), resolve(here, '../../src/migrations')];
  for (const c of candidates) {
    try {
      readdirSync(c);
      return c;
    } catch {
      /* keep looking */
    }
  }
  throw new Error('migrations directory not found');
}

export async function runMigrations(): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

  const dir = migrationsDir();
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(
    (await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  );
  const executed: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      executed.push(file);
      logger.info('migration applied', { file });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      logger.error('migration failed', { file, message: (err as Error).message });
      throw err;
    } finally {
      client.release();
    }
  }
  return executed;
}

const isDirect = process.argv[1] && resolve(process.argv[1]).endsWith(resolve('src/db/migrate.ts'));
if (isDirect) {
  runMigrations()
    .then((files) => {
      logger.info('migrations complete', { applied: files.length });
      return pool.end();
    })
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
