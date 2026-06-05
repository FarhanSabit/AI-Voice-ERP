import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRoleDto {
  @ApiProperty({ example: 'Manager' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @ApiPropertyOptional({ example: 'ম্যানেজার' })
  @IsOptional()
  @IsString()
  nameBn?: string;

  @ApiPropertyOptional({ example: 'Branch manager with full access' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: 'purple',
    enum: ['gray', 'blue', 'green', 'red', 'purple', 'orange'],
  })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiProperty({
    example: { sales: ['view', 'create'], inventory: ['view'] },
    description: 'JSON object mapping module → allowed actions',
  })
  @IsObject()
  permissions: Record<string, string[]>;
}
