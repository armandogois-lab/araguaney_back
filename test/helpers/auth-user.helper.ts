import type { AuthUser } from '../../src/modules/auth/types';

export function mockAuthUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'test@cashea.app',
    full_name: 'Test Operator',
    role: 'operator',
    is_active: true,
    ...overrides,
  };
}
