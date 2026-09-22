/**
 * Database schema designer: BackendRequirements -> DatabaseSchema -> BuilderTable[].
 * The BuilderTable[] form reuses the existing generator (lib/generator.ts) so
 * manual edits in the designer flow straight into code generation.
 */
import type { BackendRequirements, DatabaseSchema, DatabaseTable } from '@/shared/types';
import type { BuilderState, BuilderTable } from '@/lib/builder';
import { uid, sanitizeTableName, sqlTypeFor } from '@/lib/builder';

export function requirementsToSchema(req: BackendRequirements, projectId: string): DatabaseSchema {
  const now = new Date();
  const tables: DatabaseTable[] = req.database.tables.map((t) => ({
    name: sanitizeTableName(t.name) || 'table_1',
    columns: t.columns.map((c) => ({
      name: sanitizeTableName(c.name) || 'field',
      type: c.type,
      nullable: c.nullable,
      defaultValue: c.defaultValue,
      autoIncrement: c.autoIncrement,
      comment: undefined,
    })),
    primaryKey: t.columns.filter((c) => c.primaryKey).map((c) => sanitizeTableName(c.name)),
    indexes: t.indexes.map((i) => ({ name: i.name, columns: i.columns, unique: i.unique, type: i.type })),
    foreignKeys: t.columns.filter((c) => c.foreignKey).map((c) => ({
      name: `fk_${t.name}_${c.name}`,
      column: sanitizeTableName(c.name),
      referencedTable: sanitizeTableName(c.foreignKey!.referencedTable),
      referencedColumn: sanitizeTableName(c.foreignKey!.referencedColumn),
      onDelete: 'CASCADE' as const,
      onUpdate: 'CASCADE' as const,
    })),
    engine: 'InnoDB',
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
    comment: undefined,
  }));
  return {
    projectId,
    version: 1,
    createdAt: now,
    updatedAt: now,
    tables,
    relationships: req.database.relationships.map((r) => ({
      id: r.id,
      sourceTable: r.sourceTable,
      targetTable: r.targetTable,
      type: r.type,
      sourceColumn: r.sourceColumn,
      targetColumn: r.targetColumn,
      throughTable: r.throughTable,
    })),
    enums: [],
  };
}

import { sortTablesTopologically } from '@/database/schemaAst';

export function schemaToBuilderState(
  schema: DatabaseSchema,
  req: BackendRequirements,
  projectName: string
): BuilderState {
  const rawTables: BuilderTable[] = schema.tables.map((t) => ({
    id: uid('t'),
    name: t.name,
    comment: t.comment ?? '',
    timestamps: true,
    softDeletes: false,
    columns: t.columns.map((c) => ({
      id: uid('c'),
      name: c.name,
      type: c.type,
      nullable: c.nullable,
      unique: t.indexes.some((i) => i.unique && i.columns.includes(c.name)),
      defaultValue: c.defaultValue ?? '',
      isPrimaryKey: t.primaryKey.includes(c.name),
      isAutoIncrement: c.autoIncrement,
      foreignKey: t.foreignKeys.find((fk) => fk.column === c.name)
        ? {
            table: t.foreignKeys.find((fk) => fk.column === c.name)!.referencedTable,
            column: t.foreignKeys.find((fk) => fk.column === c.name)!.referencedColumn,
          }
        : undefined,
    })),
  }));

  // Topologically sort tables according to foreign key dependencies
  const tables = sortTablesTopologically(rawTables).sorted;

  const isAuth = req.authentication.enabled;
  return {
    tables,
    endpoints: req.api.endpoints.map((e) => ({
      id: uid('e'),
      method: e.method,
      path: e.path,
      handler: e.entity ? `${toClass(e.entity)}Controller::${e.operation}` : 'CustomController::handle',
      table: e.entity ?? '',
      operation: e.operation === 'custom' ? 'custom' : e.operation,
      auth: e.authentication,
      description: e.description,
    })),
    auth: {
      strategy: !isAuth ? 'none' : (req.authentication.strategy ?? 'jwt'),
      register: req.authentication.register,
      login: req.authentication.login,
      logout: req.authentication.logout ?? isAuth,
      refresh: req.authentication.refresh ?? isAuth,
      me: req.authentication.me ?? isAuth,
      forgotPassword: req.authentication.forgotPassword ?? false,
      resetPassword: req.authentication.resetPassword ?? false,
      emailVerification: req.authentication.emailVerification ?? false,
      generateFrontend: req.authentication.generateFrontend ?? isAuth,
      protectedRoutes: isAuth,
      roles: req.authentication.roles.length > 0 ? req.authentication.roles : ['admin', 'user'],
      permissions: req.authentication.permissions ?? [],
      tokenExpiryHours: 24,
      userDecision: req.authentication.userDecision ?? (isAuth ? 'add' : 'none'),
    },
    config: {
      projectName: sanitizeTableName(projectName) || 'my-api',
      phpVersion: '8.2',
      apiPrefix: req.api.basePath || '/api/v1',
      corsOrigins: req.api.cors.origins[0] ?? '*',
      dbName: sanitizeTableName(projectName).replace(/-/g, '_') || 'app_db',
      dbHost: '127.0.0.1',
      pagination: 20,
    },
  };
}

function toClass(table: string): string {
  return table
    .split('_')
    .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p))
    .join('')
    .replace(/s$/, '');
}

export function validateSchemaSql(schema: DatabaseSchema): string[] {
  const errors: string[] = [];
  const names = new Set<string>();
  for (const t of schema.tables) {
    if (!t.name) errors.push('Table without name.');
    if (names.has(t.name)) errors.push(`Duplicate table: ${t.name}`);
    names.add(t.name);
    if (t.columns.length === 0) errors.push(`Table ${t.name} has no columns.`);
    if (t.primaryKey.length === 0) errors.push(`Table ${t.name} has no primary key.`);
    for (const fk of t.foreignKeys) {
      if (!names.has(fk.referencedTable) && !schema.tables.some((x) => x.name === fk.referencedTable)) {
        errors.push(`FK ${t.name}.${fk.column} references missing table ${fk.referencedTable}.`);
      }
    }
    // SQL reserved words guard
    for (const c of t.columns) {
      if (/^(order|group|select|table|user)$/i.test(c.name)) {
        errors.push(`Column ${t.name}.${c.name} uses a reserved word — it will be quoted, verify MySQL 8 compatibility.`);
      }
      void sqlTypeFor;
    }
  }
  return errors;
}
