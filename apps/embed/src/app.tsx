import './app.css';

/**
 * Placeholder form renderer.
 * Nanti komponen ini yang mengambil schema publik lewat GET /public/forms/:formKey/schema,
 * merender field sesuai registry, mengevaluasi conditional show/hide, lalu submit jawaban.
 */
export function App() {
  return (
    <div class="formz-shell">
      <div class="formz-card">
        <span class="formz-badge">Part 0 — Scaffolding</span>
        <h1 class="formz-title">Form renderer akan tampil di sini</h1>
        <p class="formz-text">
          Aplikasi ini sengaja dipisah dari dashboard admin: tidak ada kode builder, submission
          list, atau RBAC yang ikut ter-bundle ke website yang meng-embed form.
        </p>
        <dl class="formz-meta">
          <div>
            <dt>Embed via</dt>
            <dd>
              <code>&lt;iframe src="/f/{'{formKey}'}"&gt;</code>
            </dd>
          </div>
          <div>
            <dt>API publik</dt>
            <dd>
              <code>GET /public/forms/:formKey/schema</code>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
