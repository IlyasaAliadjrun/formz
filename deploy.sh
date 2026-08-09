#!/usr/bin/env bash
#
# Deploy Formz ke server produksi.
#
#   ./deploy.sh                 # tarik perubahan, build, migrasi, naikkan stack
#   ./deploy.sh --no-pull       # pakai kode yang sudah ada di server (rollback manual)
#   ./deploy.sh --no-build      # hanya migrasi + restart, tanpa build ulang
#   ./deploy.sh --skip-migrate  # naikkan stack tanpa menyentuh skema database
#
# Dijalankan langsung di server lewat SSH; tidak ada CI/CD di alur ini.
#
# Urutannya disengaja: **migrasi dijalankan sebelum container aplikasi naik**,
# dan hasilnya ditunggu. Kalau migrasi gagal, skrip berhenti dan versi lama
# tetap melayani — jauh lebih baik daripada aplikasi baru yang naik lalu terus
# melempar error ke pengunjung karena skema yang dibutuhkannya belum ada.

set -Eeuo pipefail

cd "$(dirname "$0")"

ENV_FILE=".env.production"
COMPOSE_FILE="docker-compose.prod.yml"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

DO_PULL=true
DO_BUILD=true
DO_MIGRATE=true

for arg in "$@"; do
	case "$arg" in
	--no-pull) DO_PULL=false ;;
	--no-build) DO_BUILD=false ;;
	--skip-migrate) DO_MIGRATE=false ;;
	-h | --help)
		sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
		exit 0
		;;
	*)
		echo "Argumen tidak dikenal: $arg" >&2
		echo "Jalankan '$0 --help' untuk daftar argumen." >&2
		exit 2
		;;
	esac
done

# ---------------------------------------------------------------------------
# Keluaran
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
	BOLD=$(printf '\033[1m') RED=$(printf '\033[31m') GREEN=$(printf '\033[32m')
	YELLOW=$(printf '\033[33m') RESET=$(printf '\033[0m')
else
	BOLD='' RED='' GREEN='' YELLOW='' RESET=''
fi

step() { printf '\n%s==> %s%s\n' "$BOLD" "$1" "$RESET"; }
info() { printf '    %s\n' "$1"; }
warn() { printf '%s !  %s%s\n' "$YELLOW" "$1" "$RESET"; }
fail() {
	printf '%s ✗  %s%s\n' "$RED" "$1" "$RESET" >&2
	exit 1
}
ok() { printf '%s ✓  %s%s\n' "$GREEN" "$1" "$RESET"; }

trap 'fail "Deploy berhenti di baris $LINENO. Stack lama masih berjalan; perbaiki penyebabnya lalu jalankan ulang."' ERR

# ---------------------------------------------------------------------------
# Pemeriksaan awal
# ---------------------------------------------------------------------------
step "Memeriksa prasyarat"

command -v docker >/dev/null || fail "docker tidak ditemukan di PATH"
docker compose version >/dev/null 2>&1 || fail "plugin 'docker compose' tidak terpasang"
[ -f "$ENV_FILE" ] || fail "$ENV_FILE tidak ada. Salin dari .env.production.example lalu isi nilainya."
[ -f "$COMPOSE_FILE" ] || fail "$COMPOSE_FILE tidak ada — pastikan menjalankan skrip ini dari root repo."

# Berkas ini berisi seluruh kredensial produksi. Izin yang longgar berarti
# setiap akun di server bisa membacanya.
perms=$(stat -c '%a' "$ENV_FILE")
case "$perms" in
600 | 400) ;;
*) warn "$ENV_FILE punya izin $perms — sebaiknya 600 (chmod 600 $ENV_FILE)" ;;
esac

# Baris komentar dilewati — petunjuk cara mengisi memang menyebut
# "ganti-dengan-..." dan bukan berarti nilainya belum diisi.
if grep -v '^[[:space:]]*#' "$ENV_FILE" | grep -q 'ganti-dengan-'; then
	fail "$ENV_FILE masih memuat nilai contoh 'ganti-dengan-...'. Isi dulu semuanya."
fi

# Substitusi variabel compose sekaligus memvalidasi seluruh `${VAR:?...}`:
# variabel wajib yang kosong ketahuan di sini, sebelum apa pun dibangun.
"${COMPOSE[@]}" config --quiet || fail "Konfigurasi compose tidak valid — lihat pesan di atas."
ok "Prasyarat terpenuhi"

# ---------------------------------------------------------------------------
# Tarik perubahan
# ---------------------------------------------------------------------------
if [ "$DO_PULL" = true ]; then
	step "Menarik perubahan dari git"

	if [ -n "$(git status --porcelain)" ]; then
		fail "Ada perubahan yang belum di-commit di server. Periksa 'git status' — jangan menyunting kode langsung di produksi."
	fi

	before=$(git rev-parse --short HEAD)
	git pull --ff-only
	after=$(git rev-parse --short HEAD)

	if [ "$before" = "$after" ]; then
		info "Sudah pada versi terbaru ($after)"
	else
		info "$before → $after"
		git --no-pager log --oneline "$before..$after" | sed 's/^/    /'
	fi
else
	info "Melewati git pull (--no-pull), memakai kode yang ada di server: $(git rev-parse --short HEAD)"
fi

# ---------------------------------------------------------------------------
# Build image
# ---------------------------------------------------------------------------
if [ "$DO_BUILD" = true ]; then
	step "Membangun image produksi"
	info "Domain ikut tertanam di bundle browser saat tahap ini, jadi build ulang"
	info "memang diperlukan setiap APP_DOMAIN/API_DOMAIN/EMBED_DOMAIN berubah."

	"${COMPOSE[@]}" --profile tools build
	ok "Image terbangun"
else
	info "Melewati build (--no-build)"
fi

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
step "Menyiapkan database"

# Postgres perlu hidup dan sehat sebelum migrasi. `up -d --wait` menunggu
# healthcheck-nya, bukan sekadar containernya start.
"${COMPOSE[@]}" up -d --wait postgres redis
ok "Postgres & Redis siap"

if [ "$DO_MIGRATE" = true ]; then
	step "Menjalankan migrasi & seed"
	# `run --rm` mengembalikan exit code prosesnya, jadi migrasi yang gagal
	# menghentikan deploy lewat `set -e` sebelum aplikasi baru naik.
	"${COMPOSE[@]}" run --rm migrator
	ok "Skema database mutakhir"
else
	warn "Migrasi dilewati (--skip-migrate) — pastikan skema database memang sudah sesuai"
fi

# ---------------------------------------------------------------------------
# Naikkan stack
# ---------------------------------------------------------------------------
step "Menaikkan seluruh service"

"${COMPOSE[@]}" up -d --remove-orphans minio
"${COMPOSE[@]}" run --rm minio-init >/dev/null
"${COMPOSE[@]}" up -d --remove-orphans

ok "Container berjalan"

# ---------------------------------------------------------------------------
# Verifikasi
# ---------------------------------------------------------------------------
step "Memverifikasi"

# Dicek dari dalam jaringan Docker, bukan lewat domain publik: kalau DNS atau
# sertifikat yang bermasalah, yang perlu diketahui lebih dulu adalah apakah
# aplikasinya sendiri sehat.
health=""
for _ in $(seq 1 30); do
	if health=$("${COMPOSE[@]}" exec -T api wget -q -O- http://127.0.0.1:4000/health 2>/dev/null); then
		break
	fi
	sleep 2
done

if [ -z "$health" ]; then
	fail "API tidak menjawab /health dalam 60 detik. Lihat: ${COMPOSE[*]} logs --tail 100 api"
fi

case "$health" in
*'"status":"ok"'*) ok "API sehat — Postgres & Redis terhubung" ;;
*) fail "API menjawab tapi statusnya belum ok: $health" ;;
esac

"${COMPOSE[@]}" ps --format 'table {{.Service}}\t{{.Status}}'

# ---------------------------------------------------------------------------
# Bersih-bersih
# ---------------------------------------------------------------------------
step "Membersihkan image lama"
# Hanya image tanpa tag yang tergantikan build barusan. Volume TIDAK pernah
# disentuh di sini — database, berkas MinIO, dan sertifikat Caddy ada di sana.
docker image prune -f >/dev/null
ok "Selesai"

APP_DOMAIN=$(grep -E '^APP_DOMAIN=' "$ENV_FILE" | cut -d= -f2-)
printf '\n%sDeploy selesai.%s Buka https://%s\n\n' "$BOLD" "$RESET" "$APP_DOMAIN"
