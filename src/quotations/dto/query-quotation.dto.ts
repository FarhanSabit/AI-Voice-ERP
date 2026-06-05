import { IsEnum, IsNumberString, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { QuotationStatus } from './create-quotation.dto';

export class QueryQuotationDto {
  @ApiPropertyOptional({ enum: QuotationStatus })
  @IsOptional()
  @IsEnum(QuotationStatus)
  status?: QuotationStatus | 'all';

  @ApiPropertyOptional({
    description: 'Search by quotation number or party name',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  partyId?: string;

  @ApiPropertyOptional({ description: 'ISO date string e.g. 2024-01-01' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'ISO date string e.g. 2024-01-31' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ default: '1' })
  @IsOptional()
  @IsNumberString()
  page?: string = '1';

  @ApiPropertyOptional({ default: '20' })
  @IsOptional()
  @IsNumberString()
  limit?: string = '20';

  @ApiPropertyOptional({ example: 'clx1234branchid' })
  @IsOptional()
  @IsString()
  branchId?: string;
}
