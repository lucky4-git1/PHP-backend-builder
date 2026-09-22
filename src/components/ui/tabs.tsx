import React, { useState } from 'react';
import { cn } from '@shared/utils';

export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  orientation?: 'horizontal' | 'vertical';
}

export const Tabs = ({ 
  className, 
  children, 
  defaultValue, 
  value, 
  onValueChange, 
  orientation = 'horizontal',
  ...props 
}: TabsProps) => {
  const [activeValue, setActiveValue] = useState(defaultValue || '');
  const controlled = value !== undefined;
  const currentValue = controlled ? value : activeValue;
  
  const handleValueChange = (newValue: string) => {
    if (!controlled) setActiveValue(newValue);
    onValueChange?.(newValue);
  };
  
  return (
    <div className={cn(className)} {...props}>
      {React.Children.map(children, (child) => {
        if (!React.isValidElement(child)) return child;
        
        if (child.type === TabsList) {
          return React.cloneElement(child, { 
            orientation,
            onValueChange: handleValueChange,
            value: currentValue,
          });
        }
        
        if (child.type === TabsTrigger) {
          return React.cloneElement(child, { 
            value: child.props.value,
            active: child.props.value === currentValue,
            onClick: () => handleValueChange(child.props.value),
          });
        }
        
        if (child.type === TabsContent) {
          return React.cloneElement(child, { 
            value: child.props.value,
            active: child.props.value === currentValue,
          });
        }
        
        return child;
      })}
    </div>
  );
};

export interface TabsListProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical';
  value?: string;
  onValueChange?: (value: string) => void;
}

export const TabsList = ({ className, orientation, ...props }: TabsListProps) => (
  <div
    className={cn(
      'inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground',
      orientation === 'vertical' && 'flex-col w-10',
      className
    )}
    role="tablist"
    aria-orientation={orientation}
    {...props}
  />
);

export interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
  active?: boolean;
}

export const TabsTrigger = ({ className, value, active, children, ...props }: TabsTriggerProps) => (
  <button
    role="tab"
    aria-selected={active}
    aria-controls={`tabs-content-${value}`}
    id={`tabs-trigger-${value}`}
    className={cn(
      'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
      active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      className
    )}
    {...props}
  >
    {children}
  </button>
);

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  active?: boolean;
}

export const TabsContent = ({ className, value, active, children, ...props }: TabsContentProps) => (
  <div
    role="tabpanel"
    id={`tabs-content-${value}`}
    aria-labelledby={`tabs-trigger-${value}`}
    hidden={!active}
    className={cn('mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', className)}
    {...props}
  >
    {active && children}
  </div>
);

TabsList.displayName = 'TabsList';
TabsTrigger.displayName = 'TabsTrigger';
TabsContent.displayName = 'TabsContent';