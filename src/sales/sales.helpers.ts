import { Prisma } from '@prisma/client';

export const listSaleInclude = {
  items: {
    include: {
      item: { select: { id: true, name: true, sku: true } },
    },
  },
  party: { select: { id: true, name: true, phone: true, type: true } },
} satisfies Prisma.SaleInclude;

export const singleSaleInclude = {
  items: {
    include: {
      item: {
        select: {
          id: true,
          name: true,
          nameBn: true,
          sku: true,
          barcode: true,
          unit: true,
          currentStock: true,
        },
      },
    },
  },
  party: {
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      address: true,
      type: true,
      customerTier: true,
      currentBalance: true,
      creditLimit: true,
    },
  },
} satisfies Prisma.SaleInclude;

export type ListSale = Prisma.SaleGetPayload<{ include: typeof listSaleInclude }>;
export type SingleSale = Prisma.SaleGetPayload<{ include: typeof singleSaleInclude }>;

export function transformListSale(sale: ListSale) {
  return {
    ...sale,
    partyName: sale.party?.name ?? null,
    partyPhone: sale.party?.phone ?? null,
    items: sale.items.map((item) => ({
      id: item.id,
      saleId: item.saleId,
      itemId: item.itemId,
      itemName: item.itemName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      costPrice: item.costPrice,
      discount: item.discount,
      total: item.total,
      profit: item.profit,
      createdAt: item.createdAt,
      item: item.item,
    })),
  };
}

export function transformSingleSale(sale: SingleSale) {
  return {
    ...sale,
    partyName: sale.party?.name ?? null,
    partyPhone: sale.party?.phone ?? null,
    items: sale.items.map((item) => ({
      id: item.id,
      saleId: item.saleId,
      itemId: item.itemId,
      itemName: item.itemName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      costPrice: item.costPrice,
      discount: item.discount,
      total: item.total,
      profit: item.profit,
      createdAt: item.createdAt,
      item: item.item,
    })),
  };
}

export async function generateInvoiceNo(
  tx: Prisma.TransactionClient,
  businessId: string,
): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `INV-${dateStr}-`;
  const last = await tx.sale.findFirst({
    where: { businessId, invoiceNo: { startsWith: prefix } },
    orderBy: { invoiceNo: 'desc' },
  });
  const next = last ? parseInt(last.invoiceNo.slice(-4), 10) + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

export const ACCOUNT_TYPE_MAP: Record<
  string,
  { type: string; name: string; nameBn: string }
> = {
  cash: { type: 'cash', name: 'Cash', nameBn: 'নগদ' },
  card: { type: 'bank', name: 'Bank', nameBn: 'ব্যাংক' },
  mobile_banking: {
    type: 'mobile_wallet',
    name: 'Mobile Wallet',
    nameBn: 'মোবাইল ওয়ালেট',
  },
  bank_transfer: { type: 'bank', name: 'Bank', nameBn: 'ব্যাংক' },
};
