import { Controller, Body, Post, UseGuards, Res, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterUserDto } from './dto/register-user.dto';
import { SigninDto } from './dto/signin.dto';
import { VerifyOtpDto, ResendOtpDto } from './dto/otp.dto';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import express, { CookieOptions } from 'express';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GetUser } from './decorators/get-user.decorator';
import type { JwtUser } from './types/jwt-user.type';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

const AUTH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'none',
  partitioned: true,
  path: '/',
};

const COOKIE_MAX_AGE = 7 * 24 * 3600000; // 7 days

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // POST /auth/register
  // Body: { name, phone, businessName, businessType, password }
  @Post('register')
  @ApiOperation({ summary: 'Register a new user and business' })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  signup(@Body() dto: RegisterUserDto) {
    return this.authService.signup(dto);
  }

  // POST /auth/verify-otp
  // Body: { uuid: userId, code: otp }
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 600000 } })
  @Post('verify-otp')
  @ApiOperation({ summary: 'Verify OTP after signup' })
  @ApiResponse({ status: 200, description: 'OTP verified successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Res({ passthrough: true }) response: express.Response,
  ) {
    const result = await this.authService.verifyOtp(dto.uuid, dto.code);

    if (result.accessToken) {
      response.cookie('Authentication', result.accessToken, {
        ...AUTH_COOKIE_OPTIONS,
        maxAge: COOKIE_MAX_AGE,
      });
    }

    return result;
  }

  // POST /auth/resend-otp
  // Body: { userId, purpose: 'signup' | 'signin' }
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 600000 } })
  @Post('resend-otp')
  @ApiOperation({
    summary: 'Resend OTP',
    description:
      'Works for both signup and signin OTP flows. ' +
      'Throttled: 60 seconds between requests.',
  })
  @ApiResponse({ status: 200, description: 'OTP resent successfully' })
  @ApiResponse({
    status: 400,
    description: 'Throttled, wrong purpose, or user not found',
  })
  resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto.userId, dto.purpose);
  }

  // POST /auth/signin
  // Body: { phone, password }
  // Validates credentials and returns a JWT token + sets auth cookie.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 per minute
  @Post('signin')
  @ApiOperation({
    summary: 'Sign in with phone and password',
    description: 'Authenticates the user and returns a JWT token immediately.',
  })
  @ApiResponse({ status: 200, description: 'Signin successful' })
  @ApiResponse({
    status: 401,
    description: 'Incorrect password or account deactivated',
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async signin(
    @Body() dto: SigninDto,
    @Res({ passthrough: true }) response: express.Response,
  ) {
    const result = await this.authService.signin(dto.phone, dto.password);

    response.cookie('Authentication', result.accessToken, {
      ...AUTH_COOKIE_OPTIONS,
      maxAge: COOKIE_MAX_AGE,
    });

    return result;
  }

  // GET /auth/status
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Get('status')
  @ApiOperation({ summary: 'Get current user status' })
  @ApiResponse({ status: 200, description: 'User status retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getStatus(@GetUser() user: JwtUser) {
    return {
      success: true,
      user: {
        id: user.id,
        branchId: user.branchId,
        businessTypeId: user.businessTypeId,
        phone: user.phone,
        role: user.role,
        businessId: user.businessId,
      },
    };
  }

  // POST /auth/logout
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Post('logout')
  @ApiOperation({ summary: 'Logout current user' })
  @ApiResponse({ status: 200, description: 'Logout successful' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  logout(@Res({ passthrough: true }) response: express.Response) {
    response.clearCookie('Authentication', AUTH_COOKIE_OPTIONS);
    return { success: true, message: 'Logout successful' };
  }

  @Get('business-types')
  @ApiOperation({ summary: 'Get list of business types' })
  @ApiResponse({ status: 200, description: 'Business types retrieved' })
  @ApiResponse({
    status: 401,
    description: 'Failed to retrieve business types',
  })
  getBusinessTypes() {
    return this.authService.getBusinessTypes();
  }
}
