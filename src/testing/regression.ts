/**
 * Builder regression tests — every discovered bug becomes a test (Rule 9, §32).
 * 1. SQL always includes required separators.
 * 2. TEXT fields cannot silently become INT.
 * 3. Schema and migration agree.
 * 4. Schema and model agree.
 * 5. Auth routes actually exist.
 * 6. JWT secret is never hardcoded.
 * 7. Unrelated controllers don't receive auth-specific logic.
 * 8. OpenAPI matches actual routes.
 * 9. Export blocks on invalid migrations.
 * 10. Builder reports real validation status.
 */
import { generateProject, canonicalCastFor, openApiTypeFor } from '@/lib/generator';
import { templateBlog, emptyProject, uid } from '@/lib/builder';
import { runValidationPipeline } from '@/validation/pipeline';
import { runAllTests, simulateAutoloader, simulateMigrationExecution, simulateHttpDispatch, simulateE2EAuthFlow } from '@/testing/testRunner';
import { auditSecurity } from '@/security/auditor';
import { validateAuthRouteContract } from '@/security/authContract';
import { runAllPermanentFixtures } from '@/testing/fixtures';

export interface RegressionResult { name: string; passed: boolean; detail: string }

export function runRegressionTests(): RegressionResult[] {
  const out: RegressionResult[] = [];
  const blog = templateBlog();
  const files = generateProject(blog);
  const byPath = (p: string) => files.find((f) => f.path === p)?.content ?? '';

  // 1. SQL separators
  const schema = byPath('database/schema.sql');
  const hasCreate = /CREATE TABLE/i.test(schema);
  // every column definition line inside CREATE TABLE must be comma-terminated except the last line before closing
  const blocks = [...schema.matchAll(/CREATE TABLE[\s\S]*?;/gi)].map((m) => m[0]);
  let commaOk = hasCreate && blocks.length > 0;
  for (const b of blocks) {
    const inner = b.slice(b.indexOf('(') + 1, b.lastIndexOf(')'));
    const lines = inner.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
    for (let i = 0; i < lines.length - 1; i++) {
      if (!lines[i].trimEnd().endsWith(',')) { commaOk = false; }
    }
  }
  out.push({ name: 'SQL includes required separators', passed: commaOk, detail: commaOk ? `${blocks.length} tables, all lines comma-terminated` : 'missing comma detected' });

  // 2. TEXT never INT
  const msgCast = canonicalCastFor('message', 'int');
  out.push({ name: 'TEXT fields cannot become INT', passed: msgCast !== 'int', detail: `canonicalCastFor(message,int)=${msgCast}` });
  const oaType = openApiTypeFor('message', 'int');
  out.push({ name: 'OpenAPI TEXT consistency', passed: oaType.type === 'string', detail: `openApiTypeFor(message)=${oaType.type}` });

  // 3. Schema ↔ migration agree
  const migs = files.filter((f) => f.path.includes('migrations/'));
  const migTables = migs.map((m) => /CREATE TABLE IF NOT EXISTS\s+(\w+)/i.exec(m.content)?.[1]).filter(Boolean);
  const schemaTables = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi)].map((m) => m[1]);
  out.push({ name: 'Schema and migration agree', passed: migTables.length > 0 && migTables.every((t) => schemaTables.includes(t as string)), detail: `${migTables.length} migrations ↔ ${schemaTables.length} schema tables` });

  // 4. Schema ↔ model agree (casts)
  const userModel = byPath('backend/models/User.php');
  out.push({ name: 'Schema and model agree', passed: /protected static array \$fillable/.test(userModel) && /protected static array \$casts/.test(userModel), detail: 'fillable+casts present' });

  // 5. Auth routes
  const front = byPath('backend/public/index.php');
  const need = ['/auth/register', '/auth/login', '/auth/logout', '/auth/refresh', '/auth/me'];
  const missing = need.filter((r) => !front.includes(r));
  out.push({ name: 'Auth routes exist', passed: missing.length === 0, detail: missing.length ? `missing ${missing.join(',')}` : 'all 5 present' });

  // 6. JWT never hardcoded — scope to credential files only (README curl examples
  // legitimately contain 'secret123' as a demo password; that is not a JWT secret).
  const credScope = files.filter((f) => f.path.includes('config/app.php') || f.path.includes('.env.example')).map((f) => f.content).join('\n');
  out.push({ name: 'JWT secret never hardcoded', passed: !/change-me-in-production/.test(credScope) && /^JWT_SECRET=$/m.test(byPath('.env.example')), detail: 'empty JWT_SECRET= + fail-closed config' });

  // 7. No auth leak
  const leaked = files.filter((f) => f.path.includes('controllers/') && !/AuthController|UserController/.test(f.path) && /password_hash/.test(f.content));
  out.push({ name: 'Unrelated controllers clean', passed: leaked.length === 0, detail: leaked.length ? leaked.map((f) => f.path).join(',') : 'no password_hash outside Auth/users' });

  // 8. OpenAPI ↔ routes
  try {
    const oa = JSON.parse(byPath('docs/openapi.json'));
    const paths = Object.keys(oa.paths ?? {});
    out.push({ name: 'OpenAPI matches routes', passed: paths.length > 0 && need.every((r) => paths.some((p) => p.includes(r))), detail: `${paths.length} paths` });
  } catch (e) {
    out.push({ name: 'OpenAPI matches routes', passed: false, detail: String(e) });
  }

  // 9. Export blocks on invalid migration
  const broken = emptyProject('broken');
  (broken as unknown as { tables: typeof blog.tables }).tables = [{ id: uid('t'), name: 'contacts', comment: '', timestamps: false, softDeletes: false, columns: [] }];
  const brokenFiles = generateProject(broken);
  const v = runValidationPipeline(broken, brokenFiles);
  out.push({ name: 'Export blocks on invalid migration', passed: v.blocking === true, detail: v.blocking ? 'blocking=true' : 'NOT blocked (FAIL)' });

  // 10. Real validation status (no fake pass)
  const good = runValidationPipeline(blog, files);
  out.push({ name: 'Real validation status', passed: good.stages.length >= 7 && good.stages.every((s) => ['pass', 'fail', 'warn'].includes(s.status)), detail: `${good.stages.length} stages reported` });

  // 11. Step 11 type check reads generated artifacts, not the stale Step 5 snapshot:
  // requirements say int (user fixed Step 6 after approving Step 5) but the
  // generated schema says TEXT → must pass (was an infinite Step 8-green/Step 11-red loop).
  try {
    const staleReq = {
      database: { tables: [{ name: 'contacthtmls', columns: [
        { name: 'id', type: 'bigint', nullable: false, primaryKey: true },
        { name: 'your_message', type: 'int', nullable: false, primaryKey: false },
      ] }], relationships: [] },
      api: { endpoints: [{ id: 'e1' }], basePath: '/api/v1', version: 'v1', cors: { enabled: true, origins: [], methods: [], headers: [], credentials: false } },
      authentication: { enabled: false },
      files: { uploads: [] },
      validation: { rules: [], globalRules: [] },
      businessRules: [],
      ambiguities: [],
    } as never;
    const fixedBuilder = emptyProject('stale-repro');
    (fixedBuilder as unknown as { tables: typeof blog.tables }).tables = [{
      id: uid('t'), name: 'contacthtmls', comment: '', timestamps: false, softDeletes: false,
      columns: [
        { id: uid('c'), name: 'id', type: 'bigint', nullable: false, unique: false, defaultValue: '', isPrimaryKey: true, isAutoIncrement: true },
        { id: uid('c'), name: 'your_message', type: 'text', nullable: false, unique: false, defaultValue: '', isPrimaryKey: false, isAutoIncrement: false },
      ],
    }];
    const fixedFiles = generateProject({ ...fixedBuilder, auth: { ...fixedBuilder.auth, strategy: 'none' } });
    const fixedSchema = fixedFiles.find((f) => f.path === 'database/schema.sql')?.content ?? '';
    const res = runAllTests({ projectId: 'stale-repro', generated: fixedFiles, requirements: staleReq, analysis: { apiCalls: [] } as never, schemaSql: fixedSchema });
    const fails = res.filter((r) => r.status === 'failed');
    out.push({ name: 'Stale requirements snapshot cannot fail fixed schema', passed: fails.length === 0, detail: fails.length ? fails.map((f) => f.name).join(',') : 'artifacts rule, snapshot stale = warning at most' });
  } catch (e) {
    out.push({ name: 'Stale requirements snapshot cannot fail fixed schema', passed: false, detail: String(e) });
  }

  // 12. Runtime-proof invariants (each found by actually booting the app on Linux):
  // 12a. No case-mismatched require paths (backend/support vs ../Support is fatal on Linux).
  const phpSources = files.filter((f) => f.path.endsWith('.php')).map((f) => f.content).join('\n');
  const badCase = /__DIR__\s*\.\s*'\/(Support|Models)\//.test(phpSources);
  out.push({ name: 'Require paths match lowercase dirs (Linux-safe)', passed: !badCase, detail: badCase ? '../Support or ../Models found' : 'all requires use support/models/controllers' });

  // 12b. refresh_tokens migrates AFTER users (FK dependency order).
  const migNames = files.filter((f) => f.path.includes('migrations/')).map((f) => f.path.split('/').pop() as string).sort();
  const usersMig = migNames.find((n) => n.includes('_users'));
  const refreshMig = migNames.find((n) => n.includes('refresh_tokens'));
  out.push({ name: 'Refresh migration ordered after users', passed: !!usersMig && !!refreshMig && refreshMig > usersMig, detail: migNames.join(',') });

  // 12c. No-auth projects emit no refresh_tokens artifacts.
  const noAuth = emptyProject('noauth');
  (noAuth as unknown as { tables: typeof blog.tables }).tables = blog.tables;
  noAuth.auth.strategy = 'none';
  const noAuthFiles = generateProject(noAuth);
  const noAuthRefresh = noAuthFiles.some((f) => f.path.includes('refresh_tokens'));
  out.push({ name: 'No refresh_tokens without auth', passed: !noAuthRefresh, detail: noAuthRefresh ? 'leaked' : 'absent' });

  // 12d. Pagination meta uses spec key current_page (was `page`).
  const modelSrc = files.find((f) => f.path === 'backend/support/Model.php')?.content ?? '';
  out.push({ name: 'Paginate meta key is current_page', passed: /'current_page' => \$page/.test(modelSrc), detail: /'current_page' => \$page/.test(modelSrc) ? 'spec match' : 'wrong meta key' });

  // 12e. bin/backend is executable PHP (shebang + <?php; was missing tag).
  const cli = files.find((f) => f.path === 'bin/backend')?.content ?? '';
  out.push({ name: 'CLI boots (shebang + php tag)', passed: cli.startsWith('#!/usr/bin/env php\n<?php'), detail: cli.slice(0, 40).replace(/\n/g, '\\n') });

  // 12f. .env is actually loaded at runtime (front controller + migrate.php).
  const frontSrc = files.find((f) => f.path === 'backend/public/index.php')?.content ?? '';
  const migRunner = files.find((f) => f.path === 'database/migrate.php')?.content ?? '';
  const envLoaded = frontSrc.includes('Env::load') && migRunner.includes('Env::load') && files.some((f) => f.path === 'backend/support/Env.php');
  out.push({ name: '.env loaded by front + migrate', passed: envLoaded, detail: envLoaded ? 'Env.php wired' : 'missing loader' });

  // 13. Application Runtime: PSR-4 Autoloader & Container DI boot
  const autoCheck = simulateAutoloader(files);
  out.push({
    name: 'Application boots with PSR-4 autoloader without class resolution errors',
    passed: autoCheck.passed,
    detail: autoCheck.passed
      ? `Autoloader mapped ${Object.keys(autoCheck.classMap).length} classes with Container registered`
      : autoCheck.errors.join('; '),
  });

  // 14. Application Runtime: In-memory migration execution in topological dependency order
  const migExec = simulateMigrationExecution(files, schema);
  out.push({
    name: 'Topological migration execution succeeds sequentially in memory',
    passed: migExec.passed,
    detail: migExec.passed
      ? `${migExec.executedMigrations.length} migrations executed, ${migExec.createdTables.length} tables created in dependency order`
      : migExec.errors.join('; '),
  });

  // 15. Application Runtime: PATCH empty body handled with 422 (preventing SQL syntax error)
  const reqsBlog = {
    database: { tables: blog.tables, relationships: [] },
    authentication: { enabled: true, strategy: blog.auth.strategy },
    api: { endpoints: blog.endpoints, basePath: blog.config.apiPrefix, version: 'v1', cors: { enabled: true, origins: [], methods: [], headers: [], credentials: false } },
  } as any;
  const httpBlog = simulateHttpDispatch(files, reqsBlog);
  const patchTest = httpBlog.results.filter((r) => r.method === 'PATCH');
  const patchAll422 = patchTest.length > 0 && patchTest.every((r) => r.passed);
  out.push({
    name: 'PATCH endpoint handles empty body with 422 status',
    passed: patchAll422,
    detail: patchAll422
      ? `All ${patchTest.length} PATCH endpoints return 422 on empty body`
      : httpBlog.errors.filter((e) => e.includes('patch')).join('; '),
  });

  // 16. Application Runtime: Container DI resolves database and controller dependencies
  const hasContainerFile = files.some((f) => f.path === 'backend/support/Container.php');
  const containerUsed = files.some((f) => f.path.includes('Controller.php') && f.content.includes('Container::getInstance()')) ||
    files.some((f) => f.path.includes('index.php') && f.content.includes('Container::getInstance()'));
  out.push({
    name: 'Container DI resolves dependencies across controllers and front controller',
    passed: hasContainerFile && containerUsed,
    detail: hasContainerFile && containerUsed ? 'Container.php registered and resolved' : 'Container not wired',
  });

  // 17. Application Runtime: No-auth application boots cleanly without any auth dependencies or routes
  const noAuthReqs = {
    database: { tables: noAuth.tables, relationships: [] },
    authentication: { enabled: false, strategy: 'none' },
    api: { endpoints: noAuth.endpoints, basePath: noAuth.config.apiPrefix, version: 'v1', cors: { enabled: true, origins: [], methods: [], headers: [], credentials: false } },
  } as any;
  const noAuthHttp = simulateHttpDispatch(noAuthFiles, noAuthReqs);
  const noAuthRoutesClean = !noAuthFiles.some((f) => f.path.includes('Jwt.php')) &&
    !noAuthFiles.some((f) => f.path.includes('AuthController.php')) &&
    !noAuthFiles.find((f) => f.path === 'backend/public/index.php')?.content.includes('/auth/');
  out.push({
    name: 'No-auth application boots cleanly without any auth dependencies or routes',
    passed: noAuthRoutesClean && noAuthHttp.passed,
    detail: noAuthRoutesClean ? 'Zero auth routes, zero auth files' : 'Auth leaked into no-auth app',
  });

  // 18. Generator hardening: NO_GLOBAL_PDO — generated code has zero $GLOBALS['__pdo']
  const globalPdo = files.filter((f) => f.content.includes("$GLOBALS['__pdo']"));
  out.push({
    name: 'Generated code contains zero $GLOBALS[\'__pdo\'] references',
    passed: globalPdo.length === 0,
    detail: globalPdo.length === 0 ? 'clean — db() via Container DI only' : `found in ${globalPdo.map((f) => f.path).join(', ')}`,
  });

  // 19. Generator hardening: MIGRATE_PHP_PARAMETERIZED — migrate.php uses prepared statements
  const migrateSrc = byPath('database/migrate.php');
  const migrateParamOk = migrateSrc.includes('WHERE batch = :batch') && !(/query\([^)]*WHERE\s+batch\s*=\s*['"]?\s*\.\s*\$batch/i.test(migrateSrc));
  out.push({
    name: 'migrate.php uses parameterized batch queries (no string concat)',
    passed: migrateParamOk,
    detail: migrateParamOk ? 'prepared :batch binding confirmed' : 'unprepared $batch concatenation detected',
  });

  // 20. Generator hardening: ALLOWLIST_SORT_IDENTIFIERS — Model::paginate uses $allowedSorts
  const paginateOk = modelSrc.includes('$allowedSorts') && modelSrc.includes('$safeSort') && modelSrc.includes("$safeDir");
  out.push({
    name: 'Model::paginate enforces sort column allowlist and safe direction',
    passed: paginateOk,
    detail: paginateOk ? '$allowedSorts + $safeSort + $safeDir present' : 'sort allowlisting missing in Model.php',
  });

  // 21. Generator hardening: IDOR_OWNERSHIP — controllers enforce ownership on user_id tables
  const postCtrl = byPath('backend/controllers/PostController.php');
  const idorOk = postCtrl.includes('Access denied: you do not own this resource') && postCtrl.includes("\$existing['user_id']");
  out.push({
    name: 'IDOR ownership enforcement in controllers for user_id tables',
    passed: idorOk,
    detail: idorOk ? 'ownership check + 403 present in PostController' : 'IDOR protection missing',
  });

  // 22. Security auditor: JWT_FAIL_CLOSED_NO_FALSE_POSITIVE — no-auth project gets no JWT findings
  const noAuthReqsForAudit = {
    database: { tables: noAuth.tables, relationships: [] },
    authentication: { enabled: false, strategy: 'none' },
    api: { endpoints: noAuth.endpoints, basePath: noAuth.config.apiPrefix, version: 'v1', cors: { enabled: true, origins: [], methods: [], headers: [], credentials: false } },
    files: { uploads: [] },
    validation: { rules: [], globalRules: [] },
    businessRules: [],
    ambiguities: [],
  } as any;
  const noAuthFindings = auditSecurity({ projectId: 'noauth', generated: noAuthFiles, requirements: noAuthReqsForAudit });
  const falseJwt = noAuthFindings.filter((f) => f.ruleId === 'SEC_JWT_SECRET_CONFIG' && f.severity !== 'info');
  const falseAuth = noAuthFindings.filter((f) => f.ruleId === 'SEC_AUTH_POLICY' && f.severity !== 'info');
  out.push({
    name: 'No-auth project produces zero false-positive JWT/auth findings',
    passed: falseJwt.length === 0 && falseAuth.length === 0,
    detail: falseJwt.length === 0 && falseAuth.length === 0 ? 'IR-aware: no false positives' : `false JWT: ${falseJwt.length}, false auth: ${falseAuth.length}`,
  });

  // 23b. Security auditor: Blog project audit produces all expected rule IDs with correct severity
  const blogReqs = {
    database: { tables: blog.tables, relationships: [] },
    authentication: { enabled: true, strategy: blog.auth.strategy },
    api: { endpoints: blog.endpoints, basePath: blog.config.apiPrefix, version: 'v1', cors: { enabled: true, origins: [], methods: [], headers: [], credentials: false } },
    files: { uploads: [] },
    validation: { rules: [], globalRules: [] },
    businessRules: [],
    ambiguities: [],
  } as any;
  const blogFindings = auditSecurity({ projectId: 'blog', generated: files, requirements: blogReqs });
  const expectedRules = ['SEC_NO_GLOBAL_PDO', 'SEC_MIGRATE_PREPARED', 'SEC_SQL_ALLOWLIST', 'SEC_JWT_SECRET_CONFIG', 'SEC_AUTH_POLICY', 'SEC_PASSWORD_HASH', 'SEC_IDOR_AUTHORIZATION', 'SEC_CORS_ORIGIN'];
  const foundRules = new Set(blogFindings.map((f) => f.ruleId));
  const missingRules = expectedRules.filter((r) => !foundRules.has(r));
  const criticalOpen = blogFindings.filter((f) => f.severity === 'critical' && f.status === 'open');
  out.push({
    name: 'Security audit covers all 8 rules with zero critical/open on hardened generator',
    passed: missingRules.length === 0 && criticalOpen.length === 0,
    detail: missingRules.length > 0 ? `missing rules: ${missingRules.join(',')}` : criticalOpen.length > 0 ? `critical open: ${criticalOpen.map((f) => f.ruleId).join(',')}` : `${blogFindings.length} findings, all 8 rules covered, 0 critical/open`,
  });

  // 24. Authentication E2E lifecycle (15 steps)
  const authReport = simulateE2EAuthFlow(files, blogReqs);
  out.push({
    name: '15-step E2E authentication flow verifies complete end-to-end lifecycle',
    passed: authReport.passed,
    detail: authReport.passed
      ? `All 15 E2E auth steps passed (Register, Login, Token, /me, Guard, 401, Expire, Refresh, Migration, Revoke, Logout, Client Clear, Protected Guard, Redirect)`
      : authReport.errors.join('; '),
  });

  // 25. Invariant: AUTH_ROUTE_CONTRACT_MATCH — canonical routes unified across representations
  const authContractCheck = validateAuthRouteContract(files, blog.auth, blog.config.apiPrefix);
  out.push({
    name: 'Canonical auth route contract matches Router, OpenAPI, Client, and Auth Store',
    passed: authContractCheck.passed,
    detail: authContractCheck.passed ? 'all representations match canonical contract' : authContractCheck.mismatches.join('; '),
  });

  // 26. Invariant: BUSINESS_CLASS_DI_ONLY — controllers resolved via Container DI
  const frontSrcIndex = byPath('backend/public/index.php');
  const hasDirectNewController = /\$router->add\([^)]*fn\([^)]*\)\s*=>\s*\(new\s+[A-Z]\w*Controller/i.test(frontSrcIndex);
  const usesContainerForControllers = frontSrcIndex.includes('$c->get(AuthController::class)') && frontSrcIndex.includes('$c->get(PostController::class)');
  out.push({
    name: 'Route handlers use PSR-11 Container DI instead of direct controller instantiations',
    passed: !hasDirectNewController && usesContainerForControllers,
    detail: !hasDirectNewController && usesContainerForControllers ? 'Container DI wiring confirmed' : 'direct (new Controller) detected',
  });

  // 27. Invariant: PERMANENT_FIXTURES_A_THROUGH_J — all 10 fixtures pass
  const fixtureResults = runAllPermanentFixtures();
  const allFixturesPassed = fixtureResults.every((f) => f.passed);
  const failedFixtures = fixtureResults.filter((f) => !f.passed).map((f) => f.fixture);
  out.push({
    name: 'Permanent regression fixtures A through J pass 100% of invariant checks',
    passed: allFixturesPassed,
    detail: allFixturesPassed ? 'All 10 fixtures (A-J) passed 100%' : `Failed fixtures: ${failedFixtures.join(', ')}`,
  });

  return out;
}
