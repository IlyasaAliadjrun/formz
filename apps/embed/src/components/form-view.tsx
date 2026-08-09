import { useCallback, useMemo, useState } from 'preact/hooks';
import {
  evaluateConditions,
  validateAnswer,
  validateAnswers,
  type AnswerMap,
  type AnswerValue,
  type PublicForm,
  type SubmissionResult,
} from '@formz/shared';
import { ApiError, submitForm } from '../lib/api';
import { initialAnswers, withAnswer } from '../lib/answers';
import { MESSAGE_SOURCE, isEmbedded, postToParent } from '../lib/parent-frame';
import { FieldControl } from './field-control';
import { SuccessPanel } from './success-panel';

type Status = 'filling' | 'submitting' | 'done';

export function FormView({ form }: { form: PublicForm }) {
  const { schema } = form;

  const [answers, setAnswers] = useState<AnswerMap>(() => initialAnswers(schema));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<Status>('filling');
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /**
   * Evaluasi kondisi dijalankan ulang tiap kali jawaban berubah — memakai fungsi
   * yang sama persis dengan yang dipakai server saat submit. Bukan tiruannya:
   * kalau keduanya berbeda, akan ada field yang terlihat di layar tapi ditolak
   * server, atau sebaliknya.
   */
  const evaluation = useMemo(() => evaluateConditions(schema, answers), [schema, answers]);

  const setAnswer = useCallback((fieldId: string, value: AnswerValue | undefined) => {
    setAnswers((current) => withAnswer(current, fieldId, value));

    // Pesan error dibersihkan begitu isinya diubah; memvalidasi ulang di tiap
    // ketikan membuat pesan "wajib diisi" berkedip saat orang baru mengetik
    // huruf pertama.
    setErrors((current) => {
      if (!current[fieldId]) return current;

      const next = { ...current };
      delete next[fieldId];

      return next;
    });
  }, []);

  const validateField = useCallback(
    (fieldId: string) => {
      const field = schema.fields.find((item) => item.id === fieldId);

      if (!field || !evaluation.fields[fieldId]?.visible) return;

      const issues = validateAnswer(field, answers[fieldId]);

      setTouched((current) => ({ ...current, [fieldId]: true }));
      setErrors((current) => {
        const next = { ...current };

        if (issues.length > 0) next[fieldId] = issues.map((issue) => issue.message);
        else delete next[fieldId];

        return next;
      });
    },
    [answers, evaluation, schema],
  );

  const handleSubmit = async (event: Event): Promise<void> => {
    event.preventDefault();

    if (status === 'submitting') return;

    setSubmitError(null);

    const validation = validateAnswers(schema, answers);

    if (!validation.valid) {
      const grouped: Record<string, string[]> = {};

      for (const issue of validation.errors) {
        (grouped[issue.fieldId] ??= []).push(issue.message);
      }

      setErrors(grouped);
      setTouched(Object.fromEntries(Object.keys(grouped).map((id) => [id, true])));
      focusFirstError(Object.keys(grouped)[0]);

      return;
    }

    setStatus('submitting');

    try {
      // Jawaban yang dikirim adalah hasil pembersihan `validateAnswers`, bukan
      // state mentah — field yang sempat diisi lalu tersembunyi tidak ikut.
      const submission = await submitForm(form.formKey, {
        answers: validation.answers as Record<string, AnswerValue>,
        // Kalau jaringan putus setelah server menerima, kiriman ulang dengan id
        // yang sama tidak akan menghasilkan submission kedua.
        clientSubmissionId: crypto.randomUUID(),
      });

      setResult(submission);
      setStatus('done');

      postToParent({
        source: MESSAGE_SOURCE,
        type: 'submitted',
        formKey: form.formKey,
        submissionId: submission.submissionId,
      });

      if (submission.redirectUrl) {
        // Renderer tidak bisa mengarahkan halaman induk secara langsung
        // (beda origin); induk yang melakukannya lewat embed.js. Kalau form
        // dipasang sebagai iframe polos, tombol di panel sukses jadi jalan keluarnya.
        postToParent({
          source: MESSAGE_SOURCE,
          type: 'redirect',
          formKey: form.formKey,
          url: submission.redirectUrl,
        });

        if (!isEmbedded()) window.location.href = submission.redirectUrl;
      }
    } catch (error) {
      setStatus('filling');

      if (error instanceof ApiError) {
        if (Object.keys(error.fieldErrors).length > 0) {
          setErrors(error.fieldErrors);
          focusFirstError(Object.keys(error.fieldErrors)[0]);
        }

        setSubmitError(
          error.retryAfterSeconds
            ? `${error.message} (coba lagi dalam ${error.retryAfterSeconds} detik)`
            : error.message,
        );

        return;
      }

      setSubmitError('Terjadi kesalahan tak terduga. Coba lagi.');
    }
  };

  if (status === 'done' && result) {
    return <SuccessPanel result={result} />;
  }

  const visibleFields = schema.fields.filter((field) => evaluation.fields[field.id]?.visible);

  return (
    <form class="fz-form" onSubmit={handleSubmit} noValidate>
      <header class="fz-header">
        <h1 class="fz-title">{schema.title}</h1>
        {schema.description && <p class="fz-intro">{schema.description}</p>}
      </header>

      {submitError && (
        <div class="fz-alert" role="alert">
          {submitError}
        </div>
      )}

      <div class="fz-fields">
        {visibleFields.map((field) => (
          <FieldControl
            key={field.id}
            field={field}
            value={answers[field.id]}
            visibleOptionIds={evaluation.fields[field.id]?.visibleOptionIds ?? []}
            errors={touched[field.id] ? (errors[field.id] ?? []) : []}
            onChange={(value) => setAnswer(field.id, value)}
            onBlur={() => validateField(field.id)}
          />
        ))}
      </div>

      <button class="fz-submit" type="submit" disabled={status === 'submitting'}>
        {status === 'submitting' ? 'Mengirim…' : schema.settings.submitButtonLabel}
      </button>
    </form>
  );
}

/**
 * Memindahkan fokus ke field bermasalah pertama. Tanpa ini, pada form panjang
 * pesan error bisa berada jauh di luar layar dan submit terasa "tidak bereaksi".
 *
 * Radio dan multiselect tidak punya satu elemen ber-id, jadi pencarian dimulai
 * dari pembungkus field lalu turun ke kontrol pertama di dalamnya.
 */
function focusFirstError(fieldId: string | undefined): void {
  if (!fieldId) return;

  requestAnimationFrame(() => {
    const wrapper = document.querySelector<HTMLElement>(`[data-field-id="${CSS.escape(fieldId)}"]`);
    const target = wrapper?.querySelector<HTMLElement>('input, select, textarea');

    wrapper?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target?.focus({ preventScroll: true });
  });
}
