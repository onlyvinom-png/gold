import type { Candle } from '@goldscope/shared';
import { getProvider } from '../marketdata/index.js';
import { getActiveStrategy } from '../services/strategyRepo.js';
import { saveBacktestRun } from '../services/backtestRepo.js';
import { runBacktest, splitInOutOfSample, type BacktestConfig } from './backtest.js';
import { logger } from '../utils/logger.js';

/**
 * Backtest CLI.
 *
 * Usage:
 *   npm run backtest -- --limit 1000 --spread 0.20 --slippage 0.05 --fee 3
 *
 * It fetches real candles from the configured provider (or the labelled DEMO
 * provider when no credentials are set), runs the Volume Profile + Break & Retest
 * pipeline over that history and stores the resulting summaries in the database.
 * No performance numbers are invented: if there is not enough data the summary
 * says so explicitly.
 */
function arg(name: string, def: number): number {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return def;
  const value = Number(process.argv[idx + 1]);
  return Number.isFinite(value) ? value : def;
}

async function main(): Promise<void> {
  const strategy = await getActiveStrategy();
  const provider = getProvider();
  const limit = Math.max(200, Math.min(5000, arg('limit', 1000)));

  const candles: Candle[] = await provider.fetchCandles({
    symbol: strategy.symbol,
    timeframe: strategy.timeframe,
    limit,
  });

  if (candles.length < 60) {
    logger.warn('not enough candles to run a backtest', { count: candles.length });
  }

  const config: BacktestConfig = {
    symbol: strategy.symbol,
    timeframe: strategy.timeframe,
    timezone: strategy.timezone,
    sessionStart: strategy.sessionStart,
    sessionEnd: strategy.sessionEnd,
    profileLookbackDays: strategy.profileLookbackDays,
    valueAreaPercent: strategy.valueAreaPercent,
    binSize: strategy.binSize,
    retestWindowCandles: strategy.retestWindowCandles,
    retestZoneTicks: strategy.retestZoneTicks,
    retestZoneAtrFraction: strategy.retestZoneAtrFraction,
    atrPeriod: strategy.atrPeriod,
    atrFallbackEnabled: strategy.atrFallbackEnabled,
    stopBufferTicks: strategy.stopBufferTicks,
    stopBufferAtrFraction: strategy.stopBufferAtrFraction,
    maxStopAtr: strategy.maxStopAtr,
    minStopTicks: strategy.minStopTicks,
    rrTarget1: strategy.rrTarget1,
    rrTarget2: strategy.rrTarget2,
    minRiskReward: strategy.minRiskReward,
    entryType: strategy.entryType,
    pricePrecision: strategy.pricePrecision,
    tickSize: strategy.tickSize,
    spread: arg('spread', 0.2),
    slippage: arg('slippage', 0.05),
    fee: arg('fee', 0),
    maxHoldingCandles: Math.max(4, arg('maxHolding', 24)),
  };

  const result = runBacktest(candles, config);
  const split = splitInOutOfSample(result);

  const notes = [
    ...result.summary.notes,
    provider.descriptor.configured
      ? `Provider: ${provider.descriptor.name}.`
      : 'DEMO MODE: these candles are synthetic fixtures, NOT real market data. Results are not meaningful.',
  ];

  const inId = await saveBacktestRun({
    ...split.inSample.summary,
    label: 'backtest — in-sample',
    notes,
  });
  const outId = await saveBacktestRun({
    ...split.outOfSample.summary,
    label: 'backtest — out-of-sample',
    notes,
  });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        provider: provider.descriptor.name,
        providerConfigured: provider.descriptor.configured,
        candles: candles.length,
        inSample: { id: inId, ...split.inSample.summary },
        outOfSample: { id: outId, ...split.outOfSample.summary },
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('backtest failed', { message: (err as Error).message });
    process.exit(1);
  });
