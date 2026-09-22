/**
 * Deterministic static analysis engine.
 * Browser-safe, regex-based, no LLM. Every finding carries file:line evidence.
 */
import type {
  AnalysisResult,
  ApiCall,
  AuthFlow,
  BusinessFlow,
  Component,
  CrudOperation,
  Entity,
  EntityEvidence,
  EntityField,
  Form,
  FormField,
  FrameworkType,
  HttpMethod,
  LanguageType,
  MockData,
  PackageManagerType,
  ProjectFile,
  StorageUsage,
  UploadInfo,
  ValidationRule,
  AuthDetectionResult,
  StoragePurpose,
  MockDataClassification,
} from '@/shared/types';

let seq = 0;
function nid(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq.toString(36)}_${Date.now().toString(36).slice(-4)}`;
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function ev(path: string, line: number): string {
  return `${path}:${line}`;
}

// ---------------------------------------------------------------------------
// Framework / language / package-manager detection (deterministic)
// ---------------------------------------------------------------------------

export function detectFramework(files: ProjectFile[]): FrameworkType {
  const byPath = new Map(files.map((f) => [f.relativePath.toLowerCase(), f]));
  const has = (...subs: string[]) =>
    [...byPath.keys()].some((p) => subs.some((s) => p.includes(s)));
  const contentHas = (re: RegExp) => files.some((f) => !f.isBinary && re.test(f.content));

  const pkg = files.find(
    (f) => f.relativePath.toLowerCase().endsWith('package.json')
  );
  let deps = '';
  if (pkg && !pkg.isBinary) {
    try {
      const j = JSON.parse(pkg.content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      deps = Object.keys({ ...(j.dependencies ?? {}), ...(j.devDependencies ?? {}) }).join(' ');
    } catch {
      deps = pkg.content;
    }
  }

  if (has('next.config', 'app/layout.tsx', 'app/page.tsx') || /["']next["']/.test(deps)) return 'nextjs';
  if (has('.angular.json', 'angular.json') || /["']@angular\/core["']/.test(deps)) return 'angular';
  if (has('svelte.config', '.svelte-kit') || /["']svelte["']/.test(deps)) return 'svelte';
  if (has('vite.config') && (/["']react["']/.test(deps) || contentHas(/from\s+['"]react['"]/))) return 'react-vite';
  if (/["']vue["']/.test(deps) || has('vue.config')) return 'vue';
  if (/["']react["']/.test(deps) || contentHas(/from\s+['"]react['"]/)) return 'react';
  if (files.some((f) => f.relativePath.toLowerCase().endsWith('.html'))) return 'html';
  return 'unknown';
}

export function detectLanguage(files: ProjectFile[]): LanguageType {
  let ts = 0;
  let js = 0;
  for (const f of files) {
    const e = f.extension.toLowerCase();
    if (e === 'ts' || e === 'tsx') ts += 1;
    else if (e === 'js' || e === 'jsx') js += 1;
  }
  if (ts > 0 && js > 0) return 'mixed';
  if (ts > 0) return 'typescript';
  if (js > 0) return 'javascript';
  // HTML-only frontends still count as javascript for pipeline purposes
  return 'javascript';
}

export function detectPackageManager(files: ProjectFile[]): PackageManagerType {
  const names = files.map((f) => f.relativePath.toLowerCase());
  if (names.some((p) => p.endsWith('pnpm-lock.yaml'))) return 'pnpm';
  if (names.some((p) => p.endsWith('yarn.lock'))) return 'yarn';
  if (names.some((p) => p.endsWith('bun.lockb'))) return 'bun';
  if (names.some((p) => p.endsWith('package-lock.json'))) return 'npm';
  if (names.some((p) => p.endsWith('package.json'))) return 'npm';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Small deterministic parsers
// ---------------------------------------------------------------------------

const FETCH_RE = /\bfetch\s*\(\s*[`'"]([^`'"]+)[`'"]/g;
const AXIOS_RE = /\baxios\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*[`'"]([^`'"]+)[`'"]/gi;
const AXIOS_OBJ_RE = /\baxios\s*\(\s*\{[^}]*?url\s*:\s*[`'"]([^`'"]+)[`'"]/gi;
const API_PREFIX_RE = /(?:\/api(?:\/v\d+)?\/[a-zA-Z0-9_\-./{}:$]+)/g;
const LOCAL_STORAGE_RE = /\b(localStorage|sessionStorage)\s*\.\s*(getItem|setItem|removeItem|clear|key)\s*\(\s*['"`]([^'"`]*?)['"`]/g;
const DOC_COOKIE_RE = /\bdocument\.cookie\b/g;
const INDEXEDDB_RE = /\bindexedDB\s*\.\s*open\s*\(\s*['"`]([^'"`]+)['"`]/g;
const ROUTE_PATH_RE = /\bpath\s*:\s*['"`](\/[^'"`]*?)['"`]/g;
const ROUTE_ELEMENT_RE = /<(Route|Link|NavLink|Navigate)[^>]*\b(path|to)\s*=\s*\{?\s*['"`]([^'"`]+)['"`]/g;
const FORM_TAG_RE = /<form\b[^>]*>/gi;
const INPUT_TAG_RE = /<(input|textarea|select)\b[^>]*>/gi;
const ATTR_RE = /(\w[\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*['"`]([^'"`]*?)['"`]\s*\})/g;
const MOCK_ARRAY_RE = /(?:const|let|var)\s+(\w+)\s*=\s*\[/g;
const MOCK_OBJECT_RE = /(?:const|let|var)\s+(\w+(?:Data|List|Items|Mocks?|Fixture|Seed)s?)\s*=\s*\{/g;
const FUNCTION_COMP_RE = /(?:function\s+([A-Z]\w*)|const\s+([A-Z]\w*)\s*=\s*(?:\([^)]*\)|[^=])*=>)/g;
const LOGIN_HINT_RE = /\b(login|sign ?in|log ?in)\b/i;
const REGISTER_HINT_RE = /\b(register|sign ?up|signup)\b/i;
const REQUIRED_RE = /\brequired\b/;
const EMAIL_RE = /type\s*=\s*['"]?email['"]?|z\.string\(\)\.email|yup\.string\(\)\.email|\.isEmail\(\)/i;
const MINLEN_RE = /minLength\s*[=:]\s*['"]?(\d+)|min\s*\(\s*(\d+)\s*\)|z\.string\(\)\.min\(\s*(\d+)/gi;
const MAXLEN_RE = /maxLength\s*[=:]\s*['""]?(\d+)|max\s*\(\s*(\d+)\s*\)|z\.string\(\)\.max\(\s*(\d+)/gi;

function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(tag)) !== null) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

function fieldTypeFromInput(tagName: string, attrs: Record<string, string>): FormField['type'] {
  if (tagName === 'textarea') return 'textarea';
  if (tagName === 'select') return 'select';
  const t = (attrs['type'] || 'text').toLowerCase();
  const allowed: FormField['type'][] = [
    'text', 'email', 'password', 'number', 'tel', 'url', 'date',
    'datetime-local', 'file', 'hidden', 'submit', 'button', 'reset',
    'checkbox', 'radio',
  ];
  if (allowed.includes(t as FormField['type'])) return t as FormField['type'];
  return 'text';
}

function singularize(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith('ies')) return n.slice(0, -3) + 'y';
  if (n.endsWith('ses') || n.endsWith('xes') || n.endsWith('zes')) return n.slice(0, -2);
  if (n.endsWith('s') && n.length > 3) return n.slice(0, -1);
  return n;
}

function pluralizeName(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith('y')) return n.slice(0, -1) + 'ies';
  if (n.endsWith('s')) return n;
  return n + 's';
}

const STOP_ENTITIES = new Set([
  'auth', 'login', 'register', 'logout', 'health', 'me', 'token', 'refresh',
  'api', 'v1', 'v2', 'v3', 'assets', 'static', 'public', 'src', 'pages',
  'components', 'mock', 'mocks', 'data', 'config', 'utils', 'lib', 'hooks',
  'handlelogin', 'handlesubmit', 'onsubmit', 'submit',
]);

function stripHandlerVerb(raw: string): string {
  return raw
    .replace(/^(handle|on|do|submit|process)/i, '')
    .replace(/(handler|submit|click)$/i, '');
}

function cleanEntityName(raw: string): string | null {
  if (!raw) return null;
  // camelCase handler names: split into words, take the last noun-ish token
  let candidate = raw;
  if (/^[a-z]+[A-Z]/.test(raw) && raw.includes('/') === false) {
    const parts = raw.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_-]+/);
    candidate = parts[parts.length - 1] ?? raw;
    candidate = stripHandlerVerb(raw).replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_-]+/).pop() ?? candidate;
  }
  const noQuery = candidate.replace(/^\/+/, '').split('?')[0].split('#')[0];
  // Split URL into segments, drop api/version/auth noise, take last meaningful one
  const segs = noQuery
    .replace(/^(https?:\/\/[^/]+)/i, '')
    .split('/')
    .map((s) => s.replace(/[{}$:]/g, '').replace(/[^a-zA-Z0-9_-]/g, ''))
    .filter(Boolean)
    .filter((s) => !/^v\d+$/i.test(s) && s.toLowerCase() !== 'api');
  if (segs.length === 0) return null;
  const last = segs[segs.length - 1];
  // skip :id-style params and numeric ids
  if (/^(:.+|\d+|{.+})$/.test(last)) {
    if (segs.length < 2) return null;
    const prev = segs[segs.length - 2];
    return finalizeEntity(prev);
  }
  return finalizeEntity(last);
}

function finalizeEntity(cleaned: string): string | null {
  const norm = cleaned.replace(/[^a-zA-Z0-9_]/g, '');
  if (!norm || norm.length < 3) return null;
  const lower = norm.toLowerCase();
  if (STOP_ENTITIES.has(lower)) return null;
  if (/^(get|post|put|patch|delete|fetch|load|handle|on).+/i.test(norm) && norm.length < 14) {
    const stripped = stripHandlerVerb(norm);
    if (!stripped || STOP_ENTITIES.has(stripped.toLowerCase())) return null;
    if (stripped.length < 3) return null;
    return pluralizeName(singularize(stripped.toLowerCase()));
  }
  return pluralizeName(singularize(lower));
}

function inferDbType(fieldName: string, inputType: string): EntityField['type'] {
  const n = fieldName.toLowerCase();
  if (n === 'id' || n.endsWith('_id')) return 'bigint';
  if (n.includes('email')) return 'varchar';
  if (n.includes('password')) return 'varchar';
  if (n.includes('price') || n.includes('total') || n.includes('amount') || n.includes('cost')) return 'decimal';
  if (n.includes('qty') || n.includes('quantity') || n.includes('count') || n.includes('stock') || n.includes('age')) return 'int';
  if (n.includes('is_') || n.startsWith('is') || n.includes('active') || n === 'published') return 'boolean';
  if (n.includes('_at') || n.includes('date')) return inputType === 'date' ? 'date' : 'datetime';
  if (n === 'body' || n === 'content' || n === 'description' || n === 'bio') return 'text';
  switch (inputType) {
    case 'number': return 'int';
    case 'date': return 'date';
    case 'datetime-local': return 'datetime';
    case 'email':
    case 'password':
    case 'text':
    case 'tel':
    case 'url': return 'varchar';
    case 'checkbox': return 'boolean';
    case 'file': return 'varchar';
    default: return 'varchar';
  }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function analyzeFrontend(files: ProjectFile[], projectId: string): AnalysisResult {
  const textFiles = files.filter((f) => !f.isBinary);
  const framework = detectFramework(files);
  const language = detectLanguage(files);

  const routes = detectRoutes(textFiles);
  const components = detectComponents(textFiles);
  const forms = detectForms(textFiles);
  const apiCalls = detectApiCalls(textFiles);
  const storageUsage = detectStorage(textFiles);
  const mockData = detectMockData(textFiles);
  const validations = detectValidations(textFiles, forms);
  const uploads = detectUploads(textFiles);
  const authDetection = detectAuthentication(textFiles, forms, apiCalls, storageUsage, routes);
  const authFlows = authDetection.flows;
  const entities = inferEntities(forms, apiCalls, mockData, storageUsage, routes);
  const crudOperations = inferCrud(entities, apiCalls, forms);
  const businessFlows = inferBusinessFlows(routes, forms, apiCalls, authFlows);

  const warnings = [];
  if (files.length === 0) {
    warnings.push({ code: 'EMPTY_PROJECT', message: 'No files were provided for analysis.', severity: 'high' as const });
  }
  if (framework === 'unknown' && files.length > 0) {
    warnings.push({ code: 'UNKNOWN_FRAMEWORK', message: 'Framework could not be determined; generic HTML analysis was applied.', severity: 'medium' as const });
  }
  const withoutEvidence = entities.filter((e) => e.evidence.length < 2);
  for (const e of withoutEvidence) {
    warnings.push({
      code: 'WEAK_ENTITY',
      message: `Entity "${e.name}" has a single evidence source and needs developer review.`,
      severity: 'low' as const,
    });
  }

  return {
    projectId,
    analyzedAt: new Date(),
    framework,
    language,
    filesAnalyzed: textFiles.length,
    routes,
    components,
    forms,
    apiCalls,
    storageUsage,
    mockData,
    authFlows,
    authDetection,
    entities,
    crudOperations,
    uploads,
    validations,
    businessFlows,
    warnings,
    errors: [],
  };
}

function detectRoutes(files: ProjectFile[]) {
  const out: AnalysisResult['routes'] = [];
  for (const f of files) {
    const ext = f.extension.toLowerCase();
    if (!['tsx', 'jsx', 'ts', 'js', 'vue'].includes(ext)) continue;
    // Next.js app-dir convention: app/<route>/page.tsx
    const appMatch = f.relativePath.match(/app\/(.*?)\/page\.(tsx|jsx|ts|js)$/i);
    if (appMatch) {
      const seg = appMatch[1].replace(/\/page$/, '').replace(/\(.*?\)/g, '').trim();
      out.push({
        path: '/' + seg.replace(/\/+/g, '/').replace(/^\/$/, ''),
        component: 'Page',
        componentPath: f.relativePath,
        requiresAuth: /middleware|withAuth|requireAuth|protected/i.test(f.content),
        methods: ['GET'],
        referencedData: [],
        forms: [],
        actions: [],
      });
      continue;
    }
    let m: RegExpExecArray | null;
    ROUTE_PATH_RE.lastIndex = 0;
    while ((m = ROUTE_PATH_RE.exec(f.content)) !== null) {
      const p = m[1];
      if (!p.startsWith('/')) continue;
      // avoid matching API paths as frontend routes
      if (p.startsWith('/api')) continue;
      out.push({
        path: p,
        component: f.relativePath.split('/').pop() ?? 'Unknown',
        componentPath: f.relativePath,
        requiresAuth: /PrivateRoute|RequireAuth|withAuth|protected|middleware/i.test(f.content),
        methods: ['GET'],
        referencedData: [],
        forms: [],
        actions: [],
      });
      if (out.length > 300) break;
    }
    ROUTE_ELEMENT_RE.lastIndex = 0;
    while ((m = ROUTE_ELEMENT_RE.exec(f.content)) !== null) {
      const to = m[3];
      if (!to || !to.startsWith('/')) continue;
      if (out.some((r) => r.path === to && r.componentPath === f.relativePath)) continue;
      out.push({
        path: to,
        component: f.relativePath.split('/').pop() ?? 'Unknown',
        componentPath: f.relativePath,
        requiresAuth: /PrivateRoute|RequireAuth/i.test(f.content),
        methods: ['GET'],
        referencedData: [],
        forms: [],
        actions: [],
      });
      if (out.length > 300) break;
    }
  }
  // Dedupe by path+file
  const seen = new Set<string>();
  return out.filter((r) => {
    const k = `${r.path}::${r.componentPath}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 300);
}

function detectComponents(files: ProjectFile[]): Component[] {
  const out: Component[] = [];
  for (const f of files) {
    const ext = f.extension.toLowerCase();
    if (!['tsx', 'jsx', 'ts', 'js', 'vue'].includes(ext)) continue;
    let m: RegExpExecArray | null;
    FUNCTION_COMP_RE.lastIndex = 0;
    let count = 0;
    while ((m = FUNCTION_COMP_RE.exec(f.content)) !== null && count < 20) {
      const name = m[1] ?? m[2];
      if (!name) continue;
      count += 1;
      const lower = name.toLowerCase();
      let type: Component['type'] = 'unknown';
      if (/page|screen|view/.test(lower)) type = 'page';
      else if (/layout|shell|frame/.test(lower)) type = 'layout';
      else if (/form/.test(lower)) type = 'form';
      else if (/table|grid|datatable/.test(lower)) type = 'table';
      else if (/modal|dialog|drawer|popup/.test(lower)) type = 'modal';
      else if (/card|tile|panel/.test(lower)) type = 'card';
      else if (/list/.test(lower)) type = 'list';
      else if (/nav|header|sidebar|menu|router|link/.test(lower)) type = 'navigation';
      else if (/use[A-Z]/.test(name)) type = 'hook';
      else if (/context|provider|store/.test(lower)) type = 'context';
      else if (/service|api|client|hook/.test(lower)) type = 'service';
      const idx = m.index;
      out.push({
        name,
        path: f.relativePath,
        type,
        props: [],
        hooks: extractHooks(f.content),
        imports: [],
        exports: [name],
        jsxElements: [],
      });
      void idx;
      if (out.length > 400) break;
    }
  }
  return out.slice(0, 400);
}

function extractHooks(content: string): string[] {
  const out = new Set<string>();
  const re = /\b(use[A-Z]\w*|useState|useEffect|useMemo|useCallback|useContext|useReducer|useRef|useQuery|useMutation)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) out.add(m[1]);
  return [...out].slice(0, 12);
}

function detectForms(files: ProjectFile[]): Form[] {
  const forms: Form[] = [];
  for (const f of files) {
    if (f.isBinary) continue;
    const ext = f.extension.toLowerCase();
    if (!['tsx', 'jsx', 'ts', 'js', 'vue', 'html'].includes(ext)) continue;
    FORM_TAG_RE.lastIndex = 0;
    let fm: RegExpExecArray | null;
    while ((fm = FORM_TAG_RE.exec(f.content)) !== null) {
      const formTag = fm[0];
      const formAttrs = parseAttrs(formTag);
      // Find inputs until </form> or next <form>
      const rest = f.content.slice(fm.index, fm.index + 12000);
      const closeIdx = rest.search(/<\/form\s*>/i);
      const scope = closeIdx > 0 ? rest.slice(0, closeIdx) : rest.slice(0, 6000);
      const fields: FormField[] = [];
      INPUT_TAG_RE.lastIndex = 0;
      let im: RegExpExecArray | null;
      while ((im = INPUT_TAG_RE.exec(scope)) !== null) {
        const tagName = im[1].toLowerCase();
        const attrs = parseAttrs(im[0]);
        const name = attrs['name'] || attrs['id'] || attrs['placeholder'] || '';
        if (!name && tagName === 'select') continue;
        if (!name) continue;
        // skip submit/reset/button inputs without data meaning
        if (tagName === 'input' && ['submit', 'reset', 'button'].includes((attrs['type'] || '').toLowerCase()) && !attrs['name']) continue;
        const line = lineOf(f.content, fm.index + im.index);
        const ftype = fieldTypeFromInput(tagName, attrs);
        const validation: ValidationRule[] = [];
        if (REQUIRED_RE.test(im[0]) || attrs['required'] !== undefined) {
          validation.push({ field: name, type: 'required', message: `${name} is required` });
        }
        if (EMAIL_RE.test(im[0])) validation.push({ field: name, type: 'email' });
        fields.push({
          name: name.replace(/\s+/g, '_').toLowerCase().slice(0, 64),
          type: ftype,
          label: attrs['placeholder'] || attrs['aria-label'] || name,
          required: validation.some((v) => v.type === 'required'),
          validation,
          placeholder: attrs['placeholder'],
        });
        void line;
        if (fields.length >= 40) break;
      }
      if (fields.length === 0) continue;
      const line = lineOf(f.content, fm.index);
      const action = formAttrs['action'] || '';
      const method = (formAttrs['method'] || 'POST').toUpperCase() as HttpMethod;
      const onSubmit = /onSubmit\s*=\s*\{?\s*(\w+)/.exec(scope)?.[1];
      forms.push({
        id: nid('form'),
        name: onSubmit || formAttrs['name'] || formAttrs['id'] || `Form@${f.relativePath.split('/').pop()}`,
        path: f.relativePath,
        component: f.relativePath.split('/').pop() ?? 'Unknown',
        fields,
        actions: [{ type: 'submit', label: 'Submit', handler: onSubmit, apiEndpoint: action || undefined, method }],
        validation: fields.flatMap((x) => x.validation ?? []),
        submissionHandler: onSubmit,
        apiEndpoint: action || undefined,
        method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? method : 'POST',
      });
      void line;
      void ev;
      if (forms.length >= 120) break;
    }
  }
  return forms;
}

function detectApiCalls(files: ProjectFile[]): ApiCall[] {
  const out: ApiCall[] = [];
  for (const f of files) {
    if (f.isBinary) continue;
    const ext = f.extension.toLowerCase();
    if (!['ts', 'tsx', 'js', 'jsx', 'vue'].includes(ext)) continue;
    const push = (method: HttpMethod, url: string, index: number) => {
      const trimmed = url.trim();
      if (!trimmed || trimmed.startsWith('data:')) return;
      // Only keep http(s), relative, or /api calls — skip pure anchor links
      if (/^(#|mailto:|tel:)/i.test(trimmed)) return;
      const isMock = /mock|fixture|fake|stub|example\.com|jsonplaceholder|localhost:9999/i.test(trimmed + f.content.slice(Math.max(0, index - 200), index));
      const line = lineOf(f.content, index);
      // try to capture method-adjacent auth header usage
      const window = f.content.slice(Math.max(0, index - 400), index + 400);
      const authHeader = /Authorization/i.test(window) ? window.match(/Authorization['"`\s:]+([^'"`\n}]{0,80})/)?.[1] : undefined;
      const q: Record<string, string> = {};
      const qIdx = trimmed.indexOf('?');
      if (qIdx >= 0) {
        for (const part of trimmed.slice(qIdx + 1).split('&')) {
          const [k, v] = part.split('=');
          if (k) q[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
        }
      }
      out.push({
        id: nid('api'),
        method,
        url: trimmed.slice(0, 300),
        path: f.relativePath,
        component: f.relativePath.split('/').pop() ?? 'Unknown',
        componentPath: f.relativePath,
        queryParams: q,
        headers: {},
        authHeader,
        isMock,
      });
      void line;
    };
    let m: RegExpExecArray | null;
    FETCH_RE.lastIndex = 0;
    while ((m = FETCH_RE.exec(f.content)) !== null) {
      const url = m[1];
      const after = f.content.slice(m.index, m.index + 600);
      const methodMatch = /method\s*:\s*['"`](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)['"`]/i.exec(after);
      push(((methodMatch?.[1] ?? 'GET').toUpperCase() as HttpMethod), url, m.index);
      if (out.length > 400) break;
    }
    AXIOS_RE.lastIndex = 0;
    while ((m = AXIOS_RE.exec(f.content)) !== null) {
      push((m[1].toUpperCase() as HttpMethod), m[2], m.index);
      if (out.length > 400) break;
    }
    AXIOS_OBJ_RE.lastIndex = 0;
    while ((m = AXIOS_OBJ_RE.exec(f.content)) !== null) {
      const methodMatch = /method\s*:\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]/i.exec(m[0]);
      push(((methodMatch?.[1] ?? 'GET').toUpperCase() as HttpMethod), m[1], m.index);
      if (out.length > 400) break;
    }
    // Bare /api/... string literals that never go through fetch (planned endpoints)
    API_PREFIX_RE.lastIndex = 0;
    let am: RegExpExecArray | null;
    while ((am = API_PREFIX_RE.exec(f.content)) !== null) {
      const url = am[0];
      if (out.some((c) => c.url === url && c.componentPath === f.relativePath)) continue;
      push('GET', url, am.index);
      if (out.length > 400) break;
    }
  }
  return out.slice(0, 400);
}

function detectStorage(files: ProjectFile[]): StorageUsage[] {
  const out: StorageUsage[] = [];
  for (const f of files) {
    if (f.isBinary) continue;
    let m: RegExpExecArray | null;
    LOCAL_STORAGE_RE.lastIndex = 0;
    while ((m = LOCAL_STORAGE_RE.exec(f.content)) !== null) {
      const kind = m[1] as 'localStorage' | 'sessionStorage';
      const op = m[2] as StorageUsage['operations'][number];
      const key = m[3] || '(unknown)';
      const ctx = f.content.slice(Math.max(0, m.index - 300), m.index + 120).toLowerCase();
      let purpose: StoragePurpose = 'unknown';
      if (/token|jwt|auth|session|user|login/.test(key.toLowerCase()) || /token|jwt|auth/.test(ctx)) purpose = 'authentication';
      else if (/theme|setting|locale|preference|sidebar|mode/.test(key.toLowerCase())) purpose = 'settings';
      else if (/cart|order|draft|todo|record|profile/.test(ctx)) purpose = 'persistent_records';
      else if (/cache|query|list|data/.test(ctx)) purpose = 'cached_data';
      else purpose = 'ui_state';
      out.push({
        id: nid('st'),
        type: kind,
        key: key.slice(0, 120),
        operations: [op],
        component: f.relativePath.split('/').pop() ?? 'Unknown',
        componentPath: f.relativePath,
        purpose,
      });
      if (out.length > 200) break;
    }
    DOC_COOKIE_RE.lastIndex = 0;
    if (DOC_COOKIE_RE.test(f.content)) {
      out.push({
        id: nid('st'),
        type: 'cookie',
        key: 'document.cookie',
        operations: ['get'],
        component: f.relativePath.split('/').pop() ?? 'Unknown',
        componentPath: f.relativePath,
        purpose: /token|session|auth/i.test(f.content) ? 'authentication' : 'unknown',
      });
    }
    INDEXEDDB_RE.lastIndex = 0;
    while ((m = INDEXEDDB_RE.exec(f.content)) !== null) {
      out.push({
        id: nid('st'),
        type: 'indexedDB',
        key: m[1].slice(0, 120),
        operations: ['get'],
        component: f.relativePath.split('/').pop() ?? 'Unknown',
        componentPath: f.relativePath,
        purpose: 'persistent_records',
      });
    }
  }
  return out.slice(0, 200);
}

const MOCK_SKIP_FILES = /package\.json$|package-lock\.json$|tsconfig.*\.json$|\.config\.(js|ts|json)$|manifest\.json$|composer\.json$/i;

function detectMockData(files: ProjectFile[]): MockData[] {
  const out: MockData[] = [];
  for (const f of files) {
    if (f.isBinary) continue;
    if (MOCK_SKIP_FILES.test(f.relativePath)) continue;
    const ext = f.extension.toLowerCase();
    if (ext === 'json') {
      try {
        const parsed: unknown = JSON.parse(f.content);
        const isArray = Array.isArray(parsed);
        if (!isArray) continue; // object JSON (configs, locales) is not entity data
        const first = (parsed as unknown[])[0];
        const keys = first && typeof first === 'object' && first !== null ? Object.keys(first as Record<string, unknown>).slice(0, 10) : [];
        if (!hasRecordShape(keys)) continue;
        const name = f.relativePath.split('/').pop()?.replace(/\.json$/i, '') ?? 'data';
        out.push({
          id: nid('mock'),
          name,
          path: f.relativePath,
          variableName: name,
          dataType: 'json_file',
          structure: { kind: 'array', keys, length: (parsed as unknown[]).length },
          classification: 'database_data',
          usageLocations: [],
          entityCandidate: cleanEntityName(name) ?? undefined,
        });
      } catch {
        // not parseable — skip
      }
      continue;
    }
    if (!['ts', 'tsx', 'js', 'jsx'].includes(ext)) continue;
    // Skip huge bundles / node_modules-ish paths
    if (f.content.length > 300_000) continue;
    let m: RegExpExecArray | null;
    MOCK_ARRAY_RE.lastIndex = 0;
    while ((m = MOCK_ARRAY_RE.exec(f.content)) !== null) {
      const varName = m[1];
      if (/^(use|set|get|tmp|el|e|i)$/i.test(varName)) continue;
      // peek next 800 chars: does it look like array of objects with keys?
      const peek = f.content.slice(m.index, m.index + 1500);
      if (!/\{\s*\w+\s*:/.test(peek)) continue;
      const keys = [...peek.matchAll(/(\w+)\s*:/g)].map((x) => x[1]).filter((k, i, a) => a.indexOf(k) === i).slice(0, 10);
      if (keys.length < 2) continue;
      out.push({
        id: nid('mock'),
        name: varName,
        path: f.relativePath,
        variableName: varName,
        dataType: 'array',
        structure: { kind: 'array', keys, sample: peek.slice(0, 300) },
        classification: classifyMock(varName, peek),
        usageLocations: [f.relativePath],
        entityCandidate: cleanEntityName(varName) ?? undefined,
      });
      if (out.length > 150) break;
    }
    MOCK_OBJECT_RE.lastIndex = 0;
    while ((m = MOCK_OBJECT_RE.exec(f.content)) !== null) {
      const varName = m[1];
      out.push({
        id: nid('mock'),
        name: varName,
        path: f.relativePath,
        variableName: varName,
        dataType: 'constant',
        structure: { kind: 'object', keys: [] as string[] },
        classification: classifyMock(varName, ''),
        usageLocations: [f.relativePath],
        entityCandidate: cleanEntityName(varName) ?? undefined,
      });
      if (out.length > 150) break;
    }
  }
  return out.slice(0, 150);
}

function classifyMock(name: string, content: string): MockDataClassification {
  const n = name.toLowerCase();
  const c = content.toLowerCase();
  if (/package|config|constant|theme|option|label|nav|menu|route|locale|i18n|translation/.test(n)) return 'configuration';
  if (/(email|password|price|order|user|customer|product|post|comment|task|todo)s?/.test(n + c) && /id|name|email/.test(c)) return 'database_data';
  if (/demo|example|sample|placeholder|mock|fake|stub|dummy/.test(n + c)) return 'demo_data';
  if (/lorem|test/.test(c)) return 'demo_data';
  if (/\bid\b/.test(c) && /\b(name|title|email)\b/.test(c)) return 'database_data';
  return 'unknown';
}

/** Array-of-objects only counts as entity evidence if it looks like DB records. */
function hasRecordShape(keys: string[]): boolean {
  if (keys.length < 2) return false;
  const lower = keys.map((k) => k.toLowerCase());
  const hasId = lower.includes('id') || lower.some((k) => k.endsWith('_id'));
  const hasName = ['name', 'title', 'email', 'sku', 'slug', 'label'].some((n) => lower.includes(n));
  return hasId && hasName;
}

function detectValidations(files: ProjectFile[], forms: Form[]): ValidationRule[] {
  const out: ValidationRule[] = [...forms.flatMap((f) => f.validation)];
  for (const f of files) {
    if (f.isBinary) continue;
    let m: RegExpExecArray | null;
    MINLEN_RE.lastIndex = 0;
    while ((m = MINLEN_RE.exec(f.content)) !== null) {
      out.push({ field: 'field', type: 'min_length', value: Number(m[1] ?? m[2] ?? m[3] ?? 0) });
      if (out.length > 300) break;
    }
    MAXLEN_RE.lastIndex = 0;
    while ((m = MAXLEN_RE.exec(f.content)) !== null) {
      out.push({ field: 'field', type: 'max_length', value: Number(m[1] ?? m[2] ?? m[3] ?? 0) });
      if (out.length > 300) break;
    }
  }
  return out.slice(0, 300);
}

function detectUploads(files: ProjectFile[]): UploadInfo[] {
  const out: UploadInfo[] = [];
  for (const f of files) {
    if (f.isBinary) continue;
    const re = /<input\b[^>]*type\s*=\s*['"]?file['"]?[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.content)) !== null) {
      const attrs = parseAttrs(m[0]);
      out.push({
        id: nid('up'),
        fieldName: attrs['name'] || 'file',
        component: f.relativePath.split('/').pop() ?? 'Unknown',
        componentPath: f.relativePath,
        acceptedTypes: (attrs['accept'] || '').split(',').map((s) => s.trim()).filter(Boolean),
        multiple: attrs['multiple'] !== undefined,
      });
      if (out.length > 50) break;
    }
    if (/FormData|multipart\/form-data/.test(f.content) && out.length < 50) {
      // record that uploads exist even without explicit input tag
      const has = out.some((u) => u.componentPath === f.relativePath);
      if (!has && /append\(\s*['"`](file|image|avatar|attachment)/i.test(f.content)) {
        out.push({
          id: nid('up'),
          fieldName: 'file',
          component: f.relativePath.split('/').pop() ?? 'Unknown',
          componentPath: f.relativePath,
          acceptedTypes: [],
          multiple: false,
        });
      }
    }
  }
  return out;
}

export function detectAuthentication(
  files: ProjectFile[],
  forms: Form[],
  apiCalls: ApiCall[],
  storage: StorageUsage[],
  routes: AnalysisResult['routes']
): AuthDetectionResult {
  const evidence: string[] = [];
  let score = 0;

  // 1. Login form detection
  const loginForm = forms.find(
    (f) =>
      LOGIN_HINT_RE.test(f.name) ||
      (f.fields.some((x) => x.type === 'password') && f.fields.some((x) => x.type === 'email' || x.name === 'email' || x.name === 'username'))
  );
  const hasLoginForm = !!loginForm;
  if (hasLoginForm) {
    score += 0.35;
    evidence.push(`Login form detected: "${loginForm.name}" with fields [${loginForm.fields.map((f) => f.name).join(', ')}] in ${loginForm.path}`);
  }

  // 2. Register form detection
  const registerForm = forms.find(
    (f) =>
      REGISTER_HINT_RE.test(f.name) ||
      (f.fields.some((x) => x.type === 'password') && f.fields.some((x) => /name|confirm/i.test(x.name)))
  );
  const hasRegisterForm = !!registerForm;
  if (hasRegisterForm) {
    score += 0.25;
    evidence.push(`Registration form detected: "${registerForm.name}" in ${registerForm.path}`);
  }

  // 3. Password fields
  const allPasswordFields = forms.flatMap((f) => f.fields.filter((x) => x.type === 'password' || x.name === 'password'));
  if (allPasswordFields.length > 0 && !hasLoginForm && !hasRegisterForm) {
    score += 0.15;
    evidence.push(`Password input fields detected (${allPasswordFields.length} field(s))`);
  }

  // 4. Token & Session Storage
  const tokenStorage = storage.filter((s) => s.purpose === 'authentication' || /token|jwt|auth|session/i.test(s.key));
  const hasTokenStorage = tokenStorage.length > 0;
  if (hasTokenStorage) {
    score += 0.25;
    evidence.push(`Authentication token storage observed: ${tokenStorage.map((s) => `${s.type}['${s.key}'] in ${s.componentPath}`).join(', ')}`);
  }

  // 5. Auth API calls
  const authCalls = apiCalls.filter((c) => /auth|login|register|logout|signin|signup|token|refresh|me\b/i.test(c.url));
  const hasAuthApiCalls = authCalls.length > 0;
  if (hasAuthApiCalls) {
    score += 0.30;
    evidence.push(`Authentication API calls observed: ${authCalls.map((c) => `${c.method} ${c.url}`).slice(0, 3).join(', ')}`);
  }

  // 6. Logout signals
  const allContentSample = files.map((f) => f.content.slice(0, 4000)).join('\n');
  const hasLogout = /logout|signout|sign ?out/i.test(allContentSample) || authCalls.some((c) => /logout|signout/i.test(c.url));
  if (hasLogout) {
    score += 0.10;
    evidence.push('Logout action / button pattern observed');
  }

  // 7. Protected routes
  const protectedRoutes = routes.filter((r) => r.requiresAuth);
  const hasProtectedRoutes = protectedRoutes.length > 0;
  if (hasProtectedRoutes) {
    score += 0.20;
    evidence.push(`Protected routes detected (${protectedRoutes.length} route(s): ${protectedRoutes.map((r) => r.path).slice(0, 3).join(', ')})`);
  }

  // 8. Auth context / hooks
  const hasAuthContext = /\b(useAuth|useUser|AuthContext|AuthProvider|authState)\b/.test(allContentSample);
  if (hasAuthContext) {
    score += 0.15;
    evidence.push('Auth context / state provider hook detected in components');
  }

  // Flows
  const flows: AuthFlow[] = [];
  if (hasLoginForm || authCalls.some((c) => /login|signin/i.test(c.url))) {
    const loginCall = authCalls.find((c) => /login|signin/i.test(c.url));
    flows.push({
      id: nid('auth'),
      type: 'login',
      component: loginForm?.component ?? loginCall?.component ?? 'Login',
      componentPath: loginForm?.path ?? loginCall?.componentPath ?? '',
      fields: loginForm?.fields ?? [],
      endpoints: loginCall ? [{ action: 'login', url: loginCall.url, method: loginCall.method }] : [],
      tokenStorage: tokenStorage[0],
      protectedRoutes: protectedRoutes.map((r) => r.path),
    });
  }

  if (hasRegisterForm || authCalls.some((c) => /register|signup/i.test(c.url))) {
    const regCall = authCalls.find((c) => /register|signup/i.test(c.url));
    flows.push({
      id: nid('auth'),
      type: 'register',
      component: registerForm?.component ?? regCall?.component ?? 'Register',
      componentPath: registerForm?.path ?? regCall?.componentPath ?? '',
      fields: registerForm?.fields ?? [],
      endpoints: regCall ? [{ action: 'register', url: regCall.url, method: regCall.method }] : [],
      tokenStorage: tokenStorage[0],
      protectedRoutes: [],
    });
  }

  if (hasLogout) {
    flows.push({
      id: nid('auth'),
      type: 'logout',
      component: 'App',
      componentPath: '',
      fields: [],
      endpoints: [],
      tokenStorage: tokenStorage[0],
      protectedRoutes: [],
    });
  }

  const confidence = Math.min(0.98, Math.max(0.15, Math.round(score * 100) / 100));
  const detected = confidence >= 0.70 && (hasLoginForm || hasRegisterForm || hasAuthApiCalls);
  const status: 'detected' | 'not_detected' | 'ambiguous' = detected
    ? 'detected'
    : score >= 0.30
      ? 'ambiguous'
      : 'not_detected';

  let reason = '';
  if (status === 'detected') {
    reason = 'Strong evidence of authentication flows and credentials found in frontend.';
  } else if (status === 'ambiguous') {
    reason = 'Partial authentication signals observed, but insufficient for automatic enablement.';
  } else {
    reason = 'No authentication system detected in this application.';
    if (evidence.length === 0) {
      evidence.push('No login form detected');
      evidence.push('No registration flow detected');
      evidence.push('No token/session usage detected');
      evidence.push('No auth API calls detected');
    }
  }

  return {
    detected,
    confidence,
    status,
    evidence,
    reason,
    hasLoginForm,
    hasRegisterForm,
    hasLogout,
    hasTokenStorage,
    hasAuthApiCalls,
    hasProtectedRoutes,
    flows,
  };
}

export function detectAuthFlows(
  files: ProjectFile[],
  forms: Form[],
  apiCalls: ApiCall[],
  storage: StorageUsage[],
  routes: AnalysisResult['routes'] = []
): AuthFlow[] {
  const result = detectAuthentication(files, forms, apiCalls, storage, routes);
  return result.flows;
}

function inferEntities(
  forms: Form[],
  apiCalls: ApiCall[],
  mocks: MockData[],
  storage: StorageUsage[],
  routes: AnalysisResult['routes']
): Entity[] {
  const buckets = new Map<string, { evidence: EntityEvidence[]; fields: Map<string, EntityField>; sources: Set<Entity['source'][number]> }>();

  const ensure = (name: string) => {
    const key = pluralizeName(singularize(name.toLowerCase()));
    if (!buckets.has(key)) buckets.set(key, { evidence: [], fields: new Map(), sources: new Set() });
    return buckets.get(key)!;
  };

  const addField = (
    bucket: { fields: Map<string, EntityField> },
    name: string,
    inputType: string,
    required: boolean,
    evd: string
  ) => {
    const key = name.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 64) || 'field';
    if (bucket.fields.has(key)) {
      const existing = bucket.fields.get(key)!;
      existing.required = existing.required || required;
      return;
    }
    bucket.fields.set(key, {
      name: key,
      type: inferDbType(key, inputType),
      required,
      unique: key === 'email' || key === 'slug' || key === 'sku',
      primaryKey: key === 'id',
      description: `Observed in frontend (${evd})`,
    });
  };

  for (const form of forms) {
    // entity guess: explicit API endpoint first, then form name nouns.
    // Submission-handler identifiers (handleLogin, onSubmit, …) are verbs,
    // not entities, so they are deliberately NOT used as candidates.
    const fromEndpoint = form.apiEndpoint ? cleanEntityName(form.apiEndpoint) : null;
    const fromName = cleanEntityName(form.name.replace(/(form|page|modal|dialog|checkout)/gi, ' '));
    let entityName: string | null = fromEndpoint ?? fromName;
    if (!entityName && form.fields.some((f) => /title|body|content|excerpt/i.test(f.name))) {
      entityName = 'posts';
    }
    if (!entityName) continue;
    const b = ensure(entityName);
    b.evidence.push({
      type: 'form',
      source: `${form.path}`,
      description: `Form "${form.name}" with fields [${form.fields.map((f) => f.name).join(', ')}]`,
      confidence: 0.8,
    });
    b.sources.add('form');
    for (const fld of form.fields) {
      if (['submit', 'button', 'reset'].includes(fld.type)) continue;
      addField(b, fld.name, fld.type, fld.required, form.path);
    }
  }

  for (const call of apiCalls) {
    // Last meaningful URL segment (skips /api, /v1, :id params)
    const name = cleanEntityName(call.url.split('?')[0].split('#')[0]);
    if (!name) continue;
    const b = ensure(name);
    b.evidence.push({
      type: 'api_call',
      source: call.componentPath,
      description: `${call.method} ${call.url}`,
      confidence: call.isMock ? 0.45 : 0.9,
    });
    b.sources.add('api_call');
  }

  for (const mock of mocks) {
    if (!mock.entityCandidate) continue;
    if (mock.classification === 'configuration' || mock.classification === 'static_ui_data' || mock.classification === 'unknown') continue;
    const b = ensure(mock.entityCandidate);
    const keys: string[] = Array.isArray((mock.structure as { keys?: string[] })?.keys)
      ? (mock.structure as { keys: string[] }).keys
      : [];
    b.evidence.push({
      type: 'mock_data',
      source: mock.path,
      description: `Mock "${mock.variableName}" (${mock.classification}) keys=[${keys.slice(0, 8).join(', ')}]`,
      confidence: mock.classification === 'database_data' ? 0.75 : 0.5,
    });
    b.sources.add('mock_data');
    for (const k of keys.slice(0, 20)) {
      addField(b, k, 'text', false, mock.path);
    }
  }

  for (const s of storage) {
    if (s.purpose !== 'persistent_records' && s.purpose !== 'cached_data') continue;
    const name = cleanEntityName(s.key);
    if (!name) continue;
    const b = ensure(name);
    b.evidence.push({
      type: 'storage',
      source: s.componentPath,
      description: `${s.type}.${s.operations[0]}("${s.key}")`,
      confidence: 0.5,
    });
    b.sources.add('storage');
  }

  for (const r of routes) {
    const name = cleanEntityName(r.path);
    if (!name) continue;
    // routes alone are weak evidence — only attach if bucket already exists
    if (!buckets.has(name)) continue;
    buckets.get(name)!.evidence.push({
      type: 'route',
      source: r.componentPath,
      description: `Route ${r.path}`,
      confidence: 0.4,
    });
  }

  const entities: Entity[] = [];
  for (const [name, b] of buckets) {
    if (b.evidence.length === 0) continue;
    // confidence = weighted by source diversity + count, capped
    const diversity = b.sources.size;
    const base = Math.min(0.95, 0.35 + diversity * 0.18 + Math.min(0.25, b.evidence.length * 0.05));
    const singular = singularize(name);
    const fields = [...b.fields.values()];
    // always ensure id PK
    if (!fields.some((f) => f.name === 'id')) {
      fields.unshift({ name: 'id', type: 'bigint', required: false, unique: false, primaryKey: true, description: 'Auto-added surrogate key (not observed in frontend)' });
    }
    entities.push({
      id: nid('ent'),
      name,
      singularName: singular,
      pluralName: name,
      confidence: Math.round(base * 100) / 100,
      evidence: b.evidence.slice(0, 12),
      fields: fields.slice(0, 30),
      relationships: [],
      crudOperations: [],
      source: [...b.sources],
    });
  }

  // Infer relationships: *_id fields → FK guess
  const names = new Set(entities.map((e) => e.name));
  for (const e of entities) {
    for (const f of e.fields) {
      if (!f.name.endsWith('_id')) continue;
      const targetSingular = f.name.slice(0, -3);
      const target = pluralizeName(targetSingular);
      if (names.has(target) && target !== e.name) {
        f.foreignKey = { table: target, column: 'id', onDelete: 'CASCADE', onUpdate: 'CASCADE' };
        e.relationships.push({
          type: 'many-to-one',
          targetEntity: target,
          sourceField: f.name,
          targetField: 'id',
        });
      }
    }
  }

  return entities.sort((a, b) => b.confidence - a.confidence).slice(0, 40);
}

function inferCrud(entities: Entity[], apiCalls: ApiCall[], forms: Form[]): CrudOperation[] {
  const out: CrudOperation[] = [];
  for (const e of entities) {
    const related = apiCalls.filter((c) => {
      const n = cleanEntityName(c.url.split('?')[0]);
      return n === e.name;
    });
    const hasForm = forms.some((f) => f.fields.length > 0 && e.evidence.some((x) => x.source === f.path));
    const ops: Array<{ op: CrudOperation['operation']; test: (c: ApiCall) => boolean; formHint: boolean }> = [
      { op: 'list', test: (c) => c.method === 'GET' && !/\{id\}|\/:id\/\d+$/.test(c.url), formHint: false },
      { op: 'read', test: (c) => c.method === 'GET' && /(\{id\}|:id|\/\d+)(\?|$)/.test(c.url), formHint: false },
      { op: 'create', test: (c) => c.method === 'POST', formHint: hasForm },
      { op: 'update', test: (c) => c.method === 'PUT' || c.method === 'PATCH', formHint: hasForm },
      { op: 'delete', test: (c) => c.method === 'DELETE', formHint: false },
    ];
    for (const o of ops) {
      const matches = related.filter(o.test);
      const detected = matches.length > 0 || (o.formHint && (o.op === 'create' || o.op === 'update'));
      out.push({
        entity: e.name,
        operation: o.op,
        detected,
        confidence: matches.length > 0 ? 0.9 : o.formHint ? 0.55 : 0.2,
        evidence: matches.slice(0, 3).map((m) => `${m.method} ${m.url} (${m.componentPath})`),
        apiEndpoint: matches[0]?.url,
      });
    }
  }
  return out;
}

function inferBusinessFlows(
  routes: AnalysisResult['routes'],
  forms: Form[],
  apiCalls: ApiCall[],
  authFlows: AuthFlow[]
): BusinessFlow[] {
  const flows: BusinessFlow[] = [];
  if (authFlows.some((a) => a.type === 'login')) {
    flows.push({
      id: nid('flow'),
      name: 'Authentication',
      description: 'User signs in, receives a token, accesses protected routes.',
      steps: [
        { name: 'Submit credentials', type: 'user_action', description: 'Login form submit' },
        { name: 'Verify credentials', type: 'api_call', description: 'POST /auth/login', operation: 'login' },
        { name: 'Store token', type: 'database', description: 'Persist JWT for subsequent requests' },
      ],
      entities: ['users'],
      triggers: ['login form'],
    });
  }
  const createForms = forms.filter((f) => f.method === 'POST');
  if (createForms.length > 0) {
    flows.push({
      id: nid('flow'),
      name: 'Create record',
      description: `Submit ${createForms[0].name} to create a new record.`,
      steps: [
        { name: 'Fill form', type: 'user_action', description: createForms[0].name },
        { name: 'Validate', type: 'conditional', description: 'Client-side required checks' },
        { name: 'Persist', type: 'api_call', description: createForms[0].apiEndpoint ?? 'POST endpoint', entity: 'entity', operation: 'create' },
      ],
      entities: [],
      triggers: [createForms[0].name],
    });
  }
  if (routes.length >= 2) {
    flows.push({
      id: nid('flow'),
      name: 'Browse & detail',
      description: 'List view navigates to a detail route.',
      steps: [
        { name: 'Load list', type: 'api_call', description: `GET ${apiCalls[0]?.url ?? '/api/<entity>'}`, operation: 'list' },
        { name: 'Open detail', type: 'user_action', description: `Navigate to ${routes[0]?.path ?? '/:id'}` },
      ],
      entities: [],
      triggers: ['navigation'],
    });
  }
  return flows;
}
