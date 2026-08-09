# Image produksi untuk keempat aplikasi Formz.
#
# Satu berkas dengan beberapa target, bukan empat Dockerfile terpisah: tahap
# `deps` dan `build` dipakai bersama, jadi `pnpm install` dan build
# `@formz/shared` hanya berjalan sekali untuk keempat image alih-alih empat kali.
# Pilih target lewat `build.target` di docker-compose.prod.yml.
#
# Yang jalan di produksi adalah **hasil build**, bukan source yang di-mount.
# Tidak ada bind mount, tidak ada tsx watch, tidak ada `next dev`.

# ---------------------------------------------------------------------------
# base — runtime Node + pnpm, dipakai semua tahap
# ---------------------------------------------------------------------------
FROM node:22-alpine AS base

# libc6-compat dibutuhkan sebagian binary native (esbuild, swc) di Alpine.
RUN apk add --no-cache libc6-compat

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

WORKDIR /workspace

# ---------------------------------------------------------------------------
# deps — seluruh dependency (termasuk devDependencies, dibutuhkan untuk build)
# ---------------------------------------------------------------------------
# Hanya manifest yang disalin lebih dulu supaya lapisan `pnpm install` tetap
# ter-cache selama package.json dan lockfile tidak berubah — mengubah satu baris
# kode tidak boleh memicu unduh ulang seluruh dependency.
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/embed/package.json apps/embed/

# --ignore-scripts mematikan `postinstall: prisma generate` milik apps/api;
# generate-nya dijalankan eksplisit di tahap build, setelah schema-nya ikut tersalin.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ---------------------------------------------------------------------------
# manifests — hanya package.json + lockfile, dipakai ulang tiga tahap install
# ---------------------------------------------------------------------------
FROM base AS manifests

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/embed/package.json apps/embed/

# ---------------------------------------------------------------------------
# api-deps / worker-deps — dependency runtime, dipisah per aplikasi
# ---------------------------------------------------------------------------
# `--filter @formz/x...` (dengan tiga titik) memasang dependency aplikasi itu
# beserta workspace package yang dipakainya. Pemisahan ini bukan kerapian
# belaka: tanpa filter, kedua image ikut membawa seluruh isi node_modules
# monorepo — worker menyeret Next.js dan Recharts, api menyeret googleapis yang
# ~100 MB dan sama sekali tidak dipanggil dari sana.
#
# Keduanya dipasang di pohon direktori yang sama (`/workspace`) dengan image
# akhir supaya symlink pnpm — termasuk `@formz/shared` yang menunjuk ke
# ../../packages/shared — tetap sahih setelah disalin antar tahap.
FROM manifests AS api-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@formz/api..."

FROM manifests AS worker-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@formz/worker..."

# ---------------------------------------------------------------------------
# migrator-deps — dependency apps/api termasuk devDependencies
# ---------------------------------------------------------------------------
# Prisma CLI (menjalankan migrasi) dan tsx (menjalankan seed) keduanya
# devDependencies, jadi tahap ini tidak bisa memakai --prod. Tetap difilter ke
# apps/api saja supaya toolchain dashboard dan worker tidak ikut terbawa.
FROM manifests AS migrator-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter "@formz/api..."

# ---------------------------------------------------------------------------
# build — kompilasi keempat aplikasi
# ---------------------------------------------------------------------------
FROM deps AS build

# URL berikut **tertanam di bundle browser** saat build (NEXT_PUBLIC_* di Next.js,
# import.meta.env.VITE_* di Vite), bukan dibaca saat container start. Artinya
# mengganti domain menuntut build ulang — bukan sekadar mengubah .env lalu restart.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_EMBED_URL=http://localhost:5173
ARG VITE_API_URL=http://localhost:4000

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_EMBED_URL=$NEXT_PUBLIC_EMBED_URL
ENV VITE_API_URL=$VITE_API_URL
ENV NEXT_TELEMETRY_DISABLED=1

COPY . .

# @formz/shared lebih dulu: ketiga aplikasi lain mengimpor hasil build-nya.
RUN pnpm --filter @formz/shared build
RUN pnpm --filter @formz/api build
RUN pnpm --filter @formz/worker build
RUN pnpm --filter @formz/dashboard build
RUN pnpm --filter @formz/embed build

# ---------------------------------------------------------------------------
# api — NestJS
# ---------------------------------------------------------------------------
FROM base AS api

ENV NODE_ENV=production

COPY --from=api-deps /workspace/node_modules ./node_modules
COPY --from=api-deps /workspace/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=api-deps /workspace/apps/api/node_modules ./apps/api/node_modules

COPY --from=build /workspace/packages/shared/package.json ./packages/shared/
COPY --from=build /workspace/packages/shared/dist ./packages/shared/dist
COPY --from=build /workspace/packages/shared/dist-esm ./packages/shared/dist-esm

COPY --from=build /workspace/apps/api/package.json ./apps/api/
COPY --from=build /workspace/apps/api/dist ./apps/api/dist

USER node
WORKDIR /workspace/apps/api
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -q -O- http://127.0.0.1:4000/health/live || exit 1

CMD ["node", "dist/main.js"]

# ---------------------------------------------------------------------------
# migrator — menjalankan migrasi & seed, lalu keluar
# ---------------------------------------------------------------------------
# Isinya sengaja disusun sendiri alih-alih `FROM build`: tahap build memuat
# seluruh source, cache Next.js, dan toolchain keempat aplikasi — beberapa
# gigabyte yang tidak ada gunanya di server hanya untuk menjalankan dua perintah.
#
# Yang benar-benar dibutuhkan cuma empat hal: Prisma CLI, berkas migrasi,
# skrip seed beserta klien Prisma hasil generate yang diimpornya, dan
# @formz/shared (seed membaca katalog permission dari sana).
FROM base AS migrator

ENV NODE_ENV=production

COPY --from=migrator-deps /workspace/node_modules ./node_modules
COPY --from=migrator-deps /workspace/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=migrator-deps /workspace/apps/api/node_modules ./apps/api/node_modules

COPY --from=build /workspace/packages/shared/package.json ./packages/shared/
COPY --from=build /workspace/packages/shared/dist ./packages/shared/dist
COPY --from=build /workspace/packages/shared/dist-esm ./packages/shared/dist-esm

COPY --from=build /workspace/apps/api/package.json /workspace/apps/api/prisma.config.ts \
    /workspace/apps/api/tsconfig.json ./apps/api/
COPY --from=build /workspace/apps/api/prisma ./apps/api/prisma
# Diimpor seed.ts sebagai TypeScript, jadi yang disalin sumber hasil generate-nya,
# bukan hasil kompilasi di dist.
COPY --from=build /workspace/apps/api/src/generated ./apps/api/src/generated

WORKDIR /workspace/apps/api

# Binari dipanggil langsung dari node_modules/.bin, bukan lewat `pnpm exec`:
# pnpm memeriksa keutuhan workspace sebelum menjalankan apa pun, dan image ini
# sengaja tidak memuat pnpm-workspace.yaml maupun source workspace lain — jadi
# pemeriksaan itu akan menyimpulkan dependency-nya rusak lalu mencoba install
# ulang di server produksi. PATH juga dipakai Prisma saat memanggil `tsx`
# (perintah seed di prisma.config.ts).
ENV PATH=/workspace/apps/api/node_modules/.bin:$PATH

CMD ["sh", "-c", "prisma migrate deploy && prisma db seed"]

# ---------------------------------------------------------------------------
# worker — consumer BullMQ
# ---------------------------------------------------------------------------
FROM base AS worker

ENV NODE_ENV=production

COPY --from=worker-deps /workspace/node_modules ./node_modules
COPY --from=worker-deps /workspace/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=worker-deps /workspace/apps/worker/node_modules ./apps/worker/node_modules

COPY --from=build /workspace/packages/shared/package.json ./packages/shared/
COPY --from=build /workspace/packages/shared/dist ./packages/shared/dist
COPY --from=build /workspace/packages/shared/dist-esm ./packages/shared/dist-esm

COPY --from=build /workspace/apps/worker/package.json ./apps/worker/
COPY --from=build /workspace/apps/worker/dist ./apps/worker/dist

USER node
WORKDIR /workspace/apps/worker

CMD ["node", "dist/main.js"]

# ---------------------------------------------------------------------------
# dashboard — Next.js standalone
# ---------------------------------------------------------------------------
# `output: 'standalone'` di next.config.ts sudah menghasilkan server beserta
# node_modules yang benar-benar dipakai, jadi tahap ini tidak butuh prod-deps
# sama sekali — inilah image paling ramping dari keempatnya.
FROM base AS dashboard

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=build /workspace/apps/dashboard/.next/standalone ./
# Aset statis ber-hash tidak ikut ke dalam standalone dan harus disalin sendiri.
COPY --from=build /workspace/apps/dashboard/.next/static ./apps/dashboard/.next/static
# Tidak ada apps/dashboard/public: dashboard tidak menyajikan berkas statis di
# luar bundle-nya. Berkas publik satu-satunya di project ini (embed.js) milik
# apps/embed. Tambahkan COPY-nya di sini kalau nanti foldernya dibuat.

USER node
EXPOSE 3000

CMD ["node", "apps/dashboard/server.js"]

# ---------------------------------------------------------------------------
# embed — form renderer statis
# ---------------------------------------------------------------------------
# Hasil `vite build` adalah berkas statis; tidak ada proses Node yang perlu
# hidup. Disajikan Caddy dari dalam container supaya reverse proxy di depan
# memperlakukan ketiga domain dengan cara yang sama (reverse_proxy), alih-alih
# satu di antaranya butuh penanganan berkas khusus.
FROM caddy:2-alpine AS embed

COPY docker/embed.Caddyfile /etc/caddy/Caddyfile
COPY --from=build /workspace/apps/embed/dist /srv

EXPOSE 5173
