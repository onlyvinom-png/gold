import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: env.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => logger.error('db pool error', { message: err.message }));

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  const started = Date.now();
  try {
    const res = await pool.query<T>(text, params);
    logger.debug('db query', { ms: Date.now() - started, rows: res.rowCount });
    return res;
  } catch (err) {
    logger.error('db query failed', { message: (err as Error).message, text: text.slice(0, 120) });
    throw err;
  }
}

export async function checkDatabase(): Promise<{ ok: boolean; message: string; latencyMs: number }> {
  const started = Date.now();
  try {
    await pool.query('SELECT 1');
    return { ok: true, message: 'connected', latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      message: (err as Error).message,
      latencyMs: Date.now() - started,
    };
  }
}
