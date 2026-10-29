import { Project, ProjectPriority, ProjectStatus, User } from '@prisma/client';

/**
 * The Projects module's domain vocabulary. The service and the repository
 * share these types; none of them is Prisma query syntax. Only entity and enum
 * types are imported from the client — never `Prisma.*` inputs.
 */

/** Fields clients may sort projects by (whitelist — see `parseSort`). */
export const PROJECT_SORTABLE_FIELDS = [
  'createdAt',
  'updatedAt',
  'name',
  'code',
  'status',
  'priority',
  'startDate',
  'dueDate',
] as const satisfies readonly (keyof Project)[];

export type ProjectSortField = (typeof PROJECT_SORTABLE_FIELDS)[number];

/** Which rows a list query sees with respect to soft deletion. */
export type DeletedScope = 'exclude' | 'only';

/** What a caller may narrow a project list by. All conditions are ANDed. */
export interface ProjectFilter {
  /** Free text, matched case-insensitively against code, name, description. */
  search?: string;
  statuses?: ProjectStatus[];
  priorities?: ProjectPriority[];
  ownerId?: string;
  /** Inclusive bounds on `dueDate`. */
  dueFrom?: Date;
  dueTo?: Date;
  deleted: DeletedScope;
}

/** The owner fields a project response exposes. */
export type ProjectOwnerSummary = Pick<User, 'id' | 'firstName' | 'lastName'>;

/** A project as the repository returns it: the row plus its owner summary. */
export type ProjectWithOwner = Project & { owner: ProjectOwnerSummary };

/** Fields that can change after creation. `code` is deliberately absent. */
interface ProjectMutableFields {
  name: string;
  description: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  startDate: Date | null;
  dueDate: Date | null;
  /** Set by the service from status transitions, never by a client. */
  completedAt: Date | null;
  /** Decimal as a string, e.g. "48000.00" — never a JS number. */
  budget: string | null;
  currency: string | null;
  ownerId: string;
}

/** Everything the repository needs to insert a project. */
export type NewProject = Pick<ProjectMutableFields, 'name' | 'ownerId'> &
  Partial<Omit<ProjectMutableFields, 'name' | 'ownerId'>> & {
    code: string;
    createdById: string;
  };

/** A partial change to an existing project, stamped with who made it. */
export type ProjectChanges = Partial<ProjectMutableFields> & {
  updatedById: string;
};
