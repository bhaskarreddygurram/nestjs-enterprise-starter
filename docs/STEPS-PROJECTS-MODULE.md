# Steps — Projects Module (Phase 15)

The step-by-step build order for the [Projects plan](PLAN-PROJECTS-MODULE.md),
following the [CRUD Module Blueprint](CRUD-MODULE-BLUEPRINT.md).

How to use it: one step at a time. Each step is small enough to read in full,
ends in something you can run, and has a **Validate** block. Do not start the
next step until the current one validates. Each step is one commit.

Assumed decisions (plan §8 defaults): `search` is a parameter of `GET /projects`,
`code` is supplied by the client, budget fields are included, and any holder of
`project:update` may edit any project.

| # | Step | Layer | Runs against |
|---|---|---|---|
| 0 | Baseline | — | everything |
| 1 | Prisma error mapping | shared filter | unit test |
| 2 | Schema + migration | database | Postgres |
| 3 | Permissions + seed data | database | Postgres |
| 4 | Domain types | module | compiler |
| 5 | Repository: reads | module | Postgres |
| 6 | Repository: writes | module | Postgres |
| 7 | DTOs | module | compiler |
| 8 | Service: reads | module | unit test |
| 9 | Service: writes + audit | module | unit test |
| 10 | Controller + module wiring | module | HTTP / Swagger |
| 11 | e2e spec | test | HTTP + Postgres |
| 12 | Docs, full gate, PR | — | CI |

---

## Step 0 — Baseline

**Goal.** Prove the starting point is green, so any later failure is yours.

**Do.** Start Postgres and Redis, apply migrations, run the existing suite.

**Validate.**

```bash
npm run docker:up
npx prisma migrate status
npm run lint:ci && npm run typecheck && npm test && npm run test:e2e
```

`migrate status` must say the database schema is up to date; all suites pass.

---

## Step 1 — Prisma error mapping in the global filter

**Goal.** A database constraint violation becomes a correct HTTP error for
every module, instead of a 500.

**Why first.** Steps 6 and 9 rely on the unique constraint on `code` as the real
duplicate guard. That only works if the resulting `P2002` is rendered as 409.

**Do.** In `src/common/filters/global-exception.filter.ts`, add a branch before
the generic `Error` branch for `Prisma.PrismaClientKnownRequestError`:

| Code | Meaning | Response |
|---|---|---|
| `P2002` | unique constraint | 409 `CONFLICT`, message names the field from `meta.target` |
| `P2025` | record not found | 404 `NOT_FOUND` |
| `P2003` | foreign key constraint | 409 `CONFLICT` |
| other | — | falls through to the existing 500 path |

Never put the raw Prisma message in the response; it contains query detail.

**Concept.** The filter is the one place that knows about both HTTP and the
ORM's error shape. Services stay free of `try/catch` around every write.

**Validate.** Add cases to `global-exception.filter.spec.ts` (one per code, plus
an unknown code that still returns 500), then:

```bash
npx jest src/common/filters
npm run test:e2e
```

The existing e2e suite must still pass unchanged.

**Check yourself.** Why is "check if the email exists, then insert" not enough
on its own?

---

## Step 2 — Schema and migration

**Goal.** The `projects` table exists with its enums, indexes and constraint.

**Do.**

1. Add `ProjectStatus`, `ProjectPriority` and `model Project` to
   `prisma/schema.prisma` (plan §2), and `ownedProjects` on `User`.
2. Generate the migration without applying it:

   ```bash
   npx prisma migrate dev --create-only --name add_projects
   ```

3. Open the generated `migration.sql` and read all of it. Then add by hand:
   - at the top: `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
   - at the bottom: the `CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date)` constraint.
4. Apply it: `npx prisma migrate dev`.

**Concept.** Prisma generates SQL from a diff; it is a draft you review, not a
black box. Anything the schema language cannot express lives in the SQL file.

**Validate.**

```bash
npx prisma migrate status
npx prisma migrate dev
docker compose exec postgres psql -U <user> -d <db> -c "\d projects"
```

- The second `migrate dev` must report nothing to do. If it generates a new
  migration, the hand-written SQL and the schema disagree (drift) — fix before
  moving on.
- `\d projects` shows the unique index on `code`, the two `gin` indexes, the
  foreign key to `users` and the check constraint.
- Insert a row with `due_date` before `start_date` in `psql`: the database
  rejects it.

**Open risk to settle here.** Confirm `pg_trgm` can be created on the Render
Postgres instance before this migration reaches `main`.

---

## Step 3 — Permissions and seed data

**Goal.** The admin role can call the new routes, and there is data to list.

**Do.** In `prisma/seed.ts`, add `project:read|create|update|delete|restore` to
the permission catalogue and upsert a handful of sample projects (varied
status, priority and dates; one soft-deleted). Keep the seed idempotent —
upsert on `code`.

**Validate.**

```bash
npm run db:seed
npm run db:seed
```

Running it twice gives the same result. In Prisma Studio (`npm run
prisma:studio`): 16 permissions, all granted to admin; the sample projects
exist once each.

---

## Step 4 — Domain types

**Goal.** A vocabulary the service and repository share that contains no Prisma
query syntax.

**Do.** Create `src/modules/projects/projects.types.ts`:

- `ProjectFilter` — `search?`, `statuses?`, `priorities?`, `ownerId?`,
  `dueFrom?`, `dueTo?`, `deleted: 'exclude' | 'only'`
- `NewProject`, `ProjectChanges` — what the repository needs for a write
- `ProjectWithOwner` — the entity plus the owner summary the response needs
- `PROJECT_SORTABLE_FIELDS`

The generic `PageRequest` (`skip`, `take`, `sort`) and `Page<T>` (`items`,
`total`) go in `src/common/types/page.types.ts`, since every module reuses them.

**Concept.** This file is the boundary. The service speaks in these types; only
the repository translates them into `where` / `orderBy`.

**Validate.** `npm run typecheck`, and the file imports nothing from
`@prisma/client` except entity and enum types.

---

## Step 5 — Repository: reads

**Goal.** `findPage` and `findById` — the read half of the data layer.

**Do.** Create `projects.repository.ts` with:

- one private helper that builds the Prisma `where` from a `ProjectFilter`,
  including the soft-delete condition (the only place it is written);
- one shared `select`/`include` constant for the owner summary;
- `findPage(filter, page)` — `findMany` + `count` in a `$transaction`, so both
  see the same snapshot;
- `findById(id, { includeDeleted? })`.

**Concept.** `contains` + `mode: 'insensitive'` → `ILIKE '%term%'`; `OR` across
columns; `in` for multi-value enums; `gte`/`lte` for ranges; nested `select`.

**Validate.** Turn on query logging temporarily and call the methods from a
scratch script or the Nest REPL, then confirm the plan uses the trigram index:

```sql
EXPLAIN ANALYZE SELECT * FROM projects WHERE name ILIKE '%crm%';
```

On a tiny table Postgres may still choose a sequential scan — that is correct
behaviour, not a failure. `SET enable_seqscan = off;` in the session shows
whether the index is usable.

**Check yourself.** Why are `findMany` and `count` wrapped in one transaction?

---

## Step 6 — Repository: writes

**Goal.** `create`, versioned `update`, `softDelete`, `restore`.

**Do.**

- `create(data)` — plain insert; a duplicate `code` throws `P2002` (handled by
  Step 1).
- `update(id, version, data)` — `updateMany` with
  `where: { id, version, deletedAt: null }` and `version: { increment: 1 }`;
  returns the updated row or `null` when no row matched.
- `softDelete(id, actorId)` — stamps `deletedAt` and `deletedById`, only where
  `deletedAt` is null.
- `restore(id)` — clears both, only where `deletedAt` is not null.

**Concept.** Optimistic locking is a conditional write: the `WHERE` clause is
the lock. "Zero rows affected" is a result to interpret, not an error.

**Validate.** In a scratch script: update with the current version (succeeds,
version becomes 2), repeat with version 1 (returns `null`); soft-delete twice
(second affects no row); create the same `code` twice (throws `P2002`).

---

## Step 7 — DTOs

**Goal.** The HTTP contract: what the API accepts and returns.

**Do.** In `src/modules/projects/dto/`:

- `create-project.dto.ts` — `code` (regex `^[A-Z][A-Z0-9-]{1,19}$`), `name`,
  optional fields; ISO date strings; `budget` as a decimal string; `currency`
  as three uppercase letters.
- `update-project.dto.ts` — `PartialType(OmitType(Create, ['code']))` plus a
  required integer `version`.
- `project-query.dto.ts` — extends `PaginationQueryDto`; comma-separated
  `status` / `priority` transformed to arrays and validated against the enum.
- `project-response.dto.ts` — explicit allowlist with `static fromEntity()`;
  `budget` as string, date-only fields as `YYYY-MM-DD`.

**Concept.** Request DTOs validate shape; cross-field rules belong to the
service. The response DTO is an allowlist, so new columns never leak.

**Validate.** `npm run typecheck`. Confirm `deletedAt`, `deletedById` and the
other provenance columns are absent from the response DTO.

---

## Step 8 — Service: reads

**Goal.** `findAll` and `findOne`, with their unit tests.

**Do.** `projects.service.ts`: map the query DTO to `ProjectFilter` and
`PageRequest` (sort through `parseSort`), call the repository, map to response
DTOs, build the pagination meta. `findOne` throws `NotFoundException` when the
repository returns nothing. `deleted=only` is allowed only for callers holding
`project:restore`.

**Validate.** `projects.service.spec.ts` with a mocked repository: filter
mapping, sort fallback, unknown sort field → 400, not found → 404,
`deleted=only` without the permission → 403.

```bash
npx jest src/modules/projects
```

The service file must not import `Prisma` query types — grep for it.

---

## Step 9 — Service: writes, business rules, audit

**Goal.** `create`, `update`, `remove`, `restore` with every rule in plan §5.

**Do.** Implement, one rule at a time, each with its test:

1. `dueDate >= startDate` → 400
2. `budget` and `currency` together or not at all → 400
3. `ownerId` references a live user → 400; defaults to the caller
4. entering `COMPLETED` stamps `completedAt`; leaving it clears it
5. stale version → 409, unknown id → 404 (one follow-up read tells them apart)
6. `createdById` / `updatedById` / `deletedById` from the authenticated user
7. audit events `PROJECT_CREATED|UPDATED|DELETED|RESTORED` (add them to
   `AuditAction`), with changed field names on update

On update, rules 1 and 2 are checked against the **merged** state (stored
values + patch), not the patch alone.

**Validate.** One unit test per rule and per error branch; coverage gate still
passes:

```bash
npm run test:cov
```

**Check yourself.** A PATCH sends only `dueDate`. Which stored value must the
service read before it can validate the request?

---

## Step 10 — Controller and module wiring

**Goal.** The six routes are reachable and documented.

**Do.** `projects.controller.ts` (`@Permissions`, `ParseUUIDPipe`, Swagger
decorators, 201 / 204 status codes, `restore` as `POST :id/restore`),
`projects.module.ts`, and register it in `AppModule`.

**Validate.** Start the app, log in as admin, and exercise every route from
Swagger (`/api/docs`):

- create → 201; same `code` again → 409
- list with `search`, `status=ACTIVE,ON_HOLD`, `sort=-dueDate`
- patch with the right version → 200; replay the same request → 409
- delete → 204; get → 404; list with `deleted=only` shows it; restore → 200
- no token → 401; a user without `project:*` → 403

Check the audit log has one row per write.

---

## Step 11 — e2e spec

**Goal.** Everything checked by hand in Step 10 is now automated.

**Do.** `test/projects.e2e-spec.ts`, following `test/users.e2e-spec.ts`. Cover
the blueprint §7 list: 401, 403, 400, 404, 409 (duplicate and stale version),
pagination, sort whitelist, search, each filter, soft delete, restore.

**Validate.**

```bash
npm run test:e2e
```

Run it twice in a row — a spec that only passes on a clean database is not done.

---

## Step 12 — Docs, full gate, PR

**Do.** README status row and endpoint table;
`docs/TESTING-PHASE-15-PROJECTS.md`; then the full gate and the PR from
`feat/projects-module`.

**Validate.**

```bash
npm run lint:ci && npm run typecheck && npm run test:cov && npm run test:e2e && npm run build
```

CI green on the PR. Merge only after `pg_trgm` is confirmed on Render (Step 2).
