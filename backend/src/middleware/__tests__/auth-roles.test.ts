import { describe, expect, it, vi } from 'vitest';
import { authorize, cycleRosterOrAdmin, managerOrAdmin, operationsManagerOrAdmin, salesOrAbove } from '../auth.js';

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

describe('role authorization', () => {
  it('allows operations_control into operations-control routes', () => {
    const handler = authorize('admin', 'manager', 'operations', 'operations_control');

    const next = run(handler, 'operations_control');

    expect(next).toHaveBeenCalledWith();
  });

  it('allows operations_control into sales-level workflows', () => {
    const next = run(salesOrAbove, 'operations_control');

    expect(next).toHaveBeenCalledWith();
  });

  it('does not grant operations_control manager/admin permissions', () => {
    const next = run(managerOrAdmin, 'operations_control');

    const error = next.mock.calls[0][0];
    expect(error).toMatchObject({ statusCode: 403, message: 'Insufficient permissions' });
  });

  it('allows operations_control into cycle roster workflows', () => {
    const next = run(cycleRosterOrAdmin, 'operations_control');

    expect(next).toHaveBeenCalledWith();
  });

  it('allows operations_manager into operational management workflows', () => {
    const next = run(operationsManagerOrAdmin, 'operations_manager');

    expect(next).toHaveBeenCalledWith();
  });

  it('does not grant operations_manager generic manager/admin permissions', () => {
    const next = run(managerOrAdmin, 'operations_manager');

    const error = next.mock.calls[0][0];
    expect(error).toMatchObject({ statusCode: 403, message: 'Insufficient permissions' });
  });

  it('does not grant operations_manager sales/customer-success permissions', () => {
    const next = run(salesOrAbove, 'operations_manager');

    const error = next.mock.calls[0][0];
    expect(error).toMatchObject({ statusCode: 403, message: 'Insufficient permissions' });
  });
});
