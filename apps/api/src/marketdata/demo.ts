import type { Candle } from '@goldscope/shared';
import {
  MarketDataProvider,
  type CandleRequest,
  type ProviderDescriptor,
  type Quote,
} from './provider.js';

/**
 * DEMO / UNCONFIGURED provider.
 *
 * IMPORTANT: this provider produces DETERMINISTIC SYNTHETIC candles that are NOT
 * market data. They exist only so the platform can be started, demoed and tested
 * without any provider credentials. Every surface that uses them is labelled
 * DEMO / "بيانات تجريبية" and the feed status is never reported as LIVE.
 */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TF_SECONDS: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '2h': 7200,
  '4h': 14400,
  '1d': 86400,
};

export class DemoProvider implements MarketDataProvider {
  get descriptor(): ProviderDescriptor {
    return {
      name: 'demo',
      configured: false,
      volumeSemantics: 'synthetic_volume (generated fixture data — not real market volume)',
      documentation: 'Internal deterministic generator used when no market-data provider is configured.',
      rateLimitPerMinute: 1000,
      supportedSymbols: ['XAU/USD (simulated)'],
      updateFrequencySeconds: 60,
      cost: 'Free — no credentials required. Data is simulated.',
    };
  }

  async fetchCandles(req: CandleRequest): Promise<Candle[]> {
    const seconds = TF_SECONDS[req.timeframe] ?? 3600;
    const count = Math.max(10, Math.min(2000, req.limit));
    const rand = mulberry32(42);
    const now = Math.floor(Date.now() / 1000 / seconds) * seconds;
    const candles: Candle[] = [];
    let price = 2000 + rand() * 60;
    for (let i = count - 1; i >= 0; i -= 1) {
      const time = new Date((now - i * seconds) * 1000).toISOString();
      const drift = (rand() - 0.48) * price * 0.0025;
      const open = price;
      const close = Math.max(100, open + drift);
      const range = Math.max(0.2, open * (0.0008 + rand() * 0.0022));
      const high = Math.max(open, close) + range * rand();
      const low = Math.min(open, close) - range * rand();
      const volume = Math.round(200 + rand() * 1800);
      candles.push({
        time,
        open: Number(open.toFixed(2)),
        high: Number(high.toFixed(2)),
        low: Number(low.toFixed(2)),
        close: Number(close.toFixed(2)),
        volume,
      });
      price = close;
    }
    return candles;
  }

  async fetchQuote(symbol: string): Promise<Quote> {
    const candles = await this.fetchCandles({ symbol, timeframe: '1h', limit: 2 });
    const last = candles[candles.length - 1];
    return { symbol, price: last.close, time: last.time };
  }
}
