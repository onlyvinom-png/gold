import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type SignalDetailResponse } from '../lib/api';
import { useApp } from '../context/AppContext';
import {
  DirectionBadge,
  ErrorState,
  Loading,
  SectionTitle,
  SignalStatusBadge,
  Stat,
} from '../components/ui';
import { TradingViewChart } from '../components/TradingViewChart';
import { formatDateTime, formatNumber, formatPrice } from '../lib/format';

export function SignalDetails() {
  const { id = '' } = useParams();
  const { t, lang } = useApp();
  const [data, setData] = useState<SignalDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notifyState, setNotifyState] = useState<{ channel: string; ok: boolean; msg: string } | null>(
    null,
  );
  const [notifying, setNotifying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.signal(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const sendNotification = async (channel: 'email' | 'telegram') => {
    setNotifying(true);
    setNotifyState(null);
    try {
      const res = await api.notify(id, channel);
      setNotifyState({
        channel,
        ok: res.status === 'SENT',
        msg: res.status === 'SENT' ? t.signal.notified : (res.error ?? t.signal.notifyFailed),
      });
    } catch (err) {
      setNotifyState({
        channel,
        ok: false,
        msg: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setNotifying(false);
    }
  };

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!data) return <ErrorState message={t.common.error} onRetry={() => void load()} />;

  const s = data.signal;
  const precision = s.evidence?.risk?.atrPeriod ? 2 : 2;
  const risk = s.evidence?.risk ?? null;
  const profile = s.evidence?.profile ?? null;
  const breakout = s.evidence?.breakout ?? null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/history" className="text-xs text-slate-500 hover:text-gold-300">
            ← {t.nav.history}
          </Link>
          <h1 className="mt-1 text-xl font-bold text-slate-100">{t.signal.details}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <DirectionBadge direction={s.direction} />
            <SignalStatusBadge status={s.status} />
            <span className="font-mono text-[11px] text-slate-500" dir="ltr">
              {s.id}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="label">{t.signal.source}</span>
          <span className="chip border-white/15 bg-white/5 text-slate-300">
            {s.source === 'backtest' ? t.signal.sourceBacktest : t.signal.sourceForward}
          </span>
        </div>
      </header>

      <div className="card card-pad grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t.signal.instrument ?? t.dashboard.instrument} value={<span dir="ltr">{s.instrument}</span>} />
        <Stat label={t.dashboard.timeframe} value={<span dir="ltr">{s.timeframe}</span>} />
        <Stat label={t.signal.created} value={formatDateTime(s.createdAt, lang)} />
        <Stat label={t.signal.updated} value={formatDateTime(s.updatedAt, lang)} />
      </div>

      <section>
        <SectionTitle>{t.signal.entry}</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label={t.signal.entry} value={formatPrice(s.entry, precision)} tone="gold" />
          <Stat
            label={t.signal.observedPrice}
            value={formatPrice(s.observedPrice, precision)}
            hint={risk ? t.signal.observedPrice : undefined}
          />
          <Stat label={t.signal.sl} value={formatPrice(s.stopLoss, precision)} tone="bad" />
          <Stat label={t.signal.tp1} value={formatPrice(s.tp1, precision)} tone="good" />
          <Stat label={t.signal.tp2} value={formatPrice(s.tp2, precision)} tone="good" />
          <Stat
            label={t.signal.rr1}
            value={`${formatNumber(s.riskReward1)}R`}
            tone={s.riskReward1 >= 1 ? 'good' : 'bad'}
          />
        </div>
      </section>

      <section>
        <SectionTitle>{t.dashboard.profile}</SectionTitle>
        <div className="card card-pad grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t.signal.vah} value={formatPrice(s.vah, precision)} tone="good" />
          <Stat label={t.signal.poc} value={formatPrice(s.poc, precision)} tone="gold" />
          <Stat label={t.signal.val} value={formatPrice(s.val, precision)} tone="bad" />
          <Stat
            label={t.signal.atr}
            value={formatPrice(s.atr, precision)}
            hint={s.atrPeriod ? `${t.signal.atrPeriod}: ${s.atrPeriod}` : undefined}
          />
        </div>
        {profile && (
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            {t.signal.profileRange}: {formatDateTime(profile.rangeStart, lang)} →{' '}
            {formatDateTime(profile.rangeEnd, lang)} · {profile.timezone} ·{' '}
            {t.strategy.binSize}: {profile.binSize} · {t.strategy.valueAreaPercent}:{' '}
            {profile.valueAreaPercent}% · {profile.method}
            {profile.incomplete ? ` · ${t.strategy.incomplete}` : ''}
          </p>
        )}
      </section>

      <section>
        <SectionTitle>{t.signal.evidence}</SectionTitle>
        <div className="card card-pad grid gap-3 sm:grid-cols-3">
          <Stat
            label={t.signal.breakoutCandle}
            value={formatDateTime(s.breakoutCandleTime, lang)}
            hint={breakout ? `close ${formatPrice(breakout.breakoutClose, precision)}` : undefined}
          />
          <Stat
            label={t.signal.retestCandle}
            value={formatDateTime(s.retestCandleTime, lang)}
            hint={
              breakout && breakout.retestLow !== null
                ? `low ${formatPrice(breakout.retestLow, precision)} / high ${formatPrice(breakout.retestHigh, precision)}`
                : undefined
            }
          />
          <Stat
            label={t.signal.confirmationCandle}
            value={formatDateTime(s.confirmationCandleTime, lang)}
            hint={
              breakout && breakout.confirmationClose !== null
                ? `close ${formatPrice(breakout.confirmationClose, precision)}`
                : undefined
            }
          />
        </div>

        {s.evidence?.conditions?.length ? (
          <ul className="mt-3 space-y-1.5">
            {s.evidence.conditions.map((c) => (
              <li
                key={c.key}
                className="flex items-start gap-2 rounded-lg border border-white/10 bg-ink-800/60 px-3 py-2 text-sm"
              >
                <span className={c.passed ? 'text-emerald-400' : 'text-red-400'} aria-hidden="true">
                  {c.passed ? '✓' : '✕'}
                </span>
                <span>
                  <span className="font-medium text-slate-200">{c.label}</span>
                  <span className="block text-xs text-slate-500">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section>
        <SectionTitle>{t.strategy.riskSection}</SectionTitle>
        <div className="card card-pad space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-ink-800/60 p-3">
              <p className="label">{t.signal.stopLossCalc}</p>
              <p className="mt-1 font-mono text-sm text-slate-100" dir="ltr">
                {formatPrice(s.stopLoss, precision)}
              </p>
              {risk && (
                <p className="mt-1 text-xs text-slate-500">
                  {t.signal.stopLossBasis}: {risk.stopLossBasis} · {t.signal.riskDistanceAtr}:{' '}
                  {formatNumber(risk.stopDistanceInAtr)}
                </p>
              )}
            </div>
            <div className="rounded-lg bg-ink-800/60 p-3">
              <p className="label">{t.signal.takeProfitCalc}</p>
              <p className="mt-1 font-mono text-sm text-slate-100" dir="ltr">
                {formatPrice(s.tp1, precision)} · {formatPrice(s.tp2, precision)}
              </p>
              {risk && (
                <p className="mt-1 text-xs text-slate-500">
                  {t.signal.riskReward}: {formatNumber(risk.riskReward1)}R /{' '}
                  {formatNumber(risk.riskReward2)}R
                </p>
              )}
            </div>
          </div>
          <div className="rounded-lg bg-ink-800/60 p-3">
            <p className="label">{t.signal.reason}</p>
            <p className="mt-1 text-sm text-slate-300">{s.reason}</p>
          </div>
          <div className="rounded-lg bg-ink-800/60 p-3">
            <p className="label">{t.signal.invalidation}</p>
            {s.invalidatedReason ? (
              <p className="mt-1 text-sm text-red-300">{s.invalidatedReason}</p>
            ) : (
              <p className="mt-1 text-sm text-slate-500">{t.signal.invalidationNone}</p>
            )}
          </div>
          {s.evidence?.notes?.length ? (
            <div className="rounded-lg bg-ink-800/60 p-3">
              <p className="label">{t.signal.notes}</p>
              <ul className="mt-1 list-disc space-y-0.5 ps-5 text-xs text-slate-400">
                {s.evidence.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>

      {s.status !== 'OPEN' && (s.resultPrice !== null || s.realizedR !== null) && (
        <section>
          <SectionTitle>{t.history.outcome}</SectionTitle>
          <div className="card card-pad grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t.signal.resultPrice} value={formatPrice(s.resultPrice, precision)} />
            <Stat
              label={t.signal.realizedR}
              value={s.realizedR === null ? '—' : `${formatNumber(s.realizedR)}R`}
              tone={(s.realizedR ?? 0) >= 0 ? 'good' : 'bad'}
            />
            <Stat label={t.signal.closedAt} value={formatDateTime(s.closedAt, lang)} />
          </div>
        </section>
      )}

      <section>
        <SectionTitle>{t.signal.events}</SectionTitle>
        <div className="card card-pad">
          {data.events.length === 0 ? (
            <p className="text-sm text-slate-500">{t.common.none}</p>
          ) : (
            <ul className="space-y-2">
              {data.events.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 text-xs">
                  <span className="chip border-white/15 bg-white/5 text-slate-300">{e.eventType}</span>
                  <span className="flex-1 text-slate-400">{e.message ?? ''}</span>
                  <span className="shrink-0 text-slate-500">{formatDateTime(e.createdAt, lang)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section>
        <SectionTitle>{t.signal.notify}</SectionTitle>
        <div className="card card-pad flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-ghost"
            disabled={notifying}
            onClick={() => void sendNotification('email')}
          >
            {t.signal.notifyEmail}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={notifying}
            onClick={() => void sendNotification('telegram')}
          >
            {t.signal.notifyTelegram}
          </button>
          {notifyState && (
            <span
              className={`text-xs ${notifyState.ok ? 'text-emerald-300' : 'text-red-300'}`}
              role="status"
            >
              {notifyState.channel}: {notifyState.msg}
            </span>
          )}
        </div>
      </section>

      <section>
        <SectionTitle>{t.dashboard.marketOverview}</SectionTitle>
        <TradingViewChart symbol="OANDA:XAUUSD" interval={s.timeframe} height={360} />
      </section>
    </div>
  );
}

export default SignalDetails;
