import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Db } from '../common/db/db.service';
import { ProcessesService } from './processes.service';
import { Process } from './entities/process.entity';

/** Part 5.2 T8: system-driven transition at planned end, checked periodically (no device/user action needed). */
@Injectable()
export class ProcessesSchedulerService {
  private readonly logger = new Logger(ProcessesSchedulerService.name);

  constructor(
    private readonly db: Db,
    private readonly processes: ProcessesService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkPlannedEnds(): Promise<void> {
    await this.db.runAsAdmin(async (manager) => {
      const due = await manager
        .getRepository(Process)
        .createQueryBuilder('p')
        .where('p.status IN (:...statuses)', { statuses: ['RUNNING', 'PAUSED'] })
        .andWhere('p.planned_end_utc <= :now', { now: new Date() })
        .getMany();

      for (const process of due) {
        try {
          await this.processes.markAwaitingCompletion(process.id);
        } catch (err: any) {
          this.logger.error(`Failed to mark process ${process.id} AWAITING_COMPLETION: ${err.message}`);
        }
      }
    });
  }
}
