import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { RegisterUserDto } from './dto/register-user.dto';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

export const roundsOfHashing = 12;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    @InjectPinoLogger(AuthService.name)
    private readonly logger: PinoLogger,
  ) {}

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async findUserByPhone(phone: string) {
    return this.prisma.user.findUnique({
      where: { phone },
      include: { role: true },
    });
  }

  private async findUserById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });
  }

  private buildTokenPayload(user: {
    id: string;
    phone: string;
    name: string | null;
    role?: any;
    businessId: string;
  }) {
    return {
      sub: user.id,
      phone: user.phone,
      username: user.name,
      role: user.role?.name || 'owner',
      businessId: user.businessId,
    };
  }

  private async fetchBusinessInfo(businessId: string) {
    return this.prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, name: true, logo: true, currency: true },
    });
  }

  // ─── 1. SIGNUP ────────────────────────────────────────────────────────────
  // POST /auth/signup
  // Body: { name, phone, businessName, businessType }
  // Example: { "name": "John Doe", "phone": "1234567890", "businessName": "Acme Corp", "businessType": "retail" }
  // Response: { userId, otp } → use to call POST /auth/verify-otp
  async signup(dto: RegisterUserDto) {
    // 1. Guard: phone must be unique
    const existingUser = await this.findUserByPhone(dto.phone);
    if (existingUser) {
      this.logger.warn(
        { phone: dto.phone },
        'Signup failed: phone already exists',
      );
      throw new BadRequestException(
        'Phone already registered. Please sign in.',
      );
    }

    // 2. Resolve BusinessType
    const businessType = await this.prisma.businessType.findUnique({
      where: { value: dto.businessType },
    });
    if (!businessType) {
      throw new BadRequestException(
        `Unknown business type: "${dto.businessType}"`,
      );
    }

    // 3. Create Business + User atomically
    // Hash password before the transaction to keep crypto out of the DB round-trip
    const hashedPassword = await bcrypt.hash(dto.password, roundsOfHashing);

    const { business, user } = await this.prisma.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: {
          name: dto.businessName,
          type: dto.businessType,
          businessTypeId: businessType.id,
        },
      });
      const branch = await tx.branch.create({
        data: {
          name: 'Main Branch',
          businessId: business.id,
          isMain: true,
        },
      });
      const role = await tx.role.create({
        data: {
          businessId: business.id,
          name: 'owner',
          permissions: '*',
          isSystem: true,
          isDefault: true,
        },
      });
      const user = await tx.user.create({
        data: {
          name: dto.name,
          branchId: branch.id,
          phone: dto.phone,
          businessId: business.id,
          businessTypeId: businessType.id,
          provider: 'PHONE',
          // OTP verification is always required — phone stays unverified until then
          isPhoneVerified: false,
          roleId: role.id,
          password: hashedPassword,
        },
      });

      return { business, user, branch };
    });

    // 4. Generate + hash OTP (always required, even when password is set)
    const rawOtp = randomInt(100000, 999999).toString();
    const hashedOtp = await bcrypt.hash(rawOtp, roundsOfHashing);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // 5. Invalidate stale OTPs, save new one
    await this.prisma.otp.updateMany({
      where: { phone: dto.phone, verified: false },
      data: { verified: true },
    });

    await this.prisma.otp.create({
      data: {
        phone: dto.phone,
        businessId: business.id,
        code: hashedOtp,
        purpose: 'signup',
        expiresAt,
      },
    });

    this.logger.info(
      { userId: user.id, businessId: business.id },
      'Signup successful — OTP generated',
    );

    // In production: send rawOtp via SMS, remove from response
    return {
      success: true,
      message:
        'Registration successful. Please verify your phone with the OTP.',
      data: {
        userId: user.id,
        otp: rawOtp,
      },
    };
  }

  // ─── 2. VERIFY OTP (after signup only) ────────────────────────────────────
  // POST /auth/verify-otp
  // Body: { userId, otp }
  // Response: { accessToken, user, business }
  async verifyOtp(userId: string, code: string) {
    const user = await this.findUserById(userId);
    if (!user) {
      throw new BadRequestException('User not found.');
    }
    if (user.isPhoneVerified) {
      throw new BadRequestException('Phone already verified. Please sign in.');
    }

    // Find latest valid OTP
    const otpRecord = await this.prisma.otp.findFirst({
      where: {
        phone: user.phone,
        verified: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      throw new UnauthorizedException('OTP not found or has expired.');
    }

    // Verify code against hash
    const isValid = await bcrypt.compare(code, otpRecord.code);
    if (!isValid) {
      await this.prisma.otp.update({
        where: { id: otpRecord.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Incorrect OTP.');
    }

    // Mark OTP as used + mark phone as verified atomically
    await this.prisma.$transaction([
      this.prisma.otp.update({
        where: { id: otpRecord.id },
        data: { verified: true },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { isPhoneVerified: true },
      }),
    ]);

    // Issue token
    const accessToken = this.jwtService.sign(this.buildTokenPayload(user), {
      expiresIn: '7d',
    });

    const business = await this.fetchBusinessInfo(user.businessId);

    this.logger.info({ userId: user.id }, 'Phone verified — token issued');

    return {
      success: true,
      message: 'Phone verified successfully.',
      accessToken,
      user: {
        id: user.id,
        branchId: user.branchId,
        name: user.name,
        phone: user.phone,
        role: user.role?.name || 'owner',
      },
      business,
    };
  }

  // ─── 3. SIGNIN ─────────────────────────────────────────────────────────────
  // POST /auth/signin
  // Body: { phone, password }
  // Validates credentials and returns a JWT token immediately.
  async signin(phone: string, password: string) {
    const user = await this.findUserByPhone(phone);

    if (!user) {
      throw new NotFoundException('User not found. Please sign up first.');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated.');
    }
    if (!user.isPhoneVerified) {
      throw new UnauthorizedException(
        'Phone not verified. Please verify your OTP first using POST /api/auth/verify-otp.',
      );
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Incorrect password.');
    }

    const accessToken = this.jwtService.sign(this.buildTokenPayload(user), {
      expiresIn: '7d',
    });

    const business = await this.fetchBusinessInfo(user.businessId);

    this.logger.info({ userId: user.id }, 'Signin successful — token issued');

    return {
      success: true,
      message: 'Signin successful.',
      accessToken,
      user: {
        id: user.id,
        branchId: user.branchId,
        name: user.name,
        phone: user.phone,
        role: user.role?.name || 'owner',
      },
      business,
    };
  }

  // ─── RESEND OTP ────────────────────────────────────────────────────────────
  // POST /auth/resend-otp
  // Body: { userId, purpose: 'signup' | 'signin' }
  // Throttled: must wait 60 seconds between resend requests
  async resendOtp(userId: string, purpose: 'signup' | 'signin') {
    const user = await this.findUserById(userId);
    if (!user) {
      throw new BadRequestException('User not found.');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated.');
    }

    // ── Context-specific guards ───────────────────────────────────────────────
    if (purpose === 'signup' && user.isPhoneVerified) {
      throw new BadRequestException('Phone already verified. Please sign in.');
    }
    if (purpose === 'signin' && !user.isPhoneVerified) {
      throw new BadRequestException(
        'Phone not verified. Please complete signup first.',
      );
    }

    // ── 60-second throttle ────────────────────────────────────────────────────
    const recentOtp = await this.prisma.otp.findFirst({
      where: {
        phone: user.phone,
        verified: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentOtp) {
      const secondsSinceCreated =
        (Date.now() - recentOtp.createdAt.getTime()) / 1000;
      if (secondsSinceCreated < 60) {
        const waitSeconds = Math.ceil(60 - secondsSinceCreated);
        throw new BadRequestException(
          `Please wait ${waitSeconds} second(s) before requesting a new OTP.`,
        );
      }
    }

    // ── Invalidate old OTPs ───────────────────────────────────────────────────
    await this.prisma.otp.updateMany({
      where: { phone: user.phone, verified: false },
      data: { verified: true },
    });

    // ── Generate + hash new OTP ──────────────
    const rawOtp = randomInt(100_000, 999_999).toString();
    const hashedOtp = await bcrypt.hash(rawOtp, roundsOfHashing);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1_000); // 5 minutes

    await this.prisma.otp.upsert({
      where: { phone: user.phone },
      update: {
        code: hashedOtp,
        verified: false,
        expiresAt,
        purpose,
        createdAt: new Date(),
      },
      create: {
        phone: user.phone,
        businessId: user.businessId,
        code: hashedOtp,
        purpose,
        expiresAt,
      },
    });

    this.logger.info({ userId: user.id, purpose }, 'OTP resent');

    // TODO: replace `otp` in response with actual SMS send in production
    return {
      success: true,
      message: 'OTP resent successfully.',
      data: {
        userId: user.id,
        otp: rawOtp, // remove in production
      },
    };
  }

  async getBusinessTypes() {
    const types = await this.prisma.businessType.findMany({
      select: {
        id: true,
        value: true,
        labelEn: true,
        labelBn: true,
        isActive: true,
      },
      where: {
        isActive: true, // optional: only active types
      },
    });

    return {
      success: true,
      data: types,
    };
  }
}
