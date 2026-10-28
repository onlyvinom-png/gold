import type { Paginated, Signal, SignalEvidence } from '@goldscope/shared';
import { query } from '../db/pool.js';

function mapRow(row: any): Signal {
  const evidence = (row.evidence ?? {}) as SignalEvidence;
  return {
    id: row.id,
    direction: row.direction,
    status: row.status,
    instrument: row.instrument,
    timeframe: row.timeframe,
    signalKey: row.signal_key,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    entry: Number(row.entry),
    observedPrice: Number(row.observed_price),
    stopLoss: Number(row.stop_loss),
    tp1: Number(row.tp1),
    tp2: Number(row.tp2),
    riskReward1: Number(row.risk_reward1),
    riskReward2: Number(row.risk_reward2),
    atr: row.atr === null ? null : Number(row.atr),
    atrPeriod: row.atr_period,
    profileRangeStart: new Date(row.profile_range_start).toISOString(),
    profileRangeEnd: new Date(row.profile_range_end).toISOString(),
    poc: row.poc === null ? null : Number(row.poc),
    vah: row.vah === null ? null : Number(row.vah),
    val: row.val === null ? null : Number(row.val),
    breakoutCandleTime: row.breakout_candle_time
      ? new Date(row.breakout_candle_time).toISOString()
      : null,
    retestCandleTime: row.retest_candle_time
      ? new Date(row.retest_candle_time).toISOString()
      : null,
    confirmationCandleTime: row.confirmation_candle_time
      ? new Date(row.confirmation_candle_time).toISOString()
      : null,
    reason: row.reason,
    invalidatedReason: row.invalidated_reason,
    resultPrice: row.result_price === null ? null : Number(row.result_price),
    realizedR: row.realized_r === null ? null : Number(row.realized_r),
    closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
    source: row.source,
    evidence,
  };
}

export interface SignalFilters {
  page: number;
  pageSize: number;
  direction?: 'BUY' | 'SELL';
  status?: string;
  timeframe?: string;
  source?: 'forward' | 'backtest';
  from?: string;
  to?: string;
}

export async function listSignals(filters: SignalFilters): Promise<Paginated<Signal>> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace('?', `$${params.length}`));
  };
  if (filters.direction) add('direction = ?', filters.direction);
  if (filters.status) add('status = ?', filters.status);
  if (filters.timeframe) add('timeframe = ?', filters.timeframe);
  if (filters.source) add('source = ?', filters.source);
  if (filters.from) add('created_at >= ?', filters.from);
  if (filters.to) add('created_at <= ?', filters.to);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await query(`SELECT COUNT(*)::int AS total FROM signals ${whereSql}`, params);
  const total = countRes.rows[0].total;
  const offset = (filters.page - 1) * filters.pageSize;
  const res = await query(
    `SELECT * FROM signals ${whereSql} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, filters.pageSize, offset],
  );
  return {
    items: res.rows.map(mapRow),
    total,
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

export async function getSignal(id: string): Promise<Signal | null> {
  const res = await query('SELECT * FROM signals WHERE id = $1', [id]);
  return res.rows.length ? mapRow(res.rows[0]) : null;
}

export async function getSignalByKey(signalKey: string): Promise<Signal | null> {
  const res = await query('SELECT * FROM signals WHERE signal_key = $1', [signalKey]);
  return res.rows.length ? mapRow(res.rows[0]) : null;
}

export async function insertSignal(signal: Omit<Signal, 'id' | 'createdAt' | 'updatedAt'>): Promise<Signal | null> {
  const res = await query(
    `INSERT INTO signals (
      signal_key, direction, status, instrument, timeframe,
      entry, observed_price, stop_loss, tp1, tp2, risk_reward1, risk_reward2,
      atr, atr_period, profile_range_start, profile_range_end, poc, vah, val,
      breakout_candle_time, retest_candle_time, confirmation_candle_time,
      reason, invalidated_reason, result_price, realized_r, closed_at, source, evidence
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
    )
    ON CONFLICT (signal_key) DO NOTHING
    RETURNING *`,
    [
      signal.signalKey,
      signal.direction,
      signal.status,
      signal.instrument,
      signal.timeframe,
      signal.entry,
      signal.observedPrice,
      signal.stopLoss,
      signal.tp1,
      signal.tp2,
      signal.riskReward1,
      signal.riskReward2,
      signal.atr,
      signal.atrPeriod,
      signal.profileRangeStart,
      signal.profileRangeEnd,
      signal.poc,
      signal.vah,
      signal.val,
      signal.breakoutCandleTime,
      signal.retestCandleTime,
      signal.confirmationCandleTime,
      signal.reason,
      signal.invalidatedReason,
      signal.resultPrice,
      signal.realizedR,
      signal.closedAt,
      signal.source,
      JSON.stringify(signal.evidence),
    ],
  );
  return res.rows.length ? mapRow(res.rows[0]) : null;
}

export async function updateSignalStatus(
  id: string,
  status: string,
  extra: { resultPrice?: number | null; realizedR?: number | null; reason?: string } = {},
): Promise<void> {
  await query(
    `UPDATE signals SET status = $2,
       result_price = COALESCE($3, result_price),
       realized_r = COALESCE($4, realized_r),
       invalidated_reason = COALESCE($5, invalidated_reason),
       closed_at = CASE WHEN $2 = 'OPEN' THEN NULL ELSE NOW() END,
       updated_at = NOW()
     WHERE id = $1`,
    [id, status, extra.resultPrice ?? null, extra.realizedR ?? null, extra.reason ?? null],
  );
}

export async function addSignalEvent(
  signalId: string,
  eventType: string,
  detail: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  await query(
    'INSERT INTO signal_events (signal_id, event_type, detail, meta) VALUES ($1, $2, $3, $4)',
    [signalId, eventType, detail, JSON.stringify(meta)],
  );
}

export async function listSignalEvents(signalId: string) {
  const res = await query(
    'SELECT * FROM signal_events WHERE signal_id = $1 ORDER BY created_at ASC',
    [signalId],
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    eventType: r.event_type,
    detail: r.detail,
    meta: r.meta,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function listOpenSignals(): Promise<Signal[]> {
  const res = await query("SELECT * FROM signals WHERE status = 'OPEN' ORDER BY created_at ASC");
  return res.rows.map(mapRow);
}
