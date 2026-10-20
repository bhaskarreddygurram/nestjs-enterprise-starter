import { Prisma, PrismaClient } from '@prisma/client';
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
  ['project', 'read'],
  ['project', 'create'],
  ['project', 'update'],
  ['project', 'delete'],
  ['project', 'restore'],
];

// Sample projects are demo data, so they are skipped in production unless
// explicitly requested with SEED_SAMPLE_DATA=true.
const SEED_SAMPLE_DATA =
  process.env.NODE_ENV !== 'production' ||
  process.env.SEED_SAMPLE_DATA === 'true';

type SampleProject = Omit<
  Prisma.ProjectUncheckedCreateInput,
  'ownerId' | 'createdById'
>;

// Varied on purpose: every status, a range of priorities and dates, with and
// without a budget, and one soft-deleted row to exercise the restore flow.
const SAMPLE_PROJECTS: SampleProject[] = [
  {
    code: 'CRM-2026',
    name: 'CRM Migration',
    description:
      'Move customer records from the legacy CRM to the new platform.',
    status: 'ACTIVE',
    priority: 'HIGH',
    startDate: new Date('2026-09-01'),
    dueDate: new Date('2026-12-15'),
    budget: '48000.00',
    currency: 'EUR',
  },
  {
    code: 'WEB-REDESIGN',
    name: 'Website Redesign',
    description: 'New marketing site with an updated brand and faster pages.',
    status: 'PLANNING',
    priority: 'MEDIUM',
    startDate: new Date('2026-11-01'),
    dueDate: new Date('2027-02-28'),
  },
  {
    code: 'PAY-GATEWAY',
    name: 'Payment Gateway Integration',
    description:
      'Integrate SEPA and card payments behind a single provider API.',
    status: 'ON_HOLD',
    priority: 'CRITICAL',
    startDate: new Date('2026-08-10'),
    budget: '120000.00',
    currency: 'EUR',
  },
  {
    code: 'AUDIT-Q2',
    name: 'Q2 Security Audit',
    description: 'External penetration test and remediation of findings.',
    status: 'COMPLETED',
    priority: 'HIGH',
    startDate: new Date('2026-04-01'),
    dueDate: new Date('2026-06-30'),
    completedAt: new Date('2026-06-24T15:30:00Z'),
    budget: '15500.50',
    currency: 'USD',
  },
  {
    code: 'MOBILE-APP',
    name: 'Mobile App Prototype',
    status: 'CANCELLED',
    priority: 'LOW',
  },
  {
    code: 'LEGACY-CLEANUP',
    name: 'Legacy Report Cleanup',
    description: 'Retire unused reports. Soft-deleted sample row.',
    status: 'PLANNING',
    priority: 'LOW',
    deletedAt: new Date('2026-09-20T09:00:00Z'),
  },
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

  // --- sample projects ---
  if (SEED_SAMPLE_DATA) {
    for (const project of SAMPLE_PROJECTS) {
      await prisma.project.upsert({
        where: { code: project.code },
        // existing rows are left alone, so re-seeding never undoes local edits
        update: {},
        create: {
          ...project,
          ownerId: admin.id,
          createdById: admin.id,
          deletedById: project.deletedAt ? admin.id : null,
        },
      });
    }
  }

  console.log(`Seed complete — admin user: ${admin.email} (${admin.id})`);
  console.log(`Dev login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(
    `Roles: admin (all ${PERMISSIONS.length} perms), user (user:read). Admin role assigned to admin user.`,
  );
  console.log(
    SEED_SAMPLE_DATA
      ? `Sample projects: ${SAMPLE_PROJECTS.length} ensured.`
      : 'Sample projects: skipped (production).',
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
