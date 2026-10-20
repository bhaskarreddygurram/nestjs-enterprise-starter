import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { ProjectsController } from './projects.controller';
import { ProjectsRepository } from './projects.repository';
import { ProjectsService } from './projects.service';

/**
 * Projects feature module, built to docs/CRUD-MODULE-BLUEPRINT.md:
 * controller (HTTP) → service (business rules) → repository (data access).
 *
 * Imports UsersModule to validate project owners through UsersService.
 * PrismaService and AuditEmitter come from global modules.
 */
@Module({
  imports: [UsersModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectsRepository],
  exports: [ProjectsService],
})
export class ProjectsModule {}
