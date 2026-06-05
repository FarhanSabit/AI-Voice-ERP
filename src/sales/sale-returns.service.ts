import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Prisma } from '@prisma/client';
import {
  CreateSaleReturnDto,
  RefundMethod,
} from './dto/create-sale-return.dto';
import { UpdateSaleReturnDto } from './dto/update-sale-return.dto';
import { QuerySaleReturnDto } from './dto/query-sale-return.dto';
import type { JwtUser } from 'src/auth/types/jwt-user.type';

const listReturnInclude = {
  sale: { select: { invoiceNo: true } },
  items: true,
} satisfies Prisma.SaleReturnInclude;

const singleReturnInclude = {
  sale: { select: { invoiceNo: true, partyId: true } },
  items: true,
} satisfies Prisma.SaleReturnInclude;

async function generateReturnNo(
  tx: Prisma.TransactionClient,
  businessId: string,
): Promise<string> {
  const dateStr = new Date().getFullYear().toString();
  const prefix = `SR-${dateStr}-`;
  const last = await tx.saleReturn.findFirst({
    where: { businessId, returnNo: { startsWith: prefix } },
    orderBy: { returnNo: 'desc' },
  });
  const next = last ? parseInt(last.returnNo.slice(-4), 10) + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

@Injectable()
export class SaleReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(SaleReturnsService.name)
    private readonly logger: PinoLogger,
  ) {}

  private checkBranchAccess(user: JwtUser): {
    isMainBranch: boolean;
    branchId: string;
  } {
    if (!user.branchId) {
      throw new BadRequestException('User is not associated with any branch.');
    }
    return { isMainBranch: user.isMainBranch, branchId: user.branchId };
  }

  async findAll(user: JwtUser, query: QuerySaleReturnDto) {
    const { branchId, isMainBranch } = this.checkBranchAccess(user);
    const businessId = user.businessId;
    const page = parseInt(query.page ?? '1', 10);
    const limit = parseInt(query.limit ?? '20', 10);

    const where: Prisma.SaleReturnWhereInput = { businessId };
    if (!isMainBranch) {
      where.branchId = branchId;
    }

    if (query.saleId) where.saleId = query.saleId;
    if (query.partyId) where.partyId = query.partyId;
    if (query.status) where.status = query.status;
    if (query.reason)
      where.reason = { contains: query.reason, mode: 'insensitive' };

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
        { returnNo: { contains: query.search, mode: 'insensitive' } },
        {
          sale: { invoiceNo: { contains: query.search, mode: 'insensitive' } },
        },
      ];
    }

    const [returns, total] = await Promise.all([
      this.prisma.saleReturn.findMany({
        where,
        include: listReturnInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.saleReturn.count({ where }),
    ]);

    return {
      success: true,
      data: returns,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(user: JwtUser, id: string) {
    const { branchId, isMainBranch } = this.checkBranchAccess(user);
    const businessId = user.businessId;

    const where: Prisma.SaleReturnWhereInput = { id, businessId };
    if (!isMainBranch) {
      where.branchId = branchId;
    }

    const saleReturn = await this.prisma.saleReturn.findFirst({
      where,
      include: singleReturnInclude,
    });

    if (!saleReturn) throw new NotFoundException(`Return ${id} not found.`);

    return { success: true, data: saleReturn };
  }

  async create(user: JwtUser, dto: CreateSaleReturnDto) {
    const { branchId, isMainBranch } = this.checkBranchAccess(user);
    const businessId = user.businessId;
    const userId = user.id;

    const { saleId, items, reason, notes, refundMethod, accountId } = dto;

    const sale = await this.prisma.sale.findFirst({
      where: {
        id: saleId,
        businessId,
        ...(!isMainBranch && { branchId }),
      },
      include: { items: true },
    });

    if (!sale) throw new NotFoundException('Original sale not found.');

    if (sale.status === 'cancelled') {
      throw new BadRequestException(
        'Cannot process return for a cancelled sale.',
      );
    }

    const saleItemMap = new Map<string, (typeof sale.items)[0]>(
      sale.items.map((i) => [i.id, i]),
    );
    interface ReturnItemData {
      saleItemId: string;
      itemId: string;
      batchId: string | null;
      itemName: string;
      quantity: number;
      unitPrice: number;
      costPrice: number;
      discount: number;
      total: number;
      reason?: string;
    }
    const returnItemsData: ReturnItemData[] = [];
    let refundSubtotal = 0;

    // Validate quantities
    for (const input of items) {
      const saleItem = saleItemMap.get(input.saleItemId);
      if (!saleItem) {
        throw new BadRequestException(
          `Sale item ${input.saleItemId} not found in this sale.`,
        );
      }

      const maxReturnable = saleItem.quantity - saleItem.returnedQty;
      if (input.quantity > maxReturnable) {
        throw new BadRequestException(
          `Cannot return ${input.quantity} of ${saleItem.itemName}. Max returnable is ${maxReturnable}.`,
        );
      }

      const ratio = input.quantity / saleItem.quantity;
      const proportionedDiscount = saleItem.discount * ratio;
      const returnTotal =
        input.quantity * saleItem.unitPrice - proportionedDiscount;

      returnItemsData.push({
        saleItemId: saleItem.id,
        itemId: saleItem.itemId,
        batchId: saleItem.batchId,
        itemName: saleItem.itemName,
        quantity: input.quantity,
        unitPrice: saleItem.unitPrice,
        costPrice: saleItem.costPrice,
        discount: proportionedDiscount,
        total: returnTotal,
        reason: input.reason,
      });

      refundSubtotal += returnTotal;
    }

    // Process return
    const saleReturn = await this.prisma.$transaction(async (tx) => {
      const returnNo = await generateReturnNo(tx, businessId);

      const newReturn = await tx.saleReturn.create({
        data: {
          businessId,
          branchId,
          saleId,
          returnNo,
          partyId: sale.partyId,
          subtotal: refundSubtotal,
          discount: 0,
          tax: 0,
          total: refundSubtotal,
          refundAmount:
            refundMethod && refundMethod !== RefundMethod.CREDIT_NOTE
              ? refundSubtotal
              : 0,
          refundMethod: refundMethod ?? null,
          status: 'completed',
          reason,
          notes,
          createdBy: userId,
          items: {
            create: returnItemsData.map((item) => ({
              saleItemId: item.saleItemId,
              itemId: item.itemId,
              itemName: item.itemName,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              costPrice: item.costPrice,
              discount: item.discount,
              total: item.total,
              reason: item.reason,
            })),
          },
        },
        include: singleReturnInclude,
      });

      for (const item of returnItemsData) {
        // Update SaleItem.returnedQty
        await tx.saleItem.update({
          where: { id: item.saleItemId },
          data: { returnedQty: { increment: item.quantity } },
        });

        // Restore Stock
        const currentItem = await tx.item.findUnique({
          where: { id: item.itemId },
        });
        if (currentItem) {
          const restoredStock = currentItem.currentStock + item.quantity;
          await tx.item.update({
            where: { id: item.itemId },
            data: { currentStock: restoredStock },
          });

          // Adjust Batch
          if (item.batchId) {
            await tx.batch.update({
              where: { id: item.batchId },
              data: { remainingQty: { increment: item.quantity } },
            });
          }

          // Ledger
          await tx.stockLedger.create({
            data: {
              businessId,
              branchId,
              itemId: item.itemId,
              batchId: item.batchId,
              type: 'return_in',
              quantity: item.quantity,
              previousStock: currentItem.currentStock,
              newStock: restoredStock,
              referenceId: newReturn.id,
              referenceType: 'sale_return',
              reason: item.reason ?? 'Sales Return',
              createdBy: userId,
            },
          });
        }
      }

      // Reconcile overall sale profit? The architecture doc says "Update Sale profit".
      const updatedSaleItems = await tx.saleItem.findMany({
        where: { saleId: sale.id },
      });
      const currentProfit = updatedSaleItems.reduce((acc, si) => {
        const effectiveQty = si.quantity - si.returnedQty;
        const profitPerUnit = si.unitPrice - si.costPrice;
        const discountRatio = effectiveQty / si.quantity;
        return (
          acc +
          profitPerUnit * effectiveQty -
          si.discount * (isNaN(discountRatio) ? 0 : discountRatio)
        );
      }, 0);

      // Check if fully returned
      const allReturned = updatedSaleItems.every(
        (si) => si.quantity === si.returnedQty,
      );

      await tx.sale.update({
        where: { id: sale.id },
        data: {
          profit: currentProfit,
          status: allReturned ? 'returned' : sale.status,
        },
      });

      if (
        refundMethod &&
        accountId &&
        refundMethod !== RefundMethod.CREDIT_NOTE
      ) {
        await tx.account.update({
          where: { id: accountId },
          data: { currentBalance: { decrement: refundSubtotal } },
        });

        // Record a permanent payment entry for the refund
        await tx.payment.create({
          data: {
            businessId,
            branchId,
            partyId: sale.partyId ?? undefined,
            type: 'return',
            mode: refundMethod,
            accountId: accountId,
            amount: refundSubtotal,
            saleId: saleId,
            reference: `Return SR-${returnNo}`,
            createdBy: userId,
          },
        });
      }

      // If they had outstanding balance, we could credit their party account.
      if (sale.partyId) {
        if (refundMethod === RefundMethod.CREDIT_NOTE || sale.dueAmount > 0) {
          const party = await tx.party.findUnique({
            where: { id: sale.partyId },
          });
          if (party) {
            const newBalance = party.currentBalance - refundSubtotal;
            await tx.party.update({
              where: { id: party.id },
              data: { currentBalance: newBalance },
            });

            await tx.partyLedger.create({
              data: {
                businessId,
                branchId,
                partyId: party.id,
                type: 'return',
                referenceId: newReturn.id,
                referenceType: 'sale_return',
                amount: -refundSubtotal,
                balance: newBalance,
                description: `Sales Return SR-${returnNo}`,
                date: new Date(),
              },
            });
          }
        }
      }

      return newReturn;
    });

    this.logger.info(
      { returnId: saleReturn.id, saleId },
      'Sale return processed',
    );

    return { success: true, data: saleReturn };
  }

  async update(user: JwtUser, id: string, dto: UpdateSaleReturnDto) {
    const { branchId, isMainBranch } = this.checkBranchAccess(user);
    const businessId = user.businessId;

    const where: Prisma.SaleReturnWhereInput = { id, businessId };
    if (!isMainBranch) {
      where.branchId = branchId;
    }

    const saleReturn = await this.prisma.saleReturn.findFirst({
      where,
    });

    if (!saleReturn) throw new NotFoundException(`Return ${id} not found.`);

    const updated = await this.prisma.saleReturn.update({
      where: { id },
      data: {
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });

    return { success: true, data: updated };
  }

  async remove(user: JwtUser, id: string) {
    const { branchId, isMainBranch } = this.checkBranchAccess(user);
    const businessId = user.businessId;

    const where: Prisma.SaleReturnWhereInput = { id, businessId };
    if (!isMainBranch) {
      where.branchId = branchId;
    }

    const existing = await this.prisma.saleReturn.findFirst({
      where,
      include: { items: true },
    });

    if (!existing) throw new NotFoundException(`Return ${id} not found.`);

    if (existing.status === 'cancelled') {
      throw new ForbiddenException('Return is already cancelled.');
    }

    // Reverse the return (soft delete essentially with stock reversal)
    await this.prisma.$transaction(async (tx) => {
      for (const item of existing.items) {
        // Restore returnedQty
        await tx.saleItem.update({
          where: { id: item.saleItemId },
          data: { returnedQty: { decrement: item.quantity } },
        });

        // Deduct stock (since it was added during return)
        const currentItem = await tx.item.findUnique({
          where: { id: item.itemId },
        });
        if (currentItem) {
          const reversedStock = currentItem.currentStock - item.quantity;
          await tx.item.update({
            where: { id: item.itemId },
            data: { currentStock: reversedStock },
          });

          // we do not have batchId in saleReturnItem? The schema doesn't have it natively.
          // It relies on saleItem.
          const originalSaleItem = await tx.saleItem.findUnique({
            where: { id: item.saleItemId },
          });
          if (originalSaleItem?.batchId) {
            await tx.batch.update({
              where: { id: originalSaleItem.batchId },
              data: { remainingQty: { decrement: item.quantity } },
            });
          }

          await tx.stockLedger.create({
            data: {
              businessId,
              branchId: existing.branchId ?? branchId,
              itemId: item.itemId,
              type: 'adjustment',
              quantity: -item.quantity,
              previousStock: currentItem.currentStock,
              newStock: reversedStock,
              referenceId: existing.id,
              referenceType: 'sale_return_reversal',
              reason: 'Sale return reversed',
            },
          });
        }
      }

      await tx.saleReturn.update({
        where: { id },
        data: { status: 'cancelled', deletedAt: new Date() },
      });
    });

    this.logger.info({ returnId: id }, 'Sale return reversed/deleted');
    return { success: true, message: 'Return reversed successfully' };
  }
}
