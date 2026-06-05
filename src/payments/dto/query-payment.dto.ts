import { IsOptional, IsString, IsEnum, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentType, PaymentMode } from './create-payment.dto';

export class QueryPaymentDto {
  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({ example: '50' })
  @IsOptional()
  @IsString()
  limit?: string;

  @ApiPropertyOptional({ enum: PaymentType })
  @IsOptional()
  @IsEnum(PaymentType)
  type?: PaymentType;

  @ApiPropertyOptional({ enum: PaymentMode })
  @IsOptional()
  @IsEnum(PaymentMode)
  mode?: PaymentMode;

  @ApiPropertyOptional({ example: 'clx1234partyid' })
  @IsOptional()
  @IsString()
  partyId?: string;

  @ApiPropertyOptional({ example: 'clx1234saleid' })
  @IsOptional()
  @IsString()
  saleId?: string;

  @ApiPropertyOptional({ example: 'clx1234purchaseid' })
  @IsOptional()
  @IsString()
  purchaseId?: string;

  @ApiPropertyOptional({ example: '2024-01-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2024-12-31' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ example: 'clx1234branchid' })
  @IsOptional()
  @IsString()
  branchId?: string;
}
