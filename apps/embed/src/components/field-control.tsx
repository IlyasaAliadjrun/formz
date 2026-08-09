import { optionValue, type AnswerValue, type FormField, type OptionFormField } from '@formz/shared';
import { toggleValue } from '../lib/answers';

interface FieldControlProps {
  field: FormField;
  value: AnswerValue | undefined;
  /** Id opsi yang lolos kondisi. Opsi di luar daftar ini tidak dirender sama sekali. */
  visibleOptionIds: string[];
  errors: string[];
  onChange: (value: AnswerValue | undefined) => void;
  onBlur: () => void;
}

/**
 * Merender satu field sesuai tipenya.
 *
 * Komponennya sengaja berbeda dari preview di dashboard — yang dibagi bukan
 * tampilan, melainkan *logikanya*: definisi field type, evaluasi kondisi, dan
 * aturan validasi semuanya berasal dari `@formz/shared`. Yang di sini murni
 * markup dan gaya, ditulis tanpa framework CSS supaya bundle-nya tetap kecil.
 */
export function FieldControl({
  field,
  value,
  visibleOptionIds,
  errors,
  onChange,
  onBlur,
}: FieldControlProps) {
  if (field.type === 'section_heading') {
    return (
      <div class="fz-section">
        {field.level === 3 ? <h3>{field.label}</h3> : <h2>{field.label}</h2>}
        {field.description && <p class="fz-section-desc">{field.description}</p>}
      </div>
    );
  }

  const inputId = `fz-${field.id}`;
  const describedBy = [
    field.helpText ? `${inputId}-help` : null,
    errors.length > 0 ? `${inputId}-error` : null,
  ]
    .filter(Boolean)
    .join(' ');

  const invalid = errors.length > 0;
  const required = field.validation.required;

  // Radio, multiselect, dan checkbox punya banyak kontrol dalam satu field, jadi
  // label-nya harus <legend> di dalam <fieldset> — bukan <label for>, yang hanya
  // bisa menunjuk satu kontrol.
  const isGroup = field.type === 'radio' || field.type === 'multiselect';

  return (
    <div
      class={`fz-field${invalid ? ' fz-field-invalid' : ''}`}
      data-field-type={field.type}
      data-field-id={field.id}
    >
      {isGroup ? (
        <fieldset class="fz-fieldset">
          <legend class="fz-label">
            {field.label}
            {required && <span class="fz-required"> *</span>}
          </legend>
          {field.description && <p class="fz-desc">{field.description}</p>}
          {renderControl()}
          {renderHints()}
        </fieldset>
      ) : (
        <>
          {field.type !== 'checkbox' && (
            <label class="fz-label" for={inputId}>
              {field.label}
              {required && <span class="fz-required"> *</span>}
            </label>
          )}
          {field.description && field.type !== 'checkbox' && (
            <p class="fz-desc">{field.description}</p>
          )}
          {renderControl()}
          {renderHints()}
        </>
      )}
    </div>
  );

  function renderHints() {
    return (
      <>
        {field.helpText && (
          <p class="fz-help" id={`${inputId}-help`}>
            {field.helpText}
          </p>
        )}
        {invalid && (
          <p class="fz-error" id={`${inputId}-error`} role="alert">
            {errors[0]}
          </p>
        )}
      </>
    );
  }

  function renderControl() {
    const shared = {
      id: inputId,
      name: field.name,
      required,
      'aria-invalid': invalid,
      'aria-describedby': describedBy || undefined,
      onBlur,
    };

    switch (field.type) {
      case 'textarea':
        return (
          <textarea
            {...shared}
            class="fz-input fz-textarea"
            rows={field.rows ?? 4}
            placeholder={field.placeholder}
            value={asString(value)}
            onInput={(event) => onChange(event.currentTarget.value || undefined)}
          />
        );

      case 'number':
        return (
          <input
            {...shared}
            class="fz-input"
            type="number"
            inputMode={field.validation.integerOnly ? 'numeric' : 'decimal'}
            step={field.validation.integerOnly ? 1 : 'any'}
            min={field.validation.min}
            max={field.validation.max}
            placeholder={field.placeholder}
            value={value === undefined || value === null ? '' : String(value)}
            onInput={(event) => {
              const raw = event.currentTarget.value;
              // String kosong berarti belum diisi, bukan angka 0.
              onChange(raw === '' ? undefined : Number(raw));
            }}
          />
        );

      case 'email':
      case 'phone':
      case 'text':
        return (
          <input
            {...shared}
            class="fz-input"
            type={inputTypeOf(field.type)}
            inputMode={field.type === 'phone' ? 'tel' : undefined}
            autocomplete={autocompleteOf(field.type)}
            placeholder={field.placeholder}
            value={asString(value)}
            onInput={(event) => onChange(event.currentTarget.value || undefined)}
          />
        );

      case 'date':
      case 'datetime':
        return (
          <input
            {...shared}
            class="fz-input"
            type={field.type === 'datetime' ? 'datetime-local' : 'date'}
            min={field.validation.minDate}
            max={field.validation.maxDate}
            value={asString(value)}
            onInput={(event) => onChange(event.currentTarget.value || undefined)}
          />
        );

      case 'select':
        return (
          <select
            {...shared}
            class="fz-input fz-select"
            value={asString(value)}
            onChange={(event) => onChange(event.currentTarget.value || undefined)}
          >
            <option value="">{field.placeholder ?? '— Pilih —'}</option>
            {visibleOptions(field, visibleOptionIds).map((option) => (
              <option key={option.id} value={optionValue(option)}>
                {option.label}
              </option>
            ))}
          </select>
        );

      case 'radio':
        return (
          <div class="fz-options" role="radiogroup" aria-describedby={describedBy || undefined}>
            {visibleOptions(field, visibleOptionIds).map((option) => (
              <label key={option.id} class="fz-option">
                <input
                  type="radio"
                  name={field.name}
                  value={optionValue(option)}
                  checked={value === optionValue(option)}
                  onChange={() => onChange(optionValue(option))}
                  onBlur={onBlur}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        );

      case 'multiselect': {
        const selected = Array.isArray(value) ? value : [];

        return (
          <div class="fz-options">
            {visibleOptions(field, visibleOptionIds).map((option) => {
              const itemValue = optionValue(option);

              return (
                <label key={option.id} class="fz-option">
                  <input
                    type="checkbox"
                    name={field.name}
                    value={itemValue}
                    checked={selected.includes(itemValue)}
                    onChange={() => {
                      const next = toggleValue(value, itemValue);
                      onChange(next.length > 0 ? next : undefined);
                    }}
                    onBlur={onBlur}
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>
        );
      }

      case 'checkbox':
        return (
          <label class="fz-option fz-option-single" for={inputId}>
            <input
              {...shared}
              type="checkbox"
              checked={value === true}
              onChange={(event) => onChange(event.currentTarget.checked)}
            />
            <span>
              {field.label}
              {required && <span class="fz-required"> *</span>}
              {field.description && <span class="fz-desc-inline">{field.description}</span>}
            </span>
          </label>
        );

      case 'file_upload':
        // Unggah berkas butuh presigned URL ke MinIO, yang baru dikerjakan di
        // part berikutnya. Field-nya tetap dirender supaya susunan form terlihat
        // apa adanya, tapi dinonaktifkan agar tidak terlihat seperti sudah bisa.
        return (
          <div class="fz-file-placeholder">
            <input type="file" disabled multiple={field.validation.maxFiles > 1} />
            <span>Unggah berkas belum tersedia.</span>
          </div>
        );
    }
  }
}

// ---------------------------------------------------------------------------

function visibleOptions(field: OptionFormField, visibleOptionIds: string[]) {
  return field.options.filter((option) => visibleOptionIds.includes(option.id));
}

function asString(value: AnswerValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function inputTypeOf(type: 'text' | 'email' | 'phone'): string {
  if (type === 'email') return 'email';
  if (type === 'phone') return 'tel';

  return 'text';
}

/** Bantu browser mengisi otomatis field yang jelas maksudnya. */
function autocompleteOf(type: 'text' | 'email' | 'phone'): string | undefined {
  if (type === 'email') return 'email';
  if (type === 'phone') return 'tel';

  return undefined;
}
