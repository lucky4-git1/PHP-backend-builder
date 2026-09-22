/**
 * Core shared types for the PHP Backend Builder application
 */

// ============================================
// Project & File Types
// ============================================

export interface Project {
  id: string;
  name: string;
  source: 'zip' | 'git' | 'local';
  sourcePath?: string;
  framework: FrameworkType;
  language: LanguageType;
  packageManager: PackageManagerType;
  createdAt: Date;
  updatedAt: Date;
  status: ProjectStatus;
  manifest?: ProjectManifest;
  analysis?: AnalysisResult;
  requirements?: BackendRequirements;
  databaseSchema?: DatabaseSchema;
  generatedFiles?: GeneratedFile[];
  integrationChanges?: FileChange[];
  testResults?: TestResult[];
  securityFindings?: SecurityFinding[];
}

export type ProjectStatus = 
  | 'importing'
  | 'analyzing'
  | 'requirements_review'
  | 'database_design'
  | 'generating_backend'
  | 'integrating'
  | 'testing'
  | 'exporting'
  | 'complete'
  | 'error';

export type FrameworkType = 
  | 'react'
  | 'react-vite'
  | 'nextjs'
  | 'vue'
  | 'angular'
  | 'svelte'
  | 'html'
  | 'unknown';

export type LanguageType = 'typescript' | 'javascript' | 'mixed';

export type PackageManagerType = 'npm' | 'yarn' | 'pnpm' | 'bun' | 'unknown';

export interface Dependency {
  name: string;
  version: string;
  dev: boolean;
  description?: string;
}

export interface ProjectManifest {
  framework: FrameworkType;
  language: LanguageType;
  packageManager: PackageManagerType;
  entryPoints: string[];
  routes: Route[];
  components: Component[];
  forms: Form[];
  apiCalls: ApiCall[];
  storageUsage: StorageUsage[];
  mockData: MockData[];
  dependencies: Dependency[];
  projectTree: ProjectTreeNode;
}

export interface ProjectFile {
  path: string;
  relativePath: string;
  content: string;
  size: number;
  extension: string;
  isBinary: boolean;
}

export interface ProjectTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: ProjectTreeNode[];
  extension?: string;
  size?: number;
}

// ============================================
// Analysis Types
// ============================================

export interface AnalysisResult {
  projectId: string;
  analyzedAt: Date;
  framework: FrameworkType;
  language: LanguageType;
  filesAnalyzed: number;
  routes: Route[];
  components: Component[];
  forms: Form[];
  apiCalls: ApiCall[];
  storageUsage: StorageUsage[];
  mockData: MockData[];
  authFlows: AuthFlow[];
  authDetection?: AuthDetectionResult;
  entities: Entity[];
  crudOperations: CrudOperation[];
  uploads: UploadInfo[];
  validations: ValidationRule[];
  businessFlows: BusinessFlow[];
  warnings: AnalysisWarning[];
  errors: AnalysisError[];
}

export interface AuthDetectionResult {
  detected: boolean;
  confidence: number;
  status: 'detected' | 'not_detected' | 'ambiguous';
  evidence: string[];
  reason: string;
  hasLoginForm: boolean;
  hasRegisterForm: boolean;
  hasLogout: boolean;
  hasTokenStorage: boolean;
  hasAuthApiCalls: boolean;
  hasProtectedRoutes: boolean;
  flows: AuthFlow[];
}

export interface Route {
  path: string;
  component: string;
  componentPath: string;
  requiresAuth: boolean;
  methods: HttpMethod[];
  referencedData: string[];
  forms: string[];
  actions: string[];
  children?: Route[];
}

export interface Component {
  name: string;
  path: string;
  type: ComponentType;
  props: ComponentProp[];
  hooks: string[];
  imports: string[];
  exports: string[];
  jsxElements: JsxElement[];
}

export type ComponentType = 
  | 'page'
  | 'layout'
  | 'form'
  | 'table'
  | 'modal'
  | 'card'
  | 'list'
  | 'navigation'
  | 'ui'
  | 'hook'
  | 'context'
  | 'service'
  | 'utility'
  | 'unknown';

export interface ComponentProp {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
}

export interface JsxElement {
  tag: string;
  attributes: Record<string, string>;
  children: JsxElement[];
  lineNumber: number;
}

export interface Form {
  id: string;
  name: string;
  path: string;
  component: string;
  fields: FormField[];
  actions: FormAction[];
  validation: ValidationRule[];
  submissionHandler?: string;
  apiEndpoint?: string;
  method: HttpMethod;
}

export interface FormField {
  name: string;
  type: FormFieldType;
  label?: string;
  required: boolean;
  validation?: ValidationRule[];
  placeholder?: string;
  defaultValue?: string;
  options?: SelectOption[];
}

export type FormFieldType = 
  | 'text'
  | 'email'
  | 'password'
  | 'number'
  | 'tel'
  | 'url'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'date'
  | 'datetime-local'
  | 'file'
  | 'hidden'
  | 'submit'
  | 'button'
  | 'reset'
  | 'custom';

export interface SelectOption {
  value: string;
  label: string;
}

export interface FormAction {
  type: 'submit' | 'reset' | 'cancel' | 'custom';
  label: string;
  handler?: string;
  apiEndpoint?: string;
  method?: HttpMethod;
}

export interface ApiCall {
  id: string;
  method: HttpMethod;
  url: string;
  path: string;
  component: string;
  componentPath: string;
  requestBody?: string;
  queryParams: Record<string, string>;
  headers: Record<string, string>;
  authHeader?: string;
  responseType?: string;
  isMock: boolean;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface StorageUsage {
  id: string;
  type: StorageType;
  key: string;
  operations: StorageOperation[];
  component: string;
  componentPath: string;
  dataStructure?: string;
  purpose: StoragePurpose;
}

export type StorageType = 'localStorage' | 'sessionStorage' | 'indexedDB' | 'cookie';

export type StorageOperation = 'get' | 'set' | 'remove' | 'clear' | 'keys';

export type StoragePurpose = 
  | 'authentication'
  | 'settings'
  | 'persistent_records'
  | 'ui_state'
  | 'cached_data'
  | 'unknown';

export interface MockData {
  id: string;
  name: string;
  path: string;
  variableName: string;
  dataType: MockDataType;
  structure: any;
  classification: MockDataClassification;
  usageLocations: string[];
  entityCandidate?: string;
}

export type MockDataType = 'array' | 'object' | 'json_file' | 'module_export' | 'constant';

export type MockDataClassification = 
  | 'static_ui_data'
  | 'demo_data'
  | 'database_data'
  | 'configuration'
  | 'unknown';

export interface AuthFlow {
  id: string;
  type: AuthFlowType;
  component: string;
  componentPath: string;
  fields: FormField[];
  endpoints: AuthEndpoint[];
  tokenStorage?: StorageUsage;
  protectedRoutes: string[];
}

export type AuthFlowType = 
  | 'login'
  | 'register'
  | 'logout'
  | 'forgot_password'
  | 'reset_password'
  | 'session_check'
  | 'profile'
  | 'oauth';

export interface AuthEndpoint {
  action: AuthFlowType;
  url: string;
  method: HttpMethod;
}

export interface Entity {
  id: string;
  name: string;
  singularName: string;
  pluralName: string;
  confidence: number;
  evidence: EntityEvidence[];
  fields: EntityField[];
  relationships: EntityRelationship[];
  crudOperations: CrudOperation[];
  source: EntitySource[];
}

export interface EntityEvidence {
  type: 'form' | 'api_call' | 'mock_data' | 'route' | 'component' | 'storage';
  source: string;
  description: string;
  confidence: number;
}

export interface EntityField {
  name: string;
  type: DatabaseColumnType;
  required: boolean;
  unique: boolean;
  primaryKey: boolean;
  foreignKey?: ForeignKeyReference;
  validation?: ValidationRule[];
  defaultValue?: string;
  description?: string;
}

export interface ForeignKeyReference {
  table: string;
  column: string;
  onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
  onUpdate: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
}

export interface EntityRelationship {
  type: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';
  targetEntity: string;
  sourceField: string;
  targetField: string;
  throughTable?: string;
}

export interface CrudOperation {
  entity: string;
  operation: 'create' | 'read' | 'update' | 'delete' | 'list';
  detected: boolean;
  confidence: number;
  evidence: string[];
  apiEndpoint?: string;
  formId?: string;
}

export type EntitySource = 'form' | 'api_call' | 'mock_data' | 'route' | 'component' | 'storage';

export interface UploadInfo {
  id: string;
  fieldName: string;
  component: string;
  componentPath: string;
  acceptedTypes: string[];
  maxSize?: number;
  multiple: boolean;
  destination?: string;
  entity?: string;
}

export interface ValidationRule {
  field: string;
  type: ValidationType;
  value?: any;
  message?: string;
}

export type ValidationType = 
  | 'required'
  | 'email'
  | 'min_length'
  | 'max_length'
  | 'min'
  | 'max'
  | 'pattern'
  | 'numeric'
  | 'url'
  | 'date'
  | 'custom';

export interface BusinessFlow {
  id: string;
  name: string;
  description: string;
  steps: BusinessFlowStep[];
  entities: string[];
  triggers: string[];
}

export interface BusinessFlowStep {
  name: string;
  type: 'user_action' | 'api_call' | 'database' | 'external' | 'conditional';
  description: string;
  entity?: string;
  operation?: string;
}

export interface AnalysisWarning {
  code: string;
  message: string;
  file?: string;
  line?: number;
  severity: 'low' | 'medium' | 'high';
}

export interface AnalysisError {
  code: string;
  message: string;
  file: string;
  line?: number;
  analyzer: string;
  stack?: string;
}

// ============================================
// Requirements Types
// ============================================

export interface BackendRequirements {
  projectId: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  authentication: AuthRequirement;
  database: DatabaseRequirement;
  api: ApiRequirement;
  files: FileRequirement;
  validation: ValidationRequirement;
  businessRules: BusinessRuleRequirement[];
  ambiguities: Ambiguity[];
}

export interface AuthRequirement {
  enabled: boolean;
  strategy?: 'jwt' | 'session' | 'none' | 'existing';
  login: boolean;
  register: boolean;
  logout: boolean;
  refresh?: boolean;
  me?: boolean;
  forgotPassword: boolean;
  resetPassword: boolean;
  emailVerification?: boolean;
  sessionManagement: boolean;
  userProfile: boolean;
  roles: string[];
  permissions: string[];
  tokenType: 'jwt' | 'session' | 'api_key';
  confidence: number;
  detectionStatus?: 'detected' | 'not_detected' | 'ambiguous';
  evidence: string[];
  reason?: string;
  userDecision?: 'none' | 'add' | 'existing';
  generateFrontend?: boolean;
}

export interface DatabaseRequirement {
  tables: TableRequirement[];
  relationships: RelationshipRequirement[];
}

export interface TableRequirement {
  id: string;
  name: string;
  entityName: string;
  columns: ColumnRequirement[];
  indexes: IndexRequirement[];
  confidence: number;
  evidence: string[];
  sourceEntityId?: string;
}

export interface ColumnRequirement {
  id: string;
  name: string;
  type: DatabaseColumnType;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  autoIncrement: boolean;
  defaultValue?: string;
  foreignKey?: ForeignKeyRequirement;
  validation?: ValidationRule[];
  confidence: number;
  evidence: string[];
}

export type DatabaseColumnType = 
  | 'bigint'
  | 'int'
  | 'smallint'
  | 'tinyint'
  | 'decimal'
  | 'float'
  | 'double'
  | 'varchar'
  | 'text'
  | 'longtext'
  | 'datetime'
  | 'timestamp'
  | 'date'
  | 'time'
  | 'year'
  | 'json'
  | 'blob'
  | 'enum'
  | 'set'
  | 'boolean'
  | 'uuid';

export interface ForeignKeyRequirement {
  referencedTable: string;
  referencedColumn: string;
  onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
  onUpdate: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
}

export interface IndexRequirement {
  name: string;
  columns: string[];
  unique: boolean;
  type: 'BTREE' | 'HASH' | 'FULLTEXT' | 'SPATIAL';
}

export interface RelationshipRequirement {
  id: string;
  sourceTable: string;
  targetTable: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';
  sourceColumn: string;
  targetColumn: string;
  throughTable?: string;
  confidence: number;
}

export interface ApiRequirement {
  endpoints: EndpointRequirement[];
  basePath: string;
  version: string;
  cors: CorsRequirement;
}

export interface EndpointRequirement {
  id: string;
  method: HttpMethod;
  path: string;
  name: string;
  description: string;
  entity?: string;
  operation: CrudOperationType;
  authentication: AuthLevel;
  authorization?: AuthorizationRule;
  requestBody?: RequestBodyRequirement;
  queryParams?: QueryParamRequirement[];
  pathParams?: PathParamRequirement[];
  responses: ResponseRequirement[];
  confidence: number;
  evidence: string[];
  sourceRequirementId?: string;
}

export type CrudOperationType = 'create' | 'read' | 'update' | 'delete' | 'list' | 'custom';

export type AuthLevel = 'none' | 'required' | 'optional';

export interface AuthorizationRule {
  roles?: string[];
  permissions?: string[];
  ownershipCheck?: boolean;
  customRule?: string;
}

export interface RequestBodyRequirement {
  contentType: string;
  schema: Record<string, any>;
  required: boolean;
}

export interface QueryParamRequirement {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  enum?: string[];
}

export interface PathParamRequirement {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface ResponseRequirement {
  statusCode: number;
  description: string;
  schema?: Record<string, any>;
}

export interface CorsRequirement {
  enabled: boolean;
  origins: string[];
  methods: HttpMethod[];
  headers: string[];
  credentials: boolean;
}

export interface FileRequirement {
  uploads: FileUploadRequirement[];
  storagePath: string;
  maxFileSize: number;
  allowedTypes: string[];
}

export interface FileUploadRequirement {
  id: string;
  fieldName: string;
  entity: string;
  column: string;
  acceptedTypes: string[];
  maxSize: number;
  multiple: boolean;
  destination: 'local' | 's3' | 'cloudinary';
  processing?: ImageProcessingRequirement;
}

export interface ImageProcessingRequirement {
  resize?: { width: number; height: number; fit: 'cover' | 'contain' | 'fill' };
  thumbnails?: { width: number; height: number; suffix: string }[];
  format?: 'jpeg' | 'png' | 'webp';
  quality?: number;
}

export interface ValidationRequirement {
  rules: ValidationRuleRequirement[];
  globalRules: GlobalValidationRule[];
}

export interface ValidationRuleRequirement {
  entity: string;
  field: string;
  rules: ValidationRule[];
}

export interface GlobalValidationRule {
  name: string;
  description: string;
  implementation: string;
}

export interface BusinessRuleRequirement {
  id: string;
  name: string;
  description: string;
  entities: string[];
  trigger: 'create' | 'update' | 'delete' | 'custom';
  condition: string;
  action: string;
  confidence: number;
}

export interface Ambiguity {
  id: string;
  type: AmbiguityType;
  title: string;
  description: string;
  detected: string;
  options: AmbiguityOption[];
  selectedOption?: string;
  confidence: number;
  evidence: string[];
}

export type AmbiguityType = 
  | 'business_logic'
  | 'api_behavior'
  | 'data_relationship'
  | 'auth_flow'
  | 'file_handling'
  | 'validation_rule'
  | 'unknown';

export interface AmbiguityOption {
  id: string;
  label: string;
  description: string;
  implications: string[];
}

// ============================================
// Database Schema Types
// ============================================

export interface DatabaseSchema {
  projectId: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  tables: DatabaseTable[];
  relationships: DatabaseRelationship[];
  enums: DatabaseEnum[];
}

export interface DatabaseTable {
  name: string;
  columns: DatabaseColumn[];
  primaryKey: string[];
  indexes: DatabaseIndex[];
  foreignKeys: DatabaseForeignKey[];
  engine: string;
  charset: string;
  collate: string;
  comment?: string;
}

export interface DatabaseColumn {
  name: string;
  type: DatabaseColumnType;
  length?: number;
  precision?: number;
  scale?: number;
  nullable: boolean;
  defaultValue?: string;
  autoIncrement: boolean;
  comment?: string;
  enumValues?: string[];
}

export interface DatabaseIndex {
  name: string;
  columns: string[];
  unique: boolean;
  type: 'BTREE' | 'HASH' | 'FULLTEXT' | 'SPATIAL';
  comment?: string;
}

export interface DatabaseForeignKey {
  name: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
  onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
  onUpdate: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
}

export interface DatabaseRelationship {
  id: string;
  sourceTable: string;
  targetTable: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';
  sourceColumn: string;
  targetColumn: string;
  throughTable?: string;
}

export interface DatabaseEnum {
  name: string;
  values: string[];
}

// ============================================
// Generation Types
// ============================================

export interface GeneratedFile {
  id: string;
  path: string;
  content: string;
  type: GeneratedFileType;
  language: string;
  size: number;
  hash: string;
  templateId?: string;
  requirementIds: string[];
  createdAt: Date;
}

export type GeneratedFileType = 
  | 'php_config'
  | 'php_model'
  | 'php_service'
  | 'php_api'
  | 'php_middleware'
  | 'php_helper'
  | 'php_migration'
  | 'php_seed'
  | 'sql_schema'
  | 'sql_seed'
  | 'frontend_service'
  | 'frontend_hook'
  | 'frontend_component'
  | 'frontend_config'
  | 'frontend_type'
  | 'env_example'
  | 'readme'
  | 'api_docs'
  | 'test'
  | 'other';

export interface FileChange {
  id: string;
  filePath: string;
  changeType: 'add' | 'modify' | 'delete';
  originalContent?: string;
  newContent?: string;
  diff?: DiffHunk[];
  description: string;
  requirementIds: string[];
  approved: boolean;
  applied: boolean;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  lineNumber?: number;
}

// ============================================
// Testing Types
// ============================================

export interface TestResult {
  id: string;
  projectId: string;
  suite: TestSuite;
  name: string;
  status: TestStatus;
  duration: number;
  message?: string;
  details?: any;
  timestamp: Date;
}

export type TestSuite = 
  | 'database_connection'
  | 'php_syntax'
  | 'sql_validation'
  | 'api_availability'
  | 'authentication'
  | 'authorization'
  | 'crud_operations'
  | 'validation'
  | 'file_uploads'
  | 'frontend_compatibility'
  | 'security'
  | 'schema_consistency'
  | 'application_runtime';

export type TestStatus = 'passed' | 'failed' | 'skipped' | 'warning' | 'running' | 'pending';

// ============================================
// Security Types
// ============================================

export interface SecurityFinding {
  id: string;
  ruleId: string;
  category: SecurityFindingCategory;
  severity: SecuritySeverity;
  title: string;
  description: string;
  status: SecurityFindingStatus;
  confidence: number;
  falsePositiveRisk: 'low' | 'medium' | 'high';
  detectedBy: SecurityDetectionSource;
  location?: {
    file: string;
    lineStart?: number;
    lineEnd?: number;
    columnStart?: number;
    columnEnd?: number;
  };
  evidence?: {
    code?: string;
    before?: string;
    after?: string;
    route?: string;
    symbol?: string;
    ruleEvidence?: string;
  };
  whyFlagged: string;
  impact: string;
  remediation: {
    summary: string;
    steps: string[];
    codeExample?: string;
    automated: boolean;
  };
  relatedFiles?: string[];
  relatedRoutes?: string[];
  relatedEntities?: string[];
  verification?: {
    required: boolean;
    checks: string[];
    lastResult?: 'passed' | 'failed' | 'not_run';
  };
  // Backwards compatibility / tracking fields
  projectId?: string;
  type?: string;
  recommendation?: string;
  file?: string;
  line?: number;
  code?: string;
  cwe?: string;
  owasp?: string;
  detectedAt?: Date;
  fingerprint?: string;
  isStale?: boolean;
}

export type SecurityFindingCategory =
  | 'sql_injection'
  | 'hardcoded_credentials'
  | 'missing_authentication'
  | 'authorization'
  | 'plaintext_password'
  | 'exposed_errors'
  | 'insecure_config'
  | 'validation'
  | 'global_dependency'
  | 'csrf'
  | 'cors'
  | 'rate_limiting'
  | 'token_security'
  | 'other';

export type SecurityFindingStatus =
  | 'open'
  | 'fixed'
  | 'verified'
  | 'reviewed'
  | 'ignored'
  | 'false_positive';

export type SecurityDetectionSource =
  | 'static-analysis'
  | 'ir-analysis'
  | 'schema-analysis'
  | 'runtime-analysis'
  | 'contract-analysis'
  | 'security-analysis';

export type SecurityFindingType = SecurityFindingCategory | string;

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

// ============================================
// Pipeline/UI Types
// ============================================

export interface PipelineStep {
  id: string;
  name: string;
  label: string;
  description: string;
  status: PipelineStepStatus;
  progress: number;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  subSteps?: PipelineSubStep[];
}

export type PipelineStepStatus = 'pending' | 'running' | 'complete' | 'error' | 'skipped';

export interface PipelineSubStep {
  id: string;
  name: string;
  status: PipelineStepStatus;
  message?: string;
}

export interface RequirementCardData {
  id: string;
  category: RequirementCategory;
  title: string;
  description: string;
  items: RequirementItem[];
  confidence: number;
  evidence: string[];
  status: RequirementStatus;
}

export type RequirementCategory = 
  | 'authentication'
  | 'database'
  | 'api'
  | 'files'
  | 'validation'
  | 'business_rules'
  | 'roles_permissions'
  | 'ambiguities';

export interface RequirementItem {
  id: string;
  label: string;
  description?: string;
  enabled: boolean;
  confidence: number;
  evidence: string[];
  editable: boolean;
  required: boolean;
}

export type RequirementStatus = 'detected' | 'approved' | 'rejected' | 'needs_review' | 'edited';

// ============================================
// Configuration Types
// ============================================

export interface GenerationConfig {
  projectId: string;
  phpVersion: string;
  mysqlVersion: string;
  apiStyle: 'rest' | 'graphql' | 'rpc';
  authStrategy: 'jwt' | 'session' | 'api_key';
  orm: 'none' | 'eloquent' | 'doctrine' | 'custom';
  testing: boolean;
  documentation: boolean;
  docker: boolean;
  ci: boolean;
  outputPath: string;
  backendPath: string;
  frontendPath: string;
  databasePath: string;
}

export interface AppConfig {
  theme: 'light' | 'dark' | 'system';
  autoSave: boolean;
  maxFileSize: number;
  maxFiles: number;
  analysisTimeout: number;
  generationTimeout: number;
  testTimeout: number;
  recentProjects: RecentProject[];
}

export interface RecentProject {
  id: string;
  name: string;
  path: string;
  lastOpened: Date;
  framework: FrameworkType;
  status: ProjectStatus;
}