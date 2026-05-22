import { Injectable } from '@nestjs/common';
import { CreateSaleDto } from './dto/create-sale.dto';
import { EditSaleDto } from './dto/edit-sale.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';
import { QuerySaleDto } from './dto/query-sale.dto';

import { SalesQueryService } from './services/sales-query.service';
import { SalesCreateService } from './services/sales-create.service';
import { SalesEditService } from './services/sales-edit.service';
import { SalesStateService } from './services/sales-state.service';
import { SalesStatsService } from './services/sales-stats.service';

@Injectable()
export class SalesService {
  constructor(
    private readonly queryService: SalesQueryService,
    private readonly createService: SalesCreateService,
    private readonly editService: SalesEditService,
    private readonly stateService: SalesStateService,
    private readonly statsService: SalesStatsService,
  ) {}

  findAll(businessId: string, branchId: string, query: QuerySaleDto) {
    return this.queryService.findAll(businessId, branchId, query);
  }

  findOne(businessId: string, branchId: string, id: string) {
    return this.queryService.findOne(businessId, branchId, id);
  }

  create(
    businessId: string,
    branchId: string,
    userId: string | null,
    dto: CreateSaleDto,
  ) {
    return this.createService.create(businessId, branchId, userId, dto);
  }

  editSale(
    businessId: string,
    branchId: string,
    id: string,
    userId: string | null,
    dto: EditSaleDto,
  ) {
    return this.editService.editSale(businessId, branchId, id, userId, dto);
  }

  update(
    businessId: string,
    branchId: string,
    id: string,
    userId: string | null,
    dto: UpdateSaleDto,
  ) {
    return this.stateService.update(businessId, branchId, id, userId, dto);
  }

  remove(
    businessId: string,
    branchId: string,
    id: string,
    userId: string | null,
  ) {
    return this.stateService.remove(businessId, branchId, id, userId);
  }

  getSummary(businessId: string, branchId: string) {
    return this.statsService.getSummary(businessId, branchId);
  }
}
