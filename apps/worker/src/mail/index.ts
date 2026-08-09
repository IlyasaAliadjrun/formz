import { env } from '../env';
import { ConsoleMailProvider } from './console-provider';
import { SmtpMailProvider } from './smtp-provider';
import type { MailProvider } from './provider';

export * from './provider';

let provider: MailProvider | null = null;

/**
 * Memilih adaptor sesuai `MAIL_PROVIDER`, dibuat sekali lalu dipakai ulang —
 * adaptor SMTP menyimpan pool koneksi di dalamnya.
 */
export function mailProvider(): MailProvider {
  provider ??= env.MAIL_PROVIDER === 'smtp' ? new SmtpMailProvider() : new ConsoleMailProvider();

  return provider;
}
