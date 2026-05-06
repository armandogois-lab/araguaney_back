import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExcelParserService } from './excel-parser.service';
import { normalizeRif } from './rif-normalizer';
import { ErrorCodes, type ErrorCode } from './errors/error-codes';
import { errorMessageEs } from './errors/error-messages.es';
import type {
  IngestionResult,
  ParsedGroup,
  ParsedRow,
  ValidationError,
} from './types';

const ERROR_PREVIEW_LIMIT = 50;
const MAX_FIELD_LEN = 255;
const ID_MAX_LEN = 100;
const RAZON_SOCIAL_MAX_LEN = 255;

@Injectable()
export class IngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: ExcelParserService,
  ) {}

  async parseAndImport(opts: {
    batchId: string;
    fileBuffer: Buffer;
    actorId: string;
  }): Promise<IngestionResult> {
    const parseResult = await this.parser.parse(opts.fileBuffer);

    if (parseResult.kind === 'fatal') {
      await this.prisma.batch.update({
        where: { id: opts.batchId },
        data: {
          status: 'rejected',
          rejection_reason: parseResult.reason,
          imported_at: new Date(),
        },
      });
      return {
        status: 'rejected',
        rowsImported: 0,
        rowsRejected: 0,
        totalOrdersAmount: '0.0000',
        totalInstallmentsAmount: '0.0000',
        rejectionReason: parseResult.reason,
        decimalSeparatorDetected: null,
        errorsTotal: 0,
        errorsPreview: [],
      };
    }

    return await this.prisma.$transaction(
      async (tx) => {
        await tx.batch.update({
          where: { id: opts.batchId },
          data: { status: 'parsing' },
        });

        const errors: ValidationError[] = [];
        const validRows: ParsedRow[] = [];
        // Track order IDs that had at least one row-level error — entire group is excluded
        const taintedOrderIds = new Set<string>();

        for (const r of parseResult.rows) {
          const rowErrors = validateRow(r);
          if (rowErrors.length > 0) {
            errors.push(...rowErrors);
            if (r.identificadorDeOrden) taintedOrderIds.add(r.identificadorDeOrden);
            continue;
          }
          validRows.push(r);
        }

        // Group by external_order_id (excluding tainted groups)
        const groupsRaw = new Map<string, ParsedRow[]>();
        for (const r of validRows) {
          const key = r.identificadorDeOrden!;
          // Skip rows belonging to an order that had any row-level error
          if (taintedOrderIds.has(key)) continue;
          const arr = groupsRaw.get(key) ?? [];
          arr.push(r);
          groupsRaw.set(key, arr);
        }

        const validGroups: ParsedGroup[] = [];
        for (const [orderId, rows] of groupsRaw.entries()) {
          const groupErrors = validateGroup(orderId, rows);
          // MERCHANT_NAME_DRIFT is non-blocking; other errors are fatal for the group
          const fatalErrors = groupErrors.filter((e) => e.errorCode !== ErrorCodes.MERCHANT_NAME_DRIFT);
          if (fatalErrors.length > 0) {
            errors.push(...groupErrors);
            continue;
          }
          if (groupErrors.length > 0) errors.push(...groupErrors);

          const first = rows[0]!;
          const canonical = normalizeRif(first.rif!)!;
          validGroups.push({
            externalOrderId: orderId,
            rifCanonical: canonical,
            rifRaw: first.rif!,
            razonSocial: first.razonSocial!,
            fechaDeCompra: first.fechaDeCompra!,
            usuarioHash: first.usuario!,
            montoTotalDeLaOrden: first.montoTotalDeLaOrden!,
            installments: rows.map((r) => ({
              rowNumber: r.rowNumber,
              sheetName: r.sheetName,
              externalInstallmentId: r.identificadorDeCuota!,
              installmentNumber: r.numeroDeCuota!,
              amount: r.montoDeCuota!,
              dueDate: r.vencimientoCuota!,
            })),
          });
        }

        // DB collision check
        if (validGroups.length > 0) {
          const existingOrders = await tx.order.findMany({
            where: { external_order_id: { in: validGroups.map((g) => g.externalOrderId) } },
            select: { external_order_id: true },
          });
          const existingOrderIds = new Set(existingOrders.map((x) => x.external_order_id));

          const allInstallmentIds = validGroups.flatMap((g) =>
            g.installments.map((i) => i.externalInstallmentId),
          );
          const existingInstallments =
            allInstallmentIds.length === 0
              ? []
              : await tx.installment.findMany({
                  where: { external_installment_id: { in: allInstallmentIds } },
                  select: { external_installment_id: true },
                });
          const existingInstallmentIds = new Set(
            existingInstallments.map((x) => x.external_installment_id),
          );

          const surviving: ParsedGroup[] = [];
          for (const g of validGroups) {
            if (existingOrderIds.has(g.externalOrderId)) {
              const sample = g.installments[0]!;
              errors.push({
                sheetName: sample.sheetName,
                rowNumber: sample.rowNumber,
                fieldName: null,
                errorCode: ErrorCodes.ORDER_ALREADY_EXISTS,
                errorMessage: errorMessageEs(ErrorCodes.ORDER_ALREADY_EXISTS),
                rawValue: g.externalOrderId,
              });
              continue;
            }
            const conflictingInstallment = g.installments.find((i) =>
              existingInstallmentIds.has(i.externalInstallmentId),
            );
            if (conflictingInstallment) {
              errors.push({
                sheetName: conflictingInstallment.sheetName,
                rowNumber: conflictingInstallment.rowNumber,
                fieldName: 'identificador de cuota',
                errorCode: ErrorCodes.INSTALLMENT_ALREADY_EXISTS,
                errorMessage: errorMessageEs(ErrorCodes.INSTALLMENT_ALREADY_EXISTS),
                rawValue: conflictingInstallment.externalInstallmentId,
              });
              continue;
            }
            surviving.push(g);
          }
          validGroups.length = 0;
          validGroups.push(...surviving);
        }

        let totalOrders = new Prisma.Decimal(0);
        let totalInstallments = new Prisma.Decimal(0);

        for (const g of validGroups) {
          // Lookup-or-create merchant
          const merchant = await tx.merchant.findUnique({ where: { rif: g.rifCanonical } });
          let merchantId: string;
          if (!merchant) {
            const created = await tx.merchant.create({
              data: { rif: g.rifCanonical, current_name: g.razonSocial },
            });
            merchantId = created.id;
            await tx.merchantNameHistory.create({
              data: {
                merchant_id: merchantId,
                name: g.razonSocial,
                effective_from: g.fechaDeCompra,
                effective_to: null,
              },
            });
          } else {
            merchantId = merchant.id;
            if (merchant.current_name !== g.razonSocial) {
              await tx.merchantNameHistory.updateMany({
                where: { merchant_id: merchantId, effective_to: null },
                data: { effective_to: g.fechaDeCompra },
              });
              await tx.merchantNameHistory.create({
                data: {
                  merchant_id: merchantId,
                  name: g.razonSocial,
                  effective_from: g.fechaDeCompra,
                  effective_to: null,
                },
              });
              await tx.merchant.update({
                where: { id: merchantId },
                data: { current_name: g.razonSocial },
              });
            }
          }

          // Lookup-or-create end_user
          const eu = await tx.endUser.findUnique({ where: { external_hash: g.usuarioHash } });
          let endUserId: string;
          if (!eu) {
            const created = await tx.endUser.create({
              data: {
                external_hash: g.usuarioHash,
                first_seen_at: new Date(),
                last_seen_at: new Date(),
              },
            });
            endUserId = created.id;
          } else {
            endUserId = eu.id;
          }

          const installmentsSum = g.installments.reduce(
            (acc, i) => acc.plus(new Prisma.Decimal(i.amount)),
            new Prisma.Decimal(0),
          );
          const maxDueDate = g.installments.reduce(
            (max, i) => (i.dueDate > max ? i.dueDate : max),
            g.installments[0]!.dueDate,
          );

          const order = await tx.order.create({
            data: {
              external_order_id: g.externalOrderId,
              batch_id: opts.batchId,
              merchant_id: merchantId,
              end_user_id: endUserId,
              total_amount: new Prisma.Decimal(g.montoTotalDeLaOrden),
              installments_sum: installmentsSum,
              num_installments: g.installments.length,
              purchase_date: g.fechaDeCompra,
              max_due_date: maxDueDate,
              status: 'available',
            },
          });

          await tx.installment.createMany({
            data: g.installments.map((i) => ({
              external_installment_id: i.externalInstallmentId,
              order_id: order.id,
              installment_number: i.installmentNumber,
              amount: new Prisma.Decimal(i.amount),
              due_date: i.dueDate,
              status: 'pending',
            })),
          });

          totalOrders = totalOrders.plus(new Prisma.Decimal(g.montoTotalDeLaOrden));
          totalInstallments = totalInstallments.plus(installmentsSum);
        }

        if (errors.length > 0) {
          await tx.importError.createMany({
            data: errors.map((e) => ({
              batch_id: opts.batchId,
              sheet_name: e.sheetName,
              row_number: e.rowNumber,
              field_name: e.fieldName,
              error_code: e.errorCode,
              error_message: e.errorMessage,
              raw_value: e.rawValue,
            })),
          });
        }

        await tx.batch.update({
          where: { id: opts.batchId },
          data: {
            status: 'imported',
            rows_imported: validGroups.length,
            rows_rejected: errors.length,
            total_orders_amount: totalOrders,
            total_installments_amount: totalInstallments,
            imported_at: new Date(),
          },
        });

        return {
          status: 'imported' as const,
          rowsImported: validGroups.length,
          rowsRejected: errors.length,
          totalOrdersAmount: totalOrders.toFixed(4),
          totalInstallmentsAmount: totalInstallments.toFixed(4),
          rejectionReason: null,
          decimalSeparatorDetected: parseResult.decimalSeparator,
          errorsTotal: errors.length,
          errorsPreview: errors.slice(0, ERROR_PREVIEW_LIMIT),
        };
      },
      { timeout: 60_000 },
    );
  }
}

// ---------------------------------------------------------------------------
// Per-row validation
// ---------------------------------------------------------------------------

function makeError(
  row: ParsedRow,
  fieldName: string | null,
  code: ErrorCode,
  rawValue: string | null,
  context: Record<string, string | number> = {},
): ValidationError {
  return {
    sheetName: row.sheetName,
    rowNumber: row.rowNumber,
    fieldName,
    errorCode: code,
    errorMessage: errorMessageEs(code, context),
    rawValue,
  };
}

function validateRow(r: ParsedRow): ValidationError[] {
  const errors: ValidationError[] = [];

  // Report coercion errors first (the parser already detected the bad raw value)
  for (const c of r.coercionErrors) {
    let code: ErrorCode = ErrorCodes.INVALID_AMOUNT;
    if (c.field === 'fecha de compra' || c.field === 'vencimiento cuota') {
      code = ErrorCodes.INVALID_DATE;
    } else if (c.field === 'numero de cuota') {
      code = ErrorCodes.INVALID_INSTALLMENT_NUMBER;
    }
    errors.push(
      makeError(r, c.field, code, c.rawValue, { field: c.field, value: c.rawValue }),
    );
  }

  // Required-field presence check (skip fields that already had a coercion error)
  const requiredFields: Array<[keyof ParsedRow, string]> = [
    ['fechaDeCompra', 'fecha de compra'],
    ['usuario', 'usuario'],
    ['rif', 'rif'],
    ['razonSocial', 'razon social'],
    ['identificadorDeOrden', 'identificador de orden'],
    ['numeroDeCuota', 'numero de cuota'],
    ['montoTotalDeLaOrden', 'monto total de la orden'],
    ['identificadorDeCuota', 'identificador de cuota'],
    ['montoDeCuota', 'monto de cuota'],
    ['vencimientoCuota', 'vencimiento cuota'],
  ];
  const coercedFields = new Set(r.coercionErrors.map((c) => c.field));
  for (const [key, fname] of requiredFields) {
    if ((r as Record<string, unknown>)[key] === null && !coercedFields.has(fname)) {
      errors.push(makeError(r, fname, ErrorCodes.MISSING_FIELD, null, { field: fname }));
    }
  }

  // String length checks
  if (r.usuario && r.usuario.length > MAX_FIELD_LEN) {
    errors.push(
      makeError(r, 'usuario', ErrorCodes.FIELD_TOO_LONG, r.usuario, {
        field: 'usuario',
        max: MAX_FIELD_LEN,
      }),
    );
  }
  if (r.razonSocial && r.razonSocial.length > RAZON_SOCIAL_MAX_LEN) {
    errors.push(
      makeError(r, 'razon social', ErrorCodes.FIELD_TOO_LONG, r.razonSocial, {
        field: 'razon social',
        max: RAZON_SOCIAL_MAX_LEN,
      }),
    );
  }
  if (r.identificadorDeOrden && r.identificadorDeOrden.length > ID_MAX_LEN) {
    errors.push(
      makeError(
        r,
        'identificador de orden',
        ErrorCodes.FIELD_TOO_LONG,
        r.identificadorDeOrden,
        { field: 'identificador de orden', max: ID_MAX_LEN },
      ),
    );
  }
  if (r.identificadorDeCuota && r.identificadorDeCuota.length > ID_MAX_LEN) {
    errors.push(
      makeError(
        r,
        'identificador de cuota',
        ErrorCodes.FIELD_TOO_LONG,
        r.identificadorDeCuota,
        { field: 'identificador de cuota', max: ID_MAX_LEN },
      ),
    );
  }

  // RIF format
  if (r.rif && normalizeRif(r.rif) === null) {
    errors.push(makeError(r, 'rif', ErrorCodes.INVALID_RIF, r.rif, { value: r.rif }));
  }

  // Installment number range (1-3)
  if (r.numeroDeCuota !== null && (r.numeroDeCuota < 1 || r.numeroDeCuota > 3)) {
    errors.push(
      makeError(
        r,
        'numero de cuota',
        ErrorCodes.INVALID_INSTALLMENT_NUMBER,
        String(r.numeroDeCuota),
        { value: r.numeroDeCuota },
      ),
    );
  }

  // Amount positivity
  if (r.montoTotalDeLaOrden !== null && parseFloat(r.montoTotalDeLaOrden) <= 0) {
    errors.push(
      makeError(
        r,
        'monto total de la orden',
        ErrorCodes.INVALID_AMOUNT,
        r.montoTotalDeLaOrden,
        { value: r.montoTotalDeLaOrden },
      ),
    );
  }
  if (r.montoDeCuota !== null && parseFloat(r.montoDeCuota) <= 0) {
    errors.push(
      makeError(r, 'monto de cuota', ErrorCodes.INVALID_AMOUNT, r.montoDeCuota, {
        value: r.montoDeCuota,
      }),
    );
  }

  // Date logic
  if (r.fechaDeCompra && r.fechaDeCompra > new Date()) {
    errors.push(
      makeError(
        r,
        'fecha de compra',
        ErrorCodes.PURCHASE_DATE_FUTURE,
        r.fechaDeCompra.toISOString().slice(0, 10),
        { value: r.fechaDeCompra.toISOString().slice(0, 10) },
      ),
    );
  }
  if (r.fechaDeCompra && r.vencimientoCuota && r.vencimientoCuota < r.fechaDeCompra) {
    errors.push(
      makeError(
        r,
        'vencimiento cuota',
        ErrorCodes.DUE_BEFORE_PURCHASE,
        r.vencimientoCuota.toISOString().slice(0, 10),
      ),
    );
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Per-group (cross-row) validation
// ---------------------------------------------------------------------------

function validateGroup(orderId: string, rows: ParsedRow[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const first = rows[0]!;

  // All rows must share the same canonical RIF
  const rifCanon = first.rif ? normalizeRif(first.rif) : null;
  for (const r of rows.slice(1)) {
    const rcanon = r.rif ? normalizeRif(r.rif) : null;
    if (rcanon !== rifCanon) {
      errors.push(makeError(r, 'rif', ErrorCodes.INCONSISTENT_MERCHANT, r.rif));
      break;
    }
  }

  // All rows must share the same purchase date
  for (const r of rows.slice(1)) {
    if (r.fechaDeCompra?.getTime() !== first.fechaDeCompra?.getTime()) {
      errors.push(
        makeError(
          r,
          'fecha de compra',
          ErrorCodes.INCONSISTENT_PURCHASE_DATE,
          r.fechaDeCompra?.toISOString().slice(0, 10) ?? null,
        ),
      );
      break;
    }
  }

  // All rows must share the same user hash
  for (const r of rows.slice(1)) {
    if (r.usuario !== first.usuario) {
      errors.push(makeError(r, 'usuario', ErrorCodes.INCONSISTENT_END_USER, r.usuario));
      break;
    }
  }

  // All rows must share the same total amount
  for (const r of rows.slice(1)) {
    if (r.montoTotalDeLaOrden !== first.montoTotalDeLaOrden) {
      errors.push(
        makeError(
          r,
          'monto total de la orden',
          ErrorCodes.INCONSISTENT_TOTAL,
          r.montoTotalDeLaOrden,
        ),
      );
      break;
    }
  }

  // Razon social drift is non-blocking
  for (const r of rows.slice(1)) {
    if (r.razonSocial !== first.razonSocial) {
      errors.push(makeError(r, 'razon social', ErrorCodes.MERCHANT_NAME_DRIFT, r.razonSocial));
      break;
    }
  }

  // Installment count: 1-3
  if (rows.length < 1 || rows.length > 3) {
    errors.push(
      makeError(first, null, ErrorCodes.INVALID_INSTALLMENT_COUNT, null, {
        count: rows.length,
      }),
    );
  }

  // Installment numbers must be 1..N contiguous
  const numbers = rows
    .map((r) => r.numeroDeCuota)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
  const expected = Array.from({ length: rows.length }, (_, i) => i + 1);
  if (
    numbers.length !== rows.length ||
    JSON.stringify(numbers) !== JSON.stringify(expected)
  ) {
    errors.push(
      makeError(first, 'numero de cuota', ErrorCodes.INSTALLMENT_NUMBERS_NOT_CONTIGUOUS, null),
    );
  }

  // Duplicate installment IDs within the same order
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.identificadorDeCuota && seen.has(r.identificadorDeCuota)) {
      errors.push(
        makeError(
          r,
          'identificador de cuota',
          ErrorCodes.DUPLICATE_INSTALLMENT_ID_IN_ORDER,
          r.identificadorDeCuota,
        ),
      );
      break;
    }
    if (r.identificadorDeCuota) seen.add(r.identificadorDeCuota);
  }

  return errors;
}
