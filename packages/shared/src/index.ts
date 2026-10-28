/**
 * Shared domain types for GoldScope AI.
 * Strategy: Volume Profile + Break & Retest (single methodology).
 */

export type Direction = 'BUY' | 'SELL';
export type TradeDecision = Direction | 'NO TRADE';

export type SignalStatus =
  | 'OPEN'
  | 'TARGET_HIT'
  | 'STOP_HIT'
  | 'INVALIDATED'
  | 'EXPIRED'
  | 'UNRESOLVED';

export type FeedStatus = 'LIVE' | 'DELAYED' | 'STALE' | 'UNAVAILABLE' | 'DEMO';

export interface Candle {
  /** Candle open time, ISO-8601 UTC string */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Provider reported volume (candle-level / tick volume). Units documented per provider. */
  volume: number;
}

export interface VolumeProfileLevel {
  price: number;
  binLow: number;
  binHigh: number;
  volume: number;
}

export interface VolumeProfileResult {
  available: boolean;
  reason?: string;
  /** ISO timestamps (UTC) of the configured profile range actually used */
  rangeStart: string;
  rangeEnd: string;
  /** Local (configured timezone) session start / end that defined the range */
  sessionStart: string;
  sessionEnd: string;
  timezone: string;
  /** Price bin size used */
  binSize: number;
  valueAreaPercent: number;
  poc: VolumeProfileLevel | null;
  vah: VolumeProfileLevel | null;
  val: VolumeProfileLevel | null;
  /** All bins, ascending by price */
  bins: VolumeProfileLevel[];
  totalVolume: number;
  candleCount: number;
  /** Volume semantics of the underlying source, e.g. "tick_volume" | "candle_volume" */
  volumeSemantics: string;
  /** True when the profile range window is still in progress (incomplete candles) */
  incomplete: boolean;
  method: string;
}

export interface BreakoutEvidence {
  breakoutCandleTime: string;
  breakoutClose: number;
  retestCandleTime: string | null;
  retestLow: number | null;
  retestHigh: number | null;
  confirmationCandleTime: string | null;
  confirmationClose: number | null;
  candlesBetween: number | null;
}

export interface RiskLevels {
  entry: number;
  entryType: 'confirmation_close' | 'next_bar_open';
  observedPrice: number;
  stopLoss: number;
  stopLossBasis: string;
  tp1: number;
  tp2: number;
  risk: number;
  reward1: number;
  reward2: number;
  riskReward1: number;
  riskReward2: number;
  atr: number;
  atrPeriod: number;
  stopDistanceInAtr: number;
}

export interface ConditionCheck {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface SignalEvidence {
  profile: VolumeProfileResult;
  breakout: BreakoutEvidence;
  conditions: ConditionCheck[];
  risk: RiskLevels | null;
  atr: number | null;
  atrPeriod: number | null;
  lastCandleTime: string | null;
  dataFreshnessSeconds: number | null;
  notes: string[];
}

export interface Signal {
  id: string;
  direction: Direction;
  status: SignalStatus;
  instrument: string;
  timeframe: string;
  signalKey: string;
  createdAt: string;
  updatedAt: string;
  entry: number;
  observedPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  riskReward1: number;
  riskReward2: number;
  atr: number | null;
  atrPeriod: number | null;
  profileRangeStart: string;
  profileRangeEnd: string;
  poc: number | null;
  vah: number | null;
  val: number | null;
  breakoutCandleTime: string | null;
  retestCandleTime: string | null;
  confirmationCandleTime: string | null;
  reason: string;
  invalidatedReason: string | null;
  resultPrice: number | null;
  realizedR: number | null;
  closedAt: string | null;
  source: 'forward' | 'backtest';
  evidence: SignalEvidence;
}

export interface NoTradeResult {
  decision: 'NO TRADE';
  reason: string;
  conditions: ConditionCheck[];
  instrument: string;
  timeframe: string;
  profile: VolumeProfileResult | null;
  evaluatedAt: string;
  lastCandleTime: string | null;
  dataFreshnessSeconds: number | null;
}

export type AnalysisResult =
  | ({ decision: Direction } & Omit<Signal, 'decision'>)
  | NoTradeResult;

export interface FeedStatusInfo {
  status: FeedStatus;
  provider: string;
  providerConfigured: boolean;
  message: string;
  lastCandleTime: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  ageSeconds: number | null;
  timezone: string;
}

export interface StrategyConfig {
  id: number;
  version: number;
  symbol: string;
  timeframe: string;
  timezone: string;
  sessionStart: string;
  sessionEnd: string;
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
  entryType: 'confirmation_close' | 'next_bar_open';
  pricePrecision: number;
  tickSize: number;
  riskPerTradePercent: number | null;
  maxSignalAgeMinutes: number;
  notes: string;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface BacktestSummary {
  label: string;
  symbol: string;
  timeframe: string;
  from: string;
  to: string;
  sampleSize: number;
  trades: number;
  wins: number;
  losses: number;
  unresolved: number;
  winRate: number | null;
  averageR: number | null;
  expectancy: number | null;
  maxDrawdownR: number | null;
  totalFees: number;
  spreadAssumption: number;
  slippageAssumption: number;
  inSample: boolean;
  generatedAt: string;
  notes: string[];
}
