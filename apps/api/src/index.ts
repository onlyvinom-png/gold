import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { router } from './routes/index.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';
import { getProvider } from './marketdata/index.js';

export function createApp(): express.Express {
  const app = express();
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((o) => o.trim()),
      credentials: false,
    }),
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));

  app.use((req, _res, next) => {
    logger.debug('http request', { method: req.method, path: req.path });
    next();
  });

  app.get('/', (_req, res) => {
    res.json({
      name: 'GoldScope AI',
      description: 'XAUUSD analysis platform — Volume Profile + Break & Retest.',
      api: '/api',
      health: '/api/health',
    });
  });

  app.use('/api', router);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : 'Unexpected server error';
    logger.error('unhandled error', { message });
    res.status(500).json({ error: 'Internal server error', detail: message });
  });

  return app;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '');

if (isMain || process.env.START_SERVER === 'true') {
  const app = createApp();
  const provider = getProvider();
  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info('GoldScope AI API listening', {
      host: env.HOST,
      port: env.PORT,
      provider: provider.descriptor.name,
      providerConfigured: provider.descriptor.configured,
      mode: provider.descriptor.configured ? 'LIVE/DELAYED' : 'DEMO',
    });
    if (!provider.descriptor.configured) {
      logger.warn(
        'DEMO MODE: no market-data credentials configured. Prices are simulated and clearly labelled. Set TWELVEDATA_API_KEY for real data.',
      );
    }
    startScheduler();
  });

  const shutdown = (signal: string) => {
    logger.info('shutting down', { signal });
    stopScheduler();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
