import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
dotenv.config();

// Migrations need DDL/GRANT privileges (CREATE EXTENSION, CREATE ROLE, GRANT),
// so they run as the Postgres superuser, not the least-privilege runtime role
// (rmp_app) that the application connects as (Part 9.11).
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username:
    process.env.MIGRATION_DB_USERNAME ?? process.env.DB_SUPERUSER ?? 'postgres',
  password:
    process.env.MIGRATION_DB_PASSWORD ??
    process.env.DB_SUPERUSER_PASSWORD ??
    '',
  database: process.env.DB_DATABASE ?? 'rmp',
  ssl: (process.env.DB_SSL ?? 'false') === 'true',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
});
