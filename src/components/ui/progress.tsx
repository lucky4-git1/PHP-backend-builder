import { cn } from '@shared/utils';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number;
  max?: number;
  showLabel?: boolean;
  variant?: 'default' | 'success' | 'warning' | 'error';
}

export const Progress = ({ className, value, max = 100, showLabel = false, variant = 'default', ...props }: ProgressProps) => {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
  
  const variants = {
    default: 'bg-primary',
    success: 'bg-green-500',
    warning: 'bg-yellow-500',
    error: 'bg-red-500',
  };
  
  return (
    <div className={cn('w-full', className)} {...props}>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={cn('h-full transition-all duration-300 ease-out', variants[variant])}
          style={{ width: `${percentage}%` }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={max}
        />
      </div>
      {showLabel && (
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>{value}</span>
          <span>{max}</span>
        </div>
      )}
    </div>
  );
};

export interface CircularProgressProps extends React.SVGAttributes<SVGSVGElement> {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  variant?: 'default' | 'success' | 'warning' | 'error';
  showLabel?: boolean;
}

export const CircularProgress = ({ 
  className, 
  value, 
  max = 100, 
  size = 48, 
  strokeWidth = 4, 
  variant = 'default',
  showLabel = true,
  ...props 
}: CircularProgressProps) => {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  
  const variants = {
    default: 'text-primary',
    success: 'text-green-500',
    warning: 'text-yellow-500',
    error: 'text-red-500',
  };
  
  return (
    <svg
      className={cn(variants[variant], className)}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      {...props}
    >
      <circle
        className="text-muted"
        strokeWidth={strokeWidth}
        stroke="currentColor"
        fill="transparent"
        cx={size / 2}
        cy={size / 2}
        r={radius}
      />
      <circle
        className="transition-all duration-300 ease-out"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        stroke="currentColor"
        fill="transparent"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }}
      />
      {showLabel && (
        <text
          x={size / 2}
          y={size / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={size / 4}
          fontWeight="600"
          fill="currentColor"
        >
          {Math.round(percentage)}%
        </text>
      )}
    </svg>
  );
};