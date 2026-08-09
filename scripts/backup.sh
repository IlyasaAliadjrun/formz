#!/usr/bin/env bash
#
# Backup Formz: dump database PostgreSQL + isi folder data MinIO, lalu unggah
# keduanya ke storage offsite lewat rclone.
#
# Dijadwalkan lewat cron (lihat SETUP_SERVER.md):
#   15 2 * * *  /home/formz/formz/scripts/backup.sh >> /var/log/formz-backup.log 2>&1
#
# Bisa juga dijalankan manual kapan saja — misalnya tepat sebelum deploy yang
# membawa migrasi besar.
#
# Tidak ada satu pun kredensial di berkas ini. Password database dibaca dari
# .env.production, dan kredensial storage offsite dari berkas konfigurasi rclone
# (lihat scripts/rclone.conf.example).

set -Eeuo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

ENV_FILE="$REPO_DIR/.env.production"
COMPOSE_FILE="$REPO_DIR/docker-compose.prod.yml"

log() { printf '[%s] %s\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')" "$1"; }
fail() {
	log "GAGAL: $1"
	exit 1
}

[ -f "$ENV_FILE" ] || fail "$ENV_FILE tidak ada"

# Nilai dibaca satu per satu, BUKAN dengan `source .env.production`.
#
# Format env-file yang dipahami docker compose tidak sama dengan sintaks shell:
# `ADMIN_NAME=Super Admin` dan `MAIL_FROM=Formz <no-reply@example.com>` sah bagi
# compose, tapi shell membacanya sebagai perintah `Admin` dan sebagai pengalihan
# input dari berkas. Mengeksekusi berkas kredensial sebagai skrip juga berarti
# satu tanda backtick yang tidak sengaja terketik di sana akan benar-benar
# dijalankan — di skrip yang berjalan otomatis tiap malam lewat cron.
env_value() {
	sed -n "s/^[[:space:]]*$1=//p" "$ENV_FILE" | tail -n 1 |
		sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

POSTGRES_USER="$(env_value POSTGRES_USER)"
POSTGRES_DB="$(env_value POSTGRES_DB)"
POSTGRES_PASSWORD="$(env_value POSTGRES_PASSWORD)"

[ -n "$POSTGRES_USER" ] || fail "POSTGRES_USER tidak terbaca dari $ENV_FILE"
[ -n "$POSTGRES_DB" ] || fail "POSTGRES_DB tidak terbaca dari $ENV_FILE"

COMPOSE_PROJECT_NAME="$(env_value COMPOSE_PROJECT_NAME)"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-formz}"

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

BACKUP_DIR="$(env_value BACKUP_DIR)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/formz}"
RETENTION_DAYS="$(env_value BACKUP_RETENTION_DAYS)"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
OFFSITE_RETENTION_DAYS="$(env_value BACKUP_OFFSITE_RETENTION_DAYS)"
OFFSITE_RETENTION_DAYS="${OFFSITE_RETENTION_DAYS:-90}"
RCLONE_REMOTE="$(env_value RCLONE_REMOTE)"
RCLONE_PATH="$(env_value RCLONE_PATH)"
RCLONE_PATH="${RCLONE_PATH:-formz}"
RCLONE_CONFIG="$(env_value RCLONE_CONFIG)"
RCLONE_CONFIG="${RCLONE_CONFIG:-$REPO_DIR/scripts/rclone.conf}"
BACKUP_PING_URL="$(env_value BACKUP_PING_URL)"

STAMP="$(date -u '+%Y%m%d-%H%M%S')"
DB_FILE="$BACKUP_DIR/formz-db-$STAMP.sql.gz"
MINIO_FILE="$BACKUP_DIR/formz-minio-$STAMP.tar.gz"

mkdir -p "$BACKUP_DIR"
# Isi backup adalah seluruh data aplikasi, termasuk hash password dan jawaban
# form. Foldernya tidak boleh bisa dibaca akun lain di server.
chmod 700 "$BACKUP_DIR"

# Berkas separuh jadi lebih berbahaya daripada tidak ada berkas sama sekali:
# ia terlihat seperti backup yang sah sampai ada yang mencoba me-restore-nya.
cleanup_partial() {
	local code=$?
	if [ $code -ne 0 ]; then
		rm -f "$DB_FILE" "$MINIO_FILE"
		log "Berkas backup yang belum selesai dihapus"
	fi
	return $code
}
trap cleanup_partial EXIT

log "=== Backup Formz dimulai ==="

# ---------------------------------------------------------------------------
# 1. Database
# ---------------------------------------------------------------------------
# pg_dump dijalankan di dalam container postgres, jadi versi client dan server
# dijamin sama — beda versi adalah penyebab paling umum dump yang tidak bisa
# di-restore. `--clean --if-exists` membuat hasilnya bisa dipulihkan ke database
# yang sudah berisi tanpa perlu drop manual lebih dulu.
log "Membuat dump database ${POSTGRES_DB}..."
"${COMPOSE[@]}" exec -T \
	-e PGPASSWORD="$POSTGRES_PASSWORD" \
	postgres pg_dump \
	--username="$POSTGRES_USER" \
	--dbname="$POSTGRES_DB" \
	--clean --if-exists --no-owner --no-privileges |
	gzip -9 >"$DB_FILE"

# Pipe menyembunyikan kegagalan pg_dump di balik exit code gzip yang sukses,
# jadi hasilnya diperiksa sendiri. Dump kosong = dump gagal.
db_size=$(stat -c '%s' "$DB_FILE")
[ "$db_size" -gt 1000 ] || fail "dump database hanya $db_size byte — hampir pasti gagal"

# Pemeriksaan isi, bukan sekadar ukuran: gzip yang rusak baru ketahuan di sini,
# bukan setahun lagi saat datanya benar-benar dibutuhkan.
gzip -t "$DB_FILE" || fail "berkas dump rusak (gagal uji gzip)"
zcat "$DB_FILE" | grep -q 'CREATE TABLE public.submissions' ||
	fail "dump tidak memuat tabel submissions — isinya tidak seperti database Formz"

log "Dump database selesai: $(du -h "$DB_FILE" | cut -f1)"

# ---------------------------------------------------------------------------
# 2. Berkas MinIO
# ---------------------------------------------------------------------------
# Diarsipkan langsung dari volume-nya lewat container sekali pakai. Cara ini
# tidak menuntut MinIO berhenti, dan tidak butuh kredensial MinIO sama sekali.
log "Mengarsipkan data MinIO..."
docker run --rm \
	-v "${COMPOSE_PROJECT_NAME}_miniodata:/data:ro" \
	-v "$BACKUP_DIR:/backup" \
	alpine:3 \
	tar -czf "/backup/$(basename "$MINIO_FILE")" -C /data . ||
	fail "gagal mengarsipkan volume MinIO"

gzip -t "$MINIO_FILE" || fail "arsip MinIO rusak (gagal uji gzip)"
log "Arsip MinIO selesai: $(du -h "$MINIO_FILE" | cut -f1)"

# ---------------------------------------------------------------------------
# 3. Unggah ke storage offsite
# ---------------------------------------------------------------------------
# Backup yang hanya ada di server yang sama dengan datanya bukan backup: disk
# rusak, server hilang, keduanya ikut hilang bersamaan.
if [ -z "$RCLONE_REMOTE" ]; then
	log "PERINGATAN: RCLONE_REMOTE kosong — backup hanya tersimpan di server ini."
	log "            Isi RCLONE_REMOTE di .env.production untuk mengunggahnya keluar."
elif ! command -v rclone >/dev/null; then
	log "PERINGATAN: rclone tidak terpasang — unggahan dilewati."
elif [ ! -f "$RCLONE_CONFIG" ]; then
	log "PERINGATAN: $RCLONE_CONFIG tidak ada — unggahan dilewati."
	log "            Salin scripts/rclone.conf.example lalu jalankan 'rclone config'."
else
	dest="$RCLONE_REMOTE:$RCLONE_PATH/$(date -u '+%Y/%m')"
	log "Mengunggah ke $dest ..."

	rclone --config "$RCLONE_CONFIG" copy "$DB_FILE" "$dest" --transfers=2 --retries=3
	rclone --config "$RCLONE_CONFIG" copy "$MINIO_FILE" "$dest" --transfers=2 --retries=3

	# Verifikasi berkasnya benar-benar sampai, bukan cuma perintahnya sukses.
	rclone --config "$RCLONE_CONFIG" lsf "$dest/$(basename "$DB_FILE")" >/dev/null ||
		fail "berkas dump tidak ditemukan di storage offsite setelah diunggah"

	log "Unggahan selesai dan terverifikasi"

	# Retensi offsite dibuat jauh lebih panjang daripada lokal: gunanya justru
	# untuk kerusakan yang baru disadari berminggu-minggu kemudian.
	rclone --config "$RCLONE_CONFIG" delete "$RCLONE_REMOTE:$RCLONE_PATH" \
		--min-age "${OFFSITE_RETENTION_DAYS}d" --rmdirs || true
fi

# ---------------------------------------------------------------------------
# 4. Bersihkan salinan lokal yang lama
# ---------------------------------------------------------------------------
log "Menghapus backup lokal yang lebih tua dari ${RETENTION_DAYS} hari..."
find "$BACKUP_DIR" -maxdepth 1 -name 'formz-*.gz' -type f -mtime "+$RETENTION_DAYS" -print -delete |
	sed 's/^/    dihapus: /'

log "Sisa backup lokal: $(find "$BACKUP_DIR" -maxdepth 1 -name 'formz-*.gz' -type f | wc -l) berkas, total $(du -sh "$BACKUP_DIR" | cut -f1)"

# ---------------------------------------------------------------------------
# 5. Lapor
# ---------------------------------------------------------------------------
# Backup yang diam-diam berhenti berjalan baru ketahuan pada saat paling buruk.
# Ping ini yang membuat pemantau (healthchecks.io, Uptime Kuma) berteriak kalau
# suatu malam skrip ini tidak jadi jalan.
if [ -n "$BACKUP_PING_URL" ]; then
	if curl -fsS --max-time 20 --retry 3 "$BACKUP_PING_URL" >/dev/null; then
		log "Ping pemantauan terkirim"
	else
		# Backup-nya sendiri sudah berhasil; ping yang gagal tidak boleh
		# membuat skrip ini keluar dengan status error.
		log "PERINGATAN: ping pemantauan gagal"
	fi
fi

log "=== Backup selesai ==="
