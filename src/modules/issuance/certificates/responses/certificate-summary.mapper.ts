import type { Decimal } from '@prisma/client/runtime/library';

export type CertificateSummaryRow = {
  id: string;
  certificate_code: string;
  certificate_type: string;
  status: string;
  investor: { id: string; legal_name: string; rif: string };
  investor_capital: Decimal;
  annual_rate: Decimal;
  term_days: number;
  price: Decimal;
  nominal_target: Decimal;
  nominal_actual: Decimal;
  investor_paid: Decimal;
  investor_yield: Decimal;
  shortfall_pct: Decimal;
  issue_date: Date;
  maturity_date: Date;
  cycle_week: string;
  issued_by: { id: string; email: string; full_name: string };
  created_at: Date;
};

export function toCertificateSummary(c: CertificateSummaryRow) {
  return {
    id: c.id,
    certificate_code: c.certificate_code,
    certificate_type: c.certificate_type,
    status: c.status,
    investor: { id: c.investor.id, legal_name: c.investor.legal_name, rif: c.investor.rif },
    investor_capital: c.investor_capital.toFixed(4),
    annual_rate: c.annual_rate.toFixed(6),
    term_days: c.term_days,
    price: c.price.toFixed(6),
    nominal_target: c.nominal_target.toFixed(4),
    nominal_actual: c.nominal_actual.toFixed(4),
    investor_paid: c.investor_paid.toFixed(4),
    investor_yield: c.investor_yield.toFixed(4),
    shortfall_pct: c.shortfall_pct.toFixed(6),
    issue_date: c.issue_date.toISOString().slice(0, 10),
    maturity_date: c.maturity_date.toISOString().slice(0, 10),
    cycle_week: c.cycle_week,
    issued_by: { id: c.issued_by.id, email: c.issued_by.email, full_name: c.issued_by.full_name },
    created_at: c.created_at.toISOString(),
  };
}
