import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { DemoProvider } from './demo.js';
import { MarketDataProvider } from './provider.js';
import { TwelveDataProvider } from './twelvedata.js';

let active: MarketDataProvider | null = null;

/** Factory: choose the configured provider. Falls back to DEMO mode. */
export function getProvider(): MarketDataProvider {
  if (active) return active;
  const name = (env.MARKET_DATA_PROVIDER || 'demo').toLowerCase();
  if (name === 'twelvedata' && env.TWELVEDATA_API_KEY) {
    active = new TwelveDataProvider(env.TWELVEDATA_API_KEY);
  } else {
    if (name !== 'demo') {
      logger.warn('market data provider not available, falling back to DEMO mode', {
        requested: name,
        reason: !env.TWELVEDATA_API_KEY ? 'TWELVEDATA_API_KEY missing' : 'unknown provider',
      });
    }
    active = new DemoProvider();
  }
  logger.info('market data provider selected', {
    provider: active.descriptor.name,
    configured: active.descriptor.configured,
  });
  return active;
}

export function setProvider(provider: MarketDataProvider): void {
  active = provider;
}

export * from './provider.js';
export { DemoProvider } from './demo.js';
export { TwelveDataProvider } from './twelvedata.js';
