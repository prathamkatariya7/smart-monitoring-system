import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  app.use(cookieParser());
  app.use(json({ limit: process.env.REQUEST_BODY_LIMIT ?? '1mb' }));
  app.use(
    urlencoded({
      extended: true,
      limit: process.env.REQUEST_BODY_LIMIT ?? '1mb',
    }),
  );
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : process.env.NODE_ENV === 'production'
      ? []
      : true;
  app.enableCors({ origin: corsOrigin, credentials: true });

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Reactor Monitoring Platform backend listening on :${port}`);
}

bootstrap();
