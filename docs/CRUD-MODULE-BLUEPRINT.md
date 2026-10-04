# CRUD Module Blueprint

The standard every entity module in this codebase follows. It is entity-agnostic:
to add a new model (Tasks, Clients, Invoices, ...), copy this blueprint and fill
in the entity-specific parts. The first module built against it is Projects — see
[`PLAN-PROJECTS-MODULE.md`](PLAN-PROJECTS-MODULE.md) for a worked example.

It extends the conventions already used by the Users module and fixes three
weaknesses in them (marked **Changed** below).

---

## 1. Layers and what each one may know

```
HTTP ──► Controller ──► Service ──► Repository ──► Prisma ──► PostgreSQL
          DTOs           domain        the only
          Swagger        rules         Prisma importer
          permissions    audit
```

| Layer | Owns | Must not |
|---|---|---|
| **Controller** | Route, HTTP status, `@Permissions()`, Swagger, DTO binding | Contain business rules or touch the repository |
| **Service** | Business rules, cross-field validation, audit events, entity → response mapping | Import `Prisma` query types or build `where` clauses |
| **Repository** | Every Prisma call, the soft-delete filter, translating a domain filter into a query | Throw HTTP exceptions or know about DTOs |

**Changed — keep the ORM out of the service.** `UsersService` builds a
`Prisma.UserWhereInput` itself, so query syntax leaks upward. New modules pass a
plain domain filter object (`ProjectFilter`) to the repository, and the
repository alone turns it into a Prisma `where`. The service may still use the
generated entity type (`Project`) — it is a plain data type, not query syntax.

**Deliberately not done:** repository interfaces behind DI tokens, separate
domain-entity classes with mappers, CQRS, or a generic `BaseRepository<T>`.
There is one database and one implementation, so an interface is indirection
with no second consumer; and Prisma's per-model delegate types do not generalise
cleanly, so a generic base class ends up fighting the type system. The DI-token
pattern stays reserved for genuinely swappable infrastructure (mail, storage, AI).

---

## 2. File layout

```
src/modules/<entity>/
  <entity>.module.ts
  <entity>.controller.ts
  <entity>.service.ts
  <entity>.service.spec.ts
  <entity>.repository.ts
  <entity>.types.ts            domain filter + page types (no Prisma imports)
  dto/
    create-<entity>.dto.ts
    update-<entity>.dto.ts     PartialType of create, minus immutable fields
    <entity>-query.dto.ts      extends PaginationQueryDto
    <entity>-response.dto.ts   explicit allowlist + static fromEntity()
test/<entity>.e2e-spec.ts
docs/TESTING-PHASE-<n>-<ENTITY>.md
```

---

## 3. Schema conventions

- `id` — `String @id @default(uuid()) @db.Uuid`.
- camelCase fields, snake_case columns via `@map`; table name plural via `@@map`.
- Size every string: `@db.VarChar(n)` for bounded text, `@db.Text` for free text.
- Date-only values use `@db.Date`; instants use plain `DateTime`.
- Money is `Decimal @db.Decimal(p, s)` plus an ISO-4217 currency column. Never `Float`.
- Closed value sets (status, priority) are native Prisma `enum`s: the database
  enforces them and the generated TypeScript union is used end to end. The cost
  is a migration to add a value — accept it for sets that change rarely; use a
  validated `String` for sets that change often.
- Standard columns on every business entity:
  `createdAt`, `updatedAt`, `deletedAt`, `createdById`, `updatedById`,
  `deletedById`, `version`.
- `createdById` / `updatedById` / `deletedById` are plain UUID columns with no
  foreign key — provenance that must survive the actor's removal, the same
  reasoning as `audit_logs`. Real domain relationships (an owner, a parent) get
  a proper relation with an explicit `onDelete`.
- Index every foreign key, every column used as a list filter, and the default
  sort column.

### Soft delete

- Reads exclude `deletedAt != null`. The filter lives in **one** private helper
  in the repository, not repeated per method.
- `DELETE` stamps `deletedAt` and `deletedById`; a second `DELETE` returns 404.
- A `restore` endpoint is the counterpart.
- Unique business keys stay reserved after deletion (a plain `@unique`), so a
  deleted record's key is never silently reissued. If a key must be reusable,
  that needs a partial unique index written by hand in the migration SQL —
  decide it per entity, not by default.

---

## 4. API contract

| Operation | Route | Permission | Success | Errors |
|---|---|---|---|---|
| List + search + filter | `GET /<entities>` | `<entity>:read` | 200 paginated | 400 |
| Get one | `GET /<entities>/:id` | `<entity>:read` | 200 | 404 |
| Create | `POST /<entities>` | `<entity>:create` | 201 | 400, 409 |
| Update | `PATCH /<entities>/:id` | `<entity>:update` | 200 | 400, 404, 409 |
| Soft delete | `DELETE /<entities>/:id` | `<entity>:delete` | 204 | 404 |
| Restore | `POST /<entities>/:id/restore` | `<entity>:restore` | 200 | 404 |

- `:id` is always bound with `ParseUUIDPipe`.
- Lists take `page`, `limit` (max 100), `sort` (whitelisted through `parseSort`),
  `search`, and typed filters. Search is a parameter of the list route, not a
  separate endpoint, so there is one query pipeline to secure, test and index.
- `search` covers the entity's **text** columns. Enum, date, number and
  foreign-key columns get typed filters (`status=`, `dueFrom=`, `ownerId=`):
  substring-matching them is meaningless and cannot use an index.
- Responses go through an explicit-allowlist response DTO. `Decimal` is
  serialised as a string; date-only fields as `YYYY-MM-DD`.

---

## 5. ORM practices (Prisma)

1. **Let the database enforce uniqueness; map the error.** **Changed** — the
   Users module checks "does this email exist?" and then inserts, which two
   concurrent requests can both pass. The constraint is the real guard. The
   global exception filter maps Prisma errors once for every module:
   `P2002` → 409, `P2025` → 404, `P2003` → 409. A pre-check may stay for a
   friendlier message but is never the only protection.
2. **Optimistic concurrency.** `PATCH` carries the `version` the client last
   read. The repository updates `where: { id, version, deletedAt: null }` and
   increments `version`; no row matched means either 404 or a stale version
   (409), which the service distinguishes with one follow-up read.
3. **Page queries live in the repository.** **Changed** — `findPage(filter,
   page)` returns `{ items, total }`, so the service no longer orchestrates two
   queries.
4. **Select deliberately.** Use `select`/`include` for the relations the
   response needs; never return a relation the DTO does not expose.
5. **Transactions.** A write that touches more than one row or table uses
   `prisma.$transaction`. Audit events stay outside it — they are
   fire-and-forget by design.
6. **Migrations.** `prisma migrate dev --create-only`, read the SQL, then apply.
   Anything Prisma cannot express (extensions, CHECK constraints) is added to
   that migration file by hand. Never edit an applied migration.
7. **Search performance.** `contains` + `mode: 'insensitive'` compiles to
   `ILIKE '%term%'`, which a B-tree index cannot serve. Text columns that are
   searched get a `pg_trgm` GIN index, declared in the schema.

---

## 6. Cross-cutting, per module

- **Permissions** — add `<entity>:read|create|update|delete|restore` to the seed
  catalogue (admin receives them automatically).
- **Audit** — add `<ENTITY>_CREATED|UPDATED|DELETED|RESTORED` to `AuditAction`;
  emit from the service with `metadata: { fields: [...] }` on update.
- **Swagger** — `@ApiTags`, `@ApiBearerAuth`, a typed response and the error
  responses on every route.
- **Validation** — class-validator on DTOs; cross-field rules in the service.

---

## 7. Definition of done

- [ ] Migration created with `--create-only`, SQL reviewed, applied, seed updated
- [ ] Unit spec: every service rule, including the 404 / 409 branches
- [ ] e2e spec: 401, 403, 400, 404, 409, pagination, sort whitelist, search,
      each filter, soft delete, restore, stale-version update
- [ ] `lint:ci`, `typecheck`, `test:cov` (coverage gate), `test:e2e`, `build` all pass
- [ ] README endpoint table + status row, testing guide in `docs/`
- [ ] Feature branch → PR → merge (never commit to `main` directly)
