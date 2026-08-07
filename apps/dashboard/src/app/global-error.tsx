'use client';

/**
 * Penangkap error terakhir — menggantikan root layout sepenuhnya, jadi harus
 * merender <html> dan <body> sendiri dan tidak boleh bergantung pada provider
 * apa pun (React Query, toaster) karena keduanya mungkin justru yang gagal.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="id">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          background: '#f8fafc',
          color: '#0f172a',
        }}
      >
        <div style={{ maxWidth: 480, padding: 32, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px' }}>Terjadi kesalahan</h1>
          <p style={{ color: '#64748b', fontSize: 14, margin: '0 0 20px' }}>
            Dashboard gagal dimuat. Coba muat ulang halaman.
            {error.digest ? ` (kode: ${error.digest})` : ''}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: 0,
              background: '#0f172a',
              color: '#fff',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Coba lagi
          </button>
        </div>
      </body>
    </html>
  );
}
