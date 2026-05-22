import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { EditSaleDto } from '../dto/edit-sale.dto';
import { SaleStatus } from '../dto/update-sale.dto';
import {
  listSaleInclude,
  transformListSale,
} from '../sales.helpers';

@Injectable()
export class SalesEditService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(SalesEditService.name)
    private readonly logger: PinoLogger,
  ) {}

  async editSale(
    businessId: string,
    branchId: string,
    id: string,
    userId: string | null,
    dto: EditSaleDto,
  ) {
    const existing = await this.prisma.sale.findFirst({
      where: { id, businessId, ...(branchId && { branchId }) },
      include: { items: true },
    });

    if (!existing) throw new NotFoundException(`Sale ${id} not found.`);

    const existingStatus = existing.status as SaleStatus;
    if (
      existingStatus === SaleStatus.CANCELLED ||
      existingStatus === SaleStatus.RETURNED
    ) {
      throw new ForbiddenException(`Cannot edit a ${existing.status} sale.`);
    }

    const newPartyId = dto.partyId !== undefined ? dto.partyId : existing.partyId;
    const newDiscount = dto.discount !== undefined ? dto.discount : existing.discount;
    const newTax = dto.tax !== undefined ? dto.tax : existing.tax;
    const newPaymentMethod = dto.paymentMethod !== undefined ? dto.paymentMethod : existing.paymentMethod;
    const newPaidAmount = dto.paidAmount !== undefined ? dto.paidAmount : existing.paidAmount;
    const newPricingTier = dto.pricingTier !== undefined ? dto.pricingTier : existing.pricingTier;
    const newNotes = dto.notes !== undefined ? dto.notes : existing.notes;

    const sale = await this.prisma.$transaction(async (tx) => {
      const saleItemsData: any[] = [];
      let newSubtotal = existing.subtotal;
      let newTotalProfit = existing.profit;

      if (dto.items && dto.items.length > 0) {
        // Restore old items
        for (const oldItem of existing.items) {
          const dbItem = await tx.item.findUnique({
            where: { id: oldItem.itemId },
          });
          if (!dbItem) continue;
          const restoredStock = dbItem.currentStock + oldItem.quantity;
          await tx.item.update({
            where: { id: oldItem.itemId },
            data: { currentStock: restoredStock },
          });

          if (oldItem.batchId) {
            await tx.batch.update({
              where: { id: oldItem.batchId },
              data: { remainingQty: { increment: oldItem.quantity } },
            });
          }

          await tx.stockLedger.create({
            data: {
              businessId,
              itemId: oldItem.itemId,
              batchId: oldItem.batchId,
              type: 'adjustment',
              quantity: oldItem.quantity,
              previousStock: dbItem.currentStock,
              newStock: restoredStock,
              referenceId: existing.id,
              referenceType: 'sale',
              reason: 'Sale edited — old items reversed',
              createdBy: userId,
            },
          });
        }
        await tx.saleItem.deleteMany({ where: { saleId: id } });

        // Process new items
        for (const input of dto.items) {
          const dbItem = await tx.item.findUnique({ where: { id: input.itemId } });
          if (!dbItem) throw new BadRequestException(`Item not found: ${input.itemId}`);

          if (dbItem.currentStock < input.quantity) {
            throw new BadRequestException(
              `Insufficient stock for "${dbItem.name}". Available: ${dbItem.currentStock}, Requested: ${input.quantity}`,
            );
          }

          const itemDiscount = input.discount ?? 0;
          let qtyToFulfill = input.quantity;

          if (dbItem.trackBatch) {
            const batches = await tx.batch.findMany({
              where: {
                itemId: dbItem.id,
                businessId,
                isActive: true,
                remainingQty: { gt: 0 }
              },
              orderBy: { expiryDate: 'asc' }
            });

            for (const batch of batches) {
              if (qtyToFulfill <= 0) break;

              const allocateQty = Math.min(qtyToFulfill, batch.remainingQty);
              qtyToFulfill -= allocateQty;

              const allocatedDiscount = (itemDiscount / input.quantity) * allocateQty;
              const allocatedTotal = allocateQty * input.unitPrice - allocatedDiscount;
              const allocatedProfit = (input.unitPrice - batch.costPrice) * allocateQty - allocatedDiscount;

              saleItemsData.push({
                itemId: dbItem.id,
                batchId: batch.id,
                itemName: input.itemName ?? dbItem.name,
                quantity: allocateQty,
                unitPrice: input.unitPrice,
                costPrice: batch.costPrice,
                discount: allocatedDiscount,
                total: allocatedTotal,
                profit: allocatedProfit,
              });

              await tx.batch.update({
                where: { id: batch.id },
                data: { remainingQty: batch.remainingQty - allocateQty }
              });
            }

            if (qtyToFulfill > 0) {
              throw new BadRequestException(`Insufficient batch stock for "${dbItem.name}". Missing ${qtyToFulfill} units.`);
            }
          } else {
            const itemTotal = input.quantity * input.unitPrice - itemDiscount;
            const itemProfit = (input.unitPrice - dbItem.costPrice) * input.quantity - itemDiscount;

            saleItemsData.push({
              itemId: dbItem.id,
              batchId: null,
              itemName: input.itemName ?? dbItem.name,
              quantity: input.quantity,
              unitPrice: input.unitPrice,
              costPrice: dbItem.costPrice,
              discount: itemDiscount,
              total: itemTotal,
              profit: itemProfit,
            });
          }
        }

        // Apply new items
        for (const itemData of saleItemsData) {
          await tx.saleItem.create({
            data: {
              saleId: id,
              itemId: itemData.itemId,
              batchId: itemData.batchId,
              itemName: itemData.itemName,
              quantity: itemData.quantity,
              unitPrice: itemData.unitPrice,
              costPrice: itemData.costPrice,
              discount: itemData.discount,
              total: itemData.total,
              profit: itemData.profit,
            },
          });

          const currentItem = await tx.item.findUnique({ where: { id: itemData.itemId } });
          const prevStock = currentItem!.currentStock;
          const newStock = prevStock - itemData.quantity;

          await tx.item.update({
            where: { id: itemData.itemId },
            data: {
              currentStock: newStock,
              lastSaleDate: new Date(),
            },
          });

          await tx.stockLedger.create({
            data: {
              businessId,
              itemId: itemData.itemId,
              batchId: itemData.batchId,
              type: 'sale',
              quantity: -itemData.quantity,
              previousStock: prevStock,
              newStock: newStock,
              referenceId: id,
              referenceType: 'sale',
              reason: 'Sale edited — new items applied',
              createdBy: userId,
            },
          });
        }

        newSubtotal = saleItemsData.reduce((sum, i) => sum + i.total, 0);
        newTotalProfit = saleItemsData.reduce((sum, i) => sum + i.profit, 0);
      }

      const newTotal = newSubtotal - newDiscount + newTax;
      const newDueAmount = newTotal - newPaidAmount;

      if (newPartyId) {
        const dueDiff = newDueAmount - existing.dueAmount;
        if (dueDiff !== 0) {
          const party = await tx.party.findUnique({
            where: { id: newPartyId },
          });
          if (party) {
            const newBalance = party.currentBalance + dueDiff;
            await tx.party.update({
              where: { id: newPartyId },
              data: { currentBalance: newBalance },
            });
            await tx.partyLedger.create({
              data: {
                businessId,
                partyId: newPartyId,
                type: 'adjustment',
                referenceId: id,
                referenceType: 'sale',
                amount: dueDiff,
                balance: newBalance,
                description: `Sale edited - Invoice ${existing.invoiceNo}`,
                date: new Date(),
              },
            });
          }
        }
      }

      return tx.sale.update({
        where: { id },
        data: {
          partyId: newPartyId || null,
          subtotal: newSubtotal,
          discount: newDiscount,
          tax: newTax,
          total: newTotal,
          paidAmount: newPaidAmount,
          dueAmount: newDueAmount,
          paymentMethod: newPaymentMethod,
          pricingTier: newPricingTier ?? null,
          profit: newTotalProfit,
          notes: newNotes ?? null,
          status: newDueAmount > 0 ? 'pending' : 'completed',
        },
        include: listSaleInclude,
      });
    });

    this.logger.info({ saleId: id, businessId, branchId }, 'Sale edited');
    return { success: true, data: transformListSale(sale) };
  }
}
