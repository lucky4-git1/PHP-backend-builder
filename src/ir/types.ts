/**
 * Canonical Application IR — single source of truth for all generators.
 * Frontend → Parser → Analyzer → ApplicationIR → Schema Validator → Generators
 *
 * Enforces clear separation: no generator consumes raw HTML/JS directly.
 */

export type IRFieldType =
  | 'string' | 'text' | 'longtext'
  | 'integer' | 'bigint' | 'smallint'
  | 'decimal' | 'float'
  | 'boolean'
  | 'datetime' | 'timestamp' | 'date' | 'time'
  | 'json' | 'enum' | 'uuid'
  | 'email' | 'password'; // semantic types resolved to storage types during compilation

export interface IREvidence {
  source: string; // e.g. "src/pages/Login.tsx:12"
  kind: 'form' | 'api_call' | 'mock_data' | 'route' | 'storage' | 'js' | 'component';
  excerpt: string;
}

export interface IRField {
  name: string;
  semanticType: IRFieldType;
  storageType: string; // resolved storage type name before SQL mapping
  required: boolean;
  unique: boolean;
  nullable: boolean;
  defaultValue?: string;
  enumValues?: string[];
  validation: string[]; // e.g. ["required","email","max:255"]
  confidence: number; // 0..1
  confidenceReason: string;
  evidence: IREvidence[];
  isSensitive: boolean; // true for password, token etc — never serialized
}

export interface IRRelationship {
  fromResource: string;
  toResource: string;
  type: 'hasOne' | 'hasMany' | 'belongsTo' | 'manyToMany';
  fromField: string;
  toField: string;
  through?: string;
}

export interface IRResource {
  name: string; // plural table name e.g. "posts"
  singular: string;
  fields: IRField[];
  relationships: IRRelationship[];
  indexes: Array<{ columns: string[]; unique: boolean; name: string }>;
  uniqueConstraints: string[][];
  searchFields: string[];
  sortableFields: string[];
  filterableFields: string[];
  hasTimestamps: boolean;
  hasSoftDeletes: boolean;
  confidence: number;
  evidence: IREvidence[];
}

export interface IRAuthFeatures {
  register: boolean;
  login: boolean;
  logout: boolean;
  refresh: boolean;
  me: boolean;
  forgotPassword: boolean;
  resetPassword: boolean;
  emailVerification: boolean;
}

export interface IRAuthFrontend {
  generate: boolean;
  protectedRoutes: boolean;
  authState: boolean;
}

export interface IRAuth {
  enabled: boolean;
  strategy: 'jwt' | 'session' | 'none' | 'existing';
  methods: ('jwt' | 'session')[];
  userResource: string | null;
  features: IRAuthFeatures;
  frontend: IRAuthFrontend;
  protectedResources: string[];
  roles: string[];
  permissions: string[]; // e.g. "posts.read"
  register: boolean;
  login: boolean;
  logout: boolean;
  refresh: boolean;
  emailVerification: boolean;
  passwordReset: boolean;
  confidence: number;
  detectionStatus: 'detected' | 'not_detected' | 'ambiguous';
  evidence: IREvidence[];
  userDecision?: 'none' | 'add' | 'existing';
  externalProviderConfig?: {
    headerName?: string;
    tokenPrefix?: string;
    introspectUrl?: string;
  };
}

export interface IREndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';
  path: string; // e.g. "/posts/{id}"
  resource?: string;
  operation: 'list' | 'read' | 'create' | 'update' | 'delete' | 'custom';
  auth: 'none' | 'required' | 'optional';
  validation: string[];
  pagination: boolean;
  search: boolean;
  filtering: boolean;
  sorting: boolean;
  confidence: number;
  evidence: IREvidence[];
}

export interface IRProject {
  name: string;
  version: string;
  frontendType: string;
  apiVersion: string;
  apiPrefix: string;
  database: 'mysql' | 'postgres';
}

export interface ApplicationIR {
  version: '1.0.0';
  project: IRProject;
  resources: IRResource[];
  relationships: IRRelationship[];
  auth: IRAuth;
  api: {
    version: string;
    prefix: string;
    endpoints: IREndpoint[];
  };
  uploads?: Array<{ field: string; resource: string; acceptedTypes: string[]; maxSize: number }>;
  enums?: Array<{ name: string; values: string[] }>;
  // provenance
  generatedAt: string;
  analyzerVersion: string;
}
