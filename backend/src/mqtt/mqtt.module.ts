import { Module, OnModuleInit } from '@nestjs/common';
import { MqttClientService } from './mqtt-client.service';
import { IngestionService } from './ingestion.service';
import { CommandDispatcherService } from './command-dispatcher.service';
import { CfgDesiredService } from './cfg-desired.service';
import { DeviceOfflineSchedulerService } from './device-offline-scheduler.service';
import { AlarmsModule } from '../alarms/alarms.module';

@Module({
  imports: [AlarmsModule],
  providers: [MqttClientService, IngestionService, CommandDispatcherService, CfgDesiredService, DeviceOfflineSchedulerService],
  exports: [MqttClientService, CommandDispatcherService, CfgDesiredService],
})
export class MqttModule implements OnModuleInit {
  constructor(
    private readonly ingestion: IngestionService,
    private readonly commandDispatcher: CommandDispatcherService,
  ) {}

  onModuleInit() {
    // Registered here (after MqttClientService's own onModuleInit runs,
    // since Nest initializes providers before wiring module-level hooks)
    // so handlers are in place before the client's `connect` event fires
    // and triggers the initial subscribe pass.
    this.ingestion.registerHandlers();
    this.commandDispatcher.registerHandlers();
  }
}
