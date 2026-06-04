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
  ApiQuery,
} from '@nestjs/swagger';
import { PartiesService } from './parties.service';
import { CreatePartyDto } from './dto/create-party.dto';
import { UpdatePartyDto } from './dto/update-party.dto';
import { QueryPartyDto } from './dto/query-party.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import type { JwtUser } from 'src/auth/types/jwt-user.type';

@ApiTags('Parties')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('parties')
export class PartiesController {
  constructor(private readonly partiesService: PartiesService) {}

  // GET /parties
  @Get()
  @ApiOperation({
    summary: 'List parties with filtering and pagination',
    description:
      'Returns active parties by default. Pass isActive=false to include inactive. ' +
      'Includes per-page summary (total receivable, payable, customer/supplier counts).',
  })
  @ApiResponse({ status: 200, description: 'Parties retrieved successfully' })
  findAll(@GetUser() user: JwtUser, @Query() query: QueryPartyDto) {
    return this.partiesService.findAll(user.businessId, query);
  }

  // GET /parties/:id
  @Get(':id')
  @ApiOperation({
    summary: 'Get a single party with full details',
    description:
      'Returns party info, last 10 sales/purchases/payments, last 50 ledger entries, and aggregate stats.',
  })
  @ApiResponse({ status: 200, description: 'Party retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Party not found' })
  findOne(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.partiesService.findOne(user.businessId, id);
  }

  // POST /parties
  @Post()
  @ApiOperation({ summary: 'Create a new party (customer or supplier)' })
  @ApiResponse({ status: 201, description: 'Party created successfully' })
  @ApiResponse({
    status: 400,
    description: 'Validation error or invalid category/branch',
  })
  @ApiResponse({ status: 409, description: 'Phone number already in use' })
  create(@GetUser() user: JwtUser, @Body() dto: CreatePartyDto) {
    return this.partiesService.create(user.businessId, dto);
  }

  // PATCH /parties/:id
  @Patch(':id')
  @ApiOperation({ summary: 'Update party details' })
  @ApiResponse({ status: 200, description: 'Party updated successfully' })
  @ApiResponse({
    status: 400,
    description: 'Validation error or invalid category/branch',
  })
  @ApiResponse({ status: 404, description: 'Party not found' })
  @ApiResponse({ status: 409, description: 'Phone number already in use' })
  update(
    @GetUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdatePartyDto,
  ) {
    return this.partiesService.update(user.businessId, id, dto);
  }

  // DELETE /parties/:id  — soft delete
  @Delete(':id')
  @ApiOperation({
    summary: 'Soft-delete a party (sets isActive = false)',
    description:
      'Blocked if the party has active sales with outstanding balance or any non-zero current balance.',
  })
  @ApiResponse({ status: 200, description: 'Party deleted successfully' })
  @ApiResponse({
    status: 400,
    description: 'Party has active transactions or outstanding balance',
  })
  @ApiResponse({ status: 404, description: 'Party not found' })
  remove(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.partiesService.remove(user.businessId, id);
  }

  // GET /parties/:id/ledger
  @Get(':id/ledger')
  @ApiOperation({ summary: 'Get paginated ledger history for a party' })
  @ApiQuery({ name: 'page', required: false, example: '1' })
  @ApiQuery({ name: 'limit', required: false, example: '50' })
  @ApiResponse({ status: 200, description: 'Ledger retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Party not found' })
  getLedger(
    @GetUser() user: JwtUser,
    @Param('id') id: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    return this.partiesService.getLedger(
      user.businessId,
      id,
      parseInt(page, 10),
      parseInt(limit, 10),
    );
  }
}
