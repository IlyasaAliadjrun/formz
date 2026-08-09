import { z } from 'zod';

/**
 * formKey dibuat dari 16 byte acak yang di-encode base64url (lihat
 * `generateFormKey` di forms.service), jadi bentuknya bisa dipastikan.
 * Memeriksanya lebih dulu membuat karakter aneh berhenti di pipe validasi
 * alih-alih ikut jadi query ke database.
 */
export const formKeySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{16,64}$/, 'Form key tidak valid');
