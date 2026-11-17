import { forwardRef, Module } from '@nestjs/common';
import { ProcessesController } from './processes.controller';
import { ProcessesService } from './processes.service';
import { ProcessesSchedulerService } from './processes-scheduler.service';
import { MqttModule } from '../mqtt/mqtt.module';

@Module({
  imports: [forwardRef(() => MqttModule)],
  controllers: [ProcessesController],
  providers: [ProcessesService, ProcessesSchedulerService],
  exports: [ProcessesService],
})
export class ProcessesModule {}
