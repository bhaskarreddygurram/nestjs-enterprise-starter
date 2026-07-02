import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditEmitter } from './audit.emitter';
import { AuditListener } from './audit.listener';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';

/**
 * Audit module. Global so any feature module can inject `AuditEmitter` to fire
 * events without importing AuditModule explicitly. The listener is the sole
 * persistence path, keeping producers decoupled from storage.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditRepository, AuditListener, AuditEmitter],
  exports: [AuditEmitter, AuditRepository],
})
export class AuditModule {}
