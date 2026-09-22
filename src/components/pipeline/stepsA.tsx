import { useState } from 'react';
import { usePipeline } from '@/store/pipelineStore';
import { importZipFile, demoFrontendFiles, buildTree } from '@/analyzer/zipImport';
import { analyzeFrontend } from '@/analyzer/staticAnalysis';
import { inferRequirements } from '@/inference/requirements';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { FileTree, SimpleCode } from '@/components/pipeline/viewers';
import { ConfidenceBadge, EvidenceList } from '@/components/pipeline/ConfidenceBadge';
import { tierFor } from '@/inference/requirements';
import { Upload, FolderGit, Play, Sparkles, FileWarning } from 'lucide-react';
import { toast } from '@/components/ui/toaster';

export function StepCreate() {
  const p = usePipeline();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 1 — Create Project</CardTitle>
        <CardDescription>Name your full-stack project. Everything stays in your browser — no data leaves the device.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input label="Project name" value={p.projectName} onChange={(e) => p.setProjectName(e.target.value)} placeholder="my-fullstack-app" />
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { p.setSource('manual'); p.goto(6); toast({ title: 'Manual mode', description: 'Skipped to database designer.', variant: 'success' }); }}>
            Skip frontend → design manually
          </Button>
          <Button onClick={() => { p.markDone(1); p.next(); }}>Continue to Import</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function StepImport() {
  const p = usePipeline();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState('');

  async function onZip(file: File) {
    setBusy(true);
    try {
      const r = await importZipFile(file);
      p.setSource('zip');
      p.setFiles(r.files, r.tree, r.skipped);
      p.setAnalysis(null);
      p.setRequirements(null);
      toast({ title: `Imported ${r.files.length} files`, description: r.skipped ? `${r.skipped} ignored (build artifacts).` : 'Ready to analyze.', variant: 'success' });
    } catch (e) {
      toast({ title: 'ZIP import failed', description: String(e), variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  function loadDemo() {
    const files = demoFrontendFiles();
    p.setSource('demo');
    p.setFiles(files, buildTree(files), 0);
    p.setAnalysis(null);
    p.setRequirements(null);
    toast({ title: 'Demo shop loaded', description: `${files.length} files — try Analyze next.`, variant: 'success' });
  }

  const sel = p.frontendFiles.find((f) => f.relativePath === preview);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Step 2 — Import Frontend</CardTitle>
          <CardDescription>Drop a frontend ZIP (React / Next / Vue / plain HTML). Deterministic parsing only.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 py-6 text-sm hover:bg-accent">
            <Upload className="h-4 w-4" /> {busy ? 'Reading ZIP…' : 'Choose frontend .zip'}
            <input type="file" accept=".zip" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onZip(f); e.target.value = ''; }} />
          </label>
          <Button variant="outline" className="w-full" onClick={loadDemo}><Sparkles className="h-4 w-4 mr-1" /> Load demo shop (no ZIP)</Button>
          {p.frontendFiles.length > 0 && (
            <div className="text-xs text-muted-foreground">
              {p.frontendFiles.length} files · {p.frontendFiles.filter((f) => !f.isBinary).length} text · {p.importSkipped} ignored
              <span className="ml-2"><Badge variant="info">{p.source}</Badge></span>
            </div>
          )}
          <div className="max-h-[380px] overflow-auto rounded-md border border-border p-1">
            {p.tree ? <FileTree node={p.tree} selected={preview} onSelect={setPreview} /> : <p className="p-3 text-xs text-muted-foreground">No files yet.</p>}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="font-mono text-sm truncate">{preview || 'File preview'}</CardTitle>
          <CardDescription>Original frontend code — never modified in place. Integration proposes diffs later.</CardDescription>
        </CardHeader>
        <CardContent>
          {sel ? <SimpleCode code={sel.content.slice(0, 12000)} height="520px" /> : <p className="text-sm text-muted-foreground">Select a file on the left to preview.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

export function StepAnalyze() {
  const p = usePipeline();
  const [busy, setBusy] = useState(false);

  function run() {
    if (p.frontendFiles.length === 0) {
      toast({ title: 'Nothing to analyze', description: 'Import a frontend first.', variant: 'error' });
      return;
    }
    setBusy(true);
    // setTimeout keeps UI responsive for large frontends
    setTimeout(() => {
      try {
        const a = analyzeFrontend(p.frontendFiles, p.projectName);
        p.setAnalysis(a);
        const req = inferRequirements(a, p.projectName);
        p.setRequirements(req);
        p.markDone(3);
        toast({ title: 'Analysis complete', description: `${a.entities.length} entities, ${a.forms.length} forms, ${a.apiCalls.length} API calls.`, variant: 'success' });
      } catch (e) {
        toast({ title: 'Analysis failed', description: String(e), variant: 'error' });
      } finally {
        setBusy(false);
      }
    }, 30);
  }

  const a = p.analysis;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 3 — Analyze (deterministic static analysis)</CardTitle>
        <CardDescription>No LLM guessing: regex + structural scans over routes, forms, fetch/axios, storage, mocks. Every finding cites file:line evidence.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Button onClick={run} loading={busy}><Play className="h-4 w-4 mr-1" /> {a ? 'Re-run analysis' : 'Run analysis'}</Button>
          {a && <Button variant="outline" onClick={() => { p.markDone(3); p.next(); }}>Continue to Findings</Button>}
        </div>
        {!a && <p className="text-sm text-muted-foreground flex items-center gap-2"><FolderGit className="h-4 w-4" /> Run analysis to populate findings, requirements, and entity candidates.</p>}
        {a && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 text-center">
            {[
              ['Framework', a.framework],
              ['Files', String(a.filesAnalyzed)],
              ['Routes', String(a.routes.length)],
              ['Forms', String(a.forms.length)],
              ['API calls', String(a.apiCalls.length)],
              ['Entities', String(a.entities.length)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-md border border-border p-3">
                <div className="text-lg font-bold">{v}</div>
                <div className="text-xs text-muted-foreground">{k}</div>
              </div>
            ))}
          </div>
        )}
        {a && a.warnings.length > 0 && (
          <div className="rounded-md border border-yellow-500/40 p-3 text-sm flex gap-2">
            <FileWarning className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
            <ul className="list-disc ml-4 text-muted-foreground">
              {a.warnings.slice(0, 6).map((w, i) => <li key={i}>{w.message}</li>)}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function StepFindings() {
  const p = usePipeline();
  const a = p.analysis;
  if (!a) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Run analysis first (Step 3).</CardContent></Card>;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Step 4 — Review Findings (evidence-backed)</CardTitle>
          <CardDescription>Green = CERTAIN/HIGH (safe to generate). Yellow/red = AMBIGUOUS/UNKNOWN — these become explicit decisions in Step 5, never silent assumptions.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => p.back()}>Back</Button>
            <Button onClick={() => { p.markDone(4); p.next(); }}>Continue to Requirements</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Entities ({a.entities.length})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {a.entities.map((e) => {
              const tier = tierFor(e.confidence, e.evidence.length);
              return (
                <div key={e.id} className="rounded-md border border-border p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-sm">{e.name}</span>
                    <ConfidenceBadge tier={tier} confidence={e.confidence} />
                    <span className="text-xs text-muted-foreground ml-auto">{e.fields.length} fields · {e.source.join('+')}</span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground">fields: {e.fields.map((f) => f.name).join(', ')}</div>
                  <div className="mt-2"><EvidenceList items={e.evidence.map((x) => `${x.type}: ${x.description} [${x.source}]`)} /></div>
                </div>
              );
            })}
            {a.entities.length === 0 && <p className="text-sm text-muted-foreground">No entities — import a richer frontend or use manual mode.</p>}
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Forms ({a.forms.length}) · API calls ({a.apiCalls.length})</CardTitle></CardHeader>
            <CardContent className="space-y-2 max-h-[320px] overflow-auto">
              {a.forms.map((f) => (
                <div key={f.id} className="rounded border border-border p-2 text-xs">
                  <span className="font-mono font-bold">{f.name}</span> <span className="text-muted-foreground">{f.path} · {f.method} {f.apiEndpoint ?? ''}</span>
                  <div className="font-mono text-muted-foreground">[{f.fields.map((x) => `${x.name}:${x.type}${x.required ? '*' : ''}`).join(', ')}]</div>
                </div>
              ))}
              {a.apiCalls.slice(0, 12).map((c) => (
                <div key={c.id} className="rounded border border-border p-2 font-mono text-xs">
                  <Badge variant={c.isMock ? 'warning' : 'info'}>{c.method}</Badge> <span className="ml-1">{c.url}</span>
                  <span className="text-muted-foreground"> — {c.componentPath}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Auth · Storage · Uploads</CardTitle></CardHeader>
            <CardContent className="text-xs space-y-1">
              <div>Auth flows: {a.authFlows.length ? a.authFlows.map((x) => x.type).join(', ') : 'none detected'}</div>
              <div>Storage: {a.storageUsage.length ? a.storageUsage.slice(0, 5).map((s) => `${s.type}:${s.key} (${s.purpose})`).join(' · ') : 'none'}</div>
              <div>Uploads: {a.uploads.length ? a.uploads.map((u) => `${u.componentPath}#${u.fieldName}`).join(' · ') : 'none'}</div>
              <div>CRUD: {a.crudOperations.filter((c) => c.detected).length}/{a.crudOperations.length} operations evidenced</div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
