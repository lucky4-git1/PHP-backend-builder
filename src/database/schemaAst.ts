/**
 * Schema AST — eliminates fragile SQL string concatenation.
 * Schema Definition → Schema AST → Database-specific SQL Generator
 * Supports MySQL + Postgres, validates syntax, dup columns, invalid refs, etc.
 */

export type ColumnType =
  | 'BIGINT' | 'INT' | 'SMALLINT' | 'TINYINT'
  | 'DECIMAL' | 'FLOAT' | 'DOUBLE'
  | 'VARCHAR' | 'TEXT' | 'LONGTEXT'
  | 'DATETIME' | 'TIMESTAMP' | 'DATE' | 'TIME' | 'YEAR'
  | 'JSON' | 'BLOB' | 'BOOLEAN' | 'UUID' | 'CHAR';

export interface AstColumn {
  name: string;
  type: ColumnType;
  length?: number;
  precision?: number;
  scale?: number;
  nullable: boolean;
  unique: boolean;
  primaryKey: boolean;
  autoIncrement: boolean;
  defaultValue?: string;
  enumValues?: string[];
  comment?: string;
}

export interface AstIndex {
  name: string;
  columns: string[];
  unique: boolean;
  type: 'BTREE' | 'HASH' | 'FULLTEXT';
}

export interface AstForeignKey {
  name: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
  onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
  onUpdate: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
}

export interface AstTable {
  name: string;
  columns: AstColumn[];
  indexes: AstIndex[];
  foreignKeys: AstForeignKey[];
  primaryKey: string[];
  engine: string;
  charset: string;
  collate: string;
  timestamps: boolean;
  softDeletes: boolean;
}

export interface SchemaAST {
  tables: AstTable[];
  dialect: 'mysql' | 'postgres';
}

// ---- Type mapping from BuilderColumn/IR ----

const TYPE_MAP: Record<string, { t: ColumnType; len?: number }> = {
  bigint: { t: 'BIGINT' },
  int: { t: 'INT' },
  smallint: { t: 'SMALLINT' },
  tinyint: { t: 'TINYINT' },
  decimal: { t: 'DECIMAL' },
  float: { t: 'FLOAT' },
  double: { t: 'DOUBLE' },
  varchar: { t: 'VARCHAR', len: 255 },
  text: { t: 'TEXT' },
  longtext: { t: 'LONGTEXT' },
  datetime: { t: 'DATETIME' },
  timestamp: { t: 'TIMESTAMP' },
  date: { t: 'DATE' },
  time: { t: 'TIME' },
  year: { t: 'YEAR' },
  json: { t: 'JSON' },
  blob: { t: 'BLOB' },
  enum: { t: 'VARCHAR', len: 64 },
  set: { t: 'VARCHAR', len: 255 },
  boolean: { t: 'TINYINT' },
  uuid: { t: 'CHAR', len: 36 },
};

export function mapColumnType(raw: string): { t: ColumnType; len?: number } {
  return TYPE_MAP[raw.toLowerCase()] ?? { t: 'VARCHAR', len: 255 };
}

// Critical fix: text-like fields must never be INT.
// Substring match (not exact) so your_message, contact_message, post_body etc.
// are treated the same as message/body — consistent with validation + tests.
const TEXT_LIKE_RE = /message|description|body|content|bio|notes|excerpt/i;
export function isTextLikeField(fieldName: string): boolean {
  return TEXT_LIKE_RE.test(fieldName);
}
export function canonicalType(fieldName: string, rawType: string): { t: ColumnType; len?: number } {
  if (isTextLikeField(fieldName) && ['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'float', 'double'].includes(rawType.toLowerCase())) {
    return { t: 'TEXT' }; // auto-correct historic bug: contactmessage INT → TEXT
  }
  return mapColumnType(rawType);
}

export function buildASTFromBuilderState(state: { tables: Array<{ name: string; columns: Array<{ name: string; type: string; nullable: boolean; unique: boolean; defaultValue: string; isPrimaryKey: boolean; isAutoIncrement: boolean; foreignKey?: { table: string; column: string } }>; timestamps: boolean; softDeletes: boolean }> }, dialect: 'mysql' | 'postgres' = 'mysql'): SchemaAST {
  const tables: AstTable[] = state.tables.map((t) => {
    const cols: AstColumn[] = t.columns.map((c) => {
      const mt = canonicalType(c.name, c.type);
      return {
        name: c.name,
        type: mt.t,
        length: mt.len,
        nullable: c.nullable,
        unique: c.unique,
        primaryKey: c.isPrimaryKey,
        autoIncrement: c.isAutoIncrement,
        defaultValue: c.defaultValue || undefined,
      };
    });
    // Add implicit timestamps if enabled and missing
    if (t.timestamps) {
      if (!cols.some((c) => c.name === 'created_at')) cols.push({ name: 'created_at', type: 'TIMESTAMP', nullable: true, unique: false, primaryKey: false, autoIncrement: false });
      if (!cols.some((c) => c.name === 'updated_at')) cols.push({ name: 'updated_at', type: 'TIMESTAMP', nullable: true, unique: false, primaryKey: false, autoIncrement: false });
    }
    if (t.softDeletes && !cols.some((c) => c.name === 'deleted_at')) {
      cols.push({ name: 'deleted_at', type: 'TIMESTAMP', nullable: true, unique: false, primaryKey: false, autoIncrement: false });
    }
    const pk = cols.filter((c) => c.primaryKey).map((c) => c.name);
    const fks: AstForeignKey[] = t.columns.filter((c) => c.foreignKey).map((c) => ({
      name: `fk_${t.name}_${c.name}`,
      column: c.name,
      referencedTable: c.foreignKey!.table,
      referencedColumn: c.foreignKey!.column,
      onDelete: 'CASCADE' as const,
      onUpdate: 'CASCADE' as const,
    }));
    return {
      name: t.name,
      columns: cols,
      indexes: [],
      foreignKeys: fks,
      primaryKey: pk,
      engine: 'InnoDB',
      charset: 'utf8mb4',
      collate: 'utf8mb4_unicode_ci',
      timestamps: t.timestamps,
      softDeletes: t.softDeletes,
    };
  });
  return { tables, dialect };
}

// ---- Topological Sort for Dependency-Aware Ordering (Rules 13 & 14) ----

export interface TopologicalSortResult<T> {
  sorted: T[];
  hasCycle: boolean;
  cycleNodes: string[];
}

export function getTableDependencies(table: {
  name: string;
  foreignKeys?: Array<{ referencedTable?: string; table?: string }>;
  columns?: Array<any>;
}): string[] {
  const deps = new Set<string>();
  if (Array.isArray(table.foreignKeys)) {
    for (const fk of table.foreignKeys) {
      const ref = fk.referencedTable || (fk as any).table;
      if (ref && ref !== table.name) deps.add(ref);
    }
  }
  if (Array.isArray(table.columns)) {
    for (const col of table.columns) {
      if (col && typeof col === 'object' && 'foreignKey' in col && (col as any).foreignKey?.table) {
        const ref = (col as any).foreignKey.table;
        if (ref && ref !== table.name) deps.add(ref);
      }
    }
  }
  return [...deps];
}

export function sortTablesTopologically<T extends { name: string }>(tables: T[]): TopologicalSortResult<T> {
  const tableMap = new Map<string, T>();
  const tableNames = new Set<string>();
  for (const t of tables) {
    tableMap.set(t.name, t);
    tableNames.add(t.name);
  }

  // Dependencies: table -> Set of tables it depends on (must be created before it)
  const deps = new Map<string, Set<string>>();
  // Dependents (adjacency): table -> Set of tables that depend on it
  const adj = new Map<string, Set<string>>();

  for (const t of tables) {
    deps.set(t.name, new Set());
    adj.set(t.name, new Set());
  }

  for (const t of tables) {
    const tableDeps = getTableDependencies(t as any);
    for (const d of tableDeps) {
      if (tableNames.has(d)) {
        deps.get(t.name)!.add(d);
        adj.get(d)!.add(t.name);
      }
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  const inDegree = new Map<string, number>();

  for (const [name, dSet] of deps.entries()) {
    inDegree.set(name, dSet.size);
    if (dSet.size === 0) {
      queue.push(name);
    }
  }

  const sortedNames: string[] = [];
  while (queue.length > 0) {
    // Deterministic tie-breaking: sort names alphabetically when multiple have inDegree 0
    queue.sort();
    const curr = queue.shift()!;
    sortedNames.push(curr);

    const dependents = adj.get(curr) || new Set();
    for (const dep of dependents) {
      const remaining = (inDegree.get(dep) || 1) - 1;
      inDegree.set(dep, remaining);
      if (remaining === 0) {
        queue.push(dep);
      }
    }
  }

  if (sortedNames.length < tables.length) {
    const cycleNodes = tables.map((t) => t.name).filter((n) => !sortedNames.includes(n));
    // Fallback: append cycle nodes so no tables are lost, but report cycle
    const remaining = tables.filter((t) => !sortedNames.includes(t.name));
    const sorted = [...sortedNames.map((n) => tableMap.get(n)!), ...remaining];
    return { sorted, hasCycle: true, cycleNodes };
  }

  const sorted = sortedNames.map((n) => tableMap.get(n)!);
  return { sorted, hasCycle: false, cycleNodes: [] };
}

// ---- Validation ----

export function validateAST(ast: SchemaAST): Array<{ level: 'error' | 'warning'; code: string; message: string }> {
  const out: Array<{ level: 'error' | 'warning'; code: string; message: string }> = [];
  const tableNames = new Set(ast.tables.map((t) => t.name));

  // Check for circular foreign key dependencies
  const sortRes = sortTablesTopologically(ast.tables);
  if (sortRes.hasCycle) {
    out.push({
      level: 'error',
      code: 'AST_FK_CYCLE',
      message: `Circular foreign key dependency detected involving: ${sortRes.cycleNodes.join(', ')}. Tables cannot be safely ordered for migration.`,
    });
  }

  for (const t of ast.tables) {
    if (t.columns.length === 0) out.push({ level: 'error', code: 'AST_EMPTY_TABLE', message: `Table ${t.name} has no columns.` });
    const colNames = new Set<string>();
    for (const c of t.columns) {
      if (colNames.has(c.name)) out.push({ level: 'error', code: 'AST_DUP_COLUMN', message: `Duplicate column ${t.name}.${c.name}` });
      colNames.add(c.name);
      // invalid type
      if (!c.type) out.push({ level: 'error', code: 'AST_INVALID_TYPE', message: `Invalid type for ${t.name}.${c.name}` });
      // default sanity
      if (c.defaultValue && c.type === 'TEXT' && c.defaultValue.startsWith("'")) {
        out.push({ level: 'warning', code: 'AST_TEXT_DEFAULT', message: `${t.name}.${c.name} TEXT with default may not be supported on MySQL 5.7` });
      }
    }
    if (t.primaryKey.length === 0) out.push({ level: 'warning', code: 'AST_NO_PK', message: `Table ${t.name} has no primary key.` });
    for (const fk of t.foreignKeys) {
      if (!tableNames.has(fk.referencedTable)) out.push({ level: 'error', code: 'AST_FK_UNKNOWN', message: `FK ${t.name}.${fk.column} → unknown ${fk.referencedTable}` });
      if (!colNames.has(fk.column)) out.push({ level: 'error', code: 'AST_FK_COL', message: `FK column ${fk.column} missing in ${t.name}` });
    }
    // duplicate indexes
    const idxNames = new Set<string>();
    for (const idx of t.indexes) {
      if (idxNames.has(idx.name)) out.push({ level: 'error', code: 'AST_DUP_INDEX', message: `Duplicate index ${idx.name} in ${t.name}` });
      idxNames.add(idx.name);
    }
  }
  return out;
}

// ---- SQL Generation (deterministic, comma-correct) ----

function colSql(c: AstColumn, dialect: 'mysql' | 'postgres'): string {
  let t: string;
  switch (c.type) {
    case 'VARCHAR': t = `VARCHAR(${c.length ?? 255})`; break;
    case 'CHAR': t = `CHAR(${c.length ?? 36})`; break;
    case 'TINYINT': t = dialect === 'postgres' ? 'SMALLINT' : 'TINYINT(1)'; break;
    case 'DECIMAL': t = `DECIMAL(${c.precision ?? 10},${c.scale ?? 2})`; break;
    case 'BLOB': t = dialect === 'postgres' ? 'BYTEA' : 'LONGBLOB'; break;
    case 'LONGTEXT': t = dialect === 'postgres' ? 'TEXT' : 'LONGTEXT'; break;
    case 'JSON': t = dialect === 'postgres' ? 'JSONB' : 'JSON'; break;
    case 'BOOLEAN': t = dialect === 'postgres' ? 'BOOLEAN' : 'TINYINT(1)'; break;
    default: t = c.type;
  }
  let def = `  ${quoteIdent(c.name, dialect)} ${t}`;
  if (c.autoIncrement) def += dialect === 'postgres' ? ' GENERATED ALWAYS AS IDENTITY' : ' AUTO_INCREMENT';
  def += c.nullable ? ' NULL' : ' NOT NULL';
  if (c.unique && !c.primaryKey) def += ' UNIQUE';
  if (c.defaultValue !== undefined && c.defaultValue !== '') {
    const needsQuote = ['VARCHAR', 'TEXT', 'LONGTEXT', 'DATETIME', 'TIMESTAMP', 'DATE', 'TIME', 'CHAR'].includes(c.type);
    const safe = c.defaultValue.replace(/'/g, "''");
    def += needsQuote ? ` DEFAULT '${safe}'` : ` DEFAULT ${c.defaultValue}`;
  }
  // MySQL timestamp defaults
  if (c.name === 'created_at' && dialect === 'mysql' && c.nullable) def = `  ${quoteIdent(c.name, dialect)} TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP`;
  if (c.name === 'updated_at' && dialect === 'mysql' && c.nullable) def = `  ${quoteIdent(c.name, dialect)} TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`;
  return def;
}

function quoteIdent(name: string, dialect: 'mysql' | 'postgres'): string {
  // keep simple names unquoted; quote reserved-ish
  if (/^(order|group|select|table|user)$/i.test(name)) return dialect === 'postgres' ? `"${name}"` : `\`${name}\``;
  return name;
}

export function generateMySQL(ast: SchemaAST): string {
  const stmts: string[] = [];
  const sortedTables = sortTablesTopologically(ast.tables).sorted;
  for (const t of sortedTables) {
    const lines: string[] = [];
    for (const c of t.columns) lines.push(colSql(c, 'mysql'));
    if (t.primaryKey.length) lines.push(`  PRIMARY KEY (${t.primaryKey.map((n) => quoteIdent(n, 'mysql')).join(', ')})`);
    for (const fk of t.foreignKeys) {
      lines.push(`  CONSTRAINT ${fk.name} FOREIGN KEY (${quoteIdent(fk.column, 'mysql')}) REFERENCES ${fk.referencedTable} (${quoteIdent(fk.referencedColumn, 'mysql')}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`);
    }
    // JOIN with commas — guarantees no missing commas (critical bug fix)
    const body = lines.join(',\n');
    stmts.push(`CREATE TABLE IF NOT EXISTS ${t.name} (\n${body}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);
  }
  return stmts.join('\n\n');
}

export function generatePostgres(ast: SchemaAST): string {
  const stmts: string[] = [];
  const sortedTables = sortTablesTopologically(ast.tables).sorted;
  for (const t of sortedTables) {
    const lines: string[] = [];
    for (const c of t.columns) lines.push(colSql(c, 'postgres'));
    if (t.primaryKey.length) lines.push(`  PRIMARY KEY (${t.primaryKey.map((n) => quoteIdent(n, 'postgres')).join(', ')})`);
    // FKs as separate ALTER for Postgres clarity
    const body = lines.join(',\n');
    stmts.push(`CREATE TABLE IF NOT EXISTS ${t.name} (\n${body}\n);`);
    for (const fk of t.foreignKeys) {
      stmts.push(`ALTER TABLE ${t.name} ADD CONSTRAINT ${fk.name} FOREIGN KEY (${fk.column}) REFERENCES ${fk.referencedTable}(${fk.referencedColumn}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate};`);
    }
  }
  return stmts.join('\n\n');
}

export function generateSchemaSQL(ast: SchemaAST): string {
  return ast.dialect === 'postgres' ? generatePostgres(ast) : generateMySQL(ast);
}
