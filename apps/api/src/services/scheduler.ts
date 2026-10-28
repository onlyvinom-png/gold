import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { logger } from '../utils/logger.js';
import { runAnalysis } from './analysis.js';
import { deliverSignal, listPreferences } from './notifications.js';
import { getSignalByKey } from './signalRepo.js';

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastRunAt: string | null = null;
let lastRunDurationMs: number | null = null;
let lastRunStatus: 'OK' | 'NO_TRADE' | 'ERROR' | 'SKIPPED' | null = null;
let lastRunMessage: string | null = null;
let consecutiveFailures = 0;
let schedulerStartedAt: string | null = null;

/**
 * ISO timestamp of the next scheduled analysis cycle.
 * The scheduler uses a fixed interval, so the next run is the last completed
 * run (or the scheduler start) plus one interval.
 */
function computeNextRunAt(): string | null {
  if (!timer || !env.SCHEDULER_ENABLED) return null;
  const base = lastRunAt ?? schedulerStartedAt;
  if (!base) return null;
  const next = new Date(base).getTime() + env.ANALYSIS_INTERVAL_MINUTES * 60_000;
  return new Date(next).toISOString();
}

export function getSchedulerState() {
  return {
    enabled: env.SCHEDULER_ENABLED,
    running,
    intervalMinutes: env.ANALYSIS_INTERVAL_MINUTES,
    lastRunAt,
    lastRunDurationMs,
    lastRunStatus,
    lastRunMessage,
    consecutiveFailures,
    nextRunAt: computeNextRunAt(),
  };
}

/**
 * One analysis cycle. Guarded so two cycles can never overlap:
 * if a cycle is still running the new one is skipped and recorded.
 */
export async function runCycle(trigger: 'scheduler' | 'manual' = 'scheduler'): Promise<void> {
  if (running) {
    logger.warn('analysis cycle skipped: previous cycle still running');
    await recordRun('SKIPPED', trigger, 0, null, 'Previous cycle still running.', null, 0, null);
    return;
  }
  running = true;
  const started = Date.now();
  const startedAt = new Date().toISOString();
  let duration = 0;
  try {
    const outcome = await runAnalysis({ trigger });
    duration = Date.now() - started;
    lastRunAt = startedAt;
    lastRunDurationMs = duration;
    if (outcome.result.decision === 'NO TRADE') {
      lastRunStatus = 'NO_TRADE';
      lastRunMessage = outcome.result.reason;
      await recordRun('NO_TRADE', trigger, duration, outcome.result.decision, outcome.result.reason, null, outcome.candles.length, outcome.providerName);
    } else {
      lastRunStatus = 'OK';
      lastRunMessage = `${outcome.result.direction} signal generated.`;
      const signalKey = outcome.result.signalKey;
      const signal = await getSignalByKey(signalKey);
      await recordRun('OK', trigger, duration, outcome.result.decision, outcome.result.reason, signal?.id ?? null, outcome.candles.length, outcome.providerName);
      if (signal) await notifyForSignal(signal.id);
    }
    consecutiveFailures = 0;
  } catch (err) {
    duration = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    consecutiveFailures += 1;
    lastRunAt = startedAt;
    lastRunDurationMs = duration;
    lastRunStatus = 'ERROR';
    lastRunMessage = message;
    logger.error('analysis cycle failed', { message });
    await recordRun('ERROR', trigger, duration, null, message, null, 0, null).catch(() => undefined);
    await logHealth('analysis', 'ERROR', message).catch(() => undefined);
  } finally {
    running = false;
  }
}

async function notifyForSignal(signalId: string): Promise<void> {
  const prefs = await listPreferences();
  const { getSignal } = await import('./signalRepo.js');
  const signal = await getSignal(signalId);
  if (!signal) return;
  for (const pref of prefs) {
    if (!pref.enabled) continue;
    if (!pref.ready) {
      logger.warn('notification channel enabled but not configured', { channel: pref.channel, missing: pref.missing });
      continue;
    }
    await deliverSignal(signal, pref.channel);
  }
}

async function recordRun(
  status: string,
  trigger: string,
  durationMs: number,
  decision: string | null,
  message: string | null,
  signalId: string | null,
  candles: number,
  provider: string | null,
): Promise<void> {
  try {
    await query(
      `INSERT INTO analysis_runs (status, trigger, started_at, finished_at, duration_ms, candles, decision, signal_id, error, provider)
       VALUES ($1, $2, NOW(), NOW(), $3, $4, $5, $6, $7, $8)`,
      [status, trigger, durationMs, candles, decision, signalId, status === 'ERROR' ? message : null, provider],
    );
  } catch (err) {
    logger.error('failed to record analysis run', { message: (err as Error).message });
  }
}

export async function logHealth(
  component: string,
  status: string,
  message: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    await query(
      'INSERT INTO system_health_events (component, status, message, details) VALUES ($1, $2, $3, $4)',
      [component, status, message, JSON.stringify(details)],
    );
  } catch (err) {
    logger.error('failed to record health event', { message: (err as Error).message });
  }
}

export function startScheduler(): void {
  if (!env.SCHEDULER_ENABLED) {
    logger.info('scheduler disabled by configuration');
    return;
  }
  if (timer) return;
  const intervalMs = env.ANALYSIS_INTERVAL_MINUTES * 60_000;
  logger.info('scheduler started', { intervalMinutes: env.ANALYSIS_INTERVAL_MINUTES });
  timer = setInterval(() => {
    void runCycle('scheduler');
  }, intervalMs);
  // first run shortly after start so the dashboard is populated quickly
  setTimeout(() => void runCycle('scheduler'), 5_000).unref?.();
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info('scheduler stopped');
  }
}

export async function listAnalysisRuns(limit = 25) {
  const res = await query(
    `SELECT id, status, trigger, started_at, finished_at, duration_ms, candles, decision, signal_id, error, provider
     FROM analysis_runs ORDER BY started_at DESC LIMIT $1`,
    [limit],
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    status: r.status,
    trigger: r.trigger,
    startedAt: new Date(r.started_at).toISOString(),
    finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    durationMs: r.duration_ms,
    candles: r.candles,
    decision: r.decision,
    signalId: r.signal_id,
    error: r.error,
    provider: r.provider,
  }));
}
