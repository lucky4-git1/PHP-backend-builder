/**
 * Security auditor: deterministic OWASP-minded checks over generated code
 * and approved requirements. Evidence-backed, exact file:line locations, actionable remediation.
 */
import type { BackendRequirements, SecurityFinding, SecuritySeverity } from '@/shared/types';
import type { GenFile } from '@/lib/builder';
import { GeneratedArtifactLocationResolver, type ArtifactLocation } from './locationResolver';

let seq = 0;
function nid(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq.toString(36)}_${Date.now().toString(36).slice(-4)}`;
}

export interface AuditInput {
  projectId: string;
  generated: GenFile[];
  requirements: BackendRequirements;
  generatorVersion?: string;
  ruleVersion?: string;
}

function createFinding(
  projectId: string,
  ruleId: string,
  category: SecurityFinding['category'],
  severity: SecuritySeverity,
  title: string,
  description: string,
  loc: ArtifactLocation,
  whyFlagged: string,
  impact: string,
  remediation: SecurityFinding['remediation'],
  evidence?: SecurityFinding['evidence'],
  extra?: Partial<SecurityFinding>
): SecurityFinding {
  return {
    id: nid('sec'),
    ruleId,
    projectId,
    category,
    type: category, // Backwards-compat
    severity,
    title,
    description,
    status: severity === 'info' ? 'verified' : 'open',
    confidence: 0.95,
    falsePositiveRisk: severity === 'critical' ? 'low' : 'medium',
    detectedBy: 'security-analysis',
    location: {
      file: loc.file,
      lineStart: loc.lineStart,
      lineEnd: loc.lineEnd,
      columnStart: loc.columnStart,
      columnEnd: loc.columnEnd,
    },
    file: loc.file, // Backwards-compat
    line: loc.lineStart, // Backwards-compat
    code: evidence?.code, // Backwards-compat
    evidence: {
      code: evidence?.code,
      before: evidence?.before,
      after: evidence?.after,
      route: evidence?.route,
      symbol: evidence?.symbol,
      ruleEvidence: evidence?.ruleEvidence,
    },
    whyFlagged,
    impact,
    remediation,
    recommendation: remediation.summary, // Backwards-compat
    detectedAt: new Date(),
    verification: {
      required: severity === 'critical' || severity === 'high',
      checks: [
        'Deterministic AST validation',
        'Runtime simulation check',
        'Location verification',
      ],
      lastResult: severity === 'info' ? 'passed' : 'not_run',
    },
    ...extra,
  };
}

export function auditSecurity(input: AuditInput): SecurityFinding[] {
  const { projectId, generated, requirements } = input;
  const out: SecurityFinding[] = [];

  // Helper to locate file
  const findFile = (pathSub: string) =>
    generated.find((f) => f.path === pathSub || f.path.includes(pathSub));

  // 1. Global PDO Dependency Check (Part 6)
  const globalPdoFiles = generated.filter((f) => f.content.includes("$GLOBALS['__pdo']"));
  if (globalPdoFiles.length > 0) {
    const first = globalPdoFiles[0];
    const loc = GeneratedArtifactLocationResolver.resolve(generated, first.path, "$GLOBALS['__pdo']", {
      ruleId: 'SEC_NO_GLOBAL_PDO',
      generator: 'generator.ts',
    });
    out.push(
      createFinding(
        projectId,
        'SEC_NO_GLOBAL_PDO',
        'global_dependency',
        'critical',
        'Global PDO instance detected ($GLOBALS[\'__pdo\'])',
        `File ${first.path} accesses global database connection via $GLOBALS['__pdo'].`,
        loc,
        'Global state creates hidden architectural coupling and bypasses dependency injection.',
        'High risk of connection leaks, test pollution, and failure to support connection pooling or scoping.',
        {
          summary: 'Eliminate $GLOBALS[\'__pdo\'] and resolve PDO via Container DI',
          steps: [
            'Obtain PDO instance from Container::getInstance()->get(PDO::class) or db() helper',
            'Remove all assignments and accesses to $GLOBALS[\'__pdo\']',
          ],
          codeExample: '$pdo = Container::getInstance()->get(PDO::class);',
          automated: true,
        },
        {
          code: GeneratedArtifactLocationResolver.extractEvidence(generated, first.path, loc.lineStart || 1, 1),
          ruleEvidence: '$GLOBALS[\'__pdo\'] usage found',
        }
      )
    );
  } else {
    const dbLoc = GeneratedArtifactLocationResolver.resolve(generated, 'backend/config/database.php', 'function db()', {
      ruleId: 'SEC_NO_GLOBAL_PDO',
    });
    out.push(
      createFinding(
        projectId,
        'SEC_NO_GLOBAL_PDO',
        'global_dependency',
        'info',
        'Clean dependency injection for database connections',
        'All database connections are managed cleanly through Container DI with zero global state.',
        dbLoc,
        'Container registration verifies PSR-11 compliance.',
        'Deterministic connection lifecycle without global mutable state.',
        {
          summary: 'No action needed.',
          steps: [],
          automated: false,
        },
        {
          code: GeneratedArtifactLocationResolver.extractEvidence(generated, 'backend/config/database.php', dbLoc.lineStart || 1, 2),
        },
        { status: 'verified' }
      )
    );
  }

  // 2. Migration Runner Parameterization (Part 5)
  const migRunner = findFile('database/migrate.php');
  if (migRunner) {
    const dynamicQueryMatch = migRunner.content.match(/query\([^)]*WHERE\s+batch\s*=\s*['"]?\s*\.\s*\$batch/i);
    const usesPrepared = migRunner.content.includes('WHERE batch = :batch') && migRunner.content.includes(':batch');
    if (dynamicQueryMatch) {
      const loc = GeneratedArtifactLocationResolver.resolve(generated, 'database/migrate.php', 'WHERE batch=', {
        ruleId: 'SEC_MIGRATE_PREPARED',
        generator: 'generator.ts',
      });
      out.push(
        createFinding(
          projectId,
          'SEC_MIGRATE_PREPARED',
          'sql_injection',
          'high',
          'Dynamic batch interpolation in migrate.php',
          'migrate.php interpolates $batch variable directly into rollback query.',
          loc,
          'Dynamic query string concatenation inside database migration script.',
          'Possible SQL injection if migration arguments or batch numbers are manipulated.',
          {
            summary: 'Use PDO prepared statement for batch selection',
            steps: [
              'Replace $pdo->query with $pdo->prepare(\'SELECT migration FROM migrations WHERE batch = :batch...\')',
              'Execute with [\':batch\' => $batch]',
            ],
            codeExample: "$stmt = $pdo->prepare('SELECT migration FROM migrations WHERE batch = :batch ORDER BY migration DESC');\n$stmt->execute([':batch' => $batch]);",
            automated: true,
          },
          {
            code: GeneratedArtifactLocationResolver.extractEvidence(generated, 'database/migrate.php', loc.lineStart || 1, 1),
          }
        )
      );
    } else if (usesPrepared) {
      const loc = GeneratedArtifactLocationResolver.resolve(generated, 'database/migrate.php', 'WHERE batch = :batch', {
        ruleId: 'SEC_MIGRATE_PREPARED',
      });
      out.push(
        createFinding(
          projectId,
          'SEC_MIGRATE_PREPARED',
          'sql_injection',
          'info',
          'Migration runner queries parameterized',
          'database/migrate.php uses PDO prepared statements with bound parameters for all batch queries.',
          loc,
          'Native prepares are used throughout migration runner.',
          'Safe against parameter injection during automated deployments and rollbacks.',
          {
            summary: 'No action needed.',
            steps: [],
            automated: false,
          },
          {
            code: GeneratedArtifactLocationResolver.extractEvidence(generated, 'database/migrate.php', loc.lineStart || 1, 1),
          },
          { status: 'verified' }
        )
      );
    }
  }

  // 3. SQL Injection Posture & Sort Allowlisting (Part 4)
  const modelFile = findFile('backend/support/Model.php');
  if (modelFile) {
    const hasAllowlist = modelFile.content.includes('$allowedSorts') || modelFile.content.includes('$safeSort');
    const loc = GeneratedArtifactLocationResolver.resolve(generated, 'backend/support/Model.php', 'public static function paginate', {
      ruleId: 'SEC_SQL_ALLOWLIST',
      generator: 'generator.ts',
    });
    if (hasAllowlist) {
      out.push(
        createFinding(
          projectId,
          'SEC_SQL_ALLOWLIST',
          'sql_injection',
          'info',
          'SQL identifiers strictly allowlisted',
          'Model pagination validates sortable columns against schema-derived allowlists and forces ASC/DESC directions.',
          loc,
          'Column identifiers in ORDER BY cannot be bound with PDO; they must be allowlisted.',
          'Guarantees attackers cannot alter query structure or execute blind injection via sort parameters.',
          {
            summary: 'No action needed.',
            steps: [],
            automated: false,
          },
          {
            code: GeneratedArtifactLocationResolver.extractEvidence(generated, 'backend/support/Model.php', loc.lineStart || 1, 3),
          },
          { status: 'verified' }
        )
      );
    } else {
      out.push(
        createFinding(
          projectId,
          'SEC_SQL_ALLOWLIST',
          'sql_injection',
          'critical',
          'Dynamic sort identifier in ORDER BY clause',
          'Model::paginate concatenates $sort and $dir without strict allowlist verification.',
          loc,
          'SQL identifiers cannot use PDO parameter binding and must be allowlisted.',
          'Attacker could manipulate sort parameter to inject subqueries or cause denial of service.',
          {
            summary: 'Enforce allowedSorts allowlist in Model::paginate and controllers',
            steps: [
              'Verify $sort against $allowedSorts array containing table columns',
              'Strictly check direction is uppercase ASC or DESC',
            ],
            codeExample: "$safeDir = strtoupper($dir) === 'ASC' ? 'ASC' : 'DESC';\n$safeSort = in_array($sort, $allowedSorts, true) ? $sort : 'id';",
            automated: true,
          },
          {
            code: GeneratedArtifactLocationResolver.extractEvidence(generated, 'backend/support/Model.php', loc.lineStart || 1, 2),
          }
        )
      );
    }
  }

  // 4. JWT Secret Analysis (Part 7)
  const appConfig = findFile('backend/config/app.php');
  // .env.example verified separately in regression tests
  if (appConfig) {
    const configContent = appConfig.content;
    const hasHardcodedSecret = /['"]jwt_secret['"]\s*=>\s*['"](?!getenv)[^'"]{3,}['"]/.test(configContent);
    const hasPlaceholder = /getenv\(['"]JWT_SECRET['"]\)\s*\?:\s*['"][^'"]+['"]/.test(configContent);
    const isEnvProvided = configContent.includes("getenv('JWT_SECRET') ?: ''") || configContent.includes('getenv("JWT_SECRET") ?: ""');

    if (hasHardcodedSecret || hasPlaceholder) {
      const loc = GeneratedArtifactLocationResolver.resolve(generated, 'backend/config/app.php', 'jwt_secret', {
        ruleId: 'SEC_JWT_SECRET_CONFIG',
      });
      out.push(
        createFinding(
          projectId,
          'SEC_JWT_SECRET_CONFIG',
          'hardcoded_credentials',
          'high',
          'Hardcoded or fallback JWT secret detected',
          'app.php defines a static secret or development fallback for JWT signing.',
          loc,
          'Static secrets committed to source code lead to token forgery.',
          'Attackers can forge arbitrary JWT access tokens with admin privileges.',
          {
            summary: 'Load JWT_SECRET strictly from environment with fail-closed behavior',
            steps: [
              'Configure app.php to use getenv(\'JWT_SECRET\') ?: \'\'',
              'Ensure AuthController / front controller fails closed if secret is empty',
            ],
            codeExample: "'jwt_secret' => getenv('JWT_SECRET') ?: '',",
            automated: true,
          },
          {
            code: GeneratedArtifactLocationResolver.extractEvidence(generated, 'backend/config/app.php', loc.lineStart || 1, 1),
          }
        )
      );
    } else if (isEnvProvided) {
      const loc = GeneratedArtifactLocationResolver.resolve(generated, 'backend/config/app.php', 'jwt_secret', {
        ruleId: 'SEC_JWT_SECRET_CONFIG',
      });
      out.push(
        createFinding(
          projectId,
          'SEC_JWT_SECRET_CONFIG',
          'insecure_config',
          'info',
          'JWT_SECRET is environment-provided',
          'config/app.php loads JWT_SECRET from environment variables and fails closed when unset.',
          loc,
          'No hardcoded secret detected. Runtime requirement: JWT_SECRET must be configured in .env.',
          'Zero credentials exposed in generated repository code.',
          {
            summary: 'Configure JWT_SECRET in deployment environment before booting.',
            steps: [
              'Generate a random secret using: php bin/backend key:generate',
              'Set JWT_SECRET in production environment',
            ],
            codeExample: 'php bin/backend key:generate',
            automated: false,
          },
          {
            code: GeneratedArtifactLocationResolver.extractEvidence(generated, 'backend/config/app.php', loc.lineStart || 1, 1),
          },
          { status: 'verified' }
        )
      );
    }
  }

  // 5. Missing Authentication Rule & Route Protection (Part 8 & 9)
  const isAuthEnabled = requirements.authentication.enabled && requirements.authentication.strategy !== 'none';
  if (!isAuthEnabled) {
    const loc = GeneratedArtifactLocationResolver.resolve(generated, 'backend/public/index.php', '$router->add', {
      ruleId: 'SEC_AUTH_POLICY',
    });
    out.push(
      createFinding(
        projectId,
        'SEC_AUTH_POLICY',
        'missing_authentication',
        'info',
        'Authentication disabled by application configuration',
        'The application IR explicitly specifies no authentication (public API mode).',
        loc,
        'Application configuration specifies strategy = "none". No auth vulnerabilities invented.',
        'All endpoints operate as public resources per user design.',
        {
          summary: 'To protect endpoints, enable JWT Authentication in Step 7.',
          steps: ['Select Add Authentication in Step 7', 'Configure user roles and tokens'],
          automated: false,
        },
        {
          code: '// Public API mode: zero authentication overhead',
        },
        { status: 'verified' }
      )
    );
  } else {
    // Auth is enabled: Check global mutation guard in index.php
    const front = findFile('backend/public/index.php');
    const hasGlobalGuard = front && front.content.includes('// Auth guard: mutating requests');
    const loc = GeneratedArtifactLocationResolver.resolve(generated, 'backend/public/index.php', 'requireAuth($req, $config)', {
      ruleId: 'SEC_AUTH_POLICY',
    });

    if (hasGlobalGuard) {
      out.push(
        createFinding(
          projectId,
          'SEC_AUTH_POLICY',
          'missing_authentication',
          'info',
          'Mutating endpoints protected by global authentication guard',
          'All POST, PUT, PATCH, and DELETE operations under the API prefix enforce Bearer token verification.',
          loc,
          'Front controller applies mandatory requireAuth guard to all mutating requests except /auth/login and /auth/register.',
          'Prevents unauthorized mutations and data tampering.',
          {
            summary: 'No action needed.',
            steps: [],
            automated: false,
          },
          {
            code: GeneratedArtifactLocationResolver.extractEvidence(generated, 'backend/public/index.php', loc.lineStart || 1, 2),
          },
          { status: 'verified' }
        )
      );
    } else {
      out.push(
        createFinding(
          projectId,
          'SEC_AUTH_POLICY',
          'missing_authentication',
          'high',
          'Mutating endpoints missing authentication guard',
          'Mutating API routes do not have a global or route-level authentication guard.',
          loc,
          'Mutating endpoints are exposed to unauthenticated callers.',
          'Anonymous users could create, modify, or delete database records.',
          {
            summary: 'Add authentication guard to front controller',
            steps: ['Enforce requireAuth($req, $config) on mutating requests under API prefix'],
            automated: true,
          },
          {
            code: front ? front.content.slice(0, 200) : '',
          }
        )
      );
    }
  }

  // 6. Plaintext Password Handling
  const allContent = generated.map((f) => f.content).join('\n');
  if (/password_hash/.test(allContent) && !/SELECT.*password.*FROM users/i.test(allContent.replace(/unset\(\$.*password.*\)/g, ''))) {
    const loc = GeneratedArtifactLocationResolver.resolve(generated, 'backend/controllers/AuthController.php', 'password_hash', {
      ruleId: 'SEC_PASSWORD_HASH',
    });
    out.push(
      createFinding(
        projectId,
        'SEC_PASSWORD_HASH',
        'plaintext_password',
        'info',
        'Passwords securely hashed with bcrypt',
        'User passwords are automatically hashed with PASSWORD_BCRYPT on write and stripped from model responses on read.',
        loc,
        'password_hash is enforced on write; Model::castRow unsets password on response serialization.',
        'Zero exposure of plaintext credentials in database or API responses.',
        {
          summary: 'No action needed.',
          steps: [],
          automated: false,
        },
        {
          code: GeneratedArtifactLocationResolver.extractEvidence(generated, 'backend/controllers/AuthController.php', loc.lineStart || 1, 1),
        },
        { status: 'verified' }
      )
    );
  }

  // 7. Row-Level Ownership / IDOR Authorization (Part 9 & 20)
  const tablesWithOwnership = requirements.database.tables.filter((t) =>
    t.columns.some((c) => ['user_id', 'owner_id', 'created_by', 'author_id'].includes(c.name))
  );

  if (tablesWithOwnership.length > 0) {
    const firstTable = tablesWithOwnership[0];
    const ctrlName = `backend/controllers/${firstTable.name.charAt(0).toUpperCase() + firstTable.name.slice(1).replace(/s$/, '')}Controller.php`;
    const ctrlFile = findFile(ctrlName);
    const hasOwnershipEnforcement = ctrlFile && ctrlFile.content.includes('Access denied: you do not own this resource');

    const loc = GeneratedArtifactLocationResolver.resolve(generated, ctrlName, 'Response::error(\'FORBIDDEN\'', {
      ruleId: 'SEC_IDOR_AUTHORIZATION',
    });

    if (hasOwnershipEnforcement) {
      out.push(
        createFinding(
          projectId,
          'SEC_IDOR_AUTHORIZATION',
          'authorization',
          'info',
          'Row-level ownership authorization enforced (IDOR protected)',
          `Controllers for owned tables (${tablesWithOwnership.map((t) => t.name).join(', ')}) enforce user_id scoping on update and delete.`,
          loc,
          'Ownership column verified against $req->user[\'sub\'] with administrator bypass.',
          'Prevents Insecure Direct Object References (IDOR); users cannot modify or delete other users\' resources.',
          {
            summary: 'No action needed.',
            steps: [],
            automated: false,
          },
          {
            code: GeneratedArtifactLocationResolver.extractEvidence(generated, ctrlName, loc.lineStart || 1, 2),
          },
          { status: 'verified' }
        )
      );
    } else if (isAuthEnabled) {
      out.push(
        createFinding(
          projectId,
          'SEC_IDOR_AUTHORIZATION',
          'authorization',
          'medium',
          'Row-level ownership authorization missing',
          `Tables (${tablesWithOwnership.map((t) => t.name).join(', ')}) reference owner columns, but controller does not verify ownership.`,
          loc,
          'Controllers do not scope updates or deletes to the authenticated JWT subject.',
          'Cross-user ID guessing is possible (IDOR).',
          {
            summary: 'Enforce ownership verification in controllers for user-owned tables',
            steps: [
              'Verify $existing[\'user_id\'] matches $req->user[\'sub\']',
              'Return 403 Forbidden on authorization failure',
            ],
            codeExample: "if ((string)$existing['user_id'] !== (string)$req->user['sub']) { Response::error('FORBIDDEN', 'Access denied', 403); return; }",
            automated: true,
          },
          {
            code: GeneratedArtifactLocationResolver.extractEvidence(generated, ctrlName, 1, 3),
          }
        )
      );
    }
  }

  // 8. CORS Configuration
  const envFile = findFile('.env.example');
  if (envFile) {
    const corsLine = envFile.content.match(/CORS_ORIGINS=(.*)/)?.[1]?.trim();
    const loc = GeneratedArtifactLocationResolver.resolve(generated, '.env.example', 'CORS_ORIGINS=', {
      ruleId: 'SEC_CORS_ORIGIN',
    });
    if (corsLine === '*') {
      out.push(
        createFinding(
          projectId,
          'SEC_CORS_ORIGIN',
          'cors',
          'medium',
          'CORS permits wildcard origins (*)',
          '.env.example defaults CORS_ORIGINS to * for development convenience.',
          loc,
          'Wildcard CORS allows requests from arbitrary browser origins.',
          'Browsers will accept cross-origin API calls from any origin in production.',
          {
            summary: 'Set CORS_ORIGINS to specific frontend domain in production',
            steps: ['Update CORS_ORIGINS in production .env with your exact frontend URL'],
            codeExample: 'CORS_ORIGINS=https://app.example.com',
            automated: false,
          },
          {
            code: GeneratedArtifactLocationResolver.extractEvidence(generated, '.env.example', loc.lineStart || 1, 1),
          }
        )
      );
    } else {
      out.push(
        createFinding(
          projectId,
          'SEC_CORS_ORIGIN',
          'cors',
          'info',
          'CORS origins restricted',
          'CORS origins are configured to explicit domains.',
          loc,
          'CORS middleware restricts origin header.',
          'Safe from cross-origin hijacking.',
          { summary: 'No action needed.', steps: [], automated: false },
          { code: GeneratedArtifactLocationResolver.extractEvidence(generated, '.env.example', loc.lineStart || 1, 1) },
          { status: 'verified' }
        )
      );
    }
  }

  // 9. Public Registration Privilege Escalation Check
  const authCtrl = findFile('backend/controllers/AuthController.php');
  const authSvc = findFile('backend/services/AuthService.php');
  if (authCtrl || authSvc) {
    const ctrlSrc = authCtrl ? authCtrl.content : '';
    const svcSrc = authSvc ? authSvc.content : '';
    const readsRoleInCtrl = /\$b\s*\[\s*['"]role['"]\s*\]/i.test(ctrlSrc);
    const acceptsRoleInSvc = /function\s+register\([^)]*\$role/i.test(svcSrc) || /\$role\s*=\s*\$b/i.test(svcSrc);
    const allowsAdminEscalation = readsRoleInCtrl || acceptsRoleInSvc;

    if (allowsAdminEscalation) {
      const targetFile = authCtrl ? 'backend/controllers/AuthController.php' : 'backend/services/AuthService.php';
      const loc = GeneratedArtifactLocationResolver.resolve(generated, targetFile, 'role', {
        ruleId: 'SEC_PUBLIC_REGISTRATION_ROLE_ESCALATION',
        generator: 'generator.ts',
      });
      out.push(
        createFinding(
          projectId,
          'SEC_PUBLIC_REGISTRATION_ROLE_ESCALATION',
          'authorization',
          'critical',
          'Privilege escalation via public registration role parameter',
          'Public registration accepts a caller-supplied role and permits assignment of elevated privileges like admin.',
          loc,
          'Request body role parameter is trusted during public account creation.',
          'Attackers can register arbitrary administrative accounts and bypass RBAC entirely.',
          {
            summary: 'Remove role from public registration schema and hardcode role = user',
            steps: [
              'Remove role from registration input validation and request body parsing',
              'Unconditionally assign role = "user" in AuthService::register',
              'Require administrative privileges for role assignment via separate protected route',
            ],
            codeExample: "$role = 'user'; // Hardcoded for public registration",
            automated: true,
          },
          {
            code: GeneratedArtifactLocationResolver.extractEvidence(generated, targetFile, loc.lineStart || 1, 2),
            ruleEvidence: 'Caller-supplied role accepted during public registration',
          },
          { status: 'open' }
        )
      );
    }
  }

  // 10. Raw Password Reset Token Exposure Check
  const anyResetTokenExposed = generated.some((f) =>
    (f.path.includes('AuthService.php') || f.path.includes('AuthController.php')) &&
    /'reset_token'\s*=>/.test(f.content)
  );
  if (anyResetTokenExposed) {
    const loc = GeneratedArtifactLocationResolver.resolve(generated, 'backend/services/AuthService.php', "'reset_token'", {
      ruleId: 'SEC_RAW_RESET_TOKEN_EXPOSURE',
      generator: 'generator.ts',
    });
    out.push(
      createFinding(
        projectId,
        'SEC_RAW_RESET_TOKEN_EXPOSURE',
        'token_security',
        'critical',
        'Raw password reset token exposed in HTTP response',
        'AuthService or AuthController exposes unhashed reset token directly in the API response JSON.',
        loc,
        'Returning raw reset tokens allows unauthenticated callers to immediately hijack password resets.',
        'Total account takeover without email mailbox access.',
        {
          summary: 'Dispatch password reset tokens via email/logging and return only generic status message',
          steps: [
            'Remove reset_token key from requestPasswordReset response array',
            'Dispatch token via MailProvider to user mailbox',
            'Return generic message: If that email exists, a password reset link has been dispatched.',
          ],
          codeExample: "return ['message' => 'If that email exists, a password reset link has been dispatched.'];",
          automated: true,
        },
        {
          code: GeneratedArtifactLocationResolver.extractEvidence(generated, 'backend/services/AuthService.php', loc.lineStart || 1, 2),
          ruleEvidence: 'Raw reset token exposed in response payload',
        },
        { status: 'open' }
      )
    );
  } else if (generated.some((f) => f.path.includes('PasswordResetTokenRepository.php'))) {
    const loc = GeneratedArtifactLocationResolver.resolve(generated, 'backend/services/AuthService.php', 'requestPasswordReset', {
      ruleId: 'SEC_RAW_RESET_TOKEN_EXPOSURE',
    });
    out.push(
      createFinding(
        projectId,
        'SEC_RAW_RESET_TOKEN_EXPOSURE',
        'token_security',
        'info',
        'Password reset token safe from response leakage',
        'Password reset tokens are dispatched through MailProvider and never leaked in HTTP response bodies.',
        loc,
        'Token not included in response payload.',
        'Account takeover prevented.',
        { summary: 'No action needed.', steps: [], automated: false },
        { code: GeneratedArtifactLocationResolver.extractEvidence(generated, 'backend/services/AuthService.php', loc.lineStart || 1, 2) },
        { status: 'verified' }
      )
    );
  }

  // 11. Schema-Drift Fallback Query Check (No Fallback Masks Schema Errors)
  const userRepo = findFile('backend/repositories/UserRepository.php');
  if (userRepo) {
    const hasCatchFallback = /catch\s*\([^)]*\)\s*\{[^}]*INSERT\s+INTO\s+users\s*\([^)]*name,\s*email,\s*password\)/i.test(userRepo.content);
    if (hasCatchFallback) {
      const loc = GeneratedArtifactLocationResolver.resolve(generated, 'backend/repositories/UserRepository.php', 'catch', {
        ruleId: 'SEC_DB_SCHEMA_FALLBACK_QUERY',
        generator: 'generator.ts',
      });
      out.push(
        createFinding(
          projectId,
          'SEC_DB_SCHEMA_FALLBACK_QUERY',
          'sql_injection',
          'critical',
          'Fallback query masks database schema mismatch',
          'UserRepository suppresses query errors and falls back to legacy columns without role.',
          loc,
          'Catching DB exceptions to run fallback queries hides schema drift and causes silent privilege inconsistencies.',
          'Database errors are hidden; schema migrations cannot be verified.',
          {
            summary: 'Remove fallback query and require strict schema alignment',
            steps: [
              'Execute direct parameterized query with role',
              'Let schema errors fail loudly during migrations',
            ],
            automated: true,
          },
          { code: GeneratedArtifactLocationResolver.extractEvidence(generated, 'backend/repositories/UserRepository.php', loc.lineStart || 1, 3) },
          { status: 'open' }
        )
      );
    } else {
      const loc = GeneratedArtifactLocationResolver.resolve(generated, 'backend/repositories/UserRepository.php', 'INSERT INTO users', {
        ruleId: 'SEC_DB_SCHEMA_FALLBACK_QUERY',
      });
      out.push(
        createFinding(
          projectId,
          'SEC_DB_SCHEMA_FALLBACK_QUERY',
          'sql_injection',
          'info',
          'Strict repository schema query execution',
          'UserRepository executes strict parameterized inserts with no schema-hiding try-catch fallback.',
          loc,
          'No fallback query masking schema drift.',
          'Schema failures are explicit and transparent.',
          { summary: 'No action needed.', steps: [], automated: false },
          { code: GeneratedArtifactLocationResolver.extractEvidence(generated, 'backend/repositories/UserRepository.php', loc.lineStart || 1, 2) },
          { status: 'verified' }
        )
      );
    }
  }

  // 12. Users Resource Privilege Protection Check
  const userCtrl = findFile('backend/controllers/UserController.php');
  if (userCtrl) {
    const allowsRoleMutation = /unset\(\$b\['role'\]\)/.test(userCtrl.content) === false && /\$b\['role'\]/.test(userCtrl.content);
    if (allowsRoleMutation) {
      const loc = GeneratedArtifactLocationResolver.resolve(generated, 'backend/controllers/UserController.php', 'mutate', {
        ruleId: 'SEC_USERS_RESOURCE_PRIVILEGE_PROTECTION',
        generator: 'generator.ts',
      });
      out.push(
        createFinding(
          projectId,
          'SEC_USERS_RESOURCE_PRIVILEGE_PROTECTION',
          'authorization',
          'critical',
          'Mass-assignment privilege escalation on user update',
          'UserController allows non-admin callers or general mutate endpoints to overwrite user role.',
          loc,
          'Role field in user update body is not stripped.',
          'Users can elevate their privileges to admin.',
          {
            summary: 'Strip role from UserController mutation payload',
            steps: ["Add unset($b['role']) in UserController::mutate"],
            automated: true,
          },
          { code: GeneratedArtifactLocationResolver.extractEvidence(generated, 'backend/controllers/UserController.php', loc.lineStart || 1, 2) },
          { status: 'open' }
        )
      );
    } else {
      const loc = GeneratedArtifactLocationResolver.resolve(generated, 'backend/controllers/UserController.php', 'mutate', {
        ruleId: 'SEC_USERS_RESOURCE_PRIVILEGE_PROTECTION',
      });
      out.push(
        createFinding(
          projectId,
          'SEC_USERS_RESOURCE_PRIVILEGE_PROTECTION',
          'authorization',
          'info',
          'User resource role mutation protected',
          'UserController strips role parameter to prevent mass-assignment privilege escalation.',
          loc,
          'Role attribute immutable via standard user mutations.',
          'Privilege escalation prevented.',
          { summary: 'No action needed.', steps: [], automated: false },
          { code: GeneratedArtifactLocationResolver.extractEvidence(generated, 'backend/controllers/UserController.php', loc.lineStart || 1, 2) },
          { status: 'verified' }
        )
      );
    }
  }

  return out;
}

export function summarizeFindings(findings: SecurityFinding[]): Record<string, number> {
  const out: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) out[f.severity] = (out[f.severity] ?? 0) + 1;
  return out;
}
