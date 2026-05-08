import ExcelJS from 'exceljs';

export type SheetSpec = {
  name: string;
  headers: string[];
  rows: Array<Array<string | number | Date | null>>;
  /**
   * Optional rows written above the header row. The canonical Cashea export
   * has 4 metadata rows (sheet title, "Órdenes FCB", batch reference, period)
   * before the actual headers — tests that emulate that layout pass them here.
   */
  metadataRows?: Array<Array<string | number | Date | null>>;
};

export async function buildWorkbook(opts: { sheets: SheetSpec[] }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const s of opts.sheets) {
    const ws = wb.addWorksheet(s.name);
    if (s.metadataRows) {
      for (const meta of s.metadataRows) ws.addRow(meta);
    }
    ws.addRow(s.headers);
    for (const row of s.rows) {
      ws.addRow(row);
    }
  }
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}

/** Standard 10-column header in the order the spec defines. */
export const STANDARD_HEADERS = [
  'Fecha de Compra',
  'Usuario',
  'Rif',
  'Razón Social',
  'Identificador de Orden',
  'Número de Cuota',
  'Monto Total de la Orden',
  'Identificador de Cuota',
  'Monto de Cuota',
  'Vencimiento Cuota',
] as const;
