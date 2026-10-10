# Testing Guide — Phase 15: Projects Module

> How to test the Projects API added in this phase — six routes under **`/api/v1/projects`** with search, typed filters, optimistic locking, soft delete and restore. This is the first module built to the [CRUD Module Blueprint](CRUD-MODULE-BLUEPRINT.md).
>
> Design: [`PLAN-PROJECTS-MODULE.md`](PLAN-PROJECTS-MODULE.md) · Build order: [`STEPS-PROJECTS-MODULE.md`](STEPS-PROJECTS-MODULE.md) · Run guide: [`RUNNING-THE-PROJECT.md`](RUNNING-THE-PROJECT.md)

---

## 0. Prerequisites

```powershell
npm run docker:up        # PostgreSQL + Redis
npm run prisma:deploy    # applies the two projects migrations (needs pg_trgm)
npm run db:seed          # grants the admin project:* and adds 6 sample projects
npm run start:dev
```

| Base URL | `http://localhost:8000` |
|---|---|

Seeded admin: `admin@example.com` / `Admin123!ChangeMe` (holds all five `project:*` permissions).

Seeded projects: `CRM-2026`, `WEB-REDESIGN`, `PAY-GATEWAY`, `AUDIT-Q2`, `MOBILE-APP`, and the soft-deleted `LEGACY-CLEANUP`.

> **Existing database?** Re-run `npm run db:seed` after pulling this phase. Without it the admin lacks the new permissions and every projects route returns 403.

---

## 1. Mental model

```
HTTP ──► ProjectsController ──► ProjectsService ──► ProjectsRepository ──► Prisma ──► PostgreSQL
          routes, status codes     business rules      every query,
          @Permissions, Swagger    audit events        soft-delete filter
```

- **The service never builds a query.** It passes a plain `ProjectFilter` to the repository, which alone turns it into a Prisma `where`.
- **The database is the guard for uniqueness.** There is no "does this code exist?" pre-check. The unique constraint rejects a duplicate and the global exception filter turns Prisma's `P2002` into a 409.
- **Optimistic locking.** Every project has a `version`. `PATCH` must send the version it read; the update runs as `UPDATE … WHERE id = ? AND version = ? AND deleted_at IS NULL`. No row matched means someone else got there first → 409.
- **Soft delete.** `DELETE` stamps `deletedAt` / `deletedById`. The row stays, the `code` stays reserved, and `POST /:id/restore` brings it back.

---

## 2. Endpoints

| Method | Route | Permission | Success | Errors |
|---|---|---|---|---|
| GET | `/api/v1/projects` | `project:read` | 200 | 400, 403 |
| GET | `/api/v1/projects/:id` | `project:read` | 200 | 404 |
| POST | `/api/v1/projects` | `project:create` | 201 | 400, 409 |
| PATCH | `/api/v1/projects/:id` | `project:update` | 200 | 400, 404, 409 |
| DELETE | `/api/v1/projects/:id` | `project:delete` | 204 | 404 |
| POST | `/api/v1/projects/:id/restore` | `project:restore` | 200 | 404 |

List query parameters:

| Param | Behaviour |
|---|---|
| `search` | Case-insensitive contains across `code`, `name`, `description` |
| `status` | One or more of `PLANNING, ACTIVE, ON_HOLD, COMPLETED, CANCELLED`, comma-separated |
| `priority` | One or more of `LOW, MEDIUM, HIGH, CRITICAL`, comma-separated |
| `ownerId` | Exact user id |
| `dueFrom`, `dueTo` | Inclusive `YYYY-MM-DD` range on `dueDate` |
| `deleted` | `exclude` (default) or `only` — `only` also needs `project:restore` |
| `sort` | `createdAt, updatedAt, name, code, status, priority, startDate, dueDate`; prefix `-` for descending |
| `page`, `limit` | Defaults 1 and 20; `limit` max 100 |

---

## 3. Swagger walkthrough

Open `http://localhost:8000/api/docs`, call `POST /auth/login` with the seeded admin, copy `data.accessToken`, click **Authorize**, then work through the **Projects** section.

1. **List** — `GET /projects` returns the five live sample projects.
2. **Search** — `search=crm` returns `CRM-2026`; `search=penetration` finds `AUDIT-Q2` through its description.
3. **Filter and sort** — `status=ACTIVE,ON_HOLD`, then `sort=-dueDate` (projects without a due date come last).
4. **Create** — `POST /projects` with `{"code": "DEMO-1", "name": "Demo"}` → 201, `version: 1`. Send it again → 409.
5. **Update** — `PATCH /projects/{id}` with `{"version": 1, "status": "COMPLETED"}` → 200, `version: 2`, `completedAt` set. Send the same body again → 409.
6. **Delete** — `DELETE /projects/{id}` → 204. `GET /projects/{id}` → 404.
7. **Find it again** — `GET /projects?deleted=only` lists it.
8. **Restore** — `POST /projects/{id}/restore` → 200.

---

## 4. PowerShell walkthrough

```powershell
$base = 'http://localhost:8000/api/v1'
$login = Invoke-RestMethod -Method Post "$base/auth/login" -ContentType 'application/json' `
  -Body (@{ email = 'admin@example.com'; password = 'Admin123!ChangeMe' } | ConvertTo-Json)
$h = @{ Authorization = "Bearer $($login.data.accessToken)" }

# list + search + filter + sort
(Invoke-RestMethod "$base/projects" -Headers $h).data | Select-Object code, status, priority, dueDate
(Invoke-RestMethod "$base/projects?search=crm" -Headers $h).data.code
(Invoke-RestMethod "$base/projects?status=ACTIVE,ON_HOLD&sort=-dueDate" -Headers $h).data.code
(Invoke-RestMethod "$base/projects?limit=2&page=2&sort=name" -Headers $h).meta

# create
$body = @{ code = 'DEMO-1'; name = 'Demo project'; startDate = '2026-10-01'; dueDate = '2026-11-01'
           budget = '2500.00'; currency = 'EUR' } | ConvertTo-Json
$p = (Invoke-RestMethod -Method Post "$base/projects" -Headers $h -ContentType 'application/json' -Body $body).data
$p | Select-Object id, code, version, budget, startDate

# update with the version just read
$patch = @{ version = $p.version; status = 'COMPLETED' } | ConvertTo-Json
(Invoke-RestMethod -Method Patch "$base/projects/$($p.id)" -Headers $h -ContentType 'application/json' -Body $patch).data |
  Select-Object version, status, completedAt

# delete, list deleted, restore
Invoke-RestMethod -Method Delete "$base/projects/$($p.id)" -Headers $h
(Invoke-RestMethod "$base/projects?deleted=only" -Headers $h).data.code
(Invoke-RestMethod -Method Post "$base/projects/$($p.id)/restore" -Headers $h).data | Select-Object code, version
```

`Invoke-RestMethod` throws on 4xx. To see an error body, wrap the call in `try { … } catch { $_.ErrorDetails.Message }`.

---

## 5. What to try, and what you should get

### Validation (400, `errorCode: VALIDATION_ERROR`)

| Request | Why it fails |
|---|---|
| `code: "bad code"` | 2-20 chars, uppercase letters, digits and `-`, starting with a letter |
| `name: "   "` | Trimmed, then must not be empty |
| `status: "DONE"` | Not a `ProjectStatus` value |
| `startDate: "2026-02-30"` | Not a real date |
| `budget: 100` | Must be a string such as `"100.00"` — never a JSON number |
| `currency: "eur"` | Three uppercase letters |
| `status: null` | A NOT NULL field may be omitted but not set to `null` |
| `createdById: "…"` | Server-owned; unknown properties are rejected |
| PATCH without `version` | `version` is required |
| PATCH with `code` | `code` is immutable |

### Business rules (400)

| Request | Message |
|---|---|
| `dueDate` before `startDate` | `dueDate must not be before startDate` |
| `budget` without `currency` (or the reverse) | `budget and currency must be provided together` |
| `ownerId` of a user that does not exist | `Owner with id "…" not found` |
| `dueFrom` after `dueTo` in a list query | `dueFrom must not be after dueTo` |

On `PATCH` the rules apply to the **merged** result. With a stored `startDate` of `2026-09-01`, sending only `{"version": n, "dueDate": "2026-08-01"}` is rejected, while `{"version": n, "startDate": "2027-06-01", "dueDate": null}` is accepted.

### Null on PATCH

`null` clears a nullable field: `description`, `startDate`, `dueDate`, `budget`, `currency`. Budget and currency must be cleared together.

### Conflicts (409)

| Situation | Message |
|---|---|
| Duplicate `code`, including one held by a deleted project | `A record with this code already exists` |
| Stale `version` on PATCH | `Project was changed by someone else (current version N). Reload it and try again.` |

### Status and `completedAt`

`completedAt` cannot be sent by a client. It is stamped when the status becomes `COMPLETED` and cleared when it leaves that state.

---

## 6. Database checks

```powershell
docker compose exec postgres psql -U postgres -d enterprise_db
```

```sql
-- structure: enums, the three trigram indexes, the CHECK constraint, the FK
\d projects

-- soft delete keeps the row
SELECT code, version, deleted_at, deleted_by_id FROM projects ORDER BY code;

-- the database enforces the rules too
INSERT INTO projects (id, code, name, owner_id, updated_at, start_date, due_date)
SELECT gen_random_uuid(), 'T-BAD', 'x', id, now(), '2026-05-10', '2026-05-01' FROM users LIMIT 1;
-- ERROR: violates check constraint "projects_due_after_start_check"

-- search uses the trigram indexes (seqscan is disabled only to show it on a small table)
SET enable_seqscan = off;
EXPLAIN (COSTS OFF)
SELECT id FROM projects
WHERE deleted_at IS NULL
  AND (code ILIKE '%crm%' OR name ILIKE '%crm%' OR description ILIKE '%crm%');
-- BitmapOr over projects_code_idx, projects_name_idx, projects_description_idx

-- audit trail
SELECT action, metadata, created_at FROM audit_logs
WHERE resource = 'project' ORDER BY created_at DESC LIMIT 10;
```

Use your own `POSTGRES_USER` / `POSTGRES_DB` if they differ from the defaults.

---

## 7. Automated tests

```powershell
npx jest src/modules/projects          # unit: DTO validation + service rules
npm run test:cov                       # all unit tests + coverage gate
npm run test:e2e                       # all e2e, including test/projects.e2e-spec.ts
```

| Spec | Tests | Covers |
|---|---|---|
| `dto/project-dtos.spec.ts` | 49 | The HTTP contract, run through the same `ValidationPipe` options as `main.ts` |
| `projects.service.spec.ts` | 51 | Every business rule and error branch, with a mocked repository |
| `test/projects.e2e-spec.ts` | 61 | All six routes against the real app and database |

The e2e spec includes two concurrency tests that fire simultaneous requests and assert exactly one wins: duplicate creates (unique constraint) and updates on the same version (optimistic lock). It is repeatable — its rows carry a per-run prefix and are removed afterwards.

The repository has no unit spec by design: mocking Prisma would only test the mock. It is exercised against PostgreSQL by the e2e spec.

---

## 8. Deploying this phase

1. **`pg_trgm`.** The first migration runs `CREATE EXTENSION IF NOT EXISTS pg_trgm`. It is a trusted extension in PostgreSQL 13+, so a database owner can create it without superuser rights, but confirm your provider allows it before deploying — a failure there fails `prisma migrate deploy`.
2. **Re-seed.** Run `npm run db:seed` once after the deploy so the admin role receives the `project:*` permissions. In production the six sample projects are skipped unless `SEED_SAMPLE_DATA=true`.

---

## 9. Troubleshooting

| Symptom | Cause |
|---|---|
| 403 on every projects route as admin | Seed not re-run, so the admin lacks `project:*`. Run `npm run db:seed` |
| 409 creating a code that "does not exist" | A soft-deleted project holds it. Check `?deleted=only` |
| 409 on every PATCH | Sending an old `version`. Re-read the project and use its current value |
| 400 `budget must be a non-negative decimal string` | Budget sent as a JSON number; send `"100.00"` |
| `migrate deploy` fails on `pg_trgm` | The database role may not create extensions; ask the provider or create it as an admin |
