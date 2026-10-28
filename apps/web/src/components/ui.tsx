import type { ReactNode } from 'react';
import type { FeedStatus, SignalStatus, Direction } from '@goldscope/shared';
import { useApp } from '../context/AppContext';

/* --------------------------------- states --------------------------------- */

export function Loading({ label }: { label?: string }) {
  const { t } = useApp();
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-400" role="status" aria-live="polite">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-gold-500 border-t-transparent" />
      <span className="text-sm">{label ?? t.common.loading}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useApp();
  return (
    <div className="card card-pad border-red-500/40 bg-red-950/30" role="alert">
      <p className="font-semibold text-red-300">{t.common.error}</p>
      <p className="mt-1 break-words text-sm text-red-200/80">{message}</p>
      {onRetry && (
        <button type="button" className="btn-ghost mt-3" onClick={onRetry}>
          {t.common.retry}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card card-pad text-center">
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/* --------------------------------- badges --------------------------------- */

const FEED_STYLES: Record<FeedStatus, string> = {
  LIVE: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300',
  DELAYED: 'border-amber-500/50 bg-amber-500/10 text-amber-300',
  STALE: 'border-orange-500/50 bg-orange-500/10 text-orange-300',
  UNAVAILABLE: 'border-red-500/50 bg-red-500/10 text-red-300',
  DEMO: 'border-sky-500/50 bg-sky-500/10 text-sky-300',
};

export function FeedBadge({ status }: { status: FeedStatus }) {
  const { t } = useApp();
  const label = t.feed[status] ?? status;
  return (
    <span className={`chip ${FEED_STYLES[status] ?? FEED_STYLES.UNAVAILABLE}`} data-testid="feed-badge">
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

const STATUS_STYLES: Record<SignalStatus, string> = {
  OPEN: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300',
  TARGET_HIT: 'border-gold-500/50 bg-gold-500/10 text-gold-300',
  STOP_HIT: 'border-red-500/50 bg-red-500/10 text-red-300',
  INVALIDATED: 'border-slate-500/50 bg-slate-500/10 text-slate-300',
  EXPIRED: 'border-slate-600/50 bg-slate-600/10 text-slate-400',
  UNRESOLVED: 'border-violet-500/50 bg-violet-500/10 text-violet-300',
};

export function SignalStatusBadge({ status }: { status: SignalStatus }) {
  const { t } = useApp();
  return (
    <span className={`chip ${STATUS_STYLES[status] ?? STATUS_STYLES.UNRESOLVED}`}>
      {t.status[status] ?? status}
    </span>
  );
}

export function DirectionBadge({ direction }: { direction: Direction }) {
  const isBuy = direction === 'BUY';
  return (
    <span
      className={`chip font-bold ${
        isBuy
          ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
          : 'border-red-500/60 bg-red-500/15 text-red-300'
      }`}
      data-testid="direction-badge"
    >
      {direction}
    </span>
  );
}

/* ---------------------------------- misc ---------------------------------- */

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'default' | 'good' | 'bad' | 'gold';
}) {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-300'
      : tone === 'bad'
        ? 'text-red-300'
        : tone === 'gold'
          ? 'text-gold-300'
          : 'text-slate-100';
  return (
    <div className="rounded-lg border border-white/10 bg-ink-800/60 p-3">
      <p className="label">{label}</p>
      <p className={`mt-1 font-mono text-sm font-semibold ${toneClass}`} dir="ltr">
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] leading-tight text-slate-500">{hint}</p>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-gold-400">{children}</h2>
      {action}
    </div>
  );
}

export function WarningBanner({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-sm text-amber-200"
      role="alert"
      data-testid="warning-banner"
    >
      {children}
    </div>
  );
}
