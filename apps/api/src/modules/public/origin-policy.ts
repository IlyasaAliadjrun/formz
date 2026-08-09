/**
 * Pencocokan domain untuk whitelist embed per form.
 *
 * Ditulis sebagai fungsi murni (tanpa DI, tanpa request) supaya bisa diuji
 * langsung dan dipakai dua lapis sekaligus: delegasi CORS di `main.ts` yang
 * menentukan header `Access-Control-Allow-Origin`, dan `FormOriginGuard` yang
 * menolak request di sisi server.
 *
 * Dua lapis dipakai karena CORS hanya ditegakkan browser: `curl` mengabaikannya
 * sepenuhnya. CORS mengurus kenyamanan (browser memblokir dengan pesan jelas),
 * guard mengurus penegakannya.
 */

export interface OriginPolicy {
  /**
   * Whitelist dari kolom `forms.allowed_domains`. Sudah tersimpan sebagai
   * hostname saja (lihat `normalizeDomain` di forms.dto), boleh mengandung port
   * dan wildcard satu tingkat (`*.example.com`).
   */
  allowedDomains: string[];
  /**
   * Origin milik form renderer sendiri. Selalu diizinkan: halaman di dalam
   * iframe **selalu** ber-origin ini, apa pun website yang memasangnya, jadi
   * tanpa pengecualian ini form tidak akan pernah bisa memuat schema-nya sendiri.
   */
  rendererOrigin: string;
}

/** Whitelist kosong berarti form boleh dipasang di mana saja. */
export function allowsAnyDomain(policy: OriginPolicy): boolean {
  return policy.allowedDomains.length === 0;
}

/**
 * Apakah sebuah header `Origin` boleh mengakses form ini.
 * Origin yang tidak bisa di-parse (`null` dari iframe sandbox, `file://`)
 * dianggap tidak cocok kecuali form memang terbuka untuk semua domain.
 */
export function isOriginAllowed(origin: string | undefined, policy: OriginPolicy): boolean {
  if (allowsAnyDomain(policy)) return true;
  if (!origin) return true; // Request non-browser diurus guard, bukan di sini.
  if (sameOrigin(origin, policy.rendererOrigin)) return true;

  const host = hostFromUrl(origin);

  return host !== null && matchesAny(host, policy.allowedDomains);
}

/**
 * Apakah URL halaman induk (website yang memasang iframe) boleh memuat form ini.
 *
 * Ini pemeriksaan yang sebenarnya menjawab "form dicuri lalu dipasang di domain
 * lain": di dalam iframe, header `Origin` selalu menunjuk ke domain renderer,
 * bukan ke website pemasang, sehingga CORS saja tidak pernah bisa membedakannya.
 * Renderer karena itu mengirim `document.referrer` lewat header `X-Formz-Parent`.
 *
 * Nilainya bisa dipalsukan siapa pun yang memanggil endpoint langsung — sama
 * seperti `Origin` — dan memang bukan satu-satunya proteksi (ARCHITECTURE.md
 * bagian 3.2). Fungsinya mencegah pemasangan ulang secara diam-diam di browser,
 * bukan menghalangi penyerang yang menulis skrip sendiri.
 */
export function isParentAllowed(parentUrl: string | undefined, policy: OriginPolicy): boolean {
  if (allowsAnyDomain(policy)) return true;

  // Tanpa induk = form dibuka langsung di tab sendiri, bukan di-embed.
  if (!parentUrl) return true;

  const host = hostFromUrl(parentUrl);

  if (host === null) return false;
  if (sameHost(host, hostFromUrl(policy.rendererOrigin))) return true;

  return matchesAny(host, policy.allowedDomains);
}

// ---------------------------------------------------------------------------
// Pencocokan hostname
// ---------------------------------------------------------------------------

interface HostAndPort {
  host: string;
  port: string;
}

function matchesAny(target: HostAndPort, patterns: string[]): boolean {
  return patterns.some((pattern) => matches(target, pattern));
}

function matches(target: HostAndPort, pattern: string): boolean {
  const parsed = splitHostPort(pattern.trim().toLowerCase());

  // Pola tanpa port cocok dengan port apa pun; pola berport harus sama persis.
  if (parsed.port && parsed.port !== target.port) return false;

  if (parsed.host.startsWith('*.')) {
    // Wildcard satu tingkat: `*.example.com` cocok untuk subdomain, bukan apex.
    const base = parsed.host.slice(2);

    return target.host.endsWith(`.${base}`) && target.host !== base;
  }

  return target.host === parsed.host;
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function sameHost(a: HostAndPort, b: HostAndPort | null): boolean {
  return b !== null && a.host === b.host && a.port === b.port;
}

/** Mengambil hostname + port dari URL. Null kalau bukan URL yang sah. */
function hostFromUrl(value: string): HostAndPort | null {
  try {
    const url = new URL(value);

    return { host: url.hostname.toLowerCase(), port: url.port };
  } catch {
    return null;
  }
}

function splitHostPort(value: string): HostAndPort {
  const colon = value.lastIndexOf(':');

  if (colon > 0 && /^\d+$/.test(value.slice(colon + 1))) {
    return { host: value.slice(0, colon), port: value.slice(colon + 1) };
  }

  return { host: value, port: '' };
}
