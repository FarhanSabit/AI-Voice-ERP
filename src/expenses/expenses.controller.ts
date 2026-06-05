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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { createReadStream, existsSync } from 'fs';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expenses.dto';
import { UpdateExpenseDto } from './dto/update-expenses.dto';
import { QueryExpenseDto } from './dto/query-expenses.dto';
import { CreateExpenseCategoryDto } from './dto/create-expenses-category.dto';
import { UpdateExpenseCategoryDto } from './dto/update-expenses-category.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { GetUser } from 'src/auth/decorators/get-user.decorator';
import type { JwtUser } from 'src/auth/types/jwt-user.type';

@ApiTags('Expenses')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  // ── Expense routes ──────────────────────────────────────────────────────────

  // GET /expenses/summary  — must be before :id
  @Get('summary')
  @ApiOperation({
    summary: 'Expense summary stats',
    description:
      "Today's, this month's and all-time expense totals with change %, counts, and top categories.",
  })
  @ApiResponse({ status: 200, description: 'Summary retrieved successfully' })
  getSummary(@GetUser() user: JwtUser) {
    return this.expensesService.getSummary(user);
  }

  // GET /expenses
  @Get()
  @ApiOperation({ summary: 'List expenses with filtering and pagination' })
  @ApiResponse({ status: 200, description: 'Expenses retrieved successfully' })
  findAll(@GetUser() user: JwtUser, @Query() query: QueryExpenseDto) {
    return this.expensesService.findAll(user, query);
  }

  // ─── Category routes ─────────────────────────────────────────────────────────

  // GET /expenses/categories
  @Get('categories')
  @ApiOperation({
    summary: 'List expense categories',
    description:
      'Returns business-specific categories + global templates, each with expense count.',
  })
  @ApiResponse({
    status: 200,
    description: 'Categories retrieved successfully',
  })
  findAllCategories(@GetUser() user: JwtUser) {
    return this.expensesService.findAllCategories(user);
  }

  // GET /expenses/categories/:id
  @Get('categories/:id')
  @ApiOperation({ summary: 'Get a single expense category' })
  @ApiResponse({ status: 200, description: 'Category retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  findOneCategory(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.expensesService.findOneCategory(user, id);
  }

  // POST /expenses/categories
  @Post('categories')
  @ApiOperation({ summary: 'Create a new expense category' })
  @ApiResponse({ status: 201, description: 'Category created successfully' })
  @ApiResponse({ status: 409, description: 'Category name already exists' })
  createCategory(
    @GetUser() user: JwtUser,
    @Body() dto: CreateExpenseCategoryDto,
  ) {
    return this.expensesService.createCategory(user, dto);
  }

  // PATCH /expenses/categories/:id
  @Patch('categories/:id')
  @ApiOperation({ summary: 'Update an expense category' })
  @ApiResponse({ status: 200, description: 'Category updated successfully' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @ApiResponse({ status: 409, description: 'Category name already exists' })
  updateCategory(
    @GetUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseCategoryDto,
  ) {
    return this.expensesService.updateCategory(user, id, dto);
  }

  // DELETE /expenses/categories/:id
  @Delete('categories/:id')
  @ApiOperation({
    summary: 'Delete an expense category',
    description: 'Blocked if any expenses are still using this category.',
  })
  @ApiResponse({ status: 200, description: 'Category deleted successfully' })
  @ApiResponse({
    status: 400,
    description: 'Category is in use by existing expenses',
  })
  @ApiResponse({ status: 404, description: 'Category not found' })
  removeCategory(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.expensesService.removeCategory(user, id);
  }

  // GET /expenses/:id
  @Get(':id')
  @ApiOperation({ summary: 'Get a single expense' })
  @ApiResponse({ status: 200, description: 'Expense retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Expense not found' })
  findOne(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.expensesService.findOne(user, id);
  }

  // POST /expenses
  @Post()
  @ApiOperation({
    summary: 'Create a new expense and deduct from account balance',
  })
  @ApiResponse({ status: 201, description: 'Expense created successfully' })
  @ApiResponse({
    status: 400,
    description: 'Validation error or invalid category',
  })
  create(@GetUser() user: JwtUser, @Body() dto: CreateExpenseDto) {
    return this.expensesService.create(user, dto);
  }

  // PATCH /expenses/:id
  @Patch(':id')
  @ApiOperation({
    summary:
      'Update an expense — reconciles account balance on amount/account change',
  })
  @ApiResponse({ status: 200, description: 'Expense updated successfully' })
  @ApiResponse({ status: 404, description: 'Expense not found' })
  update(
    @GetUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.expensesService.update(user, id, dto);
  }

  // DELETE /expenses/:id
  @Delete(':id')
  @ApiOperation({ summary: 'Delete an expense and refund amount to account' })
  @ApiResponse({ status: 200, description: 'Expense deleted successfully' })
  @ApiResponse({ status: 404, description: 'Expense not found' })
  remove(@GetUser() user: JwtUser, @Param('id') id: string) {
    return this.expensesService.remove(user, id);
  }

  // ── File Upload routes ──────────────────────────────────────────────────────

  @Post('upload')
  @ApiOperation({ summary: 'Upload an expense receipt/file (Max 5MB)' })
  @ApiResponse({ status: 201, description: 'File uploaded successfully' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/expenses',
        filename: (req, file, cb) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = extname(file.originalname);
          cb(null, `${uniqueSuffix}${ext}`);
        },
      }),
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
      },
    }),
  )
  uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException(
        'File is required or exceeds 5MB size limit',
      );
    }
    return {
      url: `/api/expenses/file/${file.filename}`,
    };
  }

  @Get('file/:filename')
  @ApiOperation({ summary: 'Securely view an uploaded expense file' })
  getFile(@Param('filename') filename: string) {
    const filePath = join(process.cwd(), 'uploads', 'expenses', filename);
    if (!existsSync(filePath)) {
      throw new NotFoundException('File not found');
    }
    const fileStream = createReadStream(filePath);
    return new StreamableFile(fileStream);
  }
}
