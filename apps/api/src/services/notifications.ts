import type { Signal } from '@goldscope/shared';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { logger } from '../utils/logger.js';
import { addSignalEvent } from './signalRepo.js';

export type NotifyChannel = 'email' | 'telegram';

export interface NotificationPrefs {
  channel: NotifyChannel;
  enabled: boolean;
  config: Record<string, unknown>;
  /** true when the required credentials are present */
  ready: boolean;
  missing: string[];
}

export interface DeliveryResult {
  channel: NotifyChannel;
  status: 'SENT' | 'SKIPPED' | 'FAILED';
  error?: string;
}

function emailReady(): string[] {
  const missing: string[] = [];
  if (!env.SMTP_HOST) missing.push('SMTP_HOST');
  if (!env.SMTP_USER) missing.push('SMTP_USER');
  if (!env.SMTP_PASSWORD) missing.push('SMTP_PASSWORD');
  if (!env.SMTP_FROM) missing.push('SMTP_FROM');
  if (!env.NOTIFY_EMAIL_TO) missing.push('NOTIFY_EMAIL_TO');
  return missing;
}

function telegramReady(): string[] {
  const missing: string[] = [];
  if (!env.TELEGRAM_BOT_TOKEN) missing.push('TELEGRAM_BOT_TOKEN');
  if (!env.TELEGRAM_CHAT_ID) missing.push('TELEGRAM_CHAT_ID');
  return missing;
}

export async function listPreferences(): Promise<NotificationPrefs[]> {
  const res = await query('SELECT * FROM notification_preferences ORDER BY channel');
  const rows = res.rows;
  const channels: NotifyChannel[] = ['email', 'telegram'];
  const out: NotificationPrefs[] = [];
  for (const channel of channels) {
    const row = rows.find((r) => r.channel === channel);
    const missing = channel === 'email' ? emailReady() : telegramReady();
    out.push({
      channel,
      enabled: row ? row.enabled : false,
      config: row ? row.config : {},
      ready: missing.length === 0,
      missing,
    });
  }
  return out;
}

export async function setPreference(
  channel: NotifyChannel,
  enabled: boolean,
  config: Record<string, unknown> = {},
): Promise<NotificationPrefs> {
  await query(
    `INSERT INTO notification_preferences (channel, enabled, config, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (channel) DO UPDATE SET enabled = EXCLUDED.enabled, config = EXCLUDED.config, updated_at = NOW()`,
    [channel, enabled, JSON.stringify(config)],
  );
  const prefs = await listPreferences();
  return prefs.find((p) => p.channel === channel)!;
}

function formatSignalMessage(signal: Signal): string {
  const dir = signal.direction === 'BUY' ? 'شراء' : 'sell';
  return [
    `GoldScope AI — ${signal.direction} XAUUSD`,
    `Instrument: ${signal.instrument} (${signal.timeframe})`,
    `Entry: ${signal.entry}`,
    `SL: ${signal.stopLoss}`,
    `TP1: ${signal.tp1} (R:R ${signal.riskReward1})`,
    `TP2: ${signal.tp2} (R:R ${signal.riskReward2})`,
    `VAH: ${signal.vah ?? '—'} / POC: ${signal.poc ?? '—'} / VAL: ${signal.val ?? '—'}`,
    `Created: ${signal.createdAt}`,
    `Analysis only — this is not investment advice and no order is placed.`,
    `Direction: ${dir}`,
  ].join('\n');
}

/**
 * Deliver a signal notification through the given channel.
 * Duplicate deliveries for the same (signal, channel) are prevented by the
 * UNIQUE constraint on notification_deliveries — a second attempt is skipped.
 */
export async function deliverSignal(
  signal: Signal,
  channel: NotifyChannel,
): Promise<DeliveryResult> {
  const missing = channel === 'email' ? emailReady() : telegramReady();
  if (missing.length > 0) {
    await recordDelivery(signal.id, channel, 'SKIPPED', `Missing configuration: ${missing.join(', ')}`, 0);
    return { channel, status: 'SKIPPED', error: `Missing configuration: ${missing.join(', ')}` };
  }

  const existing = await query(
    'SELECT id FROM notification_deliveries WHERE signal_id = $1 AND channel = $2',
    [signal.id, channel],
  );
  if (existing.rows.length > 0) {
    return { channel, status: 'SKIPPED', error: 'Already delivered for this signal.' };
  }

  try {
    if (channel === 'email') await sendEmail(signal);
    else await sendTelegram(signal);
    await recordDelivery(signal.id, channel, 'SENT', null, 1);
    await addSignalEvent(signal.id, 'NOTIFIED', `Notification delivered via ${channel}.`, { channel });
    return { channel, status: 'SENT' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('notification delivery failed', { channel, signalId: signal.id, message });
    await recordDelivery(signal.id, channel, 'FAILED', message, 1);
    await addSignalEvent(signal.id, 'NOTIFICATION_FAILED', `Delivery via ${channel} failed: ${message}`, {
      channel,
    });
    return { channel, status: 'FAILED', error: message };
  }
}

async function recordDelivery(
  signalId: string,
  channel: string,
  status: string,
  error: string | null,
  attempts: number,
): Promise<void> {
  await query(
    `INSERT INTO notification_deliveries (signal_id, channel, target, status, error, attempts)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (signal_id, channel) DO UPDATE
       SET status = EXCLUDED.status, error = EXCLUDED.error, attempts = notification_deliveries.attempts + 1`,
    [signalId, channel, channel === 'email' ? env.NOTIFY_EMAIL_TO ?? '' : env.TELEGRAM_CHAT_ID ?? '', status, error, attempts],
  );
}

async function sendEmail(signal: Signal): Promise<void> {
  const nodemailer = await import('nodemailer');
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  });
  await transport.sendMail({
    from: env.SMTP_FROM,
    to: env.NOTIFY_EMAIL_TO,
    subject: `GoldScope AI: ${signal.direction} XAUUSD @ ${signal.entry}`,
    text: formatSignalMessage(signal),
  });
}

async function sendTelegram(signal: Signal): Promise<void> {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text: formatSignalMessage(signal),
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Telegram HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
}

export async function listDeliveries(limit = 50) {
  const res = await query(
    `SELECT d.*, s.direction, s.instrument, s.timeframe
     FROM notification_deliveries d
     LEFT JOIN signals s ON s.id = d.signal_id
     ORDER BY d.created_at DESC LIMIT $1`,
    [limit],
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    signalId: r.signal_id,
    channel: r.channel,
    target: r.target,
    status: r.status,
    error: r.error,
    attempts: r.attempts,
    direction: r.direction,
    instrument: r.instrument,
    timeframe: r.timeframe,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}
