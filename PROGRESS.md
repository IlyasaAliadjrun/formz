# PROGRESS — Formz

Catatan progres lintas sesi. Setiap part yang selesai dicentang di sini, lengkap dengan
tanggal dan catatan singkat, supaya sesi berikutnya bisa langsung menyambung tanpa menebak-nebak.

**Status saat ini:** Part 1 selesai. Berikutnya: Part 2 (Auth & RBAC).

| Part | Judul                                    | Status     |
| ---- | ---------------------------------------- | ---------- |
| 0    | Scaffolding & environment development    | ✅ Selesai |
| 1    | Skema database & lapisan data            | ✅ Selesai |
| 2    | Auth & RBAC                              | ⬜ Belum   |
| 3    | Form CRUD & schema engine (API)          | ⬜ Belum   |
| 4    | Form builder UI (dashboard)              | ⬜ Belum   |
| 5    | Form renderer & embed                    | ⬜ Belum   |
| 6    | Submission management                    | ⬜ Belum   |
| 7    | Integrasi Google Sheets (queue + worker) | ⬜ Belum   |
| 8    | Workflow notifikasi email                | ⬜ Belum   |
| 9    | Reporting & export                       | ⬜ Belum   |
| 10   | Deployment self-hosted & operasional     | ⬜ Belum   |

---

## ✅ Part 0 — Scaffolding & environment development

_Selesai: 7 Agustus 2026_

- [x] Monorepo pnpm workspaces (`apps/*`, `packages/*`)
- [x] `packages/shared` — tipe TypeScript & schema Zod bersama (field type, form schema, rule
      kondisi, payload submission, nama queue, RBAC, health)
- [x] `apps/api` — NestJS + TypeScript, struktur module kosong (auth, users, rbac, forms,
      submissions, integrations, reporting, storage, queue)
- [x] `apps/api` — endpoint `GET /health` yang melaporkan koneksi Postgres & Redis
      (200 kalau semua up, 503 + `status: degraded` kalau ada yang down)
- [x] `apps/worker` — service BullMQ terpisah, consumer `sheet-sync` & `email-notification`
      (masih placeholder), share kode lewat `@formz/shared`
- [x] `apps/dashboard` — Next.js + Tailwind CSS 4 + shadcn/ui, halaman utama placeholder
- [x] `apps/embed` — Preact + Vite, halaman placeholder "Form renderer akan tampil di sini"
- [x] `docker-compose.yml` — postgres, redis, minio, api, worker, dashboard, embed
      (+ helper `deps`, `shared-build`, `minio-init`)
- [x] `.env.example` dengan seluruh variabel yang dibutuhkan, tanpa kredensial hardcoded
- [x] ESLint 9 (flat config) + Prettier 3 konsisten di semua apps
- [x] `README.md` — cara menjalankan project secara lokal
- [x] `PROGRESS.md` — checklist Part 0–10

**Terverifikasi:**

- `docker compose up` menjalankan seluruh service tanpa error
- `GET /health` mengembalikan `{"status":"ok"}` dengan Postgres & Redis `up`
- `pnpm -r typecheck` dan `pnpm -r lint` bersih di kelima project

**Catatan untuk part berikutnya:**

- ~~Belum ada ORM~~ → diselesaikan di Part 1: Prisma, `PG_POOL` sudah dihapus.
- ~~Belum ada tabel apa pun di database~~ → diselesaikan di Part 1.
- `packages/shared` dikonsumsi dalam bentuk hasil build (`dist/`). Setelah mengubah shared,
  jalankan `docker compose run --rm shared-build`.

---

## ✅ Part 1 — Skema database & lapisan data

_Selesai: 7 Agustus 2026_

- [x] Pasang **Prisma 7.9.1** sebagai ORM + tooling migrasi di `apps/api`
- [x] Tabel `users`, `roles`, `permissions`, `role_permissions`, `user_roles`
- [x] Tabel `forms` (kolom `form_key` publik & acak) + `form_versions` (schema JSONB per versi)
- [x] Tabel `submissions` (jawaban JSONB + `form_version_id` sebagai snapshot)
- [x] Tabel `integrations`, `notification_rules`, `submission_integration_logs`
- [x] GIN index (`jsonb_path_ops`) pada `submissions.answers`
- [x] Seed idempotent: 8 permission, 3 role, 1 user admin (password dari env)
- [x] `PrismaService`/`PrismaModule` + health check pindah dari `pg.Pool` ke Prisma
- [x] Service `db-setup` di docker-compose: generate → migrate deploy → seed

**Terverifikasi:**

- `docker compose up` dari kondisi bersih: 12 tabel terbentuk, seed jalan, semua service healthy
- Seed dijalankan dua kali tidak menghasilkan duplikat (users=1, roles=3, permissions=8,
  role_permissions=17, user_roles=1)
- `GET /health` tetap `{"status":"ok"}` — sekarang lewat `prisma.$queryRaw`
- `pnpm -r typecheck`, `pnpm -r lint`, dan `pnpm --filter @formz/api build` bersih

### Keputusan desain

**ORM: Prisma, bukan TypeORM.** Alasan utamanya:

1. **Migrasi.** Prisma menghasilkan file SQL yang bisa dibaca dan di-review sebelum
   dijalankan, dengan riwayat yang tercatat di tabel `_prisma_migrations`. Migrasi TypeORM
   umumnya ditulis tangan atau di-generate dari perbandingan entity, dan lebih rawan
   menyimpang dari kondisi database sebenarnya.
2. **JSONB + type safety.** Tiga kolom inti (`form_versions.schema`, `submissions.answers`,
   `integrations.config`) berbentuk JSONB. Prisma memetakannya ke `Prisma.JsonValue`, yang
   memaksa penyempitan tipe secara eksplisit — dan penyempitan itu kita lakukan dengan schema
   Zod dari `@formz/shared`. Jadi satu sumber kebenaran tetap terjaga.
3. **Tanpa engine Rust.** Prisma 7 memakai query compiler + driver adapter (`@prisma/adapter-pg`).
   Tidak ada binary engine yang perlu cocok dengan musl/OpenSSL di container Alpine — sumber
   masalah yang cukup umum di setup self-hosted berbasis Alpine.

Integrasi dengan NestJS tetap rapi lewat `PrismaService extends PrismaClient` yang dipasang
sebagai provider global — memang tidak se-"NestJS-native" `@nestjs/typeorm`, tapi itu satu
file, sekali tulis.

**Catatan desain lain:**

- **Primary key UUIDv7** (`uuid(7)`), bukan auto-increment. Untuk `forms` ini wajib karena
  `form_key` muncul di URL publik dan tidak boleh bisa ditebak; UUIDv7 dipilih karena
  terurut secara waktu sehingga tidak memfragmentasi index seperti UUIDv4.
- **`onDelete` sengaja tidak seragam.** `submissions` memakai `Restrict` terhadap `forms` dan
  `form_versions` — menghapus form yang sudah punya jawaban akan ditolak database, jadi form
  harus diarsipkan, bukan dihapus. Sebaliknya `integrations`, `notification_rules`, dan
  `submission_integration_logs` memakai `Cascade` karena tidak punya nilai tanpa induknya.
- **Idempotency job** ditegakkan di level database lewat
  `@@unique([submissionId, type, target])` pada `submission_integration_logs`. Worker
  meng-`upsert` baris ini, jadi retry menaikkan `retry_count` alih-alih menambah baris —
  ini yang mencegah baris dobel di spreadsheet atau email terkirim dua kali.
- **`notification_rules` punya dua kolom penerima.** `recipients` (text[]) untuk daftar email
  tetap, `recipient_rules` (JSONB) untuk tujuan dinamis berdasarkan jawaban. Keduanya bisa
  dipakai bersamaan dan hasilnya digabung.
- **Password di-hash dengan bcryptjs** (cost 12) — implementasi JavaScript murni, tanpa
  binary native, jadi tidak ada langkah kompilasi di Alpine. Bisa ditukar ke argon2id di
  Part 2 kalau memang diinginkan.
- **Seed tidak menimpa password** user yang sudah ada. `ADMIN_PASSWORD` hanya dipakai saat
  user pertama kali dibuat, supaya password yang sudah diganti admin tidak dikembalikan ke
  nilai `.env` setiap `docker compose up`.
- **Kredensial integrasi tidak disimpan di database.** `integrations.config` hanya memuat
  referensi (`credentialRef`); kredensial Google tetap di environment variable.

**Catatan untuk part berikutnya:**

- `apps/worker` masih memakai `pg.Pool` mentah, belum Prisma. Kalau worker nanti perlu akses
  tabel yang kaya, pertimbangkan memindahkan schema Prisma ke `packages/db` supaya bisa
  dipakai bersama api dan worker.
- Belum ada tabel template email; `notification_rules.email_template_id` masih kolom teks
  biasa dan baru akan menjadi foreign key di Part 8.
- Belum ada seed form contoh — baru role, permission, dan user admin.
- `submissions.answers` sudah punya GIN index, tapi belum ada query yang memakainya.

## ⬜ Part 2 — Auth & RBAC

- [ ] Login/logout, JWT access + refresh token
- [ ] Hash password + rotasi refresh token
- [ ] CASL ability factory + guard permission granular per resource
- [ ] CRUD user & role di API
- [ ] Halaman login + proteksi route di dashboard
- [ ] Manajemen user & role di dashboard

## ⬜ Part 3 — Form CRUD & schema engine (API)

- [ ] CRUD form (admin, butuh auth + RBAC)
- [ ] Versioning schema: bikin versi baru saat form yang sudah punya submission diedit
- [ ] Validasi schema form pakai Zod dari `@formz/shared`
- [ ] Endpoint publik `GET /public/forms/:formKey/schema` (read-only, data minimal)
- [ ] Cache schema form di Redis + invalidasi saat form diupdate
- [ ] Publish/unpublish/archive form

## ⬜ Part 4 — Form builder UI (dashboard)

- [ ] Registry field type (satu komponen per field type)
- [ ] Drag & drop susun + reorder field (dnd-kit)
- [ ] Panel properti field (label, validasi, opsi)
- [ ] Condition builder show/hide sampai level opsi
- [ ] State management builder (Zustand)
- [ ] Preview form + simpan sebagai draft/publish
- [ ] Pengaturan form: pesan sukses, redirect, whitelist domain embed

## ⬜ Part 5 — Form renderer & embed

- [ ] Route `/f/:formKey` mengambil schema publik
- [ ] Render semua field type sesuai registry
- [ ] Evaluasi conditional show/hide di client
- [ ] Validasi client-side pakai Zod dari `@formz/shared`
- [ ] Submit jawaban ke endpoint publik
- [ ] Upload file lewat presigned URL ke MinIO
- [ ] Auto-resize iframe & notifikasi ke parent lewat `postMessage`
- [ ] Snippet embed (iframe + script tag) + halaman contoh
- [ ] Cek ukuran bundle (target tetap kecil)

## ⬜ Part 6 — Submission management

- [ ] Endpoint publik `POST /public/forms/:formKey/submit`
- [ ] Validasi ulang jawaban di server, termasuk evaluasi ulang rule show/hide
- [ ] CORS whitelist per form + rate limit per `formKey`/IP
- [ ] Simpan snapshot `schema_version_id` di setiap submission
- [ ] List submission dengan pagination/filter/sort server-side (TanStack Table)
- [ ] Detail submission per field + status integrasi (spreadsheet & email)
- [ ] Hapus/arsip submission sesuai permission

## ⬜ Part 7 — Integrasi Google Sheets (queue + worker)

- [ ] Producer BullMQ di API saat submission masuk
- [ ] Job `sync-to-sheet` idempotent (key = `submission_id`)
- [ ] Autentikasi service account + Google Sheets API v4 (append row)
- [ ] Retry + exponential backoff, tulis hasil ke `submission_integration_logs`
- [ ] UI konfigurasi target spreadsheet & mapping kolom per form
- [ ] Aksi retry manual dari dashboard
- [ ] Bull Board untuk memantau queue

## ⬜ Part 8 — Workflow notifikasi email

- [ ] Job `send-notification` idempotent + retry
- [ ] Integrasi SMTP relay (Postmark/SES)
- [ ] Template email (React Email/MJML) dengan isi jawaban submission
- [ ] Konfigurasi penerima notifikasi per form (termasuk auto-reply ke pengisi)
- [ ] Trigger berbasis kondisi jawaban
- [ ] Log status kirim (delivered/bounced) di `submission_integration_logs`

## ⬜ Part 9 — Reporting & export

- [ ] Query agregasi + materialized view untuk report berat
- [ ] Jadwal refresh materialized view
- [ ] Chart ringkasan submission (Recharts)
- [ ] Filter periode & per form
- [ ] Export .xlsx (ExcelJS) dan .csv
- [ ] Batasi akses report lewat RBAC

## ⬜ Part 10 — Deployment self-hosted & operasional

- [ ] Dockerfile produksi (multi-stage) untuk api, worker, dashboard, embed
- [ ] `docker-compose.prod.yml` + reverse proxy Caddy/Nginx dengan auto-HTTPS
- [ ] Routing domain: `app.`, `api.`, `embed.`
- [ ] Systemd unit supaya stack otomatis naik setelah reboot
- [ ] `deploy.sh` (git pull → build → up -d → migrate)
- [ ] Backup terjadwal: `pg_dump` + folder MinIO → rclone ke offsite, **plus tes restore**
- [ ] Monitoring: Netdata + Sentry + Bull Board
- [ ] Hardening server: UFW, Fail2ban, SSH key-only, unattended-upgrades
- [ ] Rotasi log (logrotate / Loki)
- [ ] Runbook operasional
