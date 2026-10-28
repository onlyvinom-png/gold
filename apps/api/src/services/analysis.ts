import type {
  AnalysisResult,
  Candle,
  ConditionCheck,
  FeedStatusInfo,
  SignalEvidence,
} from '@goldscope/shared';
import { env } from '../config/env.js';
import { calculateAtr } from '../engine/atr.js';
import { detectBreakRetest } from '../engine/breakRetest.js';
import { computeRiskLevels } from '../engine/risk.js';
import { computeVolumeProfile } from '../engine/volumeProfile.js';
import { getProvider, ProviderError } from '../marketdata/index.js';
import { logger } from '../utils/logger.js';
import { getActiveStrategy } from './strategyRepo.js';
import { addSignalEvent, insertSignal } from './signalRepo.js';

export interface RunAnalysisOptions {
  trigger?: 'scheduler' | 'manual' | 'backtest';
  now?: Date;
}

export interface RunAnalysisOutcome {
  result: AnalysisResult;
  candles: Candle[];
  feed: FeedStatusInfo;
  providerName: string;
  durationMs: number;
  issues: string[];
}

/** Last successful provider fetch, used for the freshness indicator. */
const feedState = {
  lastCandleTime: null as string | null,
  lastSuccessAt: null as string | null,
  lastError: null as string | null,
  lastDurationMs: null as number | null,
};

export function getFeedState() {
  return { ...feedState };
}

export function resetFeedState() {
  feedState.lastCandleTime = null;
  feedState.lastSuccessAt = null;
  feedState.lastError = null;
  feedState.lastDurationMs = null;
}

/**
 * Run the full Volume Profile + Break & Retest analysis for the active strategy.
 * Returns either a BUY/SELL signal (persisted) or an explicit NO TRADE result.
 */
export async function runAnalysis(opts: RunAnalysisOptions = {}): Promise<RunAnalysisOutcome> {
  const started = Date.now();
  const now = opts.now ?? new Date();
  const provider = getProvider();
  const descriptor = provider.descriptor;
  const strategy = await getActiveStrategy();
  const issues: string[] = [];

  let candles: Candle[] = [];
  let feed: FeedStatusInfo;
  let fetchError: string | null = null;

  try {
    candles = await provider.fetchCandles({
      symbol: strategy.symbol,
      timeframe: strategy.timeframe,
      limit: 1000,
    });
    feedState.lastSuccessAt = now.toISOString();
    feedState.lastError = null;
    feedState.lastCandleTime = candles.length ? candles[candles.length - 1].time : null;
    feedState.lastDurationMs = Date.now() - started;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fetchError = message;
    feedState.lastError = message;
    logger.error('market data fetch failed', { message });
    feed = {
      status: 'UNAVAILABLE',
      provider: descriptor.name,
      providerConfigured: descriptor.configured,
      message,
      lastCandleTime: feedState.lastCandleTime,
      lastSuccessAt: feedState.lastSuccessAt,
      lastError: message,
      ageSeconds: null,
      timezone: strategy.timezone,
    };
    const result: AnalysisResult = {
      decision: 'NO TRADE',
      reason: `Market data unavailable: ${message}`,
      conditions: [
        {
          key: 'market_data',
          label: 'بيانات السوق متاحة',
          passed: false,
          detail: message,
        },
      ],
      instrument: strategy.symbol,
      timeframe: strategy.timeframe,
      profile: null,
      evaluatedAt: now.toISOString(),
      lastCandleTime: feedState.lastCandleTime,
      dataFreshnessSeconds: null,
    };
    return { result, candles, feed, providerName: descriptor.name, durationMs: Date.now() - started, issues };
  }

  if (candles.length === 0) {
    feed = buildFeed(descriptor, feedState, strategy.timezone, 'UNAVAILABLE', 'Provider returned no candles.');
    const result: AnalysisResult = {
      decision: 'NO TRADE',
      reason: 'No candles returned by the market-data provider.',
      conditions: [
        { key: 'market_data', label: 'بيانات السوق متاحة', passed: false, detail: 'Empty candle series.' },
      ],
      instrument: strategy.symbol,
      timeframe: strategy.timeframe,
      profile: null,
      evaluatedAt: now.toISOString(),
      lastCandleTime: null,
      dataFreshnessSeconds: null,
    };
    return { result, candles, feed, providerName: descriptor.name, durationMs: Date.now() - started, issues };
  }

  const lastCandleTime = candles[candles.length - 1].time;
  const ageSeconds = Math.max(0, Math.round((now.getTime() - new Date(lastCandleTime).getTime()) / 1000));
  const timeframeSeconds = estimateTimeframeSeconds(strategy.timeframe);
  const staleAfter = Math.max(env.DATA_MAX_AGE_SECONDS, timeframeSeconds * 3);

  const profile = computeVolumeProfile(candles, {
    timezone: strategy.timezone,
    sessionStart: strategy.sessionStart,
    sessionEnd: strategy.sessionEnd,
    lookbackDays: strategy.profileLookbackDays,
    valueAreaPercent: strategy.valueAreaPercent,
    binSize: strategy.binSize,
    tickSize: strategy.tickSize,
    pricePrecision: strategy.pricePrecision,
    now,
  });

  const atr = calculateAtr(candles, strategy.atrPeriod);
  const atrNote = atr === null
    ? `ATR(${strategy.atrPeriod}) could not be computed from ${candles.length} candles.`
    : '';

  const feedStatus = determineFeedStatus({
    configured: descriptor.configured,
    providerName: descriptor.name,
    ageSeconds,
    staleAfter,
    lastCandleTime,
    lastSuccessAt: feedState.lastSuccessAt,
    lastError: feedState.lastError,
    timezone: strategy.timezone,
  });
  feed = { ...feedStatus, message: feedStatus.message };

  const conditions: ConditionCheck[] = [];

  // Freshness gate
  if (ageSeconds > staleAfter) {
    conditions.push({
      key: 'data_freshness',
      label: 'حداثة البيانات',
      passed: false,
      detail: `Last candle is ${ageSeconds}s old (limit ${staleAfter}s).`,
    });
    const result: AnalysisResult = {
      decision: 'NO TRADE',
      reason: `Stale market data (${ageSeconds}s old).`,
      conditions,
      instrument: strategy.symbol,
      timeframe: strategy.timeframe,
      profile,
      evaluatedAt: now.toISOString(),
      lastCandleTime,
      dataFreshnessSeconds: ageSeconds,
    };
    return { result, candles, feed, providerName: descriptor.name, durationMs: Date.now() - started, issues };
  }
  conditions.push({
    key: 'data_freshness',
    label: 'حداثة البيانات',
    passed: true,
    detail: `Last candle ${ageSeconds}s old (limit ${staleAfter}s).`,
  });

  // OHLC consistency check
  const inconsistent = candles.filter(
    (c) => c.high < c.low || c.open > c.high || c.open < c.low || c.close > c.high || c.close < c.low,
  );
  if (inconsistent.length > 0) {
    issues.push(`${inconsistent.length} candle(s) with inconsistent OHLC values.`);
    conditions.push({
      key: 'data_consistency',
      label: 'اتساق بيانات الشموع',
      passed: false,
      detail: `${inconsistent.length} inconsistent candle(s) detected.`,
    });
    const result: AnalysisResult = {
      decision: 'NO TRADE',
      reason: 'Inconsistent candle data detected.',
      conditions,
      instrument: strategy.symbol,
      timeframe: strategy.timeframe,
      profile,
      evaluatedAt: now.toISOString(),
      lastCandleTime,
      dataFreshnessSeconds: ageSeconds,
    };
    return { result, candles, feed, providerName: descriptor.name, durationMs: Date.now() - started, issues };
  }
  conditions.push({
    key: 'data_consistency',
    label: 'اتساق بيانات الشموع',
    passed: true,
    detail: `${candles.length} candles validated (OHLC, order, duplicates).`,
  });

  // Break & Retest detection
  const br = detectBreakRetest(candles, profile, {
    retestWindowCandles: strategy.retestWindowCandles,
    retestZoneTicks: strategy.retestZoneTicks,
    retestZoneAtrFraction: strategy.retestZoneAtrFraction,
    atr,
  });
  conditions.push(...br.conditions);

  if (!br.found || !br.direction) {
    const result: AnalysisResult = {
      decision: 'NO TRADE',
      reason: br.failureReason ?? 'No valid Break & Retest setup.',
      conditions,
      instrument: strategy.symbol,
      timeframe: strategy.timeframe,
      profile,
      evaluatedAt: now.toISOString(),
      lastCandleTime,
      dataFreshnessSeconds: ageSeconds,
    };
    return { result, candles, feed, providerName: descriptor.name, durationMs: Date.now() - started, issues };
  }

  // Risk engine
  const confirmationIndex = br.confirmationIndex as number;
  const nextCandle = candles[confirmationIndex + 1] ?? null;
  const notes: string[] = [];
  if (atrNote) notes.push(atrNote);
  if (strategy.atrFallbackEnabled && atr !== null) notes.push('ATR stop fallback is ENABLED in the active configuration.');

  const risk = computeRiskLevels({
    direction: br.direction,
    confirmationClose: br.evidence.confirmationClose as number,
    nextBarOpen: nextCandle ? nextCandle.open : null,
    entryType: strategy.entryType,
    swingExtreme: br.swingExtreme,
    atr,
    atrPeriod: strategy.atrPeriod,
    atrFallbackEnabled: strategy.atrFallbackEnabled,
    stopBufferTicks: strategy.stopBufferTicks,
    stopBufferAtrFraction: strategy.stopBufferAtrFraction,
    maxStopAtr: strategy.maxStopAtr,
    minStopTicks: strategy.minStopTicks,
    rrTarget1: strategy.rrTarget1,
    rrTarget2: strategy.rrTarget2,
    minRiskReward: strategy.minRiskReward,
    tickSize: strategy.tickSize,
    pricePrecision: strategy.pricePrecision,
  });

  if (!risk.ok) {
    conditions.push({
      key: 'risk_levels',
      label: 'مستويات المخاطرة (Entry / SL / TP)',
      passed: false,
      detail: risk.reason,
    });
    const result: AnalysisResult = {
      decision: 'NO TRADE',
      reason: risk.reason,
      conditions,
      instrument: strategy.symbol,
      timeframe: strategy.timeframe,
      profile,
      evaluatedAt: now.toISOString(),
      lastCandleTime,
      dataFreshnessSeconds: ageSeconds,
    };
    return { result, candles, feed, providerName: descriptor.name, durationMs: Date.now() - started, issues };
  }

  conditions.push({
    key: 'risk_levels',
    label: 'مستويات المخاطرة (Entry / SL / TP)',
    passed: true,
    detail: `Entry ${risk.levels.entry}, SL ${risk.levels.stopLoss}, TP1 ${risk.levels.tp1} (R:R ${risk.levels.riskReward1})`,
  });
  if (risk.levels.stopLossBasis) notes.push(`Stop loss basis: ${risk.levels.stopLossBasis}.`);

  const evidence: SignalEvidence = {
    profile,
    breakout: br.evidence,
    conditions,
    risk: risk.levels,
    atr,
    atrPeriod: strategy.atrPeriod,
    lastCandleTime,
    dataFreshnessSeconds: ageSeconds,
    notes,
  };

  // Duplicate prevention: the signal key is derived from the structural
  // fingerprint of the setup (profile range + breakout/retest/confirmation times).
  const signalKey = [
    strategy.symbol,
    strategy.timeframe,
    br.direction,
    new Date(profile.rangeStart).toISOString(),
    br.evidence.breakoutCandleTime,
    br.evidence.retestCandleTime,
    br.evidence.confirmationCandleTime,
  ].join('|');

  const persisted = await insertSignal({
    direction: br.direction,
    status: 'OPEN',
    instrument: strategy.symbol,
    timeframe: strategy.timeframe,
    signalKey,
    entry: risk.levels.entry,
    observedPrice: risk.levels.observedPrice,
    stopLoss: risk.levels.stopLoss,
    tp1: risk.levels.tp1,
    tp2: risk.levels.tp2,
    riskReward1: risk.levels.riskReward1,
    riskReward2: risk.levels.riskReward2,
    atr: risk.levels.atr,
    atrPeriod: strategy.atrPeriod,
    profileRangeStart: profile.rangeStart,
    profileRangeEnd: profile.rangeEnd,
    poc: profile.poc?.price ?? null,
    vah: profile.vah?.binHigh ?? null,
    val: profile.val?.binLow ?? null,
    breakoutCandleTime: br.evidence.breakoutCandleTime,
    retestCandleTime: br.evidence.retestCandleTime,
    confirmationCandleTime: br.evidence.confirmationCandleTime,
    reason: buildReason(br.direction, risk.levels.entry, risk.levels.stopLoss, risk.levels.tp1, risk.levels.riskReward1),
    invalidatedReason: null,
    resultPrice: null,
    realizedR: null,
    closedAt: null,
    source: 'forward',
    evidence,
  });

  if (!persisted) {
    issues.push('Duplicate signal prevented (signal_key already exists).');
  } else {
    await addSignalEvent(
      persisted.id,
      'CREATED',
      `Signal created from ${br.direction} Break & Retest setup.`,
      { signalKey },
    );
  }

  const signal = persisted ?? {
    id: '',
    direction: br.direction,
    status: 'OPEN' as const,
    instrument: strategy.symbol,
    timeframe: strategy.timeframe,
    signalKey,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    entry: risk.levels.entry,
    observedPrice: risk.levels.observedPrice,
    stopLoss: risk.levels.stopLoss,
    tp1: risk.levels.tp1,
    tp2: risk.levels.tp2,
    riskReward1: risk.levels.riskReward1,
    riskReward2: risk.levels.riskReward2,
    atr: risk.levels.atr,
    atrPeriod: strategy.atrPeriod,
    profileRangeStart: profile.rangeStart,
    profileRangeEnd: profile.rangeEnd,
    poc: profile.poc?.price ?? null,
    vah: profile.vah?.binHigh ?? null,
    val: profile.val?.binLow ?? null,
    breakoutCandleTime: br.evidence.breakoutCandleTime,
    retestCandleTime: br.evidence.retestCandleTime,
    confirmationCandleTime: br.evidence.confirmationCandleTime,
    reason: 'Signal (not persisted: duplicate).',
    invalidatedReason: null,
    resultPrice: null,
    realizedR: null,
    closedAt: null,
    source: 'forward' as const,
    evidence,
  };

  const result: AnalysisResult = { decision: br.direction, ...signal };
  return { result, candles, feed, providerName: descriptor.name, durationMs: Date.now() - started, issues };
}

function buildReason(direction: string, entry: number, sl: number, tp1: number, rr: number): string {
  return `${direction} Break & Retest confirmed — Entry ${entry}, SL ${sl}, TP1 ${tp1}, Risk/Reward ${rr}.`;
}

function estimateTimeframeSeconds(timeframe: string): number {
  const map: Record<string, number> = {
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '30m': 1800,
    '1h': 3600,
    '2h': 7200,
    '4h': 14400,
    '1d': 86400,
  };
  return map[timeframe] ?? 3600;
}

function determineFeedStatus(args: {
  configured: boolean;
  providerName: string;
  ageSeconds: number;
  staleAfter: number;
  lastCandleTime: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  timezone: string;
}): FeedStatusInfo {
  const { configured, providerName, ageSeconds, staleAfter, lastCandleTime, lastSuccessAt, lastError, timezone } = args;
  if (!configured) {
    return {
      status: 'DEMO',
      provider: providerName,
      providerConfigured: false,
      message: 'DEMO mode: no market-data credentials configured. Prices are simulated, NOT live.',
      lastCandleTime,
      lastSuccessAt,
      lastError,
      ageSeconds,
      timezone,
    };
  }
  if (ageSeconds > staleAfter) {
    return {
      status: 'STALE',
      provider: providerName,
      providerConfigured: true,
      message: `Data is stale (${ageSeconds}s old).`,
      lastCandleTime,
      lastSuccessAt,
      lastError,
      ageSeconds,
      timezone,
    };
  }
  const delayThreshold = 120;
  const status = ageSeconds > delayThreshold ? 'DELAYED' : 'LIVE';
  return {
    status,
    provider: providerName,
    providerConfigured: true,
    message:
      status === 'LIVE'
        ? 'Provider data is current.'
        : `Provider data is delayed by about ${ageSeconds}s (typical for the free tier).`,
    lastCandleTime,
    lastSuccessAt,
    lastError,
    ageSeconds,
    timezone,
  };
}

function buildFeed(
  descriptor: { name: string; configured: boolean },
  state: typeof feedState,
  timezone: string,
  status: FeedStatusInfo['status'],
  message: string,
): FeedStatusInfo {
  return {
    status,
    provider: descriptor.name,
    providerConfigured: descriptor.configured,
    message,
    lastCandleTime: state.lastCandleTime,
    lastSuccessAt: state.lastSuccessAt,
    lastError: state.lastError,
    ageSeconds: null,
    timezone,
  };
}

export { ProviderError };
