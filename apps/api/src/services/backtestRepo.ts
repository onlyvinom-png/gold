import type { BacktestSummary } from '@goldscope/shared';
import { query } from '../db/pool.js';

export interface StoredBacktestRun extends BacktestSummary {
  id: string;
}

export async function saveBacktestRun(summary: BacktestSummary): Promise<string> {
  const res = await query(
    `INSERT INTO backtest_runs (
      label, symbol, timeframe, range_start, range_end, sample_size,
      trades, wins, losses, unresolved, win_rate, average_r, expectancy,
      max_drawdown_r, total_fees, spread_assumption, slippage_assumption,
      in_sample, notes, generated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
    ) RETURNING id`,
    [
      summary.label,
      summary.symbol,
      summary.timeframe,
      summary.from,
      summary.to,
      summary.sampleSize,
      summary.trades,
      summary.wins,
      summary.losses,
      summary.unresolved,
      summary.winRate,
      summary.averageR,
      summary.expectancy,
      summary.maxDrawdownR,
      summary.totalFees,
      summary.spreadAssumption,
      summary.slippageAssumption,
      summary.inSample,
      JSON.stringify(summary.notes),
      summary.generatedAt,
    ],
  );
  return res.rows[0].id;
}

export async function listBacktestRuns(limit = 20): Promise<StoredBacktestRun[]> {
  const res = await query(
    `SELECT * FROM backtest_runs ORDER BY generated_at DESC LIMIT $1`,
    [limit],
  );
  return res.rows.map((r) => ({
    id: r.id,
    label: r.label,
    symbol: r.symbol,
    timeframe: r.timeframe,
    from: new Date(r.range_start).toISOString(),
    to: new Date(r.range_end).toISOString(),
    sampleSize: r.sample_size,
    trades: r.trades,
    wins: r.wins,
    losses: r.losses,
    unresolved: r.unresolved,
    winRate: r.win_rate === null ? null : Number(r.win_rate),
    averageR: r.average_r === null ? null : Number(r.average_r),
    expectancy: r.expectancy === null ? null : Number(r.expectancy),
    maxDrawdownR: r.max_drawdown_r === null ? null : Number(r.max_drawdown_r),
    totalFees: Number(r.total_fees),
    spreadAssumption: Number(r.spread_assumption),
    slippageAssumption: Number(r.slippage_assumption),
    inSample: r.in_sample,
    notes: r.notes ?? [],
    generatedAt: new Date(r.generated_at).toISOString(),
  }));
}
