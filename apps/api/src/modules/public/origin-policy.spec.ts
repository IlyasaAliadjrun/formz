import {
  allowsAnyDomain,
  isOriginAllowed,
  isParentAllowed,
  type OriginPolicy,
} from './origin-policy';

const RENDERER = 'http://localhost:5173';

function policy(allowedDomains: string[]): OriginPolicy {
  return { allowedDomains, rendererOrigin: RENDERER };
}

describe('allowsAnyDomain', () => {
  it('whitelist kosong berarti terbuka untuk semua domain', () => {
    expect(allowsAnyDomain(policy([]))).toBe(true);
    expect(allowsAnyDomain(policy(['contoh.com']))).toBe(false);
  });
});

describe('isOriginAllowed', () => {
  it('mengizinkan origin apa pun kalau whitelist kosong', () => {
    expect(isOriginAllowed('https://siapa-saja.com', policy([]))).toBe(true);
  });

  it('mengizinkan origin renderer sendiri walau tidak ada di whitelist', () => {
    // Halaman di dalam iframe selalu ber-origin renderer; tanpa pengecualian ini
    // form tidak akan pernah bisa memuat schema-nya sendiri.
    expect(isOriginAllowed(RENDERER, policy(['klien.com']))).toBe(true);
  });

  it('mencocokkan hostname persis', () => {
    expect(isOriginAllowed('https://klien.com', policy(['klien.com']))).toBe(true);
    expect(isOriginAllowed('https://klien.com.penipu.net', policy(['klien.com']))).toBe(false);
    expect(isOriginAllowed('https://lain.com', policy(['klien.com']))).toBe(false);
  });

  it('wildcard cocok untuk subdomain, bukan apex', () => {
    const p = policy(['*.klien.com']);

    expect(isOriginAllowed('https://app.klien.com', p)).toBe(true);
    expect(isOriginAllowed('https://a.b.klien.com', p)).toBe(true);
    expect(isOriginAllowed('https://klien.com', p)).toBe(false);
    expect(isOriginAllowed('https://xklien.com', p)).toBe(false);
  });

  it('pola tanpa port cocok untuk port apa pun, pola berport harus sama persis', () => {
    expect(isOriginAllowed('http://klien.com:8080', policy(['klien.com']))).toBe(true);
    expect(isOriginAllowed('http://klien.com:8080', policy(['klien.com:8080']))).toBe(true);
    expect(isOriginAllowed('http://klien.com:9999', policy(['klien.com:8080']))).toBe(false);
  });

  it('membiarkan request tanpa header Origin — bukan permintaan dari browser', () => {
    expect(isOriginAllowed(undefined, policy(['klien.com']))).toBe(true);
  });
});

describe('isParentAllowed', () => {
  it('menolak halaman induk di luar whitelist', () => {
    expect(isParentAllowed('https://pencuri.com/artikel', policy(['klien.com']))).toBe(false);
    expect(isParentAllowed('https://klien.com/kontak', policy(['klien.com']))).toBe(true);
  });

  it('mengizinkan form dibuka langsung tanpa halaman induk', () => {
    expect(isParentAllowed(undefined, policy(['klien.com']))).toBe(true);
    expect(isParentAllowed('', policy(['klien.com']))).toBe(true);
  });

  it('menolak nilai induk yang tidak bisa di-parse saat whitelist aktif', () => {
    expect(isParentAllowed('bukan url', policy(['klien.com']))).toBe(false);
  });

  it('tidak memeriksa apa pun kalau whitelist kosong', () => {
    expect(isParentAllowed('https://siapa-saja.com', policy([]))).toBe(true);
  });
});
