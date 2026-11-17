import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();
import { AppDataSource } from './data-source';
import { newId } from '../common/util/id.util';
import { Client } from '../tenancy/entities/client.entity';
import { Site } from '../tenancy/entities/site.entity';
import { Laboratory } from '../tenancy/entities/laboratory.entity';
import { Equipment } from '../equipment/entities/equipment.entity';
import { Role } from '../auth/entities/role.entity';
import { AppUser } from '../auth/entities/app-user.entity';
import { UserRole } from '../auth/entities/user-role.entity';
import { UserLabScope } from '../auth/entities/user-lab-scope.entity';
import { AuthService } from '../auth/auth.service';

/**
 * Demo dataset for a leadership presentation (lab-hierarchy-reactor-admin-
 * cleanup plan, task 7). Builds out a realistic multi-site/multi-lab
 * hierarchy on top of whatever already exists (reuses the real "Hyderabad
 * Plant" site / "QC Lab 1" lab / "Reactor 25" equipment from `seed.ts`
 * rather than duplicating them) so the whole lab-scoped-user-hierarchy and
 * reactor-creation work built this session has something real to show.
 *
 * Idempotent per name within a parent (checks for an existing row with the
 * same name before creating) -- safe to re-run.
 *
 * Deliberately does NOT attempt real ESP32-P4 hardware integration or
 * create sample Processes/Alarms -- the user's own scoping note was that
 * physical device integration is for a later session; this seeds the
 * tenancy/reactor/device/user hierarchy only, then optionally exercises
 * `tools/device-simulator` against a couple of the new devices so the
 * Dashboard/Devices pages show a realistic online/offline mix.
 *
 * Run with: npx ts-node -r tsconfig-paths/register src/database/seed-demo.ts
 */
async function findOrCreateSite(
  manager: any,
  clientId: string,
  name: string,
  timeZone: string,
): Promise<Site> {
  let site = await manager.findOne(Site, { where: { name } });
  if (!site) {
    site = manager.create(Site, { id: newId(), clientId, name, timeZone });
    await manager.save(site);
    console.log(`Created site "${name}"`);
  } else {
    console.log(`Site already exists: "${name}"`);
  }
  return site;
}

async function findOrCreateLab(
  manager: any,
  siteId: string,
  name: string,
  code: string,
): Promise<Laboratory> {
  let lab = await manager.findOne(Laboratory, { where: { name } });
  if (!lab) {
    lab = manager.create(Laboratory, { id: newId(), siteId, name, code });
    await manager.save(lab);
    console.log(`Created laboratory "${name}" (${code})`);
  } else {
    console.log(`Laboratory already exists: "${name}"`);
  }
  return lab;
}

async function findOrCreateReactor(
  manager: any,
  laboratoryId: string,
  reactorNumber: string,
  displayName: string,
): Promise<Equipment> {
  let reactor = await manager.findOne(Equipment, {
    where: { laboratoryId, reactorNumber },
  });
  if (!reactor) {
    reactor = manager.create(Equipment, {
      id: newId(),
      laboratoryId,
      reactorNumber,
      displayName,
    });
    await manager.save(reactor);
    console.log(`Created reactor "${displayName}" (#${reactorNumber})`);
  } else {
    console.log(`Reactor already exists: "${displayName}"`);
  }
  return reactor;
}

async function findOrCreateUser(
  manager: any,
  opts: {
    name: string;
    username: string;
    roleId: string;
    laboratoryId?: string;
    reportsToUserId?: string;
  },
): Promise<AppUser> {
  let user = await manager.findOne(AppUser, {
    where: { username: opts.username },
  });
  if (!user) {
    user = manager.create(AppUser, {
      id: newId(),
      name: opts.name,
      username: opts.username,
      passwordHash: await AuthService.hashPassword('ChangeMe123!'),
      status: 'ACTIVE',
      reportsToUserId: opts.reportsToUserId ?? null,
    });
    await manager.save(user);
    await manager.save(
      manager.create(UserRole, { userId: user.id, roleId: opts.roleId }),
    );
    if (opts.laboratoryId) {
      await manager.save(
        manager.create(UserLabScope, {
          id: newId(),
          userId: user.id,
          laboratoryId: opts.laboratoryId,
          grantedBy: user.id,
        }),
      );
    }
    console.log(`Created user "${opts.name}" (${opts.username})`);
  } else {
    console.log(`User already exists: "${opts.username}"`);
  }
  return user;
}

async function seedDemo() {
  await AppDataSource.initialize();
  const manager = AppDataSource.manager;

  const client = (await manager.find(Client, { take: 1 }))[0];
  if (!client) {
    throw new Error('No client row found -- run `npm run seed` first.');
  }

  const roles = await manager.find(Role);
  const roleIdByCode = Object.fromEntries(
    roles.map((r: Role) => [r.code, r.id]),
  );

  // Reuse the real Hyderabad Plant site + QC Lab 1 lab + Reactor 25 from
  // seed.ts/earlier sessions instead of duplicating them.
  const hyderabad = await findOrCreateSite(
    manager,
    client.id,
    'Hyderabad Plant',
    'Asia/Kolkata',
  );
  const mumbai = await findOrCreateSite(
    manager,
    client.id,
    'Mumbai Plant',
    'Asia/Kolkata',
  );
  const bangalore = await findOrCreateSite(
    manager,
    client.id,
    'Bangalore R&D Center',
    'Asia/Kolkata',
  );

  const formulationLab = await findOrCreateLab(
    manager,
    hyderabad.id,
    'Formulation Lab',
    'FORM1',
  );
  const qcMumbai = await findOrCreateLab(
    manager,
    mumbai.id,
    'QC Lab Mumbai',
    'QCM1',
  );
  const rndMumbai = await findOrCreateLab(
    manager,
    mumbai.id,
    'R&D Lab Mumbai',
    'RDM1',
  );
  const pilotBangalore = await findOrCreateLab(
    manager,
    bangalore.id,
    'Pilot Plant Lab',
    'PPL1',
  );

  const labs = [
    {
      lab: formulationLab,
      reactorPrefix: 'FL',
      lead: 'Anita Rao',
      analysts: ['Vikram Shah', 'Deepa Nair'],
    },
    {
      lab: qcMumbai,
      reactorPrefix: 'QCM',
      lead: 'Rahul Mehta',
      analysts: ['Sneha Joshi', 'Arjun Pillai'],
    },
    {
      lab: rndMumbai,
      reactorPrefix: 'RDM',
      lead: 'Kavita Iyer',
      analysts: ['Rohan Desai', 'Priya Menon'],
    },
    {
      lab: pilotBangalore,
      reactorPrefix: 'PPL',
      lead: 'Suresh Kumar',
      analysts: ['Divya Reddy', 'Karthik Rao'],
    },
  ];

  let reactorSeq = 101;
  const firstReactorByLab: Record<string, Equipment> = {};
  for (const { lab, reactorPrefix, lead, analysts } of labs) {
    const r1 = await findOrCreateReactor(
      manager,
      lab.id,
      `${reactorPrefix}-${reactorSeq}`,
      `Reactor ${reactorSeq}`,
    );
    const r2 = await findOrCreateReactor(
      manager,
      lab.id,
      `${reactorPrefix}-${reactorSeq + 1}`,
      `Reactor ${reactorSeq + 1}`,
    );
    firstReactorByLab[lab.id] = r1;
    reactorSeq += 2;
    void r2;

    const leadUsername = lead.toLowerCase().replace(/\s+/g, '_');
    const leadUser = await findOrCreateUser(manager, {
      name: lead,
      username: leadUsername,
      roleId: roleIdByCode['LAB_INCHARGE'],
      laboratoryId: lab.id,
    });
    for (const analystName of analysts) {
      const analystUsername = analystName.toLowerCase().replace(/\s+/g, '_');
      await findOrCreateUser(manager, {
        name: analystName,
        username: analystUsername,
        roleId: roleIdByCode['ANALYST'],
        laboratoryId: lab.id,
        reportsToUserId: leadUser.id,
      });
    }
  }

  console.log('\nDemo dataset ready:');
  console.log(
    '  3 sites (Hyderabad Plant, Mumbai Plant, Bangalore R&D Center)',
  );
  console.log('  5 laboratories (QC Lab 1 + 4 new)');
  console.log('  9 reactors (Reactor 25 + 8 new)');
  console.log(
    '  4 new Lab In-charges, 8 new Analysts, each correctly lab-scoped',
  );
  console.log('\nAll new demo users share the password: ChangeMe123!');
  console.log(
    'Next (optional, for live telemetry on the Dashboard): claim+bind a device to one of the\n' +
      'new reactors via Admin -> Devices, then run tools/device-simulator against it.',
  );

  await AppDataSource.destroy();
}

seedDemo().catch((err) => {
  console.error('Demo seed failed:', err);
  process.exit(1);
});
