/**
 * 14-step pipeline state machine:
 * 1 Create → 2 Import → 3 Analyze → 4 Findings → 5 Requirements → 6 Database
 * → 7 API → 8 Generate → 9 Integration review → 10 Apply → 11 Tests
 * → 12 Security → 13 Architecture → 14 Export
 */
import { create } from 'zustand';
import type {
  AnalysisResult,
  BackendRequirements,
  DatabaseSchema,
  FileChange,
  ProjectFile,
  ProjectTreeNode,
  SecurityFinding,
  TestResult,
} from '@/shared/types';
import type { BuilderState, GenFile } from '@/lib/builder';

export const STEPS = [
  { n: 1, id: 'create', label: 'Create Project' },
  { n: 2, id: 'import', label: 'Import Frontend' },
  { n: 3, id: 'analyze', label: 'Analyze' },
  { n: 4, id: 'findings', label: 'Review Findings' },
  { n: 5, id: 'requirements', label: 'Review Requirements' },
  { n: 6, id: 'database', label: 'Design Database' },
  { n: 7, id: 'api', label: 'Review API' },
  { n: 8, id: 'generate', label: 'Generate Backend' },
  { n: 9, id: 'integration', label: 'Review Frontend Changes' },
  { n: 10, id: 'apply', label: 'Apply Integration' },
  { n: 11, id: 'tests', label: 'Run Tests' },
  { n: 12, id: 'security', label: 'Security Audit' },
  { n: 13, id: 'architecture', label: 'Final Architecture' },
  { n: 14, id: 'export', label: 'Export Project' },
] as const;

export type StepId = (typeof STEPS)[number]['id'];

interface PipelineStore {
  step: number;
  projectName: string;
  source: 'zip' | 'demo' | 'manual';
  frontendFiles: ProjectFile[];
  tree: ProjectTreeNode | null;
  importSkipped: number;
  analysis: AnalysisResult | null;
  requirements: BackendRequirements | null;
  enabledTables: string[];
  enabledEndpoints: string[];
  resolvedAmbiguities: Record<string, string>;
  authEnabled: boolean;
  schema: DatabaseSchema | null;
  builder: BuilderState | null;
  generated: GenFile[];
  integration: FileChange[];
  tests: TestResult[];
  security: SecurityFinding[];
  integratedPreview: ProjectFile[];
  done: Record<number, boolean>;

  setProjectName: (n: string) => void;
  setSource: (s: 'zip' | 'demo' | 'manual') => void;
  setFiles: (files: ProjectFile[], tree: ProjectTreeNode | null, skipped: number) => void;
  setAnalysis: (a: AnalysisResult | null) => void;
  setRequirements: (r: BackendRequirements | null) => void;
  patchRequirements: (r: BackendRequirements) => void;
  setEnabledTables: (ids: string[]) => void;
  setEnabledEndpoints: (ids: string[]) => void;
  setAmbiguity: (ambId: string, optId: string) => void;
  setAuthEnabled: (v: boolean) => void;
  setSchema: (s: DatabaseSchema | null) => void;
  setBuilder: (b: BuilderState | null) => void;
  setGenerated: (g: GenFile[]) => void;
  setIntegration: (c: FileChange[]) => void;
  toggleChange: (id: string, approved: boolean) => void;
  setTests: (t: TestResult[]) => void;
  setSecurity: (s: SecurityFinding[]) => void;
  setIntegratedPreview: (f: ProjectFile[]) => void;
  markDone: (n: number) => void;
  goto: (n: number) => void;
  next: () => void;
  back: () => void;
  reset: () => void;
}

const initialDone: Record<number, boolean> = {};

export const usePipeline = create<PipelineStore>((set) => ({
  step: 1,
  projectName: 'my-fullstack-app',
  source: 'zip',
  frontendFiles: [],
  tree: null,
  importSkipped: 0,
  analysis: null,
  requirements: null,
  enabledTables: [],
  enabledEndpoints: [],
  resolvedAmbiguities: {},
  authEnabled: false,
  schema: null,
  builder: null,
  generated: [],
  integration: [],
  tests: [],
  security: [],
  integratedPreview: [],
  done: initialDone,

  setProjectName: (n) => set(() => ({ projectName: n })),
  setSource: (s) => set(() => ({ source: s })),
  setFiles: (files, tree, skipped) => set(() => ({ frontendFiles: files, tree, importSkipped: skipped })),
  setAnalysis: (a) => set(() => ({ analysis: a })),
  setRequirements: (r) =>
    set(() => ({
      requirements: r,
      enabledTables: r ? r.database.tables.map((t) => t.id) : [],
      enabledEndpoints: r ? r.api.endpoints.map((e) => e.id) : [],
      authEnabled: r ? r.authentication.enabled : false,
      resolvedAmbiguities: {},
    })),
  // Non-resetting update (e.g. Step 8 repair syncing repaired column types back).
  // Unlike setRequirements, this preserves enabledTables/ambiguities/authEnabled.
  patchRequirements: (r) => set(() => ({ requirements: r })),
  setEnabledTables: (ids) => set(() => ({ enabledTables: ids })),
  setEnabledEndpoints: (ids) => set(() => ({ enabledEndpoints: ids })),
  setAmbiguity: (ambId, optId) =>
    set((s) => ({ resolvedAmbiguities: { ...s.resolvedAmbiguities, [ambId]: optId } })),
  setAuthEnabled: (v) => set(() => ({ authEnabled: v })),
  setSchema: (s) => set(() => ({ schema: s })),
  setBuilder: (b) => set(() => ({ builder: b })),
  setGenerated: (g) => set(() => ({ generated: g })),
  setIntegration: (c) => set(() => ({ integration: c })),
  toggleChange: (id, approved) =>
    set((s) => ({ integration: s.integration.map((c) => (c.id === id ? { ...c, approved } : c)) })),
  setTests: (t) => set(() => ({ tests: t })),
  setSecurity: (s) => set(() => ({ security: s })),
  setIntegratedPreview: (f) => set(() => ({ integratedPreview: f })),
  markDone: (n) => set((s) => ({ done: { ...s.done, [n]: true } })),
  goto: (n) => set(() => ({ step: Math.min(14, Math.max(1, n)) })),
  next: () => set((s) => ({ step: Math.min(14, s.step + 1), done: { ...s.done, [s.step]: true } })),
  back: () => set((s) => ({ step: Math.max(1, s.step - 1) })),
  reset: () =>
    set(() => ({
      step: 1,
      projectName: 'my-fullstack-app',
      source: 'zip',
      frontendFiles: [],
      tree: null,
      importSkipped: 0,
      analysis: null,
      requirements: null,
      enabledTables: [],
      enabledEndpoints: [],
      resolvedAmbiguities: {},
      authEnabled: false,
      schema: null,
      builder: null,
      generated: [],
      integration: [],
      tests: [],
      security: [],
      integratedPreview: [],
      done: {},
    })),
}));

export function canProceed(step: number, s: PipelineStore): { ok: boolean; reason?: string } {
  switch (step) {
    case 1:
      return s.projectName.trim() ? { ok: true } : { ok: false, reason: 'Enter a project name.' };
    case 2:
      return s.frontendFiles.length > 0 ? { ok: true } : { ok: false, reason: 'Import a frontend ZIP or load the demo app.' };
    case 3:
      return s.analysis ? { ok: true } : { ok: false, reason: 'Run analysis first.' };
    case 4:
      return s.analysis ? { ok: true } : { ok: false, reason: 'No findings to review.' };
    case 5: {
      if (!s.requirements) return { ok: false, reason: 'Requirements not inferred yet.' };
      const unresolved = s.requirements.ambiguities.filter((a) => !s.resolvedAmbiguities[a.id] && !a.selectedOption);
      if (unresolved.length > 0) return { ok: false, reason: `${unresolved.length} ambiguities need a decision.` };
      if (s.enabledTables.length === 0) return { ok: false, reason: 'Enable at least one table.' };
      return { ok: true };
    }
    case 6:
      return s.builder && s.builder.tables.length > 0 ? { ok: true } : { ok: false, reason: 'Design at least one table.' };
    case 7:
      return s.builder && s.builder.endpoints.length > 0 ? { ok: true } : { ok: false, reason: 'At least one endpoint required.' };
    case 8:
      return s.generated.length > 0 ? { ok: true } : { ok: false, reason: 'Generate the backend first.' };
    case 9:
      return { ok: true };
    case 10:
      return { ok: true };
    case 11: {
      if (s.tests.length === 0) return { ok: false, reason: 'Run the test suite first.' };
      if (s.tests.some((t) => t.status === 'failed')) return { ok: false, reason: 'Fix failing tests before continuing.' };
      return { ok: true };
    }
    case 12: {
      if (s.security.length === 0) return { ok: false, reason: 'Run the security audit first.' };
      if (s.security.some((f) => f.severity === 'critical' && f.status === 'open')) {
        return { ok: false, reason: 'Resolve critical security findings.' };
      }
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}
