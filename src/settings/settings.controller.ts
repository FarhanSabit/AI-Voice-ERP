import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import type { JwtUser } from 'src/auth/types/jwt-user.type';
import { SettingsService } from './settings.service';

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

@ApiTags('Settings')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  // ─── USER PROFILE ──────────────────────────────────────────────────────────

  // PATCH /settings/user
  @Patch('user')
  @ApiOperation({ summary: 'Update personal profile (name, email, phone)' })
  @ApiResponse({ status: 200, description: 'Profile updated' })
  @ApiResponse({ status: 409, description: 'Phone already in use' })
  updateUser(@GetUser() user: JwtUser, @Body() dto: UpdateUserDto) {
    return this.settingsService.updateUser(user.id, user.businessId, dto);
  }

  // PATCH /settings/user/password
  @Patch('user/password')
  @ApiOperation({ summary: 'Change user password' })
  @ApiResponse({ status: 200, description: 'Password changed' })
  @ApiResponse({ status: 400, description: 'Current password incorrect' })
  changePassword(@GetUser() user: JwtUser, @Body() dto: ChangePasswordDto) {
    return this.settingsService.changePassword(user.id, dto);
  }

  // ─── BUSINESS PROFILE ──────────────────────────────────────────────────────

  // GET /settings/business
  @Get('business')
  @ApiOperation({ summary: 'Get business profile' })
  @ApiResponse({ status: 200, description: 'Business retrieved' })
  getBusiness(@GetUser() user: JwtUser) {
    return this.settingsService.getBusiness(user.businessId);
  }

  // PATCH /settings/business
  @Patch('business')
  @ApiOperation({ summary: 'Update business profile and/or plan' })
  @ApiResponse({ status: 200, description: 'Business updated' })
  updateBusiness(@GetUser() user: JwtUser, @Body() dto: UpdateBusinessDto) {
    return this.settingsService.updateBusiness(user.businessId, dto);
  }

  // ─── BRANCHES ──────────────────────────────────────────────────────────────

  // GET /settings/branches
  @Get('branches')
  @ApiOperation({ summary: 'List all branches for the business' })
  @ApiResponse({ status: 200, description: 'Branches retrieved' })
  getBranches(@GetUser() user: JwtUser) {
    return this.settingsService.getBranches(user.businessId);
  }

  // POST /settings/branches
  @Post('branches')
  @ApiOperation({ summary: 'Create a new branch' })
  @ApiResponse({ status: 201, description: 'Branch created' })
  createBranch(@GetUser() user: JwtUser, @Body() dto: CreateBranchDto) {
    return this.settingsService.createBranch(user.businessId, user.id, dto);
  }

  // PATCH /settings/branches/:id
  @Patch('branches/:id')
  @ApiOperation({ summary: 'Update a branch' })
  @ApiResponse({ status: 200, description: 'Branch updated' })
  @ApiResponse({ status: 404, description: 'Branch not found' })
  updateBranch(
    @GetUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.settingsService.updateBranch(user.businessId, id, dto);
  }

  // DELETE /settings/branches/:id
  @Delete('branches/:id')
  @ApiOperation({ summary: 'Soft-delete a branch (cannot delete main branch)' })
  @ApiResponse({ status: 200, description: 'Branch deleted' })
  @ApiResponse({ status: 403, description: 'Cannot delete main branch' })
  @ApiResponse({ status: 404, description: 'Branch not found' })
  deleteBranch(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.settingsService.deleteBranch(user.businessId, id);
  }

  // ─── ROLES ─────────────────────────────────────────────────────────────────

  // GET /settings/roles
  @Get('roles')
  @ApiOperation({ summary: 'List all roles with user count' })
  @ApiResponse({ status: 200, description: 'Roles retrieved' })
  getRoles(@GetUser() user: JwtUser) {
    return this.settingsService.getRoles(user.businessId);
  }

  // POST /settings/roles
  @Post('roles')
  @ApiOperation({ summary: 'Create a new role' })
  @ApiResponse({ status: 201, description: 'Role created' })
  @ApiResponse({ status: 409, description: 'Role name already exists' })
  createRole(@GetUser() user: JwtUser, @Body() dto: CreateRoleDto) {
    return this.settingsService.createRole(user.businessId, dto);
  }

  // PATCH /settings/roles/:id
  @Patch('roles/:id')
  @ApiOperation({ summary: 'Update a role' })
  @ApiResponse({ status: 200, description: 'Role updated' })
  @ApiResponse({ status: 403, description: 'System roles cannot be modified' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  updateRole(
    @GetUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.settingsService.updateRole(user.businessId, id, dto);
  }

  // DELETE /settings/roles/:id
  @Delete('roles/:id')
  @ApiOperation({
    summary: 'Delete a role (guard: no assigned users, not system)',
  })
  @ApiResponse({ status: 200, description: 'Role deleted' })
  @ApiResponse({ status: 400, description: 'Users still assigned to role' })
  @ApiResponse({ status: 403, description: 'Cannot delete system role' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  deleteRole(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.settingsService.deleteRole(user.businessId, id);
  }

  // ─── PERMISSIONS MANIFEST ──────────────────────────────────────────────────

  // GET /settings/permissions
  @Get('permissions')
  @ApiOperation({
    summary: 'Get static permission manifest (modules & actions)',
  })
  @ApiResponse({ status: 200, description: 'Permission manifest returned' })
  getPermissions() {
    return this.settingsService.getPermissions();
  }

  // ─── CATEGORIES ────────────────────────────────────────────────────────────

  // GET /settings/categories
  @Get('categories')
  @ApiOperation({ summary: 'List item categories for the business' })
  @ApiResponse({ status: 200, description: 'Categories retrieved' })
  getCategories(@GetUser() user: JwtUser) {
    return this.settingsService.getCategories(user.businessId);
  }

  // POST /settings/categories
  @Post('categories')
  @ApiOperation({ summary: 'Create a new category' })
  @ApiResponse({ status: 201, description: 'Category created' })
  @ApiResponse({ status: 409, description: 'Category name already exists' })
  createCategory(@GetUser() user: JwtUser, @Body() dto: CreateCategoryDto) {
    return this.settingsService.createCategory(user.businessId, dto);
  }

  // PATCH /settings/categories/:id
  @Patch('categories/:id')
  @ApiOperation({ summary: 'Update a category' })
  @ApiResponse({ status: 200, description: 'Category updated' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  updateCategory(
    @GetUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.settingsService.updateCategory(user.businessId, id, dto);
  }

  // DELETE /settings/categories/:id
  @Delete('categories/:id')
  @ApiOperation({
    summary: 'Soft-delete a category (fails if items are assigned)',
  })
  @ApiResponse({ status: 200, description: 'Category deleted' })
  @ApiResponse({ status: 400, description: 'Items still use this category' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  deleteCategory(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.settingsService.deleteCategory(user.businessId, id);
  }

  // ─── INVENTORY SETTINGS ────────────────────────────────────────────────────

  // GET /settings/inventory
  @Get('inventory')
  @ApiOperation({ summary: 'Get inventory settings (thresholds, alerts)' })
  @ApiResponse({ status: 200, description: 'Inventory settings retrieved' })
  getInventorySettings(@GetUser() user: JwtUser) {
    return this.settingsService.getInventorySettings(user.businessId);
  }

  // PUT /settings/inventory
  @Put('inventory')
  @ApiOperation({ summary: 'Update inventory settings' })
  @ApiResponse({ status: 200, description: 'Inventory settings updated' })
  updateInventorySettings(
    @GetUser() user: JwtUser,
    @Body() dto: InventorySettingsDto,
  ) {
    return this.settingsService.updateInventorySettings(user.businessId, dto);
  }

  // ─── PERIOD LOCKS ──────────────────────────────────────────────────────────

  // GET /settings/period-locks
  @Get('period-locks')
  @ApiOperation({ summary: 'List all period locks' })
  @ApiResponse({ status: 200, description: 'Period locks retrieved' })
  getPeriodLocks(@GetUser() user: JwtUser) {
    return this.settingsService.getPeriodLocks(user.businessId);
  }

  // POST /settings/period-locks
  @Post('period-locks')
  @ApiOperation({ summary: 'Create a period lock' })
  @ApiResponse({ status: 201, description: 'Period lock created' })
  @ApiResponse({ status: 409, description: 'Overlapping lock exists' })
  createPeriodLock(@GetUser() user: JwtUser, @Body() dto: CreatePeriodLockDto) {
    return this.settingsService.createPeriodLock(user.businessId, user.id, dto);
  }

  // DELETE /settings/period-locks/:id
  @Delete('period-locks/:id')
  @ApiOperation({ summary: 'Remove a period lock' })
  @ApiResponse({ status: 200, description: 'Period lock removed' })
  @ApiResponse({ status: 404, description: 'Lock not found' })
  deletePeriodLock(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.settingsService.deletePeriodLock(user.businessId, id);
  }

  // ─── STAFF MANAGEMENT ──────────────────────────────────────────────────────

  // GET /settings/staff
  @Get('staff')
  @ApiOperation({ summary: 'List all staff users for the business' })
  @ApiResponse({ status: 200, description: 'Staff list retrieved' })
  getStaff(@GetUser() user: JwtUser) {
    return this.settingsService.getStaff(user.businessId);
  }

  // PATCH /settings/staff/:id
  @Patch('staff/:id')
  @ApiOperation({ summary: 'Update staff member (role, branch, name, active)' })
  @ApiResponse({ status: 200, description: 'Staff updated' })
  @ApiResponse({ status: 404, description: 'Staff or role/branch not found' })
  updateStaff(
    @GetUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.settingsService.updateStaff(user.businessId, id, dto);
  }

  // DELETE /settings/staff/:id
  @Delete('staff/:id')
  @ApiOperation({ summary: 'Deactivate a staff member (soft delete)' })
  @ApiResponse({ status: 200, description: 'Staff deactivated' })
  @ApiResponse({ status: 403, description: 'Cannot deactivate yourself' })
  @ApiResponse({ status: 404, description: 'Staff not found' })
  deactivateStaff(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.settingsService.deactivateStaff(user.businessId, id, user.id);
  }

  // ─── DATA EXPORT ───────────────────────────────────────────────────────────

  // GET /settings/export?type=sales&startDate=2024-01-01&endDate=2024-12-31
  @Get('export')
  @ApiOperation({
    summary: 'Export business data as JSON',
    description:
      'Supports: sales, purchases, items, expenses, parties. Optional date range.',
  })
  @ApiResponse({ status: 200, description: 'Data exported' })
  exportData(@GetUser() user: JwtUser, @Query() query: ExportQueryDto) {
    return this.settingsService.exportData(user.businessId, query);
  }
}
