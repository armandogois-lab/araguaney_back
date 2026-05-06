import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { ParsedRow, ParseResult } from './types';

const REQUIRED_HEADERS_NORMALIZED = [
  'fecha de compra',
  'usuario',
  'rif',
  'razon social',
  'identificador de orden',
  'numero de cuota',
  'monto total de la orden',
  'identificador de cuota',
  'monto de cuota',
  'vencimiento cuota',
] as const;

type FieldName = (typeof REQUIRED_HEADERS_NORMALIZED)[number];

function normalizeHeader(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function parseDateCell(value: unknown): Date | null {
  if (value instanceof Date && !isNaN(value.getTime())) {
    // ExcelJS may parse dates as local midnight; convert to UTC midnight by using the date parts
    const y = value.getUTCFullYear();
    const m = value.getUTCMonth();
    const d = value.getUTCDate();
    // Check if the local date parts differ (timezone offset scenario)
    // Use whichever representation gives the correct date
    const localY = value.getFullYear();
    const localM = value.getMonth();
    const localD = value.getDate();
    // prefer UTC if it looks reasonable, else use local
    const useY = y !== 1899 ? y : localY;
    const useM = y !== 1899 ? m : localM;
    const useD = y !== 1899 ? d : localD;
    return new Date(Date.UTC(useY, useM, useD));
  }
  if (typeof value === 'number') {
    // Excel serial — exceljs usually delivers Date already, but defensive fallback
    const epoch = Date.UTC(1899, 11, 30);
    const ms = epoch + value * 86400 * 1000;
    return new Date(ms);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // ISO YYYY-MM-DD
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (iso) {
      const dt = new Date(Date.UTC(+iso[1]!, +iso[2]! - 1, +iso[3]!));
      return isNaN(dt.getTime()) ? null : dt;
    }
    // DD/MM/YYYY
    const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
    if (dmy) {
      const dt = new Date(Date.UTC(+dmy[3]!, +dmy[2]! - 1, +dmy[1]!));
      return isNaN(dt.getTime()) ? null : dt;
    }
  }
  return null;
}

function parseIntCell(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string') {
    const t = value.trim();
    if (/^\d+$/.test(t)) return parseInt(t, 10);
  }
  return null;
}

function rawToString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function detectSeparator(samples: string[]): 'dot' | 'comma' {
  let dotVotes = 0;
  let commaVotes = 0;
  for (const s of samples) {
    const trimmed = s.trim();
    const hasDot = trimmed.includes('.');
    const hasComma = trimmed.includes(',');
    if (hasComma && !hasDot) commaVotes++;
    else if (hasDot && !hasComma) dotVotes++;
    else if (hasComma && hasDot) {
      // whichever comes last is the decimal separator
      if (trimmed.lastIndexOf(',') > trimmed.lastIndexOf('.')) commaVotes++;
      else dotVotes++;
    }
  }
  return commaVotes > dotVotes ? 'comma' : 'dot';
}

function coerceAmount(value: unknown, separator: 'dot' | 'comma'): string | null {
  if (value === null || value === undefined || value === '') return null;
  let s: string;
  if (typeof value === 'number') {
    s = value.toString();
  } else if (typeof value === 'string') {
    s = value.trim();
  } else {
    return null;
  }
  if (!s) return null;
  if (separator === 'comma') {
    // Remove thousand-separator dots, replace comma decimal with dot
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    // Remove thousand-separator commas
    s = s.replace(/,/g, '');
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return s;
}

function extractStringCell(row: unknown[], idx: number): string | null {
  const v = row[idx];
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

@Injectable()
export class ExcelParserService {
  async parse(buffer: Buffer): Promise<ParseResult> {
    const wb = new ExcelJS.Workbook();
    try {
      const ab = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer;
      await wb.xlsx.load(ab);
    } catch (e) {
      return {
        kind: 'fatal',
        reason: `Archivo no es un xlsx válido: ${(e as Error).message}`,
      };
    }

    const worksheets = wb.worksheets;
    if (worksheets.length === 0) {
      return { kind: 'fatal', reason: 'Archivo no contiene hojas' };
    }

    type RawSheet = {
      name: string;
      columnIndex: Record<FieldName, number>;
      rows: unknown[][];
    };

    const sheets: RawSheet[] = [];

    for (const ws of worksheets) {
      // Find the first non-empty row as the header row
      let headerRowNum = 0;
      for (let i = 1; i <= ws.rowCount; i++) {
        const rowVals = ws.getRow(i).values as unknown[];
        if (rowVals && rowVals.some((v) => v !== null && v !== undefined && v !== '')) {
          headerRowNum = i;
          break;
        }
      }
      if (headerRowNum === 0) continue;

      // exceljs row.values is 1-indexed (index 0 is undefined), so slice(1) to get 0-indexed array
      const headerVals = (ws.getRow(headerRowNum).values as unknown[]).slice(1);
      const headerNormalized = headerVals.map((v) => normalizeHeader(String(v ?? '')));

      const columnIndex: Partial<Record<FieldName, number>> = {};
      for (const required of REQUIRED_HEADERS_NORMALIZED) {
        const idx = headerNormalized.indexOf(required);
        if (idx === -1) {
          return {
            kind: 'fatal',
            reason: `Hoja "${ws.name}": falta columna requerida "${required}"`,
          };
        }
        columnIndex[required] = idx;
      }

      const rawRows: unknown[][] = [];
      for (let i = headerRowNum + 1; i <= ws.rowCount; i++) {
        const rowVals = (ws.getRow(i).values as unknown[]).slice(1);
        const isEmpty = rowVals.every((v) => v === null || v === undefined || v === '');
        if (isEmpty) continue;
        rawRows.push(rowVals);
      }

      sheets.push({
        name: ws.name,
        columnIndex: columnIndex as Record<FieldName, number>,
        rows: rawRows,
      });
    }

    const totalRows = sheets.reduce((sum, s) => sum + s.rows.length, 0);
    if (totalRows === 0) {
      return { kind: 'fatal', reason: 'Archivo no contiene filas de datos' };
    }

    // Detect decimal separator from amount samples
    const amountSamples: string[] = [];
    outer: for (const s of sheets) {
      for (const row of s.rows) {
        const total = row[s.columnIndex['monto total de la orden']];
        const cuota = row[s.columnIndex['monto de cuota']];
        if (typeof total === 'string' && total.trim()) amountSamples.push(total);
        if (typeof cuota === 'string' && cuota.trim()) amountSamples.push(cuota);
        if (amountSamples.length >= 20) break outer;
      }
    }
    const decimalSeparator = detectSeparator(amountSamples);

    const parsedRows: ParsedRow[] = [];

    for (const s of sheets) {
      let rowNumber = 1; // header is row 1, data starts at row 2
      for (const row of s.rows) {
        rowNumber++;
        const coercionErrors: Array<{ field: string; rawValue: string }> = [];

        // fecha de compra
        const fechaDeCompraRaw = row[s.columnIndex['fecha de compra']];
        const fechaDeCompra = parseDateCell(fechaDeCompraRaw);
        if (fechaDeCompra === null && fechaDeCompraRaw != null && fechaDeCompraRaw !== '') {
          coercionErrors.push({
            field: 'fecha de compra',
            rawValue: rawToString(fechaDeCompraRaw) ?? '',
          });
        }

        // usuario
        const usuario = extractStringCell(row, s.columnIndex['usuario']);

        // rif
        const rif = extractStringCell(row, s.columnIndex['rif']);

        // razon social
        const razonSocial = extractStringCell(row, s.columnIndex['razon social']);

        // identificador de orden
        const identificadorDeOrden = extractStringCell(
          row,
          s.columnIndex['identificador de orden'],
        );

        // numero de cuota
        const numeroDeCuotaRaw = row[s.columnIndex['numero de cuota']];
        const numeroDeCuota = parseIntCell(numeroDeCuotaRaw);
        if (numeroDeCuota === null && numeroDeCuotaRaw != null && numeroDeCuotaRaw !== '') {
          coercionErrors.push({
            field: 'numero de cuota',
            rawValue: rawToString(numeroDeCuotaRaw) ?? '',
          });
        }

        // monto total de la orden
        const montoTotalRaw = row[s.columnIndex['monto total de la orden']];
        const montoTotalDeLaOrden = coerceAmount(montoTotalRaw, decimalSeparator);
        if (montoTotalDeLaOrden === null && montoTotalRaw != null && montoTotalRaw !== '') {
          coercionErrors.push({
            field: 'monto total de la orden',
            rawValue: rawToString(montoTotalRaw) ?? '',
          });
        }

        // identificador de cuota
        const identificadorDeCuota = extractStringCell(
          row,
          s.columnIndex['identificador de cuota'],
        );

        // monto de cuota
        const montoCuotaRaw = row[s.columnIndex['monto de cuota']];
        const montoDeCuota = coerceAmount(montoCuotaRaw, decimalSeparator);
        if (montoDeCuota === null && montoCuotaRaw != null && montoCuotaRaw !== '') {
          coercionErrors.push({
            field: 'monto de cuota',
            rawValue: rawToString(montoCuotaRaw) ?? '',
          });
        }

        // vencimiento cuota
        const vencRaw = row[s.columnIndex['vencimiento cuota']];
        const vencimientoCuota = parseDateCell(vencRaw);
        if (vencimientoCuota === null && vencRaw != null && vencRaw !== '') {
          coercionErrors.push({
            field: 'vencimiento cuota',
            rawValue: rawToString(vencRaw) ?? '',
          });
        }

        parsedRows.push({
          sheetName: s.name,
          rowNumber,
          fechaDeCompra,
          usuario,
          rif,
          razonSocial,
          identificadorDeOrden,
          numeroDeCuota,
          montoTotalDeLaOrden,
          identificadorDeCuota,
          montoDeCuota,
          vencimientoCuota,
          coercionErrors,
        });
      }
    }

    return {
      kind: 'parsed',
      rows: parsedRows,
      sheets: sheets.map((s) => s.name),
      decimalSeparator,
    };
  }
}
