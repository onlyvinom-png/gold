import 'dotenv/config';
import { z } from 'zod';

/**
 * Server-side configuration. Secrets NEVER leave the backend.
 * If MARKET_DATA_PROVIDER is left as "demo" or no API key is provided the app
 * starts in DEMO mode with a visible warning (never fake "live" prices).
 */
const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@127.0.0.1:5432/goldscope'),
  MARKET_DATA_PROVIDER: z.string().default('demo'),
  TWELVEDATA_API_KEY: z.string().optional(),
  MARKET_DATA_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  MARKET_DATA_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  MARKET_DATA_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(8),
  DEFAULT_SYMBOL: z.string().default('XAU/USD'),
  DEFAULT_TIMEFRAME: z.string().default('1h'),
  DEFAULT_TIMEZONE: z.string().default('Africa/Casablanca'),
  DATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(3600),
  ANALYSIS_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(5),
  SCHEDULER_ENABLED: bool(true),
  ADMIN_API_KEY: z.string().optional(),
  CORS_ORIGIN: z.string().default('*'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  NOTIFY_EMAIL_TO: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('[env] invalid configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
