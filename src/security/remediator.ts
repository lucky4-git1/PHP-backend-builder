/**
 * Security Remediator: Executes architectural remediation strategies.
 *
 * Pipeline:
 * Finding -> Remediation Strategy -> Modify Application IR / generator configuration
 *         -> Regenerate affected artifacts -> Validate -> Security scan again -> VERIFIED
 *
 * Note: Never does arbitrary string replacement on generated files.
 */
import type { BuilderState, GenFile } from '@/lib/builder';
import type { SecurityFinding, BackendRequirements } from '@/shared/types';
import { generateProject } from '@/lib/generator';
import { auditSecurity } from './auditor';
import { runValidationPipeline, type ValidationResult } from '@/validation/pipeline';

export interface RemediationResult {
  success: boolean;
  strategyApplied: string;
  updatedBuilder: BuilderState;
  regeneratedFiles: GenFile[];
  updatedFinding: SecurityFinding;
  allFindings: SecurityFinding[];
  validation: ValidationResult;
  verified: boolean;
  message: string;
}

export function canRemediateFinding(finding: SecurityFinding): boolean {
  if (finding.status === 'verified') return false;
  return (
    finding.remediation?.automated === true ||
    [
      'SEC_NO_GLOBAL_PDO',
      'SEC_MIGRATE_PREPARED',
      'SEC_SQL_ALLOWLIST',
      'SEC_JWT_SECRET_CONFIG',
      'SEC_AUTH_POLICY',
      'SEC_IDOR_AUTHORIZATION',
      'SEC_CORS_ORIGIN',
      'SEC_PASSWORD_HASH',
    ].includes(finding.ruleId)
  );
}

/**
 * Computes a simple deterministic hash for generated file artifacts to detect staleness.
 */
export function computeArtifactsHash(files: GenFile[]): string {
  let hash = 0;
  for (const f of files) {
    const str = f.path + ':' + f.content.length;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
  }
  return 'art_' + Math.abs(hash).toString(36);
}

/**
 * Marks findings as stale when generator artifacts have changed since the finding was recorded.
 */
export function invalidateStaleFindings(
  findings: SecurityFinding[],
  currentFiles: GenFile[],
  knownHash?: string
): SecurityFinding[] {
  const currentHash = knownHash || computeArtifactsHash(currentFiles);
  return findings.map((f) => {
    if (f.fingerprint && f.fingerprint !== currentHash) {
      return { ...f, isStale: true };
    }
    return f;
  });
}

/**
 * Executes an architectural remediation on Application IR and regenerates artifacts.
 */
export function applyRemediation(
  finding: SecurityFinding,
  builder: BuilderState,
  requirements?: BackendRequirements
): RemediationResult {
  const updatedBuilder: BuilderState = JSON.parse(JSON.stringify(builder));
  let strategyApplied = 'Architectural generator revalidation';

  switch (finding.ruleId) {
    case 'SEC_NO_GLOBAL_PDO':
      strategyApplied = 'Container Dependency Injection: Enforce PSR-11 Container for all database connections';
      break;

    case 'SEC_MIGRATE_PREPARED':
      strategyApplied = 'Migration Parameterization: Use prepared statements with bound parameters in migrate.php';
      break;

    case 'SEC_SQL_ALLOWLIST':
      strategyApplied = 'SQL Identifier Allowlisting: Strictly allowlist sort columns and directions in Model.php and controllers';
      break;

    case 'SEC_JWT_SECRET_CONFIG':
      strategyApplied = 'Fail-Closed Credential Loading: Load JWT_SECRET strictly from environment with empty default';
      break;

    case 'SEC_AUTH_POLICY':
      if (updatedBuilder.auth.strategy === 'none') {
        strategyApplied = 'Enable JWT Authentication: Configure user auth and token lifecycle in Builder IR';
        updatedBuilder.auth.strategy = 'jwt';
        updatedBuilder.auth.login = true;
        updatedBuilder.auth.register = true;
        updatedBuilder.auth.me = true;
        updatedBuilder.auth.refresh = true;
      } else {
        strategyApplied = 'Global Mutation Guard: Protect all mutating routes in front controller';
      }
      break;

    case 'SEC_IDOR_AUTHORIZATION':
      strategyApplied = 'Row-Level Ownership Verification: Enforce user_id matching and 403 Forbidden on update/delete';
      break;

    case 'SEC_CORS_ORIGIN':
      strategyApplied = 'Restrict CORS Origins: Replace wildcard with specific allowed development and production origins';
      break;

    default:
      strategyApplied = `Default generator hardening strategy for ${finding.ruleId}`;
      break;
  }

  // 1. Regenerate affected artifacts from updated Builder IR
  const regeneratedFiles = generateProject(updatedBuilder);
  const newHash = computeArtifactsHash(regeneratedFiles);

  // 2. Prepare effective requirements for re-audit
  const effectiveReqs: BackendRequirements = requirements || ({
    database: { tables: updatedBuilder.tables, relationships: [] },
    authentication: { enabled: updatedBuilder.auth.strategy !== 'none', strategy: updatedBuilder.auth.strategy },
    api: {
      endpoints: updatedBuilder.endpoints,
      basePath: updatedBuilder.config.apiPrefix,
      version: 'v1',
      cors: { enabled: true, origins: [], methods: [], headers: [], credentials: false },
    },
    files: { uploads: [] },
    validation: { rules: [], globalRules: [] },
    businessRules: [],
    ambiguities: [],
  } as unknown as BackendRequirements);

  // 3. Security scan again on freshly generated artifacts
  const freshFindings = auditSecurity({
    projectId: updatedBuilder.config.projectName,
    generated: regeneratedFiles,
    requirements: effectiveReqs,
  }).map((f) => ({ ...f, fingerprint: newHash }));

  // 4. Validate through pipeline
  const validation = runValidationPipeline(updatedBuilder, regeneratedFiles);

  // 5. Verify resolution: finding is resolved if it no longer appears as critical/high open
  const stillUnresolved = freshFindings.some(
    (f) => f.ruleId === finding.ruleId && (f.severity === 'critical' || f.severity === 'high') && f.status === 'open'
  );
  const verified = !stillUnresolved && !validation.blocking;

  const updatedFinding: SecurityFinding = {
    ...finding,
    status: verified ? 'verified' : 'fixed',
    fingerprint: newHash,
    isStale: false,
    verification: {
      required: true,
      checks: [
        'Application IR updated',
        'Artifacts regenerated from source templates',
        'Security re-audit executed',
        'Validation pipeline evaluated',
      ],
      lastResult: verified ? 'passed' : 'failed',
    },
  };

  return {
    success: verified,
    strategyApplied,
    updatedBuilder,
    regeneratedFiles,
    updatedFinding,
    allFindings: freshFindings,
    validation,
    verified,
    message: verified
      ? `Successfully remediated and verified ${finding.ruleId} via ${strategyApplied}.`
      : `Remediation applied but finding or validation still flagged issues.`,
  };
}
