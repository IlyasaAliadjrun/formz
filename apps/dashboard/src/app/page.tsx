import { FileText, Inbox, ShieldCheck, Workflow } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const placeholderSections = [
  {
    icon: FileText,
    title: 'Form Builder',
    description: 'Susun field drag & drop, atur conditional show/hide sampai level opsi.',
  },
  {
    icon: Inbox,
    title: 'Submission',
    description: 'Lihat jawaban per field beserta status sync spreadsheet & forward email.',
  },
  {
    icon: Workflow,
    title: 'Integrasi & Notifikasi',
    description: 'Konfigurasi Google Sheets dan workflow email otomatis saat form disubmit.',
  },
  {
    icon: ShieldCheck,
    title: 'RBAC & Reporting',
    description: 'Atur role dan permission per resource, lalu pantau ringkasannya di laporan.',
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <Badge variant="secondary" className="w-fit">
          Part 0 — Scaffolding
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Formz Admin Dashboard</h1>
        <p className="text-muted-foreground max-w-2xl text-base">
          Halaman ini masih placeholder. Struktur monorepo, Tailwind CSS, dan shadcn/ui sudah
          terpasang — modul builder, submission, reporting, dan RBAC menyusul di part berikutnya.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Button>Mulai bikin form</Button>
          <Button variant="outline">Lihat dokumentasi</Button>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        {placeholderSections.map(({ icon: Icon, title, description }) => (
          <Card key={title}>
            <CardHeader>
              <Icon className="text-muted-foreground size-5" aria-hidden />
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Badge variant="outline">Belum tersedia</Badge>
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
