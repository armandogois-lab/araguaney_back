import { describe, it, expect } from 'vitest';
import { ExcelParserService } from './excel-parser.service';
import { buildWorkbook, STANDARD_HEADERS } from '../../../test/helpers/xlsx.helper';

const svc = new ExcelParserService();

function validRow(overrides: Record<number, unknown> = {}): Array<string | number | Date | null> {
  // Returns a row matching STANDARD_HEADERS order.
  const base: Array<string | number | Date | null> = [
    new Date('2026-05-01'), // Fecha de Compra
    'user-hash-1', // Usuario
    'J-12345678-9', // Rif
    'Mercantil C.A.', // Razón Social
    'ORD-001', // Identificador de Orden
    1, // Número de Cuota
    '300.00', // Monto Total de la Orden
    'INST-001-1', // Identificador de Cuota
    '75.00', // Monto de Cuota
    new Date('2026-05-15'), // Vencimiento Cuota
  ];
  for (const [i, v] of Object.entries(overrides)) {
    base[Number(i)] = v as string | number | Date | null;
  }
  return base;
}

describe('ExcelParserService.parse', () => {
  describe('fatal cases', () => {
    it('rejects when buffer is not a valid xlsx', async () => {
      const r = await svc.parse(Buffer.from('not an xlsx'));
      expect(r.kind).toBe('fatal');
      if (r.kind === 'fatal') {
        expect(r.reason).toMatch(/corrupt|invalid|cannot read|no es un xlsx/i);
      }
    });

    it('rejects when no sheets', async () => {
      const buf = await buildWorkbook({ sheets: [] });
      const r = await svc.parse(buf);
      expect(r.kind).toBe('fatal');
    });

    it('rejects when a sheet is missing a required header', async () => {
      const headers = STANDARD_HEADERS.filter((h) => h !== 'Rif');
      const buf = await buildWorkbook({ sheets: [{ name: 'S1', headers, rows: [] }] });
      const r = await svc.parse(buf);
      expect(r.kind).toBe('fatal');
      if (r.kind === 'fatal') {
        expect(r.reason).toMatch(/rif/i);
      }
    });

    it('rejects when there are 0 data rows total across all sheets', async () => {
      const buf = await buildWorkbook({
        sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows: [] }],
      });
      const r = await svc.parse(buf);
      expect(r.kind).toBe('fatal');
    });
  });

  describe('non-data sheets', () => {
    it('skips a "Resumen" sheet that has no CFB headers and parses the data sheet', async () => {
      const buf = await buildWorkbook({
        sheets: [
          {
            name: 'Resumen',
            headers: ['Total general', 'Cantidad de órdenes', 'Monto total'],
            rows: [['Lote 00085', 4500, '300000.00']],
          },
          {
            name: 'CFB_1_Cotidiana',
            headers: [...STANDARD_HEADERS],
            rows: [validRow()],
          },
        ],
      });
      const r = await svc.parse(buf);
      expect(r.kind).toBe('parsed');
      if (r.kind === 'parsed') {
        expect(r.rows).toHaveLength(1);
        expect(r.sheets).toEqual(['CFB_1_Cotidiana']);
      }
    });
  });

  describe('metadata rows above headers', () => {
    it('finds the header row past 4 leading metadata rows (canonical Cashea export)', async () => {
      const buf = await buildWorkbook({
        sheets: [
          {
            name: 'CFB_1_Cotidiana',
            metadataRows: [
              ['CFB_1_Cotidiana', 'Grupo Cashea VE, C.A'],
              ['Órdenes FCB'],
              ['Ordenes_FCB_LOTE_00085'],
              ['Período: Del 20/03/2026 Hasta 20/03/2026'],
            ],
            headers: [...STANDARD_HEADERS],
            rows: [validRow()],
          },
        ],
      });
      const r = await svc.parse(buf);
      expect(r.kind).toBe('parsed');
      if (r.kind === 'parsed') {
        expect(r.rows).toHaveLength(1);
        expect(r.rows[0]!.rif).toBe('J-12345678-9');
      }
    });
  });

  describe('header normalization', () => {
    it('matches headers with different case/accents/spacing', async () => {
      const headers = [
        'FECHA DE COMPRA',
        'usuario',
        'rif',
        'razon  social',
        'Identificador de Orden',
        'numero de cuota',
        'Monto Total de la Orden',
        'Identificador de Cuota',
        'Monto de Cuota',
        'Vencimiento Cuota',
      ];
      const buf = await buildWorkbook({ sheets: [{ name: 'S1', headers, rows: [validRow()] }] });
      const r = await svc.parse(buf);
      expect(r.kind).toBe('parsed');
      if (r.kind === 'parsed') {
        expect(r.rows).toHaveLength(1);
        expect(r.rows[0]!.rif).toBe('J-12345678-9');
      }
    });
  });

  describe('multi-sheet concat', () => {
    it('concatenates rows from all sheets in order', async () => {
      const buf = await buildWorkbook({
        sheets: [
          {
            name: 'S1',
            headers: [...STANDARD_HEADERS],
            rows: [validRow({ 4: 'ORD-A' }), validRow({ 4: 'ORD-B' })],
          },
          {
            name: 'S2',
            headers: [...STANDARD_HEADERS],
            rows: [validRow({ 4: 'ORD-C' })],
          },
        ],
      });
      const r = await svc.parse(buf);
      expect(r.kind).toBe('parsed');
      if (r.kind === 'parsed') {
        expect(r.rows.map((x) => x.identificadorDeOrden)).toEqual(['ORD-A', 'ORD-B', 'ORD-C']);
        expect(r.rows.map((x) => x.sheetName)).toEqual(['S1', 'S1', 'S2']);
        expect(r.sheets).toEqual(['S1', 'S2']);
      }
    });
  });

  describe('decimal separator heuristic', () => {
    it('detects dot when amounts use dot decimal', async () => {
      const buf = await buildWorkbook({
        sheets: [
          {
            name: 'S1',
            headers: [...STANDARD_HEADERS],
            rows: [validRow({ 6: '1234.56', 8: '300.00' })],
          },
        ],
      });
      const r = await svc.parse(buf);
      if (r.kind === 'parsed') {
        expect(r.decimalSeparator).toBe('dot');
        expect(r.rows[0]!.montoTotalDeLaOrden).toBe('1234.56');
      }
    });

    it('detects comma when amounts use comma decimal', async () => {
      const buf = await buildWorkbook({
        sheets: [
          {
            name: 'S1',
            headers: [...STANDARD_HEADERS],
            rows: [validRow({ 6: '1234,56', 8: '300,00' }), validRow({ 6: '999,99', 8: '100,50' })],
          },
        ],
      });
      const r = await svc.parse(buf);
      if (r.kind === 'parsed') {
        expect(r.decimalSeparator).toBe('comma');
        expect(r.rows[0]!.montoTotalDeLaOrden).toBe('1234.56');
      }
    });
  });

  describe('date parsing', () => {
    it('parses Excel-native Date cells', async () => {
      const buf = await buildWorkbook({
        sheets: [
          {
            name: 'S1',
            headers: [...STANDARD_HEADERS],
            rows: [validRow({ 0: new Date('2026-05-01') })],
          },
        ],
      });
      const r = await svc.parse(buf);
      if (r.kind === 'parsed') {
        expect(r.rows[0]!.fechaDeCompra?.toISOString().slice(0, 10)).toBe('2026-05-01');
      }
    });

    it('parses ISO YYYY-MM-DD strings', async () => {
      const buf = await buildWorkbook({
        sheets: [
          { name: 'S1', headers: [...STANDARD_HEADERS], rows: [validRow({ 0: '2026-05-01' })] },
        ],
      });
      const r = await svc.parse(buf);
      if (r.kind === 'parsed') {
        expect(r.rows[0]!.fechaDeCompra?.toISOString().slice(0, 10)).toBe('2026-05-01');
      }
    });

    it('parses DD/MM/YYYY strings', async () => {
      const buf = await buildWorkbook({
        sheets: [
          { name: 'S1', headers: [...STANDARD_HEADERS], rows: [validRow({ 0: '01/05/2026' })] },
        ],
      });
      const r = await svc.parse(buf);
      if (r.kind === 'parsed') {
        expect(r.rows[0]!.fechaDeCompra?.toISOString().slice(0, 10)).toBe('2026-05-01');
      }
    });

    it('flags coercionError for unparseable date', async () => {
      const buf = await buildWorkbook({
        sheets: [
          { name: 'S1', headers: [...STANDARD_HEADERS], rows: [validRow({ 0: 'not a date' })] },
        ],
      });
      const r = await svc.parse(buf);
      if (r.kind === 'parsed') {
        expect(r.rows[0]!.fechaDeCompra).toBeNull();
        expect(r.rows[0]!.coercionErrors).toContainEqual({
          field: 'fecha de compra',
          rawValue: 'not a date',
        });
      }
    });
  });

  describe('numero de cuota coercion', () => {
    it('coerces integer string', async () => {
      const buf = await buildWorkbook({
        sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows: [validRow({ 5: '2' })] }],
      });
      const r = await svc.parse(buf);
      if (r.kind === 'parsed') {
        expect(r.rows[0]!.numeroDeCuota).toBe(2);
      }
    });

    it('flags coercionError when not an integer', async () => {
      const buf = await buildWorkbook({
        sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows: [validRow({ 5: 'three' })] }],
      });
      const r = await svc.parse(buf);
      if (r.kind === 'parsed') {
        expect(r.rows[0]!.numeroDeCuota).toBeNull();
        expect(r.rows[0]!.coercionErrors.some((c) => c.field === 'numero de cuota')).toBe(true);
      }
    });
  });

  describe('amount coercion', () => {
    it('flags coercionError on non-numeric amount', async () => {
      const buf = await buildWorkbook({
        sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows: [validRow({ 8: 'NA' })] }],
      });
      const r = await svc.parse(buf);
      if (r.kind === 'parsed') {
        expect(r.rows[0]!.montoDeCuota).toBeNull();
        expect(r.rows[0]!.coercionErrors.some((c) => c.field === 'monto de cuota')).toBe(true);
      }
    });

    it('preserves trailing zeros from string amounts', async () => {
      const buf = await buildWorkbook({
        sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows: [validRow({ 8: '75.50' })] }],
      });
      const r = await svc.parse(buf);
      if (r.kind === 'parsed') {
        expect(r.rows[0]!.montoDeCuota).toBe('75.50');
      }
    });
  });

  describe('row numbering', () => {
    it('sets rowNumber starting at 2 (header is row 1)', async () => {
      const buf = await buildWorkbook({
        sheets: [
          {
            name: 'S1',
            headers: [...STANDARD_HEADERS],
            rows: [validRow(), validRow(), validRow()],
          },
        ],
      });
      const r = await svc.parse(buf);
      if (r.kind === 'parsed') {
        expect(r.rows.map((x) => x.rowNumber)).toEqual([2, 3, 4]);
      }
    });

    it('preserves rowNumber per-sheet (does not continue across sheets)', async () => {
      const buf = await buildWorkbook({
        sheets: [
          { name: 'S1', headers: [...STANDARD_HEADERS], rows: [validRow()] },
          { name: 'S2', headers: [...STANDARD_HEADERS], rows: [validRow(), validRow()] },
        ],
      });
      const r = await svc.parse(buf);
      if (r.kind === 'parsed') {
        expect(r.rows.map((x) => `${x.sheetName}:${x.rowNumber}`)).toEqual([
          'S1:2',
          'S2:2',
          'S2:3',
        ]);
      }
    });
  });
});
