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
import { SaleReturnsService } from './sale-returns.service';
import { CreateSaleReturnDto } from './dto/create-sale-return.dto';
import { UpdateSaleReturnDto } from './dto/update-sale-return.dto';
import { QuerySaleReturnDto } from './dto/query-sale-return.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import type { JwtUser } from 'src/auth/types/jwt-user.type';

@ApiTags('Sale Returns')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('sales/returns')
export class SaleReturnsController {
  constructor(private readonly returnsService: SaleReturnsService) {}

  @Get()
  @ApiOperation({ summary: 'List all sales returns' })
  @ApiResponse({ status: 200, description: 'Returns retrieved successfully' })
  findAll(@GetUser() user: JwtUser, @Query() query: QuerySaleReturnDto) {
    return this.returnsService.findAll(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single sale return by ID' })
  findOne(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.returnsService.findOne(user, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new sale return' })
  @ApiResponse({ status: 201, description: 'Sale return processed' })
  @ApiResponse({
    status: 400,
    description: 'Validation error (quantity limit)',
  })
  create(@GetUser() user: JwtUser, @Body() dto: CreateSaleReturnDto) {
    return this.returnsService.create(user, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update return notes/status' })
  update(
    @GetUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateSaleReturnDto,
  ) {
    return this.returnsService.update(user, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel/void a return (soft delete with reversal)' })
  remove(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.returnsService.remove(user, id);
  }
}
