import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PurchaseItemInputDto } from './purchase-input.dto';
import { string } from 'joi';

export enum PurchasePaymentMethod {
  CASH = 'cash',
  BANK = 'bank',
  MOBILE = 'mobile_banking',
}

export class CreatePurchaseDto {
  @ApiPropertyOptional({ example: 'supplier123' })
  @IsOptional()
  @IsString()
  supplierId?: string;

  @ApiPropertyOptional({ example: 'INV-2024-001' })
  @IsOptional()
  @IsString()
  invoiceNo?: string;

  @ApiPropertyOptional({ example: 'GRN-2024-001' })
  @IsOptional()
  @IsString()
  grnNo?: string;

  @ApiProperty({ type: [PurchaseItemInputDto] })
  @IsArray()
  @IsNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemInputDto)
  items: PurchaseItemInputDto[];

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discount?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tax?: number;

  @ApiPropertyOptional({ example: 'pending | partial | received | cancelled' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  paidAmount?: number;

  @ApiPropertyOptional({ enum: PurchasePaymentMethod })
  @IsOptional()
  @IsEnum(PurchasePaymentMethod)
  paymentMethod?: PurchasePaymentMethod;

  @ApiPropertyOptional({ example: 'accountId123' })
  @IsOptional()
  @IsString()
  accountId?: string;

  @ApiPropertyOptional({ example: 'Regular purchase notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}
