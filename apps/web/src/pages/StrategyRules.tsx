import { useCallback, useEffect, useState } from 'react';
import { api, type StrategyResponse } from '../lib/api';
import { useApp } from '../context/AppContext';
import { ErrorState, Loading, SectionTitle } from '../components/ui';
import { formatDateTime } from '../lib/format';

export function StrategyRules() {
  const { t, lang } = useApp();
  const [data, setData] = useState<StrategyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.strategy());
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

  const a = data.active;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-slate-100">{t.strategy.title}</h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-400">{t.strategy.intro}</p>
      </header>

      <section className="card card-pad border-gold-500/30">
        <SectionTitle>{t.strategy.vpSection}</SectionTitle>
        <ul className="space-y-2 text-sm text-slate-300">
          <li className="flex gap-2">
            <span className="text-gold-400">1.</span>
            <span>
              {t.strategy.lookbackDays}: <b className="font-mono">{a.profileLookbackDays ?? a.symbol}</b>{' '}
              <span className="text-slate-500">—</span>{' '}
              <span dir="ltr">
                {a.sessionStart} → {a.sessionEnd}
              </span>{' '}
              <span className="text-slate-500">({a.timezone})</span>
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-gold-400">2.</span>
            <span>
              {t.strategy.valueAreaPercent}: <b className="font-mono">{a.valueAreaPercent}%</b> ·{' '}
              {t.strategy.binSize}:{' '}
              <b className="font-mono">{a.binSize ?? t.strategy.binSizeAuto}</b>
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-gold-400">3.</span>
            <span>
              {t.strategy.profileMethod} — {t.strategy.incomplete}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-gold-400">4.</span>
            <span>{t.strategy.pocContext}</span>
          </li>
        </ul>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card card-pad">
          <SectionTitle>{t.strategy.buyRules}</SectionTitle>
          <ol className="space-y-2 text-sm text-slate-300">
            <li>1. {t.signal.vah} — candle close above VAH.</li>
            <li>
              2. Retest within {a.retestWindowCandles} candles — zone: {a.retestZoneTicks} ticks or{' '}
              {a.retestZoneAtrFraction}×ATR.
            </li>
            <li>3. Price reaches the retest zone.</li>
            <li>4. Confirmed candle close back above VAH.</li>
            <li>5. No invalidation.</li>
            <li>6. Valid data and acceptable Risk/Reward.</li>
          </ol>
        </section>

        <section className="card card-pad">
          <SectionTitle>{t.strategy.sellRules}</SectionTitle>
          <ol className="space-y-2 text-sm text-slate-300">
            <li>1. {t.signal.val} — candle close below VAL.</li>
            <li>
              2. Retest within {a.retestWindowCandles} candles — zone: {a.retestZoneTicks} ticks or{' '}
              {a.retestZoneAtrFraction}×ATR.
            </li>
            <li>3. Price reaches the retest zone.</li>
            <li>4. Confirmed candle close back below VAL.</li>
            <li>5. No invalidation.</li>
            <li>6. Valid data and acceptable Risk/Reward.</li>
          </ol>
        </section>
      </div>

      <section className="card card-pad border-gold-500/30">
        <SectionTitle>{t.strategy.riskSection}</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Param label={t.signal.entry} value={a.entryType} />
          <Param label={t.strategy.atrPeriod} value={String(a.atrPeriod)} />
          <Param label={t.strategy.atrFallback} value={a.atrFallbackEnabled ? t.common.yes : t.common.no} />
          <Param label={t.strategy.stopBufferTicks} value={String(a.stopBufferTicks)} />
          <Param label={t.strategy.stopBufferAtr} value={String(a.stopBufferAtrFraction)} />
          <Param label={t.strategy.maxStopAtr} value={String(a.maxStopAtr)} />
          <Param label={t.strategy.minStopTicks} value={String(a.minStopTicks)} />
          <Param label={t.strategy.rr1} value={String(a.rrTarget1)} />
          <Param label={t.strategy.rr2} value={String(a.rrTarget2)} />
          <Param label={t.strategy.minRR} value={String(a.minRiskReward)} />
          <Param label={t.strategy.pricePrecision} value={String(a.pricePrecision)} />
          <Param label={t.strategy.tickSize} value={String(a.tickSize)} />
          <Param
            label={t.strategy.riskPerTrade}
            value={a.riskPerTradePercent === null ? t.common.none : `${a.riskPerTradePercent}%`}
          />
          <Param label={t.strategy.maxSignalAge} value={String(a.maxSignalAgeMinutes)} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">{t.strategy.noTradeRule}</p>
      </section>

      <section>
        <SectionTitle>{t.strategy.historyVersions}</SectionTitle>
        <div className="card card-pad overflow-x-auto">
          <table className="w-full min-w-[520px] text-start text-xs">
            <thead>
              <tr className="border-b border-white/10 text-slate-400">
                <th className="p-2 text-start">{t.strategy.version}</th>
                <th className="p-2 text-start">{t.strategy.active}</th>
                <th className="p-2 text-start">{t.strategy.valueAreaPercent}</th>
                <th className="p-2 text-start">{t.strategy.retestWindow}</th>
                <th className="p-2 text-start">{t.strategy.minRR}</th>
                <th className="p-2 text-start">{t.common.lastUpdate}</th>
              </tr>
            </thead>
            <tbody>
              {data.versions.map((v) => (
                <tr key={v.id} className="border-b border-white/5">
                  <td className="p-2 font-mono text-slate-200">v{v.version}</td>
                  <td className="p-2 text-slate-300">
                    {v.id === a.id ? t.strategy.active : t.common.no}
                  </td>
                  <td className="p-2 font-mono text-slate-300">{v.valueAreaPercent}%</td>
                  <td className="p-2 font-mono text-slate-300">{v.retestWindowCandles}</td>
                  <td className="p-2 font-mono text-slate-300">{v.minRiskReward}</td>
                  <td className="p-2 text-slate-400">{formatDateTime(v.createdAt, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          {t.strategy.changeNote}: {a.notes}
        </p>
      </section>
    </div>
  );
}

function Param({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-ink-800/60 p-2.5">
      <p className="label">{label}</p>
      <p className="mt-0.5 font-mono text-sm text-slate-100" dir="ltr">
        {value}
      </p>
    </div>
  );
}

export default StrategyRules;
