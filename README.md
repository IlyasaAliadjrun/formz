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
2. `shared-build` — build `@formz/shared` ke `dist/` (CJS) dan `dist-esm/` (ESM),
   sekali jalan lalu exit
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

| URL                          | Isi                                          |
| ---------------------------- | -------------------------------------------- |
| http://localhost:3000        | Admin dashboard (login, form builder)        |
| http://localhost:5173/f/KEY  | Form renderer untuk satu form                |
| http://localhost:4000/health | Health check API                             |
| http://localhost:4000/queues | Bull Board (login pakai `QUEUE_DASHBOARD_*`) |
| http://localhost:9001        | MinIO console (login pakai `MINIO_ROOT_*`)   |

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

### Dashboard

Buka http://localhost:3000 lalu login dengan `ADMIN_EMAIL` + `ADMIN_PASSWORD` dari `.env`.

| Halaman                              | Isi                                                        |
| ------------------------------------ | ---------------------------------------------------------- |
| `/forms`                             | Daftar form: status, tanggal update, jumlah submission     |
| `/forms/:id/edit`                    | Form builder tiga panel: field, preview, properti          |
| `/forms/:id/submissions`             | Tabel jawaban, filter tanggal, ekspor Excel/CSV            |
| `/forms/:id/submissions/:submission` | Detail jawaban per field + status integrasi per submission |
| `/forms/:id/integrations`            | Target Google Sheets, aturan notifikasi email, uji coba    |
| `/forms/:id/embed`                   | formKey, snippet iframe & script tag, whitelist domain     |

### Memasang form di website lain

Form yang sudah **dipublish** bisa dipasang di website mana pun dengan salah satu
dari dua snippet berikut (keduanya tersedia siap salin di `/forms/:id/embed`):

```html
<!-- 1. iframe — paling terisolasi dari CSS & JavaScript website pemasang -->
<iframe
  src="http://localhost:5173/f/FORM_KEY"
  style="width:100%;border:0;min-height:600px"
></iframe>

<!-- 2. Script tag — iframe dibuat otomatis di posisi snippet, tinggi ikut menyesuaikan -->
<script src="http://localhost:5173/embed.js" data-form="FORM_KEY" async></script>
```

Mode script tag juga bisa mengisi wadah yang sudah ada, berguna kalau ada
beberapa form dalam satu halaman:

```html
<div data-formz="FORM_KEY"></div>
<script src="http://localhost:5173/embed.js" async></script>
```

Untuk mencobanya tanpa website sungguhan, ada [test-embed.html](./test-embed.html)
di root project. Berkas itu harus **disajikan lewat HTTP**, bukan dibuka sebagai
`file://` — halaman `file://` ber-origin `null` sehingga tidak lolos pemeriksaan
domain:

```bash
python3 -m http.server 8080     # lalu buka http://localhost:8080/test-embed.html
```

Halaman itu memuat form dengan kedua cara sekaligus dan mencatat semua
`postMessage` yang diterima, jadi penyesuaian tinggi otomatis bisa dilihat langsung.

**Whitelist domain.** Selama daftar domain di halaman embed masih kosong, form
boleh dipasang di mana saja. Begitu diisi, hanya domain di daftar itu yang bisa
memuat dan mengirim jawaban — termasuk saat mencoba lewat `test-embed.html`,
yang berarti `localhost:8080` perlu ikut didaftarkan.

Catatan: `next build` di app dashboard menyetel `NODE_ENV=production` sendiri lewat
script-nya. Ini disengaja — container dev compose menyetel `NODE_ENV=development`, dan
membangun Next.js dengan nilai itu membuat React build development ikut termuat lalu
gagal saat prerender dengan pesan yang menyesatkan.

### Integrasi Google Sheets

Sync ke spreadsheet memakai **service account**, bukan OAuth per pengguna: server
punya satu identitas sendiri, dan admin membagikan spreadsheet ke identitas itu
seperti membagikannya ke rekan kerja. Tidak ada layar consent, tidak ada proses
verifikasi aplikasi ke Google, dan tidak ada refresh token milik orang lain yang
perlu disimpan aplikasi ini. Alasan lengkapnya ada di header
[integrations.controller.ts](./apps/api/src/modules/integrations/integrations.controller.ts).

Menyiapkannya:

1. Buat project di [Google Cloud Console](https://console.cloud.google.com), lalu
   aktifkan **Google Sheets API**.
2. **IAM & Admin → Service Accounts → Create** — beri nama bebas, tanpa role apa pun
   (aksesnya diberikan per spreadsheet, bukan lewat IAM).
3. Di service account itu: **Keys → Add key → Create new key → JSON**.
4. Dari berkas JSON yang terunduh, salin `client_email` ke
   `GOOGLE_SERVICE_ACCOUNT_EMAIL` dan `private_key` ke `GOOGLE_PRIVATE_KEY` di
   `.env` (biarkan `\n`-nya apa adanya, apit dengan tanda kutip ganda).
5. Jalankan ulang api dan worker: `docker compose up -d api worker`.
6. Buka spreadsheet tujuan → **Share** → tambahkan alamat service account sebagai
   **Editor**. Tanpa langkah ini sync akan gagal dengan `PERMISSION_DENIED`.
   Alamatnya ditampilkan siap salin di `/forms/:id/integrations`.

Lalu tambahkan target di `/forms/:id/integrations` (URL spreadsheet boleh ditempel
apa adanya), dan tekan **Test Kirim** untuk menulis satu baris contoh — job-nya
menempuh jalur yang sama persis dengan submission sungguhan, jadi kalau uji cobanya
lolos, konfigurasinya memang sudah benar.

Tab tujuan **harus sudah ada** di spreadsheet; Formz tidak membuat tab baru.

### Notifikasi email

Pengiriman email memakai adaptor yang bisa ditukar
([apps/worker/src/mail](./apps/worker/src/mail)):

| `MAIL_PROVIDER` | Perilaku                                                                 |
| --------------- | ------------------------------------------------------------------------ |
| `console`       | **Bawaan.** Email hanya dicetak ke log worker, tidak dikirim ke mana pun |
| `smtp`          | Dikirim lewat SMTP relay (Postmark, Amazon SES, SendGrid, dll)           |

`console` sengaja jadi bawaan supaya server yang belum dikonfigurasi tidak bisa
mengirim email ke alamat sungguhan hanya karena ada variabel yang lupa diisi.
Untuk mengirim betulan, isi `MAIL_PROVIDER=smtp` beserta `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASSWORD`, dan `MAIL_FROM`.

Jangan menjalankan mail server sendiri di server ini — reputasi IP baru membuat
emailnya hampir pasti masuk folder spam. Pakai relay pihak ketiga, cukup satu
koneksi keluar.

Satu aturan notifikasi menentukan subjek, template, kondisi kapan dikirim, dan
tiga sumber penerima yang digabung: email tetap, jawaban field email milik pengisi
form (inilah cara membuat balasan otomatis), dan penerima bersyarat. Satu alamat
hanya menerima satu email per submission walau cocok dengan beberapa aturan.

### Memantau antrean

Sync spreadsheet dan pengiriman email dikerjakan di antrean, bukan saat request
submit — supaya orang yang mengisi form tidak ikut menunggu Google API dan SMTP relay.

Ringkasan antreannya terlihat di `/forms/:id/integrations`. Untuk melihat job satu
per satu beserta pesan errornya, ada **Bull Board** di `http://localhost:4000/queues`.

Halaman itu disajikan Express langsung sehingga tidak melewati JWT seperti endpoint
`/admin` lainnya; autentikasinya HTTP Basic dengan kredensial terpisah
(`QUEUE_DASHBOARD_USER` & `QUEUE_DASHBOARD_PASSWORD`). Kalau salah satunya kosong,
halamannya **tidak dipasang sama sekali** — lupa mengonfigurasi berarti halamannya
tidak ada, bukan halamannya terbuka.

Job yang gagal bisa dijalankan ulang dari tombol **Jalankan ulang** di halaman detail
submission. Aman ditekan berapa kali pun: target yang catatannya sudah berhasil
dilewati, jadi tidak ada baris dobel di spreadsheet atau email terkirim dua kali.

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

`packages/shared` di-build dua kali: `dist/` (CommonJS, dipakai api & worker yang
memang berjalan sebagai CJS) dan `dist-esm/` (ESM, dipakai dashboard & embed).
Bundler tidak bisa meng-_tree-shake_ CommonJS, dan tanpa keluaran ESM seluruh isi
shared — termasuk Zod — ikut terbawa ke bundle form renderer.

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
| Dashboard      | Next.js 16, React 19, Tailwind 4, shadcn/ui         |
| Dashboard data | TanStack Query 5, Zustand 5, dnd-kit                |
| Form renderer  | Preact 10, Vite 7                                   |
| API            | NestJS 11, TypeScript 5.9                           |
| ORM            | Prisma 7 (driver adapter `pg`, tanpa engine Rust)   |
| Worker         | BullMQ 6, tsx, googleapis, Nodemailer, React Email  |
| Pemantauan     | Bull Board 8 (HTTP Basic auth)                      |
| Shared         | Zod 4                                               |
| Database       | PostgreSQL 17 (JSONB)                               |
| Cache & queue  | Redis 7                                             |
| Object storage | MinIO (S3-compatible)                               |
| Tooling        | pnpm workspaces, ESLint 9 (flat config), Prettier 3 |
