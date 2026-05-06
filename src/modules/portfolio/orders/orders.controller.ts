import { Controller, Get, Param, ParseUUIDPipe, Query, UsePipes } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { OrdersService } from './orders.service';
import {
  OrdersListQuerySchema,
  OrdersStatsQuerySchema,
  type OrdersListQuery,
  type OrdersStatsQuery,
} from './orders.dto';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermission('portfolio.read')
  @UsePipes(new ZodValidationPipe(OrdersListQuerySchema))
  list(@Query() query: OrdersListQuery) {
    return this.orders.list(query);
  }

  @Get('stats')
  @RequirePermission('portfolio.read')
  @UsePipes(new ZodValidationPipe(OrdersStatsQuerySchema))
  stats(@Query() query: OrdersStatsQuery) {
    return this.orders.stats(query);
  }

  @Get(':id')
  @RequirePermission('portfolio.read')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.detail(id);
  }
}
