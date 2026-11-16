import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MqttModule } from '../mqtt/mqtt.module';
import { BackupModule } from '../backup/backup.module';
import { LicenceModule } from '../licence/licence.module';

@Module({
  imports: [MqttModule, BackupModule, LicenceModule],
  controllers: [HealthController],
})
export class HealthModule {}
