import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PaginatedDto } from '../../common/dto/page-meta.dto';
import { AuthenticatedUser } from '../auth/authenticated-user.interface';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectQueryDto } from './dto/project-query.dto';
import { ProjectResponseDto } from './dto/project-response.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';

/**
 * HTTP surface for projects: routing, status codes, permissions and Swagger.
 * No business rules live here — every handler is a single service call.
 *
 * All routes require a valid JWT (global JwtAuthGuard) and a `project:*`
 * permission (global AuthorizationGuard).
 */
@ApiTags('Projects')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @Permissions('project:create')
  @ApiOperation({ summary: 'Create a project' })
  @ApiCreatedResponse({ type: ProjectResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation failed, or a business rule was broken',
  })
  @ApiConflictResponse({ description: 'A project with this code exists' })
  @ApiForbiddenResponse({ description: 'Missing project:create permission' })
  create(
    @Body() dto: CreateProjectDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ProjectResponseDto> {
    return this.projectsService.create(dto, actor);
  }

  @Get()
  @Permissions('project:read')
  @ApiOperation({
    summary: 'List projects (paginated, searchable, filterable, sortable)',
  })
  @ApiOkResponse({ description: 'Paginated list of projects' })
  @ApiBadRequestResponse({ description: 'Invalid filter, sort or paging' })
  @ApiForbiddenResponse({
    description:
      'Missing project:read permission, or project:restore for deleted=only',
  })
  findAll(
    @Query() query: ProjectQueryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PaginatedDto<ProjectResponseDto>> {
    return this.projectsService.findAll(query, actor);
  }

  @Get(':id')
  @Permissions('project:read')
  @ApiOperation({ summary: 'Get a project by id' })
  @ApiOkResponse({ type: ProjectResponseDto })
  @ApiNotFoundResponse({ description: 'Project not found' })
  @ApiForbiddenResponse({ description: 'Missing project:read permission' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ProjectResponseDto> {
    return this.projectsService.findOne(id);
  }

  @Patch(':id')
  @Permissions('project:update')
  @ApiOperation({
    summary: 'Update a project (send the version you last read)',
  })
  @ApiOkResponse({ type: ProjectResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation failed, or a business rule was broken',
  })
  @ApiNotFoundResponse({ description: 'Project not found' })
  @ApiConflictResponse({
    description: 'Stale version: the project changed since it was read',
  })
  @ApiForbiddenResponse({ description: 'Missing project:update permission' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ProjectResponseDto> {
    return this.projectsService.update(id, dto, actor);
  }

  @Delete(':id')
  @Permissions('project:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a project' })
  @ApiNoContentResponse({ description: 'Project soft-deleted' })
  @ApiNotFoundResponse({ description: 'Project not found' })
  @ApiForbiddenResponse({ description: 'Missing project:delete permission' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    return this.projectsService.remove(id, actor);
  }

  @Post(':id/restore')
  @Permissions('project:restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore a soft-deleted project' })
  @ApiOkResponse({ type: ProjectResponseDto })
  @ApiNotFoundResponse({ description: 'No deleted project with this id' })
  @ApiForbiddenResponse({ description: 'Missing project:restore permission' })
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ProjectResponseDto> {
    return this.projectsService.restore(id, actor);
  }
}
