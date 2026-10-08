import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { CreateProjectDto } from './create-project.dto';

/**
 * Every create field except `code` (immutable), all optional, plus the
 * `version` the client last read.
 *
 * `skipNullProperties: false` makes "optional" mean "may be omitted" only:
 * a `null` is still validated, so it clears a nullable field (those carry
 * their own `@IsOptional()`) and is rejected on `name`, `status`, `priority`
 * and `ownerId`.
 */
export class UpdateProjectDto extends PartialType(
  OmitType(CreateProjectDto, ['code'] as const),
  { skipNullProperties: false },
) {
  @ApiProperty({
    example: 1,
    description:
      'The version this change is based on. A mismatch returns 409 — re-read the project and retry.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}
