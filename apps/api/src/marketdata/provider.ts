import type { Candle, FeedStatus } from '@goldscope/shared';

export interface CandleRequest {
  symbol: string;
  timeframe: string;
  limit: number;
}

export interface Quote {
  symbol: string;
  price: number;
  /** provider timestamp, UTC ISO */
  time: string | null;
}

export interface ProviderDescriptor {
  name: string;
  /** true when the provider can serve real market data with the current configuration */
  configured: boolean;
  /** documented volume semantics for this provider */
  volumeSemantics: string;
  documentation: string;
  rateLimitPerMinute: number;
  /** symbols the provider is documented to support */
  supportedSymbols: string[];
  /** how often the data updates, in seconds (best effort) */
  updateFrequencySeconds: number;
  cost: string;
}

export interface MarketDataProvider {
  readonly descriptor: ProviderDescriptor;
  fetchCandles(req: CandleRequest): Promise<Candle[]>;
  fetchQuote(symbol: string): Promise<Quote>;
}

/** Thrown when the provider reports a transient failure (retryable). */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface FeedSnapshot {
  status: FeedStatus;
  provider: string;
  providerConfigured: boolean;
  message: string;
  lastCandleTime: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  ageSeconds: number | null;
  timezone: string;
}

/**
 * Validate and normalize a raw candle series: sorted ascending, unique and
 * free of invalid prices, with gaps reported.
 */
export function normalizeCandles(
  raw: Candle[],
  options: { minGapFactor?: number } = {},
): { candles: Candle[]; issues: string[] } {
  const issues: string[] = [];
  const seen = new Map<string, Candle>();
  for (const c of raw) {
    const time = new Date(c.time);
    if (Number.isNaN(time.getTime())) {
      issues.push(`Invalid timestamp dropped: ${c.time}`);
      continue;
    }
    if (![c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0)) {
      issues.push(`Invalid prices dropped for candle at ${c.time}`);
      continue;
    }
    if (c.high < c.low || c.open > c.high || c.open < c.low || c.close > c.high || c.close < c.low) {
      issues.push(`Inconsistent OHLC dropped for candle at ${c.time}`);
      continue;
    }
    const key = time.toISOString();
    if (seen.has(key)) {
      issues.push(`Duplicate candle dropped at ${key}`);
      continue;
    }
    seen.set(key, {
      time: key,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: Number.isFinite(c.volume) && c.volume >= 0 ? c.volume : 0,
    });
  }
  const candles = [...seen.values()].sort((a, b) => a.time.localeCompare(b.time));

  const minGapFactor = options.minGapFactor ?? 2.5;
  for (let i = 1; i < candles.length; i += 1) {
    const prev = new Date(candles[i - 1].time).getTime();
    const cur = new Date(candles[i].time).getTime();
    const expected = timeframeSeconds(candles[i]) * 1000;
    if (expected > 0 && cur - prev > expected * minGapFactor) {
      issues.push(
        `Gap detected between ${candles[i - 1].time} and ${candles[i].time}`,
      );
    }
  }
  return { candles, issues };
}

/** Approximate timeframe duration in seconds (used for gap detection). */
export function timeframeSeconds(candle: Candle): number {
  const t = new Date(candle.time).getTime();
  const next = t + 3600_000;
  void next;
  // The caller may pass an explicit timeframe; default handled by provider specific logic.
  return 3600;
}
