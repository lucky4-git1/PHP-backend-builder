/**
 * Permanent Regression Fixtures A–J
 * 10 canonical specifications covering every major generator code path.
 * Each fixture generates a full project and validates key invariants.
 */
import { generateProject } from '@/lib/generator';
import { templateBlog, emptyProject, uid } from '@/lib/builder';
import { validateAuthRouteContract } from '@/security/authContract';
import type { GenFile } from '@/lib/builder';

export interface FixtureResult {
  fixture: string;
  label: string;
  passed: boolean;
  checks: { name: string; passed: boolean; detail: string }[];
}

function byPath(files: GenFile[], p: string): string {
  return files.find((f) => f.path === p)?.content ?? '';
}

// Fixture A: No-auth minimal — zero auth artifacts
function fixtureA(): FixtureResult {
  const b = emptyProject('fixture-a-noauth');
  b.tables = [{
    id: uid('t'), name: 'items', comment: '', timestamps: true, softDeletes: false,
    columns: [
      { id: uid('c'), name: 'id', type: 'bigint', nullable: false, unique: false, defaultValue: '', isAutoIncrement: true, isPrimaryKey: true },
      { id: uid('c'), name: 'title', type: 'varchar', nullable: false, unique: false, defaultValue: '', isAutoIncrement: false, isPrimaryKey: false },
      { id: uid('c'), name: 'created_at', type: 'timestamp', nullable: true, unique: false, defaultValue: '', isAutoIncrement: false, isPrimaryKey: false },
    ],
  }];
  b.auth.strategy = 'none';
  const files = generateProject(b);
  const checks = [
    { name: 'No Jwt.php', passed: !files.some(f => f.path.includes('Jwt.php')), detail: '' },
    { name: 'No AuthController', passed: !files.some(f => f.path.includes('AuthController')), detail: '' },
    { name: 'No /auth/ in index.php', passed: !byPath(files, 'backend/public/index.php').includes('/auth/'), detail: '' },
    { name: 'No login.html', passed: !files.some(f => f.path.includes('login.html')), detail: '' },
    { name: 'No refresh_tokens', passed: !files.some(f => f.path.includes('refresh_tokens')), detail: '' },
    { name: 'No requireAuth', passed: !byPath(files, 'backend/public/index.php').includes('requireAuth'), detail: '' },
  ];
  return { fixture: 'A', label: 'No-auth minimal — zero auth artifacts', passed: checks.every(c => c.passed), checks };
}

// Fixture B: JWT full auth — all auth routes via canonical contract
function fixtureB(): FixtureResult {
  const b = templateBlog();
  const files = generateProject(b);
  const contract = validateAuthRouteContract(files, b.auth, b.config.apiPrefix);
  const index = byPath(files, 'backend/public/index.php');
  const checks = [
    { name: 'Auth contract match', passed: contract.passed, detail: contract.mismatches.join('; ') || 'all match' },
    { name: '/auth/register in router', passed: index.includes("/auth/register'"), detail: '' },
    { name: '/auth/login in router', passed: index.includes("/auth/login'"), detail: '' },
    { name: '/auth/refresh in router', passed: index.includes("/auth/refresh'"), detail: '' },
    { name: '/auth/logout in router', passed: index.includes("/auth/logout'"), detail: '' },
    { name: '/auth/me in router', passed: index.includes("/auth/me'"), detail: '' },
    { name: 'Jwt.php exists', passed: files.some(f => f.path.includes('Jwt.php')), detail: '' },
    { name: 'AuthController exists', passed: files.some(f => f.path.includes('AuthController')), detail: '' },
  ];
  return { fixture: 'B', label: 'JWT full auth — canonical contract', passed: checks.every(c => c.passed), checks };
}

// Fixture C: Existing auth provider (Supabase-style) — no JWT generation
function fixtureC(): FixtureResult {
  const b = emptyProject('fixture-c-existing');
  b.tables = [{
    id: uid('t'), name: 'profiles', comment: '', timestamps: true, softDeletes: false,
    columns: [
      { id: uid('c'), name: 'id', type: 'bigint', nullable: false, unique: false, defaultValue: '', isAutoIncrement: true, isPrimaryKey: true },
      { id: uid('c'), name: 'user_id', type: 'bigint', nullable: false, unique: false, defaultValue: '', isAutoIncrement: false, isPrimaryKey: false },
      { id: uid('c'), name: 'bio', type: 'text', nullable: true, unique: false, defaultValue: '', isAutoIncrement: false, isPrimaryKey: false },
    ],
  }];
  b.auth.strategy = 'existing';
  const files = generateProject(b);
  const checks = [
    { name: 'No local JWT issueTokens', passed: !files.some(f => f.content.includes('issueTokens')), detail: '' },
    { name: 'ProfileController exists', passed: files.some(f => f.path.includes('ProfileController')), detail: '' },
  ];
  return { fixture: 'C', label: 'Existing auth — no JWT generation', passed: checks.every(c => c.passed), checks };
}

// Fixture D: CRUD completeness — all 6 HTTP methods per resource
function fixtureD(): FixtureResult {
  const b = templateBlog();
  const files = generateProject(b);
  const index = byPath(files, 'backend/public/index.php');
  const prefix = b.config.apiPrefix;
  const tables = ['users', 'posts', 'comments'];
  const checks: { name: string; passed: boolean; detail: string }[] = [];
  for (const t of tables) {
    checks.push({ name: `GET ${t} list`, passed: index.includes(`'GET', '${prefix}/${t}'`), detail: '' });
    checks.push({ name: `GET ${t}/{id}`, passed: index.includes(`'GET', '${prefix}/${t}/{id}'`), detail: '' });
    checks.push({ name: `POST ${t}`, passed: index.includes(`'POST', '${prefix}/${t}'`), detail: '' });
    checks.push({ name: `PUT ${t}/{id}`, passed: index.includes(`'PUT', '${prefix}/${t}/{id}'`), detail: '' });
    checks.push({ name: `PATCH ${t}/{id}`, passed: index.includes(`'PATCH', '${prefix}/${t}/{id}'`), detail: '' });
    checks.push({ name: `DELETE ${t}/{id}`, passed: index.includes(`'DELETE', '${prefix}/${t}/{id}'`), detail: '' });
  }
  return { fixture: 'D', label: 'CRUD completeness — all methods per resource', passed: checks.every(c => c.passed), checks };
}

// Fixture E: Ownership/IDOR — ownership check on tables with user_id
function fixtureE(): FixtureResult {
  const b = templateBlog();
  const files = generateProject(b);
  const postCtrl = byPath(files, 'backend/controllers/PostController.php');
  const commentCtrl = byPath(files, 'backend/controllers/CommentController.php');
  const userCtrl = byPath(files, 'backend/controllers/UserController.php');
  const checks = [
    { name: 'PostController has IDOR check', passed: postCtrl.includes('Access denied: you do not own this resource'), detail: '' },
    { name: 'PostController checks user_id', passed: postCtrl.includes("$existing['user_id']"), detail: '' },
    { name: 'CommentController has IDOR check', passed: commentCtrl.includes('Access denied: you do not own this resource'), detail: '' },
    { name: 'UserController has NO IDOR (is auth resource)', passed: !userCtrl.includes('Access denied: you do not own this resource'), detail: '' },
    { name: 'Admin bypass in PostController', passed: postCtrl.includes("'admin'"), detail: '' },
  ];
  return { fixture: 'E', label: 'Ownership/IDOR enforcement', passed: checks.every(c => c.passed), checks };
}

// Fixture F: Frontend-only validation — api-client + auth store + pages
function fixtureF(): FixtureResult {
  const b = templateBlog();
  const files = generateProject(b);
  const checks = [
    { name: 'api-client.js exists', passed: files.some(f => f.path === 'frontend/api-client.js'), detail: '' },
    { name: 'auth-store.js exists', passed: files.some(f => f.path === 'frontend/auth/auth-store.js'), detail: '' },
    { name: 'protected-route.js exists', passed: files.some(f => f.path === 'frontend/auth/protected-route.js'), detail: '' },
    { name: 'login.html exists', passed: files.some(f => f.path === 'frontend/auth/login.html'), detail: '' },
    { name: 'register.html exists', passed: files.some(f => f.path === 'frontend/auth/register.html'), detail: '' },
    { name: 'login.js exists', passed: files.some(f => f.path === 'frontend/auth/login.js'), detail: '' },
    { name: 'register.js exists', passed: files.some(f => f.path === 'frontend/auth/register.js'), detail: '' },
  ];
  return { fixture: 'F', label: 'Frontend auth scaffolding', passed: checks.every(c => c.passed), checks };
}

// Fixture G: Foreign key / topological migration ordering
function fixtureG(): FixtureResult {
  const b = templateBlog();
  const files = generateProject(b);
  const migNames = files.filter(f => f.path.includes('migrations/')).map(f => f.path.split('/').pop()!).sort();
  const userIdx = migNames.findIndex(n => n.includes('_users'));
  const postIdx = migNames.findIndex(n => n.includes('_posts'));
  const commentIdx = migNames.findIndex(n => n.includes('_comments'));
  const refreshIdx = migNames.findIndex(n => n.includes('refresh_tokens'));
  const checks = [
    { name: 'users before posts', passed: userIdx >= 0 && postIdx >= 0 && userIdx < postIdx, detail: `users=${userIdx}, posts=${postIdx}` },
    { name: 'posts before comments', passed: postIdx >= 0 && commentIdx >= 0 && postIdx < commentIdx, detail: `posts=${postIdx}, comments=${commentIdx}` },
    { name: 'refresh_tokens after users', passed: userIdx >= 0 && refreshIdx >= 0 && refreshIdx > userIdx, detail: `users=${userIdx}, refresh=${refreshIdx}` },
    { name: 'Schema has FK constraints', passed: byPath(files, 'database/schema.sql').includes('FOREIGN KEY'), detail: '' },
  ];
  return { fixture: 'G', label: 'FK topological migration order', passed: checks.every(c => c.passed), checks };
}

// Fixture H: Pagination/sort — allowlist and safe direction
function fixtureH(): FixtureResult {
  const b = templateBlog();
  const files = generateProject(b);
  const model = byPath(files, 'backend/support/Model.php');
  const postCtrl = byPath(files, 'backend/controllers/PostController.php');
  const checks = [
    { name: 'Model has $allowedSorts', passed: model.includes('$allowedSorts'), detail: '' },
    { name: 'Model has $safeSort', passed: model.includes('$safeSort'), detail: '' },
    { name: 'Model has $safeDir', passed: model.includes('$safeDir'), detail: '' },
    { name: 'Controller has allowedSorts', passed: postCtrl.includes('$allowedSorts'), detail: '' },
    { name: 'Controller enforces in_array sort', passed: postCtrl.includes('in_array($sortParam'), detail: '' },
    { name: 'Controller limits per_page', passed: postCtrl.includes('min(100,'), detail: '' },
  ];
  return { fixture: 'H', label: 'Pagination/sort allowlisting', passed: checks.every(c => c.passed), checks };
}

// Fixture I: Complete auth frontend — all pages wire to auth-store
function fixtureI(): FixtureResult {
  const b = templateBlog();
  const files = generateProject(b);
  const authStore = byPath(files, 'frontend/auth/auth-store.js');
  const loginJs = byPath(files, 'frontend/auth/login.js');
  const registerJs = byPath(files, 'frontend/auth/register.js');
  const protectedRoute = byPath(files, 'frontend/auth/protected-route.js');
  const checks = [
    { name: 'auth-store has login()', passed: authStore.includes('login'), detail: '' },
    { name: 'auth-store has register()', passed: authStore.includes('register'), detail: '' },
    { name: 'auth-store has logout()', passed: authStore.includes('logout'), detail: '' },
    { name: 'auth-store has refresh()', passed: authStore.includes('refresh'), detail: '' },
    { name: 'login.js imports api-client', passed: loginJs.includes('api-client'), detail: '' },
    { name: 'register.js imports api-client', passed: registerJs.includes('api-client'), detail: '' },
    { name: 'protected-route imports auth-store', passed: protectedRoute.includes('auth-store'), detail: '' },
  ];
  return { fixture: 'I', label: 'Complete auth frontend wiring', passed: checks.every(c => c.passed), checks };
}

// Fixture J: Admin/RBAC — requireRole present, admin bypass
function fixtureJ(): FixtureResult {
  const b = templateBlog();
  const files = generateProject(b);
  const index = byPath(files, 'backend/public/index.php');
  const postCtrl = byPath(files, 'backend/controllers/PostController.php');
  const checks = [
    { name: 'requireRole function exists', passed: index.includes('function requireRole'), detail: '' },
    { name: 'requireRole checks role array', passed: index.includes("in_array($role, $roles, true)"), detail: '' },
    { name: 'Admin bypass in ownership', passed: postCtrl.includes("'admin'"), detail: '' },
    { name: 'RBAC 403 on forbidden', passed: index.includes("'Forbidden', 403"), detail: '' },
  ];
  return { fixture: 'J', label: 'Admin/RBAC enforcement', passed: checks.every(c => c.passed), checks };
}

export function runAllPermanentFixtures(): FixtureResult[] {
  return [
    fixtureA(),
    fixtureB(),
    fixtureC(),
    fixtureD(),
    fixtureE(),
    fixtureF(),
    fixtureG(),
    fixtureH(),
    fixtureI(),
    fixtureJ(),
  ];
}
