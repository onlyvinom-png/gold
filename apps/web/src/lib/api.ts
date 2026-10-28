/**
 * Thin typed REST client for the GoldScope API.
 * The base URL is public configuration only — no secret ever reaches the browser.
 */
import type {
  BacktestSummary,
  Paginated,
  Signal,
  SignalStatus,
  FeedStatusInfo,
  Direction,
} from '@goldscope/shared';

const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    throw new ApiError(
      err instanceof Error ? `Network error: ${err.message}` : 'Network error',
      0,
    );
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text.slice(0, 300) };
    }
  }

  if (!res.ok) {
    const msg =
      (body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : null) ?? `HTTP ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  return body as T;
}

/* ------------------------------- response types ------------------------------ */

export interface HealthResponse {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  latencyMs: number;
  database: { ok: boolean; error: string | null };
  marketData: {
    provider: string;
    configured: boolean;
    mode: string;
    lastCandleTime: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    ageSeconds: number | null;
  };
  scheduler: SchedulerState;
  timestamp: string;
}

export interface SchedulerState {
  enabled: boolean;
  running: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
  lastRunDurationMs: number | null;
  lastRunStatus: string | null;
  lastRunMessage: string | null;
  consecutiveFailures: number;
}

export interface AnalysisRun {
  id: number;
  status: string;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  candles: number | null;
  decision: string | null;
  signalId: string | null;
  error: string | null;
  provider: string | null;
}

export interface DashboardResponse {
  instrument: string;
  timeframe: string;
  feed: FeedStatusInfo;
  activeSignal: Signal | null;
  openSignalCount: number;
  recentSignals: Signal[];
  recentRuns: AnalysisRun[];
  scheduler: SchedulerState;
  strategy: {
    valueAreaPercent: number;
    sessionStart: string;
    sessionEnd: string;
    timezone: string;
    profileLookbackDays: number;
    retestWindowCandles: number;
  };
  serverTime: string;
}

export interface SignalEvent {
  id: number;
  signalId: string;
  eventType: string;
  message: string | null;
  createdAt: string;
}

export interface SignalDetailResponse {
  signal: Signal;
  events: SignalEvent[];
}

export interface StrategyVersion {
  id: number;
  version: number;
  symbol: string;
  timeframe: string;
  timezone: string;
  sessionStart: string;
  sessionEnd: string;
  profileLookbackDays: number;
  valueAreaPercent: number;
  binSize: number | null;
  retestWindowCandles: number;
  retestZoneTicks: number;
  retestZoneAtrFraction: number;
  atrPeriod: number;
  atrFallbackEnabled: boolean;
  stopBufferTicks: number;
  stopBufferAtrFraction: number;
  maxStopAtr: number;
  minStopTicks: number;
  rrTarget1: number;
  rrTarget2: number;
  minRiskReward: number;
  entryType: string;
  pricePrecision: number;
  tickSize: number;
  riskPerTradePercent: number | null;
  maxSignalAgeMinutes: number;
  notes: string;
  createdAt: string;
}

export interface StrategyResponse {
  active: StrategyVersion;
  versions: StrategyVersion[];
  defaults: Record<string, unknown>;
}

export interface NotificationPreference {
  channel: 'email' | 'telegram';
  enabled: boolean;
  config: Record<string, unknown>;
  updatedAt?: string;
}

export interface Delivery {
  id: number;
  channel: string;
  signalId: string | null;
  status: string;
  error: string | null;
  createdAt: string;
}

export interface SettingsResponse {
  marketData: {
    provider: string;
    configured: boolean;
    volumeSemantics: string;
    documentation: string;
    rateLimitPerMinute: number;
    updateFrequencySeconds: number;
    cost: string;
    supportedSymbols: string[];
    envVarUsed: string;
  };
  strategy: StrategyVersion;
  notifications: NotificationPreference[];
  timezoneDefault: string;
  adminKeyConfigured: boolean;
}

export interface DiagnosticsResponse {
  database: { ok: boolean; error: string | null; remediation: string | null };
  marketData: {
    provider: string;
    configured: boolean;
    status: string;
    lastCandleTime: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    ageSeconds: number | null;
    remediation: string | null;
  };
  scheduler: SchedulerState;
  recentRuns: AnalysisRun[];
  recentDeliveries: Delivery[];
  recentBacktests: BacktestSummary[];
  serverTime: string;
  nodeVersion: string;
}

export interface SignalQuery {
  page?: number;
  pageSize?: number;
  direction?: Direction;
  status?: SignalStatus;
  timeframe?: string;
  source?: 'forward' | 'backtest';
  from?: string;
  to?: string;
}

/* --------------------------------- endpoints -------------------------------- */

export const api = {
  health: () => request<HealthResponse>('/health'),
  dashboard: () => request<DashboardResponse>('/dashboard'),
  signals: (query: SignalQuery = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, String(value));
      }
    }
    const qs = params.toString();
    return request<Paginated<Signal>>(`/signals${qs ? `?${qs}` : ''}`);
  },
  signal: (id: string) => request<SignalDetailResponse>(`/signals/${id}`),
  strategy: () => request<StrategyResponse>('/strategy'),
  settings: () => request<SettingsResponse>('/settings'),
  notifications: () => request<{ items: NotificationPreference[] }>('/notifications/preferences'),
  deliveries: () => request<{ items: Delivery[] }>('/notifications/deliveries'),
  diagnostics: () => request<DiagnosticsResponse>('/diagnostics'),
  notify: (id: string, channel: 'email' | 'telegram') =>
    request<{ status: string; error?: string | null }>(`/signals/${id}/notify`, {
      method: 'POST',
      body: JSON.stringify({ channel }),
    }),
  runAnalysis: () =>
    request<{ decision: string; reason: string }>('/analysis/run', { method: 'POST' }),
};
