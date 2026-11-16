import { Module } from '@nestjs/common';
import { CalibrationController } from './calibration.controller';
import { CalibrationService } from './calibration.service';
import { MqttModule } from '../mqtt/mqtt.module';

@Module({
  imports: [MqttModule],
  controllers: [CalibrationController],
  providers: [CalibrationService],
  exports: [CalibrationService],
})
export class CalibrationModule {}
