import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { MqttModule } from '../mqtt/mqtt.module';
import { LicenceModule } from '../licence/licence.module';

@Module({
  imports: [MqttModule, LicenceModule],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
