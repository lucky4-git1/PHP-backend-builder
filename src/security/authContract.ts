/**
 * Canonical Authentication Route Contract
 * Single source of truth for Application IR -> Router -> OpenAPI -> API Client -> Frontend Auth Store -> Tests.
 *
 * Invariant: AUTH_ROUTE_CONTRACT_MATCH
 */
import type { BuilderAuth, GenFile } from '@/lib/builder';

export interface CanonicalAuthRoute {
  method: 'GET' | 'POST';
  pathSuffix: string; // e.g. '/auth/register'
  handlerAction: string; // e.g. 'register'
  authRequired: boolean;
  summary: string;
  description: string;
  requestSchemaRef?: string;
  responseSchemaRef?: string;
}

export function getCanonicalAuthRoutes(
  auth: BuilderAuth,
  apiPrefix = '/api/v1'
): Array<CanonicalAuthRoute & { fullPath: string }> {
  if (auth.strategy === 'none' || auth.strategy === 'existing') return [];

  const cleanPrefix = apiPrefix.endsWith('/') && apiPrefix.length > 1 ? apiPrefix.slice(0, -1) : apiPrefix;

  const routes: CanonicalAuthRoute[] = [
    {
      method: 'POST',
      pathSuffix: '/auth/register',
      handlerAction: 'register',
      authRequired: false,
      summary: 'Register new user',
      description: 'Creates a new user record with secure bcrypt password hashing and issues tokens',
      requestSchemaRef: 'RegisterRequest',
      responseSchemaRef: 'AuthResponse',
    },
    {
      method: 'POST',
      pathSuffix: '/auth/login',
      handlerAction: 'login',
      authRequired: false,
      summary: 'User login',
      description: 'Authenticates credentials and returns JWT access and refresh tokens',
      requestSchemaRef: 'LoginRequest',
      responseSchemaRef: 'AuthResponse',
    },
    {
      method: 'POST',
      pathSuffix: '/auth/refresh',
      handlerAction: 'refresh',
      authRequired: false,
      summary: 'Refresh access token',
      description: 'Single-use refresh token exchange with rotation and replay protection',
      requestSchemaRef: 'RefreshRequest',
      responseSchemaRef: 'AuthResponse',
    },
    {
      method: 'POST',
      pathSuffix: '/auth/logout',
      handlerAction: 'logout',
      authRequired: false,
      summary: 'User logout',
      description: 'Revokes active refresh tokens on server and clears session',
    },
    {
      method: 'GET',
      pathSuffix: '/auth/me',
      handlerAction: 'me',
      authRequired: true,
      summary: 'Get current user profile',
      description: 'Returns profile of authenticated user from verified token claims',
      responseSchemaRef: 'User',
    },
  ];

  if (auth.forgotPassword) {
    routes.push({
      method: 'POST',
      pathSuffix: '/auth/forgot-password',
      handlerAction: 'forgotPassword',
      authRequired: false,
      summary: 'Request password reset',
      description: 'Generates password reset token',
    });
  }

  if (auth.resetPassword) {
    routes.push({
      method: 'POST',
      pathSuffix: '/auth/reset-password',
      handlerAction: 'resetPassword',
      authRequired: false,
      summary: 'Reset password',
      description: 'Verifies reset token and updates password',
    });
  }

  if (auth.emailVerification) {
    routes.push({
      method: 'POST',
      pathSuffix: '/auth/verify-email',
      handlerAction: 'verifyEmail',
      authRequired: true,
      summary: 'Verify email address',
      description: 'Confirms email verification code',
    });
  }

  return routes.map((r) => ({
    ...r,
    fullPath: cleanPrefix + r.pathSuffix,
  }));
}

/**
 * Validates that all representations (Router, OpenAPI, API client, Frontend)
 * match the Canonical Auth Route Contract.
 */
export function validateAuthRouteContract(
  generated: GenFile[],
  auth: BuilderAuth,
  apiPrefix = '/api/v1'
): { passed: boolean; mismatches: string[] } {
  const mismatches: string[] = [];
  const canonical = getCanonicalAuthRoutes(auth, apiPrefix);

  if (auth.strategy === 'none' || auth.strategy === 'existing') {
    // In no-auth or existing-auth mode, zero local /auth/ routes must exist in index.php or openapi
    const front = generated.find((f) => f.path.includes('public/index.php'))?.content ?? '';
    const openapi = generated.find((f) => f.path.includes('openapi.json'))?.content ?? '';

    if (front.includes('/auth/')) mismatches.push(`${auth.strategy} mode: /auth routes leaked into index.php`);
    if (openapi.includes('/auth/')) mismatches.push(`${auth.strategy} mode: /auth paths leaked into openapi.json`);

    return { passed: mismatches.length === 0, mismatches };
  }

  const front = generated.find((f) => f.path.includes('public/index.php'))?.content ?? '';
  const oaFile = generated.find((f) => f.path.includes('openapi.json'))?.content;
  const client = generated.find((f) => f.path.includes('api-client.js'))?.content ?? '';
  const authStore = generated.find((f) => f.path.includes('auth-store.js'))?.content ?? '';

  let oaPaths: Record<string, any> = {};
  try {
    if (oaFile) oaPaths = JSON.parse(oaFile).paths || {};
  } catch (e) {
    mismatches.push(`OpenAPI invalid JSON: ${String(e)}`);
  }

  for (const cr of canonical) {
    // 1. Router verification
    const routerPattern = new RegExp(`\\$router->add\\(\\s*['"]${cr.method}['"]\\s*,\\s*['"]${cr.fullPath}['"]`);
    if (!routerPattern.test(front)) {
      mismatches.push(`PHP Router missing canonical route: ${cr.method} ${cr.fullPath}`);
    }

    // 2. OpenAPI verification
    const oaEntry = oaPaths[cr.fullPath];
    if (!oaEntry || !oaEntry[cr.method.toLowerCase()]) {
      mismatches.push(`OpenAPI documentation missing canonical route: ${cr.method} ${cr.fullPath}`);
    }

    // 3. API client verification
    if (!client.includes(cr.pathSuffix)) {
      mismatches.push(`api-client.js missing method calling: ${cr.pathSuffix}`);
    }
  }

  // 4. Frontend auth store verification
  if (!authStore.includes('login') || !authStore.includes('register') || !authStore.includes('logout') || !authStore.includes('refresh')) {
    mismatches.push('auth-store.js missing core authentication methods (login, register, logout, refresh)');
  }

  return {
    passed: mismatches.length === 0,
    mismatches,
  };
}
