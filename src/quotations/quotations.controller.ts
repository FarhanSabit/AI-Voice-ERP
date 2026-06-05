import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
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
} from '@nestjs/swagger';
import { QuotationsService } from './quotations.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { EditQuotationDto } from './dto/edit-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { QueryQuotationDto } from './dto/query-quotation.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { StoredQuotationItem } from './quotation.types';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import type { JwtUser } from 'src/auth/types/jwt-user.type';

@ApiTags('Quotations')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('quotations')
export class QuotationsController {
  constructor(private readonly quotationsService: QuotationsService) {}

  // GET /quotations/summary  — declared before :id to avoid param capture
  @Get('summary')
  @ApiOperation({
    summary: 'Quotation summary stats',
    description:
      'Total & monthly counts, value, per-status breakdown, and conversion rate.',
  })
  @ApiResponse({ status: 200, description: 'Summary retrieved successfully' })
  getSummary(@GetUser() user: JwtUser) {
    return this.quotationsService.getSummary(user);
  }

  // GET /quotations
  @Get()
  @ApiOperation({ summary: 'List quotations with filtering and pagination' })
  @ApiResponse({
    status: 200,
    description: 'Quotations retrieved successfully',
  })
  findAll(@GetUser() user: JwtUser, @Query() query: QueryQuotationDto) {
    return this.quotationsService.findAll(user, query);
  }

  // GET /quotations/:id
  @Get(':id')
  @ApiOperation({ summary: 'Get a single quotation' })
  @ApiResponse({ status: 200, description: 'Quotation retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Quotation not found' })
  findOne(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.quotationsService.findOne(user, id);
  }

  // POST /quotations
  @Post()
  @ApiOperation({ summary: 'Create a new quotation' })
  @ApiResponse({ status: 201, description: 'Quotation created successfully' })
  @ApiResponse({
    status: 400,
    description: 'Validation error or item not found',
  })
  create(@GetUser() user: JwtUser, @Body() dto: CreateQuotationDto) {
    return this.quotationsService.create(user, dto);
  }

  // PUT /quotations/:id  — full content edit (items, amounts, dates)
  @Put(':id')
  @ApiOperation({
    summary: 'Edit a quotation — replaces items and recalculates totals',
    description:
      'Supply only the fields you want to change. If `items` is provided, ' +
      'old items are fully replaced. Only draft and sent quotations can be edited.',
  })
  @ApiResponse({ status: 200, description: 'Quotation edited successfully' })
  @ApiResponse({
    status: 400,
    description: 'Validation error or item not found',
  })
  @ApiResponse({
    status: 403,
    description: 'Cannot edit accepted, converted or rejected quotations',
  })
  @ApiResponse({ status: 404, description: 'Quotation not found' })
  editQuotation(
    @GetUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: EditQuotationDto,
  ) {
    return this.quotationsService.editQuotation(user, id, dto);
  }

  // PATCH /quotations/:id  — status update only
  @Patch(':id')
  @ApiOperation({
    summary: 'Update quotation status',
    description:
      'Use for status transitions: draft → sent → accepted / rejected / expired. ' +
      'Also accepts `convertedToSaleId` to record a manual sale link.',
  })
  @ApiResponse({ status: 200, description: 'Quotation updated successfully' })
  @ApiResponse({
    status: 403,
    description: 'Cannot update a converted quotation',
  })
  @ApiResponse({ status: 404, description: 'Quotation not found' })
  update(
    @GetUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateQuotationDto,
  ) {
    return this.quotationsService.update(user, id, dto);
  }

  // POST /quotations/:id/convert  — convert quotation → sale
  @Post(':id/convert')
  @ApiOperation({
    summary: 'Convert quotation to sale',
    description:
      'Creates a Sale record from the quotation items, deducts stock, ' +
      'updates party balance if a partyId is set, and marks the quotation as converted. ' +
      'Blocked if any item has insufficient stock.',
  })
  @ApiResponse({
    status: 201,
    description: 'Quotation converted to sale successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Insufficient stock or item no longer available',
  })
  @ApiResponse({
    status: 403,
    description: 'Quotation already converted, rejected, or expired',
  })
  @ApiResponse({ status: 404, description: 'Quotation not found' })
  convertToSale(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.quotationsService.convertToSale(user, id);
  }

  // DELETE /quotations/:id  — only draft quotations
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a quotation',
    description:
      'Only draft quotations can be deleted. All others must be cancelled via PATCH.',
  })
  @ApiResponse({ status: 200, description: 'Quotation deleted successfully' })
  @ApiResponse({
    status: 403,
    description: 'Only draft quotations can be deleted',
  })
  @ApiResponse({ status: 404, description: 'Quotation not found' })
  remove(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.quotationsService.remove(user, id);
  }
}
