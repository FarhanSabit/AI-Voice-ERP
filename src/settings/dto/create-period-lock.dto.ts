import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePeriodLockDto {
  @ApiProperty({ example: '2024-01-01' })
  @IsDateString()
  @IsNotEmpty()
  periodStart: string;

  @ApiProperty({ example: '2024-03-31' })
  @IsDateString()
  @IsNotEmpty()
  periodEnd: string;

  @ApiPropertyOptional({ example: 'Q1 2024 period locked' })
  @IsOptional()
  @IsString()
  notes?: string;
}
