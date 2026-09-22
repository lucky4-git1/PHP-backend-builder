/**
 * Frontend import utilities: ZIP extraction (browser) + file-tree building.
 * Deterministic: binary detection by extension + null-byte sniffing.
 */
import JSZip from 'jszip';
import type { ProjectFile, ProjectTreeNode } from '@/shared/types';
import { getFileExtension, isTextFile } from '@/shared/utils';

const MAX_FILES = 2000;
const MAX_FILE_BYTES = 2_000_000; // 2MB per text file (truncate beyond)
const MAX_TOTAL_BYTES = 30_000_000;

const ALWAYS_IGNORE = [
  '__MACOSX/',
  '.DS_Store',
  '.git/',
  'node_modules/',
  '.next/',
  'dist/',
  'build/',
  'coverage/',
  '.turbo/',
];

function shouldIgnore(rel: string): boolean {
  const lower = rel.toLowerCase();
  return ALWAYS_IGNORE.some((p) => lower.includes(p.toLowerCase()));
}

export interface ImportResult {
  files: ProjectFile[];
  tree: ProjectTreeNode;
  skipped: number;
  truncated: string[];
}

export async function importZipFile(blob: Blob): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(blob);
  const files: ProjectFile[] = [];
  let total = 0;
  let skipped = 0;
  const truncated: string[] = [];

  const entries = Object.values(zip.files).filter((e) => !e.dir);
  for (const entry of entries.slice(0, MAX_FILES * 2)) {
    const relativePath = entry.name;
    if (shouldIgnore(relativePath)) {
      skipped += 1;
      continue;
    }
    if (files.length >= MAX_FILES) {
      skipped += 1;
      continue;
    }
    const ext = getFileExtension(relativePath).toLowerCase();
    const maybeText = isTextFile(ext) || ['tsx', 'jsx', 'vue', 'svelte', 'astro'].includes(ext) || ext === '';
    try {
      if (maybeText) {
        const text = await entry.async('string');
        const bytes = text.length;
        total += bytes;
        if (total > MAX_TOTAL_BYTES) {
          skipped += 1;
          continue;
        }
        const isBinary = text.slice(0, 8000).includes('\0');
        const content = text.length > MAX_FILE_BYTES ? text.slice(0, MAX_FILE_BYTES) : text;
        if (text.length > MAX_FILE_BYTES) truncated.push(relativePath);
        files.push({
          path: relativePath,
          relativePath,
          content: isBinary ? '' : content,
          size: bytes,
          extension: ext,
          isBinary,
        });
      } else {
        // binary: record metadata only
        files.push({
          path: relativePath,
          relativePath,
          content: '',
          size: 0,
          extension: ext,
          isBinary: true,
        });
      }
    } catch {
      skipped += 1;
    }
  }

  // Strip common single root folder for cleaner tree
  const stripped = stripSingleRoot(files);
  return { files: stripped, tree: buildTree(stripped), skipped, truncated };
}

function stripSingleRoot(files: ProjectFile[]): ProjectFile[] {
  if (files.length === 0) return files;
  const firstSegs = files.map((f) => f.relativePath.split('/')[0]);
  const uniq = [...new Set(firstSegs)];
  if (uniq.length === 1 && files.every((f) => f.relativePath.includes('/'))) {
    const root = uniq[0];
    return files.map((f) => ({
      ...f,
      relativePath: f.relativePath.slice(root.length + 1) || f.relativePath,
    }));
  }
  return files;
}

export function buildTree(files: ProjectFile[]): ProjectTreeNode {
  const root: ProjectTreeNode = { name: 'frontend', path: '', type: 'directory', children: [] };
  for (const f of files) {
    const parts = f.relativePath.split('/').filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const p = parts.slice(0, i + 1).join('/');
      if (isFile) {
        node.children ??= [];
        node.children.push({ name: part, path: p, type: 'file', extension: f.extension, size: f.size });
      } else {
        node.children ??= [];
        let next = node.children.find((c) => c.name === part && c.type === 'directory');
        if (!next) {
          next = { name: part, path: p, type: 'directory', children: [] };
          node.children.push(next);
        }
        node = next;
      }
    }
  }
  sortTree(root);
  return root;
}

function sortTree(node: ProjectTreeNode): void {
  if (!node.children) return;
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const c of node.children) sortTree(c);
}

/** Demo frontend used when the user has no ZIP handy (also powers tests). */
export function demoFrontendFiles(): ProjectFile[] {
  const mk = (relativePath: string, content: string): ProjectFile => ({
    path: relativePath,
    relativePath,
    content,
    size: content.length,
    extension: relativePath.split('.').pop() ?? '',
    isBinary: false,
  });
  return [
    mk('package.json', JSON.stringify({
      name: 'demo-shop',
      dependencies: { react: '^18.2.0', 'react-router-dom': '^6.22.0', axios: '^1.6.0' },
    }, null, 2)),
    mk('src/App.tsx', [
      "import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';",
      "import ProductList from './pages/ProductList';",
      "import Login from './pages/Login';",
      "export default function App() {",
      "  return (<BrowserRouter><nav><Link to='/products'>Products</Link></nav>",
      "  <Routes><Route path='/products' element={<ProductList/>} />",
      "  <Route path='/login' element={<Login/>} />",
      "  <Route path='/products/:id' element={<ProductList/>} /></Routes></BrowserRouter>);",
      '}',
    ].join('\n')),
    mk('src/pages/ProductList.tsx', [
      "import { useEffect, useState } from 'react';",
      'export default function ProductList() {',
      '  const [products, setProducts] = useState([]);',
      "  useEffect(() => { fetch('/api/v1/products?page=1').then(r => r.json()).then(d => setProducts(d.data)); }, []);",
      "  const token = localStorage.getItem('token');",
      '  return <div>{products.map((p: any) => <div key={p.id}>{p.name} - {p.price}</div>)}</div>;',
      '}',
    ].join('\n')),
    mk('src/pages/Login.tsx', [
      'export default function Login() {',
      '  async function handleLogin(e: any) { e.preventDefault();',
      "    const res = await fetch('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });",
      "    const data = await res.json(); localStorage.setItem('token', data.token); }",
      '  return (<form onSubmit={handleLogin} action="/api/v1/auth/login" method="POST">',
      '    <input name="email" type="email" required placeholder="Email" />',
      '    <input name="password" type="password" required placeholder="Password" />',
      '    <button type="submit">Login</button></form>);',
      '}',
    ].join('\n')),
    mk('src/components/CheckoutForm.tsx', [
      'export default function CheckoutForm() {',
      '  return (<form name="checkout" method="POST" action="/api/v1/orders">',
      '    <input name="customer_name" required placeholder="Name" />',
      '    <input name="address" required placeholder="Address" />',
      '    <input name="total" type="number" required />',
      '    <input name="receipt" type="file" accept="image/*,.pdf" />',
      '  </form>);',
      '}',
    ].join('\n')),
    mk('src/mock/products.ts', [
      'export const products = [',
      "  { id: 1, name: 'Boots', price: 99.99, sku: 'BT-001', stock: 12 },",
      "  { id: 2, name: 'Jacket', price: 149.5, sku: 'JK-002', stock: 4 },",
      '];',
    ].join('\n')),
  ];
}
