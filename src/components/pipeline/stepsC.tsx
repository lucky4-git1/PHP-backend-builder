import { useState, useMemo } from 'react';
import { usePipeline } from '@/store/pipelineStore';
import { generateProject, downloadFile } from '@/lib/generator';
import { validateState, securityChecklist } from '@/lib/builder';
import { planIntegration, applyApprovedChanges } from '@/integration/planner';
import { runWithAutoRepair, autoRepair } from '@/validation/pipeline';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { SimpleCode } from '@/components/pipeline/viewers';
import { Copy, Check, Download, ShieldCheck, AlertTriangle, Wrench, ChevronRight, Layers, FileCode } from 'lucide-react';
import { toast } from '@/components/ui/toaster';
import { cn } from '@/shared/utils';

export function StepGenerate() {
  const p = usePipeline();
  const b = p.builder;
  const [file, setFile] = useState('');
  const [search, setSearch] = useState('');

  if (!b) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Review the API first.</CardContent></Card>;

  const errors = validateState({ tables: b.tables, endpoints: b.endpoints, auth: b.auth, config: b.config });
  const checks = securityChecklist({ tables: b.tables, endpoints: b.endpoints, auth: b.auth, config: b.config });
  const preview = useMemo(() => generateProject({ tables: b.tables, endpoints: b.endpoints, auth: b.auth, config: b.config }), [b]);
  const active = preview.find((f) => f.path === file) ?? preview.find((f) => f.path === 'backend/public/index.php') ?? preview[0];
  const filtered = search ? preview.filter((f) => f.path.toLowerCase().includes(search.toLowerCase())) : preview;
  const validation = useMemo(() => runWithAutoRepair({ tables: b.tables, endpoints: b.endpoints, auth: b.auth, config: b.config }, preview), [b, preview]);

  function generate() {
    if (errors.length > 0) {
      toast({ title: 'Fix validation errors first', description: errors[0], variant: 'error' });
      return;
    }
    if (validation.blocking) {
      const topIssue = validation.issues.find((i) => i.severity === 'blocking' || i.severity === 'critical');
      toast({
        title: 'Application validation failed',
        description: topIssue ? `${topIssue.code}: ${topIssue.message}` : 'Resolve blocking issues before continuing',
        variant: 'error',
      });
      return;
    }
    const finalFiles = validation.repairedFiles.length ? validation.repairedFiles : preview;
    const finalState = (validation as unknown as { repairedState: import('@/lib/builder').BuilderState }).repairedState ?? b;
    if (validation.repairs.length) {
      p.setBuilder(finalState);
      // Keep the Step 5 requirements snapshot in sync so Step 11 (which reads
      // requirements) can't disagree with what was just generated from Step 6.
      // patchRequirements (not setRequirements) — must not reset Step 5 decisions.
      if (p.requirements) {
        const repairedTables = new Map(finalState.tables.map((t) => [t.name, t]));
        p.patchRequirements({
          ...p.requirements,
          database: {
            ...p.requirements.database,
            tables: p.requirements.database.tables.map((t) => {
              const rt = repairedTables.get(t.name);
              if (!rt) return t;
              const repairedCols = new Map(rt.columns.map((c) => [c.name, c.type]));
              return { ...t, columns: t.columns.map((c) => (repairedCols.has(c.name) ? { ...c, type: repairedCols.get(c.name) as typeof c.type } : c)) };
            }),
          },
        });
      }
      toast({ title: `Auto-repaired ${validation.repairs.length} issues`, description: validation.repairs.map((r) => r.description).join('; ').slice(0, 120), variant: 'success' });
    }
    p.setGenerated(finalFiles);
    if (p.analysis && p.requirements) {
      const plan = planIntegration(p.frontendFiles, p.analysis, p.requirements);
      p.setIntegration(plan.changes);
    }
    p.markDone(8);
    p.next();
    toast({ title: `Backend generated`, description: `${finalFiles.length} files · validation ${validation.blocking ? 'needs attention' : 'passed'}`, variant: validation.blocking ? 'error' : 'success' });
  }

  async function copy(text: string, msg: string) {
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard unavailable */ }
    toast({ title: msg, variant: 'success' });
  }

  return (
    <div className="space-y-4">
      <Card className="border-violet-200 dark:border-violet-900/50 overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-950/30 dark:to-indigo-950/30 border-b border-violet-100 dark:border-violet-900/30">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white shadow-md shrink-0">
              <Layers className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-base">Step 8 — Generate Backend</CardTitle>
              <CardDescription className="mt-1">IR + Schema AST → secure PHP 8.2 + PDO + MySQL 8. Deterministic, validated, auto-repaired.</CardDescription>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <Badge variant="info" className="bg-white dark:bg-zinc-900">IR validated</Badge>
                <Badge variant="info" className="bg-white dark:bg-zinc-900">AST SQL</Badge>
                <Badge variant={validation.blocking ? 'error' : 'success'}>{validation.blocking ? 'Needs repair' : 'Validation passed'}</Badge>
                <Badge variant="neutral">{preview.length} files</Badge>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {errors.length > 0 && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm flex gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <ul className="list-disc ml-4 text-amber-900 dark:text-amber-100">{errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}

          {/* Validation pipeline */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-widest text-muted-foreground mb-2">
              <ShieldCheck className="h-3.5 w-3.5" /> VALIDATION PIPELINE — DO NOT TRUST GENERATED CODE
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-1.5">
              {validation.stages.map((s) => (
                <div key={s.name} className={cn('rounded-lg border px-2 py-2 text-center', s.status === 'pass' ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800' : s.status === 'warn' ? 'bg-amber-50 border-amber-200 dark:bg-amber-950/30' : 'bg-red-50 border-red-200 dark:bg-red-950/30')}>
                  <div className={cn('h-6 w-6 rounded-full mx-auto flex items-center justify-center text-xs font-bold', s.status === 'pass' ? 'bg-emerald-500 text-white' : s.status === 'warn' ? 'bg-amber-500 text-white' : 'bg-red-500 text-white')}>
                    {s.status === 'pass' ? <Check className="h-3.5 w-3.5" /> : s.status === 'warn' ? '!' : '✕'}
                  </div>
                  <div className="text-[11px] font-medium mt-1 leading-tight">{s.name}</div>
                  <div className="text-[10px] text-muted-foreground">{s.issues.length ? `${s.issues.length} issue(s)` : 'OK'}</div>
                </div>
              ))}
            </div>
            {validation.repairs.length > 0 && (
              <div className="mt-3 rounded-lg bg-white dark:bg-zinc-900 border border-violet-200 dark:border-violet-800 p-2.5 flex gap-2">
                <Wrench className="h-4 w-4 text-violet-600 mt-0.5 shrink-0" />
                <div>
                  <div className="text-xs font-semibold text-violet-700 dark:text-violet-300">Auto-repair applied ({validation.repairs.length})</div>
                  <ul className="text-xs text-muted-foreground mt-1 list-disc ml-4">{validation.repairs.slice(0,4).map((r,i) => <li key={i}>{r.description}</li>)}</ul>
                </div>
              </div>
            )}
            {/* Per-issue fix panel — every failure names its fix location */}
            {validation.issues.length > 0 && (
              <div className="mt-3 rounded-lg bg-white dark:bg-zinc-900 border border-border p-2.5">
                <div className="text-xs font-semibold mb-1.5">Issues to fix ({validation.issues.length})</div>
                <ul className="space-y-1.5">
                  {validation.issues.slice(0, 8).map((issue, i) => {
                    const fixHint =
                      issue.code === 'TYPE_INT_FOR_TEXT' || issue.code === 'IR_FIELD_TYPE'
                        ? 'Step 6 → change the column type to text'
                        : issue.code === 'IR_AUTH_NO_USERS'
                          ? 'Step 6 → add a users table (id, name, email, password), or disable auth in Step 5/7 if this API needs no login'
                          : issue.code === 'IR_NO_PK' || issue.code === 'AST_NO_PK'
                            ? 'Step 6 → add an id primary key to the table'
                            : issue.code === 'AST_FK_UNKNOWN' || issue.code === 'IR_FK_UNKNOWN'
                              ? 'Step 6 → point the foreign key at an existing table'
                              : issue.code === 'DUP_ROUTE'
                                ? 'Step 7 → delete the duplicate route'
                                : issue.stage === 'route'
                                  ? 'Step 7 → fix the route path / re-run Auto-CRUD'
                                  : issue.stage === 'security'
                                    ? 'Step 6/7 → remove the flagged column or secret, then regenerate'
                                    : 'Step 6/7 → correct the flagged item, then regenerate';
                    return (
                      <li key={i} className="text-xs flex items-start gap-2">
                        <span className={cn('mt-0.5 inline-flex h-4 shrink-0 items-center justify-center rounded px-1.5 text-[10px] font-bold whitespace-nowrap', issue.severity === 'blocking' || issue.severity === 'critical' ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : issue.severity === 'error' ? 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300')}>
                          {issue.severity === 'blocking' || issue.severity === 'critical' ? 'BLOCK' : issue.severity.toUpperCase()}
                        </span>
                        <span>
                          <span className="font-mono font-medium">{issue.code}</span>
                          <span className="text-muted-foreground"> — {issue.message}</span>
                          <span className="block text-muted-foreground">
                            Fix: {fixHint}
                            {issue.file ? ` · ${issue.file}` : ''}
                            {issue.fixable ? ' · auto-fixable' : ''}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {validation.issues.some((x) => x.fixable) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full mt-2"
                    onClick={() => {
                      // Apply directly: the pipeline only auto-repairs blocking
                      // issues, so warning-level fixes (e.g. missing users table)
                      // need an explicit user-triggered repair run.
                      const r = autoRepair({ tables: b.tables, endpoints: b.endpoints, auth: b.auth, config: b.config }, preview);
                      if (r.repairs.length) {
                        p.setBuilder(r.state);
                        if (p.requirements) {
                          const repairedTables = new Map(r.state.tables.map((t) => [t.name, t]));
                          p.patchRequirements({
                            ...p.requirements,
                            database: {
                              ...p.requirements.database,
                              tables: p.requirements.database.tables.map((t) => {
                                const rt = repairedTables.get(t.name);
                                if (!rt) return t;
                                const repairedCols = new Map(rt.columns.map((c) => [c.name, c.type]));
                                return { ...t, columns: t.columns.map((c) => (repairedCols.has(c.name) ? { ...c, type: repairedCols.get(c.name) as typeof c.type } : c)) };
                              }),
                            },
                          });
                        }
                        toast({ title: `Applied ${r.repairs.length} safe auto-fix(es)`, description: r.repairs.slice(0, 3).join('; ') + '. Review Step 6, then press “Generate & validate” again.', variant: 'success' });
                      } else {
                        toast({ title: 'No safe auto-fix available', description: 'Fix the issue manually in Step 6/7, then regenerate.', variant: 'error' });
                      }
                    }}
                  >
                    <Wrench className="h-3.5 w-3.5 mr-1" /> Apply safe auto-fixes to schema
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {checks.map((c) => (
              <div key={c.label} className={cn('rounded-xl border p-2.5 text-xs', c.ok ? 'bg-emerald-50/60 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800' : 'bg-amber-50/60 border-amber-200 dark:bg-amber-950/20')}>
                <div className="flex items-center gap-1.5 font-medium">{c.ok ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}{c.label}</div>
                <div className="text-muted-foreground mt-0.5 leading-relaxed">{c.hint}</div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => p.back()} className="rounded-full">Back</Button>
            <Button onClick={generate} className="rounded-full shadow-sm"><ShieldCheck className="h-4 w-4 mr-1.5" /> Generate & validate <ChevronRight className="h-4 w-4 ml-1" /></Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><FileCode className="h-4 w-4" /> Preview <Badge variant="neutral">{filtered.length}</Badge></CardTitle>
            <Input placeholder="Filter files…" value={search} onChange={(e) => setSearch(e.target.value)} className="rounded-full" />
          </CardHeader>
          <CardContent className="max-h-[520px] overflow-auto space-y-0.5 p-2">
            {filtered.map((f) => (
              <button key={f.path} onClick={() => setFile(f.path)} className={cn('block w-full text-left font-mono text-xs rounded-lg px-3 py-2 hover:bg-accent truncate transition-colors', active?.path === f.path ? 'bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300 font-medium' : 'border border-transparent text-muted-foreground hover:text-foreground')}>
                {f.path}
              </button>
            ))}
          </CardContent>
        </Card>
        <Card className="overflow-hidden flex flex-col">
          <CardHeader className="pb-3 shrink-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-medium truncate bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 rounded-full">{active?.path}</span>
              <div className="ml-auto flex gap-1.5">
                <Button size="sm" variant="outline" className="rounded-full h-7" onClick={() => active && void copy(active.content, 'Copied')}><Copy className="h-3.5 w-3.5 mr-1" /> Copy</Button>
                <Button size="sm" variant="outline" className="rounded-full h-7" onClick={() => active && downloadFile(active.path, active.content)}><Download className="h-3.5 w-3.5 mr-1" /> Download</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 min-h-[400px] p-0 overflow-hidden"><SimpleCode code={active?.content ?? ''} height="520px" /></CardContent>
        </Card>
      </div>
    </div>
  );
}

export function StepIntegration() {
  const p = usePipeline();
  const approved = p.integration.filter((c) => c.approved).length;

  function approveAll(v: boolean) {
    p.setIntegration(p.integration.map((c) => ({ ...c, approved: v })));
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Step 9 — Review Frontend Changes</CardTitle>
          <CardDescription>Original files untouched. Approve diffs — new files first, edits as explicit patches. X-Request-ID + error handling included.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2 items-center flex-wrap">
          <Button variant="outline" onClick={() => p.back()} className="rounded-full">Back</Button>
          <Button variant="outline" onClick={() => approveAll(true)} className="rounded-full">Approve all ({p.integration.length})</Button>
          <Button variant="outline" onClick={() => approveAll(false)} className="rounded-full">Reject all</Button>
          <Badge variant={approved ? 'success' : 'neutral'} className="rounded-full">{approved}/{p.integration.length} approved</Badge>
          <Button className="ml-auto rounded-full" onClick={() => { p.markDone(9); p.next(); }}>Continue <ChevronRight className="h-4 w-4 ml-1" /></Button>
        </CardContent>
      </Card>
      {p.integration.length === 0 && <Card><CardContent className="p-6 text-sm text-muted-foreground">No integration changes — generate first, or the frontend already targets the API.</CardContent></Card>}
      {p.integration.map((c) => (
        <Card key={c.id} className={cn('overflow-hidden', c.approved ? 'border-emerald-300 dark:border-emerald-700 shadow-sm' : '')}>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <input type="checkbox" checked={c.approved} onChange={(e) => p.toggleChange(c.id, e.target.checked)} className="rounded" />
              <Badge variant={c.changeType === 'add' ? 'success' : 'info'} className="rounded-full">{c.changeType}</Badge>
              <span className="font-mono text-sm font-bold">{c.filePath}</span>
            </div>
            <CardDescription>{c.description}</CardDescription>
          </CardHeader>
          <CardContent>
            {c.diff ? (
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                {c.diff[0].lines.map((l, i) => (
                  <div key={i} className={cn(
                    'px-3 py-0.5 font-mono text-xs whitespace-pre-wrap border-l-4',
                    l.type === 'add' ? 'bg-emerald-50 border-emerald-500 dark:bg-emerald-950/30' : l.type === 'remove' ? 'bg-red-50 border-red-500 dark:bg-red-950/30' : 'border-transparent text-muted-foreground'
                  )}>
                    {l.type === 'add' ? '+' : l.type === 'remove' ? '−' : ' '} {l.content}
                  </div>
                ))}
              </div>
            ) : (
              <SimpleCode code={(c.newContent ?? '').slice(0, 4000)} height="220px" />
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function StepApply() {
  const p = usePipeline();
  const preview = applyApprovedChanges(p.frontendFiles, p.integration);

  function apply() {
    p.setIntegratedPreview(preview);
    p.markDone(10);
    p.next();
    toast({ title: 'Integration staged', description: `${p.integration.filter((c) => c.approved).length} changes ready for export`, variant: 'success' });
  }

  return (
    <Card className="overflow-hidden">
      <div className="h-1 bg-gradient-to-r from-violet-600 to-indigo-600" />
      <CardHeader>
        <CardTitle>Step 10 — Apply Integration</CardTitle>
        <CardDescription>Approved diffs applied in-memory. Originals preserved under frontend-original/ in export. X-Request-ID propagation enabled.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3 text-sm flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center font-mono font-bold text-xs">{p.frontendFiles.length}</div>
          <span className="text-muted-foreground">original</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <div className="h-9 w-9 rounded-xl bg-violet-600 text-white flex items-center justify-center font-mono font-bold text-xs">{preview.length}</div>
          <span className="text-sm font-medium">integrated <Badge variant="success" className="ml-1 rounded-full">{p.integration.filter((c) => c.approved).length} patches</Badge></span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => p.back()} className="rounded-full">Back</Button>
          <Button onClick={apply} className="rounded-full">Apply & continue to Tests <ChevronRight className="h-4 w-4 ml-1" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}
