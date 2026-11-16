import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();
import { AppDataSource } from './data-source';
import { newId } from '../common/util/id.util';
import { Client } from '../tenancy/entities/client.entity';
import { Role } from '../auth/entities/role.entity';
import { AppUser } from '../auth/entities/app-user.entity';
import { UserRole } from '../auth/entities/user-role.entity';
import { AuthService } from '../auth/auth.service';

/**
 * First-run wizard stand-in (Part 9.7): seeds the single client row, the
 * fixed role set (Part 4, plus BOROSIL_ADMIN), and one Borosil Admin
 * bootstrap user -- NOT a client Admin. The Borosil Admin account is the one
 * fixed role/account seeded identically into every deployment regardless of
 * client size; it exclusively controls licence activation/deactivation/
 * change and can reset any user's password for support, with no visibility
 * into the client's operational data otherwise. Run with: npm run seed
 *
 * Deployment flow: Borosil runs this once per new install, then logs in as
 * the seeded Borosil Admin account and uses Admin -> Users -> "Create user"
 * to create the client's own Admin account (see docs/licence-management-guide.md).
 */
async function seed() {
  await AppDataSource.initialize();
  const manager = AppDataSource.manager;

  const existingClient = await manager.find(Client, { take: 1 });
  let client = existingClient[0];
  if (!client) {
    client = manager.create(Client, {
      id: newId(),
      name: process.env.INSTALL_ORG_NAME ?? 'Default Organisation',
      edition: (process.env.INSTALL_EDITION as Client['edition']) ?? 'solo',
      policyPack: (process.env.INSTALL_POLICY_PACK as Client['policyPack']) ?? 'flexible',
      terminologyJson: { reactor: 'Reactor', laboratory: 'Laboratory', site: 'Site' },
      status: 'ACTIVE',
    });
    await manager.save(client);
    console.log(`Created client "${client.name}" (${client.edition}/${client.policyPack})`);
  } else {
    console.log(`Client already exists: ${client.name}`);
  }

  const roleDefs: Array<{ code: Role['code']; name: string }> = [
    { code: 'ADMIN', name: 'Admin' },
    { code: 'BOROSIL_ADMIN', name: 'Borosil Admin' },
    { code: 'SUPPORT', name: 'Support' },
    { code: 'LAB_INCHARGE', name: 'Lab In-charge' },
    { code: 'ANALYST', name: 'Analyst' },
    { code: 'AUDITOR', name: 'Auditor' },
  ];
  const roleIdByCode: Record<string, string> = {};
  for (const def of roleDefs) {
    let role = await manager.findOne(Role, { where: { code: def.code } });
    if (!role) {
      role = manager.create(Role, { id: newId(), code: def.code, name: def.name });
      await manager.save(role);
      console.log(`Created role ${def.code}`);
    }
    roleIdByCode[def.code] = role.id;
  }

  const borosilUsername = process.env.SEED_BOROSIL_ADMIN_USERNAME ?? 'borosil_admin';
  let borosilAdmin = await manager.findOne(AppUser, { where: { username: borosilUsername } });
  if (!borosilAdmin) {
    const password = process.env.SEED_BOROSIL_ADMIN_PASSWORD ?? 'ChangeMe123!';
    borosilAdmin = manager.create(AppUser, {
      id: newId(),
      name: 'Borosil Admin',
      username: borosilUsername,
      passwordHash: await AuthService.hashPassword(password),
      status: 'ACTIVE',
    });
    await manager.save(borosilAdmin);
    await manager.save(UserRole, { userId: borosilAdmin.id, roleId: roleIdByCode['BOROSIL_ADMIN'] });
    console.log(
      `Created Borosil Admin user "${borosilUsername}" with password "${password}" -- CHANGE THIS IMMEDIATELY.`,
    );
    console.log(
      'No client Admin user exists yet -- log in as the Borosil Admin above and use Admin -> Users -> ' +
        '"Create user" to create the client\'s own Admin account (see docs/licence-management-guide.md).',
    );
  } else {
    console.log(`Borosil Admin user "${borosilUsername}" already exists.`);
  }

  await AppDataSource.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
