import type { SubmissionResult } from '@formz/shared';

/**
 * Halaman terima kasih setelah submit berhasil.
 *
 * Isinya diambil dari `settings.successMessage` milik form, jadi sudah bisa
 * dikustom dari builder tanpa mengubah renderer.
 */
export function SuccessPanel({ result }: { result: SubmissionResult }) {
  return (
    <div class="fz-success" role="status">
      <svg class="fz-success-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="11" />
        <path d="M7 12.5l3.2 3.2L17 9" />
      </svg>

      <p class="fz-success-message">{result.message}</p>

      {result.redirectUrl && (
        // target="_top" supaya tautan membuka halaman penuh, bukan di dalam
        // iframe. Navigasi otomatis halaman induk ditangani embed.js; tombol ini
        // jalan keluar untuk iframe polos yang tidak memakainya.
        <a class="fz-success-link" href={result.redirectUrl} target="_top" rel="noopener">
          Lanjutkan
        </a>
      )}
    </div>
  );
}
