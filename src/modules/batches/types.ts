import type { ErrorCode } from './errors/error-codes';

export type ParsedRow = {
  sheetName: string;
  rowNumber: number; // 1-indexed within sheet (header on row 1, first data row is 2)
  fechaDeCompra: Date | null;
  usuario: string | null;
  rif: string | null;
  razonSocial: string | null;
  identificadorDeOrden: string | null;
  numeroDeCuota: number | null;
  montoTotalDeLaOrden: string | null;
  identificadorDeCuota: string | null;
  montoDeCuota: string | null;
  vencimientoCuota: Date | null;
  coercionErrors: Array<{ field: string; rawValue: string }>;
};

export type ValidationError = {
  sheetName: string;
  rowNumber: number;
  fieldName: string | null;
  errorCode: ErrorCode;
  errorMessage: string;
  rawValue: string | null;
};

export type ParsedInstallment = {
  rowNumber: number;
  sheetName: string;
  externalInstallmentId: string;
  installmentNumber: number;
  amount: string;
  dueDate: Date;
};

export type ParsedGroup = {
  externalOrderId: string;
  rifCanonical: string;
  rifRaw: string;
  razonSocial: string;
  fechaDeCompra: Date;
  usuarioHash: string;
  montoTotalDeLaOrden: string;
  installments: ParsedInstallment[];
};

export type ParseResult =
  | { kind: 'fatal'; reason: string }
  | { kind: 'parsed'; rows: ParsedRow[]; sheets: string[]; decimalSeparator: 'dot' | 'comma' };

export type IngestionResult = {
  status: 'imported' | 'rejected';
  rowsImported: number;
  rowsRejected: number;
  totalOrdersAmount: string;
  totalInstallmentsAmount: string;
  rejectionReason: string | null;
  decimalSeparatorDetected: 'dot' | 'comma' | null;
  errorsTotal: number;
  errorsPreview: ValidationError[];
};
