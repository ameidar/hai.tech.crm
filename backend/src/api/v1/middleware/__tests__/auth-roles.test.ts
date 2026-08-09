import { describe, expect, it, vi } from 'vitest';
import { authorize, managerOrAdmin } from '../auth.js';

function reqWithRole(role: Express.Request['user']['role']) {
  return {
    user: {
      userId: 'user-1',
      email: 'user@example.com',
      name: 'Test User',
      role,
    },
  } as Express.Request;
}

function run(handler: ReturnType<typeof authorize>, role: Express.Request['user']['role']) {
  const next = vi.fn();
  handler(reqWithRole(role), {} as any, next);
  return next;
}

describe('api v1 role authorization', () => {
  it('allows operations_manager into v1 manager workflows', () => {
    const next = run(managerOrAdmin, 'operations_manager');

    expect(next).toHaveBeenCalledWith();
  });

  it('does not grant operations staff v1 manager permissions', () => {
    const next = run(managerOrAdmin, 'operations');

    const error = next.mock.calls[0][0];
    expect(error).toMatchObject({ statusCode: 403, message: 'Insufficient permissions' });
  });
});
