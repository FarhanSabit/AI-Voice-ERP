import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum PartyType {
  CUSTOMER = 'customer',
  SUPPLIER = 'supplier',
}

export enum CustomerTier {
  REGULAR = 'regular',
  SILVER = 'silver',
  GOLD = 'gold',
  PLATINUM = 'platinum',
  VIP = 'vip',
}

export enum RiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export class CreatePartyDto {
  @ApiProperty({ example: 'Rahim Traders' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: '01712345678' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'rahim@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'Dhaka, Bangladesh' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ enum: PartyType, default: PartyType.CUSTOMER })
  @IsOptional()
  @IsEnum(PartyType)
  type?: PartyType;

  // @ApiPropertyOptional({ enum: CustomerTier })
  // @IsOptional()
  // @IsEnum(CustomerTier)
  // customerTier?: CustomerTier;

  // @ApiPropertyOptional({ example: 'clx1234categoryid' })
  // @IsOptional()
  // @IsString()
  // categoryId?: string;

  @ApiPropertyOptional({ example: 'clx1234branchid' })
  @IsOptional()
  @IsString()
  branchId?: string;

  @ApiPropertyOptional({
    example: 0,
    description: 'Opening balance (positive = receivable, negative = payable)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  openingBalance?: number;

  @ApiPropertyOptional({ example: 50000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  creditLimit?: number;

  // @ApiPropertyOptional({ example: 30, description: 'Payment terms in days' })
  // @IsOptional()
  // @Type(() => Number)
  // @IsNumber()
  // @Min(0)
  // paymentTerms?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
