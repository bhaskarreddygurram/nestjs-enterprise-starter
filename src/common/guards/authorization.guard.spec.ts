import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUser } from '../../modules/auth/authenticated-user.interface';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthorizationGuard } from './authorization.guard';

interface RouteMetadata {
  isPublic?: boolean;
  roles?: string[];
  permissions?: string[];
}

const principal = (
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser => ({
  id: 'b3f9c2e4-1a2b-4c5d-8e9f-0a1b2c3d4e5f',
  email: 'jane.doe@example.com',
  isActive: true,
  roles: [],
  permissions: [],
  ...overrides,
});

describe('AuthorizationGuard', () => {
  let guard: AuthorizationGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  /** An execution context for a route with the given metadata and user. */
  const contextFor = (
    metadata: RouteMetadata,
    user?: AuthenticatedUser,
  ): ExecutionContext => {
    const byKey: Record<string, unknown> = {
      [IS_PUBLIC_KEY]: metadata.isPublic,
      [ROLES_KEY]: metadata.roles,
      [PERMISSIONS_KEY]: metadata.permissions,
    };
    reflector.getAllAndOverride.mockImplementation((key: string) => byKey[key]);

    return {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new AuthorizationGuard(reflector as unknown as Reflector);
  });

  it('lets @Public() override any role or permission requirement', () => {
    expect(
      guard.canActivate(
        contextFor({ isPublic: true, roles: ['admin'], permissions: ['x:y'] }),
      ),
    ).toBe(true);
  });

  it('allows any authenticated user when the route declares nothing', () => {
    expect(guard.canActivate(contextFor({}, principal()))).toBe(true);
  });

  it('treats empty role and permission lists as no constraint', () => {
    expect(
      guard.canActivate(
        contextFor({ roles: [], permissions: [] }, principal()),
      ),
    ).toBe(true);
  });

  it('rejects a protected route when no user is attached', () => {
    expect(() =>
      guard.canActivate(contextFor({ permissions: ['user:read'] })),
    ).toThrow(new ForbiddenException('Not authenticated'));
  });

  describe('@Permissions — user needs ALL of them', () => {
    it('allows a user holding every required permission', () => {
      const user = principal({
        permissions: ['user:read', 'user:update', 'role:read'],
      });

      expect(
        guard.canActivate(
          contextFor({ permissions: ['user:read', 'user:update'] }, user),
        ),
      ).toBe(true);
    });

    it('rejects a user missing one of them, naming what is required', () => {
      const user = principal({ permissions: ['user:read'] });

      expect(() =>
        guard.canActivate(
          contextFor({ permissions: ['user:read', 'user:update'] }, user),
        ),
      ).toThrow(
        new ForbiddenException('Requires permissions: user:read, user:update'),
      );
    });

    it('does not let a role name stand in for a permission', () => {
      const user = principal({ roles: ['admin'], permissions: [] });

      expect(() =>
        guard.canActivate(contextFor({ permissions: ['user:read'] }, user)),
      ).toThrow(ForbiddenException);
    });
  });

  describe('@Roles — user needs ANY of them', () => {
    it('allows a user with one of the roles', () => {
      const user = principal({ roles: ['editor'] });

      expect(
        guard.canActivate(contextFor({ roles: ['admin', 'editor'] }, user)),
      ).toBe(true);
    });

    it('rejects a user with none of the roles', () => {
      const user = principal({ roles: ['user'] });

      expect(() =>
        guard.canActivate(contextFor({ roles: ['admin', 'editor'] }, user)),
      ).toThrow(new ForbiddenException('Requires one of roles: admin, editor'));
    });
  });

  describe('@Roles and @Permissions together — both must pass', () => {
    const metadata = { roles: ['admin'], permissions: ['audit:read'] };

    it('allows a user satisfying both', () => {
      const user = principal({ roles: ['admin'], permissions: ['audit:read'] });

      expect(guard.canActivate(contextFor(metadata, user))).toBe(true);
    });

    it('rejects the right role without the permission', () => {
      const user = principal({ roles: ['admin'], permissions: [] });

      expect(() => guard.canActivate(contextFor(metadata, user))).toThrow(
        /Requires permissions/,
      );
    });

    it('rejects the permission without the right role', () => {
      const user = principal({ roles: ['user'], permissions: ['audit:read'] });

      expect(() => guard.canActivate(contextFor(metadata, user))).toThrow(
        /Requires one of roles/,
      );
    });
  });

  it('reads metadata from both the handler and the controller', () => {
    guard.canActivate(contextFor({}, principal()));

    for (const key of [IS_PUBLIC_KEY, ROLES_KEY, PERMISSIONS_KEY]) {
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(key, [
        expect.any(Function),
        expect.any(Function),
      ]);
    }
  });
});
