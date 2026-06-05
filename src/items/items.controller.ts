import {
  Controller,
  Get,
  Post,
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
import { ItemsService } from './items.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { QueryItemDto } from './dto/query-item.dto';
import { StockAdjustmentDto } from './dto/stock-adjustment.dto';
import { ImportItemsDto } from './dto/import-items.dto';
import { StockTransferDto } from './dto/stock-transfer.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import type { JwtUser } from 'src/auth/types/jwt-user.type';

@ApiTags('Items')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  // GET /items
  @Get()
  @ApiOperation({ summary: 'List items with optional filtering & pagination' })
  @ApiResponse({ status: 200, description: 'Items retrieved successfully' })
  findAll(@GetUser() user: JwtUser, @Query() query: QueryItemDto) {
    return this.itemsService.findAll(user, query);
  }
  //Get /items/categories
  @Get('categories')
  @ApiOperation({ summary: 'Get list of item categories' })
  @ApiResponse({
    status: 200,
    description: 'Categories retrieved successfully',
  })
  getCategories(@GetUser() user: JwtUser) {
    return this.itemsService.getCategories(user.businessTypeId);
  }
  @Get('status')
  @ApiOperation({ summary: 'Get summary statistics of inventory items' })
  @ApiResponse({ status: 200, description: 'Items status retrieved' })
  getStatus(@GetUser() user: JwtUser) {
    return this.itemsService.getStatus(user);
  }

  // GET /items/:id  — includes last 10 stockHistory entries
  @Get(':id')
  @ApiOperation({ summary: 'Get a single item with recent stock history' })
  @ApiResponse({ status: 200, description: 'Item retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  findOne(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.itemsService.findOne(user, id);
  }

  // POST /items
  @Post()
  @ApiOperation({ summary: 'Create a new inventory item' })
  @ApiResponse({ status: 201, description: 'Item created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 409, description: 'Duplicate SKU' })
  create(@GetUser() user: JwtUser, @Body() dto: CreateItemDto) {
    return this.itemsService.create(user, dto);
  }

  // PATCH /items/:id  — update item fields only (no stock here)
  @Patch(':id')
  @ApiOperation({ summary: 'Update item fields' })
  @ApiResponse({ status: 200, description: 'Item updated successfully' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  @ApiResponse({ status: 409, description: 'Duplicate SKU' })
  update(
    @GetUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
  ) {
    return this.itemsService.update(user, id, dto);
  }

  // PATCH /items/:id/stock-adjust
  // Positive stockAdjustment = add stock, negative = reduce stock
  @Patch(':id/stock-adjust')
  @ApiOperation({
    summary: 'Adjust item stock (positive to add, negative to reduce)',
  })
  @ApiResponse({ status: 200, description: 'Stock adjusted successfully' })
  @ApiResponse({ status: 400, description: 'Would result in negative stock' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  adjustStock(
    @GetUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: StockAdjustmentDto,
  ) {
    return this.itemsService.adjustStock(user, id, dto);
  }

  @Post('import')
  @ApiOperation({ summary: 'Bulk import items' })
  @ApiResponse({ status: 201, description: 'Items imported successfully' })
  importItems(@GetUser() user: JwtUser, @Body() dto: ImportItemsDto) {
    return this.itemsService.importItems(user, dto);
  }

  @Post('transfer')
  @ApiOperation({ summary: 'Transfer stock between branches' })
  @ApiResponse({ status: 200, description: 'Stock transferred successfully' })
  @ApiResponse({
    status: 400,
    description: 'Insufficient stock or invalid branches',
  })
  transferStock(@GetUser() user: JwtUser, @Body() dto: StockTransferDto) {
    return this.itemsService.transferStock(user, dto);
  }

  // DELETE /items/:id  — soft delete
  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete an item (sets isActive = false)' })
  @ApiResponse({ status: 200, description: 'Item deleted successfully' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  remove(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.itemsService.remove(user, id);
  }

  // GET /items/:id/stock-ledger  — full history (last 100)
  @Get(':id/stock-ledger')
  @ApiOperation({ summary: 'Get full stock movement history for an item' })
  @ApiResponse({ status: 200, description: 'Stock ledger retrieved' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  getStockLedger(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.itemsService.getStockLedger(user, id);
  }
}
