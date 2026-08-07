# Rekomendasi Tech Stack: Form Builder (Pengganti Jotform)

## 1. Ringkasan Kebutuhan

Berdasarkan requirement yang disebutkan, sistem ini butuh:

- **Form builder** (CRUD form, banyak field type, conditional show/hide sampai level opsi)
- **Form renderer** yang bisa **di-embed** di website lain (cross-origin, ringan, cepat)
- **Submission management** (lihat jawaban per field, status integrasi spreadsheet, status forward email)
- **Role Based Access Control (RBAC)**
- **Reporting**
- **Integrasi spreadsheet** (Google Sheets kemungkinan besar)
- **Workflow notifikasi email** (trigger otomatis saat submit)

Karena butuh proses background (kirim email, sync ke spreadsheet, retry jika gagal), arsitektur perlu **job queue/worker**, bukan cuma request-response biasa. Ini poin penting yang sering diremehkan tim yang baru mulai bikin form builder sendiri.

**Pertimbangan tambahan:** aplikasi ini akan **self-hosted di server Ubuntu 24.04 LTS**, bukan pakai PaaS cloud (Railway/Render/Vercel dkk). Ini mengubah beberapa keputusan stack — terutama di layer **container/orchestration, reverse proxy, storage file, backup, dan monitoring** — supaya semuanya bisa jalan mandiri di satu (atau beberapa) server tanpa bergantung ke layanan managed. Detail lengkapnya ada di bagian 3.8 dan bagian 7 (topologi deployment).

---

## 2. Arsitektur Tingkat Tinggi

```
┌────────────────────┐        ┌───────────────────────────┐
│   Admin Dashboard    │        │   Form Renderer (Embed)    │
│   app.domain.com      │        │   embed.domain.com          │
│   - Form Builder       │        │   HANYA render 1 form:      │
│   - Submission list    │        │   - ambil schema (public)   │
│   - Reporting           │        │   - render field + logic    │
│   - RBAC / user mgmt    │        │   - submit jawaban           │
│   - PERLU LOGIN (auth)  │        │   - TIDAK ADA fitur admin,   │
│                         │        │     TIDAK PERLU LOGIN        │
└──────────┬─────────────┘        └─────────────┬───────────────┘
           │  API privat (butuh auth+RBAC)        │  API publik terbatas
           │  /admin/forms, /admin/submissions,    │  GET /public/forms/:formKey/schema
           │  /admin/reports, /admin/users ...     │  POST /public/forms/:formKey/submit
           ▼                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Backend API (BFF)                          │
│  - Form CRUD & schema engine        (private, auth)               │
│  - Conditional logic engine         (shared logic)                │
│  - Submission handler                (public submit + private view)│
│  - RBAC/Auth                        (private only)                │
│  - Reporting/aggregation            (private only)                │
└──────────┬───────────────────────────────┬────────────────────────┘
           │                                │
           ▼                                ▼
   ┌───────────────┐              ┌───────────────────┐
   │  PostgreSQL    │              │  Queue (Redis +   │
   │  (form schema, │              │  BullMQ)           │
   │  submissions,  │              └────────┬──────────┘
   │  users, roles) │                       │
   └───────────────┘                       ▼
                                    ┌──────────────────┐
                                    │  Worker Service   │
                                    │  - Google Sheets  │
                                    │    sync (+retry)  │
                                    │  - Email sender   │
                                    │    (+ retry, log) │
                                    └──────────────────┘
```

**Poin kunci revisi:** yang di-embed di website lain **hanya Form Renderer** — sebuah aplikasi kecil yang tugasnya cuma menampilkan satu form dan menerima submit-nya. Dashboard admin (builder, submission list, reporting, RBAC) **tidak pernah** ikut ter-embed dan tidak bisa diakses dari domain embed sama sekali. Ini dipisah lewat 3 lapis:

1. **Aplikasi terpisah** — `embed.domain.com` adalah build/deploy yang sama sekali beda dari `app.domain.com`, jadi secara fisik tidak ada kode dashboard yang ikut terkirim ke browser saat form di-embed.
2. **API terpisah** — endpoint yang dipanggil form renderer hanya 2: ambil schema form (read-only, berdasarkan `formKey`/public token) dan submit jawaban. Endpoint admin (list submission, reporting, manage user) ada di namespace API yang berbeda dan wajib auth+RBAC, tidak bisa dipanggil dari embed.
3. **Tidak ada sesi login di embed** — form renderer bersifat publik/anonim (kecuali form memang butuh field "identitas" yang diisi user), sehingga tidak ada risiko token admin bocor ke website pihak ketiga tempat form di-embed.

Kenapa dipisah jadi API + Worker + Queue? Karena kalau sync ke Google Sheets atau kirim email dilakukan sinkron di request submit, user yang isi form di website lain akan menunggu lama atau bahkan gagal kalau Google API lagi lambat. Dengan queue, submit form tetap cepat, dan status sync/email bisa diupdate belakangan — inilah yang memungkinkan fitur "status sudah masuk spreadsheet atau belum" dan "status forward email" yang kamu sebutkan.

---

## 3. Rekomendasi Stack per Layer

### 3.1 Frontend — Admin Dashboard (Form Builder, Submission, Reporting, RBAC)

| Kebutuhan | Rekomendasi | Alasan |
|---|---|---|
| Framework | **Next.js (React) + TypeScript** | Ekosistem besar, SSR untuk dashboard yang butuh SEO ringan (tidak wajib tapi bagus), banyak library form builder open source berbasis React sebagai referensi |
| Form builder UI (drag & drop) | **dnd-kit** atau **react-dnd** | Untuk susun field, reorder, nested condition builder |
| State management | **Zustand** atau **Redux Toolkit** | Form schema builder itu state-heavy (nested field, condition tree), butuh state management yang jelas |
| UI Component | **shadcn/ui + Tailwind CSS** | Cepat dibangun, konsisten, mudah dikustom untuk branding sendiri |
| Rule/condition builder | Custom component + **JSON Logic** (json-logic-js) | Standar untuk menyimpan & mengevaluasi rule show/hide secara aman dan portable |
| Charting (reporting) | **Recharts** atau **Apache ECharts** | Recharts cukup untuk chart standar; ECharts kalau butuh visualisasi lebih kompleks |
| Table besar (submission list) | **TanStack Table** | Server-side pagination, filter, sort untuk ribuan submission |

### 3.2 Frontend — Form Renderer (yang di-embed di website lain)

Ini bagian paling krusial dan **sengaja dibuat sebagai aplikasi terpisah dari dashboard admin**. Isinya murni satu tugas: render 1 form berdasarkan `formKey`, evaluasi show/hide condition, dan kirim submit. Tidak ada layout dashboard, tidak ada menu, tidak ada halaman lain — supaya bundle-nya kecil dan tidak ada permukaan (surface) untuk mengakses fitur admin dari luar.

| Kebutuhan | Rekomendasi | Alasan |
|---|---|---|
| Repo/App | **Aplikasi/paket terpisah** dari dashboard (mono-repo boleh, tapi build & deploy output beda) | Memastikan tidak ada satupun kode admin (builder, submission table, RBAC) yang ikut ter-bundle ke JS yang dikirim ke website pihak ketiga |
| Metode embed | **iframe** (default/utama) + opsi **script tag / Web Component** (`<my-form form="formKey">`) untuk yang butuh integrasi lebih menyatu | iframe = paling aman & terisolasi dari CSS/JS host website (cara yang sama dipakai Jotform/Typeform). Web Component untuk kasus lanjutan yang butuh styling ikut tema website tanpa iframe |
| Snippet yang dipasang di website lain | Contoh: `<iframe src="https://embed.domain.com/f/{formKey}"></iframe>` atau `<script src="https://embed.domain.com/embed.js" data-form="{formKey}"></script>` | Cukup satu baris kode, tidak ada dependency ke dashboard sama sekali |
| Renderer engine | **Preact** (bukan full React) atau **vanilla JS + Vite** | Bundle size kecil supaya tidak membebani website yang meng-embed. Preact API-compatible dengan React tapi jauh lebih ringan (~3-4kb) |
| Komunikasi iframe ↔ parent | **postMessage API** | Untuk auto-resize tinggi iframe, redirect/notify parent setelah submit sukses, dsb |
| Data yang diambil | **Hanya schema form (read-only, via `formKey`) + endpoint submit** | Renderer tidak pernah memanggil endpoint submission list, reporting, atau user management — endpoint itu bahkan tidak "terlihat" dari sisi kode embed |
| Validasi | **Zod** (schema validation, share antara frontend & backend jika pakai Node) | Satu source of truth validasi, dipakai baik di form builder (define rule) maupun form renderer (validasi input) |
| Autentikasi | **Tanpa login** (publik/anonim), kecuali form memang punya field tertentu yang butuh isi identitas | Form renderer tidak boleh membawa token/sesi admin apa pun — ini mencegah token bocor ke domain pihak ketiga tempat form di-embed |

**Catatan penting soal domain & keamanan:**

- Deploy embed di domain terpisah, misal `embed.namadomain.com`, terpisah total dari dashboard admin (`app.namadomain.com`). Selain untuk performa (cache, CSP, X-Frame-Options bisa diatur independen), ini juga **batas keamanan**: kalaupun website pihak ketiga yang meng-embed form disusupi/XSS, penyerang hanya bisa berinteraksi dengan endpoint form publik (submit jawaban), bukan endpoint admin.
- Endpoint publik (`/public/forms/:formKey/schema` dan `/public/forms/:formKey/submit`) sebaiknya **hanya mengekspos data yang memang perlu ditampilkan ke pengisi form** — tidak menyertakan info internal seperti daftar submission lain, email tujuan notifikasi, atau nama sheet tujuan integrasi.
- Setiap form punya `formKey` publik (token acak, bukan ID database internal/auto-increment) supaya orang tidak bisa menebak-nebak form lain hanya dengan mengganti angka di URL.
- Tambahkan **domain whitelist per form** (opsional tapi disarankan) — admin bisa set domain mana saja yang boleh meng-embed form tertentu, dicek lewat header `Referer`/`Origin` sebagai lapisan tambahan (bukan satu-satunya proteksi, tapi mengurangi risiko form "dicuri" dan dipasang di domain lain tanpa izin).

### 3.3 Backend API

| Kebutuhan | Rekomendasi | Alasan |
|---|---|---|
| Framework | **NestJS (Node.js + TypeScript)** | Struktur modular (module per fitur: Form, Submission, RBAC, Reporting), built-in dependency injection, gampang scale tim. Alternatif: **Laravel** kalau tim lebih kuat di PHP, sama-sama matang untuk kasus ini |
| API style | **REST** untuk sebagian besar, **GraphQL** opsional untuk reporting yang query-nya fleksibel | REST lebih simpel untuk CRUD form & submission; GraphQL enak kalau reporting butuh query dinamis banyak field |
| Validasi schema | **Zod** atau **class-validator** (built-in NestJS) | Validasi field type, required, format |
| Auth | **JWT + refresh token**, atau **session-based** dengan **Passport.js** | Untuk RBAC berbasis role & permission granular |
| Authorization | **CASL** (library RBAC untuk Node) | Cocok untuk permission granular per-resource, misal: role "Editor Form A" hanya boleh edit form tertentu, bukan semua |

### 3.4 Database

| Kebutuhan | Rekomendasi | Alasan |
|---|---|---|
| Database utama | **PostgreSQL** | ACID, support **JSONB** yang sangat penting di sini |
| Skema form | Simpan sebagai **JSONB** di kolom `schema` pada tabel `forms` | Form field type bisa sangat beragam (text, select, checkbox, file upload, dsb) dan berubah-ubah — JSONB fleksibel tanpa perlu migrasi tabel tiap ada field type baru |
| Submission data | Simpan jawaban sebagai **JSONB** per submission + tabel relasi minimal untuk query cepat (misal index field penting) | Karena field per form berbeda-beda, EAV (entity-attribute-value) murni terlalu lambat untuk query; JSONB dengan GIN index adalah win-win |
| Search/filter submission | **PostgreSQL GIN index pada JSONB**, atau **Elasticsearch/Meilisearch** kalau volume submission sudah sangat besar | Mulai dari Postgres GIN index dulu, upgrade ke search engine terpisah kalau performa mulai turun |
| Cache | **Redis** | Untuk cache schema form (biar embed load cepat), session, dan sebagai broker queue |

**Contoh struktur data condition (show/hide sampai level opsi):**

```json
{
  "field_id": "field_003",
  "type": "select",
  "label": "Jenis Layanan",
  "options": [
    { "id": "opt_1", "label": "Konsultasi" },
    { "id": "opt_2", "label": "Implementasi" }
  ],
  "conditions": {
    "visibility": {
      "action": "show",
      "logic": "AND",
      "rules": [
        { "field_id": "field_001", "operator": "equals", "value": "opt_2" }
      ]
    }
  }
}
```

Struktur seperti ini memungkinkan rule sampai ke level *value opsi tertentu*, bukan cuma level field.

### 3.5 Queue & Worker (Integrasi Spreadsheet + Email Workflow)

| Kebutuhan | Rekomendasi | Alasan |
|---|---|---|
| Queue | **BullMQ** (berbasis Redis, Node) | Support retry otomatis, delay, prioritas job — penting untuk status "sudah masuk spreadsheet / belum" |
| Worker | Service terpisah (bisa dalam repo yang sama, proses berbeda) | Supaya proses sync/email tidak mengganggu response time API utama |
| Integrasi Google Sheets | **Google Sheets API v4** via **googleapis** (Node SDK) | Standar resmi, support append row, batch update |
| Integrasi email | **SMTP relay pihak ketiga** (misal **Postmark**, **SendGrid**, atau **Amazon SES**) — **jangan** jalankan mail server sendiri di server Ubuntu | Untuk deliverability tinggi dan tracking (delivered, bounced, opened) yang bisa dipakai untuk status "forward email". Menjalankan mail server sendiri (Postfix/Exim) di server self-hosted sangat rawan email masuk folder spam karena reputasi IP baru — provider transactional email tetap dipakai walau aplikasi utamanya self-hosted, cukup satu koneksi keluar (outbound) via API/SMTP |
| Template email | **MJML** atau **React Email** | Untuk desain template notifikasi yang konsisten di berbagai email client |
| Log status | Tabel `submission_integration_logs` — kolom: `type` (sheet/email), `status` (pending/success/failed), `target` (email tujuan/nama sheet), `retry_count`, `error_message`, `synced_at` | Ini yang menjawab kebutuhanmu: status per submission untuk spreadsheet & email, termasuk dikirim ke siapa saja |

### 3.6 Reporting

| Kebutuhan | Rekomendasi | Alasan |
|---|---|---|
| Aggregasi data | Query langsung ke PostgreSQL (materialized view untuk report berat) | Materialized view di-refresh berkala agar dashboard reporting tidak membebani DB utama saat traffic submission tinggi |
| Export | **ExcelJS** (Node) untuk export ke .xlsx, atau **csv-writer** untuk CSV | Standar export laporan |
| Visualisasi | Recharts/ECharts (sudah disebut di frontend) | — |

### 3.7 File Upload (kalau ada field type upload file)

| Kebutuhan | Rekomendasi | Alasan |
|---|---|---|
| Storage | **MinIO** (self-hosted, S3-compatible) | Karena server self-hosted, MinIO dijalankan sebagai container tambahan di server yang sama/terpisah. API-nya S3-compatible, jadi kode aplikasi (SDK `aws-sdk`/`@aws-sdk/client-s3`) tetap sama persis kalau suatu saat mau pindah ke S3/R2 cloud — tidak perlu rewrite |
| Upload flow | **Presigned URL** langsung dari browser ke MinIO | Supaya file besar tidak lewat backend API dan membebani server utama |
| Backup file | Sertakan folder data MinIO dalam **rutin backup terjadwal** (lihat bagian 7) | Beda dengan cloud storage, di self-hosted tidak ada replikasi otomatis bawaan — backup jadi tanggung jawab sendiri |

### 3.8 Infrastruktur & DevOps (Self-Hosted, Ubuntu 24.04 LTS)

| Kebutuhan | Rekomendasi | Alasan |
|---|---|---|
| Container | **Docker + Docker Compose** | Untuk 1 server (atau beberapa server kecil), Docker Compose sudah cukup — lebih simpel dioperasikan dibanding Kubernetes yang overhead-nya besar untuk skala awal. Pindah ke Kubernetes/Swarm nanti kalau memang sudah butuh multi-node |
| Reverse proxy + SSL | **Nginx** atau **Caddy** (Caddy lebih simpel: auto-HTTPS via Let's Encrypt tanpa konfigurasi manual) | Untuk routing domain `app.namadomain.com` (dashboard, private) dan `embed.namadomain.com` (form renderer, public) ke container yang berbeda, sekaligus terminasi TLS |
| Database | **PostgreSQL** dijalankan sebagai container terpisah (volume ter-mount ke disk) atau install native via `apt` | Native install kadang lebih gampang untuk tuning & backup di server tunggal; container lebih gampang untuk versioning & isolasi. Dua-duanya valid, pilih native kalau tim belum terbiasa operasikan Postgres di Docker jangka panjang |
| Cache/Queue | **Redis** sebagai container | — |
| Object storage | **MinIO** sebagai container (lihat 3.7) | — |
| Process supervision | **Docker restart policy** (`restart: unless-stopped`) dibungkus **systemd** (`docker compose up` sebagai systemd service) | Supaya seluruh stack otomatis jalan lagi kalau server reboot/crash, tanpa perlu intervensi manual |
| Deploy | **Manual via SSH** — jalankan skrip deploy sederhana di server: `git pull && docker compose build && docker compose up -d` | Tanpa CI/CD, deploy dilakukan manual saat rilis. Bisa dibungkus jadi satu file `deploy.sh` di server supaya tinggal jalankan satu perintah tiap kali ada update, tanpa perlu setup pipeline eksternal |
| CDN di depan server (opsional tapi disarankan) | **Cloudflare (mode proxy, free tier)** di depan domain embed | Server self-hosted biasanya cuma di satu lokasi/region — Cloudflare proxy membantu caching aset statis form renderer, mengurangi beban server, sekaligus jadi lapisan proteksi DDoS/basic firewall gratis |
| Monitoring | **Netdata** (ringan, real-time, gampang install satu baris) atau **Prometheus + Grafana** (lebih detail tapi lebih berat) untuk resource server; **Sentry (self-hosted atau cloud free tier)** untuk error tracking aplikasi; **Bull Board** untuk memantau job queue | Wajib ada visibilitas ke resource server (CPU/RAM/disk) karena tidak ada auto-scaling seperti di PaaS — kalau server penuh, semua layanan kena dampak |
| Backup | **pg_dump terjadwal (cron)** untuk database + **rclone** untuk kirim hasil backup (DB dump + folder MinIO) ke storage offsite (Backblaze B2/S3 murah) | Karena self-hosted = tidak ada backup otomatis bawaan seperti managed database cloud. Backup offsite wajib supaya tidak hilang total kalau server bermasalah |
| Keamanan server | **UFW** (firewall, hanya buka port 22/80/443), **Fail2ban** (blokir brute-force SSH), **SSH key-only** (matikan password login), **unattended-upgrades** (auto security patch Ubuntu) | Karena tidak ada managed security layer dari provider PaaS, hardening ini jadi tanggung jawab sendiri sejak awal |
| Log | **Docker logging driver** ke file + **logrotate**, atau kumpulkan ke **Loki** (ringan, satu paket dengan Grafana) kalau butuh pencarian log terpusat | Supaya log tidak memenuhi disk server dalam jangka panjang |

---

## 4. Topologi Deployment Self-Hosted (Ubuntu 24.04 LTS)

### 7.1 Gambaran Docker Compose di Satu Server

```
Ubuntu 24.04 LTS Server
│
├── Nginx/Caddy (reverse proxy + TLS/Let's Encrypt)
│     ├── app.namadomain.com     → container dashboard (Next.js)
│     ├── api.namadomain.com     → container backend API (NestJS)
│     └── embed.namadomain.com   → container form renderer (Preact, static)
│
├── docker-compose services:
│     ├── dashboard      (Next.js, port internal 3000)
│     ├── embed           (static build, disajikan Nginx/Caddy langsung atau via container kecil)
│     ├── api              (NestJS, port internal 4000)
│     ├── worker            (proses BullMQ, tidak expose port)
│     ├── postgres           (volume: /var/lib/docker/volumes/pgdata)
│     ├── redis               (queue + cache)
│     └── minio                (volume: /var/lib/docker/volumes/miniodata)
│
├── Cron jobs:
│     ├── pg_dump harian → rclone upload ke offsite storage
│     └── prune log/docker lama
│
└── Firewall (UFW): hanya port 22 (SSH), 80, 443 terbuka ke publik
```

Untuk server dengan spesifikasi menengah (misal 4 vCPU / 8GB RAM), susunan di atas cukup untuk mulai — komponen yang paling sering perlu dinaikkan resource-nya duluan biasanya PostgreSQL dan worker (kalau volume submission & sync sudah tinggi).

### 7.2 Kalau Traffic Bertambah (Jalur Scale-Up Bertahap)

Tidak perlu langsung ke Kubernetes. Urutan upgrade yang wajar untuk setup self-hosted:

1. **Vertical scaling dulu** — tambah CPU/RAM di server yang sama, paling murah dan cepat.
2. **Pisah database ke server/VM sendiri** — begitu Postgres jadi bottleneck, pisahkan dari server aplikasi supaya tidak saling berebut resource.
3. **Tambah server kedua untuk worker** — kalau job sync spreadsheet/email mulai menumpuk, jalankan worker BullMQ di server terpisah, tetap connect ke Redis/Postgres yang sama.
4. **Load balancer + multi-instance API** — baru di tahap ini pertimbangkan orchestrator (Docker Swarm dulu, cukup ringan; Kubernetes kalau tim sudah siap operasikan).

### 7.3 Checklist Awal Setup Server

- [ ] Update Ubuntu 24.04 (`apt update && apt upgrade`), aktifkan `unattended-upgrades`
- [ ] Buat user non-root dengan sudo, matikan login root & password SSH (key-only)
- [ ] Install Docker Engine + Docker Compose plugin
- [ ] Setup UFW: allow `22, 80, 443`, deny selebihnya
- [ ] Install Fail2ban untuk proteksi brute-force SSH
- [ ] Setup domain DNS: `app.`, `api.`, `embed.` mengarah ke IP server (atau proxied lewat Cloudflare)
- [ ] Setup Nginx/Caddy dengan auto-HTTPS (Let's Encrypt)
- [ ] Setup cron backup (`pg_dump` + `rclone`) dan **tes proses restore-nya**, bukan cuma backup-nya
- [ ] Setup monitoring dasar (Netdata) supaya ada alert kalau disk/RAM server penuh


---

## 5. Pemetaan Fitur → Komponen Teknis

| Fitur | Komponen Utama |
|---|---|
| CRUD Form | NestJS `FormModule` + PostgreSQL JSONB schema + Next.js builder UI |
| Field types | Registry pattern di frontend (tiap field type = komponen React terdaftar) + validasi Zod matching di backend |
| Show/hide condition (sampai level opsi) | JSON Logic tersimpan per field, dievaluasi real-time di form renderer (client-side) saat isi form |
| Integrasi spreadsheet | BullMQ job `sync-to-sheet` + Google Sheets API + log status di `submission_integration_logs` |
| Workflow notifikasi email | BullMQ job `send-notification` + template (React Email/MJML) + provider (Postmark/SES) + log status |
| RBAC | CASL + tabel `roles`, `permissions`, `role_permissions`, `user_roles` |
| Submission detail per field | Render JSONB jawaban berdasarkan schema form versi saat itu (penting: simpan snapshot schema per submission, bukan reference ke schema terbaru — supaya histori tidak berubah kalau form diedit) |
| Reporting | Materialized view + Recharts/ECharts di dashboard |
| Embed di website lain | iframe/Web Component via domain terpisah + postMessage untuk resize |

---

## 6. Catatan Desain Penting

1. **Versioning schema form.** Setiap kali form diedit dan sudah punya submission, buat versi baru dari schema (jangan overwrite). Simpan `schema_version_id` di setiap submission supaya data histori tetap konsisten dan bisa ditampilkan dengan benar meski form-nya sudah berubah.
2. **Evaluasi condition di dua sisi.** Show/hide logic harus dievaluasi di client (untuk UX) **dan** divalidasi ulang di server (untuk keamanan — supaya orang tidak bisa submit data ke field yang harusnya hidden lewat manipulasi request langsung).
3. **Idempotency pada job sync.** Job sync ke spreadsheet/email harus idempotent (pakai `submission_id` sebagai key) supaya kalau di-retry tidak duplikat data di sheet atau kirim email dobel.
4. **Rate limit & CORS untuk endpoint publik.** Karena form akan di-embed di banyak domain berbeda, endpoint publik (`/public/forms/:formKey/...`) harus punya CORS whitelist per form (domain mana saja yang boleh embed, dikonfigurasi admin saat setup form) plus rate limiting per `formKey`/IP untuk mencegah spam/abuse. Pastikan whitelist ini terpisah dari CORS dashboard admin, yang cukup dibatasi ke domain `app.namadomain.com` saja.

---

## 7. Ringkasan Stack Pilihan (Kalau Harus Satu Kombinasi)

- **Frontend Dashboard:** Next.js + TypeScript + Tailwind + shadcn/ui + TanStack Table + Recharts
- **Frontend Embed:** Preact + Vite (bundle kecil), iframe-based
- **Backend:** NestJS + TypeScript + CASL (RBAC)
- **Database:** PostgreSQL (JSONB untuk schema & submission)
- **Cache/Queue:** Redis + BullMQ
- **Storage file:** MinIO (self-hosted, S3-compatible)
- **Email:** Postmark/SES (tetap pakai provider eksternal walau app self-hosted) + React Email
- **Spreadsheet:** Google Sheets API v4
- **Infra:** Docker + Docker Compose + Nginx/Caddy (reverse proxy & auto-HTTPS) — semuanya berjalan di server Ubuntu 24.04 LTS sendiri, deploy manual via SSH (tanpa CI/CD)
- **Backup:** pg_dump + rclone ke storage offsite, dijadwalkan cron
- **Monitoring:** Netdata (resource server) + Sentry (error tracking) + Bull Board (queue)

Stack ini semuanya open-source/mainstream, bisa dijalankan penuh di server sendiri tanpa dependency ke PaaS, tim mid-level bisa langsung produktif, dan arsitekturnya siap untuk fitur lanjutan (integrasi lain, versioning, multi-tenant, scale-up bertahap) tanpa perlu rombak besar di awal.
