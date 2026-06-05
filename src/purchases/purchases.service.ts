import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Prisma } from '@prisma/client';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import { QueryPurchaseDto } from './dto/query-purchase.dto';

import type { JwtUser } from 'src/auth/types/jwt-user.type';

const listPurchaseInclude = {
  items: {
    include: {
      item: { select: { id: true, name: true, sku: true } },
      batch: true,
    },
  },
  supplier: { select: { id: true, name: true, phone: true } },
} satisfies Prisma.PurchaseInclude;

export const PURCHASE_STATUS = {
  RECEIVED: 'received',
  PENDING: 'pending',
  PARTIAL: 'partial',
  CANCELLED: 'cancelled',
} as const;

export type PurchaseStatus =
  (typeof PURCHASE_STATUS)[keyof typeof PURCHASE_STATUS];

const ACCOUNT_TYPE_MAP: Record<
  string,
  { type: string; name: string; nameBn: string }
> = {
  cash: { type: 'cash', name: 'Cash', nameBn: 'নগদ' },
  bank: { type: 'bank', name: 'Bank', nameBn: 'ব্যাংক' },
  mobile_banking: {
    type: 'mobile_wallet',
    name: 'Mobile Wallet',
    nameBn: 'মোবাইল ওয়ালেট',
  },
};

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(PurchasesService.name)
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

  private async generatePurchaseNo(
    tx: Prisma.TransactionClient,
    businessId: string,
  ): Promise<string> {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `PUR-${dateStr}-`;
    const last = await tx.purchase.findFirst({
      where: { businessId, id: { startsWith: prefix } },
      orderBy: { grnNo: 'desc' },
    });
    const next =
      last && last.grnNo ? parseInt(last.grnNo.slice(-4), 10) + 1 : 1;
    return `${prefix}${String(next).padStart(4, '0')}`;
  }

  async findAll(user: JwtUser, query: QueryPurchaseDto) {
    const { branchId, isMainBranch } = this.checkBranchAccess(user);
    const businessId = user.businessId;
    const page = parseInt(query.page?.toString() ?? '1', 10);
    const limit = parseInt(query.limit?.toString() ?? '20', 10);

    const where: Prisma.PurchaseWhereInput = { businessId };
    if (!isMainBranch) {
      where.branchId = branchId;
    }
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.status && query.status !== 'all') where.status = query.status;

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
        { grnNo: { contains: query.search, mode: 'insensitive' } },
        { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [purchases, total] = await Promise.all([
      this.prisma.purchase.findMany({
        where,
        include: listPurchaseInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.purchase.count({ where }),
    ]);

    return {
      success: true,
      data: purchases,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(user: JwtUser, id: string) {
    const { branchId, isMainBranch } = this.checkBranchAccess(user);
    const businessId = user.businessId;

    const where: Prisma.PurchaseWhereInput = {
      id,
      businessId,
    };
    if (!isMainBranch) {
      where.branchId = branchId;
    }

    const purchase = await this.prisma.purchase.findFirst({
      where,
      include: listPurchaseInclude,
    });

    if (!purchase) throw new NotFoundException(`Purchase ${id} not found.`);
    return { success: true, data: purchase };
  }

  async create(user: JwtUser, dto: CreatePurchaseDto) {
    const { branchId, isMainBranch } = this.checkBranchAccess(user);
    const businessId = user.businessId;
    const userId = user.id;

    const {
      supplierId,
      invoiceNo,
      items,
      discount = 0,
      tax = 0,
      paidAmount = 0,
      paymentMethod = 'cash',
      accountId,
      notes,
    } = dto;

    const purchase = await this.prisma.$transaction(async (tx) => {
      const generatedGrnNo = await this.generatePurchaseNo(tx, businessId);

      interface PurchaseItemData {
        itemId: string;
        batchId: string | null;
        itemName: string;
        quantity: number;
        unitCost: number;
        total: number;
      }
      const purchaseItemsData: PurchaseItemData[] = [];
      let subtotal = 0;

      for (const input of items) {
        const dbItem = await tx.item.findFirst({
          where: {
            id: input.itemId,
            businessId,
            ...(!isMainBranch && { branchId }),
          },
        });
        if (!dbItem)
          throw new BadRequestException(`Item not found: ${input.itemId}`);

        const itemTotal = input.quantity * input.unitCost;
        subtotal += itemTotal;

        let batchId: string | null = null;

        // If batch tracked, create a batch
        if (dbItem.trackBatch || input.trackBatch) {
          const dateStr = new Date()
            .toISOString()
            .slice(0, 10)
            .replace(/-/g, '');
          const batchNumber =
            input.batchNumber ||
            `BATCH-${dateStr}-${Math.floor(Math.random() * 10000)}`;

          const newBatch = await tx.batch.create({
            data: {
              businessId,
              itemId: input.itemId,
              batchNumber,
              quantity: input.quantity,
              remainingQty: input.quantity,
              costPrice: input.unitCost,
              mrp: input.mrp,
              expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
              manufactureDate: input.manufactureDate
                ? new Date(input.manufactureDate)
                : null,
              location: input.location,
            },
          });
          batchId = newBatch.id;
        }

        purchaseItemsData.push({
          itemId: input.itemId,
          batchId,
          itemName: input.itemName ?? dbItem.name,
          quantity: input.quantity,
          unitCost: input.unitCost,
          total: itemTotal,
        });
      }

      const total = subtotal - discount + tax;
      const dueAmount = total - paidAmount;
      const status =
        dueAmount > 0
          ? paidAmount > 0
            ? PURCHASE_STATUS.PARTIAL
            : PURCHASE_STATUS.PENDING
          : PURCHASE_STATUS.RECEIVED;

      const newPurchase = await tx.purchase.create({
        data: {
          businessId,
          branchId,
          supplierId: supplierId || null,
          invoiceNo: invoiceNo || null,
          grnNo: generatedGrnNo,
          subtotal,
          discount,
          tax,
          total,
          paidAmount,
          dueAmount,
          status,
          notes,
          createdBy: userId,
          items: {
            create: purchaseItemsData,
          },
        },
        include: listPurchaseInclude,
      });

      // Stock Updates and Ledger Entry
      for (const itemData of purchaseItemsData) {
        const currentItem = await tx.item.findUnique({
          where: { id: itemData.itemId },
        });
        const prevStock = currentItem!.currentStock;
        const newStock = prevStock + itemData.quantity;

        await tx.item.update({
          where: { id: itemData.itemId },
          data: {
            currentStock: newStock,
            costPrice: itemData.unitCost, // update item cost price
            lastPurchaseDate: new Date(),
          },
        });

        await tx.stockLedger.create({
          data: {
            businessId,
            branchId,
            itemId: itemData.itemId,
            batchId: itemData.batchId,
            type: 'purchase',
            quantity: itemData.quantity,
            previousStock: prevStock,
            newStock: newStock,
            referenceId: newPurchase.id,
            referenceType: 'purchase',
            createdBy: userId,
          },
        });
      }

      // Party Ledger updates
      if (supplierId && dueAmount > 0) {
        const party = await tx.party.findFirst({
          where: {
            id: supplierId,
            businessId,
            ...(!isMainBranch && { branchId }),
          },
        });
        if (party) {
          const newBalance = party.currentBalance + dueAmount;
          await tx.party.update({
            where: { id: supplierId },
            data: { currentBalance: newBalance },
          });
          await tx.partyLedger.create({
            data: {
              businessId,
              branchId,
              partyId: supplierId,
              type: 'purchase',
              referenceId: newPurchase.id,
              referenceType: 'purchase',
              amount: dueAmount, // positive increases supplier payable
              balance: newBalance,
              description: `Credit purchase - GRN ${generatedGrnNo}`,
              date: new Date(),
            },
          });
        }
      }

      // Handle immediate payments
      if (paidAmount > 0) {
        const accountMeta =
          ACCOUNT_TYPE_MAP[paymentMethod] ?? ACCOUNT_TYPE_MAP['cash'];

        // Find existing account or create one
        let account = accountId
          ? await tx.account.findUnique({ where: { id: accountId } })
          : await tx.account.findFirst({
              where: { businessId, branchId, type: accountMeta.type },
            });

        if (!account) {
          account = await tx.account.create({
            data: {
              businessId,
              branchId,
              name: accountMeta.name,
              nameBn: accountMeta.nameBn,
              type: accountMeta.type,
              isDefault: true,
              status: 'active',
              currentBalance: 0,
            },
          });
        }

        // Deduct from account because it's a purchase (money is spent)
        await tx.account.update({
          where: { id: account.id },
          data: { currentBalance: account.currentBalance - paidAmount },
        });

        await tx.payment.create({
          data: {
            businessId,
            branchId,
            partyId: supplierId || undefined,
            type: 'purchase',
            mode: paymentMethod,
            accountId: account.id,
            amount: paidAmount, // Amount is positive, but it's a 'purchase' type meaning money out
            purchaseId: newPurchase.id,
            reference: `Payment for GRN ${generatedGrnNo}`,
            createdBy: userId,
          },
        });
      }

      return newPurchase;
    });

    this.logger.info(
      { purchaseId: purchase.id, businessId },
      'Purchase created',
    );
    return { success: true, data: purchase };
  }

  async updateStatus(user: JwtUser, id: string, dto: UpdatePurchaseDto) {
    const { branchId, isMainBranch } = this.checkBranchAccess(user);
    const businessId = user.businessId;
    const userId = user.id;

    const where: Prisma.PurchaseWhereInput = {
      id,
      businessId,
    };
    if (!isMainBranch) {
      where.branchId = branchId;
    }

    const existing = await this.prisma.purchase.findFirst({
      where,
      include: { items: true, supplier: true },
    });

    if (!existing) throw new NotFoundException(`Purchase ${id} not found.`);

    if (existing.status === PURCHASE_STATUS.CANCELLED) {
      throw new ForbiddenException(`Cannot modify a cancelled purchase.`);
    }

    const { status, notes } = dto;

    const purchase = await this.prisma.$transaction(async (tx) => {
      // Handle cancellation logic (reversing)
      if (status === PURCHASE_STATUS.CANCELLED) {
        for (const purchaseItem of existing.items) {
          const item = await tx.item.findUnique({
            where: { id: purchaseItem.itemId },
          });
          if (!item) continue;

          const restoredStock = item.currentStock - purchaseItem.quantity;

          await tx.item.update({
            where: { id: purchaseItem.itemId },
            data: { currentStock: restoredStock >= 0 ? restoredStock : 0 },
          });

          if (purchaseItem.batchId) {
            await tx.batch.update({
              where: { id: purchaseItem.batchId },
              data: { remainingQty: { decrement: purchaseItem.quantity } },
            });
          }

          await tx.stockLedger.create({
            data: {
              businessId,
              branchId: existing.branchId ?? branchId,
              itemId: purchaseItem.itemId,
              type: 'adjustment',
              quantity: -purchaseItem.quantity,
              previousStock: item.currentStock,
              newStock: restoredStock,
              referenceId: existing.id,
              referenceType: 'purchase',
              reason: 'Purchase cancelled',
              createdBy: userId,
            },
          });
        }

        // Reverse party ledger
        if (existing.supplierId && existing.dueAmount > 0) {
          const party = await tx.party.findFirst({
            where: {
              id: existing.supplierId,
              businessId,
              ...(!isMainBranch && { branchId }),
            },
          });
          if (party) {
            const newBalance = party.currentBalance - existing.dueAmount;
            await tx.party.update({
              where: { id: existing.supplierId },
              data: { currentBalance: newBalance },
            });
            await tx.partyLedger.create({
              data: {
                businessId,
                branchId: existing.branchId ?? branchId,
                partyId: existing.supplierId,
                type: 'adjustment',
                referenceId: existing.id,
                referenceType: 'purchase',
                amount: -existing.dueAmount,
                balance: newBalance,
                description: `Purchase cancelled - GRN ${existing.grnNo}`,
                date: new Date(),
              },
            });
          }
        }
      }

      return tx.purchase.update({
        where: { id },
        data: {
          ...(status !== undefined && { status }),
          ...(notes !== undefined && { notes: notes ?? null }),
        },
        include: listPurchaseInclude,
      });
    });

    this.logger.info(
      { purchaseId: id, businessId, status },
      'Purchase status updated',
    );
    return { success: true, data: purchase };
  }

  async remove(user: JwtUser, id: string) {
    return this.updateStatus(user, id, { status: PURCHASE_STATUS.CANCELLED });
  }
}
