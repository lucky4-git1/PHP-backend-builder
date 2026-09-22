/**
 * IR Builder: AnalysisResult + BackendRequirements + BuilderState → ApplicationIR
 * + IR Validator. This is the canonical compilation step — generators MUST consume IR.
 */
import type { ApplicationIR, IRField, IRResource, IREndpoint, IRAuth, IREvidence } from './types';
import type { AnalysisResult, BackendRequirements } from '@/shared/types';
import type { BuilderState } from '@/lib/builder';

// Semantic type inference with confidence evidence (combines label, placeholder, input type, attrs)
export function inferSemanticType(rawName: string, label: string, inputType: string, attrs: string): { type: IRField['semanticType']; confidence: number; reason: string } {
  const n = rawName.toLowerCase();
  const ctx = `${rawName} ${label} ${attrs}`.toLowerCase();
  // email
  if (n.includes('email') || inputType === 'email') return { type: 'email', confidence: 0.97, reason: 'type=email or name contains email' };
  if (n.includes('password')) return { type: 'password', confidence: 0.98, reason: 'field name indicates password (hidden from responses)' };
  if (/^(message|description|body|content|bio|notes)$/i.test(n) || inputType === 'textarea' as unknown as string) {
    // textarea + semantic label => text
    return { type: 'text', confidence: 0.97, reason: 'multiline textarea + semantic label' };
  }
  if (/price|amount|cost|total|salary|budget/.test(n)) return { type: 'decimal', confidence: 0.92, reason: 'money semantic (price/amount/cost)' };
  if (/qty|quantity|count|stock|age|number/.test(n) && inputType === 'number') return { type: 'integer', confidence: 0.88, reason: 'count-like name + number input' };
  if (/is_|_enabled|_active|published|verified|enabled/.test(n) || inputType === 'checkbox') return { type: 'boolean', confidence: 0.9, reason: 'boolean semantic (is_/enabled/published or checkbox)' };
  if (/_at$/.test(n) || /created|updated|deleted_at/.test(n)) return { type: 'datetime', confidence: 0.95, reason: 'timestamp suffix _at' };
  if (ctx.includes('select') && ctx.includes('option')) return { type: 'enum', confidence: 0.7, reason: 'select with options — enum candidate' };
  // fallthrough
  if (inputType === 'number') return { type: 'integer', confidence: 0.6, reason: 'number input without money semantics' };
  if (inputType === 'date') return { type: 'date', confidence: 0.9, reason: 'date input' };
  if (inputType === 'datetime-local') return { type: 'datetime', confidence: 0.92, reason: 'datetime-local input' };
  return { type: 'string', confidence: 0.65, reason: 'default string (no strong signal)' };
}

export function storageTypeFor(semantic: IRField['semanticType']): string {
  switch (semantic) {
    case 'email': return 'varchar';
    case 'password': return 'varchar';
    case 'string': return 'varchar';
    case 'text': return 'text';
    case 'longtext': return 'longtext';
    case 'integer': return 'int';
    case 'bigint': return 'bigint';
    case 'smallint': return 'smallint';
    case 'decimal': return 'decimal';
    case 'float': return 'float';
    case 'boolean': return 'boolean';
    case 'datetime': return 'datetime';
    case 'timestamp': return 'timestamp';
    case 'date': return 'date';
    case 'time': return 'time';
    case 'json': return 'json';
    case 'enum': return 'enum';
    case 'uuid': return 'uuid';
    default: return 'varchar';
  }
}

export function buildIRFromAnalysis(analysis: AnalysisResult, projectName: string): ApplicationIR {
  const resources: IRResource[] = analysis.entities.map((e) => ({
    name: e.name,
    singular: e.singularName,
    fields: e.fields.map((f) => {
      const sem = inferSemanticType(f.name, f.description ?? '', f.type as unknown as string, f.name);
      // correct historic bug: "contactmessage" TEXT not INT
      const isMessageLike = /message|description|body|content/.test(f.name.toLowerCase());
      const resolvedSem = isMessageLike && (sem.type === 'integer' || sem.type === 'string') ? 'text' as const : sem.type;
      return {
        name: f.name,
        semanticType: resolvedSem,
        storageType: storageTypeFor(resolvedSem),
        required: f.required,
        unique: f.unique,
        nullable: !f.required && !f.primaryKey,
        validation: f.validation?.map((v) => v.type) ?? [],
        confidence: e.confidence,
        confidenceReason: sem.reason,
        evidence: e.evidence.map((ev) => ({ source: ev.source, kind: ev.type as unknown as IREvidence['kind'], excerpt: ev.description })),
        isSensitive: f.name.toLowerCase() === 'password' || f.name.toLowerCase().includes('secret') || f.name.toLowerCase().includes('token'),
      };
    }),
    relationships: e.relationships.map((r) => ({
      fromResource: e.name,
      toResource: r.targetEntity,
      type: r.type === 'many-to-one' ? 'belongsTo' as const : r.type === 'one-to-many' ? 'hasMany' as const : 'hasOne' as const,
      fromField: r.sourceField,
      toField: r.targetField,
    })),
    indexes: [],
    uniqueConstraints: e.fields.filter((f) => f.unique).map((f) => [f.name]),
    searchFields: e.fields.filter((f) => !['password', 'key_hash'].includes(f.name)).slice(0, 4).map((f) => f.name),
    sortableFields: e.fields.filter((f) => ['created_at', 'name', 'title', 'id'].includes(f.name)).map((f) => f.name),
    filterableFields: e.fields.slice(0, 3).map((f) => f.name),
    hasTimestamps: true,
    hasSoftDeletes: false,
    confidence: e.confidence,
    evidence: e.evidence.map((ev) => ({ source: ev.source, kind: ev.type as unknown as IREvidence['kind'], excerpt: ev.description })),
  }));

  const hasLoginForm = analysis.authFlows.some((a) => a.type === 'login');
  const hasRegisterForm = analysis.authFlows.some((a) => a.type === 'register');
  const hasLogout = analysis.authFlows.some((a) => a.type === 'logout');
  const detectionConfidence = analysis.authDetection?.confidence ?? (analysis.authFlows.length > 0 ? 0.85 : 0.2);
  const isDetected = detectionConfidence >= 0.8 && (hasLoginForm || hasRegisterForm);

  const auth: IRAuth = {
    enabled: isDetected,
    strategy: isDetected ? 'jwt' : 'none',
    methods: isDetected ? ['jwt'] : [],
    userResource: isDetected ? 'users' : null,
    features: {
      register: hasRegisterForm,
      login: hasLoginForm,
      logout: hasLogout || isDetected,
      refresh: isDetected,
      me: isDetected,
      forgotPassword: false,
      resetPassword: false,
      emailVerification: false,
    },
    frontend: {
      generate: isDetected,
      protectedRoutes: isDetected,
      authState: isDetected,
    },
    protectedResources: isDetected ? resources.map((r) => r.name) : [],
    roles: ['admin', 'user'],
    permissions: resources.flatMap((r) => [`${r.name}.read`, `${r.name}.write`, `${r.name}.delete`]),
    register: hasRegisterForm,
    login: hasLoginForm,
    logout: hasLogout || isDetected,
    refresh: isDetected,
    emailVerification: false,
    passwordReset: false,
    confidence: detectionConfidence,
    detectionStatus: isDetected ? 'detected' : analysis.authFlows.length > 0 ? 'ambiguous' : 'not_detected',
    evidence: analysis.authFlows.map((a) => ({ source: a.componentPath || a.component, kind: 'js' as const, excerpt: a.type })),
    userDecision: isDetected ? 'add' : 'none',
  };

  const endpoints: IREndpoint[] = analysis.crudOperations.filter((c) => c.detected).map((c) => ({
    method: (c.operation === 'list' || c.operation === 'read' ? 'GET' : c.operation === 'create' ? 'POST' : c.operation === 'update' ? 'PUT' : 'DELETE') as IREndpoint['method'],
    path: c.operation === 'list' || c.operation === 'create' ? `/${c.entity}` : `/${c.entity}/{id}`,
    resource: c.entity,
    operation: c.operation,
    auth: isDetected ? 'required' : 'none',
    validation: [],
    pagination: c.operation === 'list',
    search: c.operation === 'list',
    filtering: c.operation === 'list',
    sorting: c.operation === 'list',
    confidence: c.confidence,
    evidence: c.evidence.map((e) => ({ source: e, kind: 'api_call' as const, excerpt: e })),
  }));

  return {
    version: '1.0.0',
    project: {
      name: projectName,
      version: '1.0.0',
      frontendType: analysis.framework,
      apiVersion: 'v1',
      apiPrefix: '/api/v1',
      database: 'mysql',
    },
    resources,
    relationships: resources.flatMap((r) => r.relationships),
    auth,
    api: { version: 'v1', prefix: '/api/v1', endpoints },
    generatedAt: new Date().toISOString(),
    analyzerVersion: '1.0.0',
  };
}

export function buildIRFromRequirements(req: BackendRequirements, projectName: string, frontendType = 'react'): ApplicationIR {
  return {
    version: '1.0.0',
    project: { name: projectName, version: '1.0.0', frontendType, apiVersion: 'v1', apiPrefix: req.api.basePath, database: 'mysql' },
    resources: req.database.tables.map((t) => ({
      name: t.name,
      singular: t.entityName.replace(/s$/, ''),
      fields: t.columns.map((c) => ({
        name: c.name,
        semanticType: (c.type === 'boolean' ? 'boolean' : c.type === 'decimal' ? 'decimal' : c.type === 'bigint' ? 'bigint' : c.type === 'text' ? 'text' : 'string') as IRField['semanticType'],
        storageType: c.type,
        required: !c.nullable && !c.primaryKey,
        unique: c.unique,
        nullable: c.nullable,
        defaultValue: c.defaultValue,
        validation: c.validation?.map((v) => v.type) ?? [],
        confidence: c.confidence,
        confidenceReason: c.evidence[0] ?? 'requirements inference',
        evidence: c.evidence.map((e) => ({ source: e, kind: 'js' as const, excerpt: e })),
        isSensitive: c.name === 'password',
      })),
      relationships: t.columns.filter((c) => c.foreignKey).map((c) => ({
        fromResource: t.name,
        toResource: c.foreignKey!.referencedTable,
        type: 'belongsTo' as const,
        fromField: c.name,
        toField: c.foreignKey!.referencedColumn,
      })),
      indexes: t.indexes.map((i) => ({ columns: i.columns, unique: i.unique, name: i.name })),
      uniqueConstraints: [],
      searchFields: t.columns.filter((c) => c.name !== 'password').slice(0, 3).map((c) => c.name),
      sortableFields: ['id', 'created_at'],
      filterableFields: t.columns.slice(0, 2).map((c) => c.name),
      hasTimestamps: true,
      hasSoftDeletes: false,
      confidence: t.confidence,
      evidence: t.evidence.map((e) => ({ source: e, kind: 'js' as const, excerpt: e })),
    })),
    relationships: req.database.relationships.map((r) => ({
      fromResource: r.sourceTable,
      toResource: r.targetTable,
      type: r.type === 'many-to-one' ? 'belongsTo' as const : 'hasMany' as const,
      fromField: r.sourceColumn,
      toField: r.targetColumn,
    })),
    auth: {
      enabled: req.authentication.enabled,
      strategy: req.authentication.strategy ?? (req.authentication.enabled ? 'jwt' : 'none'),
      methods: req.authentication.enabled ? [req.authentication.tokenType === 'jwt' ? 'jwt' as const : 'session' as const] : [],
      userResource: req.authentication.enabled ? 'users' : null,
      features: {
        register: req.authentication.register,
        login: req.authentication.login,
        logout: req.authentication.logout ?? req.authentication.enabled,
        refresh: req.authentication.refresh ?? req.authentication.enabled,
        me: req.authentication.me ?? req.authentication.enabled,
        forgotPassword: req.authentication.forgotPassword,
        resetPassword: req.authentication.resetPassword,
        emailVerification: req.authentication.emailVerification ?? false,
      },
      frontend: {
        generate: req.authentication.generateFrontend ?? req.authentication.enabled,
        protectedRoutes: req.authentication.enabled,
        authState: req.authentication.enabled,
      },
      protectedResources: req.authentication.enabled ? req.database.tables.map((t) => t.name) : [],
      roles: req.authentication.roles.length ? req.authentication.roles : ['admin', 'user'],
      permissions: req.authentication.permissions ?? [],
      register: req.authentication.register,
      login: req.authentication.login,
      logout: req.authentication.logout ?? req.authentication.enabled,
      refresh: req.authentication.refresh ?? req.authentication.enabled,
      emailVerification: req.authentication.emailVerification ?? false,
      passwordReset: req.authentication.resetPassword,
      confidence: req.authentication.confidence,
      detectionStatus: req.authentication.detectionStatus ?? (req.authentication.enabled ? 'detected' : 'not_detected'),
      evidence: req.authentication.evidence.map((e) => ({ source: e, kind: 'js' as const, excerpt: e })),
      userDecision: req.authentication.userDecision ?? (req.authentication.enabled ? 'add' : 'none'),
    },
    api: {
      version: 'v1',
      prefix: req.api.basePath,
      endpoints: req.api.endpoints.map((e) => ({
        method: e.method as IREndpoint['method'],
        path: e.path,
        resource: e.entity,
        operation: e.operation as IREndpoint['operation'],
        auth: e.authentication,
        validation: [],
        pagination: e.operation === 'list',
        search: false,
        filtering: false,
        sorting: false,
        confidence: e.confidence,
        evidence: e.evidence.map((x) => ({ source: x, kind: 'api_call' as const, excerpt: x })),
      })),
    },
    generatedAt: new Date().toISOString(),
    analyzerVersion: '1.0.0',
  };
}

export function buildIRFromBuilder(state: BuilderState): ApplicationIR {
  const isAuthEnabled = state.auth.strategy !== 'none';
  return {
    version: '1.0.0',
    project: {
      name: state.config.projectName,
      version: '1.0.0',
      frontendType: 'react',
      apiVersion: 'v1',
      apiPrefix: state.config.apiPrefix,
      database: 'mysql',
    },
    resources: state.tables.map((t) => ({
      name: t.name,
      singular: t.name.replace(/s$/, ''),
      fields: t.columns.map((c) => ({
        name: c.name,
        semanticType: (c.type === 'boolean' ? 'boolean' : c.type as unknown as IRField['semanticType']) ?? 'string',
        storageType: c.type,
        required: !c.nullable && !c.isPrimaryKey,
        unique: c.unique,
        nullable: c.nullable,
        defaultValue: c.defaultValue || undefined,
        validation: [],
        confidence: 0.95,
        confidenceReason: 'builder designer — user edited',
        evidence: [{ source: 'builder', kind: 'js', excerpt: `table ${t.name}` }],
        isSensitive: c.name === 'password',
      })),
      relationships: t.columns.filter((c) => c.foreignKey).map((c) => ({
        fromResource: t.name,
        toResource: c.foreignKey!.table,
        type: 'belongsTo' as const,
        fromField: c.name,
        toField: c.foreignKey!.column,
      })),
      indexes: [],
      uniqueConstraints: [],
      searchFields: t.columns.filter((c) => c.name !== 'password').slice(0, 3).map((c) => c.name),
      sortableFields: ['id', 'created_at'],
      filterableFields: [],
      hasTimestamps: t.timestamps,
      hasSoftDeletes: t.softDeletes,
      confidence: 1,
      evidence: [],
    })),
    relationships: state.tables.flatMap((t) => t.columns.filter((c) => c.foreignKey).map((c) => ({
      fromResource: t.name,
      toResource: c.foreignKey!.table,
      type: 'belongsTo' as const,
      fromField: c.name,
      toField: c.foreignKey!.column,
    }))),
    auth: {
      enabled: isAuthEnabled,
      strategy: state.auth.strategy,
      methods: isAuthEnabled ? [state.auth.strategy === 'jwt' ? 'jwt' as const : 'session' as const] : [],
      userResource: isAuthEnabled ? 'users' : null,
      features: {
        register: state.auth.register,
        login: state.auth.login,
        logout: state.auth.logout ?? isAuthEnabled,
        refresh: state.auth.refresh ?? isAuthEnabled,
        me: state.auth.me ?? isAuthEnabled,
        forgotPassword: state.auth.forgotPassword ?? false,
        resetPassword: state.auth.resetPassword ?? false,
        emailVerification: state.auth.emailVerification ?? false,
      },
      frontend: {
        generate: state.auth.generateFrontend ?? isAuthEnabled,
        protectedRoutes: state.auth.protectedRoutes ?? isAuthEnabled,
        authState: isAuthEnabled,
      },
      protectedResources: isAuthEnabled ? state.tables.map((t) => t.name) : [],
      roles: state.auth.roles,
      permissions: state.auth.permissions ?? [],
      register: state.auth.register,
      login: state.auth.login,
      logout: state.auth.logout ?? isAuthEnabled,
      refresh: state.auth.refresh ?? isAuthEnabled,
      emailVerification: state.auth.emailVerification ?? false,
      passwordReset: state.auth.resetPassword ?? false,
      confidence: 1,
      detectionStatus: isAuthEnabled ? 'detected' : 'not_detected',
      evidence: [],
      userDecision: state.auth.userDecision ?? (isAuthEnabled ? 'add' : 'none'),
    },
    api: {
      version: 'v1',
      prefix: state.config.apiPrefix,
      endpoints: state.endpoints.map((e) => ({
        method: e.method as IREndpoint['method'],
        path: e.path,
        resource: e.table,
        operation: e.operation,
        auth: e.auth,
        validation: [],
        pagination: e.operation === 'list',
        search: false,
        filtering: false,
        sorting: false,
        confidence: 1,
        evidence: [],
      })),
    },
    generatedAt: new Date().toISOString(),
    analyzerVersion: '1.0.0',
  };
}

/** Schema/IR validator — blocks generation on critical issues */
export function validateIR(ir: ApplicationIR): Array<{ level: 'error' | 'warning' | 'info'; code: string; message: string }> {
  const out: Array<{ level: 'error' | 'warning' | 'info'; code: string; message: string }> = [];
  if (ir.resources.length === 0) out.push({ level: 'error', code: 'IR_EMPTY', message: 'IR has no resources — add at least one table.' });
  const names = new Set<string>();
  for (const r of ir.resources) {
    if (!r.name) out.push({ level: 'error', code: 'IR_TABLE_NAME', message: 'Resource without name.' });
    if (names.has(r.name)) out.push({ level: 'error', code: 'IR_DUP_TABLE', message: `Duplicate resource: ${r.name}` });
    names.add(r.name);
    const fields = new Set<string>();
    for (const f of r.fields) {
      if (!f.name) out.push({ level: 'error', code: 'IR_FIELD_NAME', message: `Resource ${r.name} has field without name.` });
      if (fields.has(f.name)) out.push({ level: 'error', code: 'IR_DUP_FIELD', message: `Duplicate field ${r.name}.${f.name}` });
      fields.add(f.name);
      // critical type check: text fields must not be INT (substring, so your_message counts)
      if (/message|description|body|content|bio|notes|excerpt/i.test(f.name) && ['integer', 'bigint', 'int'].includes(f.storageType)) {
        out.push({ level: 'error', code: 'IR_FIELD_TYPE', message: `${r.name}.${f.name} looks like text but storageType is ${f.storageType} — must be TEXT` });
      }
    }
    if (!r.fields.some((f) => f.name === 'id')) out.push({ level: 'warning', code: 'IR_NO_PK', message: `Resource ${r.name} has no id field — surrogate PK will be added.` });
    for (const rel of r.relationships) {
      if (!names.has(rel.toResource) && !ir.resources.some((x) => x.name === rel.toResource)) {
        // allow forward refs during build, but warn
        out.push({ level: 'warning', code: 'IR_FK_UNKNOWN', message: `${r.name}.${rel.fromField} → unknown ${rel.toResource}` });
      }
    }
  }

  // FK Cycle detection in IR
  const adj = new Map<string, string[]>();
  for (const r of ir.resources) {
    adj.set(r.name, r.relationships.filter((rel) => rel.toResource !== r.name).map((rel) => rel.toResource));
  }
  const visited = new Set<string>();
  const recStack = new Set<string>();
  let hasCycle = false;
  const cycleNodes: string[] = [];

  function isCyclic(node: string): boolean {
    visited.add(node);
    recStack.add(node);
    const neighbors = adj.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (isCyclic(neighbor)) {
          cycleNodes.push(neighbor);
          return true;
        }
      } else if (recStack.has(neighbor)) {
        cycleNodes.push(neighbor);
        return true;
      }
    }
    recStack.delete(node);
    return false;
  }

  for (const r of ir.resources) {
    if (!visited.has(r.name)) {
      if (isCyclic(r.name)) {
        hasCycle = true;
        cycleNodes.push(r.name);
        break;
      }
    }
  }

  if (hasCycle) {
    out.push({
      level: 'error',
      code: 'IR_FK_CYCLE',
      message: `Circular foreign key relationship detected: ${cycleNodes.reverse().join(' -> ')}`,
    });
  }

  // auth
  if (ir.auth.enabled && ir.auth.strategy !== 'none' && !ir.resources.some((r) => r.name === (ir.auth.userResource || 'users'))) {
    out.push({ level: 'warning', code: 'IR_AUTH_NO_USERS', message: 'Auth enabled but no users resource — users table will be auto-created.' });
  }
  return out;
}
