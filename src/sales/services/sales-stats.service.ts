import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class SalesStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(businessId: string, branchId: string) {
    const now = new Date();

    // ── Time range boundaries ──────────────────────────────────────────────
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const todayEnd = new Date(todayStart.getTime() + 86_400_000); // +1 day

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = monthStart;

    const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
    const yesterdayEnd = todayStart;

    // ── Shared where clause builder ────────────────────────────────────────
    const makeWhere = (from: Date, to: Date): Prisma.SaleWhereInput => ({
      businessId,
      ...(branchId && { branchId }),
      status: { notIn: ['cancelled', 'returned'] },
      createdAt: { gte: from, lt: to },
    });

    // ── Run all aggregations in parallel ──────────────────────────────────
    const [
      todayAgg,
      yesterdayAgg,
      monthAgg,
      lastMonthAgg,
      allTimeAgg,
      todayCount,
      monthCount,
      allTimeCount,
    ] = await Promise.all([
      // Revenue aggregations
      this.prisma.sale.aggregate({
        where: makeWhere(todayStart, todayEnd),
        _sum: { total: true },
        _avg: { total: true },
      }),
      this.prisma.sale.aggregate({
        where: makeWhere(yesterdayStart, yesterdayEnd),
        _sum: { total: true },
        _avg: { total: true },
      }),
      this.prisma.sale.aggregate({
        where: makeWhere(monthStart, monthEnd),
        _sum: { total: true },
        _avg: { total: true },
      }),
      this.prisma.sale.aggregate({
        where: makeWhere(lastMonthStart, lastMonthEnd),
        _sum: { total: true },
        _avg: { total: true },
      }),
      this.prisma.sale.aggregate({
        where: {
          businessId,
          ...(branchId && { branchId }),
          status: { notIn: ['cancelled', 'returned'] },
        },
        _sum: { total: true, profit: true },
        _avg: { total: true },
      }),
      // Count aggregations
      this.prisma.sale.count({ where: makeWhere(todayStart, todayEnd) }),
      this.prisma.sale.count({ where: makeWhere(monthStart, monthEnd) }),
      this.prisma.sale.count({
        where: {
          businessId,
          ...(branchId && { branchId }),
          status: { notIn: ['cancelled', 'returned'] },
        },
      }),
    ]);

    // ── Change % helper ────────────────────────────────────────────────────
    function pctChange(current: number, previous: number): number {
      if (previous === 0) return current > 0 ? 100 : 0;
      return parseFloat((((current - previous) / previous) * 100).toFixed(1));
    }

    const todayTotal = todayAgg._sum.total ?? 0;
    const yesterdayTotal = yesterdayAgg._sum.total ?? 0;
    const monthTotal = monthAgg._sum.total ?? 0;
    const lastMonthTotal = lastMonthAgg._sum.total ?? 0;
    const allTimeTotal = allTimeAgg._sum.total ?? 0;
    const allTimeProfit = allTimeAgg._sum.profit ?? 0;
    const monthAvg = monthAgg._avg.total ?? 0;
    const lastMonthAvg = lastMonthAgg._avg.total ?? 0;
    const allTimeAvg = allTimeAgg._avg.total ?? 0;

    return {
      success: true,
      data: {
        today: {
          label: "Today's Sales",
          total: todayTotal,
          count: todayCount,
          change: pctChange(todayTotal, yesterdayTotal),
          changeLabel: 'vs Yesterday',
        },
        thisMonth: {
          label: 'This Month',
          total: monthTotal,
          count: monthCount,
          avgSale: monthAvg,
          change: pctChange(monthTotal, lastMonthTotal),
          changeLabel: 'vs Last Month',
          avgChange: pctChange(monthAvg, lastMonthAvg),
        },
        allTime: {
          label: 'Total Sales',
          total: allTimeTotal,
          profit: allTimeProfit,
          count: allTimeCount,
          avgSale: allTimeAvg,
        },
      },
    };
  }
}
