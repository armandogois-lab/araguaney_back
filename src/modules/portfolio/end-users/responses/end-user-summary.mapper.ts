export type EndUserSummaryRow = {
  id: string;
  external_hash: string;
  full_name: string | null;
  national_id: string | null;
  email: string | null;
  phone: string | null;
  enriched_at: Date | null;
  first_seen_at: Date;
  last_seen_at: Date;
  _count: { orders: number };
};

export function toEndUserSummary(u: EndUserSummaryRow) {
  return {
    id: u.id,
    external_hash: u.external_hash,
    full_name: u.full_name,
    national_id: u.national_id,
    email: u.email,
    phone: u.phone,
    enriched_at: u.enriched_at?.toISOString() ?? null,
    first_seen_at: u.first_seen_at.toISOString(),
    last_seen_at: u.last_seen_at.toISOString(),
    order_count: u._count.orders,
  };
}
