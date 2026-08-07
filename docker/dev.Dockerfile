# Image dasar untuk semua service Node saat development.
# Source code di-bind mount dari host, jadi image ini cuma menyediakan
# runtime (Node + pnpm) — bukan hasil build aplikasi.
FROM node:22-alpine

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# libc6-compat dibutuhkan sebagian binary native (esbuild, swc) di Alpine.
RUN apk add --no-cache libc6-compat curl bash git

RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

# Store pnpm dipisah ke volume supaya install antar container tidak mengunduh ulang.
RUN mkdir -p /pnpm/store /workspace && chown -R node:node /pnpm /workspace

WORKDIR /workspace
USER node

CMD ["node", "--version"]
