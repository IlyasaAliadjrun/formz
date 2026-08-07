import type { AuthenticatedUser } from '@formz/shared';
import { CaslAbilityFactory } from './casl-ability.factory';

function buildUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'user-1',
    email: 'user@example.com',
    name: 'User',
    isActive: true,
    roles: [],
    permissions: [],
    ...overrides,
  };
}

describe('CaslAbilityFactory', () => {
  const factory = new CaslAbilityFactory();

  it('memberi akses penuh untuk Super Admin', () => {
    const ability = factory.createForUser(
      buildUser({ roles: [{ id: 'r1', name: 'Super Admin' }], permissions: [] }),
    );

    expect(factory.hasPermission(ability, 'user.manage')).toBe(true);
    expect(factory.hasPermission(ability, 'form.create')).toBe(true);
    expect(factory.hasPermission(ability, 'report.view')).toBe(true);
  });

  it('hanya memberi permission yang memang dimiliki', () => {
    const ability = factory.createForUser(
      buildUser({
        roles: [{ id: 'r2', name: 'Viewer' }],
        permissions: ['submission.view', 'report.view'],
      }),
    );

    expect(factory.hasPermission(ability, 'submission.view')).toBe(true);
    expect(factory.hasPermission(ability, 'report.view')).toBe(true);
    expect(factory.hasPermission(ability, 'user.manage')).toBe(false);
    expect(factory.hasPermission(ability, 'form.create')).toBe(false);
  });

  it('menerjemahkan kunci permission ke pasangan action/subject CASL', () => {
    const ability = factory.createForUser(buildUser({ permissions: ['form.create'] }));

    expect(ability.can('create', 'Form')).toBe(true);
    expect(ability.can('delete', 'Form')).toBe(false);
  });

  it('tidak memberi ability apa pun untuk user nonaktif', () => {
    const ability = factory.createForUser(
      buildUser({
        isActive: false,
        roles: [{ id: 'r1', name: 'Super Admin' }],
        permissions: ['user.manage'],
      }),
    );

    expect(factory.hasPermission(ability, 'user.manage')).toBe(false);
  });

  it('mengabaikan kunci permission yang tidak dikenal, bukan mengizinkannya', () => {
    const ability = factory.createForUser(buildUser({ permissions: ['warisan.lama'] }));

    expect(factory.hasPermission(ability, 'warisan.lama')).toBe(false);
    expect(factory.hasPermission(ability, 'user.manage')).toBe(false);
  });
});
