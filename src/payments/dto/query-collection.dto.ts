import { IsOptional, IsString, IsEnum, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum OverdueRange {
  ALL = 'all',
  BUCKET_0_30 = '0-30',
  BUCKET_31_60 = '31-60',
  BUCKET_61_90 = '61-90',
  BUCKET_OVER_90 = '90+',
}

export class QueryCollectionDto {
  @ApiPropertyOptional({ example: '1' })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({ example: '50' })
  @IsOptional()
  @IsString()
  limit?: string;

  @ApiPropertyOptional({ example: 'Abdul' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: OverdueRange,
    example: OverdueRange.BUCKET_31_60,
  })
  @IsOptional()
  @IsEnum(OverdueRange)
  overdueRange?: OverdueRange;

  @ApiPropertyOptional({ example: 'high', description: 'low | medium | high' })
  @IsOptional()
  @IsString()
  riskLevel?: string;

  @ApiPropertyOptional({ example: '2024-01-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2024-12-31' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
