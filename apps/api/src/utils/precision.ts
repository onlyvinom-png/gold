export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value;
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** Round to the nearest tick multiple (XAUUSD typically ticks by 0.01). */
export function roundToTick(value: number, tickSize: number, precision: number): number {
  if (!Number.isFinite(value) || !tickSize || tickSize <= 0) return roundTo(value, precision);
  const snapped = Math.round(value / tickSize) * tickSize;
  return roundTo(snapped, precision);
}

export function formatPrice(value: number | null | undefined, precision: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(precision);
}
