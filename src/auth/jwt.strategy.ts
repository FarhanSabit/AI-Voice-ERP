import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/prisma/prisma.service';
import { PinoLogger, InjectPinoLogger } from 'nestjs-pino';
import type { Request } from 'express';

interface JwtPayload {
  sub: string; // Standard JWT subject (User ID)
  id: string; // Added for convenience
  branchId: string;
  businessTypeId: string;
  phone: string;
  username?: string;
  isPhoneVerified: boolean;
  role: string;
  businessId: string;
  iat?: number; // Issued at (added automatically by JWT)
  exp?: number;
}

interface RequestWithCookies extends Request {
  cookies: {
    Authentication?: unknown;
  };
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    @InjectPinoLogger(JwtStrategy.name)
    private readonly logger: PinoLogger,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        // 1. Try cookie first
        (req: Request): string | null => {
          const request = req as RequestWithCookies;
          const token = request.cookies?.Authentication;
          return typeof token === 'string' ? token : null;
        },
        // 2. Fallback to Bearer header
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    // Guard: sub must exist
    if (!payload?.sub) {
      throw new UnauthorizedException('Invalid token payload.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub }, //sub is the userId
      select: {
        id: true,
        phone: true,
        name: true,
        role: true,
        businessId: true,
        branchId: true,
        businessTypeId: true,
        isPhoneVerified: true,
        isActive: true,
        branch: {
          select: {
            isMain: true,
          },
        },
      },
    });

    if (!user) {
      this.logger.warn({ sub: payload.sub }, 'User not found');
      throw new UnauthorizedException('User not found.');
    }

    if (!user.isActive) {
      this.logger.warn({ sub: payload.sub }, 'User account is deactivated');
      throw new UnauthorizedException('User account is deactivated.');
    }

    // This object becomes req.user in all protected routes
    return {
      id: user.id,
      phone: user.phone,
      branchId: user.branchId,
      businessTypeId: user.businessTypeId,
      name: user.name,
      role: user.role,
      businessId: user.businessId,
      isPhoneVerified: user.isPhoneVerified,
      isMainBranch: user.branch?.isMain ?? false,
    };
  }
}
