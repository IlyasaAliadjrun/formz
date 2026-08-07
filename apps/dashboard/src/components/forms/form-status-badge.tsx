import type { FormStatus } from '@formz/shared';
import { Badge } from '@/components/ui/badge';

const LABELS: Record<FormStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Diarsipkan',
};

const VARIANTS: Record<FormStatus, 'default' | 'secondary' | 'outline'> = {
  draft: 'secondary',
  published: 'default',
  archived: 'outline',
};

export function FormStatusBadge({ status }: { status: FormStatus }) {
  return <Badge variant={VARIANTS[status]}>{LABELS[status]}</Badge>;
}
