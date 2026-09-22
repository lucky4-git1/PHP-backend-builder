import { cn } from '@/shared/utils';
import { STEPS } from '@/store/pipelineStore';
import { Check, ChevronRight } from 'lucide-react';

export function Stepper({ step, done, onGoto }: { step: number; done: Record<number, boolean>; onGoto: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin pb-1">
      {STEPS.map((s, i) => {
        const active = s.n === step;
        const isDone = done[s.n];
        const isPast = s.n < step;
        return (
          <div key={s.id} className="flex items-center shrink-0">
            <button
              onClick={() => onGoto(s.n)}
              aria-current={active ? 'step' : undefined}
              className={cn(
                'group flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap',
                active
                  ? 'bg-primary text-primary-foreground border-primary shadow-md shadow-primary/20'
                  : isDone || isPast
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-300 hover:bg-emerald-100'
                    : 'bg-card border-border text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <span className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold transition-colors',
                active ? 'bg-white/20 text-primary-foreground' : isDone ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground group-hover:bg-accent-foreground/10'
              )}>
                {isDone && !active ? <Check className="h-3 w-3" /> : s.n}
              </span>
              <span className="hidden lg:inline">{s.label}</span>
              <span className="lg:hidden">{s.label.split(' ').slice(0, 2).join(' ')}</span>
            </button>
            {i < STEPS.length - 1 && (
              <ChevronRight className={cn('mx-1 h-3 w-3 shrink-0', isPast || isDone ? 'text-emerald-400' : active ? 'text-primary/60' : 'text-muted-foreground/30')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Compact vertical sidebar stepper for workspace layout
export function SidebarStepper({ step, done, onGoto }: { step: number; done: Record<number, boolean>; onGoto: (n: number) => void }) {
  return (
    <nav className="space-y-1">
      {STEPS.map((s) => {
        const active = s.n === step;
        const isDone = done[s.n];
        return (
          <button
            key={s.id}
            onClick={() => onGoto(s.n)}
            className={cn(
              'w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-left transition-colors',
              active ? 'bg-primary text-primary-foreground font-medium shadow-sm' : isDone ? 'text-emerald-700 dark:text-emerald-300 hover:bg-accent' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            <span className={cn('h-6 w-6 rounded-md flex items-center justify-center text-xs font-bold shrink-0', active ? 'bg-white/20' : isDone ? 'bg-emerald-500 text-white' : 'bg-muted')}>
              {isDone && !active ? <Check className="h-3.5 w-3.5" /> : s.n}
            </span>
            <span className="truncate">{s.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
