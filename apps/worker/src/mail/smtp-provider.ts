import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../env';
import {
  MailNotConfiguredError,
  type MailMessage,
  type MailProvider,
  type MailSendResult,
} from './provider';

/**
 * Pengiriman lewat SMTP relay pihak ketiga (Postmark, Amazon SES, SendGrid, atau
 * relay lain).
 *
 * SMTP dipilih sebagai adaptor pertama karena satu implementasi ini melayani
 * hampir semua provider transactional email sekaligus — yang berbeda hanya host,
 * port, dan kredensialnya, dan ketiganya datang dari environment variable.
 * ARCHITECTURE.md bagian 3.5 juga menegaskan: **jangan** menjalankan mail server
 * sendiri di server self-hosted, karena reputasi IP baru membuat emailnya
 * hampir pasti masuk folder spam.
 */
export class SmtpMailProvider implements MailProvider {
  readonly name: string;

  private readonly transporter: Transporter;
  private readonly from: string;

  constructor() {
    if (!env.SMTP_HOST) throw new MailNotConfiguredError('SMTP_HOST belum diisi');
    if (!env.MAIL_FROM) throw new MailNotConfiguredError('MAIL_FROM belum diisi');

    this.name = `smtp:${env.SMTP_HOST}`;
    this.from = env.MAIL_FROM;
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // Port 465 memakai TLS sejak awal; 587 memulai polos lalu naik ke TLS
      // lewat STARTTLS, yang ditangani nodemailer sendiri.
      secure: env.SMTP_SECURE,
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } } : {}),
      // Satu koneksi dipakai ulang untuk beberapa email berturut-turut; tanpa
      // ini setiap penerima menuntut jabat tangan TLS sendiri.
      pool: true,
      maxConnections: 3,
    });
  }

  async send(message: MailMessage): Promise<MailSendResult> {
    const info = await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    });

    return {
      messageId: info.messageId ?? null,
      accepted: info.accepted.map(String),
      rejected: info.rejected.map(String),
    };
  }

  async verify(): Promise<void> {
    await this.transporter.verify();
  }
}
