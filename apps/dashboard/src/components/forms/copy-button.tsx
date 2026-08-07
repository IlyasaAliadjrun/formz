'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function CopyButton({
  value,
  label = 'Salin',
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API butuh konteks aman (https / localhost).
      toast.error('Browser menolak akses clipboard', {
        description: 'Salin manual dengan Ctrl+C setelah menyorot teksnya.',
      });
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={() => void handleCopy()} className={className}>
      {copied ? <Check className="text-emerald-600" /> : <Copy />}
      {copied ? 'Tersalin' : label}
    </Button>
  );
}
