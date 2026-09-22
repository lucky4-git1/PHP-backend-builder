import React, { useState, useRef, useEffect } from 'react';
import { cn } from '@shared/utils';

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
  delay?: number;
}

export const Tooltip = ({ content, children, side = 'top', delay = 200 }: TooltipProps) => {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const childRef = useRef<HTMLElement>(null);
  
  const show = () => {
    timeoutRef.current = setTimeout(() => setVisible(true), delay);
  };
  
  const hide = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVisible(false);
  };
  
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);
  
  const sideClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  };
  
  const arrowClasses = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-border',
    right: 'left-0 top-1/2 -translate-y-1/2 border-l-border',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-border',
    left: 'right-full top-1/2 -translate-y-1/2 border-r-border',
  };
  
  const clonedChild = React.cloneElement(children, {
    ref: childRef,
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
  });
  
  return (
    <div className="relative inline-block" onMouseEnter={show} onMouseLeave={hide}>
      {clonedChild}
      {visible && (
        <div
          className={cn(
            'absolute z-50 px-3 py-2 text-xs font-medium text-white bg-gray-900 rounded shadow-lg animate-fade-in whitespace-nowrap',
            sideClasses[side]
          )}
          role="tooltip"
        >
          {content}
          <div
            className={cn(
              'absolute w-0 h-0 border-4 border-transparent',
              arrowClasses[side]
            )}
          />
        </div>
      )}
    </div>
  );
};