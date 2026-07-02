import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Query params for a security-insights request: how far back to look and how
 * many events to feed the model (bounded to keep latency and token cost sane).
 */
export class SecurityInsightsQueryDto {
  @ApiPropertyOptional({
    description: 'Look-back window in hours',
    minimum: 1,
    maximum: 168,
    default: 24,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  hours: number = 24;

  @ApiPropertyOptional({
    description: 'Maximum number of audit events to analyse',
    minimum: 1,
    maximum: 200,
    default: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 100;
}
