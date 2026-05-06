import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import type { AuthUser } from '../../auth/types';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { SweepService } from './sweep.service';
import {
  SweepSimulateSchema,
  SweepIssueSchema,
  type SweepSimulate,
  type SweepIssue,
} from './sweep.dto';

@ApiTags('certificates')
@ApiBearerAuth()
@Controller('certificates/sweep')
export class SweepController {
  constructor(private readonly sweep: SweepService) {}

  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('certificate.sweep')
  simulate(@Body(new ZodValidationPipe(SweepSimulateSchema)) body: SweepSimulate) {
    return this.sweep.simulateSweep(body);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('certificate.sweep')
  issue(
    @Body(new ZodValidationPipe(SweepIssueSchema)) body: SweepIssue,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sweep.issueSweep(body, user.id);
  }
}
