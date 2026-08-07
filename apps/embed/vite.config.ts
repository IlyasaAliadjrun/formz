import preact from '@preact/preset-vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // loadEnv hanya membaca file .env; di Docker nilainya disuntik lewat process.env.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const port = Number(env.EMBED_PORT ?? 5173);

  return {
    plugins: [preact()],

    server: {
      // 0.0.0.0 supaya bisa diakses dari luar container Docker.
      host: '0.0.0.0',
      port,
      strictPort: true,
      watch: {
        // Bind mount di Docker kadang tidak meneruskan event inotify dengan andal.
        usePolling: env.VITE_USE_POLLING === 'true',
      },
    },

    preview: {
      host: '0.0.0.0',
      port,
    },

    build: {
      // Bundle harus kecil — ini yang dikirim ke website pihak ketiga.
      target: 'es2020',
      sourcemap: true,
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name].[hash].js',
        },
      },
    },
  };
});
