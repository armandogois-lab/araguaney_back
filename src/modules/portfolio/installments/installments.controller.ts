import { Controller, Get, Query, UsePipes } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { InstallmentsService } from './installments.service';
import { InstallmentsListQuerySchema, type InstallmentsListQuery } from './installments.dto';

@ApiTags('installments')
@ApiBearerAuth()
@Controller('installments')
export class InstallmentsController {
  constructor(private readonly installments: InstallmentsService) {}

  @Get()
  @RequirePermission('portfolio.read')
  @UsePipes(new ZodValidationPipe(InstallmentsListQuerySchema))
  list(@Query() query: InstallmentsListQuery) {
    return this.installments.list(query);
  }
}
