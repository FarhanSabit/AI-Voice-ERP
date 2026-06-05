import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Prisma } from '@prisma/client';
import {
  CreatePurchaseReturnDto,
  PurchaseRefundMethod,
} from './dto/create-purchase-return.dto';

import type { JwtUser } from 'src/auth/types/jwt-user.type';

const listPurchaseReturnInclude = {
  items: true,
  purchase: { select: { invoiceNo: true, grnNo: true } },
} satisfies Prisma.PurchaseReturnInclude;

@Injectable()
export class PurchaseReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(PurchaseReturnsService.name)
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

  private async generateReturnNo(
    tx: Prisma.TransactionClient,
    businessId: string,
  ): Promise<string> {
    const dateStr = new Date().getFullYear().toString();
    const prefix = `PR-${dateStr}-`;
    const last = await tx.purchaseReturn.findFirst({
      where: { businessId, returnNo: { startsWith: prefix } },
      orderBy: { returnNo: 'desc' },
    });
    const next = last ? parseInt(last.returnNo.split('-')[2], 10) + 1 : 1;
    return `${prefix}${String(next).padStart(4, '0')}`;
  }

  private async generateDebitNoteNo(
    tx: Prisma.TransactionClient,
    businessId: string,
  ): Promise<string> {
    const dateStr = new Date().getFullYear().toString();
    const prefix = `DN-${dateStr}-`;
    const last = await tx.debitNote.findFirst({
      where: { businessId, noteNo: { startsWith: prefix } },
      orderBy: { noteNo: 'desc' },
    });
    const next = last ? parseInt(last.noteNo.split('-')[2], 10) + 1 : 1;
    return `${prefix}${String(next).padStart(4, '0')}`;
  }

  async findAll(user: JwtUser) {
    const { branchId, isMainBranch } = this.checkBranchAccess(user);
    const businessId = user.businessId;

    const where: Prisma.PurchaseReturnWhereInput = { businessId };
    if (!isMainBranch) {
      where.branchId = branchId;
    }

    const returns = await this.prisma.purchaseReturn.findMany({
      where,
      include: listPurchaseReturnInclude,
      orderBy: { createdAt: 'desc' },
    });

    return { success: true, data: returns };
  }

  async findOne(user: JwtUser, id: string) {
    const { branchId, isMainBranch } = this.checkBranchAccess(user);
    const businessId = user.businessId;

    const where: Prisma.PurchaseReturnWhereInput = {
      id,
      businessId,
    };
    if (!isMainBranch) {
      where.branchId = branchId;
    }

    const record = await this.prisma.purchaseReturn.findFirst({
      where,
      include: listPurchaseReturnInclude,
    });

    if (!record)
      throw new NotFoundException(`Purchase Return ${id} not found.`);
    return { success: true, data: record };
  }

  async create(user: JwtUser, dto: CreatePurchaseReturnDto) {
    const { branchId, isMainBranch } = this.checkBranchAccess(user);
    const businessId = user.businessId;
    const userId = user.id;

    const {
      purchaseId,
      items,
      discount = 0,
      tax = 0,
      reason,
      refundMethod,
      accountId,
      notes,
    } = dto;

    const returnRecord = await this.prisma.$transaction(async (tx) => {
      const originalPurchase = await tx.purchase.findFirst({
        where: {
          id: purchaseId,
          businessId,
          ...(!isMainBranch && { branchId }),
        },
        include: { items: true },
      });

      if (!originalPurchase)
        throw new NotFoundException(`Purchase transaction not found`);

      const returnNo = await this.generateReturnNo(tx, businessId);
      let subtotal = 0;
      const returnItemsData: any[] = [];

      for (const inputItem of items) {
        const pItem = originalPurchase.items.find(
          (i) => i.id === inputItem.purchaseItemId,
        );
        if (!pItem)
          throw new BadRequestException(
            `Purchase item ${inputItem.purchaseItemId} not found`,
          );

        const availableToReturn = pItem.quantity - pItem.returnedQty;
        if (inputItem.quantity > availableToReturn) {
          throw new BadRequestException(
            `Cannot return ${inputItem.quantity} units for ${inputItem.itemName}. Maximum allowed is ${availableToReturn}.`,
          );
        }

        const itemTotal = inputItem.quantity * inputItem.unitCost;
        subtotal += itemTotal;

        returnItemsData.push({
          purchaseItemId: pItem.id,
          itemId: inputItem.itemId,
          itemName: inputItem.itemName,
          quantity: inputItem.quantity,
          unitCost: inputItem.unitCost,
          total: itemTotal,
          reason: inputItem.reason,
        });

        // 1. Update purchase item returned qty
        await tx.purchaseItem.update({
          where: { id: pItem.id },
          data: { returnedQty: { increment: inputItem.quantity } },
        });

        // 2. Reduce Stock
        const item = await tx.item.findUnique({
          where: { id: inputItem.itemId },
        });
        if (item) {
          const newStock = Math.max(0, item.currentStock - inputItem.quantity);
          await tx.item.update({
            where: { id: item.id },
            data: { currentStock: newStock },
          });

          await tx.stockLedger.create({
            data: {
              businessId,
              branchId,
              itemId: item.id,
              batchId: pItem.batchId,
              type: 'return_out',
              quantity: -inputItem.quantity,
              previousStock: item.currentStock,
              newStock,
              referenceId: purchaseId, // Links to original purchase
              referenceType: 'purchase_return',
              reason: inputItem.reason || 'Supplier Return',
              createdBy: userId,
            },
          });
        }

        // 3. Reconcile batches if applicable
        if (pItem.batchId) {
          const batch = await tx.batch.findUnique({
            where: { id: pItem.batchId },
          });
          if (batch) {
            await tx.batch.update({
              where: { id: batch.id },
              data: {
                remainingQty: Math.max(
                  0,
                  batch.remainingQty - inputItem.quantity,
                ),
              },
            });
          }
        }
      }

      const total = subtotal - discount + tax;
      const supplierId = dto.supplierId ?? originalPurchase.supplierId;

      const newReturn = await tx.purchaseReturn.create({
        data: {
          businessId,
          branchId,
          purchaseId,
          returnNo,
          supplierId,
          subtotal,
          discount,
          tax,
          total,
          refundAmount:
            refundMethod !== PurchaseRefundMethod.REPLACEMENT ? total : 0,
          refundMethod,
          reason,
          notes,
          createdBy: userId,
          items: {
            create: returnItemsData,
          },
        },
        include: listPurchaseReturnInclude,
      });

      // 4. Financial & Party Ledger Reconciliation
      if (supplierId && refundMethod === PurchaseRefundMethod.DEBIT_NOTE) {
        const party = await tx.party.findFirst({
          where: {
            id: supplierId,
            businessId,
            ...(!isMainBranch && { branchId }),
          },
        });
        if (party) {
          const noteNo = await this.generateDebitNoteNo(tx, businessId);
          await tx.debitNote.create({
            data: {
              businessId,
              partyId: supplierId,
              purchaseId,
              purchaseReturnId: newReturn.id,
              noteNo,
              amount: total,
              remainingAmount: total,
              reason: 'Supplier return',
              createdBy: userId,
            },
          });

          const newBalance = party.currentBalance - total; // Reduce supplier payable
          await tx.party.update({
            where: { id: supplierId },
            data: { currentBalance: newBalance },
          });

          await tx.partyLedger.create({
            data: {
              businessId,
              branchId,
              partyId: supplierId,
              type: 'debit_note',
              referenceId: newReturn.id,
              referenceType: 'purchase_return',
              amount: -total,
              balance: newBalance,
              description: `Debit Note ${noteNo} for Return ${returnNo}`,
              date: new Date(),
            },
          });
        }
      } else if (
        supplierId &&
        (refundMethod === PurchaseRefundMethod.CASH ||
          refundMethod === PurchaseRefundMethod.BANK)
      ) {
        const party = await tx.party.findFirst({
          where: {
            id: supplierId,
            businessId,
            ...(!isMainBranch && { branchId }),
          },
        });
        if (party) {
          const newBalance = party.currentBalance - total;
          await tx.party.update({
            where: { id: supplierId },
            data: { currentBalance: newBalance },
          });

          await tx.partyLedger.create({
            data: {
              businessId,
              branchId,
              partyId: supplierId,
              type: 'refund',
              referenceId: newReturn.id,
              referenceType: 'purchase_return',
              amount: -total,
              balance: newBalance,
              description: `Refund received for Return ${returnNo}`,
              date: new Date(),
            },
          });

          if (accountId) {
            const account = await tx.account.findUnique({
              where: { id: accountId },
            });
            if (account) {
              await tx.account.update({
                where: { id: accountId },
                data: { currentBalance: account.currentBalance + total }, // Supplier returned cash to us
              });

              await tx.payment.create({
                data: {
                  businessId,
                  branchId,
                  partyId: supplierId,
                  type: 'refund_received',
                  mode: refundMethod,
                  accountId: accountId,
                  amount: total,
                  purchaseId: purchaseId,
                  reference: `Refund for PR ${returnNo}`,
                  createdBy: userId,
                },
              });
            }
          }
        }
      }

      return newReturn;
    });

    this.logger.info(
      { returnId: returnRecord.id, businessId },
      'Purchase Return processed',
    );
    return { success: true, data: returnRecord };
  }
}
