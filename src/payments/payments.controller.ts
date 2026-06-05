import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import type { JwtUser } from 'src/auth/types/jwt-user.type';

import { CreatePaymentDto } from './dto/create-payment.dto';
import { QueryPaymentDto } from './dto/query-payment.dto';
import { CreatePaymentPlanDto } from './dto/create-payment-plan.dto';
import { PayInstallmentDto } from './dto/pay-installment.dto';
import { CreateReminderDto } from './dto/create-reminder.dto';
import {
  CreatePromiseToPayDto,
  UpdatePromiseStatusDto,
} from './dto/create-promise.dto';
import { CreateFollowUpNoteDto } from './dto/create-followup.dto';
import { QueryCollectionDto } from './dto/query-collection.dto';

@ApiTags('Payments & Collections')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // ══════════════════════════════════════════════════════════════════════════
  // PAYMENT SUMMARY
  // ══════════════════════════════════════════════════════════════════════════

  @Get('summary')
  @ApiOperation({
    summary: 'Payment summary',
    description:
      "Today's received/paid totals, month totals, outstanding receivables, and active plan count.",
  })
  @ApiResponse({ status: 200, description: 'Summary retrieved' })
  getSummary(@GetUser() user: JwtUser) {
    return this.paymentsService.getPaymentSummary(user);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 10.1  PAYMENTS — list, create, get, delete
  // ══════════════════════════════════════════════════════════════════════════

  @Get()
  @ApiOperation({
    summary: 'List payments',
    description:
      'List all payments (received + paid) with filtering by type, mode, party, and date range.',
  })
  @ApiResponse({ status: 200, description: 'Payments retrieved' })
  findAll(@GetUser() user: JwtUser, @Query() query: QueryPaymentDto) {
    return this.paymentsService.findAllPayments(user, query);
  }

  @Get('allocations/:paymentId')
  @ApiOperation({ summary: 'Get invoice allocations for a payment' })
  @ApiParam({ name: 'paymentId', description: 'Payment ID' })
  @ApiResponse({ status: 200, description: 'Allocations retrieved' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  getAllocations(
    @GetUser() user: JwtUser,
    @Param('paymentId') paymentId: string,
  ) {
    return this.paymentsService.getPaymentAllocations(user, paymentId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single payment' })
  @ApiParam({ name: 'id', description: 'Payment ID' })
  @ApiResponse({ status: 200, description: 'Payment retrieved' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  findOne(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.paymentsService.findOnePayment(user, id);
  }

  @Post()
  @ApiOperation({
    summary: 'Record a payment',
    description:
      'Records a payment received from customer or paid to supplier. Updates party balance, party ledger, account balance, and sale/purchase due amounts.',
  })
  @ApiResponse({ status: 201, description: 'Payment recorded' })
  @ApiResponse({
    status: 400,
    description: 'Validation error or party not found',
  })
  create(@GetUser() user: JwtUser, @Body() dto: CreatePaymentDto) {
    return this.paymentsService.createPayment(user, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a payment' })
  @ApiParam({ name: 'id', description: 'Payment ID' })
  @ApiResponse({ status: 200, description: 'Payment deleted' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  remove(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.paymentsService.deletePayment(user, id);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 10.2  SUPPLIER PAYMENTS (shorthand list endpoint)
  // ══════════════════════════════════════════════════════════════════════════

  @Get('supplier/list')
  @ApiOperation({
    summary: 'List supplier payments',
    description: 'Convenience endpoint — returns only type=paid payments.',
  })
  @ApiResponse({ status: 200, description: 'Supplier payments retrieved' })
  findSupplierPayments(
    @GetUser() user: JwtUser,
    @Query() query: QueryPaymentDto,
  ) {
    return this.paymentsService.findSupplierPayments(user, query);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 10.3  PAYMENT PLANS (Installments)
  // ══════════════════════════════════════════════════════════════════════════

  @Get('plans/list')
  @ApiOperation({
    summary: 'List payment plans',
    description:
      'List all active/completed installment plans. Filter by partyId.',
  })
  @ApiQuery({ name: 'partyId', required: false })
  @ApiResponse({ status: 200, description: 'Plans retrieved' })
  findAllPlans(@GetUser() user: JwtUser, @Query('partyId') partyId?: string) {
    return this.paymentsService.findAllPlans(user, partyId);
  }

  @Get('plans/:id')
  @ApiOperation({ summary: 'Get a single payment plan with installments' })
  @ApiParam({ name: 'id', description: 'Payment Plan ID' })
  @ApiResponse({ status: 200, description: 'Plan retrieved' })
  @ApiResponse({ status: 404, description: 'Plan not found' })
  findOnePlan(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.paymentsService.findOnePlan(user, id);
  }

  @Post('plans')
  @ApiOperation({
    summary: 'Create a payment plan (installments)',
    description:
      'Auto-generates installment records based on total amount, count, and frequency. Start date sets first due date.',
  })
  @ApiResponse({ status: 201, description: 'Plan created' })
  @ApiResponse({ status: 400, description: 'Party not found' })
  createPlan(@GetUser() user: JwtUser, @Body() dto: CreatePaymentPlanDto) {
    return this.paymentsService.createPlan(user, dto);
  }

  @Post('plans/:planId/installments/:installmentId/pay')
  @ApiOperation({
    summary: 'Mark an installment as paid',
    description:
      'Records payment for this installment, updates plan totals, party balance, ledger, and account.',
  })
  @ApiParam({ name: 'planId', description: 'Payment Plan ID' })
  @ApiParam({ name: 'installmentId', description: 'Installment ID' })
  @ApiResponse({ status: 200, description: 'Installment paid, plan updated' })
  @ApiResponse({ status: 400, description: 'Already paid or invalid' })
  @ApiResponse({ status: 404, description: 'Installment not found' })
  payInstallment(
    @GetUser() user: JwtUser,
    @Param('planId') planId: string,
    @Param('installmentId') installmentId: string,
    @Body() dto: PayInstallmentDto,
  ) {
    return this.paymentsService.payInstallment(
      user,
      planId,
      installmentId,
      dto,
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // COLLECTION CENTER
  // ══════════════════════════════════════════════════════════════════════════

  @Get('collection/center')
  @ApiOperation({
    summary: 'Collection center',
    description:
      'Lists overdue customers with outstanding balances. Supports search, aging bucket filter, and risk level filter.',
  })
  @ApiResponse({ status: 200, description: 'Collection data retrieved' })
  getCollectionCenter(
    @GetUser() user: JwtUser,
    @Query() query: QueryCollectionDto,
  ) {
    return this.paymentsService.getCollectionCenter(user, query);
  }

  @Get('collection/overdue')
  @ApiOperation({
    summary: 'Overdue customer tracking',
    description:
      'Returns all overdue customers grouped into aging buckets: 0-30, 31-60, 61-90, 90+ days.',
  })
  @ApiResponse({ status: 200, description: 'Overdue customers retrieved' })
  getOverdueCustomers(@GetUser() user: JwtUser) {
    return this.paymentsService.getOverdueCustomers(user);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // REMINDERS
  // ══════════════════════════════════════════════════════════════════════════

  @Get('collection/reminders')
  @ApiOperation({
    summary: 'List collection reminders',
    description: 'List all scheduled reminders. Optionally filter by partyId.',
  })
  @ApiQuery({ name: 'partyId', required: false })
  @ApiResponse({ status: 200, description: 'Reminders retrieved' })
  findReminders(@GetUser() user: JwtUser, @Query('partyId') partyId?: string) {
    return this.paymentsService.findReminders(user, partyId);
  }

  @Post('collection/reminders')
  @ApiOperation({
    summary: 'Schedule a collection reminder',
    description:
      'Creates a reminder for a customer. Channels: manual, sms, whatsapp, email. Types: overdue, upcoming, custom.',
  })
  @ApiResponse({ status: 201, description: 'Reminder scheduled' })
  @ApiResponse({ status: 400, description: 'Party not found' })
  createReminder(@GetUser() user: JwtUser, @Body() dto: CreateReminderDto) {
    return this.paymentsService.createReminder(user, dto);
  }

  @Patch('collection/reminders/:id/sent')
  @ApiOperation({ summary: 'Mark reminder as sent' })
  @ApiParam({ name: 'id', description: 'Reminder ID' })
  @ApiResponse({ status: 200, description: 'Reminder marked as sent' })
  @ApiResponse({ status: 404, description: 'Reminder not found' })
  markReminderSent(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.paymentsService.markReminderSent(user, id);
  }

  @Delete('collection/reminders/:id')
  @ApiOperation({ summary: 'Cancel / delete a reminder' })
  @ApiParam({ name: 'id', description: 'Reminder ID' })
  @ApiResponse({ status: 200, description: 'Reminder cancelled' })
  @ApiResponse({ status: 404, description: 'Reminder not found' })
  deleteReminder(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.paymentsService.deleteReminder(user, id);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PROMISE TO PAY
  // ══════════════════════════════════════════════════════════════════════════

  @Get('collection/promises')
  @ApiOperation({
    summary: 'List promise-to-pay commitments',
    description: 'List all PTP records. Optionally filter by partyId.',
  })
  @ApiQuery({ name: 'partyId', required: false })
  @ApiResponse({ status: 200, description: 'Promises retrieved' })
  findPromises(@GetUser() user: JwtUser, @Query('partyId') partyId?: string) {
    return this.paymentsService.findPromises(user, partyId);
  }

  @Post('collection/promises')
  @ApiOperation({
    summary: 'Record a promise to pay',
    description:
      'Customer commits to pay a specific amount by a specific date. Status: pending | kept | broken | partial.',
  })
  @ApiResponse({ status: 201, description: 'Promise recorded' })
  @ApiResponse({ status: 400, description: 'Party not found' })
  createPromise(@GetUser() user: JwtUser, @Body() dto: CreatePromiseToPayDto) {
    return this.paymentsService.createPromise(user, dto);
  }

  @Patch('collection/promises/:id/status')
  @ApiOperation({
    summary: 'Update promise-to-pay status',
    description: 'Mark promise as kept, broken, or partial.',
  })
  @ApiParam({ name: 'id', description: 'Promise ID' })
  @ApiResponse({ status: 200, description: 'Status updated' })
  @ApiResponse({ status: 404, description: 'Promise not found' })
  updatePromiseStatus(
    @GetUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdatePromiseStatusDto,
  ) {
    return this.paymentsService.updatePromiseStatus(user, id, dto);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FOLLOW-UP NOTES
  // ══════════════════════════════════════════════════════════════════════════

  @Get('collection/followups')
  @ApiOperation({
    summary: 'List follow-up notes',
    description:
      'List all collection follow-up notes. Optionally filter by partyId.',
  })
  @ApiQuery({ name: 'partyId', required: false })
  @ApiResponse({ status: 200, description: 'Follow-up notes retrieved' })
  findFollowUps(@GetUser() user: JwtUser, @Query('partyId') partyId?: string) {
    return this.paymentsService.findFollowUps(user, partyId);
  }

  @Post('collection/followups')
  @ApiOperation({
    summary: 'Add a follow-up note',
    description:
      'Collection agent records the outcome of a contact attempt. Outcomes: contacted | no_answer | promised | refused | paid.',
  })
  @ApiResponse({ status: 201, description: 'Follow-up note added' })
  @ApiResponse({ status: 400, description: 'Party not found' })
  createFollowUp(@GetUser() user: JwtUser, @Body() dto: CreateFollowUpNoteDto) {
    return this.paymentsService.createFollowUp(user, dto);
  }
}
