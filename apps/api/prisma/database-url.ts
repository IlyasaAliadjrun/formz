/**
 * Menyusun connection string PostgreSQL untuk perintah Prisma CLI (migrate/seed).
 *
 * Dipakai oleh prisma.config.ts dan prisma/seed.ts. Logikanya sengaja disamakan
 * dengan `buildDatabaseUrl()` di src/config/env.schema.ts: DATABASE_URL menang
 * kalau diisi, kalau tidak URL disusun dari POSTGRES_* dengan user & password
 * yang sudah di-encode.
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;

  const user = env.POSTGRES_USER;
  const password = env.POSTGRES_PASSWORD;

  // `prisma generate` tidak butuh koneksi database, jadi jangan lempar error di
  // sini — biar `prisma migrate`/`seed` saja yang gagal dengan pesan jelas.
  if (!user || !password) return '';

  const host = env.POSTGRES_HOST ?? 'localhost';
  const port = env.POSTGRES_PORT ?? '5432';
  const database = env.POSTGRES_DB ?? 'formz';

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

export function requireDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = resolveDatabaseUrl(env);

  if (!url) {
    throw new Error(
      'Koneksi database tidak diketahui. Isi DATABASE_URL, atau POSTGRES_USER + POSTGRES_PASSWORD di .env.',
    );
  }

  return url;
}
