# PROGRESS — Formz

Catatan progres lintas sesi. Setiap part yang selesai dicentang di sini, lengkap dengan
tanggal dan catatan singkat, supaya sesi berikutnya bisa langsung menyambung tanpa menebak-nebak.

**Status saat ini:** Part 0 selesai. Berikutnya: Part 1 (skema database & migrasi).

| Part | Judul                                    | Status     |
| ---- | ---------------------------------------- | ---------- |
| 0    | Scaffolding & environment development    | ✅ Selesai |
| 1    | Skema database & lapisan data            | ⬜ Belum   |
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

- Belum ada ORM. `apps/api` memakai `pg.Pool` mentah lewat token DI `PG_POOL`; keputusan
  ORM/query builder (Drizzle / Prisma / TypeORM) diambil di Part 1.
- Belum ada tabel apa pun di database — Postgres masih kosong.
- `packages/shared` dikonsumsi dalam bentuk hasil build (`dist/`). Setelah mengubah shared,
  jalankan `docker compose run --rm shared-build`.

---

## ⬜ Part 1 — Skema database & lapisan data

- [ ] Pilih & pasang ORM/query builder + tooling migrasi
- [ ] Tabel `users`, `roles`, `permissions`, `role_permissions`, `user_roles`
- [ ] Tabel `forms` (kolom `form_key` publik & acak) + `form_versions` (schema JSONB per versi)
- [ ] Tabel `submissions` (jawaban JSONB + `schema_version_id` sebagai snapshot)
- [ ] Tabel `form_integrations` & `submission_integration_logs`
- [ ] GIN index pada kolom JSONB jawaban
- [ ] Seed data awal (super admin + form contoh)
- [ ] Script migrate & rollback, terhubung ke `docker compose`

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
