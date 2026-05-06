import { Controller, Get, Param, ParseUUIDPipe, Query, UsePipes } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { MerchantsService } from './merchants.service';
import { MerchantsListQuerySchema, type MerchantsListQuery } from './merchants.dto';

@ApiTags('merchants')
@ApiBearerAuth()
@Controller('merchants')
export class MerchantsController {
  constructor(private readonly merchants: MerchantsService) {}

  @Get()
  @RequirePermission('portfolio.read')
  @UsePipes(new ZodValidationPipe(MerchantsListQuerySchema))
  list(@Query() query: MerchantsListQuery) {
    return this.merchants.list(query);
  }

  @Get(':id')
  @RequirePermission('portfolio.read')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.merchants.detail(id);
  }
}
