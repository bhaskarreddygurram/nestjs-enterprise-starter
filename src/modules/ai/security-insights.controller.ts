import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { SecurityInsightsQueryDto } from './dto/security-insights-query.dto';
import { SecurityInsightsResponseDto } from './dto/security-insights-response.dto';
import { SecurityInsightsService } from './security-insights.service';

@ApiTags('AI')
@ApiBearerAuth()
@Controller('ai/security-insights')
export class SecurityInsightsController {
  constructor(
    private readonly securityInsightsService: SecurityInsightsService,
  ) {}

  @Get()
  @Permissions('ai:read')
  // Expensive (billed) LLM call — cap harder than the global limit.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'AI-generated security insights over the recent audit log',
    description:
      'Feeds a bounded window of recent audit events to Claude and returns a ' +
      'structured risk assessment. Requires AI_ENABLED=true and an API key; ' +
      'otherwise responds 503.',
  })
  @ApiOkResponse({ type: SecurityInsightsResponseDto })
  @ApiForbiddenResponse({ description: 'Missing ai:read permission' })
  @ApiServiceUnavailableResponse({
    description: 'AI features are disabled or the provider is unavailable',
  })
  getInsights(
    @Query() query: SecurityInsightsQueryDto,
  ): Promise<SecurityInsightsResponseDto> {
    return this.securityInsightsService.getInsights(query);
  }
}
