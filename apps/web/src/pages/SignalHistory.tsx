import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type SignalQuery } from '../lib/api';
import { useApp } from '../context/AppContext';
import {
  DirectionBadge,
  EmptyState,
  ErrorState,
  Loading,
  SectionTitle,
  SignalStatusBadge,
} from '../components/ui';
import { formatDateTime, formatNumber, formatPrice } from '../lib/format';
import type { Direction, Paginated, Signal, SignalStatus } from '@goldscope/shared';

const DIRECTIONS: Direction[] = ['BUY', 'SELL'];
const STATUSES: SignalStatus[] = [
  'OPEN',
  'TARGET_HIT',
  'STOP_HIT',
  'INVALIDATED',
  'EXPIRED',
  'UNRESOLVED',
];

export function SignalHistory() {
  const { t, lang } = useApp();
  const [data, setData] = useState<Paginated<Signal> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [direction, setDirection] = useState<'' | Direction>('');
  const [status, setStatus] = useState<'' | SignalStatus>('');
  const [timeframe, setTimeframe] = useState('');
  const [source, setSource] = useState<'' | 'forward' | 'backtest'>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const query = useMemo<SignalQuery>(() => {
    const q: SignalQuery = { page, pageSize: 25 };
    if (direction) q.direction = direction;
    if (status) q.status = status;
    if (timeframe) q.timeframe = timeframe;
    if (source) q.source = source;
    if (from) q.from = new Date(`${from}T00:00:00Z`).toISOString();
    if (to) q.to = new Date(`${to}T23:59:59Z`).toISOString();
    return q;
  }, [page, direction, status, timeframe, source, from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.signals(query));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  const reset = () => {
    setPage(1);
    setDirection('');
    setStatus('');
    setTimeframe('');
    setSource('');
    setFrom('');
    setTo('');
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-bold text-slate-100">{t.history.title}</h1>
        <p className="text-sm text-slate-400">
          {t.history.total}: {data?.total ?? 0}
        </p>
      </header>

      <section className="card card-pad">
        <SectionTitle>{t.history.filters}</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <label className="field">
            <span className="label">{t.history.direction}</span>
            <select
              className="input"
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value as '' | Direction);
                setPage(1);
              }}
            >
              <option value="">{t.common.all}</option>
              {DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="label">{t.history.status}</span>
            <select
              className="input"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as '' | SignalStatus);
                setPage(1);
              }}
            >
              <option value="">{t.common.all}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t.status[s]}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="label">{t.history.timeframe}</span>
            <input
              className="input"
              value={timeframe}
              placeholder="1h"
              onChange={(e) => {
                setTimeframe(e.target.value);
                setPage(1);
              }}
            />
          </label>

          <label className="field">
            <span className="label">{t.history.source}</span>
            <select
              className="input"
              value={source}
              onChange={(e) => {
                setSource(e.target.value as '' | 'forward' | 'backtest');
                setPage(1);
              }}
            >
              <option value="">{t.common.all}</option>
              <option value="forward">{t.signal.sourceForward}</option>
              <option value="backtest">{t.signal.sourceBacktest}</option>
            </select>
          </label>

          <label className="field">
            <span className="label">{t.history.from}</span>
            <input
              type="date"
              className="input"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          </label>

          <label className="field">
            <span className="label">{t.history.to}</span>
            <input
              type="date"
              className="input"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-ghost" onClick={reset}>
            {t.history.reset}
          </button>
          <button type="button" className="btn-ghost" onClick={() => void load()}>
            {t.common.refresh}
          </button>
        </div>
      </section>

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState title={t.history.empty} />
      ) : (
        <div className="space-y-2">
          {data.items.map((s) => (
            <Link
              key={s.id}
              to={`/signals/${s.id}`}
              className="card card-pad block transition hover:border-gold-500/40"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <DirectionBadge direction={s.direction} />
                  <SignalStatusBadge status={s.status} />
                  <span className="chip border-white/15 bg-white/5 text-slate-400">
                    {s.source === 'backtest' ? t.signal.sourceBacktest : t.signal.sourceForward}
                  </span>
                </div>
                <span className="text-[11px] text-slate-500">{formatDateTime(s.createdAt, lang)}</span>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
                <Cell label={t.signal.entry} value={formatPrice(s.entry)} />
                <Cell label={t.signal.sl} value={formatPrice(s.stopLoss)} tone="text-red-300" />
                <Cell label={t.signal.tp1} value={formatPrice(s.tp1)} tone="text-emerald-300" />
                <Cell label={t.signal.tp2} value={formatPrice(s.tp2)} tone="text-emerald-300" />
                <Cell label={t.signal.rr1} value={`${formatNumber(s.riskReward1)}R`} />
                <Cell
                  label={t.signal.realizedR}
                  value={s.realizedR === null ? '—' : `${formatNumber(s.realizedR)}R`}
                  tone={(s.realizedR ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}
                />
              </div>
            </Link>
          ))}
        </div>
      )}

      {data && data.total > 0 && (
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            className="btn-ghost"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ← {t.history.prev}
          </button>
          <span className="text-xs text-slate-400">
            {t.common.page} {data.page} {t.common.of} {totalPages}
          </span>
          <button
            type="button"
            className="btn-ghost"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t.history.next} →
          </button>
        </div>
      )}
    </div>
  );
}

function Cell({
  label,
  value,
  tone = 'text-slate-200',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className={`font-mono text-xs font-semibold ${tone}`} dir="ltr">
        {value}
      </p>
    </div>
  );
}

export default SignalHistory;
