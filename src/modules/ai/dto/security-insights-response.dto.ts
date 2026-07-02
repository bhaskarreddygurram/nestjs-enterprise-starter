import { ApiProperty } from '@nestjs/swagger';
import { FindingSeverity, RiskLevel, SecurityFinding } from '../ai.interface';

class SecurityFindingDto implements SecurityFinding {
  @ApiProperty({ example: 'Repeated failed logins for one account' })
  title!: string;

  @ApiProperty({
    enum: ['info', 'low', 'medium', 'high', 'critical'],
    example: 'high',
  })
  severity!: FindingSeverity;

  @ApiProperty({
    example:
      '5 failed logins for admin@example.com from 3 IPs within 2 minutes, followed by a lockout.',
  })
  description!: string;

  @ApiProperty({
    example:
      'Confirm with the account owner and consider forcing a password reset.',
  })
  recommendation!: string;

  @ApiProperty({
    type: [String],
    example: ['auth.login.failed', 'auth.account.locked'],
  })
  relatedActions!: string[];
}

class TokenUsageDto {
  @ApiProperty({ example: 1240 })
  inputTokens!: number;

  @ApiProperty({ example: 320 })
  outputTokens!: number;
}

/**
 * Envelope returned by GET /ai/security-insights: run metadata + the model's
 * structured verdict. `usage` is null when no model call was made (e.g. the
 * window contained no events).
 */
export class SecurityInsightsResponseDto {
  @ApiProperty({
    description: 'Whether AI analysis actually ran',
    example: true,
  })
  analyzed!: boolean;

  @ApiProperty({ example: '2026-07-02T10:15:00.000Z' })
  generatedAt!: string;

  @ApiProperty({
    description: 'Look-back window analysed, in hours',
    example: 24,
  })
  windowHours!: number;

  @ApiProperty({ description: 'Number of audit events analysed', example: 37 })
  eventCount!: number;

  @ApiProperty({ nullable: true, example: 'claude-opus-4-8' })
  model!: string | null;

  @ApiProperty({
    example: 'medium',
    enum: ['low', 'medium', 'high', 'critical'],
  })
  riskLevel!: RiskLevel;

  @ApiProperty({
    example:
      'Activity is mostly routine authentication traffic. One account shows a burst of failed logins worth reviewing.',
  })
  summary!: string;

  @ApiProperty({ type: [SecurityFindingDto] })
  findings!: SecurityFindingDto[];

  @ApiProperty({ type: TokenUsageDto, nullable: true })
  usage!: TokenUsageDto | null;
}
