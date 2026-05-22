import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { QuerySaleDto } from '../dto/query-sale.dto';
import { Prisma } from '@prisma/client';
import {
  listSaleInclude,
  singleSaleInclude,
  transformListSale,
  transformSingleSale,
} from '../sales.helpers';

@Injectable()
export class SalesQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(businessId: string, branchId: string, query: QuerySaleDto) {
    const page = parseInt(query.page ?? '1', 10);
    const limit = parseInt(query.limit ?? '20', 10);

    const where: Prisma.SaleWhereInput = { businessId };
    if (branchId) where.branchId = branchId;

    if (query.partyId) where.partyId = query.partyId;

    if (query.status && query.status !== 'all') {
      where.status = query.status;
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) {
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    if (query.search) {
      where.OR = [
        { invoiceNo: { contains: query.search, mode: 'insensitive' } },
        { party: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [sales, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        include: listSaleInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.sale.count({ where }),
    ]);

    return {
      success: true,
      data: sales.map(transformListSale),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(businessId: string, branchId: string, id: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { id, businessId, ...(branchId && { branchId }) },
      include: singleSaleInclude,
    });

    if (!sale) throw new NotFoundException(`Sale ${id} not found.`);

    return { success: true, data: transformSingleSale(sale) };
  }
}
