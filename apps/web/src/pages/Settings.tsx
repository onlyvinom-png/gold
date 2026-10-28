import { useCallback, useEffect, useState } from 'react';
import { api, type SettingsResponse, type Delivery } from '../lib/api';
import { useApp } from '../context/AppContext';
import { ErrorState, Loading, SectionTitle, Stat, WarningBanner } from '../components/ui';
import { formatDateTime, formatDuration } from '../lib/format';

export function Settings() {
  const { t, lang } = useApp();
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settings, del] = await Promise.all([api.settings(), api.deliveries()]);
      setData(settings);
      setDeliveries(del.items);
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

  const md = data.marketData;
  const s = data.strategy;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-slate-100">{t.settings.title}</h1>
        <p className="mt-1 text-sm text-slate-400">{t.settings.envHint}</p>
      </header>

      <section>
        <SectionTitle>{t.settings.provider}</SectionTitle>
        <div className="card card-pad space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip border-white/15 bg-white/5 font-mono text-slate-200" dir="ltr">
              {md.provider}
            </span>
            <span
              className={`chip ${
                md.configured
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                  : 'border-amber-500/50 bg-amber-500/10 text-amber-300'
              }`}
            >
              {md.configured ? t.settings.configured : t.settings.notConfigured}
            </span>
          </div>
          {!md.configured && <WarningBanner>{t.feed.demoWarning}</WarningBanner>}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label={t.settings.volumeSemantics} value={md.volumeSemantics} />
            <Stat label={t.settings.rateLimit} value={String(md.rateLimitPerMinute)} />
            <Stat label={t.settings.updateFrequency} value={String(md.updateFrequencySeconds)} />
            <Stat label={t.settings.cost} value={md.cost} />
            <Stat label={t.settings.envVarUsed} value={md.envVarUsed} />
            <Stat
              label={t.settings.supportedSymbols}
              value={md.supportedSymbols.join(', ')}
              hint={md.documentation}
            />
          </div>
        </div>
      </section>

      <section>
        <SectionTitle>{t.strategy.title}</SectionTitle>
        <div className="card card-pad grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={t.dashboard.instrument} value={<span dir="ltr">{s.symbol}</span>} />
          <Stat label={t.dashboard.timeframe} value={<span dir="ltr">{s.timeframe}</span>} />
          <Stat label={t.strategy.timezone} value={<span dir="ltr">{s.timezone}</span>} />
          <Stat
            label={t.strategy.sessionStart}
            value={
              <span dir="ltr">
                {s.sessionStart} → {s.sessionEnd}
              </span>
            }
          />
          <Stat label={t.strategy.valueAreaPercent} value={`${s.valueAreaPercent}%`} />
          <Stat label={t.strategy.binSize} value={s.binSize ?? t.strategy.binSizeAuto} />
          <Stat label={t.strategy.lookbackDays} value={String(s.profileLookbackDays)} />
          <Stat label={t.strategy.retestWindow} value={String(s.retestWindowCandles)} />
          <Stat label={t.strategy.entryType} value={s.entryType} />
          <Stat label={t.strategy.atrPeriod} value={String(s.atrPeriod)} />
          <Stat label={t.strategy.rr1} value={String(s.rrTarget1)} />
          <Stat label={t.strategy.rr2} value={String(s.rrTarget2)} />
          <Stat label={t.strategy.minRR} value={String(s.minRiskReward)} />
          <Stat label={t.strategy.pricePrecision} value={String(s.pricePrecision)} />
          <Stat label={t.strategy.tickSize} value={String(s.tickSize)} />
          <Stat
            label={t.strategy.riskPerTrade}
            value={s.riskPerTradePercent === null ? t.common.none : `${s.riskPerTradePercent}%`}
          />
          <Stat label={t.strategy.maxSignalAge} value={String(s.maxSignalAgeMinutes)} />
        </div>
      </section>

      <section>
        <SectionTitle>{t.settings.notifications}</SectionTitle>
        <div className="card card-pad space-y-3">
          {data.notifications.length === 0 ? (
            <p className="text-sm text-slate-500">{t.common.none}</p>
          ) : (
            <ul className="space-y-2">
              {data.notifications.map((p) => (
                <li
                  key={p.channel}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-ink-800/60 px-3 py-2"
                >
                  <span className="text-sm font-medium text-slate-200" dir="ltr">
                    {p.channel}
                  </span>
                  <span
                    className={`chip ${
                      p.enabled
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                        : 'border-slate-500/50 bg-slate-500/10 text-slate-400'
                    }`}
                  >
                    {p.enabled ? t.settings.enabled : t.settings.disabled}
                  </span>
                  <span className="w-full text-[11px] text-slate-500">
                    {Object.entries(p.config)
                      .map(([k, v]) => `${k}: ${v === null || v === '' ? t.common.none : String(v)}`)
                      .join(' · ') || '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section>
        <SectionTitle>{t.settings.deliveries}</SectionTitle>
        <div className="card card-pad overflow-x-auto">
          {deliveries.length === 0 ? (
            <p className="text-sm text-slate-500">{t.settings.noDeliveries}</p>
          ) : (
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className="border-b border-white/10 text-slate-400">
                  <th className="p-2 text-start">{t.settings.deliveryChannel}</th>
                  <th className="p-2 text-start">{t.settings.deliveryStatus}</th>
                  <th className="p-2 text-start">{t.settings.deliveryTime}</th>
                  <th className="p-2 text-start">{t.settings.deliveryError}</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
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
        <SectionTitle>{t.settings.apiHealth}</SectionTitle>
        <div className="card card-pad text-xs text-slate-400">
          <p>{t.settings.envHint}</p>
          <p className="mt-2 font-mono" dir="ltr">
            {t.diagnostics.serverTime}: {formatDateTime(new Date().toISOString(), lang)} ·{' '}
            {t.diagnostics.latency}: {formatDuration(120)}
          </p>
        </div>
      </section>
    </div>
  );
}

export default Settings;
