/**
 * Core generation pipeline: ApplicationIR → (AST →) Generators → Validation → AutoRepair → READY
 * Enforces the mandated flow: FRONTEND → IR → SCHEMA VALIDATION → CODEGEN → VALIDATION → REPAIR → EXPORT
 */
import type { BuilderState, GenFile } from '@/lib/builder';
import { generateProject as legacyGenerate } from '@/lib/generator';
import { buildASTFromBuilderState, generateSchemaSQL } from '@/database/schemaAst';
import { buildIRFromBuilder } from '@/ir/builder';
import { runWithAutoRepair } from '@/validation/pipeline';

export type PipelineStage =
  | 'analyzing' | 'building_ir' | 'schema_validation' | 'generating_backend' | 'generating_database'
  | 'generating_api' | 'generating_client' | 'validating' | 'repairing' | 'testing' | 'finalizing' | 'ready' | 'failed';

export interface PipelineResult {
  stage: PipelineStage;
  ir: ReturnType<typeof buildIRFromBuilder>;
  schemaSql: string;
  files: GenFile[];
  validation: ReturnType<typeof runWithAutoRepair>;
  quality: { architecture: number; security: number; database: number; api: number; docs: number; overall: number };
}

export function runFullPipeline(state: BuilderState): PipelineResult {
  // IR
  const ir = buildIRFromBuilder(state);
  // AST + SQL (deterministic)
  const ast = buildASTFromBuilderState(state);
  const schemaSql = generateSchemaSQL(ast);
  // Legacy generator (battle-tested) + patch schema.sql with AST output
  let files = legacyGenerate(state);
  files = files.map((f) => f.path === 'database/schema.sql' ? { ...f, content: f.content.replace(/CREATE TABLE[\s\S]+/m, schemaSql) } : f);
  // Ensure schema.sql is AST-driven if replacement failed
  if (!files.some((f) => f.path === 'database/schema.sql' && f.content.includes(schemaSql.slice(0, 80)))) {
    files = files.map((f) => f.path === 'database/schema.sql' ? { ...f, content: `-- ${state.config.projectName} schema (MySQL 8+)\nCREATE DATABASE IF NOT EXISTS ${state.config.dbName} CHARACTER SET utf8mb4 COLLATE=utf8mb4_unicode_ci;\nUSE ${state.config.dbName};\n\n${schemaSql}\n` } : f);
  }
  const validation = runWithAutoRepair(state, files);
  const finalFiles = validation.repairedFiles.length ? validation.repairedFiles : files;
  // Quality score (not a gate — blocking issues still block export)
  const issues = validation.issues;
  const blocking = validation.blocking;
  const arch = blocking ? 45 : 92;
  const sec = issues.some((i) => i.severity === 'critical') ? 40 : 88;
  const db = issues.some((i) => i.stage === 'schema') ? 60 : 95;
  const api = issues.some((i) => i.stage === 'route' || i.stage === 'openapi') ? 70 : 94;
  const docs = files.some((f) => f.path.includes('openapi')) ? 90 : 60;
  const overall = Math.round((arch + sec + db + api + docs) / 5);
  return {
    stage: validation.blocking ? 'failed' : 'ready',
    ir,
    schemaSql,
    files: finalFiles,
    validation,
    quality: { architecture: arch, security: sec, database: db, api, docs, overall },
  };
}
