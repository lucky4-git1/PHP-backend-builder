import { useState } from 'react';
import { usePipeline } from '@/store/pipelineStore';
import { runAllTests, summarizeTests } from '@/testing/testRunner';
import { auditSecurity, summarizeFindings } from '@/security/auditor';
import { buildExportZip, downloadBlob } from '@/exporter/exporter';
import { downloadFile } from '@/lib/generator';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SimpleCode, ArtifactSourceViewerModal } from '@/components/pipeline/viewers';
import { Play, ShieldCheck, Download, PackageCheck, Check, X, Minus, FileCode2, Award } from 'lucide-react';
import { toast } from '@/components/ui/toaster';
import { cn } from '@/shared/utils';
import mermaid from 'mermaid';
import { useEffect, useRef, useMemo } from 'react';
import { runValidationPipeline } from '@/validation/pipeline';
import { runRegressionTests } from '@/testing/regression';
import { applyRemediation, canRemediateFinding } from '@/security/remediator';
import { generateCertificationReport } from '@/certification/certification';
import type { BuilderState, GenFile } from '@/lib/builder';
import type { SecurityFinding } from '@/shared/types';

function ExportGate({ builder, generated, security }: { builder: BuilderState; generated: GenFile[]; security?: SecurityFinding[] }) {
  const gate = useMemo(() => runValidationPipeline(builder, generated), [builder, generated]);
  const regress = useMemo(() => runRegressionTests(), []);
  const regFail = regress.filter((r) => !r.passed);
  const unverifiedSec = useMemo(
    () => (security || []).filter((f) => (f.severity === 'critical' || f.severity === 'high') && f.status !== 'verified' && f.status !== 'fixed'),
    [security]
  );
  if (gate.blocking || regFail.length > 0 || unverifiedSec.length > 0) {
    return (
      <div className="flex gap-2 items-start">
        <X className="h-4 w-4 text-red-500 mt-0.5 shrink-0" aria-hidden />
        <div>
          <div className="font-semibold text-red-600 dark:text-red-400">EXPORT BLOCKED — critical quality gates failed</div>
          <ul className="list-disc ml-4 text-xs text-muted-foreground mt-1">
            {gate.issues.filter((i) => i.severity === 'blocking' || i.severity === 'critical').slice(0, 4).map((i, k) => <li key={k}>{i.code}: {i.message}</li>)}
            {regFail.slice(0, 3).map((r) => <li key={r.name}>regression: {r.name} — {r.detail}</li>)}
            {unverifiedSec.slice(0, 3).map((s) => (
              <li key={s.id} className="text-red-600 dark:text-red-400">
                security: {s.ruleId} — {s.title} ({s.status.toUpperCase()} does not clear export gate)
              </li>
            ))}
          </ul>
          <div className="text-xs mt-1">Fix in Schema/Generate or apply remediation in Step 12. Reviewed/ignored does not clear critical findings.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2 items-start">
      <Check className="h-4 w-4 text-green-500 mt-0.5 shrink-0" aria-hidden />
      <div>
        <div className="font-semibold text-green-700 dark:text-green-300">READY TO EXPORT — all mandatory checks passed</div>
        <div className="text-xs text-muted-foreground">{gate.stages.length} stages pass · {regress.length} regression tests pass · 0 critical/high open security findings</div>
      </div>
    </div>
  );
}

export function StepTests() {
  const p = usePipeline();
  const [busy, setBusy] = useState(false);

  function run() {
    if (p.generated.length === 0 || !p.requirements || !p.analysis) {
      toast({ title: 'Generate first', description: 'Backend + analysis required.', variant: 'error' });
      return;
    }
    setBusy(true);
    setTimeout(() => {
      try {
        const schemaSql = p.generated.find((f) => f.path === 'database/schema.sql')?.content ?? '';
        const results = runAllTests({
          projectId: p.projectName,
          generated: p.generated,
          requirements: p.requirements!,
          analysis: p.analysis!,
          schemaSql,
        });
        p.setTests(results);
        const s = summarizeTests(results);
        toast({ title: `Tests: ${s.passed} passed, ${s.failed} failed`, variant: s.failed ? 'error' : 'success' });
      } finally {
        setBusy(false);
      }
    }, 30);
  }

  const s = summarizeTests(p.tests);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 11 — Run Tests (deterministic, no server needed)</CardTitle>
        <CardDescription>PHP syntax heuristic, MySQL 8 validation, schema consistency, CRUD coverage, auth, frontend compatibility.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 items-center">
          <Button variant="outline" onClick={() => p.back()}>Back</Button>
          <Button onClick={run} loading={busy}><Play className="h-4 w-4 mr-1" /> Run all suites</Button>
          {p.tests.length > 0 && <Badge variant={s.failed ? 'error' : 'success'}>{s.passed} passed · {s.failed} failed · {s.skipped} skipped</Badge>}
          <Button className="ml-auto" disabled={p.tests.length === 0 || s.failed > 0} onClick={() => { p.markDone(11); p.next(); }}>
            Continue to Security
          </Button>
        </div>
        {s.failed > 0 && <p className="text-xs text-red-500">Fix failing suites — generation or requirements must change before export.</p>}
        <div className="space-y-1.5">
          {p.tests.map((t) => (
            <div key={t.id} className="flex items-start gap-2 rounded border border-border p-2 text-xs">
              {t.status === 'passed' ? <Check className="h-4 w-4 text-green-500 mt-0.5" /> : t.status === 'failed' ? <X className="h-4 w-4 text-red-500 mt-0.5" /> : <Minus className="h-4 w-4 text-muted-foreground mt-0.5" />}
              <div>
                <span className="font-mono font-bold">[{t.suite}]</span> {t.name}
                {t.message && <div className="text-muted-foreground">{t.message}</div>}
              </div>
              <Badge variant={t.status === 'passed' ? 'success' : t.status === 'failed' ? 'error' : 'neutral'} className="ml-auto">{t.status}</Badge>
            </div>
          ))}
          {p.tests.length === 0 && <p className="text-sm text-muted-foreground">No runs yet — click “Run all suites”.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export function StepSecurity() {
  const p = usePipeline();
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewerTarget, setViewerTarget] = useState<{
    filePath: string;
    content: string;
    lineStart?: number;
    lineEnd?: number;
    ruleId?: string;
    title?: string;
  } | null>(null);

  function run() {
    if (!p.requirements || p.generated.length === 0) {
      toast({ title: 'Generate first', variant: 'error' });
      return;
    }
    setBusy(true);
    setTimeout(() => {
      const findings = auditSecurity({ projectId: p.projectName, generated: p.generated, requirements: p.requirements! });
      p.setSecurity(findings);
      setBusy(false);
      const crit = findings.filter((f) => f.severity === 'critical' && f.status === 'open').length;
      toast({ title: `Audit: ${findings.length} findings`, description: crit ? `${crit} critical — must resolve.` : 'No critical open findings.', variant: crit ? 'error' : 'success' });
    }, 30);
  }

  function openSourceViewer(f: SecurityFinding) {
    if (!f.location?.file) return;
    const targetFile = p.generated.find((gf) => gf.path === f.location?.file || gf.path.endsWith(f.location?.file || ''));
    if (targetFile) {
      setViewerTarget({
        filePath: targetFile.path,
        content: targetFile.content,
        lineStart: f.location.lineStart,
        lineEnd: f.location.lineEnd,
        ruleId: f.ruleId,
        title: f.title,
      });
    } else {
      toast({ title: 'File not found', description: `Could not locate ${f.location.file} in generated files`, variant: 'error' });
    }
  }

  function handleApplyFix(f: SecurityFinding) {
    if (!p.builder) return;
    setBusy(true);
    try {
      const res = applyRemediation(f, p.builder, p.requirements || undefined);
      p.setBuilder(res.updatedBuilder);
      p.setGenerated(res.regeneratedFiles);
      p.setSecurity(res.allFindings);
      toast({
        title: res.verified ? 'Fix applied & verified' : 'Remediation applied',
        description: res.message,
        variant: res.verified ? 'success' : 'info',
      });
    } catch (err) {
      toast({ title: 'Remediation error', description: String(err), variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const sum = summarizeFindings(p.security);
  const sevColor: Record<string, 'error' | 'warning' | 'info' | 'success' | 'neutral'> = {
    critical: 'error', high: 'error', medium: 'warning', low: 'neutral', info: 'success',
  };
  const statusColor: Record<string, 'error' | 'warning' | 'info' | 'success' | 'neutral'> = {
    open: 'error', fixed: 'success', verified: 'success', reviewed: 'warning', ignored: 'neutral', false_positive: 'neutral',
  };
  const critHighOpen = p.security.filter((f) => (f.severity === 'critical' || f.severity === 'high') && f.status === 'open').length;
  const statusCounts = p.security.reduce((acc, f) => { acc[f.status] = (acc[f.status] ?? 0) + 1; return acc; }, {} as Record<string, number>);

  function updateStatus(id: string, newStatus: SecurityFinding['status']) {
    p.setSecurity(p.security.map((x) => (x.id === id ? { ...x, status: newStatus } : x)));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 12 — Security Audit (OWASP-minded)</CardTitle>
        <CardDescription>Injection, auth gaps, CORS, uploads, ownership, error exposure. Critical findings block export.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 items-center flex-wrap">
          <Button variant="outline" onClick={() => p.back()}>Back</Button>
          <Button onClick={run} loading={busy}><ShieldCheck className="h-4 w-4 mr-1" /> Run audit</Button>
          {p.security.length > 0 && (
            <span className="flex gap-1 flex-wrap">{Object.entries(sum).filter(([, v]) => v > 0).map(([k, v]) => <Badge key={k} variant={sevColor[k] ?? 'neutral'}>{k}: {v}</Badge>)}</span>
          )}
          <Button className="ml-auto" disabled={p.security.length === 0 || critHighOpen > 0} onClick={() => { p.markDone(12); p.next(); }}
            title={critHighOpen > 0 ? `${critHighOpen} critical/high open findings must be resolved` : undefined}
          >Continue to Architecture</Button>
        </div>

        {/* Status summary */}
        {p.security.length > 0 && (
          <div className="flex gap-2 flex-wrap text-xs">
            {Object.entries(statusCounts).map(([k, v]) => <Badge key={k} variant={statusColor[k] ?? 'neutral'}>{k}: {v}</Badge>)}
          </div>
        )}

        {/* Export gate warning */}
        {critHighOpen > 0 && (
          <div className="flex gap-2 items-start rounded-md border border-red-500/40 bg-red-50 dark:bg-red-950/20 p-3">
            <X className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
            <div className="text-sm">
              <span className="font-semibold text-red-600 dark:text-red-400">EXPORT BLOCKED</span>
              <span className="text-muted-foreground"> — {critHighOpen} critical/high finding{critHighOpen > 1 ? 's' : ''} with status &quot;open&quot; must be resolved, fixed, or verified before export.</span>
            </div>
          </div>
        )}

        {/* Finding cards */}
        <div className="space-y-2">
          {p.security.map((f) => {
            const expanded = expandedId === f.id;
            const locationStr = f.location ? `${f.location.file}${f.location.lineStart ? ':' + f.location.lineStart : ''}` : null;
            return (
              <div key={f.id} className={cn('rounded-md border p-3 text-sm transition-colors cursor-pointer', f.severity === 'critical' || f.severity === 'high' ? f.status === 'open' ? 'border-red-500/60 bg-red-50/50 dark:bg-red-950/10' : 'border-red-500/20' : 'border-border')}
                onClick={() => setExpandedId(expanded ? null : f.id)} role="button" tabIndex={0}
              >
                {/* Header row */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={sevColor[f.severity] ?? 'neutral'}>{f.severity}</Badge>
                  <span className="font-medium">{f.title}</span>
                  <Badge variant="info">{f.category}</Badge>
                  <Badge variant={statusColor[f.status] ?? 'neutral'} className="ml-auto">{f.status}</Badge>
                </div>

                {/* Location */}
                {locationStr && (
                  <div
                    className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 font-mono mt-1 hover:underline cursor-pointer"
                    onClick={(e) => { e.stopPropagation(); openSourceViewer(f); }}
                    title="Click to view source location in code viewer"
                  >
                    <FileCode2 className="h-3.5 w-3.5" />
                    <span>{locationStr}</span>
                  </div>
                )}

                {/* Collapsed preview */}
                {!expanded && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{f.description}</p>}

                {/* Expanded detail */}
                {expanded && (
                  <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                    {/* Evidence */}
                    {f.evidence?.code && (
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground mb-0.5">EVIDENCE</div>
                        <SimpleCode height="80px" code={f.evidence.code} />
                      </div>
                    )}

                    {/* WHAT / WHY / IMPACT / FIX */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                      <div><span className="font-semibold">WHAT: </span>{f.description}</div>
                      <div><span className="font-semibold">WHY: </span>{f.whyFlagged}</div>
                      <div><span className="font-semibold">IMPACT: </span>{f.impact}</div>
                      <div>
                        <span className="font-semibold">FIX: </span>{f.remediation.summary}
                        {f.remediation.steps.length > 0 && (
                          <ul className="list-disc ml-4 mt-0.5">
                            {f.remediation.steps.map((s, i) => <li key={i}>{s}</li>)}
                          </ul>
                        )}
                      </div>
                    </div>

                    {/* Remediation code example */}
                    {f.remediation.codeExample && (
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground mb-0.5">REMEDIATION EXAMPLE</div>
                        <SimpleCode height="60px" code={f.remediation.codeExample} />
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-2 pt-1 flex-wrap items-center">
                      {f.location && (
                        <Button size="sm" variant="outline" onClick={() => openSourceViewer(f)}>
                          <FileCode2 className="h-3.5 w-3.5 mr-1" /> Open File
                        </Button>
                      )}
                      {canRemediateFinding(f) && (f.status === 'open' || f.status === 'reviewed') && (
                        <Button size="sm" onClick={() => handleApplyFix(f)}>
                          Apply Fix
                        </Button>
                      )}
                      {f.status === 'open' && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => updateStatus(f.id, 'reviewed')}>Mark Reviewed</Button>
                          <Button size="sm" variant="outline" onClick={() => updateStatus(f.id, 'ignored')}>Ignore</Button>
                        </>
                      )}
                      {(f.status === 'reviewed' || f.status === 'ignored') && (
                        <Button size="sm" variant="outline" onClick={() => updateStatus(f.id, 'open')}>Reopen</Button>
                      )}
                      {f.status === 'fixed' && (
                        <Button size="sm" variant="outline" onClick={() => updateStatus(f.id, 'verified')}>Verify Fix</Button>
                      )}
                      <span className="text-xs text-muted-foreground self-center ml-auto">
                        {f.ruleId} · confidence: {Math.round(f.confidence * 100)}%
                        {(f.status === 'reviewed' || f.status === 'ignored') && (f.severity === 'critical' || f.severity === 'high') && (
                          <span className="text-amber-600 dark:text-amber-400"> · ⚠ does not clear export gate</span>
                        )}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {p.security.length === 0 && <p className="text-sm text-muted-foreground">No audit yet — click &quot;Run audit&quot;.</p>}
        </div>

        {/* Source viewer modal */}
        {viewerTarget && (
          <ArtifactSourceViewerModal
            open={!!viewerTarget}
            onClose={() => setViewerTarget(null)}
            filePath={viewerTarget.filePath}
            content={viewerTarget.content}
            lineStart={viewerTarget.lineStart}
            lineEnd={viewerTarget.lineEnd}
            ruleId={viewerTarget.ruleId}
            title={viewerTarget.title}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ArchDiagram({ dot }: { dot: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
    const el = ref.current;
    if (!el) return;
    el.innerHTML = '';
    const id = 'arch_' + Math.random().toString(36).slice(2, 8);
    mermaid.render(id, dot).then((r) => { el.innerHTML = r.svg; }).catch(() => { el.textContent = dot; });
  }, [dot]);
  return <div ref={ref} className="mermaid-container text-xs overflow-auto" />;
}

export function StepArchitecture() {
  const p = usePipeline();
  const b = p.builder;
  if (!b) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Generate first.</CardContent></Card>;

  const tables = b.tables.map((t) => t.name);
  const dot = [
    'graph TD',
    '  FE["Frontend (original + api-client)"] --> API["PHP API ' + (b.config.apiPrefix || '/api/v1') + '"]',
    '  API --> AUTH["Auth (JWT)"]',
    ...tables.slice(0, 10).map((t, i) => `  API --> T${i}["${t} controller + model"]\n  T${i} --> DB[("MySQL ${b.config.dbName}")]`),
    tables.length === 0 ? '  API --> DB[("MySQL")]' : '',
  ].join('\n');

  const s = summarizeTests(p.tests);
  const sum = summarizeFindings(p.security);

  const cert = useMemo(() => {
    if (!b || p.generated.length === 0) return null;
    return generateCertificationReport({
      builder: b,
      generated: p.generated,
      tests: p.tests,
      security: p.security,
      validation: runValidationPipeline(b, p.generated),
      regression: runRegressionTests(),
    });
  }, [b, p.generated, p.tests, p.security]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Step 13 — Review Final Architecture</CardTitle>
          <CardDescription>Confirm the whole system before export: frontend → API → MySQL, plus quality gates.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2 items-center flex-wrap">
          <Badge variant="info">{b.tables.length} tables</Badge>
          <Badge variant="info">{b.endpoints.length} routes</Badge>
          <Badge variant="info">{p.generated.length} files</Badge>
          <Badge variant={s.failed ? 'error' : 'success'}>tests {s.passed}✓{s.failed ? ` ${s.failed}✗` : ''}</Badge>
          <Badge variant={sum.critical ? 'error' : 'success'}>security: {p.security.length} findings</Badge>
          {cert && (
            <Badge variant={cert.grade === 'A' ? 'success' : cert.grade === 'B' ? 'info' : 'error'}>
              cert: Grade {cert.grade} ({cert.score}/100)
            </Badge>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => p.back()}>Back</Button>
            <Button onClick={() => { p.markDone(13); p.next(); }}>Continue to Export</Button>
          </div>
        </CardContent>
      </Card>

      {/* Certification Report */}
      {cert && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Award className="h-5 w-5 text-amber-500" />
                Application Certification Report
              </CardTitle>
              <CardDescription>{cert.summary}</CardDescription>
            </div>
            <div className="text-right">
              <Badge variant={cert.grade === 'A' ? 'success' : cert.grade === 'B' ? 'info' : 'error'} className="text-base px-3 py-1">
                Grade {cert.grade} · {cert.score}/100
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
              {Object.entries(cert.categories).map(([key, cat]) => (
                <div key={key} className="rounded border border-border p-2 bg-card">
                  <div className="font-semibold capitalize">{key} ({cat.weight}%)</div>
                  <div className={cn('text-base font-bold', cat.score >= 90 ? 'text-green-600 dark:text-green-400' : cat.score >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400')}>
                    {cat.score}%
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1" title={cat.details.join(', ')}>
                    {cat.details[0] || 'Pass'}
                  </div>
                </div>
              ))}
            </div>
            {cert.hardFloorReasons.length > 0 && (
              <div className="rounded border border-red-500/30 bg-red-50/50 dark:bg-red-950/10 p-2 text-xs text-red-600 dark:text-red-400">
                <div className="font-semibold">Certification Hard Floor Triggered:</div>
                <ul className="list-disc ml-4">
                  {cert.hardFloorReasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">System map</CardTitle></CardHeader>
        <CardContent><ArchDiagram dot={dot} /></CardContent>
      </Card>
    </div>
  );
}

export function StepExport() {
  const p = usePipeline();
  const [busy, setBusy] = useState(false);

  // Single gate, shared by the status panel AND the Download button — they can
  // never disagree. Recomputed from the live builder + generated files + security findings.
  const exportGate = useMemo(() => {
    if (!p.builder || p.generated.length === 0) return null;
    const gate = runValidationPipeline(p.builder, p.generated);
    const regress = runRegressionTests();
    const regFail = regress.filter((r) => !r.passed);
    const unverifiedSec = p.security.filter(
      (f) => (f.severity === 'critical' || f.severity === 'high') && f.status !== 'verified' && f.status !== 'fixed'
    );
    return {
      gate,
      regFail,
      unverifiedSec,
      blocked: gate.blocking || regFail.length > 0 || unverifiedSec.length > 0,
    };
  }, [p.builder, p.generated, p.security]);
  const blockReason = exportGate
    ? [
        ...exportGate.gate.issues.filter((i) => i.severity === 'blocking' || i.severity === 'critical').slice(0, 3).map((i) => `${i.code}: ${i.message}`),
        ...exportGate.regFail.slice(0, 2).map((r) => `regression: ${r.name} — ${r.detail}`),
        ...exportGate.unverifiedSec.slice(0, 2).map((s) => `security: ${s.ruleId} (${s.status})`),
      ].join('; ')
    : null;

  async function exportZip() {
    if (p.generated.length === 0) {
      toast({ title: 'Nothing to export', variant: 'error' });
      return;
    }
    // Re-check the shared gate at click time — generation success ≠ export readiness (Rule 3/4, §25)
    if (exportGate?.blocked) {
      toast({ title: 'EXPORT BLOCKED', description: blockReason ?? 'Resolve the issues above first.', variant: 'error' });
      return;
    }
    const gate = exportGate?.gate;
    setBusy(true);
    try {
      const notes = [
        ...p.integration.filter((c) => c.approved).map((c) => `Applied ${c.changeType}: ${c.filePath}`),
        `Tests: ${p.tests.filter((t) => t.status === 'passed').length}/${p.tests.length} passed`,
        `Security: ${p.security.length} findings reviewed`,
        `Validation: ${gate ? gate.stages.map((s) => `${s.name}=${s.status}`).join(', ') : 'n/a'}`,
      ];
      const blob = await buildExportZip({
        projectName: p.projectName,
        backend: p.generated,
        frontendOriginal: p.frontendFiles,
        frontendChanges: p.integration,
        notes,
        validation: gate ? { blocking: gate.blocking, issues: gate.issues } : undefined,
      });
      downloadBlob(blob, `${p.projectName}.zip`);
      p.markDone(14);
      toast({ title: 'Exported complete project', description: `${p.projectName}.zip — backend + integrated frontend.`, variant: 'success' });
    } catch (e) {
      toast({ title: 'Export failed', description: String(e), variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  function exportSpec() {
    const payload = JSON.stringify({
      project: p.projectName,
      analysis: p.analysis,
      requirements: p.requirements,
      schema: p.schema,
      builder: p.builder,
      tests: p.tests,
      security: p.security,
    }, null, 2);
    downloadFile(`${p.projectName}.phpbb.json`, payload);
    toast({ title: 'Spec exported', variant: 'success' });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Step 14 — Export Complete Project</CardTitle>
          <CardDescription>A developer can take this ZIP and run it: PHP backend + MySQL schema + integrated ORIGINAL frontend + docs.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-xl border border-border p-3 text-sm" role="status" aria-live="polite">
            {p.builder && p.generated.length > 0 ? (
              <ExportGate builder={p.builder} generated={p.generated} security={p.security} />
            ) : (
              <span className="text-muted-foreground">Generate the backend first — export readiness is computed from real validation, never faked.</span>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => p.back()}>Back</Button>
            <Button
              onClick={() => void exportZip()}
              loading={busy}
              disabled={exportGate?.blocked ?? false}
              title={exportGate?.blocked ? `Export blocked: ${blockReason}` : 'Download the validated project ZIP'}
            >
              <Download className="h-4 w-4 mr-1" /> Download .zip
            </Button>
            <Button variant="outline" onClick={exportSpec}>Export spec .json</Button>
          </div>
          {exportGate?.blocked && (
            <p className="text-xs text-red-600 dark:text-red-400">
              Download is disabled until the gate above is green. {blockReason}
            </p>
          )}
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <PackageCheck className="h-4 w-4" />
            {p.generated.length} backend files · {(p.integratedPreview.length || p.frontendFiles.length)} frontend files · {p.tests.length} tests · {p.security.length} security findings
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Run locally (2 min)</CardTitle></CardHeader>
        <CardContent>
          <SimpleCode height="240px" code={[
            `mysql -u root -p -e "CREATE DATABASE ${p.builder?.config.dbName ?? 'app_db'} CHARACTER SET utf8mb4;"`,
            `mysql -u root -p ${p.builder?.config.dbName ?? 'app_db'} < database/schema.sql`,
            'cp .env.example .env   # fill DB_* + JWT_SECRET + CORS_ORIGINS',
            'php -S localhost:8000 -t backend/public',
            `curl http://localhost:8000${p.builder?.config.apiPrefix ?? '/api/v1'}/health`,
          ].join('\n')} />
        </CardContent>
      </Card>
    </div>
  );
}
