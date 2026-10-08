import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectPriority, ProjectStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { DATE_ONLY_PATTERN } from '../../../common/utils/date.util';
import { IsOptionalNotNull } from '../../../common/validators/is-optional-not-null.validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Two kinds of optional field, on purpose:
 * - `@IsOptional()` — nullable columns. `null` is accepted and means "no value".
 * - `@IsOptionalNotNull()` — NOT NULL columns with a default. May be omitted,
 *   but an explicit `null` is a 400.
 *
 * Cross-field rules (date order, budget + currency) live in the service.
 */
export class CreateProjectDto {
  @ApiProperty({
    example: 'CRM-2026',
    description:
      'Permanent business key: 2-20 chars, uppercase letters, digits and "-", starting with a letter. Cannot be changed later.',
  })
  @IsString()
  @Matches(/^[A-Z][A-Z0-9-]{1,19}$/, {
    message:
      'code must be 2-20 characters: uppercase letters, digits or "-", starting with a letter',
  })
  code!: string;

  @ApiProperty({ example: 'CRM Migration', maxLength: 150 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @ApiPropertyOptional({
    example: 'Move customer records to the new platform.',
    nullable: true,
    maxLength: 5000,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @ApiPropertyOptional({
    enum: ProjectStatus,
    enumName: 'ProjectStatus',
    default: ProjectStatus.PLANNING,
  })
  @IsOptionalNotNull()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiPropertyOptional({
    enum: ProjectPriority,
    enumName: 'ProjectPriority',
    default: ProjectPriority.MEDIUM,
  })
  @IsOptionalNotNull()
  @IsEnum(ProjectPriority)
  priority?: ProjectPriority;

  @ApiPropertyOptional({
    example: '2026-09-01',
    format: 'date',
    nullable: true,
  })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'startDate must be YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'startDate must be a real date' })
  startDate?: string | null;

  @ApiPropertyOptional({
    example: '2026-12-15',
    format: 'date',
    nullable: true,
  })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'dueDate must be YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'dueDate must be a real date' })
  dueDate?: string | null;

  @ApiPropertyOptional({
    example: '48000.00',
    nullable: true,
    description:
      'Decimal as a string: up to 12 integer digits and 2 decimals. Requires `currency`.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,12}(\.\d{1,2})?$/, {
    message:
      'budget must be a non-negative decimal string with at most 2 decimals, e.g. "48000.00"',
  })
  budget?: string | null;

  @ApiPropertyOptional({
    example: 'EUR',
    nullable: true,
    description: 'ISO 4217 code. Requires `budget`.',
  })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, {
    message: 'currency must be a 3-letter uppercase ISO 4217 code',
  })
  currency?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Defaults to the authenticated user.',
  })
  @IsOptionalNotNull()
  @IsUUID()
  ownerId?: string;
}
