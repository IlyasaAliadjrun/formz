import { redirect } from 'next/navigation';

/**
 * `/settings` sendiri tidak punya isi — halaman pertamanya daftar user.
 * Redirect di server supaya tidak ada kedipan halaman kosong lebih dulu.
 */
export default function SettingsIndexPage() {
  redirect('/settings/users');
}
