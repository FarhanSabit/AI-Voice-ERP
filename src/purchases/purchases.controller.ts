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
import { PurchasesService } from './purchases.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import { QueryPurchaseDto } from './dto/query-purchase.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import type { JwtUser } from 'src/auth/types/jwt-user.type';

@ApiTags('Purchases')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('purchases')
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Get()
  @ApiOperation({ summary: 'List purchases with filtering and pagination' })
  @ApiResponse({ status: 200, description: 'Purchases retrieved successfully' })
  findAll(@GetUser() user: JwtUser, @Query() query: QueryPurchaseDto) {
    return this.purchasesService.findAll(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single purchase with full details' })
  @ApiResponse({ status: 200, description: 'Purchase retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Purchase not found' })
  findOne(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.purchasesService.findOne(user, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new purchase with stock updates' })
  @ApiResponse({ status: 201, description: 'Purchase created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  create(@GetUser() user: JwtUser, @Body() dto: CreatePurchaseDto) {
    return this.purchasesService.create(user, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update purchase status or notes' })
  @ApiResponse({ status: 200, description: 'Purchase updated successfully' })
  @ApiResponse({ status: 404, description: 'Purchase not found' })
  update(
    @GetUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseDto,
  ) {
    return this.purchasesService.updateStatus(user, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel a purchase (soft delete)' })
  @ApiResponse({ status: 200, description: 'Purchase cancelled successfully' })
  @ApiResponse({ status: 403, description: 'Purchase is already cancelled' })
  @ApiResponse({ status: 404, description: 'Purchase not found' })
  remove(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.purchasesService.remove(user, id);
  }
}
