import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import configuration from './config/configuration';
import { DbModule } from './common/db/db.module';
import { RlsInterceptor } from './common/db/rls.interceptor';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { TenancyModule } from './tenancy/tenancy.module';
import { EquipmentModule } from './equipment/equipment.module';
import { DevicesModule } from './devices/devices.module';
import { HealthModule } from './health/health.module';
import { MqttModule } from './mqtt/mqtt.module';
import { MeasurementsModule } from './measurements/measurements.module';
import { ProcessesModule } from './processes/processes.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AlarmsModule } from './alarms/alarms.module';
import { CalibrationModule } from './calibration/calibration.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { ExportsModule } from './exports/exports.module';
import { LicenceModule } from './licence/licence.module';
import { BackupModule } from './backup/backup.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('db.host'),
        port: config.get<number>('db.port'),
        username: config.get<string>('db.username'),
        password: config.get<string>('db.password'),
        database: config.get<string>('db.database'),
        ssl: config.get<boolean>('db.ssl'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: false,
        logging: config.get<string>('nodeEnv') === 'development',
        extra: {
          max: 50, // Connection pool size to support 1000+ simultaneous web users & 500 devices
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        },
      }),
    }),
    DbModule,
    AuditModule,
    AuthModule,
    TenancyModule,
    EquipmentModule,
    DevicesModule,
    HealthModule,
    MqttModule,
    MeasurementsModule,
    ProcessesModule,
    NotificationsModule,
    AlarmsModule,
    CalibrationModule,
    MaintenanceModule,
    ExportsModule,
    LicenceModule,
    BackupModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        stopAtFirstError: false,
      }),
    },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: RlsInterceptor },
  ],
})
export class AppModule {}
