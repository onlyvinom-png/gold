import { useCallback, useEffect, useState } from 'react';
import { api, type DiagnosticsResponse } from '../lib/api';
import { useApp } from '../context/AppContext';
import { ErrorState, Loading, SectionTitle, Stat, WarningBanner } from '../components/ui';
import { formatDateTime, formatDuration, formatNumber } from '../lib/format';

export function Diagnostics() {
  const { t, lang } = useApp();
  const [data, setData] = useState<DiagnosticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.diagnostics());
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

  const s = data.scheduler;
  const md = data.marketData;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-100">{t.diagnostics.title}</h1>
        <button type="button" className="btn-ghost" onClick={() => void load()}>
          {t.common.refresh}
        </button>
      </header>

      <section>
        <SectionTitle>{t.diagnostics.backend}</SectionTitle>
        <div className="card card-pad grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label={t.diagnostics.database}
            value={data.database.ok ? t.diagnostics.ok : t.diagnostics.failed}
            tone={data.database.ok ? 'good' : 'bad'}
          />
          <Stat
            label={t.diagnostics.marketData}
            value={md.status}
            tone={md.status === 'LIVE' ? 'good' : md.status === 'UNAVAILABLE' ? 'bad' : undefined}
          />
          <Stat label={t.diagnostics.nodeVersion} value={data.nodeVersion} />
          <Stat label={t.diagnostics.serverTime} value={formatDateTime(data.serverTime, lang)} />
        </div>
        {data.database.error && (
          <div className="mt-3">
            <WarningBanner>
              {t.diagnostics.error}: {data.database.error}
              {data.database.remediation ? ` — ${t.diagnostics.remediation}: ${data.database.remediation}` : ''}
            </WarningBanner>
          </div>
        )}
        {md.lastError && (
          <div className="mt-3">
            <WarningBanner>
              {t.diagnostics.error}: {md.lastError}
              {md.remediation ? ` — ${t.diagnostics.remediation}: ${md.remediation}` : ''}
            </WarningBanner>
          </div>
        )}
      </section>

      <section>
        <SectionTitle>{t.settings.dataFreshness}</SectionTitle>
        <div className="card card-pad grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t.dashboard.lastCandle} value={formatDateTime(md.lastCandleTime, lang)} />
          <Stat label={t.dashboard.lastSuccess} value={formatDateTime(md.lastSuccessAt, lang)} />
          <Stat
            label={t.common.lastUpdate}
            value={md.ageSeconds === null ? '—' : `${md.ageSeconds}s`}
            tone={md.ageSeconds !== null && md.ageSeconds > 3600 ? 'bad' : undefined}
          />
          <Stat
            label={t.settings.providerStatus}
            value={md.configured ? t.settings.configured : t.settings.notConfigured}
            tone={md.configured ? 'good' : undefined}
          />
        </div>
      </section>

      <section>
        <SectionTitle>{t.diagnostics.scheduler}</SectionTitle>
        <div className="card card-pad grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label={t.diagnostics.running}
            value={s.running ? t.common.yes : t.common.no}
            tone={s.running ? 'good' : 'bad'}
          />
          <Stat label={t.diagnostics.interval} value={`${s.intervalMinutes}m`} />
          <Stat label={t.diagnostics.lastRun} value={formatDateTime(s.lastRunAt, lang)} />
          <Stat
            label={t.diagnostics.lastRunDuration}
            value={formatDuration(s.lastRunDurationMs)}
          />
          <Stat
            label={t.diagnostics.lastRunStatus}
            value={s.lastRunStatus ?? t.common.unknown}
            tone={s.lastRunStatus === 'OK' ? 'good' : s.lastRunStatus ? 'bad' : undefined}
          />
          <Stat
            label={t.diagnostics.consecutiveFailures}
            value={String(s.consecutiveFailures)}
            tone={s.consecutiveFailures > 0 ? 'bad' : 'good'}
          />
          <Stat label={t.diagnostics.lastRunMessage} value={s.lastRunMessage ?? '—'} />
          <Stat label={t.diagnostics.nextRun} value={formatDateTime(s.nextRunAt, lang)} />
        </div>
      </section>

      <section>
        <SectionTitle>{t.diagnostics.recentRuns}</SectionTitle>
        <div className="card card-pad overflow-x-auto">
          {data.recentRuns.length === 0 ? (
            <p className="text-sm text-slate-500">{t.common.none}</p>
          ) : (
            <table className="w-full min-w-[640px] text-xs">
              <thead>
                <tr className="border-b border-white/10 text-slate-400">
                  <th className="p-2 text-start">{t.diagnostics.startedAt}</th>
                  <th className="p-2 text-start">{t.diagnostics.duration}</th>
                  <th className="p-2 text-start">{t.diagnostics.decision}</th>
                  <th className="p-2 text-start">{t.diagnostics.candles}</th>
                  <th className="p-2 text-start">{t.diagnostics.trigger}</th>
                  <th className="p-2 text-start">{t.diagnostics.status}</th>
                  <th className="p-2 text-start">{t.diagnostics.error}</th>
                </tr>
              </thead>
              <tbody>
                {data.recentRuns.map((r) => (
                  <tr key={r.id} className="border-b border-white/5">
                    <td className="p-2 text-slate-400">{formatDateTime(r.startedAt, lang)}</td>
                    <td className="p-2 font-mono text-slate-300">{formatDuration(r.durationMs)}</td>
                    <td className="p-2 font-mono text-slate-200">{r.decision}</td>
                    <td className="p-2 font-mono text-slate-300">{r.candleCount}</td>
                    <td className="p-2 text-slate-300">{r.trigger}</td>
                    <td
                      className={`p-2 ${
                        r.status === 'OK' ? 'text-emerald-300' : 'text-red-300'
                      }`}
                    >
                      {r.status}
                    </td>
                    <td className="p-2 text-slate-400">{r.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <SectionTitle>{t.diagnostics.recentDeliveries}</SectionTitle>
        <div className="card card-pad overflow-x-auto">
          {data.recentDeliveries.length === 0 ? (
            <p className="text-sm text-slate-500">{t.settings.noDeliveries}</p>
          ) : (
            <table className="w-full min-w-[480px] text-xs">
              <thead>
                <tr className="border-b border-white/10 text-slate-400">
                  <th className="p-2 text-start">{t.settings.deliveryChannel}</th>
                  <th className="p-2 text-start">{t.settings.deliveryStatus}</th>
                  <th className="p-2 text-start">{t.settings.deliveryTime}</th>
                  <th className="p-2 text-start">{t.settings.deliveryError}</th>
                </tr>
              </thead>
              <tbody>
                {data.recentDeliveries.map((d) => (
                  <tr key={d.id} className="border-b border-white/5">
                    <td className="p-2 text-slate-300">{d.channel}</td>
                    <td className="p-2 text-slate-300">{d.status}</td>
                    <td className="p-2 text-slate-400">{formatDateTime(d.createdAt, lang)}</td>
                    <td className="p-2 text-red-300">{d.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <SectionTitle>{t.diagnostics.recentBacktests}</SectionTitle>
        <div className="card card-pad overflow-x-auto">
          {data.recentBacktests.length === 0 ? (
            <p className="text-sm text-slate-500">{t.common.none}</p>
          ) : (
            <table className="w-full min-w-[720px] text-xs">
              <thead>
                <tr className="border-b border-white/10 text-slate-400">
                  <th className="p-2 text-start">{t.diagnostics.startedAt}</th>
                  <th className="p-2 text-start">Sample</th>
                  <th className="p-2 text-start">Split</th>
                  <th className="p-2 text-start">Win rate</th>
                  <th className="p-2 text-start">Avg R</th>
                  <th className="p-2 text-start">Expectancy</th>
                  <th className="p-2 text-start">Max DD</th>
                </tr>
              </thead>
              <tbody>
                {data.recentBacktests.map((b) => (
                  <tr key={b.id} className="border-b border-white/5">
                    <td className="p-2 text-slate-400">{formatDateTime(b.createdAt, lang)}</td>
                    <td className="p-2 font-mono text-slate-300">{b.sampleSize}</td>
                    <td className="p-2 text-slate-300">{b.split}</td>
                    <td className="p-2 font-mono text-slate-300">
                      {b.winRate === null ? '—' : `${formatNumber(b.winRate * 100, 1)}%`}
                    </td>
                    <td className="p-2 font-mono text-slate-300">
                      {b.averageR === null ? '—' : formatNumber(b.averageR)}
                    </td>
                    <td className="p-2 font-mono text-slate-300">
                      {b.expectancy === null ? '—' : formatNumber(b.expectancy)}
                    </td>
                    <td className="p-2 font-mono text-red-300">
                      {b.maxDrawdown === null ? '—' : formatNumber(b.maxDrawdown)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

export default Diagnostics;
