import path from 'node:path';
import type { NextConfig } from 'next';

const monorepoRoot = path.resolve(process.cwd(), '../..');

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // @formz/shared dipublish sebagai TypeScript/CommonJS internal, perlu ikut di-transpile.
  transpilePackages: ['@formz/shared'],

  // Di monorepo, root harus ditunjuk eksplisit supaya Next tidak salah menebak
  // lokasi lockfile dan ikut menelusuri folder di luar workspace.
  turbopack: { root: monorepoRoot },
  outputFileTracingRoot: monorepoRoot,

  // Dipakai container/reverse proxy nanti (Dockerfile produksi di part deployment).
  output: 'standalone',
};

export default nextConfig;
