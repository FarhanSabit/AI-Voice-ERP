import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Prisma } from '@prisma/client';

import { CreatePaymentDto, PaymentType } from './dto/create-payment.dto';
import { QueryPaymentDto } from './dto/query-payment.dto';
import {
  CreatePaymentPlanDto,
  PaymentFrequency,
} from './dto/create-payment-plan.dto';
import { PayInstallmentDto } from './dto/pay-installment.dto';
import { CreateReminderDto } from './dto/create-reminder.dto';
import {
  CreatePromiseToPayDto,
  UpdatePromiseStatusDto,
} from './dto/create-promise.dto';
import { CreateFollowUpNoteDto } from './dto/create-followup.dto';
import { QueryCollectionDto } from './dto/query-collection.dto';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function frequencyToDays(freq: PaymentFrequency): number {
  switch (freq) {
    case PaymentFrequency.WEEKLY:
      return 7;
    case PaymentFrequency.BIWEEKLY:
      return 14;
    case PaymentFrequency.MONTHLY:
      return 30;
    case PaymentFrequency.QUARTERLY:
      return 90;
    default:
      return 30;
  }
}

function calcRiskLevel(overdueDays: number, balance: number): string {
  if (overdueDays > 90 || balance > 50000) return 'high';
  if (overdueDays > 30 || balance > 10000) return 'medium';
  return 'low';
}

// ─── Prisma Includes ──────────────────────────────────────────────────────────

const paymentInclude = {
  party: { select: { id: true, name: true, phone: true, type: true } },
} satisfies Prisma.PaymentInclude;

const planInclude = {
  party: { select: { id: true, name: true, phone: true } },
  installmentRecords: { orderBy: { installmentNo: 'asc' as const } },
} satisfies Prisma.PaymentPlanInclude;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(PaymentsService.name)
    private readonly logger: PinoLogger,
  ) {}

  // ════════════════════════════════════════════════════════════════════════════
  // 10.1  PAYMENTS
  // ════════════════════════════════════════════════════════════════════════════

  async findAllPayments(
    businessId: string,
    branchId: string,
    query: QueryPaymentDto,
  ) {
    const page = parseInt(query.page ?? '1', 10);
    const limit = parseInt(query.limit ?? '50', 10);

    const where: Prisma.PaymentWhereInput = {
      businessId,
      deletedAt: null,
    };

    if (query.type) where.type = query.type;
    if (query.mode) where.mode = query.mode;
    if (query.partyId) where.partyId = query.partyId;
    if (query.saleId) where.saleId = query.saleId;
    if (query.purchaseId) where.purchaseId = query.purchaseId;
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) {
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const [payments, total, agg] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: paymentInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payment.count({ where }),
      this.prisma.payment.aggregate({
        where,
        _sum: { amount: true },
      }),
    ]);

    return {
      success: true,
      data: payments,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        totalAmount: agg._sum.amount ?? 0,
      },
    };
  }

  async findOnePayment(businessId: string, id: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, businessId, deletedAt: null },
      include: {
        ...paymentInclude,
      },
    });
    if (!payment) throw new NotFoundException(`Payment ${id} not found.`);
    return { success: true, data: payment };
  }

  async createPayment(
    businessId: string,
    branchId: string,
    userId: string | null,
    dto: CreatePaymentDto,
  ) {
    // Validate party exists
    const party = await this.prisma.party.findFirst({
      where: { id: dto.partyId, businessId, deletedAt: null },
    });
    if (!party) throw new BadRequestException('Party not found.');

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Create payment record
      const payment = await tx.payment.create({
        data: {
          businessId,
          branchId,
          partyId: dto.partyId,
          type: dto.type,
          mode: dto.mode,
          accountId: dto.accountId,
          amount: dto.amount,
          reference: dto.reference,
          saleId: dto.saleId,
          purchaseId: dto.purchaseId,
          paymentPlanId: dto.paymentPlanId,
          notes: dto.notes,
          createdBy: userId,
        },
        include: paymentInclude,
      });

      // 2. Save allocation records (invoice-level)
      if (dto.allocations?.length) {
        const totalAlloc = dto.allocations.reduce((s, a) => s + a.amount, 0);
        if (totalAlloc > dto.amount) {
          throw new BadRequestException(
            'Allocation total exceeds payment amount.',
          );
        }
        await tx.paymentAllocation.createMany({
          data: dto.allocations.map((a) => ({
            businessId,
            paymentId: payment.id,
            saleId: a.saleId,
            purchaseId: a.purchaseId,
            amount: a.amount,
            notes: a.notes,
          })),
        });
      }

      // 3. Update party balance
      const balanceDelta =
        dto.type === PaymentType.RECEIVED ? -dto.amount : dto.amount;
      await tx.party.update({
        where: { id: dto.partyId },
        data: {
          currentBalance: { increment: balanceDelta },
          lastPaymentDate: new Date(),
        },
      });

      // 4. Party ledger entry
      const updatedParty = await tx.party.findUnique({
        where: { id: dto.partyId },
      });
      await tx.partyLedger.create({
        data: {
          businessId,
          branchId,
          partyId: dto.partyId,
          type: 'payment',
          referenceId: payment.id,
          referenceType: 'Payment',
          amount: dto.amount,
          balance: updatedParty?.currentBalance ?? 0,
          description:
            dto.type === PaymentType.RECEIVED
              ? `Payment received — ${dto.mode}`
              : `Payment made — ${dto.mode}`,
          date: new Date(),
        },
      });

      // 5. Update account balance
      if (dto.accountId) {
        const account = await tx.account.findUnique({
          where: { id: dto.accountId },
        });
        if (account) {
          const accountDelta =
            dto.type === PaymentType.RECEIVED ? dto.amount : -dto.amount;
          await tx.account.update({
            where: { id: dto.accountId },
            data: { currentBalance: { increment: accountDelta } },
          });
        }
      } else {
        // Default cash account
        const cashAccount = await tx.account.findFirst({
          where: { businessId, branchId, type: 'cash', deletedAt: null },
        });
        if (cashAccount) {
          const accountDelta =
            dto.type === PaymentType.RECEIVED ? dto.amount : -dto.amount;
          await tx.account.update({
            where: { id: cashAccount.id },
            data: { currentBalance: { increment: accountDelta } },
          });
        }
      }

      // 6. If linked to Sale, reduce dueAmount
      if (dto.saleId && dto.type === PaymentType.RECEIVED) {
        const sale = await tx.sale.findUnique({ where: { id: dto.saleId } });
        if (sale) {
          const newDue = Math.max(0, sale.dueAmount - dto.amount);
          const newPaid = sale.paidAmount + dto.amount;
          await tx.sale.update({
            where: { id: dto.saleId },
            data: {
              dueAmount: newDue,
              paidAmount: newPaid,
              status: newDue === 0 ? 'paid' : 'partial',
            },
          });
        }
      }

      // 7. If linked to Purchase, reduce dueAmount
      if (dto.purchaseId && dto.type === PaymentType.PAID) {
        const purchase = await tx.purchase.findUnique({
          where: { id: dto.purchaseId },
        });
        if (purchase) {
          const newDue = Math.max(0, purchase.dueAmount - dto.amount);
          const newPaid = purchase.paidAmount + dto.amount;
          await tx.purchase.update({
            where: { id: dto.purchaseId },
            data: {
              dueAmount: newDue,
              paidAmount: newPaid,
              status: newDue === 0 ? 'paid' : 'partial',
            },
          });
        }
      }

      return payment;
    });

    this.logger.info(
      { paymentId: result.id, businessId, type: dto.type, amount: dto.amount },
      'Payment recorded',
    );
    return { success: true, data: result };
  }

  async deletePayment(businessId: string, id: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!payment) throw new NotFoundException(`Payment ${id} not found.`);

    await this.prisma.payment.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return { success: true, data: { id } };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 10.2  SUPPLIER PAYMENTS (shorthand: type = paid)
  // ════════════════════════════════════════════════════════════════════════════

  async findSupplierPayments(
    businessId: string,
    branchId: string,
    query: QueryPaymentDto,
  ) {
    return this.findAllPayments(businessId, branchId, {
      ...query,
      type: PaymentType.PAID,
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 10.3  PAYMENT PLANS (Installments)
  // ════════════════════════════════════════════════════════════════════════════

  async findAllPlans(businessId: string, partyId?: string) {
    const where: Prisma.PaymentPlanWhereInput = {
      businessId,
      deletedAt: null,
    };
    if (partyId) where.partyId = partyId;

    const plans = await this.prisma.paymentPlan.findMany({
      where,
      include: planInclude,
      orderBy: { createdAt: 'desc' },
    });
    return { success: true, data: plans };
  }

  async findOnePlan(businessId: string, id: string) {
    const plan = await this.prisma.paymentPlan.findFirst({
      where: { id, businessId, deletedAt: null },
      include: planInclude,
    });
    if (!plan) throw new NotFoundException(`Payment plan ${id} not found.`);
    return { success: true, data: plan };
  }

  async createPlan(
    businessId: string,
    branchId: string | null,
    userId: string | null,
    dto: CreatePaymentPlanDto,
  ) {
    const party = await this.prisma.party.findFirst({
      where: { id: dto.partyId, businessId, deletedAt: null },
    });
    if (!party) throw new BadRequestException('Party not found.');

    const startDate = new Date(dto.startDate);
    const freqDays = frequencyToDays(dto.frequency);
    const installmentAmount = parseFloat(
      (dto.totalAmount / dto.totalInstallments).toFixed(2),
    );
    // Last installment absorbs rounding difference
    const lastAmount = parseFloat(
      (
        dto.totalAmount -
        installmentAmount * (dto.totalInstallments - 1)
      ).toFixed(2),
    );

    // Build installment due dates
    const installments = Array.from(
      { length: dto.totalInstallments },
      (_, i) => ({
        installmentNo: i + 1,
        amount:
          i === dto.totalInstallments - 1 ? lastAmount : installmentAmount,
        dueDate: addDays(startDate, i * freqDays),
        status: 'pending',
      }),
    );

    const endDate = installments[installments.length - 1].dueDate;

    const plan = await this.prisma.paymentPlan.create({
      data: {
        businessId,
        partyId: dto.partyId,
        saleId: dto.saleId,
        totalAmount: dto.totalAmount,
        paidAmount: 0,
        remainingAmount: dto.totalAmount,
        totalInstallments: dto.totalInstallments,
        frequency: dto.frequency,
        startDate,
        endDate,
        status: 'active',
        notes: dto.notes,
        installmentRecords: { createMany: { data: installments } },
      },
      include: planInclude,
    });

    this.logger.info(
      { planId: plan.id, businessId, amount: dto.totalAmount },
      'Payment plan created',
    );
    return { success: true, data: plan };
  }

  async payInstallment(
    businessId: string,
    branchId: string,
    planId: string,
    installmentId: string,
    userId: string | null,
    dto: PayInstallmentDto,
  ) {
    const installment = await this.prisma.installment.findFirst({
      where: { id: installmentId, paymentPlanId: planId, deletedAt: null },
      include: { paymentPlan: true },
    });
    if (!installment) throw new NotFoundException('Installment not found.');
    if (installment.status === 'paid')
      throw new BadRequestException('Installment already paid.');

    const plan = installment.paymentPlan;

    await this.prisma.$transaction(async (tx) => {
      const newPaidAmount = installment.paidAmount + dto.paidAmount;
      const newStatus =
        newPaidAmount >= installment.amount ? 'paid' : 'partial';

      // Update installment
      await tx.installment.update({
        where: { id: installmentId },
        data: {
          paidAmount: newPaidAmount,
          paidDate: new Date(),
          status: newStatus,
          reminderSent: false,
        },
      });

      // Update plan totals
      const newPlanPaid = plan.paidAmount + dto.paidAmount;
      const newPlanRemaining = Math.max(
        0,
        plan.remainingAmount - dto.paidAmount,
      );
      const planStatus =
        newPlanRemaining === 0
          ? 'completed'
          : newPlanPaid > 0
            ? 'active'
            : 'active';

      await tx.paymentPlan.update({
        where: { id: planId },
        data: {
          paidAmount: newPlanPaid,
          remainingAmount: newPlanRemaining,
          status: planStatus,
        },
      });

      // Create a Payment record for audit trail
      const payment = await tx.payment.create({
        data: {
          businessId,
          branchId,
          partyId: plan.partyId,
          type: 'received',
          mode: dto.mode ?? 'cash',
          accountId: dto.accountId,
          amount: dto.paidAmount,
          reference: dto.reference,
          paymentPlanId: planId,
          notes: dto.notes ?? `Installment #${installment.installmentNo}`,
          createdBy: userId,
        },
      });

      // Update party balance
      await tx.party.update({
        where: { id: plan.partyId },
        data: {
          currentBalance: { decrement: dto.paidAmount },
          lastPaymentDate: new Date(),
        },
      });

      // Party ledger
      const updatedParty = await tx.party.findUnique({
        where: { id: plan.partyId },
      });
      await tx.partyLedger.create({
        data: {
          businessId,
          branchId,
          partyId: plan.partyId,
          type: 'payment',
          referenceId: payment.id,
          referenceType: 'Payment',
          amount: dto.paidAmount,
          balance: updatedParty?.currentBalance ?? 0,
          description: `Installment #${installment.installmentNo} paid`,
          date: new Date(),
        },
      });

      // Account balance
      if (dto.accountId) {
        await tx.account.update({
          where: { id: dto.accountId },
          data: { currentBalance: { increment: dto.paidAmount } },
        });
      } else {
        const cashAccount = await tx.account.findFirst({
          where: { businessId, branchId, type: 'cash', deletedAt: null },
        });
        if (cashAccount) {
          await tx.account.update({
            where: { id: cashAccount.id },
            data: { currentBalance: { increment: dto.paidAmount } },
          });
        }
      }
    });

    return this.findOnePlan(businessId, planId);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // COLLECTION CENTER
  // ════════════════════════════════════════════════════════════════════════════

  async getCollectionCenter(
    businessId: string,
    branchId: string,
    query: QueryCollectionDto,
  ) {
    const page = parseInt(query.page ?? '1', 10);
    const limit = parseInt(query.limit ?? '50', 10);
    const now = new Date();

    // Filter parties with outstanding balances (receivables from customers)
    const where: Prisma.PartyWhereInput = {
      businessId,
      deletedAt: null,
      type: 'customer',
      currentBalance: { gt: 0 },
    };

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search } },
      ];
    }

    const parties = await this.prisma.party.findMany({
      where,
      select: {
        id: true,
        name: true,
        phone: true,
        currentBalance: true,
        creditLimit: true,
        paymentTerms: true,
        lastPaymentDate: true,
        riskLevel: true,
        sales: {
          where: { dueAmount: { gt: 0 }, deletedAt: null },
          select: {
            id: true,
            invoiceNo: true,
            total: true,
            dueAmount: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { currentBalance: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    // Enrich with overdue info
    const enriched = parties.map((party) => {
      const oldestDueSale = party.sales[0];
      const overdueDays = oldestDueSale
        ? Math.floor(
            (now.getTime() - new Date(oldestDueSale.createdAt).getTime()) /
              (1000 * 60 * 60 * 24),
          )
        : 0;
      const paymentTermDays = party.paymentTerms ?? 30;
      const effectiveOverdue = Math.max(0, overdueDays - paymentTermDays);
      const riskLevel = calcRiskLevel(effectiveOverdue, party.currentBalance);

      // Bucket
      let bucket = '0-30';
      if (effectiveOverdue > 90) bucket = '90+';
      else if (effectiveOverdue > 60) bucket = '61-90';
      else if (effectiveOverdue > 30) bucket = '31-60';

      return {
        ...party,
        overdueDays: effectiveOverdue,
        bucket,
        riskLevel: party.riskLevel ?? riskLevel,
        outstandingInvoices: party.sales.length,
        totalOutstanding: party.currentBalance,
      };
    });

    // Filter by overdueRange if provided
    const filtered =
      query.overdueRange && query.overdueRange !== 'all'
        ? enriched.filter((p) => p.bucket === query.overdueRange)
        : enriched;

    // Filter by riskLevel
    const finalList = query.riskLevel
      ? filtered.filter((p) => p.riskLevel === query.riskLevel)
      : filtered;

    const total = await this.prisma.party.count({ where });

    return {
      success: true,
      data: finalList,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        totalOutstanding: finalList.reduce((s, p) => s + p.totalOutstanding, 0),
      },
    };
  }

  async getOverdueCustomers(businessId: string, branchId: string) {
    const now = new Date();

    const customers = await this.prisma.party.findMany({
      where: {
        businessId,
        deletedAt: null,
        type: 'customer',
        currentBalance: { gt: 0 },
      },
      select: {
        id: true,
        name: true,
        phone: true,
        currentBalance: true,
        creditLimit: true,
        paymentTerms: true,
        lastPaymentDate: true,
        riskLevel: true,
      },
      orderBy: { currentBalance: 'desc' },
    });

    const buckets = {
      '0-30': [] as typeof customers,
      '31-60': [] as typeof customers,
      '61-90': [] as typeof customers,
      '90+': [] as typeof customers,
    };

    for (const c of customers) {
      const daysSincePayment = c.lastPaymentDate
        ? Math.floor(
            (now.getTime() - new Date(c.lastPaymentDate).getTime()) /
              (1000 * 60 * 60 * 24),
          )
        : 999;
      const overdue = Math.max(0, daysSincePayment - (c.paymentTerms ?? 30));

      if (overdue > 90) buckets['90+'].push(c);
      else if (overdue > 60) buckets['61-90'].push(c);
      else if (overdue > 30) buckets['31-60'].push(c);
      else buckets['0-30'].push(c);
    }

    return {
      success: true,
      data: {
        buckets,
        summary: {
          total: customers.length,
          totalOutstanding: customers.reduce((s, c) => s + c.currentBalance, 0),
          bucket_0_30: buckets['0-30'].length,
          bucket_31_60: buckets['31-60'].length,
          bucket_61_90: buckets['61-90'].length,
          bucket_over_90: buckets['90+'].length,
        },
      },
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // REMINDERS
  // ════════════════════════════════════════════════════════════════════════════

  async findReminders(businessId: string, partyId?: string) {
    const reminders = await this.prisma.collectionReminder.findMany({
      where: {
        businessId,
        ...(partyId && { partyId }),
        deletedAt: null,
      },
      include: {
        party: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });
    return { success: true, data: reminders };
  }

  async createReminder(
    businessId: string,
    branchId: string,
    userId: string | null,
    dto: CreateReminderDto,
  ) {
    const party = await this.prisma.party.findFirst({
      where: { id: dto.partyId, businessId, deletedAt: null },
    });
    if (!party) throw new BadRequestException('Party not found.');

    const reminder = await this.prisma.collectionReminder.create({
      data: {
        businessId,
        branchId,
        partyId: dto.partyId,
        type: dto.type ?? 'overdue',
        channel: dto.channel ?? 'manual',
        scheduledAt: new Date(dto.scheduledAt),
        message: dto.message,
        notes: dto.notes,
        createdBy: userId,
        status: 'pending',
      },
      include: {
        party: { select: { id: true, name: true, phone: true } },
      },
    });

    this.logger.info(
      { reminderId: reminder.id, partyId: dto.partyId },
      'Collection reminder created',
    );
    return { success: true, data: reminder };
  }

  async markReminderSent(businessId: string, id: string) {
    const reminder = await this.prisma.collectionReminder.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!reminder) throw new NotFoundException('Reminder not found.');

    const updated = await this.prisma.collectionReminder.update({
      where: { id },
      data: { status: 'sent', sentAt: new Date() },
    });
    return { success: true, data: updated };
  }

  async deleteReminder(businessId: string, id: string) {
    const reminder = await this.prisma.collectionReminder.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!reminder) throw new NotFoundException('Reminder not found.');

    await this.prisma.collectionReminder.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'cancelled' },
    });
    return { success: true, data: { id } };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PROMISE TO PAY
  // ════════════════════════════════════════════════════════════════════════════

  async findPromises(businessId: string, partyId?: string) {
    const promises = await this.prisma.promiseToPay.findMany({
      where: {
        businessId,
        ...(partyId && { partyId }),
        deletedAt: null,
      },
      include: {
        party: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { promisedDate: 'asc' },
    });
    return { success: true, data: promises };
  }

  async createPromise(
    businessId: string,
    branchId: string,
    userId: string | null,
    dto: CreatePromiseToPayDto,
  ) {
    const party = await this.prisma.party.findFirst({
      where: { id: dto.partyId, businessId, deletedAt: null },
    });
    if (!party) throw new BadRequestException('Party not found.');

    const promise = await this.prisma.promiseToPay.create({
      data: {
        businessId,
        branchId,
        partyId: dto.partyId,
        saleId: dto.saleId,
        promisedDate: new Date(dto.promisedDate),
        amount: dto.amount,
        status: 'pending',
        notes: dto.notes,
        createdBy: userId,
      },
      include: {
        party: { select: { id: true, name: true, phone: true } },
      },
    });

    return { success: true, data: promise };
  }

  async updatePromiseStatus(
    businessId: string,
    id: string,
    dto: UpdatePromiseStatusDto,
  ) {
    const promise = await this.prisma.promiseToPay.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!promise) throw new NotFoundException('Promise to pay not found.');

    const updated = await this.prisma.promiseToPay.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.notes && { notes: dto.notes }),
      },
    });
    return { success: true, data: updated };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // FOLLOW-UP NOTES
  // ════════════════════════════════════════════════════════════════════════════

  async findFollowUps(businessId: string, partyId?: string) {
    const notes = await this.prisma.followUpNote.findMany({
      where: {
        businessId,
        ...(partyId && { partyId }),
        deletedAt: null,
      },
      include: {
        party: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { success: true, data: notes };
  }

  async createFollowUp(
    businessId: string,
    branchId: string,
    userId: string | null,
    dto: CreateFollowUpNoteDto,
  ) {
    const party = await this.prisma.party.findFirst({
      where: { id: dto.partyId, businessId, deletedAt: null },
    });
    if (!party) throw new BadRequestException('Party not found.');

    const note = await this.prisma.followUpNote.create({
      data: {
        businessId,
        branchId,
        partyId: dto.partyId,
        saleId: dto.saleId,
        note: dto.note,
        outcome: dto.outcome,
        nextFollowUp: dto.nextFollowUp ? new Date(dto.nextFollowUp) : undefined,
        createdBy: userId,
      },
      include: {
        party: { select: { id: true, name: true, phone: true } },
      },
    });

    return { success: true, data: note };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PAYMENT ALLOCATIONS
  // ════════════════════════════════════════════════════════════════════════════

  async getPaymentAllocations(businessId: string, paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, businessId, deletedAt: null },
    });
    if (!payment) throw new NotFoundException('Payment not found.');

    const allocations = await this.prisma.paymentAllocation.findMany({
      where: { paymentId, deletedAt: null },
    });
    return { success: true, data: allocations };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SUMMARY / STATS
  // ════════════════════════════════════════════════════════════════════════════

  async getPaymentSummary(businessId: string, branchId: string) {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      todayReceived,
      todayPaid,
      monthReceived,
      monthPaid,
      totalOutstanding,
      overdueCount,
      activePlans,
    ] = await Promise.all([
      this.prisma.payment.aggregate({
        where: {
          businessId,
          type: 'received',
          deletedAt: null,
          createdAt: { gte: todayStart },
        },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: {
          businessId,
          type: 'paid',
          deletedAt: null,
          createdAt: { gte: todayStart },
        },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: {
          businessId,
          type: 'received',
          deletedAt: null,
          createdAt: { gte: monthStart },
        },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          businessId,
          type: 'paid',
          deletedAt: null,
          createdAt: { gte: monthStart },
        },
        _sum: { amount: true },
      }),
      this.prisma.party.aggregate({
        where: {
          businessId,
          deletedAt: null,
          type: 'customer',
          currentBalance: { gt: 0 },
        },
        _sum: { currentBalance: true },
        _count: true,
      }),
      this.prisma.installment.count({
        where: {
          status: { in: ['pending', 'partial'] },
          dueDate: { lt: now },
          deletedAt: null,
        },
      }),
      this.prisma.paymentPlan.count({
        where: {
          businessId,
          status: 'active',
          deletedAt: null,
        },
      }),
    ]);

    return {
      success: true,
      data: {
        today: {
          received: todayReceived._sum.amount ?? 0,
          paid: todayPaid._sum.amount ?? 0,
          receivedCount: todayReceived._count,
          paidCount: todayPaid._count,
          net: (todayReceived._sum.amount ?? 0) - (todayPaid._sum.amount ?? 0),
        },
        thisMonth: {
          received: monthReceived._sum.amount ?? 0,
          paid: monthPaid._sum.amount ?? 0,
          net: (monthReceived._sum.amount ?? 0) - (monthPaid._sum.amount ?? 0),
        },
        outstanding: {
          totalAmount: totalOutstanding._sum.currentBalance ?? 0,
          customerCount: totalOutstanding._count,
          overdueInstallments: overdueCount,
        },
        activePlans,
      },
    };
  }
}
