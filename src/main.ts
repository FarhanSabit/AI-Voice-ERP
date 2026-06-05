import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { GlobalExceptionFilter } from './exceptions/prisma-exception.filter';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import compression from 'compression';
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // 1. Cookie parser first
  app.use(cookieParser());

  // 2. Compression
  app.use(compression());

  // 3. Helmet — disable CSP for Swagger UI to work
  app.use(
    helmet({
      contentSecurityPolicy: false, // required for Swagger UI for development
    }),
  );

  // 4. Logger
  app.useLogger(app.get(Logger));

  // 5. Global filters
  app.useGlobalFilters(new GlobalExceptionFilter());

  // 6. Global pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // 7. API prefix
  app.setGlobalPrefix('api');

  // 8. CORS
  app.enableCors({
    origin: ['http://localhost:3000', 'https://hellokhata.vercel.app'],
    credentials: true,
  });

  // 9. Swagger
  const config = new DocumentBuilder()
    .setTitle('Hello Khata API Documentation')
    .setDescription('The Hello Khata API documentation')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter your Bearer token',
        in: 'header',
      },
      'JWT-auth',
    )
    .build();

  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

  app.enableShutdownHooks();
  const port = process.env.PORT || 8000;
  await app.listen(port, '0.0.0.0');
}
void bootstrap();
