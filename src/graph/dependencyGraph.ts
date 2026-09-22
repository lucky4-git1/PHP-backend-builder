/**
 * Application Dependency Graph & System Map Model
 * Canonical source of truth for architecture visualization, structural validation,
 * and system integrity verification.
 *
 * Invariant: Auth is represented as a subsystem.
 * Invariant: JWT provider is purely cryptographic and NEVER connects directly to MySQL.
 */
import type { BuilderState, GenFile } from '@/lib/builder';
import { toClassName } from '@/lib/builder';
import { getCanonicalAuthRoutes } from '@/security/authContract';

export type DependencyNodeType =
  | 'frontend'
  | 'api'
  | 'route'
  | 'controller'
  | 'service'
  | 'middleware'
  | 'auth-subsystem'
  | 'auth-provider'
  | 'model'
  | 'repository'
  | 'entity'
  | 'database'
  | 'migration'
  | 'schema'
  | 'openapi'
  | 'test'
  | 'configuration';

export type DependencyEdgeType =
  | 'CALLS'
  | 'ROUTES_TO'
  | 'USES'
  | 'READS'
  | 'WRITES'
  | 'PERSISTS_TO'
  | 'AUTHENTICATES_WITH'
  | 'AUTHORIZES_WITH'
  | 'GENERATES'
  | 'DOCUMENTS'
  | 'TESTS'
  | 'PROTECTS'
  | 'DEPENDS_ON';

export interface SystemMapNode {
  id: string;
  type: DependencyNodeType;
  label: string;
  description: string;
  files: string[];
  routes: string[];
  entities: string[];
  metadata?: Record<string, unknown>;
}

export interface DependencyEdge {
  from: string;
  to: string;
  type: DependencyEdgeType;
  label?: string;
}

export class ApplicationDependencyGraph {
  private nodes: Map<string, SystemMapNode> = new Map();
  private edges: DependencyEdge[] = [];

  public addNode(node: SystemMapNode): void {
    this.nodes.set(node.id, node);
  }

  public addEdge(edge: DependencyEdge): void {
    const exists = this.edges.some(
      (e) => e.from === edge.from && e.to === edge.to && e.type === edge.type
    );
    if (!exists) {
      this.edges.push(edge);
    }
  }

  public hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  public getNode(id: string): SystemMapNode | undefined {
    return this.nodes.get(id);
  }

  public getNodes(): SystemMapNode[] {
    return Array.from(this.nodes.values());
  }

  public getEdges(): DependencyEdge[] {
    return [...this.edges];
  }

  public hasEdge(from: string, to: string, type?: DependencyEdgeType): boolean {
    return this.edges.some(
      (e) => e.from === from && e.to === to && (type === undefined || e.type === type)
    );
  }

  public edgesFrom(id: string): DependencyEdge[] {
    return this.edges.filter((e) => e.from === id);
  }

  public edgesTo(id: string): DependencyEdge[] {
    return this.edges.filter((e) => e.to === id);
  }

  /**
   * Generates a structural Mermaid diagram representing the architecture.
   */
  public toMermaid(): string {
    const lines: string[] = ['graph TD'];

    // Define main nodes
    lines.push('  FE["Frontend (Client & UI)"]');
    lines.push('  API["PHP REST API"]');
    lines.push('  DB[("MySQL Database")]');

    // Frontend -> API
    lines.push('  FE -->|HTTP| API');

    // Middleware
    if (this.hasNode('middleware')) {
      lines.push('  API -->|enforces| MW["Security & CORS Middleware"]');
    }

    // Auth subsystem representation
    if (this.hasNode('authentication')) {
      lines.push('  API -->|dispatches| AUTH["Authentication Subsystem"]');
      lines.push('  AUTH -->|uses| JWT["JWT Provider (HS256)"]');
      lines.push('  AUTH -->|persists| U["User Store"]');
      lines.push('  AUTH -->|rotates| RT["Refresh Token Store"]');
      lines.push('  U -->|persists to| DB');
      lines.push('  RT -->|persists to| DB');
    } else if (this.hasNode('existing-auth')) {
      lines.push('  FE -->|authenticates| EXT["External Auth Provider"]');
      lines.push('  API -->|verifies tokens| EXT');
    }

    // Business resource controllers & models
    const entityNodes = this.getNodes().filter(
      (n) => n.type === 'entity' && n.id !== 'users' && n.id !== 'refresh_tokens'
    );
    entityNodes.slice(0, 8).forEach((n, idx) => {
      const cId = `C_${idx}`;
      lines.push(`  API -->|routes to| ${cId}["${n.label} Controller & Model"]`);
      lines.push(`  ${cId} -->|CRUD| DB`);
    });

    if (entityNodes.length === 0 && !this.hasNode('authentication')) {
      lines.push('  API -->|queries| DB');
    }

    return lines.join('\n');
  }
}

/**
 * Builds the canonical Application Dependency Graph from BuilderState and generated files.
 */
export function buildApplicationDependencyGraph(
  state: BuilderState,
  _generated: GenFile[] = []
): ApplicationDependencyGraph {
  const g = new ApplicationDependencyGraph();
  const prefix = state.config.apiPrefix || '/api/v1';

  // 1. Frontend Node
  g.addNode({
    id: 'frontend',
    type: 'frontend',
    label: 'Frontend Application',
    description: 'User interface and API client fetch library',
    files: ['frontend/api-client.js'],
    routes: [],
    entities: [],
  });

  // 2. API Front Controller Node
  g.addNode({
    id: 'api',
    type: 'api',
    label: `PHP API (${prefix})`,
    description: 'HTTP Front Controller, Request routing, Response envelope, and Container DI bootstrap',
    files: ['backend/public/index.php', 'backend/support/Router.php', 'backend/support/Container.php'],
    routes: state.endpoints.map((e) => `${e.method} ${prefix}${e.path}`),
    entities: state.tables.map((t) => t.name),
  });
  g.addEdge({ from: 'frontend', to: 'api', type: 'CALLS', label: 'HTTP' });

  // 3. Middleware Node
  g.addNode({
    id: 'middleware',
    type: 'middleware',
    label: 'Security & Rate Limiting Middleware',
    description: 'CORS policy, Security headers, Rate limiting, and Auth guards',
    files: ['backend/support/Middleware.php', 'backend/support/RequestId.php'],
    routes: [],
    entities: [],
  });
  g.addEdge({ from: 'api', to: 'middleware', type: 'USES' });
  g.addEdge({ from: 'middleware', to: 'api', type: 'PROTECTS' });

  // 4. Database Node
  g.addNode({
    id: 'mysql',
    type: 'database',
    label: `MySQL (${state.config.dbName})`,
    description: 'Relational MySQL 8.0+ persistent storage with InnoDB and utf8mb4',
    files: ['database/schema.sql', 'database/migrate.php'],
    routes: [],
    entities: state.tables.map((t) => t.name),
  });

  // 5. Authentication Subsystem
  if (state.auth.strategy === 'jwt') {
    const canonicalRoutes = getCanonicalAuthRoutes(state.auth, prefix);
    const routeStrings = canonicalRoutes.map((r) => `${r.method} ${r.fullPath}`);

    // Auth Subsystem Node
    g.addNode({
      id: 'authentication',
      type: 'auth-subsystem',
      label: 'Authentication Subsystem',
      description: 'End-to-end user authentication, bcrypt password hashing, token issuance, refresh rotation, and revocation',
      files: ['backend/controllers/AuthController.php', 'backend/services/AuthService.php'],
      routes: routeStrings,
      entities: ['users', 'refresh_tokens'],
    });
    g.addEdge({ from: 'api', to: 'authentication', type: 'ROUTES_TO' });
    g.addEdge({ from: 'authentication', to: 'api', type: 'PROTECTS', label: 'token guard' });

    // Auth Controller Node
    g.addNode({
      id: 'auth-controller',
      type: 'controller',
      label: 'AuthController',
      description: 'HTTP controller with constructor-injected AuthService',
      files: ['backend/controllers/AuthController.php'],
      routes: routeStrings,
      entities: [],
    });
    g.addEdge({ from: 'authentication', to: 'auth-controller', type: 'USES' });

    // Auth Service Node
    g.addNode({
      id: 'auth-service',
      type: 'service',
      label: 'AuthService',
      description: 'Domain business logic for credential validation, token rotation, and immutable role policies',
      files: ['backend/services/AuthService.php'],
      routes: [],
      entities: ['users', 'refresh_tokens'],
    });
    g.addEdge({ from: 'auth-controller', to: 'auth-service', type: 'USES' });

    // User Repository Node
    g.addNode({
      id: 'user-repository',
      type: 'repository',
      label: 'UserRepository',
      description: 'Data access repository for user credentials and role queries',
      files: ['backend/repositories/UserRepository.php'],
      routes: [],
      entities: ['users'],
    });
    g.addEdge({ from: 'auth-service', to: 'user-repository', type: 'USES' });

    // Refresh Token Repository Node
    g.addNode({
      id: 'refresh-token-repository',
      type: 'repository',
      label: 'RefreshTokenRepository',
      description: 'Data access repository for refresh token persistence, lookup, and single-use revocation',
      files: ['backend/repositories/RefreshTokenRepository.php'],
      routes: [],
      entities: ['refresh_tokens'],
    });
    g.addEdge({ from: 'auth-service', to: 'refresh-token-repository', type: 'USES' });

    // JWT Provider Node (Pure cryptographic token operations — NO DATABASE ACCESS)
    g.addNode({
      id: 'jwt',
      type: 'auth-provider',
      label: 'JWT Provider (HS256)',
      description: 'Cryptographic token encoding, decoding, signature verification, and expiration check (database-independent)',
      files: ['backend/support/Jwt.php'],
      routes: [],
      entities: [],
    });
    g.addEdge({ from: 'auth-service', to: 'jwt', type: 'USES', label: 'cryptographic signing/verification' });
    g.addEdge({ from: 'authentication', to: 'jwt', type: 'USES' });

    // Users Entity Node
    g.addNode({
      id: 'users',
      type: 'entity',
      label: 'Users Persistence',
      description: 'User identity and credential storage table',
      files: ['backend/models/User.php', 'database/migrations/001_create_users.php'],
      routes: [`${prefix}/users`],
      entities: ['users'],
    });
    g.addEdge({ from: 'user-repository', to: 'users', type: 'READS' });
    g.addEdge({ from: 'user-repository', to: 'users', type: 'WRITES' });
    g.addEdge({ from: 'authentication', to: 'users', type: 'READS' });
    g.addEdge({ from: 'authentication', to: 'users', type: 'WRITES' });
    g.addEdge({ from: 'users', to: 'mysql', type: 'PERSISTS_TO' });

    // Refresh Tokens Entity Node
    g.addNode({
      id: 'refresh_tokens',
      type: 'entity',
      label: 'Refresh Tokens Persistence',
      description: 'Rotated refresh token hashes and expiration timestamps',
      files: ['database/migrations/004_create_refresh_tokens.php'],
      routes: [`${prefix}/auth/refresh`],
      entities: ['refresh_tokens'],
    });
    g.addEdge({ from: 'refresh-token-repository', to: 'refresh_tokens', type: 'READS' });
    g.addEdge({ from: 'refresh-token-repository', to: 'refresh_tokens', type: 'WRITES' });
    g.addEdge({ from: 'authentication', to: 'refresh_tokens', type: 'READS' });
    g.addEdge({ from: 'authentication', to: 'refresh_tokens', type: 'WRITES' });
    g.addEdge({ from: 'refresh_tokens', to: 'mysql', type: 'PERSISTS_TO' });

  } else if (state.auth.strategy === 'existing') {
    g.addNode({
      id: 'existing-auth',
      type: 'auth-provider',
      label: 'Existing Auth Provider',
      description: 'External authentication provider (Supabase / Firebase / Auth0)',
      files: ['backend/support/Jwt.php'],
      routes: [],
      entities: [],
    });
    g.addEdge({ from: 'frontend', to: 'existing-auth', type: 'AUTHENTICATES_WITH' });
    g.addEdge({ from: 'api', to: 'existing-auth', type: 'AUTHORIZES_WITH' });
  }

  // 6. Business Resource Entities & Controllers
  for (const t of state.tables) {
    if (t.name === 'users' && state.auth.strategy === 'jwt') continue; // handled in auth subsystem

    const cls = toClassName(t.name);
    const entityId = `entity_${t.name}`;

    g.addNode({
      id: entityId,
      type: 'entity',
      label: `${cls} Entity`,
      description: `${t.name} table schema with ${t.columns.length} columns`,
      files: [`backend/models/${cls}.php`, `backend/controllers/${cls}Controller.php`],
      routes: [`${prefix}/${t.name}`, `${prefix}/${t.name}/{id}`],
      entities: [t.name],
    });

    g.addEdge({ from: 'api', to: entityId, type: 'ROUTES_TO' });
    g.addEdge({ from: entityId, to: 'mysql', type: 'PERSISTS_TO' });
  }

  // 7. OpenAPI Specification Node
  g.addNode({
    id: 'openapi',
    type: 'openapi',
    label: 'OpenAPI 3.0.3 Contract',
    description: 'Complete OpenAPI contract describing all endpoints and schemas',
    files: ['docs/openapi.json'],
    routes: [],
    entities: state.tables.map((t) => t.name),
  });
  g.addEdge({ from: 'openapi', to: 'api', type: 'DOCUMENTS' });

  // 8. Test Suite Node
  g.addNode({
    id: 'tests',
    type: 'test',
    label: 'PHPUnit Test Suite',
    description: 'Automated test suite verifying health, auth, CRUD, validation, and routes',
    files: ['tests/ApiTest.php'],
    routes: [],
    entities: state.tables.map((t) => t.name),
  });
  g.addEdge({ from: 'tests', to: 'api', type: 'TESTS' });

  return g;
}

/**
 * Validates the System Map Graph against core architectural invariants.
 */
export function validateSystemMapGraph(
  graph: ApplicationDependencyGraph,
  state: BuilderState
): { passed: boolean; errors: string[] } {
  const errors: string[] = [];

  // Invariant 1: Frontend and API nodes must exist
  if (!graph.hasNode('frontend')) errors.push('Dependency Graph missing "frontend" node');
  if (!graph.hasNode('api')) errors.push('Dependency Graph missing "api" node');
  if (!graph.hasNode('mysql')) errors.push('Dependency Graph missing "mysql" database node');

  // Invariant 2: Frontend must call API
  if (!graph.hasEdge('frontend', 'api', 'CALLS')) {
    errors.push('Missing edge: frontend -> api (CALLS)');
  }

  if (state.auth.strategy === 'jwt') {
    // Invariant 3: Auth Subsystem nodes must exist
    if (!graph.hasNode('authentication')) errors.push('Dependency Graph missing "authentication" subsystem node');
    if (!graph.hasNode('auth-controller')) errors.push('Dependency Graph missing "auth-controller" node');
    if (!graph.hasNode('auth-service')) errors.push('Dependency Graph missing "auth-service" node');
    if (!graph.hasNode('user-repository')) errors.push('Dependency Graph missing "user-repository" node');
    if (!graph.hasNode('refresh-token-repository')) errors.push('Dependency Graph missing "refresh-token-repository" node');
    if (!graph.hasNode('jwt')) errors.push('Dependency Graph missing "jwt" provider node');
    if (!graph.hasNode('users')) errors.push('Dependency Graph missing "users" entity node');
    if (!graph.hasNode('refresh_tokens')) errors.push('Dependency Graph missing "refresh_tokens" entity node');

    // Invariant 4: Auth subsystem relationships
    if (!graph.hasEdge('authentication', 'auth-controller')) {
      errors.push('Missing edge: authentication -> auth-controller');
    }
    if (!graph.hasEdge('auth-controller', 'auth-service')) {
      errors.push('Missing edge: auth-controller -> auth-service');
    }
    if (!graph.hasEdge('auth-service', 'jwt')) {
      errors.push('Missing edge: auth-service -> jwt');
    }
    if (!graph.hasEdge('auth-service', 'user-repository')) {
      errors.push('Missing edge: auth-service -> user-repository');
    }
    if (!graph.hasEdge('auth-service', 'refresh-token-repository')) {
      errors.push('Missing edge: auth-service -> refresh-token-repository');
    }
    if (!graph.hasEdge('user-repository', 'users')) {
      errors.push('Missing edge: user-repository -> users');
    }
    if (!graph.hasEdge('refresh-token-repository', 'refresh_tokens')) {
      errors.push('Missing edge: refresh-token-repository -> refresh_tokens');
    }
    if (!graph.hasEdge('users', 'mysql', 'PERSISTS_TO')) {
      errors.push('Missing edge: users -> mysql (PERSISTS_TO)');
    }
    if (!graph.hasEdge('refresh_tokens', 'mysql', 'PERSISTS_TO')) {
      errors.push('Missing edge: refresh_tokens -> mysql (PERSISTS_TO)');
    }
    if (!graph.hasEdge('authentication', 'api', 'PROTECTS')) {
      errors.push('Missing edge: authentication -> api (PROTECTS)');
    }

    // Invariant 5: CRITICAL — JWT MUST NEVER HAVE A DIRECT PERSISTENCE/DATABASE EDGE TO MYSQL!
    if (graph.hasEdge('jwt', 'mysql')) {
      errors.push('CRITICAL DEFECT: JWT provider directly connects to MySQL. JWT must remain database-independent!');
    }
  } else if (state.auth.strategy === 'none') {
    // Invariant 6: No-auth mode must contain ZERO auth nodes or edges
    if (graph.hasNode('authentication')) errors.push('No-auth mode contains "authentication" subsystem node');
    if (graph.hasNode('jwt')) errors.push('No-auth mode contains "jwt" node');
    if (graph.hasNode('refresh_tokens')) errors.push('No-auth mode contains "refresh_tokens" node');
  }

  return {
    passed: errors.length === 0,
    errors,
  };
}
