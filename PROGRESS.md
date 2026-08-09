# PROGRESS — Formz

Catatan progres lintas sesi. Setiap part yang selesai dicentang di sini, lengkap dengan
tanggal dan catatan singkat, supaya sesi berikutnya bisa langsung menyambung tanpa menebak-nebak.

**Status saat ini:** Part 6 selesai. Berikutnya: Part 7 (Integrasi Google Sheets).

| Part | Judul                                    | Status     |
| ---- | ---------------------------------------- | ---------- |
| 0    | Scaffolding & environment development    | ✅ Selesai |
| 1    | Skema database & lapisan data            | ✅ Selesai |
| 2    | Auth & RBAC                              | ✅ Selesai |
| 3    | Form CRUD & schema engine (API)          | ✅ Selesai |
| 4    | Form builder UI (dashboard)              | ✅ Selesai |
| 5    | Form renderer & embed                    | ✅ Selesai |
| 6    | Submission management                    | ✅ Selesai |
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

## ✅ Part 4 — Form builder UI (dashboard)

_Selesai: 7 Agustus 2026_

- [x] Halaman login + proteksi route (dipindah dari Part 2)
- [x] Halaman `/forms` — tabel judul/status/tanggal update/jumlah submission,
      filter status, pencarian, pagination, klik baris masuk builder
- [x] Registry field type — daftar tombol tambah field digenerate dari `FIELD_TYPES`
- [x] Drag & drop reorder field dengan dnd-kit (pointer + keyboard sensor)
- [x] Panel properti per tipe — atribut validasi mengikuti `validationAttributes`
- [x] Condition builder show/hide, termasuk memilih opsi spesifik sebagai nilai
- [x] Editor opsi dengan kondisi tampil per opsi
- [x] State management builder (Zustand)
- [x] Preview form real-time memakai `evaluateConditions` dari `@formz/shared`
- [x] Save Draft + Publish dengan dialog konfirmasi
- [x] Halaman `/forms/:id/embed` — formKey, snippet iframe & script, whitelist domain
- [x] React Query di semua halaman dengan loading & error state eksplisit
- [ ] Manajemen user & role di dashboard → dipindah ke Part 9

**Terverifikasi (Playwright, 22 pemeriksaan lolos, 0 error konsol):**

- `/forms` tanpa sesi mengarahkan ke `/login`; login berhasil mengarahkan balik
- Tambah 3 field dari daftar tipe → muncul di panel kiri dan langsung terender di preview
- Ubah label di panel kanan → berubah seketika di preview dan daftar field
- Condition builder: memilih field acuan bertipe dropdown membuat kolom nilai
  berubah jadi daftar opsi field itu (Konsultasi/Implementasi), bukan teks bebas
- Memilih opsi pemicu di preview membuat field tersembunyi langsung muncul
- Drag & drop mengubah urutan field
- Save Draft memunculkan notifikasi; Publish menampilkan dialog konfirmasi yang
  menyebut versi baru, lalu berhasil membuat versi
- Halaman embed menampilkan formKey dan dua snippet; domain
  `https://Klien.Example.com/kontak` tersimpan sebagai `klien.example.com`

`pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` (79 test), `format:check`,
dan `next build` produksi semuanya bersih.

### Keputusan desain

**Login dikerjakan lebih dulu karena tanpa itu tidak ada halaman yang bisa jalan.**
Semua endpoint `/admin/*` menuntut JWT sejak Part 2, jadi halaman form tidak punya
cara memuat data tanpa sesi. Item ini memang sudah tercatat di Part 4 sejak Part 2.

**Token disimpan di localStorage, bukan cookie httpOnly.** Alasannya API dan dashboard
berada di origin berbeda, dan sesi harus bertahan saat halaman di-reload. Risikonya
token terbaca skrip di origin dashboard — dashboard tidak pernah merender konten pihak
ketiga, dan form renderer (yang dipasang di website orang lain) sengaja jadi aplikasi
terpisah tanpa token sama sekali. Cookie httpOnly dicatat sebagai pengerasan Part 10.

**Refresh token diputar lewat satu promise bersama.** Beberapa request yang bersamaan
kena 401 hanya memicu satu kali refresh; tanpa ini request paralel saling membatalkan
karena server memutar refresh token setiap dipakai dan pemakaian ulang memicu
pencabutan seluruh sesi.

**Preview memakai `evaluateConditions` yang sama dengan server.** Bukan tiruan logika
di sisi UI. Konsekuensinya apa yang terlihat di preview adalah perilaku sebenarnya —
kalau evaluator berubah, preview ikut berubah tanpa perlu disinkronkan.

**Schema disimpan di satu store Zustand.** Ketiga panel membaca sumber yang sama, jadi
preview real-time hanyalah render ulang dari state, bukan salinan yang perlu disamakan.

**Menghapus field ikut membersihkan rule yang menunjuknya.** Tanpa itu schema langsung
jadi tidak valid begitu sebuah field dihapus, dan pengguna harus mencari sendiri rule
mana yang rusak.

**Publish menyimpan draft dulu kalau ada perubahan.** Server mem-publish draft yang
tersimpan, jadi tanpa langkah ini yang terpublish bukan yang terlihat di layar.

**Select memakai elemen `<select>` bawaan, bukan Radix Select.** Panel properti berisi
belasan dropdown kecil; listbox custom di semuanya menambah bundle tanpa manfaat nyata,
sementara select bawaan sudah aksesibel dan lebih baik di mobile. Radix tetap dipakai
untuk Dialog, Checkbox, Switch, Label, dan Separator yang memang butuh perilaku khusus.

**Catatan untuk part berikutnya:**

- **`next build` wajib jalan dengan `NODE_ENV=production`.** Container dev compose
  menyetel `NODE_ENV=development`, dan itu membuat `next build` memuat React build
  development lalu gagal saat prerender `/_global-error` dengan pesan yang menyesatkan
  (`Cannot read properties of null (reading 'useContext')`). Script `build` di
  `apps/dashboard/package.json` sekarang menyetelnya sendiri, jadi masalah ini tidak
  bisa terulang — penting diingat saat menulis Dockerfile produksi di Part 10.
- Belum ada auto-save; perubahan hilang kalau halaman ditutup tanpa Save Draft.
  Indikator "Belum disimpan" sudah ada, tapi belum ada konfirmasi saat meninggalkan halaman.
- Belum ada undo/redo di builder.
- Halaman manajemen user & role belum dibuat (API-nya sudah siap sejak Part 2).
- Snippet script tag sudah ditampilkan, tapi `embed.js` sendiri baru dibuat di Part 5.

## ✅ Part 5 — Form renderer & embed

_Selesai: 9 Agustus 2026_

- [x] Endpoint publik `GET /public/forms/:formKey/schema` (dipindah dari Part 3)
- [x] Cache schema form di Redis + invalidasi saat publish (dipindah dari Part 3)
- [x] Endpoint publik `POST /public/forms/:formKey/submit` (diambil maju dari Part 6)
- [x] Validasi ulang jawaban di server termasuk evaluasi ulang rule show/hide
      (diambil maju dari Part 6)
- [x] CORS whitelist per form + rate limit per `formKey`/IP (diambil maju dari Part 6)
- [x] Snapshot `form_version_id` di setiap submission (diambil maju dari Part 6)
- [x] `validateAnswers()` / `validateAnswer()` di `@formz/shared` — dipakai renderer
      dan API dari satu definisi yang sama
- [x] Route `/f/:formKey` mengambil schema publik
- [x] Render 12 dari 13 field type (semua kecuali `file_upload`, lihat catatan)
- [x] Evaluasi conditional show/hide real-time di client
- [x] Validasi client-side sebelum submit (required, format email, pola, rentang)
- [x] Submit jawaban ke endpoint publik + idempotency `clientSubmissionId`
- [x] Halaman terima kasih dengan pesan dari `settings.successMessage`
- [x] Auto-resize iframe & notifikasi ke parent lewat `postMessage`
- [x] `embed.js` untuk mode script tag + `test-embed.html` sebagai contoh
- [x] Cek ukuran bundle: **127 kB mentah / 36,6 kB gzip** (lihat keputusan desain)
- [ ] Upload file lewat presigned URL ke MinIO → dipindah ke Part 6

**Terverifikasi (Playwright di halaman statis luar aplikasi, 26 pemeriksaan lolos,
0 error konsol):**

- Form terender di dalam iframe dari `test-embed.html` yang disajikan di
  `localhost:8080` — domain yang terdaftar di whitelist form
- Field bersyarat (`Durasi implementasi`) dan opsi bersyarat (`Migrasi data`)
  tidak terender sama sekali sebelum kondisinya terpenuhi, lalu muncul seketika
  saat "Implementasi" dipilih, dan hilang lagi saat dikembalikan ke "Konsultasi"
- Tinggi iframe mengikuti isi: 1211px → 1327px saat field muncul, lalu turun ke
  234px saat panel sukses menggantikan form
- Submit kosong ditahan di client; format email diperiksa saat meninggalkan field
- Submit lengkap menampilkan halaman terima kasih berisi pesan dari settings form
- `embed.js` membuat iframe sendiri dari `data-form` dan menyesuaikan tingginya

**Terverifikasi (curl ke stack yang jalan):**

- `GET /public/forms/:formKey/schema` tanpa token mengembalikan schema versi
  terpublish; `allowedDomains`, `createdBy`, integrasi, dan aturan notifikasi
  tidak ikut, begitu pula `settings.rateLimitPerHour`
- Submit yang menyelipkan `f_durasi: 99` dan opsi tersembunyi `opt_migrasi`
  padahal memilih "Konsultasi" → keduanya **tidak** tersimpan di database
- Validasi ulang server menolak email salah format, teks terlalu pendek, pola HP
  tidak cocok, dan tiga field wajib yang kosong — dengan pesan per field
- Whitelist domain: `klien.example.com` ✅, `app.mitra.co.id` (wildcard) ✅,
  `mitra.co.id` (apex) ❌, `localhost:8080` ✅, `localhost:9999` (beda port) ❌,
  `pencuri.com` ❌, dan halaman induk `pencuri.com` di dalam iframe renderer ❌
- Preflight `OPTIONS` dijawab 204 lengkap dengan header CORS per form
- Rate limit: tepat 60 request lolos, sisanya 429 dengan `Retry-After`
- Publish versi 2 langsung terlihat di endpoint publik (cache dibatalkan), begitu
  pula perubahan whitelist domain

`pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` (123 test), `format:check`,
`vite build`, dan `next build` semuanya bersih.

### Keputusan desain

**CORS saja tidak cukup, karena di dalam iframe `Origin` selalu menunjuk ke
renderer.** Ini poin yang mudah terlewat: halaman di dalam iframe ber-origin
`embed.domain.com` apa pun website yang memasangnya, jadi `allowed_domains`
yang dicek lewat `Origin` tidak pernah bisa membedakan pemasang yang sah dari
yang mencuri. Karena itu renderer mengirim `document.referrer` — URL halaman
induk — lewat header `X-Formz-Parent`, dan itulah yang dicocokkan dengan
whitelist. Nilainya bisa dipalsukan pemanggil langsung, sama seperti `Origin`,
dan memang bukan satu-satunya proteksi (ARCHITECTURE.md bagian 3.2): yang
dicegah adalah pemasangan ulang di browser, bukan penyerang yang menulis skrip
sendiri. Proteksi utamanya tetap `formKey` yang tidak bisa ditebak.

**Whitelist ditegakkan dua lapis.** Header CORS hanya membuat browser menolak
_membaca_ respons — request-nya tetap sampai dan tetap dilayani. Jadi selain
delegasi CORS di `main.ts`, ada `FormOriginGuard` yang benar-benar menolak
request dengan 403. Keduanya memakai fungsi pencocokan yang sama di
`origin-policy.ts`, supaya tidak mungkin menyimpang.

**CORS diputuskan lewat delegasi, bukan dua konfigurasi terpisah.** Origin yang
diizinkan baru diketahui setelah formKey di URL dibaca, dan preflight `OPTIONS`
tidak pernah sampai ke controller — jadi keputusannya harus diambil di lapisan
yang berjalan sebelum routing. `app.enableCors()` menerima delegasi per request,
yang membuat dashboard (satu origin, dengan kredensial) dan endpoint publik
(origin per form, tanpa kredensial) bisa hidup berdampingan tanpa saling bocor.

**Rate limit dua lapis dengan tujuan berbeda.** Burst per menit
(`PUBLIC_RATE_LIMIT_PER_MINUTE`) berlaku untuk semua endpoint publik dan menahan
penembakan formKey acak. Kuota submit per jam diambil dari
`settings.rateLimitPerHour` milik form itu sendiri, karena wajarnya berbeda jauh
antara form pendaftaran acara dan form kontak biasa. Limiter-nya fixed window —
satu `INCR` saja — dan sengaja **fail open**: Redis yang bermasalah harus
membuat form tetap bisa diisi, bukan menolak semua orang.

**`allowedDomains` dan `rateLimitPerHour` ikut di-cache, bukan hanya schema.**
Keduanya dibaca di **setiap** request publik termasuk preflight. Kalau hanya
schema yang di-cache, query database tetap jalan tiap request dan cache-nya
kehilangan gunanya. Cache-nya tinggal di `FormsModule` bersama penulisnya, supaya
sulit ada jalur perubahan (publish, ubah whitelist, arsip, hapus) yang lupa
membatalkannya. formKey yang tidak dikenal sengaja **tidak** di-cache — kalau
di-cache, siapa pun bisa memenuhi Redis dengan menembak key acak.

**Jawaban yang disimpan adalah hasil `getEffectiveAnswers`, bukan payload mentah.**
Inilah penutup celah ARCHITECTURE.md bagian 6 poin 2. Jawaban untuk field yang
menurut kondisi seharusnya tersembunyi dibuang **diam-diam**, bukan ditolak —
karena pengisi form memang bisa saja sempat mengisinya lalu mengubah jawaban di
atasnya. Yang ditolak hanya jawaban yang benar-benar salah (opsi tidak dikenal,
format tidak sesuai).

**`packages/shared` sekarang di-build ke CommonJS _dan_ ESM.** Awalnya hanya CJS,
dan itu memunculkan dua masalah sekaligus di `apps/embed`. Pertama, named import
gagal saat runtime: analisis ESM Vite tidak bisa menembus `__exportStar(require(…))`
hasil kompilasi TypeScript. Kedua — dan ini yang lebih mahal — CommonJS tidak
bisa di-_tree-shake_, sehingga **seluruh** isi shared ikut terbawa ke bundle form
renderer, termasuk seluruh Zod: 84% isi bundle, padahal sebagian besar schema-nya
tidak pernah dipakai di sana. Menambah keluaran ESM (`dist-esm/`, dipilih lewat
`exports` condition `import`) menyelesaikan keduanya sekaligus dan memangkas
bundle dari **437 kB → 127 kB mentah, 97,6 kB → 36,6 kB gzip**. api dan worker
tetap memakai `dist/` lewat condition `require`, jadi tidak ada yang berubah di
sisi mereka.

**Tinggi iframe diukur dari elemen akar, bukan `documentElement.scrollHeight`.**
Tinggi dokumen tidak pernah lebih kecil dari viewport, sementara viewport di
dalam iframe adalah tinggi yang barusan kita minta sendiri ke halaman induk.
Akibatnya iframe hanya bisa membesar dan tidak pernah mengecil lagi — terlihat
jelas saat form panjang berganti jadi panel sukses yang pendek, yang menyisakan
ruang kosong seribu piksel. Mengukur `#formz-root` memutus lingkaran itu.

**`embed.js` berkas statis di `public/`, bukan modul yang di-bundle.** Isinya
tidak butuh Preact maupun kode form sama sekali — cuma membuat iframe dan
mendengarkan pesan tinggi. Sebagai berkas statis, halaman yang memasangnya hanya
mengunduh ~2 kB sampai iframe-nya dibuka. Origin renderer diambil dari
`document.currentScript.src`, jadi tidak ada URL yang perlu ditulis dua kali.
Pesan `postMessage` diverifikasi dua kali di sisi penerima: harus dari origin
renderer, dan dari jendela iframe yang memang dibuat skrip itu.

**Komponen field renderer ditulis terpisah dari preview dashboard.** Yang dibagi
bukan tampilannya melainkan logikanya — definisi field type, `evaluateConditions`,
dan `validateAnswers` semuanya dari `@formz/shared`. Markup dan gaya ditulis
sendiri tanpa framework CSS, karena berkas ini ikut terkirim ke setiap website
yang memasang form.

**Catatan untuk part berikutnya:**

- **`file_upload` dirender tapi dinonaktifkan.** Unggah berkas butuh presigned URL
  ke MinIO yang belum dibuat, jadi field-nya tampil sebagai input mati dengan
  keterangan "Unggah berkas belum tersedia". Aturan validasinya (`required`,
  `maxFiles`, `maxFileSizeBytes`, `allowedMimeTypes`) sengaja **belum ditegakkan**
  di `validateAnswer` — kalau ditegakkan sekarang, field wajib bertipe berkas jadi
  jalan buntu yang tidak bisa dilewati sama sekali. Menyalakannya di Part 6 berarti
  menghapus satu early-return di `answer-validation.ts`.
- `submissions.ip_address` sudah terisi. Kalau nanti ada di belakang reverse proxy,
  `TRUST_PROXY=true` wajib dinyalakan — tanpa itu semua submission tercatat ber-IP
  gateway Docker, dan rate limit per IP jadi rate limit global.
- Idempotency `clientSubmissionId` disimpan di Redis (TTL 1 jam), bukan kolom
  database, jadi tidak butuh migrasi. Kalau nanti dianggap perlu tahan restart
  Redis, tambahkan kolom unik di `submissions`.
- Job sync spreadsheet & notifikasi email belum di-enqueue saat submit masuk —
  titik pemasangannya sudah ditandai komentar di `PublicFormsService.submit`.
- Belum ada captcha. `settings.requireCaptcha` sudah ada di schema tapi belum
  dibaca renderer maupun server.
- Belum ada halaman "form sudah ditutup" yang khusus; form draft, arsip, dan tidak
  ada sama-sama menghasilkan 404 dengan pesan identik (disengaja, supaya formKey
  yang ada tidak bisa dipetakan dari beda pesan error).

## ✅ Part 6 — Submission management

_Selesai: 9 Agustus 2026_

- [x] ~~Endpoint publik `POST /public/forms/:formKey/submit`~~ → selesai di Part 5
- [x] ~~Validasi ulang jawaban di server, termasuk evaluasi ulang rule show/hide~~ → Part 5
- [x] ~~CORS whitelist per form + rate limit per `formKey`/IP~~ → selesai di Part 5
- [x] ~~Simpan snapshot `schema_version_id` di setiap submission~~ → selesai di Part 5
- [x] `GET /admin/submissions?form_id=` — pagination + filter rentang tanggal (`submission.view`)
- [x] `GET /admin/submissions/:id` — jawaban per field dirender dengan schema
      versi submission itu + status integrasi spreadsheet & email (`submission.view`)
- [x] `GET /admin/submissions/export?form_id=` — Excel (ExcelJS) & CSV (`submission.export`)
- [x] `describeAnswers()` / `formatAnswerValue()` di `@formz/shared` — satu definisi
      untuk halaman detail, ekspor, dan nanti isi email di Part 8
- [x] Halaman `/forms/:id/submissions` — TanStack Table 9, kolom dinamis mengikuti
      field form, pengaturan kolom, filter tanggal, pagination server-side
- [x] Halaman `/forms/:id/submissions/:submissionId` — seluruh jawaban per field + bagian "Status Integrasi"
- [x] Tombol ekspor Excel & CSV di halaman daftar
- [x] Navigasi tab Builder / Submission / Embed di ketiga halaman form
- [ ] Upload file lewat presigned URL ke MinIO (dipindah dari Part 5) → Part 7
- [ ] Hapus/arsip submission sesuai permission → Part 9

**Terverifikasi (Playwright, 37 pemeriksaan lolos, 0 error konsol):**

- Tabel memuat 5 submission dengan kolom yang digenerate dari field form;
  kolom jawaban keenam (`Asal instansi`) tersembunyi secara bawaan dan bisa
  dimunculkan lewat pengaturan kolom
- Baris versi 1 menampilkan "Kelas Dasar" sementara baris versi 2 menampilkan
  "Kelas Pemula" — **id opsi yang sama**, label mengikuti versi masing-masing
- Filter tanggal mempersempit hasil sampai kosong lalu pulih setelah dihapus
- Unduhan CSV dan Excel benar-benar terjadi lewat tombol di halaman
- Detail submission versi lama memunculkan peringatan versi, memakai label lama
  ("Nama lengkap", bukan "Nama peserta"), dan tetap menampilkan field
  `Tahun pengalaman` yang sudah dihapus dari form
- Status Integrasi menampilkan kegagalan sheet lengkap dengan pesan Google API,
  jumlah percobaan ulang, tautan ke spreadsheet, serta status per penerima email
  termasuk pesan SMTP-nya

**Terverifikasi (curl ke stack yang jalan):**

- `form_id` maupun `formId` sama-sama diterima; rentang tanggal terbalik ditolak
  400; form yang tidak ada 404
- Tanpa token ketiga endpoint 401. Viewer (`submission.view`) boleh membaca daftar
  dan detail tapi **403 saat mengekspor**; Editor tanpa permission submission 403
- CSV berisi kolom `Tahun pengalaman` yang hanya ada di versi lama — data dari
  versi yang sudah tidak berlaku tidak hilang dari berkas ekspor

`pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` (147 test), `format:check`,
dan `next build` semuanya bersih.

### Keputusan desain

**Jawaban diterjemahkan di server, bukan di dashboard.** Baris tabel dan entri
detail dikirim sebagai teks yang sudah jadi ("Kelas Dasar", "Ya"), bukan nilai
mentah plus schema untuk diolah klien. Alasannya: menerjemahkan di klien menuntut
dashboard memuat schema **setiap versi** yang muncul di halaman itu — untuk 25
baris lintas beberapa versi, payload-nya jauh lebih besar daripada teks hasilnya,
dan logika penerjemahan jadi berjalan di dua tempat. Ekspor Excel/CSV memanggil
fungsi yang sama, jadi isi berkas dan isi layar tidak mungkin berbeda.

**`describeAnswers()` ditaruh di `@formz/shared`, bukan di apps/api.** Fungsi ini
akan dipakai lagi untuk isi email notifikasi di Part 8. Menaruhnya di shared sejak
sekarang mencegah lahirnya salinan kedua yang perlahan menyimpang — masalah yang
sama persis dengan alasan `evaluateConditions` ada di sana sejak Part 3.

**Kolom daftar diambil dari versi terpublish, isi sel dari versi masing-masing
submission.** Dua sumber berbeda ini disengaja: judul kolom harus stabil saat
berpindah halaman, sementara isi sel harus jujur pada versi yang diisi orangnya.
Konsekuensinya field yang sudah dihapus dari form tidak punya kolom di daftar —
tapi tetap muncul utuh di halaman detail, dan tetap ikut di berkas ekspor.

**Ekspor menggabungkan kolom lintas versi, daftar tidak.** Berkas ekspor dipakai
sebagai arsip, jadi membuang kolom yang hanya ada di versi lama berarti kehilangan
data yang sebenarnya ada di database. Di layar, menambahkan kolom untuk setiap
field yang pernah ada akan membuat tabel form yang sudah lama direvisi jadi tidak
terbaca. Prioritas keduanya memang berbeda.

**`submission.export` dipisah dari `submission.view`.** Melihat jawaban satu per
satu di layar dan mengunduh seluruhnya jadi satu berkas yang bisa dikirim ke mana
saja adalah dua kemampuan yang berbeda bobotnya. Keduanya sudah ada di katalog
permission sejak Part 3, dan di sinilah bedanya benar-benar terpakai.

**`ip_address` tidak diikutkan di berkas ekspor.** Berkas ekspor gampang berpindah
tangan lewat email dan chat. Alamat IP pengisi form tidak dibutuhkan untuk
pekerjaan yang biasa dilakukan dengan berkas itu, dan tetap bisa dilihat di halaman
detail oleh yang memang berhak.

**Sel CSV yang diawali `=`, `+`, `-`, atau `@` diberi kutip di depan.** Tanpa itu,
Excel mengeksekusinya sebagai rumus — dan isi sel di sini datang dari orang luar
yang mengisi form. Ditambah BOM UTF-8 supaya Excel di Windows tidak salah membaca
karakter beraksen.

**Status integrasi menggabungkan konfigurasi dan log.** Log adalah kebenaran
tentang apa yang **sudah terjadi**, konfigurasi menjelaskan apa yang
**seharusnya terjadi**. Sebelum worker Part 7/8 jalan belum ada satu baris log pun;
tanpa membaca konfigurasi, halaman detail akan terlihat seolah form ini tidak punya
integrasi sama sekali — padahal jobnya cuma belum jalan. Karena itu penerima email
yang dikonfigurasi tapi belum punya log ditampilkan sebagai "Menunggu", dan
keadaan "belum ada catatan" dibedakan dari "pending".

**Belum ada pencarian teks bebas.** Sempat dicoba lewat filter `string_contains`
milik Prisma pada kolom JSONB, tapi tanpa `path` filter itu tidak mencocokkan
apa pun — dan ketahuan justru karena hasilnya selalu nol. Melakukannya dengan benar
butuh `answers::text ILIKE` lewat SQL mentah plus index trigram supaya tidak
memindai seluruh tabel; itu pekerjaan yang lebih pas digabung dengan agregasi di
Part 9. Yang tersedia sekarang filter form dan rentang tanggal, keduanya memakai
index yang sudah ada.

**TanStack Table 9, bukan 8.** Versi 9 memakai `useTable` + `tableFeatures()`
alih-alih `useReactTable` + `getCoreRowModel()`; fitur harus didaftarkan eksplisit,
jadi hanya `columnVisibilityFeature` yang ikut terbawa. Pagination sengaja tidak
memakai fitur bawaannya karena datanya sudah dipotong server.

**Catatan untuk part berikutnya:**

- **Ekspor dibatasi 20.000 baris** dan disusun di memori. Kalau nanti perlu lebih,
  ekspornya harus jadi job antrean yang mengirim tautan unduhan — bukan sekadar
  menaikkan angkanya. Header `X-Export-Truncated` sudah dikirim dan dashboard
  sudah menampilkan peringatannya.
- Rentang tanggal diperlakukan dalam **waktu server** (UTC di compose). Untuk
  pemakaian lintas zona waktu, filter perlu menerima offset dari klien.
- Log integrasi spreadsheet dicocokkan lewat `target = spreadsheetId`. Worker
  Part 7 harus menulis kolom `target` dengan nilai itu, kalau tidak status di
  halaman detail tidak akan menempel ke integrasi yang benar saat satu form punya
  lebih dari satu tujuan.
- Penerima dinamis (`notification_rules.recipient_rules`) belum ikut dihitung di
  `expectedRecipients` — baru `recipients` yang statis. Menunggu Part 8 yang
  menentukan cara evaluasinya.
- Belum ada aksi retry manual dari dashboard (Part 7) dan belum ada hapus/arsip
  submission (dipindah ke Part 9).
- Belum ada sort per kolom; urutan tetap terbaru dulu.

## ⬜ Part 7 — Integrasi Google Sheets (queue + worker)

- [ ] Upload file lewat presigned URL ke MinIO (dipindah dari Part 5 & 6), lalu
      nyalakan validasi `file_upload` di `answer-validation.ts`
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

- [ ] Manajemen user & role di dashboard (dipindah dari Part 4)
- [ ] Hapus/arsip submission sesuai permission (dipindah dari Part 6)
- [ ] Pencarian teks bebas pada jawaban (butuh index trigram, lihat catatan Part 6)
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
