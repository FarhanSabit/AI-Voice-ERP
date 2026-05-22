import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CreateSaleDto } from '../dto/create-sale.dto';
import {
  listSaleInclude,
  transformListSale,
  generateInvoiceNo,
  ACCOUNT_TYPE_MAP,
} from '../sales.helpers';

@Injectable()
export class SalesCreateService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(SalesCreateService.name)
    private readonly logger: PinoLogger,
  ) {}

  async create(
    businessId: string,
    branchId: string,
    userId: string | null,
    dto: CreateSaleDto,
  ) {
    const {
      partyId,
      items,
      discount = 0,
      tax = 0,
      paymentMethod,
      paidAmount = 0,
      pricingTier,
      notes,
    } = dto;

    const sale = await this.prisma.$transaction(async (tx) => {
      const invoiceNo = await generateInvoiceNo(tx, businessId);

      const saleItemsData: any[] = [];
      let subtotal = 0;
      let totalProfit = 0;

      for (const input of items) {
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
              remainingQty: { gt: 0 },
              ...(input.batchId ? { id: input.batchId } : {})
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

      subtotal = saleItemsData.reduce((sum, i) => sum + i.total, 0);
      totalProfit = saleItemsData.reduce((sum, i) => sum + i.profit, 0);
      const total = subtotal - discount + tax;
      const dueAmount = total - paidAmount;

      const newSale = await tx.sale.create({
        data: {
          businessId,
          branchId: branchId || null,
          invoiceNo,
          partyId: partyId || null,
          subtotal,
          discount,
          tax,
          total,
          paidAmount,
          dueAmount,
          paymentMethod,
          pricingTier: pricingTier ?? null,
          status: dueAmount > 0 ? 'pending' : 'completed',
          profit: totalProfit,
          notes: notes ?? null,
          createdBy: userId,
          items: {
            create: saleItemsData.map((item) => ({
              itemId: item.itemId,
              batchId: item.batchId,
              itemName: item.itemName,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              costPrice: item.costPrice,
              discount: item.discount,
              total: item.total,
              profit: item.profit,
            })),
          },
        },
        include: listSaleInclude,
      });

      for (const itemData of saleItemsData) {
        const currentItem = await tx.item.findUnique({ where: { id: itemData.itemId } });
        const prevStock = currentItem!.currentStock;
        const newStock = prevStock - itemData.quantity;

        await tx.item.update({
          where: { id: itemData.itemId },
          data: { currentStock: newStock, lastSaleDate: new Date() },
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
            referenceId: newSale.id,
            referenceType: 'sale',
            createdBy: userId,
          },
        });
      }

      if (partyId && dueAmount > 0) {
        const party = await tx.party.findUnique({ where: { id: partyId } });
        if (party) {
          const newBalance = party.currentBalance + dueAmount;
          await tx.party.update({
            where: { id: partyId },
            data: { currentBalance: newBalance },
          });
          await tx.partyLedger.create({
            data: {
              businessId,
              partyId,
              type: 'sale',
              referenceId: newSale.id,
              referenceType: 'sale',
              amount: dueAmount,
              balance: newBalance,
              description: `Credit sale - Invoice ${invoiceNo}`,
              date: new Date(),
            },
          });
        }
      }

      if (paidAmount > 0) {
        const accountMeta = ACCOUNT_TYPE_MAP[paymentMethod] ?? ACCOUNT_TYPE_MAP['cash'];
        let account = await tx.account.findFirst({
          where: { businessId, branchId, type: accountMeta.type },
        });
        if (!account) {
          account = await tx.account.create({
            data: {
              businessId,
              name: accountMeta.name,
              nameBn: accountMeta.nameBn,
              type: accountMeta.type,
              isDefault: true,
              status: 'active',
              currentBalance: 0,
            },
          });
        }
        await tx.account.update({
          where: { id: account.id },
          data: { currentBalance: account.currentBalance + paidAmount },
        });

        // Track the payment in a separate record that links the sale to the account
        await tx.payment.create({
          data: {
            businessId,
            branchId: branchId || undefined,
            partyId: partyId || undefined,
            type: 'sale',
            mode: paymentMethod,
            accountId: account.id,
            amount: paidAmount,
            saleId: newSale.id,
            reference: `Invoice ${invoiceNo}`,
            createdBy: userId,
          },
        });
      }

      return newSale;
    });

    this.logger.info(
      { saleId: sale.id, businessId, invoiceNo: sale.invoiceNo },
      'Sale created',
    );
    return { success: true, data: transformListSale(sale) };
  }
}
