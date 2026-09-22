/**
 * Validation Pipeline — DO NOT TRUST GENERATED CODE
 * Generation → File validation → PHP syntax → Static analysis → Schema → Migration → Route → OpenAPI → Security → READY
 * Auto-repair: safe deterministic repairs at AST/schema level (max 3 attempts).
 */
import type { GenFile, BuilderState } from '@/lib/builder';
import { buildASTFromBuilderState, validateAST, generateSchemaSQL } from '@/database/schemaAst';
import { validateIR, buildIRFromBuilder } from '@/ir/builder';
import { simulateAutoloader, simulateMigrationExecution, simulateHttpDispatch } from '@/testing/testRunner';

export type ValidationSeverity = 'info' | 'warning' | 'error' | 'critical' | 'blocking';
export interface ValidationIssue {
  stage: string;
  severity: ValidationSeverity;
  code: string;
  message: string;
  file?: string;
  line?: number;
  fixable: boolean;
  fix?: string;
}
export interface ValidationResult {
  passed: boolean;
  blocking: boolean;
  stages: Array<{ name: string; status: 'pass' | 'fail' | 'warn'; issues: ValidationIssue[] }>;
  issues: ValidationIssue[];
  repairs: Array<{ stage: string; description: string }>;
}

// --- helpers ---
function hasPhpTag(content: string): boolean { return content.includes('<?php'); }
function unbalancedBraces(content: string): number {
  let d = 0; let inS = false; let inD = false; let esc = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inS) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === "'") inS = false; continue; }
    if (inD) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inD = false; continue; }
    if (ch === "'") { inS = true; continue; }
    if (ch === '"') { inD = true; continue; }
    if (ch === '{') d += 1;
    else if (ch === '}') d -= 1;
  }
  return d;
}

// --- Stage runners ---

export function validateFiles(files: GenFile[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (files.length === 0) issues.push({ stage: 'file', severity: 'blocking', code: 'NO_FILES', message: 'No files generated.', fixable: false });
  const paths = files.map((f) => f.path);
  const dups = paths.filter((p, i) => paths.indexOf(p) !== i);
  for (const d of [...new Set(dups)]) issues.push({ stage: 'file', severity: 'error', code: 'DUP_PATH', message: `Duplicate path: ${d}`, file: d, fixable: true, fix: 'rename' });
  for (const f of files) if (!f.content || f.content.trim().length < 10) issues.push({ stage: 'file', severity: 'warning', code: 'EMPTY_FILE', message: `Empty file: ${f.path}`, file: f.path, fixable: false });
  return issues;
}

export function validatePhpSyntax(files: GenFile[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const f of files.filter((x) => x.path.endsWith('.php'))) {
    if (!hasPhpTag(f.content)) issues.push({ stage: 'php_syntax', severity: 'error', code: 'NO_PHP_TAG', message: `Missing <?php in ${f.path}`, file: f.path, fixable: true, fix: 'prepend <?php' });
    const b = unbalancedBraces(f.content);
    if (b !== 0) issues.push({ stage: 'php_syntax', severity: 'blocking', code: 'UNBALANCED_BRACES', message: `Unbalanced braces (${b}) in ${f.path}`, file: f.path, fixable: true, fix: 'auto-repair braces' });
    if (/mysql_query\s*\(/.test(f.content)) issues.push({ stage: 'php_syntax', severity: 'critical', code: 'DANGEROUS_MYSQL', message: `mysql_query found in ${f.path}`, file: f.path, fixable: true });
  }
  return issues;
}

export function validateSchema(state: BuilderState): ValidationIssue[] {
  const ir = buildIRFromBuilder(state);
  const irIssues = validateIR(ir).map<ValidationIssue>((x) => ({
    stage: 'schema', severity: x.level === 'error' ? 'blocking' as const : 'warning' as const, code: x.code, message: x.message, fixable: x.code === 'IR_FIELD_TYPE' || x.code === 'IR_AUTH_NO_USERS',
  }));
  const ast = buildASTFromBuilderState(state);
  const astIssues = validateAST(ast).map<ValidationIssue>((x) => ({
    stage: 'schema', severity: x.level === 'error' ? 'blocking' as const : 'warning' as const, code: x.code, message: x.message, fixable: false,
  }));
  return [...irIssues, ...astIssues];
}

export function validateMigrations(files: GenFile[]): ValidationIssue[] {
  const migs = files.filter((f) => f.path.includes('migrations/'));
  const issues: ValidationIssue[] = [];
  if (migs.length === 0) issues.push({ stage: 'migration', severity: 'blocking', code: 'NO_MIGRATIONS', message: 'No migrations generated.', fixable: false });
  for (const m of migs) if (!/CREATE TABLE/i.test(m.content)) issues.push({ stage: 'migration', severity: 'error', code: 'NO_CREATE', message: `${m.path} has no CREATE TABLE`, file: m.path, fixable: false });
  return issues;
}

export function validateRoutes(state: BuilderState): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  for (const e of state.endpoints) {
    const key = `${e.method} ${e.path}`;
    if (seen.has(key)) issues.push({ stage: 'route', severity: 'error', code: 'DUP_ROUTE', message: `Duplicate route ${key}`, fixable: true });
    seen.add(key);
    if (!e.path.startsWith('/')) issues.push({ stage: 'route', severity: 'error', code: 'ROUTE_SLASH', message: `Route ${key} must start with /`, fixable: true });
  }
  if (state.endpoints.length === 0) issues.push({ stage: 'route', severity: 'blocking', code: 'NO_ROUTES', message: 'No routes defined.', fixable: false });
  return issues;
}

export function validateOpenAPI(files: GenFile[]): ValidationIssue[] {
  const f = files.find((x) => x.path.includes('openapi.json'));
  if (!f) return [{ stage: 'openapi', severity: 'error', code: 'NO_OPENAPI', message: 'openapi.json missing', fixable: false }];
  try {
    const j = JSON.parse(f.content);
    if (!j.openapi || !j.paths) return [{ stage: 'openapi', severity: 'error', code: 'OPENAPI_INVALID', message: 'OpenAPI missing openapi/paths', file: f.path, fixable: false }];
    // check synced routes
    const pathCount = Object.keys(j.paths).length;
    if (pathCount === 0) return [{ stage: 'openapi', severity: 'error', code: 'OPENAPI_EMPTY', message: 'OpenAPI has no paths', file: f.path, fixable: false }];
  } catch (e) {
    return [{ stage: 'openapi', severity: 'blocking', code: 'OPENAPI_JSON', message: `Invalid JSON: ${String(e)}`, file: f.path, fixable: true }];
  }
  return [];
}

export function validateSecurity(files: GenFile[]): ValidationIssue[] {
  const all = files.map((f) => f.content).join('\n');
  const issues: ValidationIssue[] = [];
  if (!/password_hash/.test(all) && /password/.test(all)) issues.push({ stage: 'security', severity: 'critical', code: 'NO_HASH', message: 'password column without password_hash', fixable: false });
  // Per-file interpolated-SQL scan (joined-string matching caused cross-file false
  // positives: $_GET in Request.php + prepare() in Model.php are unrelated lines).
  for (const f of files) {
    if (/->(query|exec)\(\s*["'][^"']*\$/.test(f.content)) {
      issues.push({ stage: 'security', severity: 'critical', code: 'SQL_INJECTION', message: `Possible interpolated SQL in ${f.path}`, file: f.path, fixable: false });
    }
    if (/["']\s*\.\s*\$_(GET|POST|REQUEST|COOKIE)/.test(f.content) && /SELECT|INSERT|UPDATE|DELETE/i.test(f.content)) {
      issues.push({ stage: 'security', severity: 'critical', code: 'SQL_INJECTION', message: `Superglobal concatenated into SQL in ${f.path}`, file: f.path, fixable: false });
    }
    if (f.content.includes("$GLOBALS['__pdo']")) {
      issues.push({ stage: 'security', severity: 'blocking', code: 'NO_GLOBAL_PDO_FALLBACK', message: `Global PDO fallback $GLOBALS['__pdo'] found in ${f.path}`, file: f.path, fixable: false });
    }
  }
  // migrate.php parameterization check
  const migRunner = files.find((f) => f.path.includes('migrate.php'));
  if (migRunner && /query\([^)]*WHERE\s+batch\s*=\s*['"]?\s*\.\s*\$batch/i.test(migRunner.content)) {
    issues.push({ stage: 'security', severity: 'blocking', code: 'MIGRATE_SQL_INJECTION', message: 'Unprepared $batch concatenation in database/migrate.php', file: migRunner.path, fixable: false });
  }
  // Any usable static JWT secret is blocking (Rule 2.5) — scope to credential files
  // (README demo passwords like secret123 are not JWT secrets).
  const credScope = files.filter((f) => f.path.includes('config/app.php') || f.path.includes('.env.example')).map((f) => f.content).join('\n');
  if (/change-me-in-production/.test(credScope)) issues.push({ stage: 'security', severity: 'blocking', code: 'HARDCODED_SECRET', message: 'Hardcoded JWT secret — must be empty JWT_SECRET= + key:generate', fixable: true });
  const envFile = files.find((f) => f.path.includes('.env.example'));
  if (envFile && /JWT_SECRET=\S/.test(envFile.content)) issues.push({ stage: 'security', severity: 'blocking', code: 'ENV_SECRET', message: '.env.example must contain empty JWT_SECRET=', fixable: true });
  return issues;
}

export function validateNoAuthIsolation(state: BuilderState, files: GenFile[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (state.auth.strategy === 'none') {
    const leakedAuthFiles = files.filter((f) =>
      f.path.includes('auth-store') ||
      f.path.includes('protected-route') ||
      f.path.includes('login.html') ||
      f.path.includes('register.html') ||
      f.path.includes('refresh_tokens') ||
      f.path.includes('AuthController.php')
    );
    for (const f of leakedAuthFiles) {
      issues.push({
        stage: 'security',
        severity: 'blocking',
        code: 'NO_AUTH_ZERO_AUTH_ARTIFACTS',
        message: `Auth artifact ${f.path} generated in no-auth mode`,
        file: f.path,
        fixable: false,
      });
    }
    const front = files.find((f) => f.path.includes('public/index.php'));
    if (front && (front.content.includes('/auth/login') || front.content.includes('/auth/register') || front.content.includes('requireAuth('))) {
      issues.push({
        stage: 'security',
        severity: 'blocking',
        code: 'NO_AUTH_ZERO_AUTH_ARTIFACTS',
        message: 'Auth routes or requireAuth guard present in no-auth front controller',
        file: front.path,
        fixable: false,
      });
    }
  }
  return issues;
}

export function validateAuthRoutes(state: BuilderState, files: GenFile[]): ValidationIssue[] {
  // Auth disabled → no auth routes expected (matches testRunner's skipped verdict).
  if (state.auth.strategy === 'none') return [];
  const front = files.find((f) => f.path.includes('public/index.php'));
  if (!front) return [{ stage: 'route', severity: 'blocking', code: 'NO_FRONT', message: 'Front controller missing', fixable: false }];
  const need = ['/auth/register', '/auth/login', '/auth/logout', '/auth/refresh', '/auth/me'];
  const missing = need.filter((r) => !front.content.includes(r));
  if (missing.length) return [{ stage: 'route', severity: 'blocking', code: 'AUTH_ROUTES_MISSING', message: `Missing auth routes: ${missing.join(', ')}`, file: front.path, fixable: false }];
  return [];
}

export function validateTypeConsistency(state: BuilderState, files: GenFile[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const oaFile = files.find((f) => f.path.includes('openapi.json'));
  let schemas: Record<string, { properties?: Record<string, { type?: string }> }> = {};
  try { schemas = JSON.parse(oaFile?.content ?? '{}').components?.schemas ?? {}; } catch { /* ignore */ }
  for (const t of state.tables) {
    for (const c of t.columns) {
      if (/message|description|body|content|bio/i.test(c.name) && ['int', 'bigint', 'smallint', 'tinyint'].includes(c.type)) {
        issues.push({ stage: 'schema', severity: 'blocking', code: 'TYPE_INT_FOR_TEXT', message: `${t.name}.${c.name} TEXT semantic stored as ${c.type}`, fixable: true });
      }
    }
    void schemas;
  }
  // Controller hygiene: password_hash outside users/Auth
  for (const f of files) {
    if (f.path.includes('controllers/') && !/AuthController|UserController/.test(f.path) && /password_hash/.test(f.content)) {
      issues.push({ stage: 'security', severity: 'blocking', code: 'AUTH_LEAK', message: `password logic leaked into ${f.path}`, file: f.path, fixable: false });
    }
  }
  return issues;
}

export function validateApplicationRuntime(state: BuilderState, files: GenFile[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. PSR-4 autoloader & container resolution
  const auto = simulateAutoloader(files);
  for (const err of auto.errors) {
    issues.push({
      stage: 'application_runtime',
      severity: 'blocking',
      code: 'AUTOLOADER_RESOLUTION_ERROR',
      message: err,
      fixable: false,
    });
  }

  // 2. Migration execution in dependency order
  const schemaSql = files.find((f) => f.path === 'database/schema.sql')?.content ?? '';
  const mig = simulateMigrationExecution(files, schemaSql);
  for (const err of mig.errors) {
    issues.push({
      stage: 'application_runtime',
      severity: 'blocking',
      code: 'MIGRATION_EXECUTION_ERROR',
      message: err,
      fixable: false,
    });
  }

  // 3. HTTP dispatch & controller validation simulation
  const reqs = {
    database: {
      tables: state.tables.map((t) => ({
        id: t.id,
        name: t.name,
        comment: t.comment,
        columns: t.columns.map((c) => ({
          name: c.name,
          type: c.type,
          nullable: c.nullable,
          primaryKey: c.isPrimaryKey,
          defaultValue: c.defaultValue,
        })),
      })),
      relationships: [],
    },
    authentication: {
      enabled: state.auth.strategy !== 'none',
      strategy: state.auth.strategy,
      login: state.auth.login,
      register: state.auth.register,
    },
    api: {
      endpoints: state.endpoints,
      basePath: state.config.apiPrefix,
      version: 'v1',
      cors: { enabled: true, origins: [], methods: [], headers: [], credentials: false },
    },
  } as any;

  const http = simulateHttpDispatch(files, reqs);
  for (const err of http.errors) {
    issues.push({
      stage: 'application_runtime',
      severity: 'blocking',
      code: 'HTTP_DISPATCH_ERROR',
      message: err,
      fixable: false,
    });
  }

  return issues;
}

// --- Auto-repair (safe, deterministic, AST-level where possible) ---

export function autoRepair(state: BuilderState, files: GenFile[]): { state: BuilderState; files: GenFile[]; repairs: string[] } {
  const repairs: string[] = [];
  let nextState = structuredClone(state) as BuilderState;
  let nextFiles = [...files];

  // Repair 1: text-like INT → TEXT via AST canonicalization (schema-level).
  // Substring match so your_message / contact_message are repaired too.
  for (const t of nextState.tables) {
    for (const c of t.columns) {
      if (/message|description|body|content|bio|notes|excerpt/i.test(c.name) && ['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'float', 'double'].includes(c.type)) {
        c.type = 'text';
        repairs.push(`Fixed ${t.name}.${c.name}: corrected ${c.type.toUpperCase()} → TEXT (semantic type)`);
      }
    }
  }

  // Repair 1b: auth enabled but no users table → create it (AuthController +
  // refresh_tokens FK both assume users exists; warning message promises this).
  if (nextState.auth.strategy !== 'none' && !nextState.tables.some((t) => t.name === 'users')) {
    const cid = () => `c_rep_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    nextState.tables.unshift({
      id: `t_rep_${Date.now().toString(36)}`,
      name: 'users',
      comment: 'Auto-created by safe repair (auth requires it)',
      timestamps: true,
      softDeletes: false,
      columns: [
        { id: cid(), name: 'id', type: 'bigint', nullable: false, unique: false, defaultValue: '', isPrimaryKey: true, isAutoIncrement: true },
        { id: cid(), name: 'name', type: 'varchar', nullable: false, unique: false, defaultValue: '', isPrimaryKey: false, isAutoIncrement: false },
        { id: cid(), name: 'email', type: 'varchar', nullable: false, unique: true, defaultValue: '', isPrimaryKey: false, isAutoIncrement: false },
        { id: cid(), name: 'password', type: 'varchar', nullable: false, unique: false, defaultValue: '', isPrimaryKey: false, isAutoIncrement: false },
        { id: cid(), name: 'role', type: 'varchar', nullable: false, unique: false, defaultValue: 'user', isPrimaryKey: false, isAutoIncrement: false },
      ],
    });
    repairs.push('Added missing users table (id, name, email, password, role) required by auth');
  }

  // Repair 2: missing PK → add id
  for (const t of nextState.tables) {
    if (!t.columns.some((c) => c.isPrimaryKey)) {
      t.columns.unshift({ id: `c_rep_${Date.now()}`, name: 'id', type: 'bigint', nullable: false, unique: false, defaultValue: '', isPrimaryKey: true, isAutoIncrement: true });
      repairs.push(`Added missing PK id to ${t.name}`);
    }
  }

  // Repair 3: duplicate column names → suffix
  for (const t of nextState.tables) {
    const seen = new Map<string, number>();
    for (const c of t.columns) {
      const cnt = seen.get(c.name) ?? 0;
      if (cnt > 0) {
        const old = c.name;
        c.name = `${old}_${cnt + 1}`;
        repairs.push(`Renamed duplicate ${t.name}.${old} → ${c.name}`);
      }
      seen.set(c.name, (seen.get(c.name) ?? 0) + 1);
    }
  }

  // Repair 4: duplicate routes → dedupe
  const routeKeys = new Set<string>();
  nextState.endpoints = nextState.endpoints.filter((e) => {
    const k = `${e.method} ${e.path}`;
    if (routeKeys.has(k)) { repairs.push(`Removed duplicate route ${k}`); return false; }
    routeKeys.add(k);
    return true;
  });

  // Repair 5: missing <?php tag
  nextFiles = nextFiles.map((f) => {
    if (f.path.endsWith('.php') && !f.content.includes('<?php')) {
      repairs.push(`Added <?php tag to ${f.path}`);
      return { ...f, content: '<?php\n' + f.content };
    }
    return f;
  });

  // Repair 5b: hardcoded JWT secrets → empty + key:generate (Rule 2.5).
  // Scoped to credential files only — README demo passwords and test fixtures
  // are not JWT secrets and must not be mangled.
  nextFiles = nextFiles.map((f) => {
    const isCredFile = f.path.includes('config/app.php') || f.path.includes('.env.example');
    if (!isCredFile) return f;
    let c = f.content;
    let touched = false;
    if (/change-me-in-production/.test(c)) {
      c = c.replace(/change-me-in-production/g, '');
      touched = true;
    }
    if (f.path.includes('.env.example') && /JWT_SECRET=\S/.test(c)) {
      c = c.replace(/^JWT_SECRET=.*$/m, 'JWT_SECRET=');
      touched = true;
    }
    if (touched) repairs.push(`Stripped hardcoded secret from ${f.path} (use php bin/backend key:generate)`);
    return touched ? { ...f, content: c } : f;
  });

  // Repair 6: regenerate schema.sql from AST (fixes missing commas deterministically)
  const ast = buildASTFromBuilderState(nextState);
  const sql = generateSchemaSQL(ast);
  nextFiles = nextFiles.map((f) => f.path === 'database/schema.sql' ? { ...f, content: `-- ${nextState.config.projectName} schema (MySQL 8+)\n-- Import: create database ${nextState.config.dbName} then run this file\n\nCREATE DATABASE IF NOT EXISTS ${nextState.config.dbName} CHARACTER SET utf8mb4 COLLATE=utf8mb4_unicode_ci;\nUSE ${nextState.config.dbName};\n\n${sql}\n` } : f);

  return { state: nextState, files: nextFiles, repairs };
}

// --- Full pipeline ---

export function runValidationPipeline(state: BuilderState, files: GenFile[]): ValidationResult {
  const stages: ValidationResult['stages'] = [];
  const allIssues: ValidationIssue[] = [];

  const pushStage = (name: string, issues: ValidationIssue[]) => {
    const blocking = issues.some((x) => x.severity === 'blocking' || x.severity === 'critical');
    const hasError = issues.some((x) => x.severity === 'error' || x.severity === 'blocking' || x.severity === 'critical');
    stages.push({ name, status: blocking || hasError ? 'fail' : issues.some((x) => x.severity === 'warning') ? 'warn' : 'pass', issues });
    allIssues.push(...issues);
  };

  pushStage('File validation', validateFiles(files));
  pushStage('PHP syntax', validatePhpSyntax(files));
  pushStage('Schema (IR + AST)', validateSchema(state));
  pushStage('Migrations', validateMigrations(files));
  pushStage('Routes', [...validateRoutes(state), ...validateAuthRoutes(state, files)]);
  pushStage('OpenAPI', validateOpenAPI(files));
  pushStage('Type consistency', validateTypeConsistency(state, files));
  pushStage('Security', [...validateSecurity(files), ...validateNoAuthIsolation(state, files)]);
  pushStage('Application runtime', validateApplicationRuntime(state, files));

  const blocking = allIssues.some((x) => x.severity === 'blocking' || x.severity === 'critical');
  return { passed: !blocking && allIssues.filter((x) => x.severity === 'error' || x.severity === 'blocking').length === 0, blocking, stages, issues: allIssues, repairs: [] };
}

export function runWithAutoRepair(state: BuilderState, files: GenFile[], maxAttempts = 3): ValidationResult & { repairedState: BuilderState; repairedFiles: GenFile[] } {
  let curState = state;
  let curFiles = files;
  const allRepairs: string[] = [];
  let result = runValidationPipeline(curState, curFiles);
  let attempts = 0;
  while (result.blocking && attempts < maxAttempts) {
    const fixable = result.issues.some((x) => x.fixable);
    if (!fixable) break;
    const repaired = autoRepair(curState, curFiles);
    if (repaired.repairs.length === 0) break;
    curState = repaired.state;
    curFiles = repaired.files;
    allRepairs.push(...repaired.repairs);
    result = runValidationPipeline(curState, curFiles);
    attempts += 1;
    result.repairs = allRepairs.map((r) => ({ stage: 'auto-repair', description: r }));
  }
  return { ...result, repairedState: curState, repairedFiles: curFiles, repairs: allRepairs.map((r) => ({ stage: 'auto-repair', description: r })) };
}
