import { useState } from 'react';
import { usePipeline } from '@/store/pipelineStore';
import { applyRequirementDecisions, tierFor } from '@/inference/requirements';
import { requirementsToSchema, schemaToBuilderState } from '@/database/schemaBuilder';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfidenceBadge, EvidenceList } from '@/components/pipeline/ConfidenceBadge';
import { autoEndpoints, sanitizeTableName, uid } from '@/lib/builder';
import type { DatabaseColumnType, HttpMethod } from '@/shared/types';
import { Plus, Trash2, RefreshCw, ChevronRight, Shield, ShieldOff, ShieldCheck, HelpCircle, Check, KeyRound } from 'lucide-react';
import { toast } from '@/components/ui/toaster';

export function StepRequirements() {
  const p = usePipeline();
  const req = p.requirements;
  if (!req) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Run analysis first.</CardContent></Card>;

  const unresolved = req.ambiguities.filter((a) => !p.resolvedAmbiguities[a.id]);

  const [authChoice, setAuthChoice] = useState<'none' | 'add' | 'existing' | 'help'>(
    p.authEnabled ? 'add' : 'none'
  );
  const [features, setFeatures] = useState({
    registration: req.authentication.register ?? true,
    refreshTokenRotation: req.authentication.refresh ?? true,
    roles: req.authentication.roles?.length ? true : true,
    passwordReset: req.authentication.forgotPassword ?? false,
    generateFrontend: req.authentication.generateFrontend ?? true,
  });

  const authConfidence = Math.round(req.authentication.confidence * 100);
  const detectedSignals = req.authentication.evidence ?? [];
  const recommendation =
    req.authentication.confidence >= 0.7
      ? 'add'
      : req.authentication.confidence >= 0.3
      ? 'ambiguous'
      : 'none';

  function handleAuthChoice(choice: 'none' | 'add' | 'existing' | 'help') {
    setAuthChoice(choice);
    if (choice === 'none') {
      p.setAuthEnabled(false);
    } else if (choice === 'add' || choice === 'existing') {
      p.setAuthEnabled(true);
    }
  }

  function approveAndContinue() {
    const current = p.requirements;
    if (!current) return;
    if (unresolved.length > 0) {
      toast({ title: `${unresolved.length} ambiguities unresolved`, description: 'Choose an option for each — nothing is assumed.', variant: 'error' });
      return;
    }
    if (p.enabledTables.length === 0) {
      toast({ title: 'Enable at least one table', variant: 'error' });
      return;
    }

    const effectiveAuthEnabled = authChoice === 'none' ? false : authChoice === 'help' ? recommendation === 'add' : p.authEnabled;
    const effectiveStrategy = effectiveAuthEnabled ? (authChoice === 'existing' ? 'existing' : 'jwt') : 'none';
    const effectiveDecision = authChoice === 'help' ? (recommendation === 'add' ? 'add' : 'none') : authChoice;

    const decided = applyRequirementDecisions(current, {
      enabledTables: new Set(p.enabledTables),
      enabledEndpoints: new Set(p.enabledEndpoints),
      resolvedAmbiguities: p.resolvedAmbiguities,
      authEnabled: effectiveAuthEnabled,
      authStrategy: effectiveStrategy,
      userDecision: effectiveDecision,
      generateFrontend: features.generateFrontend,
    });
    p.setRequirements(decided);
    const schema = requirementsToSchema(
      { ...decided, database: { tables: decided.database.tables, relationships: decided.database.relationships } },
      p.projectName
    );
    p.setSchema(schema);
    const builder = schemaToBuilderState(schema, decided, p.projectName);
    builder.auth.register = features.registration;
    builder.auth.refresh = features.refreshTokenRotation;
    builder.auth.forgotPassword = features.passwordReset;
    builder.auth.resetPassword = features.passwordReset;
    builder.auth.generateFrontend = features.generateFrontend;
    p.setBuilder(builder);
    p.markDone(5);
    p.next();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Step 5 — Review Requirements (you stay in control)</CardTitle>
          <CardDescription>
            CERTAIN/HIGH can be generated directly. AMBIGUOUS/UNKNOWN require an explicit choice below.
            Business logic is never invented — it appears as a decision, not as code.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Auth Mode:</span>
            <Badge variant={authChoice === 'none' ? 'neutral' : 'success'}>
              {authChoice === 'none' ? 'No Auth (Public API)' : authChoice === 'existing' ? 'Existing Auth' : 'Complete Auth (JWT + Tokens)'}
            </Badge>
            {unresolved.length > 0 && <Badge variant="warning">{unresolved.length} decisions pending</Badge>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => p.back()}>Back</Button>
            <Button onClick={approveAndContinue}>Approve & design database <ChevronRight className="h-4 w-4 ml-1" /></Button>
          </div>
        </CardContent>
      </Card>

      {/* Dedicated Authentication Decision UI (Master Prompt Requirement) */}
      <Card className="border-primary/30">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Authentication Architecture Decision
              </CardTitle>
              <CardDescription className="mt-1">
                Authentication is never assumed. Choose whether to keep this API public or generate a complete authentication system.
              </CardDescription>
            </div>
            <div className="text-right">
              <span className="text-xs text-muted-foreground block">Detection Confidence</span>
              <Badge variant={authConfidence >= 70 ? 'success' : authConfidence >= 30 ? 'warning' : 'neutral'}>
                {authConfidence}% confident
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 4 Decision Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {/* 1. No Auth */}
            <div
              onClick={() => handleAuthChoice('none')}
              className={`p-3 rounded-lg border cursor-pointer transition-all ${
                authChoice === 'none'
                  ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5 font-medium text-sm">
                  <ShieldOff className="h-4 w-4 text-muted-foreground" />
                  No Auth
                </div>
                {authChoice === 'none' && <Check className="h-4 w-4 text-primary" />}
              </div>
              <p className="text-xs text-muted-foreground">
                Keep API fully public. Zero auth code, no /auth routes, no users table required.
              </p>
            </div>

            {/* 2. Add Auth */}
            <div
              onClick={() => handleAuthChoice('add')}
              className={`p-3 rounded-lg border cursor-pointer transition-all ${
                authChoice === 'add'
                  ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5 font-medium text-sm">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Add Auth
                </div>
                {authChoice === 'add' && <Check className="h-4 w-4 text-primary" />}
              </div>
              <p className="text-xs text-muted-foreground">
                Complete auth: JWT, refresh tokens, register, login, me, logout, users table.
              </p>
            </div>

            {/* 3. Use Existing Auth */}
            <div
              onClick={() => handleAuthChoice('existing')}
              className={`p-3 rounded-lg border cursor-pointer transition-all ${
                authChoice === 'existing'
                  ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5 font-medium text-sm">
                  <KeyRound className="h-4 w-4 text-blue-500" />
                  Use Existing Auth
                </div>
                {authChoice === 'existing' && <Check className="h-4 w-4 text-primary" />}
              </div>
              <p className="text-xs text-muted-foreground">
                Frontend uses Supabase / Firebase / Auth0. Backend validates existing tokens.
              </p>
            </div>

            {/* 4. Help Me Decide */}
            <div
              onClick={() => handleAuthChoice('help')}
              className={`p-3 rounded-lg border cursor-pointer transition-all ${
                authChoice === 'help'
                  ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5 font-medium text-sm">
                  <HelpCircle className="h-4 w-4 text-yellow-500" />
                  Help Me Decide
                </div>
                {authChoice === 'help' && <Check className="h-4 w-4 text-primary" />}
              </div>
              <p className="text-xs text-muted-foreground">
                Inspect frontend signals (login forms, storage keys, headers) for recommendation.
              </p>
            </div>
          </div>

          {/* Help Me Decide Details Box */}
          {authChoice === 'help' && (
            <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 space-y-2 text-xs">
              <div className="font-semibold text-yellow-600 dark:text-yellow-400">
                Frontend Static Analysis Signals:
              </div>
              {detectedSignals.length > 0 ? (
                <ul className="list-disc ml-4 space-y-1 text-muted-foreground">
                  {detectedSignals.map((ev, i) => (
                    <li key={i}>{ev}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">No explicit login forms or auth tokens detected in frontend files.</p>
              )}
              <div className="pt-2 border-t border-border flex items-center justify-between">
                <span>
                  <strong>Recommendation:</strong>{' '}
                  {recommendation === 'add'
                    ? 'High confidence auth signals found. [Add Auth] is recommended.'
                    : recommendation === 'ambiguous'
                    ? 'Partial auth signals found. Choose [Add Auth] if user accounts are desired.'
                    : 'No auth signals found. [No Auth] (public API) is recommended.'}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => handleAuthChoice('none')}>Select No Auth</Button>
                  <Button size="sm" onClick={() => handleAuthChoice('add')}>Select Add Auth</Button>
                </div>
              </div>
            </div>
          )}

          {/* Feature Toggles when Auth is Enabled */}
          {(authChoice === 'add' || authChoice === 'existing') && (
            <div className="pt-3 border-t border-border space-y-2">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Authentication Features & Capabilities:
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={features.registration}
                    onChange={(e) => setFeatures({ ...features, registration: e.target.checked })}
                  />
                  User Registration
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={features.refreshTokenRotation}
                    onChange={(e) => setFeatures({ ...features, refreshTokenRotation: e.target.checked })}
                  />
                  Refresh Token Rotation
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={features.roles}
                    onChange={(e) => setFeatures({ ...features, roles: e.target.checked })}
                  />
                  Role-Based Access (RBAC)
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={features.passwordReset}
                    onChange={(e) => setFeatures({ ...features, passwordReset: e.target.checked })}
                  />
                  Password Reset Flow
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={features.generateFrontend}
                    onChange={(e) => setFeatures({ ...features, generateFrontend: e.target.checked })}
                  />
                  Frontend Auth Scaffolding
                </label>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Tables ({req.database.tables.length}) — toggle what to build</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {req.database.tables.map((t) => {
              const tier = tierFor(t.confidence, t.evidence.length);
              const on = p.enabledTables.includes(t.id);
              return (
                <div key={t.id} className="rounded-md border border-border p-3">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={on} onChange={(e) => {
                      p.setEnabledTables(e.target.checked ? [...p.enabledTables, t.id] : p.enabledTables.filter((x) => x !== t.id));
                    }} />
                    <span className="font-mono font-bold text-sm">{t.name}</span>
                    <ConfidenceBadge tier={tier} confidence={t.confidence} />
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground">{t.columns.map((c) => c.name).join(', ')}</div>
                  <EvidenceList items={t.evidence} />
                </div>
              );
            })}
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Endpoints ({req.api.endpoints.length})</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 max-h-[300px] overflow-auto">
              {req.api.endpoints.map((e) => {
                const tier = tierFor(e.confidence, e.evidence.length);
                const on = p.enabledEndpoints.includes(e.id);
                return (
                  <div key={e.id} className="flex items-center gap-2 rounded border border-border p-2 text-xs">
                    <input type="checkbox" checked={on} onChange={(ev) => {
                      p.setEnabledEndpoints(ev.target.checked ? [...p.enabledEndpoints, e.id] : p.enabledEndpoints.filter((x) => x !== e.id));
                    }} />
                    <Badge variant="info">{e.method}</Badge>
                    <span className="font-mono truncate">{e.path}</span>
                    <span className="ml-auto"><ConfidenceBadge tier={tier} /></span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Decisions required ({req.ambiguities.length})</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {req.ambiguities.map((a) => (
                <div key={a.id} className="rounded-md border border-yellow-500/40 p-3">
                  <div className="font-medium text-sm">{a.title}</div>
                  <p className="text-xs text-muted-foreground mt-0.5">{a.description}</p>
                  <div className="mt-2 space-y-1">
                    {a.options.map((o) => (
                      <label key={o.id} className="flex items-start gap-2 rounded border border-border p-2 text-xs hover:bg-accent cursor-pointer">
                        <input
                          type="radio"
                          name={a.id}
                          checked={p.resolvedAmbiguities[a.id] === o.id}
                          onChange={() => p.setAmbiguity(a.id, o.id)}
                          className="mt-0.5"
                        />
                        <span><span className="font-medium">{o.label}</span> — {o.description}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              {req.ambiguities.length === 0 && <p className="text-xs text-muted-foreground">No ambiguities — all findings are CERTAIN/HIGH.</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

const COLUMN_TYPES: DatabaseColumnType[] = [
  'bigint', 'int', 'smallint', 'tinyint', 'decimal', 'float', 'double',
  'varchar', 'text', 'longtext', 'datetime', 'timestamp', 'date', 'time',
  'json', 'boolean', 'uuid', 'enum',
];

export function StepDatabase() {
  const p = usePipeline();
  const b = p.builder;
  if (!b) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Approve requirements first (Step 5).</CardContent></Card>;

  const updateTable = (id: string, patch: Partial<(typeof b.tables)[number]>) => {
    p.setBuilder({ ...b, tables: b.tables.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Step 6 — Design Database (editable, derived from approved requirements)</CardTitle>
          <CardDescription>Every column traces back to frontend evidence. Edit freely — validation runs before generation.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button variant="outline" onClick={() => p.back()}>Back</Button>
          <Button variant="outline" onClick={() => {
            const n = b.tables.length + 1;
            p.setBuilder({ ...b, tables: [...b.tables, { id: uid('t'), name: `table_${n}`, comment: '', timestamps: true, softDeletes: false, columns: [{ id: uid('c'), name: 'id', type: 'bigint', nullable: false, unique: false, defaultValue: '', isPrimaryKey: true, isAutoIncrement: true }] }] });
          }}><Plus className="h-4 w-4 mr-1" /> Add table</Button>
          <Button onClick={() => { p.markDone(6); p.next(); }}>Continue to API review</Button>
        </CardContent>
      </Card>
      {b.tables.map((t) => (
        <Card key={t.id}>
          <CardHeader>
            <div className="flex items-center gap-2 flex-wrap">
              <input value={t.name} onChange={(e) => updateTable(t.id, { name: sanitizeTableName(e.target.value) })} className="font-mono border rounded px-2 py-1 bg-background max-w-[220px]" />
              <input value={t.comment} onChange={(e) => updateTable(t.id, { comment: e.target.value })} placeholder="Description…" className="border rounded px-2 py-1 bg-background max-w-[300px] text-sm" />
              <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={t.timestamps} onChange={(e) => updateTable(t.id, { timestamps: e.target.checked })} /> timestamps</label>
              <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={t.softDeletes} onChange={(e) => updateTable(t.id, { softDeletes: e.target.checked })} /> soft deletes</label>
              <div className="ml-auto flex gap-2">
                <Button variant="destructive" size="sm" onClick={() => p.setBuilder({ ...b, tables: b.tables.filter((x) => x.id !== t.id) })}><Trash2 className="h-4 w-4" /></Button>
                <Button variant="outline" size="sm" onClick={() => {
                  const cols = [...t.columns, { id: uid('c'), name: 'field_' + (t.columns.length + 1), type: 'varchar' as const, nullable: true, unique: false, defaultValue: '', isPrimaryKey: false, isAutoIncrement: false }];
                  updateTable(t.id, { columns: cols });
                }}><Plus className="h-4 w-4 mr-1" /> Column</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Null</th><th className="px-3 py-2">Unique</th><th className="px-3 py-2">Default</th><th className="px-3 py-2">FK →</th><th className="px-3 py-2">PK/AI</th><th className="px-3 py-2"></th></tr>
                </thead>
                <tbody>
                  {t.columns.map((c) => (
                    <tr key={c.id} className="border-t border-border">
                      <td className="px-2 py-1"><input value={c.name} onChange={(e) => updateTable(t.id, { columns: t.columns.map((x) => (x.id === c.id ? { ...x, name: sanitizeTableName(e.target.value) } : x)) })} className="w-full bg-transparent font-mono border rounded px-2 py-1 border-transparent hover:border-border focus:border-primary" /></td>
                      <td className="px-2 py-1">
                        <select value={c.type} onChange={(e) => updateTable(t.id, { columns: t.columns.map((x) => (x.id === c.id ? { ...x, type: e.target.value as DatabaseColumnType } : x)) })} className="bg-background border border-border rounded px-2 py-1">
                          {COLUMN_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1 text-center"><input type="checkbox" checked={c.nullable} onChange={(e) => updateTable(t.id, { columns: t.columns.map((x) => (x.id === c.id ? { ...x, nullable: e.target.checked } : x)) })} /></td>
                      <td className="px-2 py-1 text-center"><input type="checkbox" checked={c.unique} onChange={(e) => updateTable(t.id, { columns: t.columns.map((x) => (x.id === c.id ? { ...x, unique: e.target.checked } : x)) })} /></td>
                      <td className="px-2 py-1"><input value={c.defaultValue} onChange={(e) => updateTable(t.id, { columns: t.columns.map((x) => (x.id === c.id ? { ...x, defaultValue: e.target.value } : x)) })} className="w-24 bg-transparent border rounded px-2 py-1 border-transparent hover:border-border focus:border-primary" /></td>
                      <td className="px-2 py-1">
                        <select value={c.foreignKey ? `${c.foreignKey.table}.${c.foreignKey.column}` : ''} onChange={(e) => {
                          const v = e.target.value;
                          const fk = !v ? undefined : (() => { const [table, column] = v.split('.'); return { table, column }; })();
                          updateTable(t.id, { columns: t.columns.map((x) => (x.id === c.id ? { ...x, foreignKey: fk } : x)) });
                        }} className="bg-background border border-border rounded px-1 py-1 max-w-[130px]">
                          <option value="">—</option>
                          {b.tables.flatMap((tt) => tt.columns.filter((x) => x.isPrimaryKey).map((x) => (
                            <option key={`${tt.name}.${x.name}`} value={`${tt.name}.${x.name}`}>{tt.name}.{x.name}</option>
                          )))}
                        </select>
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        <label className="text-xs mr-2"><input type="checkbox" checked={c.isPrimaryKey} onChange={(e) => updateTable(t.id, { columns: t.columns.map((x) => (x.id === c.id ? { ...x, isPrimaryKey: e.target.checked } : x)) })} /> PK</label>
                        <label className="text-xs"><input type="checkbox" checked={c.isAutoIncrement} onChange={(e) => updateTable(t.id, { columns: t.columns.map((x) => (x.id === c.id ? { ...x, isAutoIncrement: e.target.checked } : x)) })} /> AI</label>
                      </td>
                      <td className="px-2 py-1"><button onClick={() => updateTable(t.id, { columns: t.columns.filter((x) => x.id !== c.id) })} className="text-muted-foreground hover:text-red-500"><Trash2 className="h-4 w-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export function StepApi() {
  const p = usePipeline();
  const b = p.builder;
  if (!b) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Design the database first.</CardContent></Card>;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 7 — Review API</CardTitle>
        <CardDescription>Every route gets validation, pagination, and an OpenAPI entry. Auth defaults to required on mutations.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2 mb-3">
          <Button size="sm" variant="outline" onClick={() => { p.setBuilder({ ...b, endpoints: autoEndpoints(b.tables) }); toast({ title: 'CRUD regenerated', variant: 'success' }); }}><RefreshCw className="h-4 w-4 mr-1" /> Auto-CRUD</Button>
          <Button size="sm" variant="outline" onClick={() => p.setBuilder({ ...b, endpoints: [...b.endpoints, { id: uid('e'), method: 'GET', path: '/custom', handler: 'CustomController::handle', table: '', operation: 'custom', auth: 'required', description: 'Custom endpoint' }] })}><Plus className="h-4 w-4 mr-1" /> Custom endpoint</Button>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => p.back()}>Back</Button>
            <Button onClick={() => { p.markDone(7); p.next(); }}>Continue to Generate</Button>
          </div>
        </div>
        <div className="flex items-center gap-2 mb-2 text-sm">
          <Checkbox label="JWT auth" checked={b.auth.strategy !== 'none'} onChange={(e) => p.setBuilder({ ...b, auth: { ...b.auth, strategy: e.target.checked ? 'jwt' : 'none' } })} />
          <span className="text-muted-foreground">prefix <code className="font-mono">{b.config.apiPrefix}</code></span>
        </div>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-3 py-2">Method</th><th className="px-3 py-2">Path</th><th className="px-3 py-2">Handler</th><th className="px-3 py-2">Auth</th><th className="px-3 py-2">Description</th><th className="px-3 py-2"></th></tr>
            </thead>
            <tbody>
              {b.endpoints.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="px-2 py-1">
                    <select value={e.method} onChange={(e2) => p.setBuilder({ ...b, endpoints: b.endpoints.map((x) => (x.id === e.id ? { ...x, method: e2.target.value as HttpMethod } : x)) })} className="border border-border rounded px-2 py-1 bg-background font-mono font-bold">
                      {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1 min-w-[180px]"><input value={e.path} onChange={(e2) => p.setBuilder({ ...b, endpoints: b.endpoints.map((x) => (x.id === e.id ? { ...x, path: e2.target.value } : x)) })} className="w-full font-mono bg-transparent border rounded px-2 py-1 border-transparent hover:border-border focus:border-primary" /></td>
                  <td className="px-2 py-1 text-xs font-mono text-muted-foreground whitespace-nowrap">{e.handler}</td>
                  <td className="px-2 py-1">
                    <select value={e.auth} onChange={(e2) => p.setBuilder({ ...b, endpoints: b.endpoints.map((x) => (x.id === e.id ? { ...x, auth: e2.target.value as 'none' | 'required' | 'optional' } : x)) })} className="border border-border rounded px-2 py-1 bg-background">
                      <option value="required">required</option>
                      <option value="optional">optional</option>
                      <option value="none">none</option>
                    </select>
                  </td>
                  <td className="px-2 py-1 min-w-[160px]"><input value={e.description} onChange={(e2) => p.setBuilder({ ...b, endpoints: b.endpoints.map((x) => (x.id === e.id ? { ...x, description: e2.target.value } : x)) })} className="w-full bg-transparent border rounded px-2 py-1 border-transparent hover:border-border focus:border-primary" /></td>
                  <td className="px-2 py-1"><button onClick={() => p.setBuilder({ ...b, endpoints: b.endpoints.filter((x) => x.id !== e.id) })} className="text-muted-foreground hover:text-red-500"><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
