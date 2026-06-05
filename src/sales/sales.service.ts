import { Injectable } from '@nestjs/common';
import { CreateSaleDto } from './dto/create-sale.dto';
import { EditSaleDto } from './dto/edit-sale.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';
import { QuerySaleDto } from './dto/query-sale.dto';
import type { JwtUser } from 'src/auth/types/jwt-user.type';

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

  findAll(user: JwtUser, query: QuerySaleDto) {
    return this.queryService.findAll(user, query);
  }

  findOne(user: JwtUser, id: string) {
    return this.queryService.findOne(user, id);
  }

  create(user: JwtUser, dto: CreateSaleDto) {
    return this.createService.create(user, dto);
  }

  editSale(user: JwtUser, id: string, dto: EditSaleDto) {
    return this.editService.editSale(user, id, dto);
  }

  update(user: JwtUser, id: string, dto: UpdateSaleDto) {
    return this.stateService.update(user, id, dto);
  }

  remove(user: JwtUser, id: string) {
    return this.stateService.remove(user, id);
  }

  getSummary(user: JwtUser) {
    return this.statsService.getSummary(user);
  }
}
