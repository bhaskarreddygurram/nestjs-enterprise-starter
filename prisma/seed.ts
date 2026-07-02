import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

/**
 * Idempotent database seed.
 *
 * Run with: `npm run db:seed` (also runs automatically on `prisma migrate reset`).
 *
 * Dev-only credentials — the admin password is meant for local development
 * and must be changed in any real deployment.
 */
const prisma = new PrismaClient();

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'Admin123!ChangeMe';

// resource:action permission catalogue
const PERMISSIONS: Array<[resource: string, action: string]> = [
  ['user', 'read'],
  ['user', 'create'],
  ['user', 'update'],
  ['user', 'delete'],
  ['role', 'read'],
  ['role', 'assign'],
  ['audit', 'read'],
  ['file', 'read'],
  ['file', 'create'],
  ['file', 'delete'],
  ['ai', 'read'],
];

async function main(): Promise<void> {
  // --- admin user ---
  const passwordHash = await argon2.hash(ADMIN_PASSWORD);
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    // Normalise the admin to a known-good security state on every seed: no 2FA,
    // not locked, no stray failed-login counter.
    update: {
      passwordHash,
      isActive: true,
      twoFactorEnabled: false,
      twoFactorSecret: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
    create: {
      email: ADMIN_EMAIL,
      passwordHash,
      firstName: 'Admin',
      lastName: 'User',
      isActive: true,
    },
  });

  // --- permissions ---
  const permissionIds: Record<string, string> = {};
  for (const [resource, action] of PERMISSIONS) {
    const perm = await prisma.permission.upsert({
      where: { resource_action: { resource, action } },
      update: {},
      create: { resource, action },
    });
    permissionIds[`${resource}:${action}`] = perm.id;
  }

  // --- roles ---
  const adminRole = await prisma.role.upsert({
    where: { name: 'admin' },
    update: {},
    create: { name: 'admin', description: 'Full access to everything' },
  });
  const userRole = await prisma.role.upsert({
    where: { name: 'user' },
    update: {},
    create: { name: 'user', description: 'Standard user (read-only on users)' },
  });

  // --- grant permissions to roles ---
  const grant = async (roleId: string, permissionId: string): Promise<void> => {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId } },
      update: {},
      create: { roleId, permissionId },
    });
  };
  // admin gets everything
  for (const permissionId of Object.values(permissionIds)) {
    await grant(adminRole.id, permissionId);
  }
  // standard user can only read users
  await grant(userRole.id, permissionIds['user:read']);

  // --- assign admin role to the admin user ---
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    update: {},
    create: { userId: admin.id, roleId: adminRole.id },
  });

  console.log(`Seed complete — admin user: ${admin.email} (${admin.id})`);
  console.log(`Dev login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(
    `Roles: admin (all ${PERMISSIONS.length} perms), user (user:read). Admin role assigned to admin user.`,
  );
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
