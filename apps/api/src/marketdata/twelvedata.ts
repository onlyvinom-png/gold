import type { Candle } from '@goldscope/shared';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { zonedTimeToUtc } from '../utils/time.js';
import {
  MarketDataProvider,
  ProviderError,
  type CandleRequest,
  type ProviderDescriptor,
  type Quote,
  normalizeCandles,
} from './provider.js';

const BASE_URL = 'https://api.twelvedata.com';

/**
 * Twelve Data adapter (https://twelvedata.com).
 *
 * - XAU/USD (and XAU/USD spot metals) are available on paid and free plans
 *   depending on plan/region; the free plan is limited (credits per minute/day
 *   and no real-time streaming for some symbols).
 * - Timestamps returned by the provider are in the EXCHANGE timezone reported by
 *   `meta.exchange_timezone`; we convert them to UTC.
 * - `volume` for FX/spot metals is TICK VOLUME (number of ticks), NOT real
 *   exchange-traded volume. Volume Profile values are therefore approximate.
 */
export class TwelveDataProvider implements MarketDataProvider {
  private lastRequestTimes: number[] = [];
  private readonly rateLimit: number;

  constructor(private readonly apiKey: string | undefined = env.TWELVEDATA_API_KEY) {
    this.rateLimit = env.MARKET_DATA_RATE_LIMIT_PER_MINUTE;
  }

  get descriptor(): ProviderDescriptor {
    return {
      name: 'twelvedata',
      configured: Boolean(this.apiKey),
      volumeSemantics: 'tick_volume (provider tick count for FX/spot metals, not exchange volume)',
      documentation: 'https://twelvedata.com/docs#time-series',
      rateLimitPerMinute: this.rateLimit,
      supportedSymbols: ['XAU/USD', 'XAU/USD spot', 'OANDA:XAUUSD'],
      updateFrequencySeconds: 60,
      cost: 'Free tier: 8 API credits/minute, 800/day (limits may change — check twelvedata.com pricing)',
    };
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    this.lastRequestTimes = this.lastRequestTimes.filter((t) => now - t < 60_000);
    if (this.lastRequestTimes.length >= this.rateLimit) {
      const wait = 60_000 - (now - this.lastRequestTimes[0]) + 250;
      logger.warn('provider rate limit reached, waiting', { waitMs: wait });
      await new Promise((r) => setTimeout(r, wait));
    }
    this.lastRequestTimes.push(Date.now());
  }

  private async request(path: string, params: Record<string, string>): Promise<any> {
    if (!this.apiKey) {
      throw new ProviderError('TWELVEDATA_API_KEY is not configured.', false, 401);
    }
    const url = new URL(`${BASE_URL}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('apikey', this.apiKey);

    let lastError: unknown;
    for (let attempt = 0; attempt <= env.MARKET_DATA_RETRIES; attempt += 1) {
      await this.throttle();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), env.MARKET_DATA_TIMEOUT_MS);
      try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (res.status === 429) {
          const retryAfter = Number(res.headers.get('retry-after') ?? '5');
          logger.warn('provider rate limited (429)', { attempt, retryAfter });
          if (attempt < env.MARKET_DATA_RETRIES) {
            await new Promise((r) => setTimeout(r, retryAfter * 1000));
            continue;
          }
          throw new ProviderError('Provider rate limit exceeded (HTTP 429).', true, 429);
        }
        if (res.status === 401 || res.status === 403) {
          const body = await res.text();
          throw new ProviderError(`Provider rejected the API key (HTTP ${res.status}).`, false, res.status);
        }
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new ProviderError(`Provider HTTP ${res.status}: ${body.slice(0, 200)}`, res.status >= 500, res.status);
        }
        const json: any = await res.json();
        if (json && typeof json.status === 'string' && json.status !== 'ok') {
          const message = json.message ?? 'unknown provider error';
          const retryable = /limit|busy|try again|temporarily/i.test(message);
          throw new ProviderError(`Provider error: ${message}`, retryable, 400);
        }
        return json;
      } catch (err) {
        clearTimeout(timer);
        lastError = err;
        if (err instanceof ProviderError && err.retryable && attempt < env.MARKET_DATA_RETRIES) {
          const backoff = 500 * 2 ** attempt;
          logger.warn('provider retry', { attempt, backoff, message: err.message });
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        if (err instanceof Error && err.name === 'AbortError') {
          if (attempt < env.MARKET_DATA_RETRIES) continue;
          throw new ProviderError('Provider request timed out.', true, 408);
        }
        throw err;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new ProviderError('Provider request failed.', true);
  }

  async fetchCandles(req: CandleRequest): Promise<Candle[]> {
    const json = await this.request('/time_series', {
      symbol: req.symbol,
      interval: req.timeframe,
      outputsize: String(Math.min(5000, Math.max(1, req.limit))),
    });
    const values: any[] = Array.isArray(json?.values) ? json.values : [];
    if (values.length === 0) {
      throw new ProviderError('Provider returned no candle values.', false);
    }
    const tz = json?.meta?.exchange_timezone || 'UTC';
    const candles: Candle[] = [];
    for (const v of values) {
      const parsed = parseProviderDateTime(String(v.datetime), tz);
      if (!parsed) continue;
      candles.push({
        time: parsed.toISOString(),
        open: Number(v.open),
        high: Number(v.high),
        low: Number(v.low),
        close: Number(v.close),
        volume: Number(v.volume ?? 0),
      });
    }
    const { candles: normalized, issues } = normalizeCandles(candles);
    if (issues.length) logger.warn('candle normalization issues', { issues: issues.slice(0, 5) });
    return normalized;
  }

  async fetchQuote(symbol: string): Promise<Quote> {
    const json = await this.request('/quote', { symbol, interval: '1min' });
    const price = Number(json?.close ?? json?.price);
    if (!Number.isFinite(price)) {
      throw new ProviderError('Provider quote did not contain a usable price.', false);
    }
    const tz = json?.meta?.exchange_timezone || 'UTC';
    const parsed = parseProviderDateTime(String(json?.timestamp ?? ''), tz);
    return { symbol, price, time: parsed ? parsed.toISOString() : null };
  }
}

/** Parse "YYYY-MM-DD HH:mm:ss" (provider/exchange timezone) into a UTC Date. */
export function parseProviderDateTime(value: string, timezone: string): Date | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const [, y, mo, d, h, mi, s] = m;
  const utc = zonedTimeToUtc(Number(y), Number(mo), Number(d), Number(h) * 60 + Number(mi), timezone);
  if (s) utc.setUTCSeconds(Number(s));
  return utc;
}
