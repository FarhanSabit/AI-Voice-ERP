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
import { SalesService } from './sales.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { EditSaleDto } from './dto/edit-sale.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';
import { QuerySaleDto } from './dto/query-sale.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import type { JwtUser } from 'src/auth/types/jwt-user.type';

@ApiTags('Sales')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  // GET /sales
  @Get()
  @ApiOperation({ summary: 'List sales with filtering and pagination' })
  @ApiResponse({ status: 200, description: 'Sales retrieved successfully' })
  findAll(@GetUser() user: JwtUser, @Query() query: QuerySaleDto) {
    return this.salesService.findAll(user, query);
  }

  // GET /sales/summary  — dashboard stats card data
  // IMPORTANT: declared before :id route to avoid param capture
  @Get('summary')
  @ApiOperation({
    summary: 'Sales summary stats',
    description:
      "Returns today's sales, this month's sales, all-time totals, " +
      'average sale value, and count — each with a change % vs the previous period.',
  })
  @ApiResponse({ status: 200, description: 'Summary retrieved successfully' })
  getSummary(@GetUser() user: JwtUser) {
    return this.salesService.getSummary(user);
  }

  // GET /sales/:id
  @Get(':id')
  @ApiOperation({
    summary: 'Get a single sale with full item and party details',
  })
  @ApiResponse({ status: 200, description: 'Sale retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Sale not found' })
  findOne(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.salesService.findOne(user, id);
  }

  // POST /sales
  @Post()
  @ApiOperation({ summary: 'Create a new sale' })
  @ApiResponse({ status: 201, description: 'Sale created successfully' })
  @ApiResponse({
    status: 400,
    description: 'Validation error or insufficient stock',
  })
  create(@GetUser() user: JwtUser, @Body() dto: CreateSaleDto) {
    return this.salesService.create(user, dto);
  }

  // PUT /sales/:id  — full edit (items, amounts, party, payment)
  @Put(':id')
  @ApiOperation({
    summary: 'Edit a sale — replaces items and recalculates all totals',
    description:
      'Supply only the fields you want to change. If `items` is provided, ' +
      'old items are reversed and replaced entirely. Stock and party ledger ' +
      'are reconciled automatically. Cannot edit cancelled or returned sales.',
  })
  @ApiResponse({ status: 200, description: 'Sale edited successfully' })
  @ApiResponse({
    status: 400,
    description: 'Validation error or insufficient stock',
  })
  @ApiResponse({
    status: 403,
    description: 'Cannot edit a cancelled or returned sale',
  })
  @ApiResponse({ status: 404, description: 'Sale not found' })
  editSale(
    @GetUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: EditSaleDto,
  ) {
    return this.salesService.editSale(user, id, dto);
  }

  // PATCH /sales/:id  — status-only update (cancel / return / complete)
  @Patch(':id')
  @ApiOperation({ summary: 'Update sale status (cancel, return, complete)' })
  @ApiResponse({ status: 200, description: 'Sale status updated successfully' })
  @ApiResponse({
    status: 403,
    description: 'Cannot modify a cancelled or returned sale',
  })
  @ApiResponse({ status: 404, description: 'Sale not found' })
  update(
    @GetUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateSaleDto,
  ) {
    return this.salesService.update(user, id, dto);
  }

  // DELETE /sales/:id  — soft delete (cancels sale, restores stock)
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a sale (soft delete)',
    description:
      'Marks the sale as cancelled, restores stock for all items, ' +
      'and reverses the party ledger entry for any outstanding due amount.',
  })
  @ApiResponse({ status: 200, description: 'Sale deleted successfully' })
  @ApiResponse({
    status: 403,
    description: 'Sale is already cancelled or returned',
  })
  @ApiResponse({ status: 404, description: 'Sale not found' })
  remove(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.salesService.remove(user, id);
  }
}
