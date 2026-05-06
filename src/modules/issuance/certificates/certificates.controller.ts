import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import type { AuthUser } from '../../auth/types';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CertificatesService } from './certificates.service';
import {
  CertificateSimulateSchema,
  CertificateIssueSchema,
  CertificatesListQuerySchema,
  CertificateCancelSchema,
  type CertificateSimulate,
  type CertificateIssue,
  type CertificatesListQuery,
  type CertificateCancel,
} from './certificates.dto';

@ApiTags('certificates')
@ApiBearerAuth()
@Controller('certificates')
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('certificate.simulate')
  simulate(@Body(new ZodValidationPipe(CertificateSimulateSchema)) body: CertificateSimulate) {
    return this.certificates.simulate(body);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('certificate.issue')
  issue(
    @Body(new ZodValidationPipe(CertificateIssueSchema)) body: CertificateIssue,
    @CurrentUser() user: AuthUser,
  ) {
    return this.certificates.issue(body, user.id);
  }

  @Get()
  @RequirePermission('certificate.read')
  list(
    @Query(new ZodValidationPipe(CertificatesListQuerySchema)) query: CertificatesListQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.certificates.list(query, user.role);
  }

  @Get(':id')
  @RequirePermission('certificate.read')
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.certificates.detail(id, user.role);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('certificate.cancel')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(CertificateCancelSchema)) body: CertificateCancel,
    @CurrentUser() user: AuthUser,
  ) {
    return this.certificates.cancel(id, body.reason, user.id);
  }
}
