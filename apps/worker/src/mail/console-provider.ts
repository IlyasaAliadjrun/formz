import { createLogger } from '../logger';
import type { MailMessage, MailProvider, MailSendResult } from './provider';

const logger = createLogger('mail:console');

/**
 * Provider bawaan: email hanya dicetak ke log worker, tidak dikirim ke mana pun.
 *
 * Ini yang aktif kalau `MAIL_PROVIDER` belum diisi — dan itu disengaja. Server
 * yang belum dikonfigurasi tidak boleh bisa mengirim email ke alamat sungguhan
 * hanya karena ada yang lupa mengisi satu variabel; lebih baik emailnya tidak
 * terkirim dan terlihat jelas di log daripada terkirim ke tempat yang salah.
 * Sekaligus membuat seluruh alur notifikasi bisa dicoba di mesin sendiri tanpa
 * akun provider apa pun.
 */
export class ConsoleMailProvider implements MailProvider {
  readonly name = 'console';

  async send(message: MailMessage): Promise<MailSendResult> {
    logger.info(`(tidak dikirim) to=${message.to} subject="${message.subject}"\n${message.text}`);

    return {
      messageId: `console-${Date.now()}`,
      accepted: [message.to],
      rejected: [],
    };
  }

  async verify(): Promise<void> {
    logger.warn(
      'MAIL_PROVIDER=console — email hanya dicetak ke log, tidak benar-benar dikirim. ' +
        'Isi MAIL_PROVIDER=smtp beserta SMTP_HOST & MAIL_FROM untuk mengirim sungguhan.',
    );
  }
}
