import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Prisma } from '@prisma/client';
import {
  CreateQuotationDto,
  QuotationStatus,
} from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { EditQuotationDto } from './dto/edit-quotation.dto';
import { QueryQuotationDto } from './dto/query-quotation.dto';
import { StoredQuotationItem } from './quotation.types';
import type { JwtUser } from 'src/auth/types/jwt-user.type';

// ─── Quotation number generator ───────────────────────────────────────────────
// Format: QT-YYYYMMDD-0001  (daily sequence, same strategy as invoices)

async function generateQuotationNo(
  tx: Prisma.TransactionClient,
  businessId: string,
): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `QT-${dateStr}-`;
  const last = await tx.quotation.findFirst({
    where: { businessId, quotationNo: { startsWith: prefix } },
    orderBy: { quotationNo: 'desc' },
  });
  const next = last ? parseInt(last.quotationNo.slice(-4), 10) + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

// ─── Item builder ─────────────────────────────────────────────────────────────

function buildStoredItems(
  inputs: Array<{
    itemId: string;
    itemName?: string;
    quantity: number;
    unitPrice: number;
    discount?: number;
  }>,
  itemNameMap: Map<string, string>,
): StoredQuotationItem[] {
  return inputs.map((input, idx) => {
    const discount = input.discount ?? 0;
    return {
      id: String(idx + 1),
      itemId: input.itemId,
      itemName: input.itemName ?? itemNameMap.get(input.itemId) ?? input.itemId,
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      discount,
      total: input.quantity * input.unitPrice - discount,
    };
  });
}

// ─── Response transformer ─────────────────────────────────────────────────────

function parseQuotation(q: { items: string; [key: string]: unknown }) {
  return {
    ...q,
    items: JSON.parse(q.items) as StoredQuotationItem[],
  };
}

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(QuotationsService.name)
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

  // ─── LIST ──────────────────────────────────────────────────────────────────
  async findAll(user: JwtUser, query: QueryQuotationDto) {
    const { branchId, isMainBranch } = this.checkBranchAccess(user);
    const businessId = user.businessId;
    const page = parseInt(query.page ?? '1', 10);
    const limit = parseInt(query.limit ?? '20', 10);

    const where: Prisma.QuotationWhereInput = { businessId };

    if (!isMainBranch) {
      where.branchId = branchId;
    } else if (query.branchId) {
      where.branchId = query.branchId;
    }

    if (query.status && query.status !== 'all') where.status = query.status;
    if (query.partyId) where.partyId = query.partyId;

    if (query.startDate || query.endDate) {
      where.quotationDate = {};
      if (query.startDate) where.quotationDate.gte = new Date(query.startDate);
      if (query.endDate) {
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        where.quotationDate.lte = end;
      }
    }

    if (query.search) {
      where.OR = [
        { quotationNo: { contains: query.search, mode: 'insensitive' } },
        { partyName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [quotations, total] = await Promise.all([
      this.prisma.quotation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.quotation.count({ where }),
    ]);

    return {
      success: true,
      data: quotations.map(parseQuotation),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─── GET ONE ───────────────────────────────────────────────────────────────
  async findOne(user: JwtUser, id: string) {
    const { branchId, isMainBranch } = this.checkBranchAccess(user);
    const businessId = user.businessId;

    const where: Prisma.QuotationWhereInput = { id, businessId };
    if (!isMainBranch) {
      where.branchId = branchId;
    }

    const quotation = await this.prisma.quotation.findFirst({
      where,
    });

    if (!quotation) throw new NotFoundException(`Quotation ${id} not found.`);

    return { success: true, data: parseQuotation(quotation) };
  }

  // ─── CREATE ────────────────────────────────────────────────────────────────
  async create(user: JwtUser, dto: CreateQuotationDto) {
    const { branchId, isMainBranch } = this.checkBranchAccess(user);
    const businessId = user.businessId;

    // Validate all items belong to this business and branch
    const itemIds = dto.items.map((i) => i.itemId);
    const dbItems = await this.prisma.item.findMany({
      where: {
        id: { in: itemIds },
        businessId,
        ...(!isMainBranch && { branchId }),
      },
      select: { id: true, name: true },
    });

    if (dbItems.length !== itemIds.length) {
      const foundIds = new Set(dbItems.map((i) => i.id));
      const missing = itemIds.filter((id) => !foundIds.has(id));
      throw new BadRequestException(`Items not found: ${missing.join(', ')}`);
    }

    // Validate party belongs to active branch
    if (dto.partyId) {
      const party = await this.prisma.party.findFirst({
        where: {
          id: dto.partyId,
          businessId,
          deletedAt: null,
          ...(!isMainBranch && { branchId }),
        },
      });
      if (!party) throw new BadRequestException('Party not found.');
    }

    const itemNameMap = new Map(dbItems.map((i) => [i.id, i.name]));
    const storedItems = buildStoredItems(dto.items, itemNameMap);

    const subtotal = storedItems.reduce((sum, i) => sum + i.total, 0);
    const discount = dto.discount ?? 0;
    const tax = dto.tax ?? 0;
    const total = subtotal - discount + tax;

    const quotation = await this.prisma.$transaction(async (tx) => {
      const quotationNo = await generateQuotationNo(tx, businessId);

      return tx.quotation.create({
        data: {
          businessId,
          branchId,
          quotationNo,
          partyId: dto.partyId ?? null,
          partyName: dto.partyName ?? null,
          items: JSON.stringify(storedItems),
          subtotal,
          discount,
          tax,
          total,
          validityDate: new Date(dto.validityDate),
          quotationDate: dto.quotationDate
            ? new Date(dto.quotationDate)
            : new Date(),
          status: dto.status ?? QuotationStatus.DRAFT,
          notes: dto.notes ?? null,
        },
      });
    });

    this.logger.info(
      {
        quotationId: quotation.id,
        businessId,
        quotationNo: quotation.quotationNo,
      },
      'Quotation created',
    );
    return { success: true, data: parseQuotation(quotation) };
  }

  // ─── EDIT (full content edit) ──────────────────────────────────────────────
  // PUT /quotations/:id — replaces items, recalculates totals.
  // Only DRAFT and SENT quotations can be edited.
  async editQuotation(user: JwtUser, id: string, dto: EditQuotationDto) {
    const { branchId, isMainBranch } = this.checkBranchAccess(user);
    const businessId = user.businessId;

    const where: Prisma.QuotationWhereInput = { id, businessId };
    if (!isMainBranch) {
      where.branchId = branchId;
    }

    const existing = await this.prisma.quotation.findFirst({
      where,
    });

    if (!existing) throw new NotFoundException(`Quotation ${id} not found.`);

    const existingStatus = existing.status as QuotationStatus;
    if (
      existingStatus === QuotationStatus.ACCEPTED ||
      existingStatus === QuotationStatus.CONVERTED ||
      existingStatus === QuotationStatus.REJECTED
    ) {
      throw new ForbiddenException(
        `Cannot edit a ${existing.status} quotation.`,
      );
    }

    // Validate party belongs to active branch
    if (dto.partyId) {
      const party = await this.prisma.party.findFirst({
        where: {
          id: dto.partyId,
          businessId,
          deletedAt: null,
          ...(!isMainBranch && { branchId }),
        },
      });
      if (!party) throw new BadRequestException('Party not found.');
    }

    // If new items supplied, validate and rebuild
    let storedItems: StoredQuotationItem[] | null = null;

    if (dto.items && dto.items.length > 0) {
      const itemIds = dto.items.map((i) => i.itemId);
      const dbItems = await this.prisma.item.findMany({
        where: {
          id: { in: itemIds },
          businessId,
          ...(!isMainBranch && { branchId }),
        },
        select: { id: true, name: true },
      });

      if (dbItems.length !== itemIds.length) {
        const foundIds = new Set(dbItems.map((i) => i.id));
        const missing = itemIds.filter((i) => !foundIds.has(i));
        throw new BadRequestException(`Items not found: ${missing.join(', ')}`);
      }

      storedItems = buildStoredItems(
        dto.items,
        new Map(dbItems.map((i) => [i.id, i.name])),
      );
    }

    const itemsForCalc =
      storedItems ?? (JSON.parse(existing.items) as StoredQuotationItem[]);
    const newSubtotal = itemsForCalc.reduce((sum, i) => sum + i.total, 0);
    const newDiscount =
      dto.discount !== undefined ? dto.discount : existing.discount;
    const newTax = dto.tax !== undefined ? dto.tax : existing.tax;
    const newTotal = newSubtotal - newDiscount + newTax;

    const updated = await this.prisma.quotation.update({
      where: { id },
      data: {
        ...(dto.partyId !== undefined && { partyId: dto.partyId }),
        ...(dto.partyName !== undefined && { partyName: dto.partyName }),
        ...(storedItems && { items: JSON.stringify(storedItems) }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.validityDate !== undefined && {
          validityDate: new Date(dto.validityDate),
        }),
        ...(dto.quotationDate !== undefined && {
          quotationDate: new Date(dto.quotationDate),
        }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        subtotal: newSubtotal,
        discount: newDiscount,
        tax: newTax,
        total: newTotal,
      },
    });

    this.logger.info(
      { quotationId: id, businessId, branchId },
      'Quotation edited',
    );
    return { success: true, data: parseQuotation(updated) };
  }

  // ─── UPDATE STATUS ─────────────────────────────────────────────────────────
  // PATCH /quotations/:id — status transitions and convertedToSaleId
  async update(user: JwtUser, id: string, dto: UpdateQuotationDto) {
    const { branchId, isMainBranch } = this.checkBranchAccess(user);
    const businessId = user.businessId;

    const where: Prisma.QuotationWhereInput = { id, businessId };
    if (!isMainBranch) {
      where.branchId = branchId;
    }

    const existing = await this.prisma.quotation.findFirst({
      where,
    });

    if (!existing) throw new NotFoundException(`Quotation ${id} not found.`);

    const existingStatus = existing.status as QuotationStatus;

    // Guard against updating already-converted quotations
    if (
      existingStatus === QuotationStatus.CONVERTED &&
      dto.status !== undefined
    ) {
      throw new ForbiddenException(
        'Cannot change status of a converted quotation.',
      );
    }

    const updated = await this.prisma.quotation.update({
      where: { id },
      data: {
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.convertedToSaleId !== undefined && {
          convertedToSaleId: dto.convertedToSaleId,
        }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });

    this.logger.info(
      { quotationId: id, businessId, status: dto.status },
      'Quotation status updated',
    );
    return { success: true, data: parseQuotation(updated) };
  }

  // ─── CONVERT TO SALE ───────────────────────────────────────────────────────
  // POST /quotations/:id/convert
  // Creates a Sale from the quotation, marks quotation as converted.
  // Does NOT deduct stock — the sale service will handle that.
  async convertToSale(user: JwtUser, id: string) {
    const { branchId, isMainBranch } = this.checkBranchAccess(user);
    const businessId = user.businessId;
    const userId = user.id;

    const where: Prisma.QuotationWhereInput = { id, businessId };
    if (!isMainBranch) {
      where.branchId = branchId;
    }

    const quotation = await this.prisma.quotation.findFirst({
      where,
    });

    if (!quotation) throw new NotFoundException(`Quotation ${id} not found.`);

    const status = quotation.status as QuotationStatus;

    if (status === QuotationStatus.CONVERTED) {
      throw new ForbiddenException(
        'Quotation has already been converted to a sale.',
      );
    }

    if (
      status === QuotationStatus.REJECTED ||
      status === QuotationStatus.EXPIRED
    ) {
      throw new ForbiddenException(
        `Cannot convert a ${quotation.status} quotation.`,
      );
    }

    const parsedItems = JSON.parse(quotation.items) as StoredQuotationItem[];

    // Validate all items still exist and have enough stock
    const itemIds = parsedItems.map((i) => i.itemId);
    const dbItems = await this.prisma.item.findMany({
      where: {
        id: { in: itemIds },
        businessId,
        ...(!isMainBranch && { branchId }),
      },
    });

    if (dbItems.length !== itemIds.length) {
      const foundIds = new Set(dbItems.map((i) => i.id));
      const missing = itemIds.filter((id) => !foundIds.has(id));
      throw new BadRequestException(
        `Items no longer available: ${missing.join(', ')}`,
      );
    }

    const itemMap = new Map(dbItems.map((i) => [i.id, i]));

    for (const qi of parsedItems) {
      const dbItem = itemMap.get(qi.itemId)!;
      if (dbItem.currentStock < qi.quantity) {
        throw new BadRequestException(
          `Insufficient stock for "${dbItem.name}". Available: ${dbItem.currentStock}, Required: ${qi.quantity}`,
        );
      }
    }

    // Run inside a transaction: create sale + mark quotation converted
    const sale = await this.prisma.$transaction(async (tx) => {
      // Build invoice number (same daily-sequence strategy)
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const invoicePrefix = `INV-${dateStr}-`;
      const lastSale = await tx.sale.findFirst({
        where: { businessId, invoiceNo: { startsWith: invoicePrefix } },
        orderBy: { invoiceNo: 'desc' },
      });
      const nextNo = lastSale
        ? parseInt(lastSale.invoiceNo.slice(-4), 10) + 1
        : 1;
      const invoiceNo = `${invoicePrefix}${String(nextNo).padStart(4, '0')}`;

      const dueAmount = quotation.total; // assume full credit until payment recorded

      const newSale = await tx.sale.create({
        data: {
          businessId,
          branchId,
          invoiceNo,
          partyId: quotation.partyId ?? null,
          subtotal: quotation.subtotal,
          discount: quotation.discount,
          tax: quotation.tax,
          total: quotation.total,
          paidAmount: 0,
          dueAmount,
          paymentMethod: 'cash', // default — can be updated via PATCH /sales/:id
          status: 'pending',
          profit: 0, // recalculated when items are resolved
          notes: quotation.notes ?? null,
          createdBy: userId,
          items: {
            create: parsedItems.map((qi) => {
              const dbItem = itemMap.get(qi.itemId)!;
              const itemProfit =
                (qi.unitPrice - dbItem.costPrice) * qi.quantity - qi.discount;
              return {
                itemId: qi.itemId,
                itemName: qi.itemName,
                quantity: qi.quantity,
                unitPrice: qi.unitPrice,
                costPrice: dbItem.costPrice,
                discount: qi.discount,
                total: qi.total,
                profit: itemProfit,
              };
            }),
          },
        },
      });

      // Deduct stock + write stock ledger for each item
      for (const qi of parsedItems) {
        const dbItem = itemMap.get(qi.itemId)!;
        const newStock = dbItem.currentStock - qi.quantity;

        await tx.item.update({
          where: { id: qi.itemId },
          data: { currentStock: newStock, lastSaleDate: new Date() },
        });

        await tx.stockLedger.create({
          data: {
            businessId,
            branchId,
            itemId: qi.itemId,
            type: 'sale',
            quantity: -qi.quantity,
            previousStock: dbItem.currentStock,
            newStock,
            referenceId: newSale.id,
            referenceType: 'sale',
            reason: `Converted from quotation ${quotation.quotationNo}`,
            createdBy: userId,
          },
        });
      }

      // Update party balance if partyId is set
      if (quotation.partyId && dueAmount > 0) {
        const party = await tx.party.findUnique({
          where: { id: quotation.partyId },
        });
        if (party) {
          const newBalance = party.currentBalance + dueAmount;
          await tx.party.update({
            where: { id: quotation.partyId },
            data: { currentBalance: newBalance },
          });
          await tx.partyLedger.create({
            data: {
              businessId,
              branchId,
              partyId: quotation.partyId,
              type: 'sale',
              referenceId: newSale.id,
              referenceType: 'sale',
              amount: dueAmount,
              balance: newBalance,
              description: `Sale from quotation ${quotation.quotationNo} - Invoice ${invoiceNo}`,
              date: new Date(),
            },
          });
        }
      }

      // Mark quotation as converted
      await tx.quotation.update({
        where: { id },
        data: {
          status: QuotationStatus.CONVERTED,
          convertedToSaleId: newSale.id,
        },
      });

      return newSale;
    });

    this.logger.info(
      { quotationId: id, saleId: sale.id, businessId },
      'Quotation converted to sale',
    );

    return {
      success: true,
      data: {
        saleId: sale.id,
        invoiceNo: sale.invoiceNo,
        quotationId: id,
        quotationNo: quotation.quotationNo,
      },
    };
  }

  // ─── DELETE ────────────────────────────────────────────────────────────────
  // Only DRAFT quotations can be hard-deleted.
  async remove(user: JwtUser, id: string) {
    const { branchId, isMainBranch } = this.checkBranchAccess(user);
    const businessId = user.businessId;

    const where: Prisma.QuotationWhereInput = { id, businessId };
    if (!isMainBranch) {
      where.branchId = branchId;
    }

    const existing = await this.prisma.quotation.findFirst({
      where,
    });

    if (!existing) throw new NotFoundException(`Quotation ${id} not found.`);

    const existingStatus = existing.status as QuotationStatus;
    if (existingStatus !== QuotationStatus.DRAFT) {
      throw new ForbiddenException(
        `Only draft quotations can be deleted. This quotation is "${existing.status}".`,
      );
    }

    await this.prisma.quotation.delete({ where: { id } });

    this.logger.info(
      { quotationId: id, businessId, branchId },
      'Quotation deleted',
    );
    return { success: true, data: { id } };
  }

  // ─── SUMMARY ───────────────────────────────────────────────────────────────
  async getSummary(user: JwtUser) {
    const { branchId, isMainBranch } = this.checkBranchAccess(user);
    const businessId = user.businessId;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const where: Prisma.QuotationWhereInput = { businessId };
    if (!isMainBranch) {
      where.branchId = branchId;
    }

    const monthWhere: Prisma.QuotationWhereInput = {
      ...where,
      createdAt: { gte: monthStart, lt: monthEnd },
    };

    const [
      totalCount,
      monthCount,
      statusCounts,
      monthAgg,
      allTimeAgg,
      conversionCount,
    ] = await Promise.all([
      this.prisma.quotation.count({ where }),
      this.prisma.quotation.count({
        where: monthWhere,
      }),
      // Count per status
      this.prisma.quotation.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.quotation.aggregate({
        where: monthWhere,
        _sum: { total: true },
        _avg: { total: true },
      }),
      this.prisma.quotation.aggregate({
        where,
        _sum: { total: true },
        _avg: { total: true },
      }),
      // Converted = accepted into a sale
      this.prisma.quotation.count({
        where: { ...where, status: QuotationStatus.CONVERTED },
      }),
    ]);

    // Build status breakdown map
    const statusBreakdown: Record<string, number> = {};
    for (const s of statusCounts) {
      statusBreakdown[s.status] = s._count._all;
    }

    const conversionRate =
      totalCount > 0
        ? parseFloat(((conversionCount / totalCount) * 100).toFixed(1))
        : 0;

    return {
      success: true,
      data: {
        total: {
          count: totalCount,
          totalValue: allTimeAgg._sum.total ?? 0,
          avgValue: allTimeAgg._avg.total ?? 0,
        },
        thisMonth: {
          count: monthCount,
          totalValue: monthAgg._sum.total ?? 0,
          avgValue: monthAgg._avg.total ?? 0,
        },
        statusBreakdown,
        conversionRate, // % of quotations that became sales
        convertedCount: conversionCount,
      },
    };
  }
}
