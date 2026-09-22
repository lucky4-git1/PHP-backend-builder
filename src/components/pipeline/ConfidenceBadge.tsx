import { Badge } from '@/components/ui/badge';
import type { ConfidenceTier } from '@/inference/requirements';
import { tierColor } from '@/inference/requirements';

export function ConfidenceBadge({ tier, confidence }: { tier: ConfidenceTier; confidence?: number }) {
  const variant = tierColor(tier) as 'success' | 'info' | 'warning' | 'error';
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant={variant}>{tier}</Badge>
      {confidence !== undefined && (
        <span className="text-xs text-muted-foreground">{Math.round(confidence * 100)}%</span>
      )}
    </span>
  );
}

export function EvidenceList({ items, max = 4 }: { items: string[]; max?: number }) {
  if (items.length === 0) return <p className="text-xs text-muted-foreground italic">No direct evidence — developer decision required.</p>;
  return (
    <ul className="space-y-0.5">
      {items.slice(0, max).map((e, i) => (
        <li key={i} className="font-mono text-[11px] text-muted-foreground truncate" title={e}>▪ {e}</li>
      ))}
      {items.length > max && <li className="text-[11px] text-muted-foreground">+{items.length - max} more</li>}
    </ul>
  );
}
