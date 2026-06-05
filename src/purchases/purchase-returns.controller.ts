import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { PurchaseReturnsService } from './purchase-returns.service';
import { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import type { JwtUser } from 'src/auth/types/jwt-user.type';

@ApiTags('Purchase Returns')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('purchases/returns')
export class PurchaseReturnsController {
  constructor(private readonly returnsService: PurchaseReturnsService) {}

  @Get()
  @ApiOperation({ summary: 'List all purchase returns' })
  @ApiResponse({
    status: 200,
    description: 'Purchase returns retrieved successfully',
  })
  findAll(@GetUser() user: JwtUser) {
    return this.returnsService.findAll(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific purchase return with details' })
  @ApiResponse({
    status: 200,
    description: 'Purchase return retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Return not found' })
  findOne(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.returnsService.findOne(user, id);
  }

  @Post()
  @ApiOperation({
    summary:
      'Create a new purchase return (reversals, stock logic, debit notes)',
  })
  @ApiResponse({
    status: 201,
    description: 'Purchase return created successfully',
  })
  create(@GetUser() user: JwtUser, @Body() dto: CreatePurchaseReturnDto) {
    return this.returnsService.create(user, dto);
  }
}
