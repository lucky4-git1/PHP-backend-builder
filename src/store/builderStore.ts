import { create } from 'zustand';
import type { BuilderAuth, BuilderConfig, BuilderEndpoint, BuilderState, BuilderTable } from '@/lib/builder';
import { autoEndpoints, emptyProject, templateBlog, templateEcommerce, templateSaas, uid } from '@/lib/builder';

interface BuilderStore extends BuilderState {
  activeFile: string;
  setConfig: (patch: Partial<BuilderConfig>) => void;
  setAuth: (patch: Partial<BuilderAuth>) => void;
  addTable: () => void;
  removeTable: (id: string) => void;
  updateTable: (id: string, patch: Partial<BuilderTable>) => void;
  addColumn: (tableId: string) => void;
  removeColumn: (tableId: string, colId: string) => void;
  updateColumn: (tableId: string, colId: string, patch: Record<string, unknown>) => void;
  regenerateEndpoints: () => void;
  addEndpoint: () => void;
  removeEndpoint: (id: string) => void;
  updateEndpoint: (id: string, patch: Partial<BuilderEndpoint>) => void;
  setActiveFile: (p: string) => void;
  loadTemplate: (name: 'blank' | 'blog' | 'shop' | 'saas') => void;
  loadState: (s: BuilderState) => void;
  reset: () => void;
}

const STORAGE_KEY = 'phpbb-project-v1';

function persist(s: BuilderState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function restore(): BuilderState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BuilderState;
    if (!parsed.tables || !parsed.config) return null;
    return parsed;
  } catch {
    return null;
  }
}

const initial: BuilderState = restore() ?? templateBlog();

export const useBuilder = create<BuilderStore>((set, get) => ({
  ...initial,
  activeFile: '',

  setConfig: (patch) => {
    set((s) => ({ config: { ...s.config, ...patch } }));
    persist(get());
  },
  setAuth: (patch) => {
    set((s) => ({ auth: { ...s.auth, ...patch } }));
    persist(get());
  },
  addTable: () => {
    const n = get().tables.length + 1;
    const t: BuilderTable = {
      id: uid('t'),
      name: `table_${n}`,
      comment: '',
      timestamps: true,
      softDeletes: false,
      columns: [
        { id: uid('c'), name: 'id', type: 'bigint', nullable: false, unique: false, defaultValue: '', isPrimaryKey: true, isAutoIncrement: true },
        { id: uid('c'), name: 'name', type: 'varchar', nullable: false, unique: false, defaultValue: '', isPrimaryKey: false, isAutoIncrement: false },
      ],
    };
    set((s) => ({ tables: [...s.tables, t] }));
    persist(get());
  },
  removeTable: (id) =>
    set((s) => {
      const tables = s.tables.filter((t) => t.id !== id);
      persist({ ...s, tables });
      return { tables };
    }),
  updateTable: (id, patch) =>
    set((s) => {
      const tables = s.tables.map((t) => (t.id === id ? { ...t, ...patch } : t));
      persist({ ...s, tables });
      return { tables };
    }),
  addColumn: (tableId) =>
    set((s) => {
      const tables = s.tables.map((t) =>
        t.id === tableId
          ? { ...t, columns: [...t.columns, { id: uid('c'), name: 'field_' + (t.columns.length + 1), type: 'varchar' as const, nullable: true, unique: false, defaultValue: '', isPrimaryKey: false, isAutoIncrement: false }] }
          : t
      );
      persist({ ...s, tables });
      return { tables };
    }),
  removeColumn: (tableId, colId) =>
    set((s) => {
      const tables = s.tables.map((t) => (t.id === tableId ? { ...t, columns: t.columns.filter((c) => c.id !== colId) } : t));
      persist({ ...s, tables });
      return { tables };
    }),
  updateColumn: (tableId, colId, patch) =>
    set((s) => {
      const tables = s.tables.map((t) =>
        t.id === tableId ? { ...t, columns: t.columns.map((c) => (c.id === colId ? { ...c, ...patch } : c)) } : t
      );
      persist({ ...s, tables });
      return { tables };
    }),
  regenerateEndpoints: () => {
    set((s) => ({ endpoints: autoEndpoints(s.tables) }));
    persist(get());
  },
  addEndpoint: () =>
    set((s) => ({
      endpoints: [...s.endpoints, { id: uid('e'), method: 'GET', path: '/custom', handler: 'CustomController::handle', table: s.tables[0]?.name ?? '', operation: 'custom', auth: 'required', description: 'Custom endpoint' }],
    })),
  removeEndpoint: (id) => set((s) => ({ endpoints: s.endpoints.filter((e) => e.id !== id) })),
  updateEndpoint: (id, patch) => set((s) => ({ endpoints: s.endpoints.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),
  setActiveFile: (p) => set(() => ({ activeFile: p })),
  loadTemplate: (name) => {
    const cur = get().config.projectName;
    let next: BuilderState;
    if (name === 'blog') next = templateBlog();
    else if (name === 'shop') next = templateEcommerce();
    else if (name === 'saas') next = templateSaas();
    else next = emptyProject(cur || 'my-api');
    if (name === 'blank') next.config.projectName = cur;
    set(() => ({ ...next, activeFile: '' }));
    persist(next);
  },
  loadState: (s) => {
    set(() => ({ ...s, activeFile: '' }));
    persist(s);
  },
  reset: () => {
    const next = emptyProject('my-api');
    set(() => ({ ...next, activeFile: '' }));
    persist(next);
  },
}));
