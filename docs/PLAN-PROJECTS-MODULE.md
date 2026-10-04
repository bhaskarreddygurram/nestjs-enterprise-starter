# Plan — Projects Module (Phase 15)

Applies the [CRUD Module Blueprint](CRUD-MODULE-BLUEPRINT.md) to the first
business entity. Status: **plan only — nothing implemented yet.**

(Phase 14 is Kubernetes, still open as PR #5.)

---

## 1. Scope

| Requested | Delivered as |
|---|---|
| All projects | `GET /api/v1/projects` — paginated, sortable |
| Project by id | `GET /api/v1/projects/:id` |
| Project search | `GET /api/v1/projects?search=...` plus typed filters (see §4) |
| Create | `POST /api/v1/projects` |
| Update | `PATCH /api/v1/projects/:id` |
| Delete (soft) | `DELETE /api/v1/projects/:id` |

Added beyond the request, with the reason for each:

| Addition | Why |
|---|---|
| `POST /projects/:id/restore` | Soft delete without restore is a one-way door; this is the reason to soft-delete at all |
| `deleted=only` list filter | Lets an admin find what to restore |
| Optimistic locking (`version`) | Two people editing the same project must not silently overwrite each other |
| Prisma error mapping in the global filter | Shared foundation — today a unique-constraint race returns 500 |
| `pg_trgm` index for search | Without it every search is a sequential scan |
| `project:*` permissions + audit actions | Same guard and trail as every other module |

---

## 2. Schema

```prisma
enum ProjectStatus {
  PLANNING
  ACTIVE
  ON_HOLD
  COMPLETED
  CANCELLED
}

enum ProjectPriority {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}

/// A unit of work owned by one user. Soft-deleted; `code` is a permanent
/// business key and is never reissued.
model Project {
  id          String          @id @default(uuid()) @db.Uuid
  code        String          @unique @db.VarChar(20)
  name        String          @db.VarChar(150)
  description String?         @db.Text
  status      ProjectStatus   @default(PLANNING)
  priority    ProjectPriority @default(MEDIUM)

  startDate   DateTime? @map("start_date") @db.Date
  dueDate     DateTime? @map("due_date") @db.Date
  completedAt DateTime? @map("completed_at")

  budget   Decimal? @db.Decimal(14, 2)
  currency String?  @db.Char(3)

  ownerId String @map("owner_id") @db.Uuid
  version Int    @default(1)

  createdById String?   @map("created_by_id") @db.Uuid
  updatedById String?   @map("updated_by_id") @db.Uuid
  deletedById String?   @map("deleted_by_id") @db.Uuid
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")
  deletedAt   DateTime? @map("deleted_at")

  owner User @relation("ProjectOwner", fields: [ownerId], references: [id], onDelete: Restrict)

  @@index([ownerId])
  @@index([status])
  @@index([dueDate])
  @@index([createdAt])
  @@index([name(ops: raw("gin_trgm_ops"))], type: Gin)
  @@index([description(ops: raw("gin_trgm_ops"))], type: Gin)
  @@map("projects")
}
```

`User` gains `ownedProjects Project[] @relation("ProjectOwner")`.

Design notes:

- **`code`** — the human-facing key (`CRM-2026`, `WEB-REDESIGN`). Supplied by
  the client, validated as `^[A-Z][A-Z0-9-]{1,19}$`, immutable after creation.
  `code` already has a B-tree index from `@unique`, which serves exact and
  prefix lookups.
- **`owner` uses `Restrict`** — users are soft-deleted, so the row always
  exists; `Restrict` only blocks a hard delete that would orphan projects.
- **`completedAt`** is set by the service when status becomes `COMPLETED` and
  cleared when it leaves that state. Clients cannot write it.
- **`budget` + `currency`** travel together: both or neither (service rule).
- **Hand-added to the migration SQL** (Prisma cannot express these):
  `CREATE EXTENSION IF NOT EXISTS pg_trgm;` before the indexes, and
  `CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date)`.
  To verify during implementation: `pg_trgm` is available on the Render
  Postgres instance, and `migrate dev` reports no drift after the manual edits.

---

## 3. Endpoints

| Method | Route | Permission | Success | Errors |
|---|---|---|---|---|
| GET | `/projects` | `project:read` | 200 paginated | 400 |
| GET | `/projects/:id` | `project:read` | 200 | 404 |
| POST | `/projects` | `project:create` | 201 | 400, 409 duplicate code |
| PATCH | `/projects/:id` | `project:update` | 200 | 400, 404, 409 stale version |
| DELETE | `/projects/:id` | `project:delete` | 204 | 404 |
| POST | `/projects/:id/restore` | `project:restore` | 200 | 404 |

**Create body** — `code`, `name` required; `description`, `status`, `priority`,
`startDate`, `dueDate`, `budget`, `currency`, `ownerId` optional. `ownerId`
defaults to the caller.

**Update body** — any create field except `code`, plus required `version`.

**Response** — `id, code, name, description, status, priority, startDate,
dueDate, completedAt, budget (string), currency, owner { id, firstName,
lastName }, version, createdAt, updatedAt`.

---

## 4. Search and filtering

"Search through all fields" is delivered as free-text search over the text
columns plus a typed filter for every other column. Substring-matching an enum,
a date or a UUID gives meaningless results and cannot use an index.

| Param | Applies to | Behaviour |
|---|---|---|
| `search` | `code`, `name`, `description` | Case-insensitive contains, OR across the three |
| `status` | `status` | One or more, comma-separated |
| `priority` | `priority` | One or more, comma-separated |
| `ownerId` | `ownerId` | Exact UUID |
| `dueFrom`, `dueTo` | `dueDate` | Inclusive range |
| `deleted` | `deletedAt` | `exclude` (default) or `only`; `only` requires `project:restore` |
| `sort` | whitelist | `createdAt, updatedAt, name, code, status, priority, startDate, dueDate` |
| `page`, `limit` | — | Inherited from `PaginationQueryDto` |

Filters combine with AND; `search` is ANDed with them.

Upgrade path if relevance ranking is ever needed: PostgreSQL full-text search
(a generated `tsvector` column). Not in this phase.

---

## 5. Business rules (service)

1. `dueDate >= startDate` when both are present → 400.
2. `budget` and `currency` are both present or both absent → 400.
3. `ownerId` must reference an existing, non-deleted user → 400.
4. Status → `COMPLETED` stamps `completedAt`; leaving `COMPLETED` clears it.
5. Duplicate `code` → 409, from the unique constraint (including a code held by
   a soft-deleted project).
6. Stale `version` on update → 409; unknown or deleted id → 404.
7. `createdById` / `updatedById` / `deletedById` come from the authenticated
   user, never from the request body.

---

## 6. Work breakdown

| # | Step | Verification |
|---|---|---|
| 1 | Shared foundation: map `P2002` / `P2025` / `P2003` in `GlobalExceptionFilter` | Filter unit spec; existing e2e suite still green |
| 2 | Schema + migration (`--create-only`, add extension + CHECK by hand) | `migrate dev` clean, no drift; `\d projects` shows the indexes |
| 3 | Seed: `project:read|create|update|delete|restore`, a few sample projects | Admin holds 16 permissions |
| 4 | `ProjectsRepository` — `findPage`, `findById`, `create`, `update` (versioned), `softDelete`, `restore` | Covered through the service spec and e2e |
| 5 | DTOs + `ProjectsService` with the rules in §5 and audit events | Unit spec for every rule and error branch |
| 6 | `ProjectsController` + Swagger; register `ProjectsModule` | Routes visible in `/api/docs` |
| 7 | `test/projects.e2e-spec.ts` | Blueprint §7 checklist |
| 8 | README (status row, endpoint table), `docs/TESTING-PHASE-15-PROJECTS.md` | — |
| 9 | Full gate: `lint:ci`, `typecheck`, `test:cov`, `test:e2e`, `build` → PR | CI green |

Step 1 changes behaviour for existing modules (a constraint violation that was
a 500 becomes a 409), so it lands as its own commit.

---

## 7. Prisma features this module exercises

Native enums · `Decimal` and native column types · named relations with
explicit `onDelete` · nested `select` for the owner summary · extended (GIN)
indexes · hand-edited migrations for an extension and a CHECK constraint ·
filtered `update` with a version predicate · error-code mapping
(`PrismaClientKnownRequestError`) · offset pagination with a whitelisted
`orderBy`.

Worth exploring afterwards, not part of this phase: a Prisma Client extension
(`$extends`) that applies the soft-delete filter globally; cursor pagination for
large lists; `relationLoadStrategy: 'join'` and full-text search (both preview
features).

---

## 8. Decisions to confirm before implementation

Each has a default the plan above assumes.

1. **Search route** — a `search` parameter on `GET /projects` (assumed), or a
   separate `GET /projects/search`.
2. **Project code** — supplied by the client (assumed), or generated by the
   server (`PRJ-000123`, which needs a database sequence).
3. **Budget fields** — included (assumed), or left out until there is a use.
4. **Row-level access** — any holder of `project:update` may edit any project
   (assumed), or only the owner plus holders of an elevated permission.
