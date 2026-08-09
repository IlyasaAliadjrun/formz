-- Agregasi laporan (ARCHITECTURE.md bagian 3.6).
--
-- Isi berkas ini ditulis tangan, bukan hasil `prisma migrate dev`: materialized
-- view tidak bisa dinyatakan di schema.prisma. Yang ada di sana hanya tabel
-- `report_refresh_state`; keempat view di bawah dibaca API lewat SQL mentah dan
-- di-refresh worker lewat job berjadwal.
--
-- Bucket sengaja dihitung dengan `AT TIME ZONE 'UTC'`, bukan `date_trunc` polos.
-- `date_trunc` pada timestamptz mengikuti zona waktu sesi, sehingga hasil refresh
-- akan berbeda tergantung siapa yang menjalankannya — persis jenis bug yang
-- sudah pernah menggigit di Part 7 (lihat catatan timestamp di PROGRESS.md).

-- ---------------------------------------------------------------------------
-- Catatan kapan tiap view terakhir di-refresh
-- ---------------------------------------------------------------------------

CREATE TABLE "report_refresh_state" (
    "view_name" TEXT NOT NULL,
    -- Sengaja tidak diperbarui saat refresh gagal: yang ingin diketahui pembaca
    -- laporan adalah kapan angka di layarnya benar-benar dihitung ulang.
    "refreshed_at" TIMESTAMPTZ(3),
    "duration_ms" INTEGER,
    "row_count" INTEGER,
    "error_message" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_refresh_state_pkey" PRIMARY KEY ("view_name")
);

-- ---------------------------------------------------------------------------
-- Tren submission per hari
-- ---------------------------------------------------------------------------
-- Tren mingguan disusun dari view ini juga (`date_trunc('week', bucket)`) —
-- view kedua yang isinya data sama dengan pengelompokan berbeda hanya menambah
-- satu hal lagi yang bisa menyimpang.

CREATE MATERIALIZED VIEW "report_submission_daily" AS
SELECT s.form_id,
       (s.submitted_at AT TIME ZONE 'UTC')::date AS bucket,
       count(*)                                  AS submission_count,
       min(s.submitted_at)                       AS first_at,
       max(s.submitted_at)                       AS last_at
  FROM submissions s
 GROUP BY 1, 2;

-- Unique index wajib ada: tanpanya `REFRESH MATERIALIZED VIEW CONCURRENTLY`
-- ditolak, dan refresh non-concurrent mengunci view-nya terhadap pembaca.
CREATE UNIQUE INDEX "report_submission_daily_key"
    ON "report_submission_daily" (form_id, bucket);

-- ---------------------------------------------------------------------------
-- Status integrasi per hari
-- ---------------------------------------------------------------------------
-- Dikelompokkan berdasarkan tanggal *submission*-nya, bukan tanggal log-nya,
-- supaya filter periode di halaman laporan berarti hal yang sama untuk semua
-- angka di layar: "submission yang masuk dalam rentang ini".

CREATE MATERIALIZED VIEW "report_integration_daily" AS
SELECT s.form_id,
       (s.submitted_at AT TIME ZONE 'UTC')::date AS bucket,
       l.type,
       l.status,
       count(*)                                  AS log_count
  FROM submission_integration_logs l
  JOIN submissions s ON s.id = l.submission_id
 GROUP BY 1, 2, 3, 4;

CREATE UNIQUE INDEX "report_integration_daily_key"
    ON "report_integration_daily" (form_id, bucket, type, status);

-- ---------------------------------------------------------------------------
-- Distribusi jawaban
-- ---------------------------------------------------------------------------
-- Dua view, bukan satu. Cacah per opsi dan cacah penjawab per field memang bisa
-- ditumpuk dalam satu view lewat window function, tapi hasilnya berulang di tiap
-- baris opsi — dan siapa pun yang menjumlahkannya lintas hari akan menghitung
-- penjawab yang sama berkali-kali. Dipisah, penjumlahannya jujur apa adanya.
--
-- `answers` yang bukan objek JSON diganti objek kosong. Kolomnya memang selalu
-- diisi objek oleh endpoint submit, tapi satu baris menyimpang saja cukup untuk
-- membuat `jsonb_each` melempar error dan menggagalkan seluruh refresh.

CREATE MATERIALIZED VIEW "report_answer_field_daily" AS
SELECT s.form_id,
       (s.submitted_at AT TIME ZONE 'UTC')::date AS bucket,
       entry.key                                 AS field_id,
       count(*)                                  AS respondent_count
  FROM submissions s
  CROSS JOIN LATERAL jsonb_each(
      CASE WHEN jsonb_typeof(s.answers) = 'object' THEN s.answers ELSE '{}'::jsonb END
  ) AS entry(key, value)
 WHERE jsonb_typeof(entry.value) <> 'null'
   AND entry.value <> '""'::jsonb
   AND entry.value <> '[]'::jsonb
 GROUP BY 1, 2, 3;

CREATE UNIQUE INDEX "report_answer_field_daily_key"
    ON "report_answer_field_daily" (form_id, bucket, field_id);

-- Jawaban multiselect berupa array; satu submission menyumbang satu baris per
-- opsi yang dipilihnya. Jawaban tunggal dibungkus jadi array satu elemen supaya
-- keduanya lewat jalur yang sama.
CREATE MATERIALIZED VIEW "report_answer_option_daily" AS
SELECT s.form_id,
       (s.submitted_at AT TIME ZONE 'UTC')::date AS bucket,
       entry.key                                 AS field_id,
       item.value #>> '{}'                       AS option_id,
       count(*)                                  AS answer_count
  FROM submissions s
  CROSS JOIN LATERAL jsonb_each(
      CASE WHEN jsonb_typeof(s.answers) = 'object' THEN s.answers ELSE '{}'::jsonb END
  ) AS entry(key, value)
  CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(entry.value) = 'array'
           THEN entry.value
           ELSE jsonb_build_array(entry.value)
      END
  ) AS item(value)
 -- Hanya nilai yang bisa jadi "pilihan": id opsi (string) dan checkbox (boolean).
 -- Angka dan tanggal punya sebaran tak terbatas dan tidak pernah digambar
 -- sebagai chart distribusi, jadi tidak perlu ikut membesarkan view ini.
 WHERE jsonb_typeof(item.value) IN ('string', 'boolean')
   AND item.value #>> '{}' <> ''
 GROUP BY 1, 2, 3, 4;

CREATE UNIQUE INDEX "report_answer_option_daily_key"
    ON "report_answer_option_daily" (form_id, bucket, field_id, option_id);
