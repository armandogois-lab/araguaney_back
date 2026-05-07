import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AuditQueryService } from './audit.service';
import { AuditListQuerySchema, type AuditListQuery } from './audit.dto';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  @RequirePermission('audit.read')
  list(@Query(new ZodValidationPipe(AuditListQuerySchema)) query: AuditListQuery) {
    return this.audit.list(query);
  }
}
