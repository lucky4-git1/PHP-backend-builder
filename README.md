# PHP Backend Builder (Production-Grade 10/10 Generator)

A production-grade, deterministic **Frontend-to-Backend Application Generator** that transforms frontend applications, HTML/JS mockups, or API specifications into complete, secure, modern PHP backends with MySQL schemas, OpenAPI contracts, and integrated client-side SDKs.

---

## 🏛️ Pipeline Architecture

The generator preserves a strict, unidirectional 7-stage architectural pipeline:

```
Frontend / Specification
          ↓
       Analyzer
          ↓
    Application IR
          ↓
      Schema AST
          ↓
      Generators
          ↓
 Validation Pipeline
          ↓
        Export
```

### 14-Step Interactive Workflow
1. **Create Project** — Initialize project metadata, database names, and runtime configurations.
2. **Import Frontend** — Drag-and-drop HTML/JS/CSS, Single Page Apps, or ZIP archives.
3. **Analyze** — Extract forms, fetch/AJAX calls, data models, and API requirements.
4. **Review Findings** — Inspect inferred routes, entities, and ambiguous fields.
5. **Review Requirements** — Confirm backend contract and business rules.
6. **Design Database** — Visual schema builder with strict MySQL data types, indexes, and foreign keys.
7. **Review API** — Inspect generated RESTful endpoints, query parameters, and pagination.
8. **Generate Backend** — Deterministic code generation for controllers, models, and migrations.
9. **Review Frontend Changes** — Diff preview of original vs integrated frontend files.
10. **Apply Integration** — Inject unified `api-client.js` and reactive `auth-store.js`.
11. **Run Tests** — Browser-safe test runner validating PSR-4 autoloading, syntax, and HTTP simulation.
12. **Security Audit** — OWASP-minded security scanner with exact `file:line` locations and automated remediation.
13. **Final Architecture** — System architecture map and 10-category Application Certification Report.
14. **Export Complete Project** — Quality-gated ZIP package ready for immediate production deployment.

---

## ✨ Production-Grade Architectural Highlights

* **Zero Global PDO (`$GLOBALS['__pdo']`)**: All generated controllers and models use PSR-11 `App\Support\Container` and the `db()` factory helper.
* **SQL Injection Immunity & Sort Allowlisting**: All `ORDER BY` sort columns and directions are strictly validated against schema-derived allowlists (`in_array($sort, $allowedSorts, true)`).
* **Parameterized Migrations**: Migration execution and rollback scripts utilize native PDO prepared statements (`:batch`).
* **Row-Level IDOR Protection**: Controllers automatically verify ownership columns (`user_id`, `owner_id`, `created_by`, `author_id`) against the authenticated JWT subject with `403 Forbidden` response and admin bypass.
* **Fail-Closed Authentication**:
  * Dual-token lifecycle (`access_token` + `refresh_token` with single-use rotation).
  * JWT secrets loaded strictly from environment with zero hardcoded fallbacks.
  * Public/no-auth mode cleanly isolates and emits zero unnecessary auth artifacts.
* **Interactive Source Viewer**: Click on any security finding `file:line` coordinate to view the exact code snippet with highlighted lines.
* **Application Certification Report**: Deterministic weighted scoring across Architecture (10%), Schema (10%), Backend (15%), Auth (10%), Authz (10%), Frontend (10%), API Contract (5%), Security (15%), Testing (10%), and Runtime (5%) with enforced hard floors.
* **Hardened Export Gate**: Critical and high findings cannot be bypassed by marking them "Reviewed" or "Ignored" without verified architectural remediation.

---

## 🚀 Getting Started

### Prerequisites
* Node.js 18+
* npm or pnpm

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd php-backend-builder

# Install dependencies
npm install
```

### Development Server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Production Build

```bash
npm run build
```

Builds the application to `dist/` with full type checking.

---

## 🧪 Verification & Testing

### Type Checking
```bash
npx tsc --noEmit
```

### 30-Point Regression Suite
Run all 30 architectural and runtime regression tests:
```bash
npx tsx -e "import { runRegressionTests } from './src/testing/regression'; const r = runRegressionTests(); console.log('Passed:', r.filter(t => t.passed).length + '/' + r.length);"
```

---

## 📦 Exported Backend Structure

```
backend/
├── config/
│   ├── app.php              # Environment-based configuration (JWT secret, CORS)
│   └── database.php         # PDO connection factory with Container DI
├── controllers/             # RESTful CRUD controllers with IDOR protection
│   ├── AuthController.php   # Register, Login, Refresh, Logout, Me
│   └── ...Controller.php    # Generated resource controllers
├── models/                  # Base Model with pagination allowlisting & casts
│   └── ...php
├── public/
│   └── index.php            # Front controller with routing & global mutation guard
└── support/                 # Core framework utilities
    ├── Container.php        # PSR-11 dependency injection container
    ├── Env.php              # Deterministic .env loader
    ├── Jwt.php              # Zero-dependency HS256 JWT encoder/decoder
    ├── Request.php          # HTTP request abstraction with bearer resolution
    ├── Response.php         # Standardized JSON responses
    ├── Router.php           # High-performance route matching
    └── Middleware.php       # Rate limiting & security headers
database/
├── migrations/              # Topologically-ordered migration scripts
└── migrate.php              # Parameterized migration runner
docs/
└── openapi.json             # Route-synchronized OpenAPI 3.0.0 documentation
```

---

## 📄 License

MIT
