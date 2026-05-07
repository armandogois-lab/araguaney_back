export type AuditEntryRow = {
  id: string;
  occurred_at: Date;
  actor_id: string | null;
  actor: { id: string; email: string; full_name: string } | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  payload: unknown;
};

export function toAuditEntry(r: AuditEntryRow) {
  return {
    id: r.id,
    occurred_at: r.occurred_at.toISOString(),
    actor: r.actor
      ? { id: r.actor.id, email: r.actor.email, full_name: r.actor.full_name }
      : null,
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    ip_address: r.ip_address,
    user_agent: r.user_agent,
    payload: r.payload,
  };
}
