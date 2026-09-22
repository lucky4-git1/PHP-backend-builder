/**
 * Requirements inference: AnalysisResult -> BackendRequirements.
 * Deterministic, evidence-backed. Never invents business logic:
 * anything below HIGH confidence becomes an explicit Ambiguity
 * that the developer must resolve.
 */
import type {
  Ambiguity,
  AnalysisResult,
  BackendRequirements,
  BusinessRuleRequirement,
  ColumnRequirement,
  EndpointRequirement,
  TableRequirement,
} from '@/shared/types';

export type ConfidenceTier = 'CERTAIN' | 'HIGH' | 'AMBIGUOUS' | 'UNKNOWN';

export function tierFor(confidence: number, evidenceCount: number): ConfidenceTier {
  if (confidence >= 0.9 && evidenceCount >= 2) return 'CERTAIN';
  if (confidence >= 0.9 && evidenceCount >= 1) return 'HIGH';
  if (confidence >= 0.7) return 'HIGH';
  if (confidence >= 0.4) return 'AMBIGUOUS';
  return 'UNKNOWN';
}

export function tierLabel(t: ConfidenceTier): string {
  return t;
}

export function tierColor(t: ConfidenceTier): string {
  switch (t) {
    case 'CERTAIN': return 'success';
    case 'HIGH': return 'info';
    case 'AMBIGUOUS': return 'warning';
    case 'UNKNOWN': return 'error';
  }
}

let seq = 0;
function nid(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq.toString(36)}_${Date.now().toString(36).slice(-4)}`;
}

function mapFieldType(t: string): ColumnRequirement['type'] {
  const allowed: ColumnRequirement['type'][] = [
    'bigint', 'int', 'smallint', 'tinyint', 'decimal', 'float', 'double',
    'varchar', 'text', 'longtext', 'datetime', 'timestamp', 'date', 'time',
    'year', 'json', 'blob', 'enum', 'set', 'boolean', 'uuid',
  ];
  if ((allowed as string[]).includes(t)) return t as ColumnRequirement['type'];
  return 'varchar';
}

export function inferRequirements(analysis: AnalysisResult, projectId: string): BackendRequirements {
  const now = new Date();

  // ---- tables from entities ----
  const tables: TableRequirement[] = analysis.entities.map((e) => {
    const cols: ColumnRequirement[] = e.fields.map((f) => ({
      id: nid('col'),
      name: f.name,
      type: mapFieldType(f.type),
      nullable: !f.required && !f.primaryKey,
      primaryKey: f.primaryKey,
      unique: f.unique,
      autoIncrement: f.primaryKey && (f.type === 'bigint' || f.type === 'int'),
      defaultValue: undefined,
      foreignKey: f.foreignKey
        ? {
            referencedTable: f.foreignKey.table,
            referencedColumn: f.foreignKey.column,
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          }
        : undefined,
      validation: [],
      confidence: e.confidence,
      evidence: e.evidence.map((x) => `${x.type}: ${x.description} [${x.source}]`),
    }));
    // timestamps are NOT assumed — only if observed? Convention: propose but mark evidence.
    return {
      id: nid('tbl'),
      name: e.name,
      entityName: e.name,
      columns: cols,
      indexes: cols.filter((c) => c.foreignKey).map((c) => ({
        name: `idx_${e.name}_${c.name}`,
        columns: [c.name],
        unique: false,
        type: 'BTREE' as const,
      })),
      confidence: e.confidence,
      evidence: e.evidence.map((x) => `${x.type}: ${x.description} [${x.source}]`),
      sourceEntityId: e.id,
    };
  });

  // Ensure users table ONLY when strong auth detected and no users entity exists
  const authDet = analysis.authDetection;
  const hasStrongAuth = authDet ? authDet.detected : false;
  const hasUsers = tables.some((t) => t.name === 'users');
  if (hasStrongAuth && !hasUsers) {
    tables.unshift({
      id: nid('tbl'),
      name: 'users',
      entityName: 'users',
      columns: [
        { id: nid('col'), name: 'id', type: 'bigint', nullable: false, primaryKey: true, unique: false, autoIncrement: true, confidence: 0.85, evidence: ['auth: login/register flow implies users table (HIGH-CONFIDENCE, review required)'] },
        { id: nid('col'), name: 'name', type: 'varchar', nullable: false, primaryKey: false, unique: false, autoIncrement: false, confidence: 0.7, evidence: ['auth: register form typically collects name'] },
        { id: nid('col'), name: 'email', type: 'varchar', nullable: false, primaryKey: false, unique: true, autoIncrement: false, confidence: 0.85, evidence: ['auth: email field observed in login form'] },
        { id: nid('col'), name: 'password', type: 'varchar', nullable: false, primaryKey: false, unique: false, autoIncrement: false, confidence: 0.85, evidence: ['auth: password field observed in login form'] },
      ],
      indexes: [{ name: 'idx_users_email', columns: ['email'], unique: true, type: 'BTREE' }],
      confidence: 0.8,
      evidence: ['auth: inferred from login/register flow — confirm columns'],
    });
  }

  // ---- API endpoints ----
  const endpoints: EndpointRequirement[] = [];
  for (const crud of analysis.crudOperations) {
    if (!crud.detected) continue;
    const method = crud.operation === 'list' || crud.operation === 'read' ? 'GET'
      : crud.operation === 'create' ? 'POST'
      : crud.operation === 'update' ? 'PUT'
      : crud.operation === 'delete' ? 'DELETE' : 'GET';
    const path = crud.operation === 'list' || crud.operation === 'create'
      ? `/${crud.entity}`
      : `/${crud.entity}/{id}`;
    endpoints.push({
      id: nid('ep'),
      method,
      path,
      name: `${crud.operation} ${crud.entity}`,
      description: `Inferred from frontend ${crud.evidence[0] ?? 'usage'}`,
      entity: crud.entity,
      operation: crud.operation,
      authentication: hasStrongAuth ? 'required' : 'none',
      responses: [
        { statusCode: 200, description: 'OK' },
        ...(hasStrongAuth ? [{ statusCode: 401, description: 'Unauthorized' }] : []),
      ],
      confidence: crud.confidence,
      evidence: crud.evidence.length > 0 ? crud.evidence : [`crud: ${crud.operation} on ${crud.entity} (weak signal)`],
    });
  }
  // Auth endpoints (only if strong auth detected)
  if (hasStrongAuth) {
    const authUrlEvidence = analysis.authFlows.flatMap((a) => a.endpoints.map((e) => `${e.method} ${e.url}`));
    if (analysis.authFlows.some((a) => a.type === 'login') || authDet?.hasLoginForm) {
      endpoints.unshift({
        id: nid('ep'), method: 'POST', path: '/auth/login', name: 'Login',
        description: 'Observed login flow in frontend', entity: 'users', operation: 'custom',
        authentication: 'none',
        responses: [{ statusCode: 200, description: 'OK' }],
        confidence: 0.9, evidence: authUrlEvidence.length > 0 ? authUrlEvidence : ['auth: login form with email+password'],
      });
    }
    if (analysis.authFlows.some((a) => a.type === 'register') || authDet?.hasRegisterForm) {
      endpoints.unshift({
        id: nid('ep'), method: 'POST', path: '/auth/register', name: 'Register',
        description: 'Observed register flow in frontend', entity: 'users', operation: 'custom',
        authentication: 'none',
        responses: [{ statusCode: 201, description: 'Created' }],
        confidence: 0.85, evidence: authUrlEvidence.length > 0 ? authUrlEvidence : ['auth: register form observed'],
      });
    }
    endpoints.push({
      id: nid('ep'), method: 'POST', path: '/auth/logout', name: 'Logout',
      description: 'Revoke current session / refresh token', entity: 'users', operation: 'custom',
      authentication: 'required',
      responses: [{ statusCode: 200, description: 'OK' }],
      confidence: 0.85, evidence: ['auth: logout action'],
    });
    endpoints.push({
      id: nid('ep'), method: 'POST', path: '/auth/refresh', name: 'Refresh Token',
      description: 'Rotate refresh token and issue new access token', entity: 'users', operation: 'custom',
      authentication: 'none',
      responses: [{ statusCode: 200, description: 'OK' }],
      confidence: 0.85, evidence: ['auth: refresh rotation'],
    });
    endpoints.push({
      id: nid('ep'), method: 'GET', path: '/auth/me', name: 'Current User',
      description: 'Get authenticated user profile', entity: 'users', operation: 'custom',
      authentication: 'required',
      responses: [{ statusCode: 200, description: 'OK' }],
      confidence: 0.85, evidence: ['auth: user profile'],
    });
  }

  // ---- auth requirement ----
  const tokenViaStorage = analysis.storageUsage.some((s) => s.purpose === 'authentication');
  const authConfidence = authDet ? authDet.confidence : (hasStrongAuth ? 0.85 : 0.2);
  const authentication: BackendRequirements['authentication'] = {
    enabled: hasStrongAuth,
    strategy: hasStrongAuth ? 'jwt' : 'none',
    login: hasStrongAuth && (analysis.authFlows.some((a) => a.type === 'login') || !!authDet?.hasLoginForm),
    register: hasStrongAuth && (analysis.authFlows.some((a) => a.type === 'register') || !!authDet?.hasRegisterForm),
    logout: hasStrongAuth,
    refresh: hasStrongAuth,
    me: hasStrongAuth,
    forgotPassword: false,
    resetPassword: false,
    emailVerification: false,
    sessionManagement: tokenViaStorage,
    userProfile: analysis.routes.some((r) => /profile|account|me/i.test(r.path)) || hasStrongAuth,
    roles: hasStrongAuth ? ['admin', 'user'] : [],
    permissions: [],
    tokenType: 'jwt',
    confidence: authConfidence,
    detectionStatus: authDet?.status ?? (hasStrongAuth ? 'detected' : 'not_detected'),
    evidence: authDet?.evidence ?? (hasStrongAuth ? analysis.authFlows.map((a) => `${a.type} in ${a.componentPath || a.component}`) : ['No authentication detected']),
    reason: authDet?.reason ?? (hasStrongAuth ? 'Strong authentication detected' : 'No authentication detected in frontend.'),
    userDecision: hasStrongAuth ? 'add' : 'none',
    generateFrontend: hasStrongAuth,
  };

  // ---- files ----
  const files: BackendRequirements['files'] = {
    uploads: analysis.uploads.map((u) => ({
      id: nid('upl'),
      fieldName: u.fieldName,
      entity: 'unknown',
      column: u.fieldName,
      acceptedTypes: u.acceptedTypes,
      maxSize: 5_000_000,
      multiple: u.multiple,
      destination: 'local' as const,
    })),
    storagePath: 'storage/uploads',
    maxFileSize: 5_000_000,
    allowedTypes: [...new Set(analysis.uploads.flatMap((u) => u.acceptedTypes))].slice(0, 20),
  };

  // ---- validation ----
  const validation: BackendRequirements['validation'] = {
    rules: tables.map((t) => ({
      entity: t.name,
      field: '*',
      rules: t.columns.filter((c) => !c.nullable && !c.primaryKey).map((c) => ({ field: c.name, type: 'required' as const })),
    })),
    globalRules: [],
  };

  // ---- business rules: NEVER invent. Only surface as ambiguities unless certain. ----
  const businessRules: BusinessRuleRequirement[] = [];

  // ---- ambiguities ----
  const ambiguities: Ambiguity[] = [];

  for (const t of tables) {
    const tier = tierFor(t.confidence, t.evidence.length);
    if (tier === 'AMBIGUOUS' || tier === 'UNKNOWN') {
      ambiguities.push({
        id: nid('amb'),
        type: 'data_relationship',
        title: `Confirm entity "${t.name}"`,
        description: `Only weak evidence was found for "${t.name}". Keep it, merge it, or drop it before generating the backend. Nothing is assumed.`,
        detected: t.evidence[0] ?? 'single weak signal',
        options: [
          { id: 'keep', label: 'Keep as table', description: `Generate table ${t.name} as inferred`, implications: ['CRUD endpoints generated', 'Migration created'] },
          { id: 'merge', label: 'Merge into another table', description: 'Fold these fields into an existing entity', implications: ['Fewer tables', 'Requires manual field mapping'] },
          { id: 'drop', label: 'Drop (UI-only data)', description: 'Treat as static/demo data, no backend table', implications: ['No migration', 'No endpoints'] },
        ],
        confidence: t.confidence,
        evidence: t.evidence,
      });
    }
  }

  // Surface explicit authentication decision if not detected or ambiguous
  if (!hasStrongAuth) {
    ambiguities.push({
      id: nid('amb_auth'),
      type: 'auth_flow',
      title: 'Authentication Decision',
      description: authDet?.status === 'ambiguous'
        ? `Partial authentication signals observed (${authDet.evidence.join('; ')}). Choose whether to generate authentication.`
        : 'No authentication was detected in the frontend. Choose whether to keep this API public or add a complete authentication system with frontend and database support.',
      detected: authDet?.status ?? 'not_detected',
      options: [
        { id: 'none', label: 'No Authentication (Public API)', description: 'Generate clean endpoints without auth, no users table, no JWT, no password handling', implications: ['Public endpoints', 'No auth tables or overhead'] },
        { id: 'jwt', label: 'Add Complete Authentication (JWT)', description: 'Generate users table, hashed passwords, JWT, refresh token rotation, and frontend auth components', implications: ['Users table added', 'Secure token endpoints', 'Frontend login/register flows'] },
        { id: 'existing', label: 'Use Existing External Authentication', description: 'Validate bearer tokens from an external provider without managing local credentials', implications: ['Token validation only', 'No local password storage'] },
      ],
      confidence: authDet?.confidence ?? 0.2,
      evidence: authDet?.evidence ?? ['No authentication signals found in frontend'],
    });
  } else if (!tokenViaStorage) {
    ambiguities.push({
      id: nid('amb_session'),
      type: 'auth_flow',
      title: 'How is the session persisted?',
      description: 'A login/register flow was found, but no token storage (localStorage/sessionStorage/cookie) was observed. Choose explicitly — the generator will not guess.',
      detected: 'auth flow without token persistence',
      options: [
        { id: 'jwt-local', label: 'JWT in localStorage', description: 'Bearer token stored client-side', implications: ['Stateless', 'XSS risk if not careful'] },
        { id: 'jwt-cookie', label: 'JWT in httpOnly cookie', description: 'Cookie session', implications: ['CSRF protection needed', 'Safer against XSS'] },
        { id: 'no-auth', label: 'Disable authentication', description: 'Strip auth, generate as public API', implications: ['No /auth/* endpoints'] },
      ],
      confidence: 0.5,
      evidence: authentication.evidence,
    });
  }

  if (analysis.uploads.length > 0) {
    ambiguities.push({
      id: nid('amb'),
      type: 'file_handling',
      title: 'Where should uploaded files be stored?',
      description: 'File inputs were detected, but the destination cannot be determined from static analysis. Local storage is pre-selected but must be confirmed.',
      detected: analysis.uploads.map((u) => `${u.componentPath} field "${u.fieldName}"`).join('; '),
      options: [
        { id: 'local', label: 'Local disk (storage/uploads)', description: 'Serve via PHP', implications: ['Simple', 'Needs disk space'] },
        { id: 's3', label: 'S3-compatible', description: 'Store object key in DB', implications: ['Scalable', 'Needs credentials'] },
        { id: 'db', label: 'Reject uploads', description: 'No file backend; store metadata only', implications: ['No binary handling'] },
      ],
      confidence: 0.45,
      evidence: analysis.uploads.map((u) => `${u.componentPath}:${u.fieldName}`),
    });
  }

  // Order-total style business logic: surface, never auto-apply
  const moneyHints = tables.some((t) => t.columns.some((c) => /total|price|qty|quantity/i.test(c.name)));
  if (moneyHints) {
    ambiguities.push({
      id: nid('amb'),
      type: 'business_logic',
      title: 'Should totals be computed server-side?',
      description: 'Price/total/quantity fields were observed. The backend could trust client totals or recompute them. This is business logic and MUST be decided by the developer.',
      detected: 'money-related columns observed',
      options: [
        { id: 'recompute', label: 'Recompute on server', description: 'Ignore client total; sum line items', implications: ['Safer', 'More code'] },
        { id: 'trust', label: 'Trust client total', description: 'Store the submitted total as-is', implications: ['Simpler', 'Tamper risk'] },
      ],
      confidence: 0.4,
      evidence: ['money-related columns observed in entities'],
    });
  }

  if (tables.length === 0) {
    ambiguities.push({
      id: nid('amb'),
      type: 'unknown',
      title: 'No backend entities detected',
      description: 'Static analysis found no forms, API calls, or mock data that imply persistent entities. Either import a richer frontend or design tables manually.',
      detected: 'zero entities',
      options: [
        { id: 'manual', label: 'Design manually', description: 'Use the database designer to create tables from scratch', implications: [] },
        { id: 'demo', label: 'Load demo frontend', description: 'Analyze the bundled demo shop to see the pipeline', implications: [] },
      ],
      confidence: 0.1,
      evidence: [],
    });
  }

  return {
    projectId,
    version: 1,
    createdAt: now,
    updatedAt: now,
    authentication,
    database: {
      tables,
      relationships: tables.flatMap((t) =>
        t.columns.filter((c) => c.foreignKey).map((c) => ({
          id: nid('rel'),
          sourceTable: t.name,
          targetTable: c.foreignKey!.referencedTable,
          type: 'many-to-one' as const,
          sourceColumn: c.name,
          targetColumn: c.foreignKey!.referencedColumn,
          confidence: 0.7,
        }))
      ),
    },
    api: {
      endpoints,
      basePath: '/api/v1',
      version: 'v1',
      cors: { enabled: true, origins: [], methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], headers: [], credentials: false },
    },
    files,
    validation,
    businessRules,
    ambiguities,
  };
}

/** Apply developer decisions: enable/disable tables & endpoints, resolve ambiguities. */
export function applyRequirementDecisions(
  req: BackendRequirements,
  opts: {
    enabledTables: Set<string>;
    enabledEndpoints: Set<string>;
    resolvedAmbiguities: Record<string, string>;
    authEnabled: boolean;
    authStrategy?: 'jwt' | 'session' | 'none' | 'existing';
    userDecision?: 'none' | 'add' | 'existing';
    generateFrontend?: boolean;
  }
): BackendRequirements {
  let tables = req.database.tables.filter((t) => opts.enabledTables.has(t.id));
  const hasUsers = tables.some((t) => t.name === 'users');

  // If user enabled authentication and no users table exists, add it
  if (opts.authEnabled && !hasUsers) {
    tables = [
      {
        id: nid('tbl'),
        name: 'users',
        entityName: 'users',
        columns: [
          { id: nid('col'), name: 'id', type: 'bigint', nullable: false, primaryKey: true, unique: false, autoIncrement: true, confidence: 1, evidence: ['auth: required for user credentials'] },
          { id: nid('col'), name: 'name', type: 'varchar', nullable: false, primaryKey: false, unique: false, autoIncrement: false, confidence: 1, evidence: ['auth: user display name'] },
          { id: nid('col'), name: 'email', type: 'varchar', nullable: false, primaryKey: false, unique: true, autoIncrement: false, confidence: 1, evidence: ['auth: login credential'] },
          { id: nid('col'), name: 'password', type: 'varchar', nullable: false, primaryKey: false, unique: false, autoIncrement: false, confidence: 1, evidence: ['auth: hashed password'] },
          { id: nid('col'), name: 'role', type: 'varchar', nullable: false, primaryKey: false, unique: false, autoIncrement: false, defaultValue: 'user', confidence: 1, evidence: ['auth: role based access'] },
        ],
        indexes: [{ name: 'idx_users_email', columns: ['email'], unique: true, type: 'BTREE' }],
        confidence: 1,
        evidence: ['auth: user-enabled authentication system'],
      },
      ...tables,
    ];
  }

  const tableNames = new Set(tables.map((t) => t.name));
  return {
    ...req,
    authentication: {
      ...req.authentication,
      enabled: opts.authEnabled,
      strategy: opts.authStrategy ?? (opts.authEnabled ? 'jwt' : 'none'),
      userDecision: opts.userDecision ?? (opts.authEnabled ? 'add' : 'none'),
      generateFrontend: opts.generateFrontend ?? opts.authEnabled,
      login: opts.authEnabled,
      register: opts.authEnabled,
      logout: opts.authEnabled,
      refresh: opts.authEnabled,
      me: opts.authEnabled,
    },
    database: {
      tables,
      relationships: req.database.relationships.filter(
        (r) => tableNames.has(r.sourceTable) && tableNames.has(r.targetTable)
      ),
    },
    api: {
      ...req.api,
      endpoints: req.api.endpoints.filter(
        (e) => opts.enabledEndpoints.has(e.id) && (!e.entity || tableNames.has(e.entity) || e.path.startsWith('/auth'))
      ),
    },
    ambiguities: req.ambiguities.map((a) => ({
      ...a,
      selectedOption: opts.resolvedAmbiguities[a.id] ?? a.selectedOption,
    })),
    updatedAt: new Date(),
    version: req.version + 1,
  };
}
