import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PageMetaDto, PaginatedDto } from '../../common/dto/page-meta.dto';
import { PageRequest } from '../../common/types/page.types';
import { parseDateOnly } from '../../common/utils/date.util';
import { parseSort } from '../../common/utils/sort.util';
import { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { ProjectQueryDto } from './dto/project-query.dto';
import { ProjectResponseDto } from './dto/project-response.dto';
import { ProjectsRepository } from './projects.repository';
import {
  PROJECT_SORTABLE_FIELDS,
  ProjectFilter,
  ProjectSortField,
} from './projects.types';

/** Listing soft-deleted projects is part of the restore workflow. */
const RESTORE_PERMISSION = 'project:restore';

/**
 * Business rules for projects. Speaks in DTOs and domain types only — every
 * query is the repository's job, so nothing here imports Prisma query syntax.
 */
@Injectable()
export class ProjectsService {
  constructor(private readonly projectsRepository: ProjectsRepository) {}

  async findAll(
    query: ProjectQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PaginatedDto<ProjectResponseDto>> {
    if (
      query.deleted === 'only' &&
      !actor.permissions.includes(RESTORE_PERMISSION)
    ) {
      throw new ForbiddenException(
        `Listing deleted projects requires permission: ${RESTORE_PERMISSION}`,
      );
    }

    const { items, total } = await this.projectsRepository.findPage(
      this.toFilter(query),
      this.toPageRequest(query),
    );

    return new PaginatedDto(
      items.map((project) => ProjectResponseDto.fromEntity(project)),
      new PageMetaDto(query.page, query.limit, total),
    );
  }

  async findOne(id: string): Promise<ProjectResponseDto> {
    const project = await this.projectsRepository.findById(id);
    if (!project) {
      throw new NotFoundException(`Project with id "${id}" not found`);
    }
    return ProjectResponseDto.fromEntity(project);
  }

  /** Query DTO (strings, as sent over HTTP) → domain filter (typed values). */
  private toFilter(query: ProjectQueryDto): ProjectFilter {
    const dueFrom = query.dueFrom ? parseDateOnly(query.dueFrom) : undefined;
    const dueTo = query.dueTo ? parseDateOnly(query.dueTo) : undefined;
    if (dueFrom && dueTo && dueFrom > dueTo) {
      throw new BadRequestException('dueFrom must not be after dueTo');
    }

    return {
      search: query.search || undefined,
      statuses: query.status,
      priorities: query.priority,
      ownerId: query.ownerId,
      dueFrom,
      dueTo,
      deleted: query.deleted,
    };
  }

  private toPageRequest(query: ProjectQueryDto): PageRequest<ProjectSortField> {
    return {
      skip: query.skip,
      take: query.limit,
      // parseSort rejects anything outside the whitelist, so the keys are
      // guaranteed to be ProjectSortField
      sort: parseSort(query.sort, PROJECT_SORTABLE_FIELDS),
    };
  }
}
