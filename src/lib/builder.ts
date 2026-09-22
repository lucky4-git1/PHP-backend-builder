import type { DatabaseColumnType, HttpMethod } from '@shared/types';

// ---- Builder domain model (UI-friendly, maps to shared types) ----

export interface BuilderColumn {
  id: string;
  name: string;
  type: DatabaseColumnType;
  nullable: boolean;
  unique: boolean;
  defaultValue: string;
  isPrimaryKey: boolean;
  isAutoIncrement: boolean;
  foreignKey?: { table: string; column: string };
}

export interface BuilderTable {
  id: string;
  name: string;
  comment: string;
  columns: BuilderColumn[];
  timestamps: boolean;
  softDeletes: boolean;
}

export interface BuilderEndpoint {
  id: string;
  method: HttpMethod;
  path: string;
  handler: string;
  table: string;
  operation: 'list' | 'read' | 'create' | 'update' | 'delete' | 'custom';
  auth: 'none' | 'required' | 'optional';
  description: string;
}

export interface BuilderAuth {
  strategy: 'jwt' | 'session' | 'none' | 'existing';
  register: boolean;
  login: boolean;
  logout: boolean;
  refresh: boolean;
  me: boolean;
  forgotPassword: boolean;
  resetPassword: boolean;
  emailVerification: boolean;
  generateFrontend: boolean;
  protectedRoutes: boolean;
  roles: string[];
  permissions: string[];
  tokenExpiryHours: number;
  userDecision?: 'none' | 'add' | 'existing';
}

export interface BuilderConfig {
  projectName: string;
  phpVersion: string;
  apiPrefix: string;
  corsOrigins: string;
  dbName: string;
  dbHost: string;
  pagination: number;
}

export interface BuilderState {
  tables: BuilderTable[];
  endpoints: BuilderEndpoint[];
  auth: BuilderAuth;
  config: BuilderConfig;
}

export interface GenFile {
  path: string;
  language: string;
  content: string;
}

// ---- helpers ----

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

export function sanitizeTableName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_');
}

export function toClassName(table: string): string {
  return table
    .split('_')
    .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p))
    .join('')
    .replace(/s$/, '');
}

export function phpTypeFor(col: BuilderColumn): string {
  switch (col.type) {
    case 'int':
    case 'bigint':
    case 'smallint':
    case 'tinyint':
      return 'int';
    case 'decimal':
    case 'float':
    case 'double':
      return 'float';
    case 'boolean':
      return 'bool';
    case 'json':
      return 'array';
    default:
      return 'string';
  }
}

export function sqlTypeFor(col: BuilderColumn): string {
  switch (col.type) {
    case 'bigint': return 'BIGINT';
    case 'smallint': return 'SMALLINT';
    case 'tinyint': return 'TINYINT(1)';
    case 'int': return 'INT';
    case 'decimal': return 'DECIMAL(10,2)';
    case 'float': return 'FLOAT';
    case 'double': return 'DOUBLE';
    case 'varchar': return 'VARCHAR(255)';
    case 'text': return 'TEXT';
    case 'longtext': return 'LONGTEXT';
    case 'datetime': return 'DATETIME';
    case 'timestamp': return 'TIMESTAMP';
    case 'date': return 'DATE';
    case 'time': return 'TIME';
    case 'year': return 'YEAR';
    case 'json': return 'JSON';
    case 'blob': return 'LONGBLOB';
    case 'enum': return 'VARCHAR(64)';
    case 'set': return 'VARCHAR(255)';
    case 'boolean': return 'TINYINT(1)';
    case 'uuid': return 'CHAR(36)';
    default: return 'VARCHAR(255)';
  }
}

function col(name: string, type: DatabaseColumnType, opts: Partial<BuilderColumn> = {}): BuilderColumn {
  return {
    id: uid('c'),
    name,
    type,
    nullable: opts.nullable ?? false,
    unique: opts.unique ?? false,
    defaultValue: opts.defaultValue ?? '',
    isPrimaryKey: opts.isPrimaryKey ?? false,
    isAutoIncrement: opts.isAutoIncrement ?? false,
    foreignKey: opts.foreignKey,
  };
}

// ---- templates ----

export function emptyProject(name: string): BuilderState {
  return {
    tables: [],
    endpoints: [],
    auth: {
      strategy: 'none',
      register: false,
      login: false,
      logout: false,
      refresh: false,
      me: false,
      forgotPassword: false,
      resetPassword: false,
      emailVerification: false,
      generateFrontend: false,
      protectedRoutes: false,
      roles: ['admin', 'user'],
      permissions: [],
      tokenExpiryHours: 24,
      userDecision: 'none',
    },
    config: {
      projectName: name || 'my-api',
      phpVersion: '8.2',
      apiPrefix: '/api/v1',
      corsOrigins: '*',
      dbName: (name || 'my_api').toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      dbHost: '127.0.0.1',
      pagination: 20,
    },
  };
}

export function templateBlog(): BuilderState {
  const s = emptyProject('blog-api');
  const users: BuilderTable = {
    id: uid('t'), name: 'users', comment: 'App users',
    timestamps: true, softDeletes: false,
    columns: [
      col('id', 'bigint', { isPrimaryKey: true, isAutoIncrement: true }),
      col('name', 'varchar', {}),
      col('email', 'varchar', { unique: true }),
      col('password', 'varchar', {}),
      col('role', 'varchar', { defaultValue: 'user' }),
    ],
  };
  const posts: BuilderTable = {
    id: uid('t'), name: 'posts', comment: 'Blog posts',
    timestamps: true, softDeletes: true,
    columns: [
      col('id', 'bigint', { isPrimaryKey: true, isAutoIncrement: true }),
      col('user_id', 'bigint', { foreignKey: { table: 'users', column: 'id' } }),
      col('title', 'varchar', {}),
      col('slug', 'varchar', { unique: true }),
      col('body', 'longtext', { nullable: true }),
      col('status', 'varchar', { defaultValue: 'draft' }),
      col('published_at', 'datetime', { nullable: true }),
    ],
  };
  const comments: BuilderTable = {
    id: uid('t'), name: 'comments', comment: 'Post comments',
    timestamps: true, softDeletes: false,
    columns: [
      col('id', 'bigint', { isPrimaryKey: true, isAutoIncrement: true }),
      col('post_id', 'bigint', { foreignKey: { table: 'posts', column: 'id' } }),
      col('user_id', 'bigint', { nullable: true, foreignKey: { table: 'users', column: 'id' } }),
      col('body', 'text', {}),
    ],
  };
  s.tables = [users, posts, comments];
  s.endpoints = autoEndpoints(s.tables);
  s.auth = {
    strategy: 'jwt',
    register: true,
    login: true,
    logout: true,
    refresh: true,
    me: true,
    forgotPassword: false,
    resetPassword: false,
    emailVerification: false,
    generateFrontend: true,
    protectedRoutes: true,
    roles: ['admin', 'user'],
    permissions: ['posts.create', 'posts.update', 'posts.delete'],
    tokenExpiryHours: 24,
    userDecision: 'add',
  };
  return s;
}

export function templateEcommerce(): BuilderState {
  const s = emptyProject('shop-api');
  const users: BuilderTable = {
    id: uid('t'), name: 'users', comment: 'Customers',
    timestamps: true, softDeletes: false,
    columns: [
      col('id', 'bigint', { isPrimaryKey: true, isAutoIncrement: true }),
      col('name', 'varchar', {}),
      col('email', 'varchar', { unique: true }),
      col('password', 'varchar', {}),
    ],
  };
  const products: BuilderTable = {
    id: uid('t'), name: 'products', comment: 'Catalog',
    timestamps: true, softDeletes: false,
    columns: [
      col('id', 'bigint', { isPrimaryKey: true, isAutoIncrement: true }),
      col('sku', 'varchar', { unique: true }),
      col('name', 'varchar', {}),
      col('price', 'decimal', {}),
      col('stock', 'int', { defaultValue: '0' }),
      col('description', 'text', { nullable: true }),
    ],
  };
  const orders: BuilderTable = {
    id: uid('t'), name: 'orders', comment: 'Orders',
    timestamps: true, softDeletes: false,
    columns: [
      col('id', 'bigint', { isPrimaryKey: true, isAutoIncrement: true }),
      col('user_id', 'bigint', { foreignKey: { table: 'users', column: 'id' } }),
      col('total', 'decimal', {}),
      col('status', 'varchar', { defaultValue: 'pending' }),
    ],
  };
  const items: BuilderTable = {
    id: uid('t'), name: 'order_items', comment: 'Order lines',
    timestamps: false, softDeletes: false,
    columns: [
      col('id', 'bigint', { isPrimaryKey: true, isAutoIncrement: true }),
      col('order_id', 'bigint', { foreignKey: { table: 'orders', column: 'id' } }),
      col('product_id', 'bigint', { foreignKey: { table: 'products', column: 'id' } }),
      col('qty', 'int', { defaultValue: '1' }),
      col('price', 'decimal', {}),
    ],
  };
  s.tables = [users, products, orders, items];
  s.endpoints = autoEndpoints(s.tables);
  s.auth = {
    strategy: 'jwt',
    register: true,
    login: true,
    logout: true,
    refresh: true,
    me: true,
    forgotPassword: false,
    resetPassword: false,
    emailVerification: false,
    generateFrontend: true,
    protectedRoutes: true,
    roles: ['admin', 'customer'],
    permissions: ['products.manage', 'orders.view', 'orders.create'],
    tokenExpiryHours: 24,
    userDecision: 'add',
  };
  return s;
}

export function templateSaas(): BuilderState {
  const s = emptyProject('saas-api');
  const users: BuilderTable = {
    id: uid('t'), name: 'users', comment: 'Tenant users',
    timestamps: true, softDeletes: false,
    columns: [
      col('id', 'bigint', { isPrimaryKey: true, isAutoIncrement: true }),
      col('team_id', 'bigint', { nullable: true }),
      col('name', 'varchar', {}),
      col('email', 'varchar', { unique: true }),
      col('password', 'varchar', {}),
      col('role', 'varchar', { defaultValue: 'member' }),
    ],
  };
  const teams: BuilderTable = {
    id: uid('t'), name: 'teams', comment: 'Workspaces',
    timestamps: true, softDeletes: false,
    columns: [
      col('id', 'bigint', { isPrimaryKey: true, isAutoIncrement: true }),
      col('name', 'varchar', {}),
      col('plan', 'varchar', { defaultValue: 'free' }),
    ],
  };
  const projects: BuilderTable = {
    id: uid('t'), name: 'projects', comment: 'Team projects',
    timestamps: true, softDeletes: true,
    columns: [
      col('id', 'bigint', { isPrimaryKey: true, isAutoIncrement: true }),
      col('team_id', 'bigint', { foreignKey: { table: 'teams', column: 'id' } }),
      col('name', 'varchar', {}),
      col('description', 'text', { nullable: true }),
    ],
  };
  const keys: BuilderTable = {
    id: uid('t'), name: 'api_keys', comment: 'API keys',
    timestamps: true, softDeletes: false,
    columns: [
      col('id', 'bigint', { isPrimaryKey: true, isAutoIncrement: true }),
      col('team_id', 'bigint', { foreignKey: { table: 'teams', column: 'id' } }),
      col('label', 'varchar', {}),
      col('key_hash', 'varchar', { unique: true }),
      col('revoked_at', 'datetime', { nullable: true }),
    ],
  };
  s.tables = [teams, users, projects, keys];
  s.endpoints = autoEndpoints(s.tables);
  s.auth = {
    strategy: 'jwt',
    register: true,
    login: true,
    logout: true,
    refresh: true,
    me: true,
    forgotPassword: false,
    resetPassword: false,
    emailVerification: false,
    generateFrontend: true,
    protectedRoutes: true,
    roles: ['owner', 'admin', 'member'],
    permissions: ['projects.all', 'team.manage', 'keys.create'],
    tokenExpiryHours: 24,
    userDecision: 'add',
  };
  return s;
}

export function autoEndpoints(tables: BuilderTable[]): BuilderEndpoint[] {
  const out: BuilderEndpoint[] = [];
  for (const t of tables) {
    const base = `/${t.name}`;
    const ops: Array<{ op: BuilderEndpoint['operation']; method: HttpMethod; path: string }> = [
      { op: 'list', method: 'GET', path: base },
      { op: 'create', method: 'POST', path: base },
      { op: 'read', method: 'GET', path: `${base}/{id}` },
      { op: 'update', method: 'PUT', path: `${base}/{id}` },
      { op: 'delete', method: 'DELETE', path: `${base}/{id}` },
    ];
    for (const o of ops) {
      out.push({
        id: uid('e'),
        method: o.method,
        path: o.path,
        handler: `${toClassName(t.name)}Controller::${o.op}`,
        table: t.name,
        operation: o.op,
        auth: t.name === 'users' && o.op !== 'create' ? 'required' : 'required',
        description: `${o.op} ${t.name}`,
      });
    }
  }
  return out;
}

// ---- validation ----

export function validateState(s: BuilderState): string[] {
  const errors: string[] = [];
  if (!s.config.projectName.trim()) errors.push('Project name is required.');
  if (s.tables.length === 0) errors.push('Add at least one table.');
  const names = new Set<string>();
  for (const t of s.tables) {
    if (!t.name.trim()) errors.push('Every table needs a name.');
    if (names.has(t.name)) errors.push(`Duplicate table name: ${t.name}`);
    names.add(t.name);
    if (t.columns.length === 0) errors.push(`Table "${t.name}" has no columns.`);
    const cnames = new Set<string>();
    for (const c of t.columns) {
      if (!c.name.trim()) errors.push(`Table "${t.name}" has a column without a name.`);
      if (cnames.has(c.name)) errors.push(`Duplicate column "${c.name}" in table "${t.name}".`);
      cnames.add(c.name);
      if (c.foreignKey && !s.tables.some((x) => x.name === c.foreignKey!.table)) {
        errors.push(`Column "${t.name}.${c.name}" references missing table "${c.foreignKey.table}".`);
      }
    }
  }
  return errors;
}

export function securityChecklist(s: BuilderState): Array<{ label: string; ok: boolean; hint: string }> {
  return [
    { label: 'PDO prepared statements', ok: true, hint: 'All generated queries use bound parameters.' },
    { label: 'Passwords hashed (password_hash)', ok: s.tables.some((t) => t.columns.some((c) => c.name === 'password')), hint: 'Add a password column to hash credentials.' },
    { label: 'Auth on mutating endpoints', ok: s.endpoints.filter((e) => ['create', 'update', 'delete'].includes(e.operation)).every((e) => e.auth !== 'none'), hint: 'Set auth=required on POST/PUT/DELETE.' },
    { label: 'CORS restricted in production', ok: s.config.corsOrigins !== '*', hint: 'Replace * with your frontend origin.' },
    { label: 'Rate limiting enabled', ok: true, hint: 'Middleware throttles /api/* to 120 req/min.' },
    { label: 'Timestamps for audit', ok: s.tables.every((t) => t.timestamps), hint: 'Enable created_at/updated_at on all tables.' },
  ];
}
