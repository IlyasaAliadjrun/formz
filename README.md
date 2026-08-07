# Formz

Form builder self-hosted (pengganti Jotform): bikin form, embed di website lain, kelola submission,
sync ke Google Sheets, dan kirim notifikasi email otomatis.

Referensi arsitektur & keputusan tech stack ada di [ARCHITECTURE.md](./ARCHITECTURE.md).
Progres pengerjaan per part dicatat di [PROGRESS.md](./PROGRESS.md).

---

## Struktur Monorepo

Monorepo pnpm workspaces:

```
formz/
├── apps/
│   ├── api/          NestJS + TypeScript — REST API (admin & publik)
│   ├── worker/       Proses BullMQ terpisah — sync spreadsheet & email
│   ├── dashboard/    Next.js + Tailwind + shadcn/ui — admin dashboard
│   └── embed/        Preact + Vite — form renderer yang di-embed
├── packages/
│   └── shared/       Tipe TypeScript & schema Zod yang dipakai bersama
├── docker/
│   └── dev.Dockerfile
├── docker-compose.yml
└── .env.example
```

`@formz/shared` adalah satu-satunya sumber definisi field type, form schema, rule kondisi,
payload submission, dan nama queue — dipakai oleh keempat app supaya tidak ada duplikasi tipe.

| Service     | Port | Keterangan                         |
| ----------- | ---- | ---------------------------------- |
| `dashboard` | 3000 | Admin dashboard (Next.js)          |
| `api`       | 4000 | Backend API (NestJS)               |
| `embed`     | 5173 | Form renderer (Vite dev server)    |
| `postgres`  | 5432 | Database utama                     |
| `redis`     | 6379 | Cache + broker BullMQ              |
| `minio`     | 9000 | Object storage S3-compatible (API) |
| `minio`     | 9001 | MinIO console (UI)                 |
| `worker`    | —    | Proses BullMQ, tidak expose port   |

---

## Menjalankan Secara Lokal

### Prasyarat

Cukup **Docker Engine + Docker Compose plugin**. Node.js dan pnpm **tidak perlu diinstall di
host** — semuanya jalan di dalam container, termasuk `pnpm install`.

```bash
docker --version          # butuh Docker Engine
docker compose version    # butuh Compose v2
```

### 1. Siapkan file `.env`

```bash
cp .env.example .env
```

Lalu buka `.env` dan ganti semua nilai yang diawali `ganti-dengan-...`. Untuk secret,
generate nilai acak:

```bash
openssl rand -hex 32
```

Minimal yang wajib diisi supaya stack bisa naik: `POSTGRES_PASSWORD`, `REDIS_PASSWORD`,
`MINIO_ROOT_PASSWORD`. Compose akan menolak jalan (dengan pesan jelas) kalau variabel wajib kosong.

### 2. Jalankan semua service

```bash
docker compose up
```

Atau di background:

```bash
docker compose up -d
docker compose logs -f
```

Urutan start-up sudah diatur otomatis:

1. `deps` — `pnpm install --frozen-lockfile` untuk seluruh workspace (sekali jalan, lalu exit)
2. `shared-build` — build `@formz/shared` ke `dist/` (sekali jalan, lalu exit)
3. `postgres`, `redis`, `minio` — ditunggu sampai status **healthy**
4. `db-setup` — `prisma generate` → `prisma migrate deploy` → `prisma db seed` (idempotent)
5. `minio-init` — bikin bucket upload kalau belum ada
6. `api`, `worker`, `dashboard`, `embed` — baru start setelah semuanya siap

Run pertama butuh beberapa menit (download image + install dependency). Run berikutnya jauh
lebih cepat karena `node_modules` dan store pnpm sudah ada di folder project.

### 3. Cek semuanya jalan

```bash
curl http://localhost:4000/health
```

Respons yang diharapkan:

```json
{
  "status": "ok",
  "service": "formz-api",
  "version": "0.1.0",
  "uptimeSeconds": 12,
  "timestamp": "2026-01-01T00:00:00.000Z",
  "dependencies": {
    "postgres": { "status": "up", "latencyMs": 3 },
    "redis": { "status": "up", "latencyMs": 1 }
  }
}
```

Endpoint mengembalikan **HTTP 200** kalau Postgres & Redis dua-duanya terhubung, dan
**HTTP 503** dengan `"status": "degraded"` kalau ada yang gagal — detail per dependency
tetap ikut di body supaya kelihatan mana yang bermasalah.

Lalu buka di browser:

| URL                          | Isi                                        |
| ---------------------------- | ------------------------------------------ |
| http://localhost:3000        | Admin dashboard (placeholder)              |
| http://localhost:5173        | Form renderer (placeholder)                |
| http://localhost:4000/health | Health check API                           |
| http://localhost:9001        | MinIO console (login pakai `MINIO_ROOT_*`) |

### 4. Menghentikan

```bash
docker compose down            # stop, data tetap ada
docker compose down -v         # stop + hapus volume (database & file ikut terhapus)
```

---

## Perintah Sehari-hari

Semua perintah di bawah dijalankan **di dalam container** (host tidak perlu punya Node):

```bash
# Masuk ke shell salah satu service
docker compose exec api sh

# Install dependency baru untuk satu app
docker compose run --rm deps pnpm --filter @formz/api add <paket>

# Rebuild package shared setelah mengubah tipe/schema
docker compose run --rm shared-build

# Lint & format seluruh monorepo
docker compose run --rm deps pnpm lint
docker compose run --rm deps pnpm format

# Typecheck seluruh monorepo
docker compose run --rm deps pnpm typecheck
```

### Database (Prisma)

```bash
# Terapkan migrasi yang belum jalan + seed (sama seperti yang jalan otomatis saat up)
docker compose run --rm db-setup

# Bikin migrasi baru setelah mengubah prisma/schema.prisma
docker compose run --rm deps pnpm --filter @formz/api db:migrate --name nama_perubahan

# Lihat status migrasi
docker compose run --rm deps pnpm --filter @formz/api db:migrate:status

# Reset database (HAPUS SEMUA DATA, lalu migrate + seed ulang)
docker compose run --rm deps pnpm --filter @formz/api db:migrate:reset

# Seed saja
docker compose run --rm deps pnpm --filter @formz/api db:seed
```

Seed membuat 8 permission, 3 role (Super Admin, Form Manager, Viewer), dan satu user admin
dari `ADMIN_EMAIL` + `ADMIN_PASSWORD` di `.env`. Kalau dua variabel itu kosong, pembuatan user
admin dilewati dengan peringatan — service lain tetap jalan. Password hanya diterapkan saat
user pertama kali dibuat, jadi password yang sudah diganti tidak akan ditimpa balik.

Kalau kamu memang punya Node 22 + pnpm di host, bisa juga jalan langsung:

```bash
pnpm install
pnpm shared:build
pnpm dev            # menjalankan keempat app paralel
```

Catatan: `.env.example` mengisi `POSTGRES_HOST=postgres` dan `REDIS_HOST=redis` (nama service
di jaringan Docker). Kalau app dijalankan langsung di host sementara database tetap di Docker,
ganti keduanya jadi `localhost`.

---

## Hot Reload

Source code di-bind mount ke container, jadi perubahan file langsung terbaca:

- `api` — `nest start --watch`
- `worker` — `tsx watch`
- `dashboard` — `next dev` (Turbopack)
- `embed` — `vite` (HMR)

Perubahan di `packages/shared` **tidak** otomatis terbaca karena app membaca hasil build-nya.
Setelah mengubah shared, jalankan:

```bash
docker compose run --rm shared-build
```

atau jalankan watcher-nya: `docker compose run --rm deps pnpm --filter @formz/shared dev`.

---

## Troubleshooting

**`docker compose up` berhenti dengan pesan "POSTGRES_PASSWORD wajib diisi di .env"**
File `.env` belum dibuat atau variabelnya kosong. Jalankan `cp .env.example .env` lalu isi.

**Port sudah dipakai (`address already in use`)**
Ganti port host di `.env` — misal `DASHBOARD_PORT=3001`. Port internal container tidak berubah.

**`ERR_PNPM_OUTDATED_LOCKFILE` di service `deps`**
`package.json` berubah tapi `pnpm-lock.yaml` belum diperbarui. Jalankan:

```bash
docker compose run --rm deps pnpm install --no-frozen-lockfile
```

**Perubahan file tidak terdeteksi (hot reload diam)**
Sebagian filesystem tidak meneruskan event inotify ke container. Untuk `embed`, set
`VITE_USE_POLLING=true` di `.env`.

**Mau mulai benar-benar dari nol**

```bash
docker compose down -v
rm -rf node_modules apps/*/node_modules packages/*/node_modules .pnpm-store
docker compose up
```

---

## Stack

| Layer          | Teknologi                                           |
| -------------- | --------------------------------------------------- |
| Dashboard      | Next.js 16, React 19, Tailwind CSS 4, shadcn/ui     |
| Form renderer  | Preact 10, Vite 7                                   |
| API            | NestJS 11, TypeScript 5.9                           |
| ORM            | Prisma 7 (driver adapter `pg`, tanpa engine Rust)   |
| Worker         | BullMQ 6, tsx                                       |
| Shared         | Zod 4                                               |
| Database       | PostgreSQL 17 (JSONB)                               |
| Cache & queue  | Redis 7                                             |
| Object storage | MinIO (S3-compatible)                               |
| Tooling        | pnpm workspaces, ESLint 9 (flat config), Prettier 3 |
