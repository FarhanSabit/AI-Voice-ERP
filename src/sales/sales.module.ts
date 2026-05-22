import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { SaleReturnsService } from './sale-returns.service';
import { SaleReturnsController } from './sale-returns.controller';
import { SalesQueryService } from './services/sales-query.service';
import { SalesCreateService } from './services/sales-create.service';
import { SalesEditService } from './services/sales-edit.service';
import { SalesStateService } from './services/sales-state.service';
import { SalesStatsService } from './services/sales-stats.service';

@Module({
  controllers: [SaleReturnsController, SalesController],
  providers: [
    SalesService,
    SaleReturnsService,
    SalesQueryService,
    SalesCreateService,
    SalesEditService,
    SalesStateService,
    SalesStatsService,
  ],
  exports: [
    SalesService,
    SaleReturnsService,
    SalesQueryService,
    SalesCreateService,
    SalesEditService,
    SalesStateService,
    SalesStatsService,
  ],
})
export class SalesModule {}
