import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import type { AnswerEntry } from '@formz/shared';

/**
 * Template email notifikasi submission.
 *
 * Ditulis dengan React Email karena klien email (terutama Outlook) masih
 * menuntut markup berbasis tabel dan CSS inline; komponen-komponen di sini yang
 * menanganinya, sehingga template-nya tetap terbaca sebagai komponen biasa.
 *
 * Isinya dirender dari `AnswerEntry[]` hasil `describeAnswers()` — fungsi yang
 * sama dengan yang dipakai halaman detail submission dan berkas ekspor. Jadi
 * label field dan label opsi di email selalu mengikuti versi form yang benar,
 * dan tidak ada penerjemahan jawaban versi ketiga yang bisa menyimpang.
 */

export interface SubmissionNotificationProps {
  formTitle: string;
  submittedAt: string;
  versionNumber: number;
  entries: AnswerEntry[];
  /** Tautan ke halaman detail di dashboard; null untuk email uji coba. */
  detailUrl: string | null;
  /** Menampilkan tabel jawaban. `false` untuk template pemberitahuan singkat. */
  showAnswers: boolean;
  /** Menandai email uji coba supaya tidak dikira submission sungguhan. */
  isSample: boolean;
}

const colors = {
  text: '#111827',
  muted: '#6b7280',
  border: '#e5e7eb',
  background: '#f9fafb',
  surface: '#ffffff',
  accent: '#1d4ed8',
  warning: '#92400e',
  warningBg: '#fef3c7',
};

export function SubmissionNotification({
  formTitle,
  submittedAt,
  versionNumber,
  entries,
  detailUrl,
  showAnswers,
  isSample,
}: SubmissionNotificationProps) {
  const preview = isSample
    ? `Email uji coba untuk ${formTitle}`
    : `Submission baru di ${formTitle} — ${submittedAt}`;

  return (
    <Html lang="id">
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: colors.background,
          color: colors.text,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          margin: 0,
          padding: '24px 0',
        }}
      >
        <Container
          style={{
            backgroundColor: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: '8px',
            margin: '0 auto',
            maxWidth: '640px',
            padding: '32px',
          }}
        >
          {isSample && (
            <Section
              style={{
                backgroundColor: colors.warningBg,
                borderRadius: '6px',
                marginBottom: '24px',
                padding: '12px 16px',
              }}
            >
              <Text style={{ color: colors.warning, fontSize: '13px', margin: 0 }}>
                Ini email uji coba dengan jawaban contoh. Tidak ada submission sungguhan yang masuk.
              </Text>
            </Section>
          )}

          <Heading as="h1" style={{ fontSize: '20px', margin: '0 0 4px' }}>
            {formTitle}
          </Heading>
          <Text style={{ color: colors.muted, fontSize: '13px', margin: '0 0 24px' }}>
            Submission masuk {submittedAt} · versi form v{versionNumber}
          </Text>

          {showAnswers && (
            <Section>
              {entries.length === 0 && (
                <Text style={{ color: colors.muted, fontSize: '14px' }}>
                  Form ini belum punya field jawaban.
                </Text>
              )}

              {entries.map((entry) => (
                <AnswerRow key={entry.fieldId} entry={entry} />
              ))}
            </Section>
          )}

          {detailUrl && (
            <>
              <Hr style={{ borderColor: colors.border, margin: '24px 0' }} />
              <Button
                href={detailUrl}
                style={{
                  backgroundColor: colors.accent,
                  borderRadius: '6px',
                  color: '#ffffff',
                  display: 'inline-block',
                  fontSize: '14px',
                  fontWeight: 600,
                  padding: '10px 18px',
                  textDecoration: 'none',
                }}
              >
                Buka di dashboard
              </Button>
            </>
          )}

          <Hr style={{ borderColor: colors.border, margin: '24px 0 16px' }} />
          <Text style={{ color: colors.muted, fontSize: '12px', margin: 0 }}>
            Email ini dikirim otomatis oleh Formz karena ada aturan notifikasi pada form ini.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

function AnswerRow({ entry }: { entry: AnswerEntry }) {
  return (
    <Section style={{ borderBottom: `1px solid ${colors.border}`, padding: '10px 0' }}>
      <Text
        style={{
          color: colors.muted,
          fontSize: '12px',
          margin: '0 0 2px',
          textTransform: 'uppercase',
        }}
      >
        {entry.label}
      </Text>
      <Text
        style={{
          color: entry.answered ? colors.text : colors.muted,
          fontSize: '14px',
          margin: 0,
          // Jawaban textarea bisa banyak baris; tanpa ini semuanya menempel jadi
          // satu paragraf panjang di klien email.
          whiteSpace: 'pre-wrap',
        }}
      >
        {entry.answered ? entry.display : entry.display || '(tidak diisi)'}
      </Text>
    </Section>
  );
}

export default SubmissionNotification;
