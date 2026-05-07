import type { Prisma } from '@prisma/client';

export type AuditEntityType =
  | 'batch'
  | 'order'
  | 'installment'
  | 'certificate'
  | 'certificate_order'
  | 'investor'
  | 'merchant'
  | 'end_user'
  | 'user'
  | 'setting'
  | 'role_permission'
  | 'system';

export type AuditOptions = {
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  actorId: string;
  payload: Record<string, unknown>;
  tx?: Prisma.TransactionClient;
};
