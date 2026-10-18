import { describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { config } from '../../config.js';
import { asEffectiveUser } from '../auth.js';
import { viewerReadOnly } from '../viewerReadOnly.js';

function tokenFor(role: string) {
  return jwt.sign({ userId: 'u1', email: 'u@example.com', name: 'U', role }, config.jwt.secret);
}

function run(method: string, path: string, role?: string) {
  const req = {
    method,
    path,
    headers: role ? { authorization: `Bearer ${tokenFor(role)}` } : {},
  } as any;
  const json = vi.fn();
  const res = { status: vi.fn(() => ({ json })) } as any;
  const next = vi.fn();
  viewerReadOnly(req, res, next);
  return { next, res, json };
}

describe('viewer read-only role', () => {
  it('lets a viewer read', () => {
    expect(run('GET', '/api/cycles', 'viewer').next).toHaveBeenCalled();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('blocks viewer %s requests', (method) => {
    const { next, res } = run(method, '/api/meetings/abc', 'viewer');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows viewer token refresh and logout', () => {
    expect(run('POST', '/api/auth/refresh', 'viewer').next).toHaveBeenCalled();
    expect(run('POST', '/api/auth/logout', 'viewer').next).toHaveBeenCalled();
  });

  it('does not affect admins or anonymous requests', () => {
    expect(run('POST', '/api/meetings', 'admin').next).toHaveBeenCalled();
    expect(run('POST', '/api/auth/login').next).toHaveBeenCalled();
  });

  it('maps viewer to admin for read authorization only', () => {
    expect(asEffectiveUser({ role: 'viewer' as const }).role).toBe('admin');
    expect(asEffectiveUser({ role: 'sales' as const }).role).toBe('sales');
  });
});
