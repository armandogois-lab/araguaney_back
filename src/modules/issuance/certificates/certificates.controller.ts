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
  UsePipes,
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
  type CertificateSimulate,
  type CertificateIssue,
  type CertificatesListQuery,
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
  @UsePipes(new ZodValidationPipe(CertificatesListQuerySchema))
  list(@Query() query: CertificatesListQuery, @CurrentUser() user: AuthUser) {
    return this.certificates.list(query, user.role);
  }

  @Get(':id')
  @RequirePermission('certificate.read')
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.certificates.detail(id, user.role);
  }
}
