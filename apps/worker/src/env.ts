import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Saat dijalankan lewat `pnpm --filter @formz/worker dev`, cwd-nya apps/worker,
// jadi .env di root repo perlu dimuat manual. Di Docker, env sudah disuntik compose.
loadDotenv({
  path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../../.env')],
  quiet: true,
});

/**
 * Variabel opsional berupa teks: **string kosong sama artinya dengan tidak diisi**.
 *
 * Compose menulis `GOOGLE_PRIVATE_KEY: ${GOOGLE_PRIVATE_KEY:-}`, jadi variabel
 * yang sengaja dikosongkan sampai ke sini sebagai string kosong, bukan sebagai
 * absen. Tanpa penyeragaman ini `.min(1).optional()` menolaknya dan worker gagal
 * start — padahal instalasi yang tidak memakai spreadsheet berhak mengosongkannya.
 * Aturan yang sama berlaku di apps/api/src/config/env.schema.ts.
 */
function optionalText(schema: z.ZodString = z.string().trim().min(1)) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema.optional(),
  );
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_DB: z.string().default('formz'),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
  DATABASE_URL: optionalText(z.string()),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: optionalText(z.string()),
  REDIS_DB: z.coerce.number().int().nonnegative().default(0),
  REDIS_URL: optionalText(z.string()),

  /** Berapa job yang boleh diproses bersamaan per queue. */
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),

  /**
   * Kredensial service account Google. Opsional supaya worker tetap bisa hidup
   * dan memproses notifikasi email di instalasi yang tidak memakai spreadsheet;
   * job sheet-sync-lah yang gagal dengan pesan jelas, bukan seluruh service yang
   * menolak start.
   */
  GOOGLE_SERVICE_ACCOUNT_EMAIL: optionalText(),
  GOOGLE_PRIVATE_KEY: optionalText(z.string().min(1)),

  /** `console` = email hanya dicetak ke log, tidak benar-benar dikirim. */
  MAIL_PROVIDER: z.enum(['smtp', 'console']).default('console'),
  SMTP_HOST: optionalText(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  SMTP_USER: optionalText(z.string()),
  SMTP_PASSWORD: optionalText(z.string()),
  MAIL_FROM: optionalText(),

  /** Base URL dashboard, dipakai untuk tautan "buka submission" di isi email. */
  DASHBOARD_URL: z.url().default('http://localhost:3000'),
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

/**
 * Private key PEM di file `.env` ditulis satu baris dengan `\n` literal,
 * karena format .env tidak mengenal nilai multi-baris. Bentuk aslinya
 * dikembalikan di sini supaya pemanggilnya tidak perlu tahu soal itu.
 */
export function googlePrivateKey(): string | null {
  if (!env.GOOGLE_PRIVATE_KEY) return null;

  // Tanda kutip pembungkus ikut terbawa kalau nilainya di-export langsung dari
  // shell atau disuntik lewat `docker run -e`. OpenSSL menolak kunci seperti itu
  // dengan pesan yang tidak menyebut kutipnya sama sekali, jadi dibuang di sini.
  const unquoted = env.GOOGLE_PRIVATE_KEY.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');

  return unquoted.replace(/\\n/g, '\n');
}

export function buildRedisUrl(): string {
  if (env.REDIS_URL) return env.REDIS_URL;

  const auth = env.REDIS_PASSWORD ? `:${encodeURIComponent(env.REDIS_PASSWORD)}@` : '';
  return `redis://${auth}${env.REDIS_HOST}:${env.REDIS_PORT}/${env.REDIS_DB}`;
}
