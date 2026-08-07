import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Saat dijalankan lewat `pnpm --filter @formz/worker dev`, cwd-nya apps/worker,
// jadi .env di root repo perlu dimuat manual. Di Docker, env sudah disuntik compose.
loadDotenv({
  path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../../.env')],
  quiet: true,
});

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_DB: z.string().default('formz'),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
  DATABASE_URL: z.string().optional(),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().nonnegative().default(0),
  REDIS_URL: z.string().optional(),

  /** Berapa job yang boleh diproses bersamaan per queue. */
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),

  // Integrasi (belum dipakai di scaffolding, sengaja opsional)
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().optional(),
});

export type WorkerEnv = z.infer<typeof envSchema>;

function parseEnv(): WorkerEnv {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Konfigurasi environment worker tidak valid:\n${details}`);
  }

  return parsed.data;
}

export const env = parseEnv();

export function buildDatabaseUrl(): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;

  const user = encodeURIComponent(env.POSTGRES_USER);
  const password = encodeURIComponent(env.POSTGRES_PASSWORD);
  return `postgresql://${user}:${password}@${env.POSTGRES_HOST}:${env.POSTGRES_PORT}/${env.POSTGRES_DB}`;
}

export function buildRedisUrl(): string {
  if (env.REDIS_URL) return env.REDIS_URL;

  const auth = env.REDIS_PASSWORD ? `:${encodeURIComponent(env.REDIS_PASSWORD)}@` : '';
  return `redis://${auth}${env.REDIS_HOST}:${env.REDIS_PORT}/${env.REDIS_DB}`;
}
