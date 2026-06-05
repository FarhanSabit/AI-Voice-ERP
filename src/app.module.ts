import { SettingsModule } from './settings/settings.module';
import { PartiesModule } from './parties/parties.module';
import { QuotationsModule } from './quotations/quotations.module';
import { SalesModule } from './sales/sales.module';
import { ItemsModule } from './items/items.module';
import { BatchesModule } from './batches/batches.module';
import { PurchasesModule } from './purchases/purchases.module';
import { PaymentsModule } from './payments/payments.module';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { PrismaModule } from './prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import * as Joi from 'joi';
import { LoggerModule } from 'nestjs-pino/LoggerModule';
import { MailModule } from './mail/mail.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { ExpensesModule } from './expenses/expenses.module';
@Module({
  imports: [
    SettingsModule,
    PartiesModule,
    QuotationsModule,
    ExpensesModule,
    SalesModule,
    ItemsModule,
    BatchesModule,
    PurchasesModule,
    PaymentsModule,
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 10,
      },
    ]),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        redact: {
          paths: [
            'req.headers.authorization',
            'req.body.password',
            'res.headers["set-cookie"]',
          ],
          remove: true,
        },
        autoLogging: true,
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  translateTime: 'SYS:standard',
                },
              },
      },
    }),
    PrismaModule,
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        JWT_SECRET: Joi.string().required(),
        DATABASE_URL: Joi.string().required(),
        JWT_EXPIRES_IN: Joi.string().default('1d'),
      }),
    }),
    AuthModule,
    MailModule,
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService],
})
export class AppModule {}
