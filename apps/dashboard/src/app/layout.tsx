import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Formz — Admin Dashboard',
  description: 'Form builder, submission, reporting, dan manajemen akses',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body className="min-h-svh antialiased">{children}</body>
    </html>
  );
}
