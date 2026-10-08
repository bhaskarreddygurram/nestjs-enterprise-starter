import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectPriority, ProjectStatus } from '@prisma/client';
import { formatDateOnly } from '../../../common/utils/date.util';
import { ProjectWithOwner } from '../projects.types';

export class ProjectOwnerDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ example: 'Jane', nullable: true })
  firstName!: string | null;

  @ApiPropertyOptional({ example: 'Doe', nullable: true })
  lastName!: string | null;
}

/**
 * Public representation of a project. The mapping is an explicit allowlist, so
 * a column added to the model later never leaks by default — the provenance
 * ids and `deletedAt` simply do not exist here.
 */
export class ProjectResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'CRM-2026' })
  code!: string;

  @ApiProperty({ example: 'CRM Migration' })
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;

  @ApiProperty({ enum: ProjectStatus, enumName: 'ProjectStatus' })
  status!: ProjectStatus;

  @ApiProperty({ enum: ProjectPriority, enumName: 'ProjectPriority' })
  priority!: ProjectPriority;

  @ApiPropertyOptional({
    example: '2026-09-01',
    format: 'date',
    nullable: true,
  })
  startDate!: string | null;

  @ApiPropertyOptional({
    example: '2026-12-15',
    format: 'date',
    nullable: true,
  })
  dueDate!: string | null;

  @ApiPropertyOptional({ nullable: true })
  completedAt!: Date | null;

  @ApiPropertyOptional({
    example: '48000.00',
    nullable: true,
    description: 'Decimal as a string, always 2 decimals',
  })
  budget!: string | null;

  @ApiPropertyOptional({ example: 'EUR', nullable: true })
  currency!: string | null;

  @ApiProperty({ type: ProjectOwnerDto })
  owner!: ProjectOwnerDto;

  @ApiProperty({
    example: 1,
    description: 'Send this back on PATCH (optimistic locking)',
  })
  version!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  static fromEntity(project: ProjectWithOwner): ProjectResponseDto {
    const dto = new ProjectResponseDto();
    dto.id = project.id;
    dto.code = project.code;
    dto.name = project.name;
    dto.description = project.description;
    dto.status = project.status;
    dto.priority = project.priority;
    dto.startDate = project.startDate
      ? formatDateOnly(project.startDate)
      : null;
    dto.dueDate = project.dueDate ? formatDateOnly(project.dueDate) : null;
    dto.completedAt = project.completedAt;
    // Decimal → fixed 2 decimals: `toString()` would turn 10.50 into "10.5"
    dto.budget = project.budget ? project.budget.toFixed(2) : null;
    dto.currency = project.currency;
    dto.owner = {
      id: project.owner.id,
      firstName: project.owner.firstName,
      lastName: project.owner.lastName,
    };
    dto.version = project.version;
    dto.createdAt = project.createdAt;
    dto.updatedAt = project.updatedAt;
    return dto;
  }
}
