import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import * as bcrypt from 'bcryptjs';
import { roundsOfHashing } from 'src/auth/auth.service';

import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateBusinessDto } from './dto/update-business.dto';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { InventorySettingsDto } from './dto/inventory-settings.dto';
import { CreatePeriodLockDto } from './dto/create-period-lock.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { ExportQueryDto } from './dto/export-query.dto';

// ─── Static permission manifest ───────────────────────────────────────────────
const PERMISSION_MANIFEST = [
  {
    module: 'sales',
    label: 'Sales',
    labelBn: 'বিক্রয়',
    actions: ['view', 'create', 'edit', 'delete'],
  },
  {
    module: 'purchases',
    label: 'Purchases',
    labelBn: 'ক্রয়',
    actions: ['view', 'create', 'edit', 'delete'],
  },
  {
    module: 'inventory',
    label: 'Inventory',
    labelBn: 'ইনভেন্টরি',
    actions: ['view', 'create', 'edit', 'delete'],
  },
  {
    module: 'parties',
    label: 'Parties',
    labelBn: 'পক্ষসমূহ',
    actions: ['view', 'create', 'edit', 'delete'],
  },
  {
    module: 'expenses',
    label: 'Expenses',
    labelBn: 'ব্যয়',
    actions: ['view', 'create', 'edit', 'delete'],
  },
  {
    module: 'reports',
    label: 'Reports',
    labelBn: 'প্রতিবেদন',
    actions: ['view'],
  },
  {
    module: 'settings',
    label: 'Settings',
    labelBn: 'সেটিংস',
    actions: ['view', 'edit'],
  },
  {
    module: 'staff',
    label: 'Staff',
    labelBn: 'কর্মী',
    actions: ['view', 'create', 'edit', 'delete'],
  },
];

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(SettingsService.name)
    private readonly logger: PinoLogger,
  ) {}

  // ─── USER PROFILE ──────────────────────────────────────────────────────────

  async updateUser(userId: string, businessId: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, businessId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found.');

    // If changing phone, ensure uniqueness
    if (dto.phone && dto.phone !== user.phone) {
      const taken = await this.prisma.user.findUnique({
        where: { phone: dto.phone },
      });
      if (taken) throw new ConflictException('Phone number already in use.');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        businessId: true,
        branchId: true,
        isActive: true,
        role: { select: { id: true, name: true } },
      },
    });

    this.logger.info({ userId }, 'User profile updated');
    return { success: true, data: updated };
  }

  // ─── PASSWORD CHANGE ───────────────────────────────────────────────────────

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    if (!user.password) {
      throw new BadRequestException(
        'No password set. You signed up via OTP — use the forgot password flow.',
      );
    }

    const isMatch = await bcrypt.compare(dto.currentPassword, user.password);
    if (!isMatch) {
      throw new BadRequestException('Current password is incorrect.');
    }

    const hashed = await bcrypt.hash(dto.newPassword, roundsOfHashing);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });

    this.logger.info({ userId }, 'Password changed');
    return { success: true, message: 'Password updated successfully.' };
  }

  // ─── BUSINESS PROFILE ──────────────────────────────────────────────────────

  async getBusiness(businessId: string) {
    // NOTE: select uses prisma `any` cast for the 3 new fields added in the
    // 'add-inventory-settings-to-business' migration. Remove the cast after
    // running `npx prisma migrate dev`.
    const business = await (this.prisma.business as any).findUnique({
      where: { id: businessId },
      select: {
        id: true,
        name: true,
        nameBn: true,
        type: true,
        phone: true,
        email: true,
        address: true,
        logo: true,
        currency: true,
        timezone: true,
        language: true,
        plan: true,
        planStatus: true,
        planStartDate: true,
        planEndDate: true,
        invoicePrefix: true,
        invoiceFooter: true,
        invoicePaperSize: true,
        invoiceLanguage: true,
        lowStockThreshold: true,
        lowStockAlerts: true,
        stockWarningNotifications: true,
        createdAt: true,
      },
    });
    if (!business) throw new NotFoundException('Business not found.');
    return { success: true, data: business };
  }

  async updateBusiness(businessId: string, dto: UpdateBusinessDto) {
    const existing = await this.prisma.business.findUnique({
      where: { id: businessId },
    });
    if (!existing) throw new NotFoundException('Business not found.');

    const updated = await this.prisma.business.update({
      where: { id: businessId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.nameBn !== undefined && { nameBn: dto.nameBn }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.plan !== undefined && { plan: dto.plan }),
        ...(dto.invoicePrefix !== undefined && {
          invoicePrefix: dto.invoicePrefix,
        }),
        ...(dto.invoiceFooter !== undefined && {
          invoiceFooter: dto.invoiceFooter,
        }),
        ...(dto.invoicePaperSize !== undefined && {
          invoicePaperSize: dto.invoicePaperSize,
        }),
        ...(dto.invoiceLanguage !== undefined && {
          invoiceLanguage: dto.invoiceLanguage,
        }),
      },
      select: {
        id: true,
        name: true,
        nameBn: true,
        phone: true,
        email: true,
        address: true,
        plan: true,
        invoicePrefix: true,
        invoiceFooter: true,
        invoicePaperSize: true,
        invoiceLanguage: true,
      },
    });

    this.logger.info({ businessId }, 'Business profile updated');
    return { success: true, data: updated };
  }

  // ─── BRANCHES ──────────────────────────────────────────────────────────────

  async getBranches(businessId: string) {
    const branches = await this.prisma.branch.findMany({
      where: { businessId, deletedAt: null },
      orderBy: [{ isMain: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        nameBn: true,
        type: true,
        address: true,
        phone: true,
        isMain: true,
        isActive: true,
        openingCash: true,
        currentCash: true,
        managerId: true,
        createdAt: true,
        _count: { select: { users: true } },
      },
    });
    return { success: true, data: branches };
  }

  async createBranch(businessId: string, userId: string, dto: CreateBranchDto) {
    // If marking as main, ensure only one main exists
    if (dto.isMain) {
      await this.prisma.branch.updateMany({
        where: { businessId, isMain: true },
        data: { isMain: false },
      });
    }

    const branch = await this.prisma.branch.create({
      data: {
        businessId,
        name: dto.name,
        nameBn: dto.nameBn,
        type: dto.type ?? 'sub',
        address: dto.address,
        phone: dto.phone,
        isMain: dto.isMain ?? false,
        openingCash: dto.openingCash ?? 0,
        currentCash: dto.openingCash ?? 0,
      },
    });

    this.logger.info(
      { businessId, branchId: branch.id, userId },
      'Branch created',
    );
    return { success: true, data: branch };
  }

  async updateBranch(businessId: string, id: string, dto: UpdateBranchDto) {
    const existing = await this.prisma.branch.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Branch not found.');

    if (dto.isMain) {
      await this.prisma.branch.updateMany({
        where: { businessId, isMain: true, id: { not: id } },
        data: { isMain: false },
      });
    }

    const updated = await this.prisma.branch.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.nameBn !== undefined && { nameBn: dto.nameBn }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.address !== undefined && { address: dto.address }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.isMain !== undefined && { isMain: dto.isMain }),
        ...(dto.managerId !== undefined && { managerId: dto.managerId }),
      },
    });

    this.logger.info({ businessId, branchId: id }, 'Branch updated');
    return { success: true, data: updated };
  }

  async deleteBranch(businessId: string, id: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!branch) throw new NotFoundException('Branch not found.');
    if (branch.isMain) {
      throw new ForbiddenException('Cannot delete the main branch.');
    }

    await this.prisma.branch.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    this.logger.info({ businessId, branchId: id }, 'Branch soft-deleted');
    return { success: true, data: { id } };
  }

  // ─── ROLES ─────────────────────────────────────────────────────────────────

  async getRoles(businessId: string) {
    const roles = await this.prisma.role.findMany({
      where: { businessId, deletedAt: null },
      orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
      include: {
        _count: { select: { users: true } },
      },
    });

    return {
      success: true,
      data: roles.map((r) => ({
        ...r,
        permissions:
          r.permissions === '*' ? '*' : this.parseJson(r.permissions, {}),
        userCount: r._count.users,
        _count: undefined,
      })),
    };
  }

  async createRole(businessId: string, dto: CreateRoleDto) {
    const existing = await this.prisma.role.findFirst({
      where: { businessId, name: dto.name, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException(`Role "${dto.name}" already exists.`);
    }

    const role = await this.prisma.role.create({
      data: {
        businessId,
        name: dto.name,
        nameBn: dto.nameBn,
        description: dto.description,
        color: dto.color ?? 'gray',
        permissions: JSON.stringify(dto.permissions),
        isSystem: false,
        isDefault: false,
      },
    });

    this.logger.info({ businessId, roleId: role.id }, 'Role created');
    return {
      success: true,
      data: { ...role, permissions: dto.permissions },
    };
  }

  async updateRole(businessId: string, id: string, dto: UpdateRoleDto) {
    const role = await this.prisma.role.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!role) throw new NotFoundException('Role not found.');
    if (role.isSystem) {
      throw new ForbiddenException('System roles cannot be modified.');
    }

    const updated = await this.prisma.role.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.nameBn !== undefined && { nameBn: dto.nameBn }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
        ...(dto.permissions !== undefined && {
          permissions: JSON.stringify(dto.permissions),
        }),
      },
    });

    this.logger.info({ businessId, roleId: id }, 'Role updated');
    return {
      success: true,
      data: {
        ...updated,
        permissions:
          updated.permissions === '*'
            ? '*'
            : this.parseJson(updated.permissions, {}),
      },
    };
  }

  async deleteRole(businessId: string, id: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!role) throw new NotFoundException('Role not found.');
    if (role.isSystem) {
      throw new ForbiddenException('System roles cannot be deleted.');
    }

    const userCount = await this.prisma.user.count({
      where: { roleId: id, deletedAt: null },
    });
    if (userCount > 0) {
      throw new BadRequestException(
        `Cannot delete role — ${userCount} user(s) are assigned to it.`,
      );
    }

    await this.prisma.role.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    this.logger.info({ businessId, roleId: id }, 'Role deleted');
    return { success: true, data: { id } };
  }

  // ─── PERMISSIONS MANIFEST ──────────────────────────────────────────────────

  getPermissions() {
    return { success: true, data: PERMISSION_MANIFEST };
  }

  // ─── CATEGORIES ────────────────────────────────────────────────────────────

  async getCategories(businessId: string) {
    const categories = await this.prisma.category.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        nameBn: true,
        description: true,
        itemCount: true,
        createdAt: true,
      },
    });
    return { success: true, data: categories };
  }

  async createCategory(businessId: string, dto: CreateCategoryDto) {
    const existing = await this.prisma.category.findFirst({
      where: { businessId, name: dto.name, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException(`Category "${dto.name}" already exists.`);
    }

    const category = await this.prisma.category.create({
      data: {
        businessId,
        name: dto.name,
        nameBn: dto.nameBn,
        description: dto.description,
      },
    });

    this.logger.info(
      { businessId, categoryId: category.id },
      'Category created',
    );
    return { success: true, data: category };
  }

  async updateCategory(businessId: string, id: string, dto: UpdateCategoryDto) {
    const existing = await this.prisma.category.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Category not found.');

    const updated = await this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.nameBn !== undefined && { nameBn: dto.nameBn }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
    });

    this.logger.info({ businessId, categoryId: id }, 'Category updated');
    return { success: true, data: updated };
  }

  async deleteCategory(businessId: string, id: string) {
    const existing = await this.prisma.category.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Category not found.');

    const itemCount = await this.prisma.item.count({
      where: { categoryId: id, deletedAt: null },
    });
    if (itemCount > 0) {
      throw new BadRequestException(
        `Cannot delete — ${itemCount} item(s) use this category.`,
      );
    }

    await this.prisma.category.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    this.logger.info({ businessId, categoryId: id }, 'Category soft-deleted');
    return { success: true, data: { id } };
  }

  // ─── INVENTORY SETTINGS ────────────────────────────────────────────────────

  async getInventorySettings(businessId: string) {
    // NOTE: cast for un-migrated Prisma client — remove after migration
    const biz = await (this.prisma.business as any).findUnique({
      where: { id: businessId },
      select: {
        lowStockThreshold: true,
        lowStockAlerts: true,
        stockWarningNotifications: true,
      },
    });
    if (!biz) throw new NotFoundException('Business not found.');
    return { success: true, data: biz };
  }

  async updateInventorySettings(businessId: string, dto: InventorySettingsDto) {
    // NOTE: cast for un-migrated Prisma client — remove after migration
    const updated = await (this.prisma.business as any).update({
      where: { id: businessId },
      data: {
        ...(dto.lowStockThreshold !== undefined && {
          lowStockThreshold: dto.lowStockThreshold,
        }),
        ...(dto.lowStockAlerts !== undefined && {
          lowStockAlerts: dto.lowStockAlerts,
        }),
        ...(dto.stockWarningNotifications !== undefined && {
          stockWarningNotifications: dto.stockWarningNotifications,
        }),
      },
      select: {
        lowStockThreshold: true,
        lowStockAlerts: true,
        stockWarningNotifications: true,
      },
    });

    this.logger.info({ businessId }, 'Inventory settings updated');
    return { success: true, data: updated };
  }

  // ─── PERIOD LOCKS ──────────────────────────────────────────────────────────

  async getPeriodLocks(businessId: string) {
    const locks = await this.prisma.periodLock.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { periodStart: 'desc' },
    });
    return { success: true, data: locks };
  }

  async createPeriodLock(
    businessId: string,
    userId: string,
    dto: CreatePeriodLockDto,
  ) {
    const start = new Date(dto.periodStart);
    const end = new Date(dto.periodEnd);

    if (end <= start) {
      throw new BadRequestException('periodEnd must be after periodStart.');
    }

    // Check for overlapping locks
    const overlap = await this.prisma.periodLock.findFirst({
      where: {
        businessId,
        deletedAt: null,
        periodStart: { lte: end },
        periodEnd: { gte: start },
      },
    });
    if (overlap) {
      throw new ConflictException('An overlapping period lock already exists.');
    }

    const lock = await this.prisma.periodLock.create({
      data: {
        businessId,
        periodStart: start,
        periodEnd: end,
        lockedBy: userId,
        notes: dto.notes,
      },
    });

    this.logger.info({ businessId, lockId: lock.id }, 'Period lock created');
    return { success: true, data: lock };
  }

  async deletePeriodLock(businessId: string, id: string) {
    const lock = await this.prisma.periodLock.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!lock) throw new NotFoundException('Period lock not found.');

    await this.prisma.periodLock.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    this.logger.info({ businessId, lockId: id }, 'Period lock removed');
    return { success: true, data: { id } };
  }

  // ─── STAFF MANAGEMENT ──────────────────────────────────────────────────────

  async getStaff(businessId: string) {
    const staff = await this.prisma.user.findMany({
      where: { businessId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isActive: true,
        createdAt: true,
        role: { select: { id: true, name: true, color: true } },
        branch: { select: { id: true, name: true } },
      },
    });
    return { success: true, data: staff };
  }

  async updateStaff(businessId: string, id: string, dto: UpdateStaffDto) {
    const user = await this.prisma.user.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('Staff member not found.');

    // Validate branchId belongs to this business
    if (dto.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, businessId, deletedAt: null },
      });
      if (!branch) throw new NotFoundException('Branch not found.');
    }

    // Validate roleId belongs to this business
    if (dto.roleId) {
      const role = await this.prisma.role.findFirst({
        where: { id: dto.roleId, businessId, deletedAt: null },
      });
      if (!role) throw new NotFoundException('Role not found.');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.branchId !== undefined && { branchId: dto.branchId }),
        ...(dto.roleId !== undefined && { roleId: dto.roleId }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isActive: true,
        role: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
      },
    });

    this.logger.info({ businessId, staffId: id }, 'Staff updated');
    return { success: true, data: updated };
  }

  async deactivateStaff(businessId: string, id: string, requesterId: string) {
    if (id === requesterId) {
      throw new ForbiddenException('You cannot deactivate your own account.');
    }

    const user = await this.prisma.user.findFirst({
      where: { id, businessId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('Staff member not found.');

    await this.prisma.user.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    });

    this.logger.info({ businessId, staffId: id }, 'Staff deactivated');
    return { success: true, data: { id } };
  }

  // ─── DATA EXPORT ───────────────────────────────────────────────────────────

  async exportData(businessId: string, query: ExportQueryDto) {
    const dateFilter =
      query.startDate || query.endDate
        ? {
            createdAt: {
              ...(query.startDate && { gte: new Date(query.startDate) }),
              ...(query.endDate && { lte: new Date(query.endDate) }),
            },
          }
        : {};

    let data: unknown[] = [];
    const type = query.type;

    if (type === 'sales') {
      data = await this.prisma.sale.findMany({
        where: { businessId, deletedAt: null, ...dateFilter },
        include: {
          items: true,
          party: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      });
    } else if (type === 'purchases') {
      data = await this.prisma.purchase.findMany({
        where: { businessId, deletedAt: null, ...dateFilter },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      });
    } else if (type === 'items') {
      data = await this.prisma.item.findMany({
        where: { businessId, deletedAt: null },
        include: {
          category: { select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
        take: 10000,
      });
    } else if (type === 'expenses') {
      data = await this.prisma.expense.findMany({
        where: { businessId, deletedAt: null, ...dateFilter },
        include: {
          category: { select: { id: true, name: true } },
        },
        orderBy: { date: 'desc' },
        take: 5000,
      });
    } else if (type === 'parties') {
      data = await this.prisma.party.findMany({
        where: { businessId, deletedAt: null },
        orderBy: { name: 'asc' },
        take: 10000,
      });
    }

    return {
      success: true,
      meta: {
        type,
        count: data.length,
        exportedAt: new Date().toISOString(),
        businessId,
      },
      data,
    };
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  private parseJson<T>(value: string, fallback: T): T {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
}
