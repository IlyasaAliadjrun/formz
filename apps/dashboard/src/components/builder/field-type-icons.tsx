import type { FieldType } from '@formz/shared';
import {
  AlignLeft,
  AtSign,
  Calendar,
  CalendarClock,
  CheckSquare,
  ChevronDownSquare,
  CircleDot,
  Hash,
  Heading2,
  ListChecks,
  Phone,
  Type,
  Upload,
  type LucideIcon,
} from 'lucide-react';

export const FIELD_TYPE_ICONS: Record<FieldType, LucideIcon> = {
  text: Type,
  textarea: AlignLeft,
  number: Hash,
  email: AtSign,
  phone: Phone,
  date: Calendar,
  datetime: CalendarClock,
  select: ChevronDownSquare,
  multiselect: ListChecks,
  radio: CircleDot,
  checkbox: CheckSquare,
  file_upload: Upload,
  section_heading: Heading2,
};
