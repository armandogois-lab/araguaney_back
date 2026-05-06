export type ImportErrorRow = {
  id: string;
  sheet_name: string;
  row_number: number;
  field_name: string | null;
  error_code: string;
  error_message: string;
  raw_value: string | null;
  created_at: Date;
};

export function toImportError(e: ImportErrorRow) {
  return {
    id: e.id,
    sheet_name: e.sheet_name,
    row_number: e.row_number,
    field_name: e.field_name,
    error_code: e.error_code,
    error_message: e.error_message,
    raw_value: e.raw_value,
    created_at: e.created_at.toISOString(),
  };
}
