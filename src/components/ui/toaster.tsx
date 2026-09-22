import { useEffect, useState } from 'react';
import { cn } from '@shared/utils';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant?: 'default' | 'success' | 'error' | 'info';
}

let listeners: Array<(t: ToastItem[]) => void> = [];
let toasts: ToastItem[] = [];
let counter = 0;

function emit() {
  listeners.forEach((l) => l([...toasts]));
}

export function toast(opts: Omit<ToastItem, 'id'>) {
  const id = `toast-${Date.now()}-${counter++}`;
  toasts = [...toasts.slice(-3), { ...opts, id }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 4000);
}

export function useToast() {
  return { toast };
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const fn = (t: ToastItem[]) => setItems(t);
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((l) => l !== fn);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[360px] max-w-[calc(100vw-2rem)]">
      {items.map((t) => (
        <div
          key={t.id}
          className={cn(
            'flex items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-lg animate-slide-in',
            t.variant === 'success' && 'border-green-500/40',
            t.variant === 'error' && 'border-red-500/40'
          )}
        >
          {t.variant === 'success' ? (
            <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
          ) : t.variant === 'error' ? (
            <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          ) : t.variant === 'info' ? (
            <Info className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
          ) : (
            <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{t.title}</p>
            {t.description && (
              <p className="text-sm text-muted-foreground mt-0.5 break-words">{t.description}</p>
            )}
          </div>
          <button
            onClick={() => {
              toasts = toasts.filter((x) => x.id !== t.id);
              emit();
            }}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
