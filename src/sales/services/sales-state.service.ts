import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { UpdateSaleDto, SaleStatus } from '../dto/update-sale.dto';
import { Prisma } from '@prisma/client';
import type { JwtUser } from 'src/auth/types/jwt-user.type';
import { listSaleInclude, transformListSale } from '../sales.helpers';

@Injectable()
export class SalesStateService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(SalesStateService.name)
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

  async update(user: JwtUser, id: string, dto: UpdateSaleDto) {
    const { branchId, isMainBranch } = this.checkBranchAccess(user);
    const businessId = user.businessId;
    const userId = user.id;

    const where: Prisma.SaleWhereInput = {
      id,
      businessId,
    };
    if (!isMainBranch) {
      where.branchId = branchId;
    }

    const existing = await this.prisma.sale.findFirst({
      where,
      include: { items: true, party: true },
    });

    if (!existing) throw new NotFoundException(`Sale ${id} not found.`);

    const existingStatus = existing.status as SaleStatus;
    if (
      existingStatus === SaleStatus.CANCELLED ||
      existingStatus === SaleStatus.RETURNED
    ) {
      throw new ForbiddenException(`Cannot update a ${existing.status} sale.`);
    }

    const { status, notes } = dto;

    const sale = await this.prisma.$transaction(async (tx) => {
      if (status === SaleStatus.CANCELLED || status === SaleStatus.RETURNED) {
        for (const saleItem of existing.items) {
          const item = await tx.item.findUnique({
            where: { id: saleItem.itemId },
          });
          if (!item) continue;
          const restoredStock = item.currentStock + saleItem.quantity;
          await tx.item.update({
            where: { id: saleItem.itemId },
            data: { currentStock: restoredStock },
          });
          if (saleItem.batchId) {
            await tx.batch.update({
              where: { id: saleItem.batchId },
              data: { remainingQty: { increment: saleItem.quantity } },
            });
          }
          await tx.stockLedger.create({
            data: {
              businessId,
              branchId: existing.branchId ?? branchId,
              itemId: saleItem.itemId,
              type: status === SaleStatus.CANCELLED ? 'adjustment' : 'return',
              quantity: saleItem.quantity,
              previousStock: item.currentStock,
              newStock: restoredStock,
              referenceId: existing.id,
              referenceType: 'sale',
              reason:
                status === SaleStatus.CANCELLED
                  ? 'Sale cancelled'
                  : 'Sale returned',
              createdBy: userId,
            },
          });
        }

        if (existing.partyId && existing.dueAmount > 0) {
          const party = await tx.party.findUnique({
            where: { id: existing.partyId },
          });
          if (party) {
            const newBalance = party.currentBalance - existing.dueAmount;
            await tx.party.update({
              where: { id: existing.partyId },
              data: { currentBalance: newBalance },
            });
            await tx.partyLedger.create({
              data: {
                businessId,
                branchId: existing.branchId ?? branchId,
                partyId: existing.partyId,
                type: 'adjustment',
                referenceId: existing.id,
                referenceType: 'sale',
                amount: -existing.dueAmount,
                balance: newBalance,
                description: `Sale ${status} - Invoice ${existing.invoiceNo}`,
                date: new Date(),
              },
            });
          }
        }
      }

      return tx.sale.update({
        where: { id },
        data: {
          ...(status !== undefined && { status }),
          ...(notes !== undefined && { notes: notes ?? null }),
        },
        include: listSaleInclude,
      });
    });

    this.logger.info(
      { saleId: id, businessId, branchId: existing.branchId, status },
      'Sale status updated',
    );
    return { success: true, data: transformListSale(sale) };
  }

  async remove(user: JwtUser, id: string) {
    const { branchId, isMainBranch } = this.checkBranchAccess(user);
    const businessId = user.businessId;
    const userId = user.id;

    const where: Prisma.SaleWhereInput = {
      id,
      businessId,
    };
    if (!isMainBranch) {
      where.branchId = branchId;
    }

    const existing = await this.prisma.sale.findFirst({
      where,
      include: { items: true },
    });

    if (!existing) throw new NotFoundException(`Sale ${id} not found.`);

    const existingStatus = existing.status as SaleStatus;
    if (
      existingStatus === SaleStatus.CANCELLED ||
      existingStatus === SaleStatus.RETURNED
    ) {
      throw new ForbiddenException(
        `Sale is already ${existing.status} and cannot be deleted.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Restore stock for each item
      for (const saleItem of existing.items) {
        const item = await tx.item.findUnique({
          where: { id: saleItem.itemId },
        });
        if (!item) continue;
        const restoredStock = item.currentStock + saleItem.quantity;
        await tx.item.update({
          where: { id: saleItem.itemId },
          data: { currentStock: restoredStock },
        });
        if (saleItem.batchId) {
          await tx.batch.update({
            where: { id: saleItem.batchId },
            data: { remainingQty: { increment: saleItem.quantity } },
          });
        }
        await tx.stockLedger.create({
          data: {
            businessId,
            branchId: existing.branchId ?? branchId,
            itemId: saleItem.itemId,
            type: 'adjustment',
            quantity: saleItem.quantity,
            previousStock: item.currentStock,
            newStock: restoredStock,
            referenceId: existing.id,
            referenceType: 'sale',
            reason: 'Sale deleted',
            createdBy: userId,
          },
        });
      }

      // Reverse party ledger for credit sales
      if (existing.partyId && existing.dueAmount > 0) {
        const party = await tx.party.findUnique({
          where: { id: existing.partyId },
        });
        if (party) {
          const newBalance = party.currentBalance - existing.dueAmount;
          await tx.party.update({
            where: { id: existing.partyId },
            data: { currentBalance: newBalance },
          });
          await tx.partyLedger.create({
            data: {
              businessId,
              branchId: existing.branchId ?? branchId,
              partyId: existing.partyId,
              type: 'adjustment',
              referenceId: existing.id,
              referenceType: 'sale',
              amount: -existing.dueAmount,
              balance: newBalance,
              description: `Sale deleted - Invoice ${existing.invoiceNo}`,
              date: new Date(),
            },
          });
        }
      }

      await tx.sale.update({
        where: { id },
        data: { status: SaleStatus.CANCELLED },
      });
    });

    this.logger.info(
      { saleId: id, businessId, branchId: existing.branchId },
      'Sale deleted (soft)',
    );
    return { success: true, data: { id } };
  }
}
