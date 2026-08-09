/**
 * Antarmuka pengiriman email.
 *
 * Sengaja sesempit ini supaya mengganti provider tidak menyentuh apa pun di luar
 * folder `mail/`. Menambah provider berbasis HTTP API (Postmark, SES, Resend)
 * berarti menulis satu berkas yang mengimplementasikan `MailProvider`, lalu
 * mendaftarkannya di `createMailProvider` — processor notifikasi tidak berubah
 * sama sekali karena ia hanya mengenal antarmuka ini.
 */

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Alamat balasan, biasanya diisi email pengisi form. */
  replyTo?: string;
}

export interface MailSendResult {
  messageId: string | null;
  accepted: string[];
  rejected: string[];
}

export interface MailProvider {
  /** Nama yang muncul di log dan di hasil uji coba. */
  readonly name: string;
  send(message: MailMessage): Promise<MailSendResult>;
  /** Memastikan koneksi/kredensialnya benar; dipanggil sekali saat worker start. */
  verify(): Promise<void>;
}

export class MailNotConfiguredError extends Error {
  constructor(missing: string) {
    super(`Pengiriman email belum dikonfigurasi: ${missing}`);
    this.name = 'MailNotConfiguredError';
  }
}
