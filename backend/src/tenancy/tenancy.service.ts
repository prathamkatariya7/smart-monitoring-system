import { Injectable, NotFoundException } from '@nestjs/common';
import { currentManager } from '../common/db/request-context';
import { newId } from '../common/util/id.util';
import { Client } from './entities/client.entity';
import { Site } from './entities/site.entity';
import { Laboratory } from './entities/laboratory.entity';
import { FeatureSwitch } from './entities/feature-switch.entity';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';

@Injectable()
export class TenancyService {
  constructor(private readonly audit: AuditService) {}

  async getClient(): Promise<Client> {
    const manager = currentManager();
    const [client] = await manager.find(Client, { take: 1 });
    if (!client)
      throw new NotFoundException(
        'Installation has not been initialised (no client row)',
      );
    return client;
  }

  async updateTerminology(
    actor: AuthenticatedUser,
    terminology: Record<string, string>,
  ) {
    const manager = currentManager();
    const client = await this.getClient();
    const previous = client.terminologyJson;
    await manager.update(
      Client,
      { id: client.id },
      { terminologyJson: terminology },
    );
    await this.audit.record({
      userId: actor.userId,
      action: 'TERMINOLOGY_UPDATED',
      entityType: 'client',
      entityId: client.id,
      previousValue: previous,
      newValue: terminology,
    });
    return this.getClient();
  }

  async updatePolicyPack(
    actor: AuthenticatedUser,
    policyPack: string,
    reason: string,
  ) {
    const manager = currentManager();
    const client = await this.getClient();
    await manager.update(
      Client,
      { id: client.id },
      { policyPack: policyPack as Client['policyPack'] },
    );
    await this.audit.record({
      userId: actor.userId,
      action: 'POLICY_PACK_CHANGED',
      entityType: 'client',
      entityId: client.id,
      previousValue: { policyPack: client.policyPack },
      newValue: { policyPack },
      reason,
    });
    return this.getClient();
  }

  async listFeatureSwitches(): Promise<FeatureSwitch[]> {
    return currentManager().find(FeatureSwitch);
  }

  async setFeatureSwitch(
    actor: AuthenticatedUser,
    key: string,
    value: boolean,
    reason: string,
  ) {
    const manager = currentManager();
    const existing = await manager.findOne(FeatureSwitch, { where: { key } });
    await manager.save(FeatureSwitch, {
      key,
      value,
      changedBy: actor.userId,
      changedAt: new Date(),
      reason,
    });
    await this.audit.record({
      userId: actor.userId,
      action: 'FEATURE_SWITCH_CHANGED',
      entityType: 'feature_switch',
      entityId: key,
      previousValue: existing ? { value: existing.value } : null,
      newValue: { value },
      reason,
    });
    return manager.findOne(FeatureSwitch, { where: { key } });
  }

  async listSites(): Promise<Site[]> {
    return currentManager().find(Site);
  }

  async createSite(
    actor: AuthenticatedUser,
    name: string,
    timeZone?: string,
  ): Promise<Site> {
    const manager = currentManager();
    const client = await this.getClient();
    const site = manager.create(Site, {
      id: newId(),
      clientId: client.id,
      name,
      timeZone: timeZone ?? 'UTC',
    });
    await manager.save(site);
    await this.audit.record({
      userId: actor.userId,
      action: 'SITE_CREATED',
      entityType: 'site',
      entityId: site.id,
      newValue: { name, timeZone: site.timeZone },
    });
    return site;
  }

  async listLaboratories(): Promise<Laboratory[]> {
    return currentManager().find(Laboratory);
  }

  async createLaboratory(
    actor: AuthenticatedUser,
    siteId: string,
    name: string,
    code?: string,
  ): Promise<Laboratory> {
    const manager = currentManager();
    const site = await manager.findOne(Site, { where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');
    const lab = manager.create(Laboratory, {
      id: newId(),
      siteId,
      name,
      code: code ?? null,
    });
    await manager.save(lab);
    await this.audit.record({
      userId: actor.userId,
      action: 'LABORATORY_CREATED',
      entityType: 'laboratory',
      entityId: lab.id,
      newValue: { siteId, name, code },
    });
    return lab;
  }
}
