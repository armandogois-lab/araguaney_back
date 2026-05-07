import type { Decimal } from '@prisma/client/runtime/library';

export type InvestorSummaryRow = {
  id: string;
  legal_name: string;
  rif: string;
  kind: string;
  status: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  updated_by: { id: string; email: string; full_name: string } | null;
  active_cert_count: number;
  total_invested: Decimal;
};

export function toInvestorSummary(i: InvestorSummaryRow) {
  return {
    id: i.id,
    legal_name: i.legal_name,
    rif: i.rif,
    kind: i.kind,
    status: i.status,
    email: i.email,
    phone: i.phone,
    notes: i.notes,
    created_at: i.created_at.toISOString(),
    updated_at: i.updated_at.toISOString(),
    updated_by: i.updated_by
      ? { id: i.updated_by.id, email: i.updated_by.email, full_name: i.updated_by.full_name }
      : null,
    active_cert_count: i.active_cert_count,
    total_invested: i.total_invested.toFixed(4),
  };
}
