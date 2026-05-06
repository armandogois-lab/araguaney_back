import ExcelJS from 'exceljs';

export type SheetSpec = {
  name: string;
  headers: string[];
  rows: Array<Array<string | number | Date | null>>;
};

/**
 * Builds an XLSX workbook in-memory and returns a Buffer suitable for parser tests.
 * Each sheet's first row is the headers; subsequent rows are data.
 */
export async function buildWorkbook(opts: { sheets: SheetSpec[] }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const s of opts.sheets) {
    const ws = wb.addWorksheet(s.name);
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
