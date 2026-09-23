/**
 * Canonical Single Endpoint Security Policy
 * Single source of truth for Application IR -> Router -> Middleware -> Controllers -> OpenAPI -> Frontend -> Tests -> Certification
 *
 * Implements Master Prompt Phase 1, Phase 2, Phase 6, Phase 7, Phase 24.
 */
import type { BuilderState, BuilderTable } from '@/lib/builder';

export interface EndpointOwnershipPolicy {
  field: string;
  subjectClaim: string; // e.g. 'sub'
}

export interface EndpointSecurityPolicy {
  authentication: 'public' | 'required' | 'optional';
  roles: string[];
  ownership: EndpointOwnershipPolicy | null;
  sources: ('global' | 'route' | 'controller' | 'ir')[];
  isPublic: boolean;
  description?: string;
}

export interface ResolvedEndpointSecurity {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  controller: string;
  action: string;
  table?: string;
  isAuthResource: boolean;
  security: EndpointSecurityPolicy;
}

const OWNER_FIELD_CANDIDATES = [
  'user_id',
  'owner_id',
  'created_by',
  'author_id',
  'customer_id',
  'account_id',
  'member_id',
];

export function getOwnerColumn(table: BuilderTable): string | null {
  const found = table.columns.find((c) => OWNER_FIELD_CANDIDATES.includes(c.name.toLowerCase()));
  return found ? found.name : null;
}

/**
 * Resolves the canonical effective security policy for any given route and method.
 */
export function resolveEffectiveSecurity(
  method: string,
  path: string,
  state: BuilderState
): EndpointSecurityPolicy {
  const normMethod = method.toUpperCase();
  const prefix = (state.config.apiPrefix || '/api/v1').replace(/\/$/, '');
  const isAuthEnabled = state.auth.strategy !== 'none';

  // 1. Health endpoints are unconditionally public and root-only
  if (path === '/health' || path === '/health/live' || path === '/health/ready') {
    return {
      authentication: 'public',
      roles: [],
      ownership: null,
      sources: ['global', 'route', 'ir'],
      isPublic: true,
      description: 'Public health and liveness probes',
    };
  }

  // 2. Authentication Subsystem endpoints
  const authPrefix = `${prefix}/auth`;
  if (path.startsWith(authPrefix)) {
    const sub = path.slice(authPrefix.length);

    // Public authentication routes
    if (sub === '/register' || sub === '/login' || sub === '/refresh' || sub === '/forgot-password' || sub === '/reset-password' || sub === '/verify-email') {
      return {
        authentication: 'public',
        roles: [],
        ownership: null,
        sources: ['route', 'ir'],
        isPublic: true,
        description: 'Public authentication credential exchange / recovery',
      };
    }

    // Protected auth routes
    if (sub === '/logout' || sub === '/me') {
      return {
        authentication: isAuthEnabled ? 'required' : 'public',
        roles: [],
        ownership: null,
        sources: ['route', 'ir'],
        isPublic: !isAuthEnabled,
        description: sub === '/logout' ? 'Session revocation' : 'Current authenticated user profile',
      };
    }
  }

  // If auth is completely disabled for the application, all application routes are public
  if (!isAuthEnabled) {
    return {
      authentication: 'public',
      roles: [],
      ownership: null,
      sources: ['global', 'ir'],
      isPublic: true,
      description: 'Public API mode (auth disabled)',
    };
  }

  // 3. Resource CRUD endpoints
  const relPath = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  const segments = relPath.split('/').filter(Boolean);
  const resourceName = segments[0] || '';
  const isItem = segments.length > 1;

  const table = state.tables.find((t) => t.name.toLowerCase() === resourceName.toLowerCase());

  // 3A. Dedicated Users Identity Resource Security Policy (Phase 2 & 3)
  if (table && table.name.toLowerCase() === 'users') {
    if (normMethod === 'GET' && !isItem) {
      // GET /users -> ADMIN ONLY
      return {
        authentication: 'required',
        roles: ['admin'],
        ownership: null,
        sources: ['controller', 'ir'],
        isPublic: false,
        description: 'User directory listing restricted to administrators',
      };
    }
    if (normMethod === 'GET' && isItem) {
      // GET /users/{id} -> ADMIN OR SELF
      return {
        authentication: 'required',
        roles: ['admin'],
        ownership: { field: 'id', subjectClaim: 'sub' },
        sources: ['controller', 'ir'],
        isPublic: false,
        description: 'User inspection restricted to administrator or self',
      };
    }
    if (normMethod === 'POST') {
      // POST /users -> ADMIN ONLY (Public registration uses /auth/register)
      return {
        authentication: 'required',
        roles: ['admin'],
        ownership: null,
        sources: ['controller', 'ir'],
        isPublic: false,
        description: 'User provisioning restricted to administrators',
      };
    }
    if ((normMethod === 'PUT' || normMethod === 'PATCH') && isItem) {
      // PUT / PATCH /users/{id} -> ADMIN OR SELF (with administrative fields locked)
      return {
        authentication: 'required',
        roles: ['admin'],
        ownership: { field: 'id', subjectClaim: 'sub' },
        sources: ['controller', 'ir'],
        isPublic: false,
        description: 'User mutation restricted to administrator or self',
      };
    }
    if (normMethod === 'DELETE') {
      // DELETE /users/{id} -> ADMIN ONLY
      return {
        authentication: 'required',
        roles: ['admin'],
        ownership: null,
        sources: ['controller', 'ir'],
        isPublic: false,
        description: 'User de-provisioning restricted to administrators',
      };
    }
  }

  // 3B. Business Resource Tables
  if (table) {
    const ownerCol = getOwnerColumn(table);
    const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(normMethod);

    if (ownerCol) {
      if (isMutating) {
        return {
          authentication: 'required',
          roles: [],
          ownership: { field: ownerCol, subjectClaim: 'sub' },
          sources: ['global', 'controller', 'ir'],
          isPublic: false,
          description: `Resource mutation enforced by row-level ownership on ${ownerCol}`,
        };
      }
      return {
        authentication: state.auth.protectedRoutes ? 'required' : 'public',
        roles: [],
        ownership: null,
        sources: ['global', 'ir'],
        isPublic: !state.auth.protectedRoutes,
        description: state.auth.protectedRoutes ? 'Protected read access' : 'Public read access',
      };
    }

    // Un-owned resource
    if (isMutating) {
      return {
        authentication: 'required',
        roles: [],
        ownership: null,
        sources: ['global', 'ir'],
        isPublic: false,
        description: 'Authenticated mutation',
      };
    }

    return {
      authentication: state.auth.protectedRoutes ? 'required' : 'public',
      roles: [],
      ownership: null,
      sources: ['global', 'ir'],
      isPublic: !state.auth.protectedRoutes,
      description: state.auth.protectedRoutes ? 'Protected read access' : 'Public read access',
    };
  }

  // 4. Custom endpoints from state.endpoints
  const custom = state.endpoints.find(
    (e) => e.method.toUpperCase() === normMethod && (e.path === path || `${prefix}${e.path}` === path)
  );
  if (custom) {
    const authReq = custom.auth === 'required';
    return {
      authentication: authReq ? 'required' : 'public',
      roles: [],
      ownership: null,
      sources: ['route', 'ir'],
      isPublic: !authReq,
      description: custom.description || 'Custom endpoint',
    };
  }

  // Default fallback
  return {
    authentication: isAuthEnabled ? 'required' : 'public',
    roles: [],
    ownership: null,
    sources: ['global'],
    isPublic: !isAuthEnabled,
  };
}

/**
 * Returns all application endpoints with their resolved effective security.
 */
export function getAllEndpointsWithSecurity(state: BuilderState): ResolvedEndpointSecurity[] {
  const out: ResolvedEndpointSecurity[] = [];
  const prefix = (state.config.apiPrefix || '/api/v1').replace(/\/$/, '');

  // 1. Health Probes (canonical root only)
  for (const h of ['/health', '/health/live', '/health/ready']) {
    out.push({
      method: 'GET',
      path: h,
      controller: 'HealthController',
      action: h.replace('/', '').replace('/', '_') || 'health',
      isAuthResource: false,
      security: resolveEffectiveSecurity('GET', h, state),
    });
  }

  // 2. Auth Subsystem Endpoints
  if (state.auth.strategy !== 'none' && state.auth.strategy !== 'existing') {
    const authOps: Array<{ method: 'GET' | 'POST' | 'PATCH'; sub: string; action: string }> = [
      { method: 'POST', sub: '/register', action: 'register' },
      { method: 'POST', sub: '/login', action: 'login' },
      { method: 'POST', sub: '/refresh', action: 'refresh' },
      { method: 'POST', sub: '/logout', action: 'logout' },
      { method: 'GET', sub: '/me', action: 'me' },
      { method: 'PATCH', sub: '/me', action: 'updateProfile' },
    ];
    if (state.auth.forgotPassword) {
      authOps.push({ method: 'POST', sub: '/forgot-password', action: 'forgotPassword' });
    }
    if (state.auth.resetPassword) {
      authOps.push({ method: 'POST', sub: '/reset-password', action: 'resetPassword' });
    }
    if (state.auth.emailVerification) {
      authOps.push({ method: 'POST', sub: '/verify-email', action: 'verifyEmail' });
    }

    for (const op of authOps) {
      const fullPath = `${prefix}/auth${op.sub}`;
      out.push({
        method: op.method,
        path: fullPath,
        controller: 'AuthController',
        action: op.action,
        isAuthResource: true,
        security: resolveEffectiveSecurity(op.method, fullPath, state),
      });
    }
  }

  // 3. Resource CRUD Tables
  for (const t of state.tables) {
    const cls = t.name.charAt(0).toUpperCase() + t.name.slice(1).replace(/s$/, '');
    const ctrl = `${cls}Controller`;
    const isUsers = t.name.toLowerCase() === 'users';

    const crudOps: Array<{ method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; action: string }> = [
      { method: 'GET', path: `${prefix}/${t.name}`, action: 'list' },
      { method: 'POST', path: `${prefix}/${t.name}`, action: 'create' },
      { method: 'GET', path: `${prefix}/${t.name}/{id}`, action: 'read' },
      { method: 'PUT', path: `${prefix}/${t.name}/{id}`, action: 'update' },
      { method: 'PATCH', path: `${prefix}/${t.name}/{id}`, action: 'patch' },
      { method: 'DELETE', path: `${prefix}/${t.name}/{id}`, action: 'delete' },
    ];

    for (const op of crudOps) {
      out.push({
        method: op.method,
        path: op.path,
        controller: ctrl,
        action: op.action,
        table: t.name,
        isAuthResource: isUsers,
        security: resolveEffectiveSecurity(op.method, op.path, state),
      });
    }
  }

  return out;
}
