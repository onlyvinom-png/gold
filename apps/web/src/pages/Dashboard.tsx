import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type DashboardResponse } from '../lib/api';
import { useApp } from '../context/AppContext';
import {
  DirectionBadge,
  ErrorState,
  FeedBadge,
  Loading,
  SectionTitle,
  SignalStatusBadge,
  Stat,
  WarningBanner,
} from '../components/ui';
import { TradingViewChart } from '../components/TradingViewChart';
import { formatAge, formatDateTime, formatNumber, formatPrice } from '../lib/format';

export function Dashboard() {
  const { t, lang } = useApp();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.dashboard());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!data) return <ErrorState message={t.common.error} onRetry={() => void load()} />;

  const { feed, activeSignal, scheduler } = data;
  const precision = 2;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">{t.dashboard.title}</h1>
          <p className="text-sm text-slate-400">
            <span dir="ltr" className="font-mono">
              {data.instrument.replace('/', '')}
            </span>{' '}
            · {t.dashboard.timeframe}: <span dir="ltr" className="font-mono">{data.timeframe}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <FeedBadge status={feed.status} />
          <button type="button" className="btn-ghost" onClick={() => void load()}>
            {t.common.refresh}
          </button>
        </div>
      </header>

      {feed.status === 'DEMO' && <WarningBanner>{t.feed.demoWarning}</WarningBanner>}
      {(feed.status === 'STALE' || feed.status === 'UNAVAILABLE') && (
        <WarningBanner>{feed.message}</WarningBanner>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t.dashboard.instrument} value={<span dir="ltr">{data.instrument}</span>} />
        <Stat
          label={t.dashboard.lastCandle}
          value={formatDateTime(feed.lastCandleTime, lang)}
          hint={feed.ageSeconds !== null ? formatAge(feed.ageSeconds) : undefined}
        />
        <Stat
          label={t.dashboard.lastSuccess}
          value={formatDateTime(feed.lastSuccessAt, lang)}
          hint={`${t.common.source}: ${feed.provider}`}
        />
        <Stat
          label={t.dashboard.openSignals}
          value={String(data.openSignalCount)}
          tone={data.openSignalCount > 0 ? 'gold' : 'default'}
        />
      </div>

      <section>
        <SectionTitle>{t.dashboard.marketOverview}</SectionTitle>
        <TradingViewChart
          symbol="OANDA:XAUUSD"
          interval={data.timeframe}
          height={420}
          theme={{ background: '#0d0f14', gridColor: '#1f2431' }}
        />
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{t.feed.chartNote}</p>
      </section>

      <section>
        <SectionTitle>{t.dashboard.activeSignal}</SectionTitle>
        {activeSignal ? (
          <article className="card card-pad" data-testid="active-signal">
            <div className="flex flex-wrap items-center gap-2">
              <DirectionBadge direction={activeSignal.direction} />
              <SignalStatusBadge status={activeSignal.status} />
              <span className="font-mono text-[11px] text-slate-500" dir="ltr">
                {activeSignal.id}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label={t.signal.entry} value={formatPrice(activeSignal.entry, precision)} tone="gold" />
              <Stat label={t.signal.sl} value={formatPrice(activeSignal.stopLoss, precision)} tone="bad" />
              <Stat label={t.signal.tp1} value={formatPrice(activeSignal.tp1, precision)} tone="good" />
              <Stat label={t.signal.tp2} value={formatPrice(activeSignal.tp2, precision)} tone="good" />
              <Stat
                label={t.signal.rr1}
                value={`${formatNumber(activeSignal.riskReward1)}R`}
                tone={activeSignal.riskReward1 >= 1 ? 'good' : 'bad'}
              />
              <Stat
                label={t.signal.rr2}
                value={`${formatNumber(activeSignal.riskReward2)}R`}
                tone={activeSignal.riskReward2 >= 1 ? 'good' : 'bad'}
              />
            </div>

            {activeSignal.evidence?.conditions?.length ? (
              <div className="mt-4">
                <p className="label mb-2">{t.dashboard.checklist}</p>
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {activeSignal.evidence.conditions.map((c) => (
                    <li
                      key={c.key}
                      className="flex items-start gap-2 rounded-md bg-ink-800/60 px-2.5 py-1.5 text-xs"
                    >
                      <span
                        className={c.passed ? 'mt-0.5 text-emerald-400' : 'mt-0.5 text-red-400'}
                        aria-hidden="true"
                      >
                        {c.passed ? '✓' : '✕'}
                      </span>
                      <span className="text-slate-300">
                        <span className="font-medium text-slate-200">{c.label}</span>
                        <span className="block text-[11px] text-slate-500">{c.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-4">
              <Link className="btn-gold" to={`/signals/${activeSignal.id}`}>
                {t.signal.details}
              </Link>
            </div>
          </article>
        ) : (
          <div className="card card-pad">
            <p className="font-medium text-slate-300">{t.dashboard.noActiveSignal}</p>
            <p className="mt-1 text-xs text-slate-500">{t.dashboard.noActiveSignalHint}</p>
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <SectionTitle>{t.dashboard.recentSignals}</SectionTitle>
          {data.recentSignals.length === 0 ? (
            <div className="card card-pad text-sm text-slate-500">{t.signal.noSignals}</div>
          ) : (
            <ul className="space-y-2">
              {data.recentSignals.map((s) => (
                <li key={s.id}>
                  <Link
                    to={`/signals/${s.id}`}
                    className="card card-pad flex items-center justify-between gap-3 transition hover:border-gold-500/40"
                  >
                    <div className="flex items-center gap-2">
                      <DirectionBadge direction={s.direction} />
                      <SignalStatusBadge status={s.status} />
                    </div>
                    <div className="text-left text-[11px] text-slate-500">
                      <p dir="ltr" className="font-mono">
                        {s.instrument} · {s.timeframe}
                      </p>
                      <p>{formatDateTime(s.createdAt, lang)}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <SectionTitle>{t.dashboard.recentRuns}</SectionTitle>
          <div className="card card-pad space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="label">{t.diagnostics.scheduler}</span>
              <span
                className={`chip ${
                  scheduler.lastRunStatus === 'OK'
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                    : 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                }`}
              >
                {scheduler.lastRunStatus ?? t.common.unknown}
              </span>
              <span>{formatDateTime(scheduler.lastRunAt, lang)}</span>
            </div>
            {scheduler.lastRunMessage && (
              <p className="text-xs text-slate-400">{scheduler.lastRunMessage}</p>
            )}
            <ul className="divide-y divide-white/5">
              {data.recentRuns.map((run) => (
                <li key={run.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                  <span className="font-mono text-slate-300" dir="ltr">
                    {run.decision ?? run.status}
                  </span>
                  <span className="text-slate-500">{formatDateTime(run.startedAt, lang)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Dashboard;
