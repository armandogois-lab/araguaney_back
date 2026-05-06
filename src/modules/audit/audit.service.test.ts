import { describe, it, expect, vi } from 'vitest';
import { AuditService } from './audit.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AuditService.recordChange', () => {
  it('inserts an audit_log row using the global prisma client when no tx is provided', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit-1' });
    const prisma = { auditLog: { create } } as unknown as PrismaService;
    const svc = new AuditService(prisma);

    await svc.recordChange({
      entityType: 'end_user',
      entityId: '00000000-0000-4000-8000-000000000001',
      action: 'update',
      actorId: '00000000-0000-4000-8000-000000000002',
      payload: { before: { email: null }, after: { email: 'x@y.com' } },
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        entity_type: 'end_user',
        entity_id: '00000000-0000-4000-8000-000000000001',
        action: 'update',
        actor_id: '00000000-0000-4000-8000-000000000002',
        payload: { before: { email: null }, after: { email: 'x@y.com' } },
      },
    });
  });

  it('uses the caller-provided tx instead of the global prisma client', async () => {
    const globalCreate = vi.fn();
    const txCreate = vi.fn().mockResolvedValue({ id: 'audit-2' });
    const prisma = { auditLog: { create: globalCreate } } as unknown as PrismaService;
    const tx = { auditLog: { create: txCreate } } as unknown as Parameters<AuditService['recordChange']>[0]['tx'];
    const svc = new AuditService(prisma);

    await svc.recordChange({
      entityType: 'end_user',
      entityId: 'id',
      action: 'update',
      actorId: 'actor',
      payload: {},
      tx,
    });

    expect(txCreate).toHaveBeenCalledOnce();
    expect(globalCreate).not.toHaveBeenCalled();
  });
});
