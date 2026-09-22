import type { ProjectTreeNode } from '@/shared/types';
import { cn } from '@/shared/utils';
import { FileCode2, Folder, FolderOpen, Copy, Check } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export function CodeViewer({ code, height = '480px' }: { code: string; language: string; height?: string }) {
  return <SimpleCode code={code} height={height} />;
}

export function SimpleCode({ code, height = '480px' }: { code: string; height?: string }) {
  return (
    <pre
      style={{ maxHeight: height }}
      className="overflow-auto rounded-md bg-[#0d1117] p-4 text-[12px] leading-relaxed text-gray-100 font-mono whitespace-pre-wrap break-words"
    >
      {code}
    </pre>
  );
}

export function FileTree({ node, selected, onSelect, depth = 0 }: {
  node: ProjectTreeNode;
  selected?: string;
  onSelect?: (path: string) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState(depth < 2);
  if (node.type === 'file') {
    return (
      <button
        onClick={() => onSelect?.(node.path)}
        className={cn('flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left font-mono text-xs hover:bg-accent truncate', selected === node.path ? 'bg-accent border border-primary/40' : 'border border-transparent')}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        title={node.path}
      >
        <FileCode2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }
  return (
    <div>
      {(node.name !== 'frontend' || depth > 0) && (
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs font-medium hover:bg-accent"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {open ? <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" /> : <Folder className="h-3.5 w-3.5 text-muted-foreground" />}
          {node.name}
        </button>
      )}
      {(open || node.name === 'frontend') && (
        <div>
          {(node.children ?? []).map((c) => (
            <FileTree key={c.path + c.name} node={c} selected={selected} onSelect={onSelect} depth={node.name === 'frontend' ? 0 : depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export interface ArtifactSourceViewerModalProps {
  open: boolean;
  onClose: () => void;
  filePath: string;
  content: string;
  lineStart?: number;
  lineEnd?: number;
  highlightSeverity?: 'critical' | 'high' | 'medium' | 'low' | 'info';
  ruleId?: string;
  title?: string;
}

export function ArtifactSourceViewerModal({
  open,
  onClose,
  filePath,
  content,
  lineStart,
  lineEnd,
  highlightSeverity = 'high',
  ruleId,
  title,
}: ArtifactSourceViewerModalProps) {
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && lineStart && lineRefs.current.has(lineStart)) {
      setTimeout(() => {
        lineRefs.current.get(lineStart)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    }
  }, [open, lineStart]);

  if (!open) return null;

  const lines = (content || '').split('\n');
  const targetEnd = lineEnd || lineStart;

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isSevere = highlightSeverity === 'critical' || highlightSeverity === 'high';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0 overflow-hidden bg-card border-border">
        <DialogHeader className="p-4 border-b border-border flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <DialogTitle className="font-mono text-sm">{filePath}</DialogTitle>
            {lineStart && (
              <Badge variant="neutral" className="font-mono text-xs">
                Line {lineStart}{targetEnd && targetEnd !== lineStart ? `-${targetEnd}` : ''}
              </Badge>
            )}
            {ruleId && <Badge variant="info">{ruleId}</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={handleCopy} className="h-8 px-2 text-xs">
              {copied ? <Check className="h-3.5 w-3.5 mr-1 text-green-500" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button size="sm" variant="outline" onClick={onClose} className="h-8 px-2 text-xs">
              Close
            </Button>
          </div>
        </DialogHeader>
        {title && (
          <div className="px-4 py-2 bg-muted/40 text-xs border-b border-border text-muted-foreground">
            {title}
          </div>
        )}
        <div className="overflow-auto flex-1 font-mono text-xs leading-5 bg-[#0d1117] text-gray-200">
          {lines.map((line, idx) => {
            const lineNum = idx + 1;
            const isHighlighted = lineStart && lineNum >= lineStart && lineNum <= (targetEnd || lineStart);
            return (
              <div
                key={lineNum}
                ref={(el) => {
                  if (el) lineRefs.current.set(lineNum, el);
                  else lineRefs.current.delete(lineNum);
                }}
                className={cn(
                  'flex group hover:bg-white/5 transition-colors',
                  isHighlighted && (isSevere ? 'bg-red-500/20 border-l-4 border-red-500 pl-1' : 'bg-amber-500/20 border-l-4 border-amber-500 pl-1')
                )}
              >
                <span className="w-12 shrink-0 select-none pr-3 text-right text-gray-500 border-r border-gray-800">
                  {lineNum}
                </span>
                <span className="px-3 whitespace-pre overflow-x-auto flex-1">{line || ' '}</span>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
