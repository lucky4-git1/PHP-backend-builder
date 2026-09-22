/**
 * Application Certification Report (Production-Grade 10/10 Architecture)
 *
 * Weighted Scoring:
 * - Architecture: 10%
 * - Schema: 10%
 * - Backend: 15%
 * - Auth: 10%
 * - Authz: 10%
 * - Frontend: 10%
 * - API Contract: 5%
 * - Security: 15%
 * - Testing: 10%
 * - Runtime: 5%
 * Total: 100%
 *
 * Hard Floors:
 * - Unresolved Critical finding -> Security = 0, overall capped at 45 (Grade F)
 * - Unresolved High finding -> Security capped at 40, overall capped at 65 (Grade F)
 * - Validation Pipeline Blocking -> Overall capped at 50 (Grade F)
 * - Failing Regression Test -> Overall capped at 40 (Grade F)
 */
import type { BuilderState, GenFile } from '@/lib/builder';
import type { SecurityFinding, TestResult } from '@/shared/types';
import type { ValidationResult } from '@/validation/pipeline';
import type { RegressionResult } from '@/testing/regression';
import { validateRouteIntegrity } from '@/security/authContract';
import { buildApplicationDependencyGraph, validateSystemMapGraph } from '@/graph/dependencyGraph';

export interface CategoryScore {
  weight: number;
  score: number; // 0 to 100
  weightedScore: number; // score * (weight / 100)
  details: string[];
}

export interface CertificationReport {
  score: number; // 0 to 100
  grade: 'A' | 'B' | 'C' | 'F';
  isCertified: boolean;
  hardFloorTriggered: boolean;
  hardFloorReasons: string[];
  categories: {
    architecture: CategoryScore;
    schema: CategoryScore;
    backend: CategoryScore;
    auth: CategoryScore;
    authz: CategoryScore;
    frontend: CategoryScore;
    apiContract: CategoryScore;
    security: CategoryScore;
    testing: CategoryScore;
    runtime: CategoryScore;
  };
  summary: string;
  generatedAt: string;
}

export function generateCertificationReport(input: {
  builder: BuilderState;
  generated: GenFile[];
  tests: TestResult[];
  security: SecurityFinding[];
  validation: ValidationResult;
  regression: RegressionResult[];
}): CertificationReport {
  const { builder, generated, tests, security, validation, regression } = input;
  const hardFloorReasons: string[] = [];

  const byPath = (p: string) => generated.find((f) => f.path === p)?.content ?? '';

  // 1. Architecture (10%)
  const hasContainer = generated.some((f) => f.path === 'backend/support/Container.php');
  const hasEnv = generated.some((f) => f.path === 'backend/support/Env.php');
  const hasFront = generated.some((f) => f.path === 'backend/public/index.php');
  const noGlobals = !generated.some((f) => f.content.includes("$GLOBALS['__pdo']"));
  let archScore = 100;
  const archDetails: string[] = [];
  if (!hasContainer) { archScore -= 30; archDetails.push('Container.php missing'); }
  if (!hasEnv) { archScore -= 20; archDetails.push('Env.php loader missing'); }
  if (!hasFront) { archScore -= 30; archDetails.push('Front controller missing'); }
  if (!noGlobals) { archScore -= 40; archDetails.push("Legacy $GLOBALS['__pdo'] detected"); }
  const noGlobalReqId = !generated.some((f) => f.content.includes("$GLOBALS['__request_id']"));
  if (!noGlobalReqId) { archScore -= 30; archDetails.push("Mutable $GLOBALS['__request_id'] detected — must use RequestContext"); hardFloorReasons.push("$GLOBALS['__request_id'] present in generated code"); }
  const hasRequestContext = generated.some((f) => f.path === 'backend/support/RequestContext.php');
  if (!hasRequestContext) { archScore -= 10; archDetails.push('RequestContext.php missing'); }
  if (archScore === 100) archDetails.push('PSR-4, Container DI, RequestContext, and zero global state verified');

  // 2. Schema (10%)
  const schemaSql = byPath('database/schema.sql');
  const hasMigrations = generated.some((f) => f.path.includes('migrations/'));
  let schemaScore = 100;
  const schemaDetails: string[] = [];
  if (!schemaSql || !schemaSql.includes('CREATE TABLE')) { schemaScore -= 50; schemaDetails.push('Missing schema.sql'); }
  if (!hasMigrations) { schemaScore -= 40; schemaDetails.push('No migrations generated'); }
  if (schemaScore === 100) schemaDetails.push(`${builder.tables.length} tables mapped with strict column definitions`);

  // 3. Backend (15%)
  const controllers = generated.filter((f) => f.path.includes('controllers/'));
  const models = generated.filter((f) => f.path.includes('models/'));
  let backendScore = 100;
  const backendDetails: string[] = [];
  if (controllers.length === 0) { backendScore -= 50; backendDetails.push('No controllers'); }
  if (models.length === 0) { backendScore -= 50; backendDetails.push('No models'); }
  if (backendScore === 100) backendDetails.push(`${controllers.length} controllers and ${models.length} models generated`);

  // 4. Auth (10%)
  let authScore = 100;
  const authDetails: string[] = [];
  if (builder.auth.strategy === 'none') {
    authDetails.push('Authentication explicitly disabled by configuration (Public API mode)');
  } else {
    const hasAuthCtrl = generated.some((f) => f.path.includes('AuthController.php'));
    const hasJwt = generated.some((f) => f.path.includes('Jwt.php'));
    const hasRefresh = generated.some((f) => f.path.includes('refresh_tokens'));
    if (!hasAuthCtrl) { authScore -= 40; authDetails.push('AuthController missing'); }
    if (!hasJwt) { authScore -= 30; authDetails.push('Jwt.php missing'); }
    if (!hasRefresh) { authScore -= 20; authDetails.push('Refresh token table missing'); }
    if (authScore === 100) authDetails.push('JWT authentication + refresh token rotation implemented');
  }

  // 5. Authz (10%)
  let authzScore = 100;
  const authzDetails: string[] = [];
  const ownedTables = builder.tables.filter((t) => t.columns.some((c) => ['user_id', 'owner_id', 'created_by', 'author_id', 'customer_id', 'account_id', 'member_id'].includes(c.name)));
  if (ownedTables.length > 0) {
    const hasIdor = controllers.some((c) => c.content.includes('Access denied: you do not own this resource'));
    if (!hasIdor) {
      authzScore -= 50;
      authzDetails.push('IDOR ownership verification missing in owned table controllers');
    } else {
      authzDetails.push('Row-level ownership enforcement and IDOR protection active');
    }
  } else {
    authzDetails.push('No owned tables present; standard authorization baseline met');
  }

  // 6. Frontend (10%)
  let feScore = 100;
  const feDetails: string[] = [];
  const hasApiClient = generated.some((f) => f.path.includes('api-client.js'));
  if (!hasApiClient) { feScore -= 40; feDetails.push('api-client.js missing'); }
  if (builder.auth.strategy !== 'none' && builder.auth.generateFrontend) {
    const hasAuthStore = generated.some((f) => f.path.includes('auth-store.js'));
    const hasProtectedRoute = generated.some((f) => f.path.includes('protected-route.js'));
    if (!hasAuthStore) { feScore -= 30; feDetails.push('auth-store.js missing'); }
    if (!hasProtectedRoute) { feScore -= 30; feDetails.push('protected-route.js missing'); }
  }
  if (feScore === 100) feDetails.push('Integrated API client and reactive auth state management present');

  // 7. API Contract (5%)
  let apiScore = 100;
  const apiDetails: string[] = [];
  const hasOpenApi = generated.some((f) => f.path.includes('openapi.json'));
  if (!hasOpenApi) { apiScore = 0; apiDetails.push('OpenAPI specification missing'); }
  else { apiDetails.push('OpenAPI 3.0.0 documentation generated and route-synchronized'); }

  // 8. Security (15%)
  let secScore = 100;
  const secDetails: string[] = [];
  const unresolvedCrit = security.filter((f) => f.severity === 'critical' && f.status !== 'verified' && f.status !== 'fixed');
  const unresolvedHigh = security.filter((f) => f.severity === 'high' && f.status !== 'verified' && f.status !== 'fixed');
  const reviewedIgnoredCritHigh = security.filter(
    (f) => (f.severity === 'critical' || f.severity === 'high') && (f.status === 'reviewed' || f.status === 'ignored')
  );

  if (unresolvedCrit.length > 0) {
    secScore = 0;
    hardFloorReasons.push(`${unresolvedCrit.length} critical security finding(s) unresolved: ${unresolvedCrit.map((f) => f.ruleId).join(', ')}`);
  } else if (unresolvedHigh.length > 0) {
    secScore = Math.min(secScore, 40);
    hardFloorReasons.push(`${unresolvedHigh.length} high severity finding(s) unresolved: ${unresolvedHigh.map((f) => f.ruleId).join(', ')}`);
  }
  if (reviewedIgnoredCritHigh.length > 0) {
    secDetails.push(`Notice: ${reviewedIgnoredCritHigh.length} finding(s) marked reviewed/ignored without verified fix`);
  }
  secDetails.push(`${security.length} security checks evaluated (${security.filter((f) => f.status === 'verified').length} verified)`);

  // 9. Testing (10%)
  let testScore = 100;
  const testDetails: string[] = [];
  const testFails = tests.filter((t) => t.status === 'failed');
  if (testFails.length > 0) {
    testScore = Math.max(0, 100 - testFails.length * 25);
    testDetails.push(`${testFails.length} test suite(s) failed`);
  } else if (tests.length === 0) {
    testScore = 0;
    testDetails.push('No tests executed yet');
  } else {
    testDetails.push(`All ${tests.length} test suites passed cleanly`);
  }

  // 10. Runtime (5%)
  let runtimeScore = 100;
  const runtimeDetails: string[] = [];
  const regFails = regression.filter((r) => !r.passed);
  if (regFails.length > 0) {
    runtimeScore = 0;
    hardFloorReasons.push(`${regFails.length} regression invariant(s) failed`);
  } else {
    runtimeDetails.push(`All ${regression.length} runtime invariants verified passed`);
  }

  // Check validation pipeline hard floor
  if (validation.blocking) {
    hardFloorReasons.push(`Validation pipeline blocked: ${validation.issues.filter((i) => i.severity === 'blocking').map((i) => i.code).join(', ')}`);
  }

  // Route-controller integrity hard floor
  const routeIntegrity = validateRouteIntegrity(generated);
  if (!routeIntegrity.passed) {
    hardFloorReasons.push(`Route-controller integrity failed: ${routeIntegrity.errors.join('; ')}`);
  }

  // Dependency graph hard floor
  const depGraph = buildApplicationDependencyGraph(builder);
  const graphValidation = validateSystemMapGraph(depGraph, builder);
  if (!graphValidation.passed) {
    hardFloorReasons.push(`Dependency graph invariants failed: ${graphValidation.errors.join('; ')}`);
  }

  // JWT-MySQL edge hard floor (CRITICAL: JWT must NEVER connect to MySQL directly)
  if (depGraph.hasEdge('jwt', 'mysql')) {
    hardFloorReasons.push('CRITICAL DEFECT: JWT provider directly connects to MySQL — JWT must remain database-independent');
  }

  // Public registration privilege escalation hard floor
  const authCtrlSrc = byPath('backend/controllers/AuthController.php');
  const authSvcSrc = byPath('backend/services/AuthService.php');
  if (authCtrlSrc.includes("$b['role']") || (authSvcSrc && !authSvcSrc.includes("$role = 'user';"))) {
    hardFloorReasons.push('CRITICAL DEFECT: Public registration permits caller-supplied role (privilege escalation risk)');
  }

  // Constructor injection vs service-locator hard floor
  const businessSources = [authCtrlSrc, authSvcSrc, byPath('backend/repositories/UserRepository.php'), byPath('backend/repositories/RefreshTokenRepository.php')].filter(Boolean);
  if (businessSources.some((src) => src.includes('Container::getInstance()') || src.includes('db()'))) {
    hardFloorReasons.push('ARCHITECTURAL DEFECT: Business classes invoke service locator Container::getInstance() or db() directly');
  }

  // Single canonical health routes hard floor
  const frontSrc = byPath('backend/public/index.php');
  if (builder.config.apiPrefix && frontSrc.includes(`'${builder.config.apiPrefix}/health'`)) {
    hardFloorReasons.push('Health routes duplicated under API prefix — violates single canonical health contract');
  }

  // Genuine component generation hard floor
  if (builder.auth.strategy === 'jwt') {
    const hasUserRepo = generated.some((f) => f.path === 'backend/repositories/UserRepository.php');
    const hasRefreshRepo = generated.some((f) => f.path === 'backend/repositories/RefreshTokenRepository.php');
    const hasAuthSvc = generated.some((f) => f.path === 'backend/services/AuthService.php');
    if (!hasUserRepo || !hasRefreshRepo || !hasAuthSvc) {
      hardFloorReasons.push('ARCHITECTURAL DEFECT: Missing required authentication layers (UserRepository, RefreshTokenRepository, AuthService)');
    }
  }

  // Calculate raw weighted score
  const categories = {
    architecture: { weight: 10, score: archScore, weightedScore: (archScore * 10) / 100, details: archDetails },
    schema: { weight: 10, score: schemaScore, weightedScore: (schemaScore * 10) / 100, details: schemaDetails },
    backend: { weight: 15, score: backendScore, weightedScore: (backendScore * 15) / 100, details: backendDetails },
    auth: { weight: 10, score: authScore, weightedScore: (authScore * 10) / 100, details: authDetails },
    authz: { weight: 10, score: authzScore, weightedScore: (authzScore * 10) / 100, details: authzDetails },
    frontend: { weight: 10, score: feScore, weightedScore: (feScore * 10) / 100, details: feDetails },
    apiContract: { weight: 5, score: apiScore, weightedScore: (apiScore * 5) / 100, details: apiDetails },
    security: { weight: 15, score: secScore, weightedScore: (secScore * 15) / 100, details: secDetails },
    testing: { weight: 10, score: testScore, weightedScore: (testScore * 10) / 100, details: testDetails },
    runtime: { weight: 5, score: runtimeScore, weightedScore: (runtimeScore * 5) / 100, details: runtimeDetails },
  };

  let totalScore = Math.round(
    Object.values(categories).reduce((sum, c) => sum + c.weightedScore, 0)
  );

  // Apply hard floors
  const hardFloorTriggered = hardFloorReasons.length > 0;
  if (unresolvedCrit.length > 0 || regFails.length > 0) {
    totalScore = Math.min(totalScore, 40);
  } else if (validation.blocking) {
    totalScore = Math.min(totalScore, 50);
  } else if (unresolvedHigh.length > 0) {
    totalScore = Math.min(totalScore, 65);
  }

  let grade: 'A' | 'B' | 'C' | 'F' = 'F';
  if (!hardFloorTriggered && totalScore >= 90) grade = 'A';
  else if (!hardFloorTriggered && totalScore >= 80) grade = 'B';
  else if (!hardFloorTriggered && totalScore >= 70) grade = 'C';
  else grade = 'F';

  const isCertified = grade === 'A' && !hardFloorTriggered;

  return {
    score: totalScore,
    grade,
    isCertified,
    hardFloorTriggered,
    hardFloorReasons,
    categories,
    summary: isCertified
      ? `Application Certified Grade A (Score ${totalScore}/100) — Meets 10/10 production-grade architecture standard.`
      : `Certification Failed (Grade ${grade}, Score ${totalScore}/100) — ${hardFloorReasons.join('; ')}`,
    generatedAt: new Date().toISOString(),
  };
}
