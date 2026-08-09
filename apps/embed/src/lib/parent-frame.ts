/**
 * Komunikasi iframe → halaman induk lewat postMessage (ARCHITECTURE.md bagian 3.2).
 *
 * Tanpa ini, website yang memasang form harus menebak tinggi iframe: form dengan
 * conditional show/hide berubah tinggi setiap kali pengisi memilih sesuatu, jadi
 * tinggi tetap pasti salah — entah terpotong atau menyisakan ruang kosong.
 *
 * Pesan dikirim dengan `targetOrigin: '*'` karena renderer tidak tahu (dan tidak
 * perlu tahu) origin halaman yang memasangnya. Aman karena isi pesannya memang
 * publik: tinggi elemen dan id submission yang baru dibuat — tidak ada jawaban
 * pengisi form maupun token di dalamnya. Sisi penerima (`embed.js`) yang
 * memverifikasi bahwa pesan datang dari iframe miliknya.
 */

export const MESSAGE_SOURCE = 'formz';

export type ParentMessage =
  | { source: typeof MESSAGE_SOURCE; type: 'ready'; formKey: string; height: number }
  | { source: typeof MESSAGE_SOURCE; type: 'resize'; formKey: string; height: number }
  | { source: typeof MESSAGE_SOURCE; type: 'submitted'; formKey: string; submissionId: string }
  | { source: typeof MESSAGE_SOURCE; type: 'redirect'; formKey: string; url: string };

export function isEmbedded(): boolean {
  return typeof window !== 'undefined' && window.parent !== window;
}

export function postToParent(message: ParentMessage): void {
  if (!isEmbedded()) return;

  window.parent.postMessage(message, '*');
}

/**
 * Melaporkan tinggi konten ke induk setiap kali berubah.
 *
 * Memakai ResizeObserver, bukan polling interval: perubahan tinggi di sini
 * selalu berasal dari render ulang (field muncul/hilang, pesan error tampil),
 * jadi tidak ada gunanya mengukur ulang 10 kali per detik saat form diam.
 *
 * Mengembalikan fungsi untuk berhenti mengamati.
 */
export function observeHeight(formKey: string): () => void {
  if (!isEmbedded()) return () => {};

  // Yang diukur elemen akar aplikasi, **bukan** `documentElement.scrollHeight`.
  // Tinggi dokumen tidak pernah lebih kecil dari viewport, sementara viewport di
  // sini adalah tinggi iframe yang barusan kita minta sendiri ke halaman induk.
  // Akibatnya iframe hanya bisa membesar dan tidak pernah mengecil lagi — terlihat
  // jelas saat form panjang berganti jadi panel sukses yang pendek.
  const root = document.getElementById('formz-root') ?? document.body;

  let lastHeight = 0;
  let announced = false;

  const measure = (): void => {
    // getBoundingClientRect, bukan offsetHeight: nilainya pecahan, jadi tidak
    // ada satu-dua piksel terakhir yang hilang karena pembulatan ke bawah.
    const height = Math.ceil(root.getBoundingClientRect().height);

    // Toleransi 1px meredam getaran akibat pembulatan sub-pixel, yang kalau
    // tidak diredam membuat iframe bergoyang terus-menerus.
    if (Math.abs(height - lastHeight) <= 1) return;

    lastHeight = height;

    // Pesan pertama bertipe `ready` supaya induk tahu form sudah benar-benar
    // terender, bukan sekadar iframe yang selesai memuat dokumen kosong.
    if (!announced) {
      announced = true;
      postToParent({ source: MESSAGE_SOURCE, type: 'ready', formKey, height });
      return;
    }

    postToParent({ source: MESSAGE_SOURCE, type: 'resize', formKey, height });
  };

  const observer = new ResizeObserver(measure);

  observer.observe(root);

  // Ukuran pertama diambil setelah frame berikutnya, saat layout sudah selesai.
  const frame = requestAnimationFrame(measure);

  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
  };
}
