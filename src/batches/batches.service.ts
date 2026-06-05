import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

function getDaysUntilExpiry(expiryDate: Date | null): number | null {
  if (!expiryDate) return null;
  const now = new Date();
  return Math.ceil(
    (new Date(expiryDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
}

function getBatchStatus(batch: any): string {
  if (!batch.isActive) return 'inactive';
  if (batch.remainingQty <= 0) return 'depleted';
  const days = getDaysUntilExpiry(batch.expiryDate);
  if (days !== null) {
    if (days <= 0) return 'expired';
    if (days <= 30) return 'expiring';
  }
  return 'active';
}

@Injectable()
export class BatchesService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(BatchesService.name)
    private readonly logger: PinoLogger,
  ) {}

  async getStatus(businessId: string) {
    const batches = await this.prisma.batch.findMany({
      where: { businessId, deletedAt: null },
      select: {
        isActive: true,
        remainingQty: true,
        expiryDate: true,
      },
    });

    let activeBatches = 0;
    let expired = 0;
    let expiringIn30Days = 0;

    for (const batch of batches) {
      const status = getBatchStatus(batch);
      if (status === 'active') activeBatches++;
      else if (status === 'expired') expired++;
      else if (status === 'expiring') expiringIn30Days++;
    }

    return {
      success: true,
      data: {
        totalBatches: batches.length,
        expired,
        expiringIn30Days,
        activeBatches,
      },
    };
  }

  async findAll(
    businessId: string,
    search?: string,
    statusFilter?: string,
    page: number = 1,
    limit: number = 10,
  ) {
    const conditions: any[] = [{ businessId }, { deletedAt: null }];

    if (search) {
      conditions.push({
        OR: [
          { batchNumber: { contains: search, mode: 'insensitive' } },
          { item: { name: { contains: search, mode: 'insensitive' } } },
          { item: { sku: { contains: search, mode: 'insensitive' } } },
        ],
      });
    }

    const now = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(now.getDate() + 30);

    if (statusFilter === 'expired') {
      conditions.push({ isActive: true });
      conditions.push({ remainingQty: { gt: 0 } });
      conditions.push({ expiryDate: { lte: now, not: null } });
    } else if (statusFilter === 'expiring') {
      conditions.push({ isActive: true });
      conditions.push({ remainingQty: { gt: 0 } });
      conditions.push({
        expiryDate: { gt: now, lte: thirtyDaysFromNow, not: null },
      });
    } else if (statusFilter === 'depleted') {
      conditions.push({ isActive: true });
      conditions.push({ remainingQty: { lte: 0 } });
    } else if (statusFilter === 'inactive') {
      conditions.push({ isActive: false });
    } else if (statusFilter === 'active') {
      conditions.push({ isActive: true });
      conditions.push({ remainingQty: { gt: 0 } });
      conditions.push({
        OR: [{ expiryDate: null }, { expiryDate: { gt: thirtyDaysFromNow } }],
      });
    }

    const where = { AND: conditions };
    const skip = (page - 1) * limit;

    const [total, batches] = await Promise.all([
      this.prisma.batch.count({ where }),
      this.prisma.batch.findMany({
        where,
        include: { item: { select: { name: true, sku: true } } },
        orderBy: [{ expiryDate: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
    ]);

    const enriched = batches.map((b) => {
      const { item, ...rest } = b;
      return {
        ...rest,
        batchNo: b.batchNumber,
        itemName: item?.name,
        sku: item?.sku,
        status: getBatchStatus(b),
        daysUntilExpiry: getDaysUntilExpiry(b.expiryDate),
      };
    });

    return {
      success: true,
      data: enriched,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
