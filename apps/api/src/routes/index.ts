import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { getProvider } from '../marketdata/index.js';
import { logger } from '../utils/logger.js';
import { getActiveStrategy, listStrategyVersions, saveStrategy } from '../services/strategyRepo.js';
import {
  getSignal,
  listSignalEvents,
  listSignals,
  listOpenSignals,
} from '../services/signalRepo.js';
import { getFeedState, runAnalysis } from '../services/analysis.js';
import {
  getSchedulerState,
  listAnalysisRuns,
  logHealth,
  runCycle,
} from '../services/scheduler.js';
import {
  deliverSignal,
  listDeliveries,
  listPreferences,
  setPreference,
} from '../services/notifications.js';
import { listBacktestRuns } from '../services/backtestRepo.js';
import { DEFAULT_STRATEGY } from '../services/strategyRepo.js';

export const router: Router = Router();

function adminOnly(req: Request, res: Response, next: NextFunction) {
  if (!env.ADMIN_API_KEY) return next();
  const key = req.header('x-admin-key') ?? req.query.adminKey;
  if (key !== env.ADMIN_API_KEY) {
    res.status(401).json({ error: 'Unauthorized: a valid x-admin-key header is required.' });
    return;
  }
  next();
}

const intParam = (name: string, def: number, max: number) =>
  z.coerce.number().int().min(1).max(max).catch(def).parse(0) || def;

/* ---------------------------------- health --------------------------------- */

router.get('/health', async (_req, res) => {
  const started = Date.now();
  let dbOk = false;
  let dbError: string | null = null;
  try {
    await query('SELECT 1');
    dbOk = true;
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }
  const provider = getProvider();
  const feed = getFeedState();
  const scheduler = getSchedulerState();
  const body = {
    status: dbOk ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    latencyMs: Date.now() - started,
    database: { ok: dbOk, error: dbError },
    marketData: {
      provider: provider.descriptor.name,
      configured: provider.descriptor.configured,
      mode: provider.descriptor.configured ? 'LIVE/DELAYED' : 'DEMO',
      lastCandleTime: feed.lastCandleTime,
      lastSuccessAt: feed.lastSuccessAt,
      lastError: feed.lastError,
      ageSeconds: feed.lastCandleTime
        ? Math.round((Date.now() - new Date(feed.lastCandleTime).getTime()) / 1000)
        : null,
    },
    scheduler,
    timestamp: new Date().toISOString(),
  };
  res.status(dbOk ? 200 : 503).json(body);
});

router.get('/health/freshness', (_req, res) => {
  const feed = getFeedState();
  const age = feed.lastCandleTime
    ? Math.round((Date.now() - new Date(feed.lastCandleTime).getTime()) / 1000)
    : null;
  const provider = getProvider();
  res.json({
    provider: provider.descriptor.name,
    configured: provider.descriptor.configured,
    lastCandleTime: feed.lastCandleTime,
    lastSuccessAt: feed.lastSuccessAt,
    lastError: feed.lastError,
    ageSeconds: age,
    maxAgeSeconds: env.DATA_MAX_AGE_SECONDS,
    stale: age === null ? true : age > env.DATA_MAX_AGE_SECONDS,
    timestamp: new Date().toISOString(),
  });
});

/* -------------------------------- dashboard -------------------------------- */

router.get('/dashboard', async (_req, res) => {
  const strategy = await getActiveStrategy();
  const provider = getProvider();
  const feed = getFeedState();
  const scheduler = getSchedulerState();
  const open = await listOpenSignals();
  const recent = await listSignals({ page: 1, pageSize: 5 });
  const runs = await listAnalysisRuns(10);
  const age = feed.lastCandleTime
    ? Math.round((Date.now() - new Date(feed.lastCandleTime).getTime()) / 1000)
    : null;

  const feedStatus = !provider.descriptor.configured
    ? 'DEMO'
    : feed.lastError
      ? 'UNAVAILABLE'
      : age === null
        ? 'UNAVAILABLE'
        : age > env.DATA_MAX_AGE_SECONDS
          ? 'STALE'
          : age > 120
            ? 'DELAYED'
            : 'LIVE';

  res.json({
    instrument: strategy.symbol,
    timeframe: strategy.timeframe,
    feed: {
      status: feedStatus,
      provider: provider.descriptor.name,
      providerConfigured: provider.descriptor.configured,
      message: feed.lastError
        ? `Provider error: ${feed.lastError}`
        : !provider.descriptor.configured
          ? 'DEMO mode — prices are simulated, not live market data.'
          : `Last candle ${age ?? 'n/a'}s old.`,
      lastCandleTime: feed.lastCandleTime,
      lastSuccessAt: feed.lastSuccessAt,
      ageSeconds: age,
    },
    activeSignal: open[0] ?? null,
    openSignalCount: open.length,
    recentSignals: recent.items,
    recentRuns: runs,
    scheduler,
    strategy: {
      valueAreaPercent: strategy.valueAreaPercent,
      sessionStart: strategy.sessionStart,
      sessionEnd: strategy.sessionEnd,
      timezone: strategy.timezone,
      profileLookbackDays: strategy.profileLookbackDays,
      retestWindowCandles: strategy.retestWindowCandles,
    },
    serverTime: new Date().toISOString(),
  });
});

/* --------------------------------- signals --------------------------------- */

const signalQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(25),
  direction: z.enum(['BUY', 'SELL']).optional(),
  status: z
    .enum(['OPEN', 'TARGET_HIT', 'STOP_HIT', 'INVALIDATED', 'EXPIRED', 'UNRESOLVED'])
    .optional(),
  timeframe: z.string().max(20).optional(),
  source: z.enum(['forward', 'backtest']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

router.get('/signals', async (req, res) => {
  const parsed = signalQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten().fieldErrors });
    return;
  }
  const q = parsed.data;
  const result = await listSignals({
    page: q.page,
    pageSize: q.pageSize,
    direction: q.direction,
    status: q.status,
    timeframe: q.timeframe,
    source: q.source,
    from: q.from,
    to: q.to,
  });
  res.json(result);
});

router.get('/signals/:id', async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: 'Invalid signal id.' });
    return;
  }
  const signal = await getSignal(id.data);
  if (!signal) {
    res.status(404).json({ error: 'Signal not found.' });
    return;
  }
  const events = await listSignalEvents(id.data);
  res.json({ signal, events });
});

router.get('/signals/:id/events', async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: 'Invalid signal id.' });
    return;
  }
  res.json({ items: await listSignalEvents(id.data) });
});

router.post('/signals/:id/notify', adminOnly, async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: 'Invalid signal id.' });
    return;
  }
  const channel = z.enum(['email', 'telegram']).safeParse(req.body?.channel);
  if (!channel.success) {
    res.status(400).json({ error: 'channel must be "email" or "telegram".' });
    return;
  }
  const signal = await getSignal(id.data);
  if (!signal) {
    res.status(404).json({ error: 'Signal not found.' });
    return;
  }
  const result = await deliverSignal(signal, channel.data);
  res.status(result.status === 'FAILED' ? 502 : 200).json(result);
});

/* -------------------------------- analysis --------------------------------- */

router.post('/analysis/run', adminOnly, async (_req, res) => {
  try {
    const outcome = await runAnalysis({ trigger: 'manual' });
    res.json({
      decision: outcome.result.decision,
      reason: 'reason' in outcome.result ? outcome.result.reason : '',
      result: outcome.result,
      feed: outcome.feed,
      issues: outcome.issues,
      durationMs: outcome.durationMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('manual analysis failed', { message });
    res.status(500).json({ error: message });
  }
});

router.post('/analysis/scheduler/run', adminOnly, async (_req, res) => {
  await runCycle('manual');
  res.json({ scheduler: getSchedulerState() });
});

/* -------------------------------- strategy --------------------------------- */

router.get('/strategy', async (_req, res) => {
  const active = await getActiveStrategy();
  const versions = await listStrategyVersions();
  res.json({ active, versions, defaults: DEFAULT_STRATEGY });
});

const strategyPatchSchema = z
  .object({
    symbol: z.string().min(2).max(20).optional(),
    timeframe: z.enum(['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d']).optional(),
    timezone: z.string().min(1).max(64).optional(),
    sessionStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    sessionEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    profileLookbackDays: z.number().int().min(1).max(30).optional(),
    valueAreaPercent: z.number().min(50).max(95).optional(),
    binSize: z.number().positive().max(1000).nullable().optional(),
    retestWindowCandles: z.number().int().min(1).max(50).optional(),
    retestZoneTicks: z.number().min(0).max(100).optional(),
    retestZoneAtrFraction: z.number().min(0).max(5).optional(),
    atrPeriod: z.number().int().min(2).max(100).optional(),
    atrFallbackEnabled: z.boolean().optional(),
    stopBufferTicks: z.number().min(0).max(100).optional(),
    stopBufferAtrFraction: z.number().min(0).max(5).optional(),
    maxStopAtr: z.number().min(0.1).max(20).optional(),
    minStopTicks: z.number().min(0).max(100).optional(),
    rrTarget1: z.number().min(0.1).max(20).optional(),
    rrTarget2: z.number().min(0.1).max(50).optional(),
    minRiskReward: z.number().min(0).max(20).optional(),
    entryType: z.enum(['confirmation_close', 'next_bar_open']).optional(),
    pricePrecision: z.number().int().min(0).max(8).optional(),
    tickSize: z.number().positive().max(100).optional(),
    riskPerTradePercent: z.number().min(0).max(100).nullable().optional(),
    maxSignalAgeMinutes: z.number().int().min(1).max(10080).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

router.put('/strategy', adminOnly, async (req, res) => {
  const parsed = strategyPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid strategy configuration', details: parsed.error.flatten().fieldErrors });
    return;
  }
  const saved = await saveStrategy(parsed.data, 'admin');
  res.json(saved);
});

/* -------------------------------- settings --------------------------------- */

router.get('/settings', async (_req, res) => {
  const provider = getProvider();
  const strategy = await getActiveStrategy();
  const prefs = await listPreferences();
  res.json({
    marketData: {
      provider: provider.descriptor.name,
      configured: provider.descriptor.configured,
      volumeSemantics: provider.descriptor.volumeSemantics,
      documentation: provider.descriptor.documentation,
      rateLimitPerMinute: provider.descriptor.rateLimitPerMinute,
      updateFrequencySeconds: provider.descriptor.updateFrequencySeconds,
      cost: provider.descriptor.cost,
      supportedSymbols: provider.descriptor.supportedSymbols,
      envVarUsed: 'TWELVEDATA_API_KEY',
    },
    strategy,
    notifications: prefs,
    timezoneDefault: 'Africa/Casablanca',
    adminKeyConfigured: Boolean(env.ADMIN_API_KEY),
  });
});

/* ------------------------------ notifications ------------------------------ */

router.get('/notifications/preferences', async (_req, res) => {
  res.json({ items: await listPreferences() });
});

router.put('/notifications/preferences', adminOnly, async (req, res) => {
  const parsed = z
    .object({
      channel: z.enum(['email', 'telegram']),
      enabled: z.boolean(),
      config: z.record(z.unknown()).optional(),
    })
    .safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid notification preferences payload.' });
    return;
  }
  const saved = await setPreference(parsed.data.channel, parsed.data.enabled, parsed.data.config ?? {});
  res.json(saved);
});

router.get('/notifications/deliveries', async (_req, res) => {
  res.json({ items: await listDeliveries(100) });
});

/* ------------------------------- diagnostics -------------------------------- */

router.get('/diagnostics', async (_req, res) => {
  const provider = getProvider();
  const feed = getFeedState();
  const scheduler = getSchedulerState();
  const runs = await listAnalysisRuns(25);
  const deliveries = await listDeliveries(25);
  const backtests = await listBacktestRuns(10);

  let dbOk = false;
  let dbError: string | null = null;
  try {
    await query('SELECT 1');
    dbOk = true;
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  const age = feed.lastCandleTime
    ? Math.round((Date.now() - new Date(feed.lastCandleTime).getTime()) / 1000)
    : null;

  res.json({
    database: {
      ok: dbOk,
      error: dbError,
      remediation: dbOk ? null : 'Check DATABASE_URL, that the PostgreSQL server is reachable, and that migrations have been applied.',
    },
    marketData: {
      provider: provider.descriptor.name,
      configured: provider.descriptor.configured,
      status: provider.descriptor.configured ? (feed.lastError ? 'UNAVAILABLE' : 'CONNECTED') : 'DEMO',
      lastCandleTime: feed.lastCandleTime,
      lastSuccessAt: feed.lastSuccessAt,
      lastError: feed.lastError,
      ageSeconds: age,
      remediation: provider.descriptor.configured
        ? null
        : 'Set TWELVEDATA_API_KEY and MARKET_DATA_PROVIDER=twelvedata to enable real market data.',
    },
    scheduler,
    recentRuns: runs,
    recentDeliveries: deliveries,
    recentBacktests: backtests,
    serverTime: new Date().toISOString(),
    nodeVersion: process.version,
  });
});

router.post('/diagnostics/health-event', adminOnly, async (req, res) => {
  const parsed = z
    .object({
      component: z.string().min(1).max(64),
      status: z.string().min(1).max(32),
      message: z.string().max(1000).optional(),
      details: z.record(z.unknown()).optional(),
    })
    .safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid health event payload.' });
    return;
  }
  await logHealth(
    parsed.data.component,
    parsed.data.status,
    parsed.data.message ?? '',
    parsed.data.details ?? {},
  );
  res.status(201).json({ ok: true });
});

export default router;
