import type { Decimal } from '@prisma/client/runtime/library';

export type BatchRow = {
  id: string;
  external_code: string;
  status: string;
  rows_imported: number;
  rows_rejected: number;
  total_orders_amount: Decimal;
  total_installments_amount: Decimal;
  imported_at: Date | null;
  rejection_reason: string | null;
  excel_upload: {
    uploaded_at: Date;
    uploaded_by: { id: string; email: string; full_name: string };
  } | null;
};

export function toBatchSummary(b: BatchRow) {
  return {
    id: b.id,
    external_code: b.external_code,
    status: b.status,
    rows_imported: b.rows_imported,
    rows_rejected: b.rows_rejected,
    total_orders_amount: b.total_orders_amount.toFixed(4),
    total_installments_amount: b.total_installments_amount.toFixed(4),
    imported_at: b.imported_at?.toISOString() ?? null,
    rejection_reason: b.rejection_reason,
    uploaded_at: b.excel_upload?.uploaded_at.toISOString() ?? null,
    uploaded_by: b.excel_upload?.uploaded_by
      ? {
          id: b.excel_upload.uploaded_by.id,
          email: b.excel_upload.uploaded_by.email,
          full_name: b.excel_upload.uploaded_by.full_name,
        }
      : null,
  };
}
