import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateBusinessDto {
  @ApiPropertyOptional({ example: 'My Store' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ example: 'আমার দোকান' })
  @IsOptional()
  @IsString()
  nameBn?: string;

  @ApiPropertyOptional({ example: '01700000000' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'business@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'Dhaka, Bangladesh' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({
    example: 'growth',
    enum: ['free', 'starter', 'growth', 'intelligence'],
  })
  @IsOptional()
  @IsString()
  plan?: string;

  @ApiPropertyOptional({ example: 'INV' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  invoicePrefix?: string;

  @ApiPropertyOptional({ example: 'Thank you for your business!' })
  @IsOptional()
  @IsString()
  invoiceFooter?: string;

  @ApiPropertyOptional({ example: 'A4', enum: ['A4', 'A5', 'Letter'] })
  @IsOptional()
  @IsString()
  invoicePaperSize?: string;

  @ApiPropertyOptional({ example: 'bn', enum: ['en', 'bn'] })
  @IsOptional()
  @IsString()
  invoiceLanguage?: string;
}
