import type { StrategyConfig } from '@goldscope/shared';
import { query } from '../db/pool.js';

export const DEFAULT_STRATEGY: Omit<StrategyConfig, 'id' | 'version' | 'createdAt'> = {
  symbol: 'XAU/USD',
  timeframe: '1h',
  timezone: 'Africa/Casablanca',
  sessionStart: '00:00',
  sessionEnd: '23:59',
  profileLookbackDays: 1,
  valueAreaPercent: 70,
  binSize: null,
  retestWindowCandles: 6,
  retestZoneTicks: 0.1,
  retestZoneAtrFraction: 0.25,
  atrPeriod: 14,
  atrFallbackEnabled: false,
  stopBufferTicks: 0.05,
  stopBufferAtrFraction: 0.1,
  maxStopAtr: 2.5,
  minStopTicks: 0.1,
  rrTarget1: 1.5,
  rrTarget2: 3,
  minRiskReward: 1,
  entryType: 'confirmation_close',
  pricePrecision: 2,
  tickSize: 0.01,
  riskPerTradePercent: null,
  maxSignalAgeMinutes: 240,
  notes: 'Default configuration. Volume Profile + Break & Retest only.',
};

function mapRow(row: any): StrategyConfig {
  return {
    id: row.id,
    version: row.version,
    symbol: row.symbol,
    timeframe: row.timeframe,
    timezone: row.timezone,
    sessionStart: row.session_start,
    sessionEnd: row.session_end,
    profileLookbackDays: row.profile_lookback_days,
    valueAreaPercent: Number(row.value_area_percent),
    binSize: row.bin_size === null ? null : Number(row.bin_size),
    retestWindowCandles: row.retest_window_candles,
    retestZoneTicks: Number(row.retest_zone_ticks),
    retestZoneAtrFraction: Number(row.retest_zone_atr_fraction),
    atrPeriod: row.atr_period,
    atrFallbackEnabled: row.atr_fallback_enabled,
    stopBufferTicks: Number(row.stop_buffer_ticks),
    stopBufferAtrFraction: Number(row.stop_buffer_atr_fraction),
    maxStopAtr: Number(row.max_stop_atr),
    minStopTicks: Number(row.min_stop_ticks),
    rrTarget1: Number(row.rr_target1),
    rrTarget2: Number(row.rr_target2),
    minRiskReward: Number(row.min_risk_reward),
    entryType: row.entry_type,
    pricePrecision: row.price_precision,
    tickSize: Number(row.tick_size),
    riskPerTradePercent: row.risk_per_trade_percent === null ? null : Number(row.risk_per_trade_percent),
    maxSignalAgeMinutes: row.max_signal_age_minutes,
    notes: row.notes,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

const SELECT = `SELECT * FROM strategy_configs`;

export async function getActiveStrategy(): Promise<StrategyConfig> {
  const res = await query(`${SELECT} WHERE is_active = TRUE ORDER BY version DESC LIMIT 1`);
  if (res.rows.length > 0) return mapRow(res.rows[0]);
  return { id: 0, version: 0, createdAt: new Date(0).toISOString(), ...DEFAULT_STRATEGY };
}

export async function listStrategyVersions(): Promise<StrategyConfig[]> {
  const res = await query(`${SELECT} ORDER BY version DESC`);
  return res.rows.map(mapRow);
}

/** Insert a new version of the strategy configuration and activate it. */
export async function saveStrategy(
  patch: Partial<typeof DEFAULT_STRATEGY>,
  changedBy = 'admin',
): Promise<StrategyConfig> {
  const current = await getActiveStrategy();
  const next = { ...DEFAULT_STRATEGY, ...stripNulls(current), ...patch };
  const version = (current.version || 0) + 1;

  const res = await query(
    `INSERT INTO strategy_configs (
       version, is_active, symbol, timeframe, timezone, session_start, session_end,
       profile_lookback_days, value_area_percent, bin_size,
       retest_window_candles, retest_zone_ticks, retest_zone_atr_fraction,
       atr_period, atr_fallback_enabled,
       stop_buffer_ticks, stop_buffer_atr_fraction, max_stop_atr, min_stop_ticks,
       rr_target1, rr_target2, min_risk_reward, entry_type,
       price_precision, tick_size, risk_per_trade_percent, max_signal_age_minutes,
       notes, changed_by
     ) VALUES (
       $1, TRUE, $2, $3, $4, $5, $6,
       $7, $8, $9,
       $10, $11, $12,
       $13, $14,
       $15, $16, $17, $18,
       $19, $20, $21, $22,
       $23, $24, $25, $26,
       $27, $28
     )
     RETURNING *`,
    [
      version,
      next.symbol,
      next.timeframe,
      next.timezone,
      next.sessionStart,
      next.sessionEnd,
      next.profileLookbackDays,
      next.valueAreaPercent,
      next.binSize,
      next.retestWindowCandles,
      next.retestZoneTicks,
      next.retestZoneAtrFraction,
      next.atrPeriod,
      next.atrFallbackEnabled,
      next.stopBufferTicks,
      next.stopBufferAtrFraction,
      next.maxStopAtr,
      next.minStopTicks,
      next.rrTarget1,
      next.rrTarget2,
      next.minRiskReward,
      next.entryType,
      next.pricePrecision,
      next.tickSize,
      next.riskPerTradePercent,
      next.maxSignalAgeMinutes,
      next.notes,
      changedBy,
    ],
  );
  await query('UPDATE strategy_configs SET is_active = FALSE WHERE id <> $1', [res.rows[0].id]);
  return mapRow(res.rows[0]);
}

function stripNulls(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}
