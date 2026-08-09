/*
 * Formz — loader mode script tag.
 *
 * Alternatif dari memasang <iframe> sendiri. Yang dikerjakan cuma tiga hal:
 * membuat iframe, mendengarkan pesan tinggi dari form untuk menyesuaikan
 * tingginya, dan meneruskan permintaan redirect setelah submit.
 *
 * Dua cara pakai:
 *
 *   <script src="https://embed.contoh.com/embed.js" data-form="FORM_KEY"></script>
 *   → iframe dibuat tepat di posisi tag script ini.
 *
 *   <div data-formz="FORM_KEY"></div>
 *   <script src="https://embed.contoh.com/embed.js" async></script>
 *   → mengisi setiap elemen ber-atribut data-formz; dipakai kalau ada beberapa
 *     form dalam satu halaman, atau kalau posisi script tidak bisa diatur.
 *
 * Sengaja ditulis sebagai berkas statis di public/ dan bukan modul yang di-bundle:
 * isinya tidak butuh Preact maupun kode form sama sekali, jadi halaman yang
 * memasangnya hanya mengunduh beberapa ratus byte sampai iframe-nya dibuka.
 * Karena itu pula tidak ada langkah transpilasi: yang ditulis di sini persis
 * yang dijalankan browser.
 */
(function () {
  'use strict';

  var script = document.currentScript;

  if (!script || !script.src) return;

  var origin = new URL(script.src, window.location.href).origin;
  var frames = [];

  /** Nilai default dipilih supaya form pendek pun tidak tampak terpotong saat memuat. */
  var DEFAULT_MIN_HEIGHT = 320;

  function createFrame(formKey, host, options) {
    if (!formKey) return;

    var iframe = document.createElement('iframe');

    iframe.src = origin + '/f/' + encodeURIComponent(formKey);
    iframe.title = options.title || 'Formulir';
    iframe.loading = 'lazy';
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('allowtransparency', 'true');
    iframe.style.width = '100%';
    iframe.style.border = '0';
    iframe.style.display = 'block';
    iframe.style.minHeight = (options.minHeight || DEFAULT_MIN_HEIGHT) + 'px';
    // Transisi kecil supaya perubahan tinggi saat field muncul/hilang tidak
    // membuat isi halaman di bawahnya melompat mendadak.
    iframe.style.transition = 'height 120ms ease-out';

    host.appendChild(iframe);
    frames.push(iframe);
  }

  function findFrame(source) {
    for (var i = 0; i < frames.length; i += 1) {
      if (frames[i].contentWindow === source) return frames[i];
    }

    return null;
  }

  window.addEventListener('message', function (event) {
    // Dua pemeriksaan yang membuat halaman lain tidak bisa menyetir iframe ini:
    // pesannya harus berasal dari origin renderer, dan dari jendela iframe yang
    // memang dibuat skrip ini.
    if (event.origin !== origin) return;

    var data = event.data;

    if (!data || data.source !== 'formz') return;

    var iframe = findFrame(event.source);

    if (!iframe) return;

    if (data.type === 'ready' || data.type === 'resize') {
      if (typeof data.height === 'number' && data.height > 0) {
        iframe.style.height = data.height + 'px';
      }
      return;
    }

    if (data.type === 'submitted') {
      // Halaman induk bisa memasang listener sendiri, misal untuk memicu
      // pelacakan konversi tanpa perlu tahu apa pun tentang isi form.
      iframe.dispatchEvent(
        new CustomEvent('formz:submitted', {
          bubbles: true,
          detail: { formKey: data.formKey, submissionId: data.submissionId },
        }),
      );
      return;
    }

    if (data.type === 'redirect' && typeof data.url === 'string') {
      // Hanya http/https. Tanpa cek ini, `javascript:` dari respons yang
      // dimanipulasi bisa berjalan di origin halaman yang memasang form.
      var target;

      try {
        target = new URL(data.url, window.location.href);
      } catch {
        return;
      }

      if (target.protocol === 'http:' || target.protocol === 'https:') {
        window.location.href = target.href;
      }
    }
  });

  function mount() {
    // Mode 1: formKey ditulis langsung di tag script.
    var inlineKey = script.getAttribute('data-form') || script.getAttribute('data-formz');

    if (inlineKey) {
      var host = document.createElement('div');

      host.className = 'formz-embed';
      // Disisipkan tepat sebelum tag script supaya form muncul di tempat
      // snippet-nya dipasang, bukan di ujung halaman.
      if (script.parentNode) script.parentNode.insertBefore(host, script);

      createFrame(inlineKey, host, {
        title: script.getAttribute('data-title'),
        minHeight: Number(script.getAttribute('data-height')) || 0,
      });
    }

    // Mode 2: elemen wadah di mana pun di halaman.
    var containers = document.querySelectorAll('[data-formz],[data-form-key]');

    for (var i = 0; i < containers.length; i += 1) {
      var container = containers[i];

      // Wadah yang sudah diisi dilewati, supaya script yang tidak sengaja
      // dipasang dua kali tidak menghasilkan form ganda.
      if (container.getAttribute('data-formz-mounted') === 'true') continue;

      container.setAttribute('data-formz-mounted', 'true');

      createFrame(
        container.getAttribute('data-formz') || container.getAttribute('data-form-key'),
        container,
        {
          title: container.getAttribute('data-title'),
          minHeight: Number(container.getAttribute('data-height')) || 0,
        },
      );
    }
  }

  // Dengan atribut `async`/`defer`, script bisa jalan sebelum wadahnya ada di DOM.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
