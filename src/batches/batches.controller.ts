import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { BatchesService } from './batches.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import type { JwtUser } from 'src/auth/types/jwt-user.type';

@ApiTags('Batches')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('batches')
export class BatchesController {
  constructor(private readonly batchesService: BatchesService) {}

  @Get('status')
  @ApiOperation({ summary: 'Get batches status summary' })
  getStatus(@GetUser() user: JwtUser) {
    return this.batchesService.getStatus(user.businessId);
  }

  @Get()
  @ApiOperation({ summary: 'List all batches with search and filtering' })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Search term for batch number, item name, or SKU',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description:
      'Filter batches by status. Supported values: "expired", "expiring" (within 30 days), "active", "inactive", "depleted"',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number for pagination (default: 1)',
    type: Number,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of items per page (default: 10)',
    type: Number,
  })
  findAll(
    @GetUser() user: JwtUser,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNumber = page ? parseInt(page, 10) : 1;
    const limitNumber = limit ? parseInt(limit, 10) : 10;
    return this.batchesService.findAll(
      user.businessId,
      search,
      status,
      pageNumber,
      limitNumber,
    );
  }
}
