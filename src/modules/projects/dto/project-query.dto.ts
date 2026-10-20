import { ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectPriority, ProjectStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsEnum,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { DATE_ONLY_PATTERN } from '../../../common/utils/date.util';
import { DeletedScope, PROJECT_SORTABLE_FIELDS } from '../projects.types';

/** `a,b` or repeated `?x=a&x=b` → `['a', 'b']`. */
const toList = ({ value }: { value: unknown }): unknown => {
  const parts: unknown[] = Array.isArray(value) ? value : [value];
  return parts
    .flatMap((part) => (typeof part === 'string' ? part.split(',') : [part]))
    .map((part) => (typeof part === 'string' ? part.trim() : part))
    .filter((part) => part !== '');
};

export class ProjectQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Case-insensitive search across code, name and description',
    example: 'crm',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    enum: ProjectStatus,
    enumName: 'ProjectStatus',
    isArray: true,
    description: 'One or more statuses, comma-separated',
    example: 'ACTIVE,ON_HOLD',
  })
  @IsOptional()
  @Transform(toList)
  @ArrayMaxSize(Object.keys(ProjectStatus).length)
  @IsEnum(ProjectStatus, { each: true })
  status?: ProjectStatus[];

  @ApiPropertyOptional({
    enum: ProjectPriority,
    enumName: 'ProjectPriority',
    isArray: true,
    description: 'One or more priorities, comma-separated',
    example: 'HIGH,CRITICAL',
  })
  @IsOptional()
  @Transform(toList)
  @ArrayMaxSize(Object.keys(ProjectPriority).length)
  @IsEnum(ProjectPriority, { each: true })
  priority?: ProjectPriority[];

  @ApiPropertyOptional({ format: 'uuid', description: 'Filter by owner' })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({
    example: '2026-12-01',
    format: 'date',
    description: 'Due on or after this date',
  })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'dueFrom must be YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'dueFrom must be a real date' })
  dueFrom?: string;

  @ApiPropertyOptional({
    example: '2027-03-01',
    format: 'date',
    description: 'Due on or before this date',
  })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'dueTo must be YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'dueTo must be a real date' })
  dueTo?: string;

  @ApiPropertyOptional({
    enum: ['exclude', 'only'],
    default: 'exclude',
    description:
      '`only` lists soft-deleted projects and requires the project:restore permission',
  })
  @IsOptional()
  @IsIn(['exclude', 'only'])
  deleted: DeletedScope = 'exclude';

  @ApiPropertyOptional({
    description: `Comma-separated sort fields, "-" prefix for descending. Allowed: ${PROJECT_SORTABLE_FIELDS.join(', ')}`,
    example: '-dueDate,name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sort?: string;
}
