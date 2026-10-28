import { query } from './pool.js';
import { saveStrategy } from '../services/strategyRepo.js';
import { logger } from '../utils/logger.js';

/**
 * Seed data — CLEARLY LABELLED TEST DATA ONLY.
 *
 * Every row created here is marked with the source = 'test-seed' / a label
 * containing "TEST" so it can never be mistaken for a real market signal.
 * Nothing produced by this script reflects real market behaviour.
 */
const SEED_SIGNAL_KEY = 'TEST-SEED-DEMO-SIGNAL-0001';

export async function seed(): Promise<void> {
  const strategy = await saveStrategy(
    {
      symbol: 'XAU/USD',
      timeframe: '1h',
      timezone: 'Africa/Casablanca',
      valueAreaPercent: 70,
      notes: 'TEST SEED configuration — Volume Profile + Break & Retest defaults.',
    },
    'seed',
  );
  logger.info('seeded strategy config', { version: strategy.version });

  await query(
    `INSERT INTO market_data_sources (name, provider, symbol, timeframe, timezone, is_active, metadata)
     VALUES ('TEST SEED - demo', 'demo', 'XAU/USD', '1h', 'Africa/Casablanca', FALSE, $1)
     ON CONFLICT (name) DO NOTHING`,
    [JSON.stringify({ testData: true, note: 'Synthetic demo source — not real market data.' })],
  );

  const inserted = await query(
    `INSERT INTO signals (
       signal_key, direction, status, instrument, timeframe,
       entry, observed_price, stop_loss, tp1, tp2, risk_reward1, risk_reward2,
       atr, atr_period, profile_range_start, profile_range_end, poc, vah, val,
       breakout_candle_time, retest_candle_time, confirmation_candle_time,
       reason, source, evidence
     ) VALUES (
       $1,'BUY','OPEN','XAU/USD','1h',
       2000.00, 2000.00, 1990.00, 2015.00, 2030.00, 1.50, 3.00,
       8.00, 14, NOW() - INTERVAL '1 day', NOW(), 2000.00, 2005.00, 1995.00,
       NOW() - INTERVAL '3 hours', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour',
       $2, 'forward', $3
     ) ON CONFLICT (signal_key) DO NOTHING RETURNING id`,
    [
      SEED_SIGNAL_KEY,
      'TEST SEED SIGNAL — synthetic values for UI testing only. Not a real trade.',
      JSON.stringify({
        testData: true,
        profile: {
          available: true,
          rangeStart: new Date(Date.now() - 86_400_000).toISOString(),
          rangeEnd: new Date().toISOString(),
          sessionStart: '00:00',
          sessionEnd: '23:59',
          timezone: 'Africa/Casablanca',
          binSize: 0.1,
          valueAreaPercent: 70,
          poc: { price: 2000, binLow: 1999.95, binHigh: 2000.05, volume: 1000 },
          vah: { price: 2005, binLow: 2004.95, binHigh: 2005.05, volume: 500 },
          val: { price: 1995, binLow: 1994.95, binHigh: 1995.05, volume: 500 },
          bins: [],
          totalVolume: 2000,
          candleCount: 24,
          volumeSemantics: 'TEST SEED — synthetic',
          incomplete: false,
          method: 'TEST SEED — not a real profile',
        },
        breakout: {
          breakoutCandleTime: new Date(Date.now() - 3 * 3600_000).toISOString(),
          breakoutClose: 2006,
          retestCandleTime: new Date(Date.now() - 2 * 3600_000).toISOString(),
          retestLow: 2003,
          retestHigh: 2007,
          confirmationCandleTime: new Date(Date.now() - 3600_000).toISOString(),
          confirmationClose: 2008,
          candlesBetween: 1,
        },
        conditions: [
          { key: 'profile_available', label: 'Volume Profile متاح', passed: true, detail: 'TEST SEED' },
          { key: 'breakout', label: 'إغلاق شمعة فوق VAH', passed: true, detail: 'TEST SEED' },
          { key: 'retest', label: 'اختبار إعادة إلى منطقة VAH', passed: true, detail: 'TEST SEED' },
          { key: 'confirmation', label: 'إغلاق تأكيد فوق VAH', passed: true, detail: 'TEST SEED' },
        ],
        risk: {
          entry: 2000,
          entryType: 'confirmation_close',
          observedPrice: 2000,
          stopLoss: 1990,
          stopLossBasis: 'TEST SEED — retest swing low 1990 + buffer',
          tp1: 2015,
          tp2: 2030,
          risk: 10,
          reward1: 15,
          reward2: 30,
          riskReward1: 1.5,
          riskReward2: 3,
          atr: 8,
          atrPeriod: 14,
          stopDistanceInAtr: 1.25,
        },
        atr: 8,
        atrPeriod: 14,
        lastCandleTime: new Date().toISOString(),
        dataFreshnessSeconds: 0,
        notes: ['TEST SEED DATA — synthetic values for UI testing only.'],
      }),
    ],
  );

  if (inserted.rows.length) {
    await query(
      `INSERT INTO signal_events (signal_id, event_type, detail, meta)
       VALUES ($1, 'CREATED', 'TEST SEED — signal created by the seed script.', $2)`,
      [inserted.rows[0].id, JSON.stringify({ testData: true })],
    );
    logger.info('seeded test signal', { id: inserted.rows[0].id });
  } else {
    logger.info('test signal already present, nothing to insert');
  }

  await query(
    `INSERT INTO notification_preferences (channel, enabled, config)
     VALUES ('email', FALSE, $1), ('telegram', FALSE, $2)
     ON CONFLICT (channel) DO UPDATE SET enabled = FALSE`,
    [
      JSON.stringify({ testData: true }),
      JSON.stringify({ testData: true }),
    ],
  );

  await query(
    `INSERT INTO system_health_events (component, status, message, details)
     VALUES ('seed', 'INFO', 'TEST SEED data installed by the seed script.', $1)`,
    [JSON.stringify({ testData: true })],
  );

  logger.info('seed complete — all inserted rows are labelled TEST SEED');
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error('seed failed', { message: (err as Error).message });
      process.exit(1);
    });
}
