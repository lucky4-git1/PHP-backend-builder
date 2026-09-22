import { cn } from '@shared/utils';
import { X } from 'lucide-react';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export const Dialog = ({ open, onOpenChange, children }: DialogProps) => {
  if (!open) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div 
        className="fixed inset-0 bg-black/50 animate-fade-in" 
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div className="relative z-50 w-full max-w-lg animate-slide-in">
        {children}
      </div>
    </div>
  );
};

export const DialogTrigger = ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
  <button onClick={onClick} className="inline-flex items-center">
    {children}
  </button>
);

export const DialogContent = ({ 
  className, 
  children, 
  title,
  description,
  ...props 
}: React.HTMLAttributes<HTMLDivElement> & { title?: string; description?: string }) => (
  <div className={cn('bg-card rounded-lg shadow-lg border border-border', className)} {...props}>
    {(title || description) && (
      <div className="flex items-start space-x-4 p-6 border-b border-border">
        <div className="flex-1">
          {title && <h2 className="text-lg font-semibold text-foreground">{title}</h2>}
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
        <button
          onClick={() => {}} // Will be handled by parent
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )}
    <div className="p-6">{children}</div>
  </div>
);

export const DialogHeader = ({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props}>
    {children}
  </div>
);

export const DialogFooter = ({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
    {...props}
  >
    {children}
  </div>
);

export const DialogTitle = ({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h2 className={cn('text-lg font-semibold leading-none tracking-tight', className)} {...props}>
    {children}
  </h2>
);

export const DialogDescription = ({ className, children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn('text-sm text-muted-foreground', className)} {...props}>
    {children}
  </p>
);