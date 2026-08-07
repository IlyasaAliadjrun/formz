# PROGRESS — Formz

Catatan progres lintas sesi. Setiap part yang selesai dicentang di sini, lengkap dengan
tanggal dan catatan singkat, supaya sesi berikutnya bisa langsung menyambung tanpa menebak-nebak.

**Status saat ini:** Part 3 selesai di sisi API. Berikutnya: Part 4 (Form builder UI).

| Part | Judul                                    | Status     |
| ---- | ---------------------------------------- | ---------- |
| 0    | Scaffolding & environment development    | ✅ Selesai |
| 1    | Skema database & lapisan data            | ✅ Selesai |
| 2    | Auth & RBAC                              | ✅ Selesai |
| 3    | Form CRUD & schema engine (API)          | ✅ Selesai |
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

## ✅ Part 2 — Auth & RBAC

_Selesai: 7 Agustus 2026 (sisi API; UI-nya di Part 4)_

- [x] `POST /admin/auth/login` — email + password ditukar access token + refresh token
- [x] `POST /admin/auth/refresh` — rotasi token, token lama langsung dicabut
- [x] `POST /admin/auth/logout` — mencabut refresh token
- [x] `GET /admin/auth/me` — user + roles + permissions efektif
- [x] Hash password bcrypt (cost dari `BCRYPT_ROUNDS`) + rotasi refresh token
- [x] `CaslAbilityFactory` yang membangun ability dari tabel `role_permissions`
- [x] `@RequirePermission('form.create')` + `PermissionsGuard` global
- [x] `JwtAuthGuard` global — seluruh endpoint tertutup default, `@Public()` untuk opt-out
- [x] `GET/POST/PUT/DELETE /admin/users` dengan permission `user.manage`
- [x] 22 unit & integration test (Jest + supertest)
- [ ] Halaman login + proteksi route di dashboard → dipindah ke Part 4
- [ ] Manajemen user & role di dashboard → dipindah ke Part 4

**Terverifikasi (test otomatis, 22 lulus):**

- Login berhasil, password salah, email tidak terdaftar, akun nonaktif
- Pesan error email-tidak-ada dan password-salah identik (tidak bocor email terdaftar)
- Endpoint admin tanpa token → 401; skema non-Bearer → 401; token asing → 401
- Viewer mengakses `/admin/users` → 403; `/admin/auth/me` tetap 200
- Ability CASL: Super Admin penuh, Viewer terbatas, user nonaktif nihil

**Terverifikasi (curl ke stack yang jalan):**

- Rotasi refresh token bekerja; memakai ulang token lama → 401 dan seluruh sesi dicabut
- Logout → refresh berikutnya 401
- Nonaktifkan/hapus Super Admin terakhir ditolak dengan pesan jelas
- Hapus akun sendiri ditolak
- `/health` tetap bisa diakses tanpa token

### Keputusan desain

**Guard global, bukan per-controller.** `JwtAuthGuard` dan `PermissionsGuard` dipasang
lewat `APP_GUARD` di AppModule, urutannya autentikasi dulu baru otorisasi. Artinya setiap
endpoint baru tertutup secara default dan harus menyatakan diri lewat `@Public()` kalau
memang mau terbuka — kebalikan dari pola "pasang guard satu per satu" yang gagal terbuka
begitu ada controller yang lupa didekorasi.

Sebagai lapis tambahan, `@Public()` **ditolak** pada path `/admin/*` kecuali dua endpoint
di allowlist `ADMIN_ROUTES_WITHOUT_TOKEN` (login & refresh). Jadi namespace admin tidak bisa
terbuka karena kelalaian, sesuai syarat "semua endpoint /admin wajib lewat guard auth".

**Refresh token di Redis, bukan tabel Postgres.** Butuh TTL otomatis dan penghapusan cepat —
persis peran Redis sebagai penyimpan session di ARCHITECTURE.md bagian 3.4. Skemanya:
`auth:refresh:<jti>` → userId, plus set `auth:sessions:<userId>` berisi seluruh jti aktif
untuk keperluan cabut-semua. Redis di compose sudah `appendonly yes`, jadi sesi tidak hilang
saat container restart.

**Deteksi pemakaian ulang refresh token.** Kalau sebuah refresh token lolos verifikasi
kriptografis tapi jti-nya sudah tidak ada di Redis, berarti token itu sudah pernah dipakai —
indikasi token dicuri. Yang dilakukan bukan sekadar menolak request itu, tapi mencabut
**seluruh** sesi user tersebut.

**Permission dibaca dari database tiap request, tidak dititipkan di JWT.** Konsekuensinya
ada satu query per request admin, tapi pencabutan role berlaku seketika alih-alih menunggu
access token kedaluwarsa. Kalau nanti jadi bottleneck, cache Redis pendek bisa ditambahkan
di `UserPermissionsService` tanpa mengubah pemanggilnya.

**Katalog permission dipindah ke `@formz/shared`.** File `packages/shared/src/rbac.ts` dari
Part 0 masih berisi tebakan (`super_admin`, `PERMISSION_SUBJECTS`) yang tidak cocok dengan
isi database hasil seed Part 1. Sekarang isinya katalog sebenarnya: 8 permission lengkap
dengan terjemahan CASL-nya (`form.create` → action `create` pada subject `Form`) dan
3 definisi role. `prisma/seed.ts` mengimpor dari sana, jadi isi database, ability di API,
dan menu di dashboard tidak bisa lagi menyimpang satu sama lain.

**Perubahan akses mencabut sesi.** Mengganti role, password, atau menonaktifkan user otomatis
memanggil `revokeAllSessions` — tanpa itu, user yang baru diturunkan hak aksesnya masih bisa
memakai refresh token lamanya selama 7 hari.

**Pengaman anti-terkunci.** Super Admin aktif terakhir tidak bisa dihapus, dinonaktifkan,
atau dicabut role-nya; menghapus akun sendiri juga ditolak. Tanpa ini satu klik keliru bisa
membuat sistem tidak punya administrator sama sekali.

**Validasi pakai Zod, bukan class-validator.** `ZodValidationPipe` memakai schema yang sama
dengan yang dipakai form builder dan form renderer lewat `@formz/shared` — satu definisi,
tiga tempat pemakaian, sesuai ARCHITECTURE.md bagian 3.2.

**Tanpa Passport.js.** ARCHITECTURE.md menyebutnya sebagai opsi, bukan keharusan. `@nestjs/jwt`
plus satu guard sudah mencukupi dan menghemat tiga dependency; logika yang dibutuhkan
(muat user, cek `isActive`, muat permission) tetap harus ditulis sendiri di strategi Passport.

**Catatan untuk part berikutnya:**

- `moduleResolution` di `apps/api` dinaikkan ke `node16` supaya field `exports` milik
  `@casl/ability` terbaca. `tsconfig.spec.json` karenanya perlu `isolatedModules: true`.
- Access token yang sudah terbit tetap sah sampai kedaluwarsa walau user sudah logout —
  konsekuensi JWT stateless, dan alasan TTL-nya dibuat 15 menit. Kalau butuh pencabutan
  seketika, tambahkan denylist jti di Redis.
- Belum ada rate limit di endpoint login (brute-force). Masuk akal digabung dengan rate limit
  endpoint publik di Part 6.
- Belum ada CRUD role/permission — baru user. Role masih dikelola lewat seed.
- `GET /admin/users` sudah paginated, tapi belum ada endpoint untuk mengganti password sendiri
  (self-service), baru admin yang bisa mengganti password user lain.

## ✅ Part 3 — Form CRUD & schema engine (API)

_Selesai: 7 Agustus 2026_

- [x] Katalog 13 field type di `@formz/shared` beserta atribut per tipe
      (`FIELD_TYPE_DEFINITIONS`: producesAnswer, requiresOptions, answerKind, validationAttributes)
- [x] Struktur JSON schema form: daftar field berurut + validasi per tipe + conditional visibility
- [x] `evaluateConditions(schema, currentAnswers)` + `getEffectiveAnswers()` di `@formz/shared`
- [x] `validateFormSchema()` — id unik, referensi kondisi, siklus, rentang validasi
- [x] `GET /admin/forms` — pagination + filter status + pencarian judul (`form.view`)
- [x] `POST /admin/forms` — status default `draft` (`form.create`)
- [x] `GET /admin/forms/:id` — detail termasuk draft schema + hasil validasi (`form.view`)
- [x] `PUT /admin/forms/:id` — simpan draft, tidak membuat versi baru (`form.edit`)
- [x] `POST /admin/forms/:id/publish` — baris baru di `form_versions` (`form.publish`)
- [x] `DELETE /admin/forms/:id` — arsip kalau ada submission, hapus permanen kalau belum (`form.delete`)
- [x] `PUT /admin/forms/:id/embed-settings` — whitelist domain (`form.edit`)
- [x] Permission baru `form.view` ditambahkan ke katalog & seed
- [x] 36 test di `@formz/shared` + 15 test endpoint form di `apps/api`

**Terverifikasi:**

- Siklus hidup penuh lewat HTTP: buat → simpan draft → publish v1 → edit → publish v2.
  Isi `form_versions` menunjukkan tiga baris utuh dengan judul berbeda — versi lama
  tidak pernah tertimpa.
- Publish form kosong ditolak (`no_input_fields`); publish schema dengan kondisi menunjuk
  field tidak ada ditolak (`unknown_condition_field`) — sementara **menyimpan draft**-nya
  tetap boleh, karena builder harus bisa menyimpan pekerjaan setengah jadi.
- `DELETE` pada form tanpa submission menghapus permanen (GET berikutnya 404); pada form
  dengan submission mengubah status jadi `archived` dan submission tetap utuh.
- Whitelist embed dinormalkan: `https://Klien.Example.com/kontak` → `klien.example.com`.
- Viewer (hanya `form.view`) bisa membaca tapi ditolak 403 saat create/edit/delete;
  Editor tanpa `form.publish` ditolak 403 saat publish.
- `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` (79 test), dan `format:check` bersih.

### Keputusan desain

**Draft disimpan sebagai baris `form_versions` dengan `published_at` NULL.** Tidak ada kolom
`draft_schema` baru di tabel `forms`, jadi tidak perlu migrasi — kolom `published_at` yang
nullable dari Part 1 memang sudah dirancang untuk ini. Alurnya: `PUT` menimpa baris draft yang
sama (tidak menambah versi), `publish` menstempel `published_at` pada baris itu, dan `PUT`
berikutnya membuat baris draft baru dengan nomor versi berikutnya — salinan dari versi
terpublish terakhir. Hasilnya persis seperti yang diminta: mengedit tidak pernah membuat versi,
publish selalu membuat versi, dan versi lama tidak pernah ditimpa.

**Struktur field datar, bukan bersarang per halaman.** Urutan field ditentukan urutan array
`fields` — tidak ada kolom `order` terpisah yang bisa menyimpang dari urutan sebenarnya.
Pembagian bagian dilakukan lewat field `section_heading`, sesuai permintaan.

**Kondisi disimpan deklaratif, JSON Logic sebagai keluaran.** ARCHITECTURE.md menyebut
"JSON Logic based", tapi menyimpan pohon JSON Logic mentah membuat condition builder visual
sulit dibuat — pohon `{"and":[{"==":[...]}]}` tidak bisa dipetakan balik ke baris-baris UI
dengan andal. Yang disimpan adalah bentuk deklaratif dari contoh di ARCHITECTURE.md
(`action` + `logic` + `rules`), dan `conditionsToJsonLogic()` mengonversinya ke JSON Logic asli
untuk portabilitas. Evaluator sendiri ditulis tanpa dependensi.

**Evaluator berulang sampai stabil, bukan sekali jalan.** Visibilitas berantai: kalau A
menyembunyikan B, jawaban B harus dianggap kosong sehingga C yang bergantung pada B ikut
tersembunyi. Sekali jalan akan salah untuk rantai ini. Evaluasi diulang sampai hasilnya tidak
berubah, dengan batas iterasi supaya kondisi melingkar tidak menggantung.

**Validasi memisahkan error dan warning.** Error menghalangi publish (id dobel, referensi
kondisi ke field yang tidak ada, siklus, regex tidak valid). Warning tidak (misalnya kondisi
yang menunjuk field di bawahnya — tidak terlarang di form satu halaman, tapi hampir selalu
tidak disengaja). Tanpa pemisahan ini, validator akan terasa rewel dan orang akan mencari
cara mengakalinya.

**`getEffectiveAnswers()` disediakan sejak sekarang.** Fungsi ini membuang jawaban milik
field tersembunyi dan opsi tersembunyi — inilah yang akan dipakai endpoint submit di Part 6
untuk menutup celah yang disebut ARCHITECTURE.md bagian 6 poin 2 (orang mengirim jawaban ke
field yang seharusnya tersembunyi lewat manipulasi request).

**Katalog field type Part 0 diganti seluruhnya.** Daftar lama (`short_text`, `long_text`,
`multi_select`, `file`, `heading`, `paragraph`, `divider`, `page_break`, `yes_no`, `rating`,
`signature`, `hidden`, `url`, `time`) adalah tebakan yang ditulis sebelum spesifikasi ada.
Sekarang isinya persis 13 tipe yang diminta. Tidak ada migrasi database karena schema form
disimpan sebagai JSONB, dan belum ada satu pun form tersimpan saat perubahan ini dibuat.

**`form.view` ditambahkan ke katalog permission.** Part 2 hanya punya `form.create/edit/
delete/publish` — tidak ada permission untuk sekadar _membaca_ form. Tanpa itu, Viewer yang
seharusnya bisa melihat submission tidak bisa membuka daftar formnya. `form.view` diberikan
ke ketiga role bawaan.

**Whitelist domain hanya di kolom `forms.allowed_domains`, tidak di dalam schema JSON.**
Kalau ada di dua tempat, keduanya akan menyimpang. Kolom dipilih karena bisa diubah tanpa
membuat revisi schema, dan pengecekan CORS nanti tidak perlu memuat schema.

**Catatan untuk part berikutnya:**

- Endpoint publik `GET /public/forms/:formKey/schema` dan cache Redis-nya **belum dibuat** —
  dipindah ke Part 5 (form renderer & embed), tempat keduanya benar-benar dipakai.
- Belum ada endpoint melihat riwayat versi atau mengembalikan (rollback) ke versi lama.
  Datanya sudah tersimpan lengkap, tinggal endpoint-nya.
- Publish pada form yang diarsipkan akan mengembalikannya ke status `published`
  (berfungsi sebagai restore). Belum ada endpoint unarchive khusus.
- `evaluateConditions` sudah siap dipakai embed, tapi `apps/embed` belum mengimpornya.
- Validasi **jawaban** terhadap aturan validasi field (required, minLength, pattern, dst)
  belum ada — itu bagian dari Part 6 saat submit diproses.

## ⬜ Part 4 — Form builder UI (dashboard)

- [ ] Halaman login + proteksi route (dipindah dari Part 2)
- [ ] Manajemen user & role di dashboard (dipindah dari Part 2)
- [ ] Registry field type (satu komponen per field type)
- [ ] Drag & drop susun + reorder field (dnd-kit)
- [ ] Panel properti field (label, validasi, opsi)
- [ ] Condition builder show/hide sampai level opsi
- [ ] State management builder (Zustand)
- [ ] Preview form + simpan sebagai draft/publish
- [ ] Pengaturan form: pesan sukses, redirect, whitelist domain embed

## ⬜ Part 5 — Form renderer & embed

- [ ] Endpoint publik `GET /public/forms/:formKey/schema` (dipindah dari Part 3)
- [ ] Cache schema form di Redis + invalidasi saat publish (dipindah dari Part 3)
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
