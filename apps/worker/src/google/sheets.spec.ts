import { describeGoogleError, isRetryableGoogleError, quoteSheetName } from './sheets';

/**
 * Klasifikasi error inilah yang menentukan job diulang atau tidak.
 *
 * Salah di satu arah berarti kuota Google yang terlampaui sesaat membuat baris
 * hilang selamanya; salah di arah lain berarti spreadsheet yang lupa dibagikan
 * dicoba lima kali dengan backoff sebelum akhirnya menyerah, dan pesan yang
 * sebenarnya berguna baru sampai ke admin belasan menit kemudian.
 */

describe('isRetryableGoogleError', () => {
  it('mengulang kuota terlampaui dan gangguan di sisi Google', () => {
    expect(isRetryableGoogleError({ status: 429 })).toBe(true);
    expect(isRetryableGoogleError({ status: 500 })).toBe(true);
    expect(isRetryableGoogleError({ status: 503 })).toBe(true);
  });

  it('tidak mengulang kesalahan konfigurasi', () => {
    // Spreadsheet belum di-share (403), id-nya salah (404), nama tab tidak ada (400).
    expect(isRetryableGoogleError({ status: 400 })).toBe(false);
    expect(isRetryableGoogleError({ status: 403 })).toBe(false);
    expect(isRetryableGoogleError({ status: 404 })).toBe(false);
  });

  it('mengulang gangguan jaringan yang tidak punya status HTTP', () => {
    expect(isRetryableGoogleError({ code: 'ECONNRESET' })).toBe(true);
    expect(isRetryableGoogleError({ code: 'ETIMEDOUT' })).toBe(true);
  });

  it('tidak mengulang error yang tidak dikenali sama sekali', () => {
    expect(isRetryableGoogleError(new Error('entah kenapa'))).toBe(false);
  });
});

describe('describeGoogleError', () => {
  it('menggali pesan dari badan respons Google', () => {
    const error = {
      response: {
        data: { error: { status: 'NOT_FOUND', message: 'Requested entity was not found.' } },
      },
    };

    expect(describeGoogleError(error)).toBe('NOT_FOUND: Requested entity was not found.');
  });

  it('menambahkan petunjuk share pada kegagalan izin', () => {
    const error = {
      response: {
        data: {
          error: { status: 'PERMISSION_DENIED', message: 'The caller does not have permission' },
        },
      },
    };

    expect(describeGoogleError(error)).toContain('share');
  });

  it('menerjemahkan penolakan OpenSSL menjadi variabel yang perlu diperbaiki', () => {
    const error = new Error('error:1E08010C:DECODER routines::unsupported');

    expect(describeGoogleError(error)).toContain('GOOGLE_PRIVATE_KEY');
  });

  it('meneruskan pesan lain apa adanya', () => {
    expect(describeGoogleError(new Error('koneksi putus'))).toBe('koneksi putus');
  });
});

describe('quoteSheetName', () => {
  it('mengutip nama sheet supaya notasi A1 tetap sah', () => {
    expect(quoteSheetName('Data Pendaftar')).toBe("'Data Pendaftar'");
  });

  it('menggandakan kutip tunggal di dalam nama', () => {
    expect(quoteSheetName("Form'23")).toBe("'Form''23'");
  });
});
