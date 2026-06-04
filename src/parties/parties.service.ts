import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Prisma } from '@prisma/client';
import { CreatePartyDto } from './dto/create-party.dto';
import { UpdatePartyDto } from './dto/update-party.dto';
import { QueryPartyDto } from './dto/query-party.dto';

// ─── Prisma include shapes ────────────────────────────────────────────────────

const listPartySelect = {
  id: true,
  name: true,
  phone: true,
  type: true,
  currentBalance: true,
  isActive: true,
  createdAt: true,
  category: { select: { id: true, name: true, nameBn: true } },
} satisfies Prisma.PartySelect;

const singlePartyInclude = {
  category: { select: { id: true, name: true, nameBn: true } },
  // branch: { select: { id: true, name: true, nameBn: true } },
  sales: {
    select: {
      id: true,
      invoiceNo: true,
      total: true,
      paidAmount: true,
      dueAmount: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' as const },
    take: 10,
  },
  purchases: {
    select: {
      id: true,
      invoiceNo: true,
      total: true,
      paidAmount: true,
      dueAmount: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' as const },
    take: 10,
  },
  payments: {
    select: {
      id: true,
      type: true,
      mode: true,
      amount: true,
      reference: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' as const },
    take: 10,
  },
} satisfies Prisma.PartyInclude;

type SingleParty = Prisma.PartyGetPayload<{
  include: typeof singlePartyInclude;
}>;

// ─── Response transformers ────────────────────────────────────────────────────

function transformSingleParty(party: SingleParty) {
  return { ...party };
}

@Injectable()
export class PartiesService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(PartiesService.name)
    private readonly logger: PinoLogger,
  ) {}

  // ─── LIST ──────────────────────────────────────────────────────────────────
  async findAll(businessId: string, query: QueryPartyDto) {
    const page = parseInt(query.page ?? '1', 10);
    const limit = parseInt(query.limit ?? '50', 10);

    const where: Prisma.PartyWhereInput = {
      businessId,
      // Show only active by default unless caller explicitly passes isActive=false
      isActive: query.isActive !== undefined ? query.isActive : true,
    };

    if (query.type && query.type !== 'all') where.type = query.type;
    if (query.branchId) where.branchId = query.branchId;
    if (query.customerTier) where.customerTier = query.customerTier;
    if (query.riskLevel) where.riskLevel = query.riskLevel;

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [parties, total] = await Promise.all([
      this.prisma.party.findMany({
        where,
        select: listPartySelect,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.party.count({ where }),
    ]);

    // Summary statistics (scoped to current filter, not just page)
    const summary = {
      total,
      customers: parties.filter((p) => p.type === 'customer').length,
      suppliers: parties.filter((p) => p.type === 'supplier').length,
      totalReceivable: parties
        .filter((p) => p.type === 'customer')
        .reduce(
          (sum, p) => sum + (p.currentBalance > 0 ? p.currentBalance : 0),
          0,
        ),
      totalPayable: parties
        .filter((p) => p.type === 'supplier')
        .reduce(
          (sum, p) =>
            sum + (p.currentBalance < 0 ? Math.abs(p.currentBalance) : 0),
          0,
        ),
    };

    return {
      success: true,
      data: parties,
      summary,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─── GET ONE ───────────────────────────────────────────────────────────────
  async findOne(businessId: string, id: string) {
    const party = await this.prisma.party.findFirst({
      where: { id, businessId },
      include: singlePartyInclude,
    });

    if (!party) throw new NotFoundException(`Party ${id} not found.`);

    // Ledger (last 50 entries)
    const ledgerEntries = await this.prisma.partyLedger.findMany({
      where: { partyId: id },
      orderBy: { date: 'desc' },
      take: 50,
    });

    // Aggregate stats
    const totalSalesAgg = await this.prisma.sale.aggregate({
      where: { partyId: id, status: 'completed' },
      _sum: { total: true },
    });
    const totalPurchasesAgg = await this.prisma.purchase.aggregate({
      where: { supplierId: id, status: 'received' },
      _sum: { total: true },
    });
    const totalReceivedAgg = await this.prisma.payment.aggregate({
      where: { partyId: id, type: 'received' },
      _sum: { amount: true },
    });
    const totalPaidAgg = await this.prisma.payment.aggregate({
      where: { partyId: id, type: 'paid' },
      _sum: { amount: true },
    });

    const totalSalesAmount: number = totalSalesAgg._sum.total ?? 0;
    const totalPurchasesAmount: number = totalPurchasesAgg._sum.total ?? 0;
    const totalPaymentsReceived: number = totalReceivedAgg._sum.amount ?? 0;
    const totalPaymentsMade: number = totalPaidAgg._sum.amount ?? 0;

    const stats = {
      totalSalesAmount,
      totalPurchasesAmount,
      totalPaymentsReceived,
      totalPaymentsMade,
      salesCount: party.sales.length,
      purchasesCount: party.purchases.length,
      paymentsCount: party.payments.length,
    };

    return {
      success: true,
      data: {
        ...transformSingleParty(party),
        ledgerEntries,
        stats,
      },
    };
  }

  // ─── CREATE ────────────────────────────────────────────────────────────────
  async create(businessId: string, dto: CreatePartyDto) {
    // Duplicate phone guard
    if (dto.phone) {
      const existing = await this.prisma.party.findFirst({
        where: { businessId, phone: dto.phone, isActive: true },
      });
      if (existing) {
        throw new ConflictException(
          'A party with this phone number already exists.',
        );
      }
    }

    // Validate category ownership
    // if (dto.categoryId) {
    //   const category = await this.prisma.partyCategory.findUnique({
    //     where: { id: dto.categoryId },
    //   });
    //   if (!category || category.businessId !== businessId) {
    //     throw new BadRequestException('Invalid party category.');
    //   }
    // }

    // Validate branch ownership
    if (dto.branchId) {
      const branch = await this.prisma.branch.findUnique({
        where: { id: dto.branchId },
      });
      if (!branch || branch.businessId !== businessId) {
        throw new BadRequestException('Invalid branch.');
      }
    }

    const openingBalance = dto.openingBalance ?? 0;

    const party = await this.prisma.$transaction(async (tx) => {
      const newParty = await tx.party.create({
        data: {
          businessId,
          name: dto.name.trim(),
          phone: dto.phone?.trim() ?? null,
          email: dto.email?.trim() ?? null,
          address: dto.address?.trim() ?? null,
          type: dto.type ?? 'customer',
          // customerTier: dto.customerTier ?? null,
          // categoryId: dto.categoryId ?? null,
          branchId: dto.branchId ?? null,
          openingBalance,
          currentBalance: openingBalance,
          creditLimit: dto.creditLimit ?? null,
          // paymentTerms: dto.paymentTerms ?? null,
          notes: dto.notes?.trim() ?? null,
          isActive: true,
        },
        include: {
          category: { select: { id: true, name: true, nameBn: true } },
          branch: { select: { id: true, name: true, nameBn: true } },
        },
      });

      // Opening balance ledger entry
      if (openingBalance !== 0) {
        await tx.partyLedger.create({
          data: {
            businessId,
            branchId: dto.branchId ?? null,
            partyId: newParty.id,
            type: 'opening',
            amount: openingBalance,
            balance: openingBalance,
            description:
              openingBalance > 0
                ? 'Opening receivable balance'
                : 'Opening payable balance',
            date: new Date(),
          },
        });
      }

      return newParty;
    });

    this.logger.info({ partyId: party.id, businessId }, 'Party created');
    return { success: true, data: party };
  }

  // ─── UPDATE ────────────────────────────────────────────────────────────────
  async update(businessId: string, id: string, dto: UpdatePartyDto) {
    const existing = await this.prisma.party.findFirst({
      where: { id, businessId },
    });

    if (!existing) throw new NotFoundException(`Party ${id} not found.`);

    // Duplicate phone guard (exclude self)
    if (dto.phone && dto.phone !== existing.phone) {
      const duplicate = await this.prisma.party.findFirst({
        where: {
          businessId,
          phone: dto.phone,
          isActive: true,
          id: { not: id },
        },
      });
      if (duplicate) {
        throw new ConflictException(
          'A party with this phone number already exists.',
        );
      }
    }

    // Validate category
    if (dto.categoryId !== undefined && dto.categoryId !== null) {
      const category = await this.prisma.partyCategory.findUnique({
        where: { id: dto.categoryId },
      });
      if (!category || category.businessId !== businessId) {
        throw new BadRequestException('Invalid party category.');
      }
    }

    // Validate branch
    if (dto.branchId !== undefined && dto.branchId !== null) {
      const branch = await this.prisma.branch.findUnique({
        where: { id: dto.branchId },
      });
      if (!branch || branch.businessId !== businessId) {
        throw new BadRequestException('Invalid branch.');
      }
    }

    const party = await this.prisma.party.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.phone !== undefined && { phone: dto.phone?.trim() ?? null }),
        ...(dto.email !== undefined && { email: dto.email?.trim() ?? null }),
        ...(dto.address !== undefined && {
          address: dto.address?.trim() ?? null,
        }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.customerTier !== undefined && {
          customerTier: dto.customerTier ?? null,
        }),
        ...(dto.riskLevel !== undefined && {
          riskLevel: dto.riskLevel ?? null,
        }),
        ...(dto.categoryId !== undefined && {
          categoryId: dto.categoryId ?? null,
        }),
        ...(dto.branchId !== undefined && { branchId: dto.branchId ?? null }),
        ...(dto.creditLimit !== undefined && {
          creditLimit: dto.creditLimit ?? null,
        }),
        ...(dto.paymentTerms !== undefined && {
          paymentTerms: dto.paymentTerms ?? null,
        }),
        ...(dto.notes !== undefined && { notes: dto.notes?.trim() ?? null }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: {
        category: { select: { id: true, name: true, nameBn: true } },
        branch: { select: { id: true, name: true, nameBn: true } },
      },
    });

    this.logger.info({ partyId: id, businessId }, 'Party updated');
    return { success: true, data: party };
  }

  // ─── DELETE (soft) ─────────────────────────────────────────────────────────
  async remove(businessId: string, id: string) {
    const existing = await this.prisma.party.findFirst({
      where: { id, businessId },
    });

    if (!existing) throw new NotFoundException(`Party ${id} not found.`);

    // Guard: active sales with outstanding due
    const activeSales = await this.prisma.sale.count({
      where: {
        partyId: id,
        status: { in: ['completed', 'pending'] },
        dueAmount: { gt: 0 },
      },
    });

    if (activeSales > 0) {
      throw new BadRequestException(
        `Cannot delete party with ${activeSales} active transaction(s) with outstanding balance.`,
      );
    }

    // Guard: outstanding balance
    if (existing.currentBalance !== 0) {
      throw new BadRequestException(
        `Cannot delete party with outstanding balance of ${existing.currentBalance}. Clear the balance first.`,
      );
    }

    await this.prisma.party.update({
      where: { id },
      data: { isActive: false },
    });

    this.logger.info({ partyId: id, businessId }, 'Party soft-deleted');
    return { success: true, data: { id } };
  }

  // ─── LEDGER ────────────────────────────────────────────────────────────────
  // GET /parties/:id/ledger  — paginated full ledger history
  async getLedger(
    businessId: string,
    partyId: string,
    page: number,
    limit: number,
  ) {
    // Verify party belongs to business
    const party = await this.prisma.party.findFirst({
      where: { id: partyId, businessId },
      select: { id: true, name: true, currentBalance: true },
    });

    if (!party) throw new NotFoundException(`Party ${partyId} not found.`);

    const [entries, total] = await Promise.all([
      this.prisma.partyLedger.findMany({
        where: { partyId },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.partyLedger.count({ where: { partyId } }),
    ]);

    return {
      success: true,
      data: {
        party,
        entries,
      },
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
