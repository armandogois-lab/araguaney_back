import { Module } from '@nestjs/common';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { MerchantsController } from './merchants/merchants.controller';
import { MerchantsService } from './merchants/merchants.service';
import { EndUsersController } from './end-users/end-users.controller';
import { EndUsersService } from './end-users/end-users.service';
import { InstallmentsController } from './installments/installments.controller';
import { InstallmentsService } from './installments/installments.service';

@Module({
  controllers: [OrdersController, MerchantsController, EndUsersController, InstallmentsController],
  providers: [OrdersService, MerchantsService, EndUsersService, InstallmentsService],
})
export class PortfolioModule {}
