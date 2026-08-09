import { useEffect, useState } from 'preact/hooks';
import type { PublicForm } from '@formz/shared';
import './app.css';
import { FormView } from './components/form-view';
import { ApiError, fetchPublicForm } from './lib/api';
import { observeHeight } from './lib/parent-frame';

/**
 * Seluruh isi aplikasi ini: ambil satu form berdasarkan formKey di URL, lalu
 * render. Tidak ada navigasi, tidak ada layout dashboard, tidak ada halaman lain
 * — itulah alasan bundle-nya bisa tetap kecil (ARCHITECTURE.md bagian 3.2).
 */

const FORM_PATH = /^\/f\/([A-Za-z0-9_-]+)\/?$/;

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; form: PublicForm }
  | { phase: 'error'; message: string; status: number };

export function App() {
  const formKey = formKeyFromLocation();

  if (!formKey) return <UsageNotice />;

  return <FormLoader formKey={formKey} />;
}

function FormLoader({ formKey }: { formKey: string }) {
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    fetchPublicForm(formKey, controller.signal)
      .then((form) => setState({ phase: 'ready', form }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;

        setState({
          phase: 'error',
          message: error instanceof ApiError ? error.message : 'Form tidak bisa dimuat',
          status: error instanceof ApiError ? error.status : 0,
        });
      });

    return () => controller.abort();
  }, [formKey]);

  // Satu pengamat untuk seluruh umur aplikasi — memuat, gagal, mengisi, sampai
  // panel sukses. Tinggi harus tetap dilaporkan di semua keadaan itu, kalau
  // tidak iframe berhenti di tinggi awal dan isinya terpotong.
  useEffect(() => observeHeight(formKey), [formKey]);

  if (state.phase === 'loading') {
    return (
      <div class="fz-status" role="status">
        <span class="fz-spinner" aria-hidden="true" />
        Memuat form…
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div class="fz-status fz-status-error" role="alert">
        <strong>{state.status === 404 ? 'Form tidak ditemukan' : 'Form gagal dimuat'}</strong>
        <span>{state.message}</span>
      </div>
    );
  }

  return <FormView form={state.form} />;
}

/** Ditampilkan kalau seseorang membuka domain renderer tanpa formKey. */
function UsageNotice() {
  return (
    <div class="fz-status">
      <strong>Formz — form renderer</strong>
      <span>
        Buka form lewat <code>/f/&lt;formKey&gt;</code>, atau pasang di website dengan snippet dari
        halaman pengaturan embed.
      </span>
    </div>
  );
}

function formKeyFromLocation(): string | null {
  const fromPath = FORM_PATH.exec(window.location.pathname);

  if (fromPath?.[1]) return fromPath[1];

  // Bentuk `?form=` berguna saat mencoba di lingkungan yang tidak punya
  // rewrite URL (misal membuka berkas build langsung).
  return new URLSearchParams(window.location.search).get('form');
}
