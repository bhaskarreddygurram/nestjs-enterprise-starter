import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Page, PageRequest } from '../../common/types/page.types';
import { PrismaService } from '../../core/database/prisma.service';
import {
  DeletedScope,
  NewProject,
  ProjectChanges,
  ProjectFilter,
  ProjectSortField,
  ProjectWithOwner,
} from './projects.types';

/** The owner fields every project read returns — nothing else leaves the DB. */
const WITH_OWNER = {
  owner: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ProjectInclude;

/** Sortable columns that can be NULL; without a rule Postgres puts NULLs first on DESC. */
const NULLABLE_SORT_FIELDS: ReadonlySet<ProjectSortField> = new Set([
  'startDate',
  'dueDate',
]);

/**
 * Data-access layer for projects — the ONLY place in the module that touches
 * Prisma. It receives domain types (`ProjectFilter`, `PageRequest`) and is
 * solely responsible for turning them into query syntax.
 *
 * Soft-delete convention: the `deletedAt` condition is written once, in
 * `deletedScope`, and every read goes through it.
 *
 * Write convention: a write that depends on the row's current state puts that
 * state in its `where`, so the check and the change are one atomic statement.
 * "No row matched" is returned as `null`, never thrown — the service decides
 * what it means. Every state change increments `version`.
 */
@Injectable()
export class ProjectsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One page of projects plus the total matching the filter. Both queries run
   * in a single transaction so `total` and `items` describe the same snapshot.
   */
  async findPage(
    filter: ProjectFilter,
    page: PageRequest<ProjectSortField>,
  ): Promise<Page<ProjectWithOwner>> {
    const where = this.toWhere(filter);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        include: WITH_OWNER,
        orderBy: this.toOrderBy(page.sort),
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.project.count({ where }),
    ]);
    return { items, total };
  }

  findById(
    id: string,
    deleted: DeletedScope = 'exclude',
  ): Promise<ProjectWithOwner | null> {
    return this.prisma.project.findFirst({
      where: { id, ...this.deletedScope(deleted) },
      include: WITH_OWNER,
    });
  }

  /** A duplicate `code` surfaces as Prisma P2002, mapped to 409 by the filter. */
  create(data: NewProject): Promise<ProjectWithOwner> {
    return this.prisma.project.create({ data, include: WITH_OWNER });
  }

  /**
   * Optimistic-locking update: applies only if the row is live and still at
   * `expectedVersion`. Returns `null` when nothing matched (missing, deleted,
   * or changed by someone else since it was read).
   */
  update(
    id: string,
    expectedVersion: number,
    changes: ProjectChanges,
  ): Promise<ProjectWithOwner | null> {
    return this.writeIfMatched(
      { id, version: expectedVersion, ...this.deletedScope('exclude') },
      changes,
    );
  }

  /** Stamps a live row as deleted. `null` if it is missing or already deleted. */
  softDelete(id: string, actorId: string): Promise<ProjectWithOwner | null> {
    return this.writeIfMatched(
      { id, ...this.deletedScope('exclude') },
      { deletedAt: new Date(), deletedById: actorId },
    );
  }

  /** Brings a deleted row back. `null` if it is missing or not deleted. */
  restore(id: string, actorId: string): Promise<ProjectWithOwner | null> {
    return this.writeIfMatched(
      { id, ...this.deletedScope('only') },
      { deletedAt: null, deletedById: null, updatedById: actorId },
    );
  }

  /**
   * One conditional UPDATE: the extra `where` fields ride along with the
   * unique `id`, so the guard and the write cannot be separated by another
   * request. Prisma reports "no row matched" as P2025, translated to `null`.
   */
  private async writeIfMatched(
    where: Prisma.ProjectWhereUniqueInput,
    data: Prisma.ProjectUncheckedUpdateInput,
  ): Promise<ProjectWithOwner | null> {
    try {
      return await this.prisma.project.update({
        where,
        data: { ...data, version: { increment: 1 } },
        include: WITH_OWNER,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        return null;
      }
      throw error;
    }
  }

  /** The single definition of what "deleted" means for a query. */
  private deletedScope(
    deleted: DeletedScope,
  ): Pick<Prisma.ProjectWhereInput, 'deletedAt'> {
    return deleted === 'only'
      ? { deletedAt: { not: null } }
      : { deletedAt: null };
  }

  /**
   * Rows without a value sort last in either direction, and `id` breaks ties
   * so rows never repeat or vanish between pages.
   */
  private toOrderBy(
    sort: PageRequest<ProjectSortField>['sort'],
  ): Prisma.ProjectOrderByWithRelationInput[] {
    const orderBy = sort.flatMap((criteria) =>
      (Object.entries(criteria) as [ProjectSortField, Prisma.SortOrder][]).map(
        ([field, order]): Prisma.ProjectOrderByWithRelationInput =>
          NULLABLE_SORT_FIELDS.has(field)
            ? { [field]: { sort: order, nulls: 'last' } }
            : { [field]: order },
      ),
    );
    return [...orderBy, { id: 'asc' }];
  }

  /** Translates the domain filter into a Prisma `where`. Conditions are ANDed. */
  private toWhere(filter: ProjectFilter): Prisma.ProjectWhereInput {
    const where: Prisma.ProjectWhereInput = this.deletedScope(filter.deleted);

    if (filter.search) {
      // ILIKE '%term%' on each column; name/description use the trigram indexes
      const contains = {
        contains: filter.search,
        mode: 'insensitive',
      } as const;
      where.OR = [
        { code: contains },
        { name: contains },
        { description: contains },
      ];
    }
    if (filter.statuses?.length) {
      where.status = { in: filter.statuses };
    }
    if (filter.priorities?.length) {
      where.priority = { in: filter.priorities };
    }
    if (filter.ownerId) {
      where.ownerId = filter.ownerId;
    }
    if (filter.dueFrom || filter.dueTo) {
      where.dueDate = { gte: filter.dueFrom, lte: filter.dueTo };
    }
    return where;
  }
}
