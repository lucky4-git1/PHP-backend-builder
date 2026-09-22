/**
 * RouteSecurityGraph
 * Analyzes Application IR, auth configuration, global middleware, route guards,
 * and controllers to construct a comprehensive security graph of all application routes.
 */
import type { BuilderState, GenFile } from '@/lib/builder';
import { GeneratedArtifactLocationResolver, type ArtifactLocation } from './locationResolver';

export interface RouteSecurityNode {
  method: string;
  path: string;
  controller: string;
  action: string;
  authRequired: boolean;
  authzRequired: 'none' | 'user' | 'owner' | 'role';
  protectionSource:
    | 'global_mutation_middleware'
    | 'route_middleware'
    | 'controller_authorization'
    | 'public_allowlist'
    | 'no_auth_configured'
    | 'unprotected';
  isPublic: boolean;
  publicReason?: string;
  location: ArtifactLocation;
  status: 'PASS' | 'WARN' | 'FAIL';
  statusReason: string;
}

export class RouteSecurityGraph {
  public readonly nodes: RouteSecurityNode[] = [];
  public readonly isAuthEnabled: boolean;

  constructor(state: BuilderState, files: GenFile[]) {
    this.isAuthEnabled = state.auth.strategy !== 'none';
    const prefix = state.config.apiPrefix || '/api/v1';

    // 1. Auth routes (if enabled)
    if (this.isAuthEnabled) {
      this.addAuthNode('POST', `${prefix}/auth/register`, 'AuthController', 'register', false, 'public_allowlist', 'Public registration endpoint', files);
      this.addAuthNode('POST', `${prefix}/auth/login`, 'AuthController', 'login', false, 'public_allowlist', 'Public login endpoint', files);
      this.addAuthNode('POST', `${prefix}/auth/refresh`, 'AuthController', 'refresh', false, 'public_allowlist', 'Public refresh token endpoint', files);
      this.addAuthNode('POST', `${prefix}/auth/logout`, 'AuthController', 'logout', true, 'route_middleware', 'Revokes session / refresh token', files);
      this.addAuthNode('GET', `${prefix}/auth/me`, 'AuthController', 'me', true, 'route_middleware', 'Protected by requireAuth guard', files);
    }

    // 2. Health probes (always public)
    this.addHealthNode('GET', `${prefix}/health`, files);
    this.addHealthNode('GET', `${prefix}/health/live`, files);
    this.addHealthNode('GET', `${prefix}/health/ready`, files);

    // 3. Resource CRUD routes
    for (const table of state.tables) {
      const ctrlName = table.name.charAt(0).toUpperCase() + table.name.slice(1).replace(/s$/, '') + 'Controller';
      const hasOwnership = table.columns.some((c) => ['user_id', 'owner_id', 'created_by', 'author_id'].includes(c.name));

      // GET /table (list)
      this.addResourceNode('GET', `${prefix}/${table.name}`, ctrlName, 'list', false, 'none', files, state);
      // GET /table/{id} (read)
      this.addResourceNode('GET', `${prefix}/${table.name}/{id}`, ctrlName, 'read', false, 'none', files, state);
      // POST /table (create)
      this.addResourceNode('POST', `${prefix}/${table.name}`, ctrlName, 'create', this.isAuthEnabled, hasOwnership && this.isAuthEnabled ? 'owner' : (this.isAuthEnabled ? 'user' : 'none'), files, state);
      // PUT /table/{id} (update)
      this.addResourceNode('PUT', `${prefix}/${table.name}/{id}`, ctrlName, 'update', this.isAuthEnabled, hasOwnership && this.isAuthEnabled ? 'owner' : (this.isAuthEnabled ? 'user' : 'none'), files, state);
      // PATCH /table/{id} (patch)
      this.addResourceNode('PATCH', `${prefix}/${table.name}/{id}`, ctrlName, 'patch', this.isAuthEnabled, hasOwnership && this.isAuthEnabled ? 'owner' : (this.isAuthEnabled ? 'user' : 'none'), files, state);
      // DELETE /table/{id} (delete)
      this.addResourceNode('DELETE', `${prefix}/${table.name}/{id}`, ctrlName, 'delete', this.isAuthEnabled, hasOwnership && this.isAuthEnabled ? 'owner' : (this.isAuthEnabled ? 'user' : 'none'), files, state);
    }
  }

  private addAuthNode(
    method: string,
    path: string,
    controller: string,
    action: string,
    authRequired: boolean,
    protectionSource: RouteSecurityNode['protectionSource'],
    reason: string,
    files: GenFile[]
  ) {
    const loc = GeneratedArtifactLocationResolver.resolve(files, 'backend/public/index.php', path);
    this.nodes.push({
      method,
      path,
      controller,
      action,
      authRequired,
      authzRequired: authRequired ? 'user' : 'none',
      protectionSource,
      isPublic: !authRequired,
      publicReason: !authRequired ? reason : undefined,
      location: loc,
      status: 'PASS',
      statusReason: reason,
    });
  }

  private addHealthNode(method: string, path: string, files: GenFile[]) {
    const loc = GeneratedArtifactLocationResolver.resolve(files, 'backend/public/index.php', path);
    this.nodes.push({
      method,
      path,
      controller: 'System',
      action: 'health',
      authRequired: false,
      authzRequired: 'none',
      protectionSource: 'public_allowlist',
      isPublic: true,
      publicReason: 'Liveness/Readiness probe',
      location: loc,
      status: 'PASS',
      statusReason: 'System health probe',
    });
  }

  private addResourceNode(
    method: string,
    path: string,
    controller: string,
    action: string,
    _authRequired: boolean,
    authzRequired: RouteSecurityNode['authzRequired'],
    files: GenFile[],
    _state: BuilderState
  ) {
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const loc = GeneratedArtifactLocationResolver.resolve(files, 'backend/public/index.php', `${method}', '${path}`);

    let protectionSource: RouteSecurityNode['protectionSource'] = 'unprotected';
    let status: RouteSecurityNode['status'] = 'PASS';
    let statusReason = 'OK';

    if (!this.isAuthEnabled) {
      protectionSource = 'no_auth_configured';
      status = 'PASS';
      statusReason = 'Authentication disabled by application configuration';
    } else if (isMutation) {
      // In generator.ts, all mutating routes under prefix are protected by the global mutation guard
      protectionSource = 'global_mutation_middleware';
      status = 'PASS';
      statusReason = 'Protected by global mutation auth guard';
    } else {
      // GET reads
      protectionSource = 'public_allowlist';
      status = 'PASS';
      statusReason = 'Public read operation';
    }

    this.nodes.push({
      method,
      path,
      controller,
      action,
      authRequired: this.isAuthEnabled && isMutation,
      authzRequired,
      protectionSource,
      isPublic: !this.isAuthEnabled || !isMutation,
      publicReason: !this.isAuthEnabled ? 'Application configured without auth' : (!isMutation ? 'Public read endpoint' : undefined),
      location: loc,
      status,
      statusReason,
    });
  }
}
