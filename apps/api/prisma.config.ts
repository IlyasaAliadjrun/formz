import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';
import { resolveDatabaseUrl } from './prisma/database-url';

// Prisma 7 tidak lagi memuat .env otomatis — dilakukan manual di sini.
// Dijalankan baik dari apps/api maupun dari root repo.
loadDotenv({
  path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../../.env')],
  quiet: true,
});

export default defineConfig({
  schema: 'prisma/schema.prisma',

  // Hanya dipakai CLI (migrate/introspect). Koneksi runtime aplikasi memakai
  // driver adapter di src/infrastructure/prisma/prisma.service.ts.
  datasource: {
    url: resolveDatabaseUrl(),
  },

  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
});
