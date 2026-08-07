import { z } from 'zod';

/**
 * Semua environment variable yang dibaca API.
 * Nilainya divalidasi saat boot supaya salah konfigurasi ketahuan lebih awal,
 * bukan pas request pertama masuk.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(4000),

  // PostgreSQL
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_DB: z.string().default('formz'),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
  /** Kalau diisi, dipakai apa adanya dan menimpa POSTGRES_* di atas. */
  DATABASE_URL: z.string().optional(),
  POSTGRES_POOL_MAX: z.coerce.number().int().positive().default(10),

  // Redis (cache + broker BullMQ)
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().nonnegative().default(0),
  /** Kalau diisi, dipakai apa adanya dan menimpa REDIS_* di atas. */
  REDIS_URL: z.string().optional(),

  // CORS untuk dashboard admin (endpoint publik punya whitelist per form sendiri)
  DASHBOARD_URL: z.string().default('http://localhost:3000'),
  EMBED_URL: z.string().default('http://localhost:5173'),

  // Auth. Dua secret sengaja dipisah supaya access token yang bocor tidak bisa
  // dipakai untuk menempa refresh token, dan sebaliknya.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET minimal 32 karakter'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET minimal 32 karakter'),
  // Format durasi ala `ms`: 15m, 7d, 3600. Divalidasi di sini supaya cast tipe
  // di TokenService punya dasar yang jelas.
  JWT_EXPIRES_IN: z
    .string()
    .regex(/^\d+(ms|s|m|h|d|w|y)?$/, 'Format durasi tidak valid (contoh: 15m, 7d, 3600)')
    .default('15m'),
  JWT_REFRESH_EXPIRES_IN: z
    .string()
    .regex(/^\d+(ms|s|m|h|d|w|y)?$/, 'Format durasi tidak valid (contoh: 15m, 7d, 3600)')
    .default('7d'),
  /** Cost factor bcrypt untuk hash password. */
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  // Object storage (MinIO / S3-compatible)
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default('true')
    .transform((value) => value === 'true'),
});

export type Env = z.infer<typeof envSchema>;

/** Dipakai sebagai `validate` di ConfigModule.forRoot(). */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Konfigurasi environment tidak valid:\n${details}`);
  }

  return parsed.data;
}

export function buildDatabaseUrl(env: Env): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;

  const user = encodeURIComponent(env.POSTGRES_USER);
  const password = encodeURIComponent(env.POSTGRES_PASSWORD);
  return `postgresql://${user}:${password}@${env.POSTGRES_HOST}:${env.POSTGRES_PORT}/${env.POSTGRES_DB}`;
}

export function buildRedisUrl(env: Env): string {
  if (env.REDIS_URL) return env.REDIS_URL;

  const auth = env.REDIS_PASSWORD ? `:${encodeURIComponent(env.REDIS_PASSWORD)}@` : '';
  return `redis://${auth}${env.REDIS_HOST}:${env.REDIS_PORT}/${env.REDIS_DB}`;
}
