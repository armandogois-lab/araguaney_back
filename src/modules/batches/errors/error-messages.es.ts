import { ErrorCodes, type ErrorCode } from './error-codes';

export function errorMessageEs(code: ErrorCode, context: Record<string, string | number> = {}): string {
  switch (code) {
    case ErrorCodes.MISSING_FIELD:
      return `Campo requerido vacío: ${context.field ?? '?'}`;
    case ErrorCodes.INVALID_DATE:
      return `Fecha inválida: '${context.value ?? ''}'`;
    case ErrorCodes.INVALID_AMOUNT:
      return `Monto inválido: '${context.value ?? ''}'`;
    case ErrorCodes.INVALID_INSTALLMENT_NUMBER:
      return `Número de cuota inválido (debe ser 1, 2 o 3): '${context.value ?? ''}'`;
    case ErrorCodes.INVALID_RIF:
      return `RIF con formato inválido: '${context.value ?? ''}'`;
    case ErrorCodes.PURCHASE_DATE_FUTURE:
      return `Fecha de compra está en el futuro: ${context.value ?? ''}`;
    case ErrorCodes.DUE_BEFORE_PURCHASE:
      return `Vencimiento de cuota es anterior a la fecha de compra`;
    case ErrorCodes.FIELD_TOO_LONG:
      return `Campo '${context.field ?? '?'}' excede el largo máximo (${context.max ?? '?'})`;
    case ErrorCodes.INCONSISTENT_MERCHANT:
      return `RIF inconsistente dentro de la misma orden`;
    case ErrorCodes.INCONSISTENT_PURCHASE_DATE:
      return `Fecha de compra inconsistente dentro de la misma orden`;
    case ErrorCodes.INCONSISTENT_END_USER:
      return `Usuario inconsistente dentro de la misma orden`;
    case ErrorCodes.INCONSISTENT_TOTAL:
      return `Monto total de la orden inconsistente entre cuotas`;
    case ErrorCodes.INVALID_INSTALLMENT_COUNT:
      return `Cantidad de cuotas inválida (debe ser 1 a 3): ${context.count ?? '?'}`;
    case ErrorCodes.INSTALLMENT_NUMBERS_NOT_CONTIGUOUS:
      return `Números de cuota no son consecutivos desde 1`;
    case ErrorCodes.DUPLICATE_INSTALLMENT_ID_IN_ORDER:
      return `Identificador de cuota duplicado dentro de la misma orden`;
    case ErrorCodes.MERCHANT_NAME_DRIFT:
      return `Razón social del comercio cambió respecto al registro previo (no bloqueante)`;
    case ErrorCodes.ORDER_ALREADY_EXISTS:
      return `Orden ya existe en el sistema (subida en un batch previo)`;
    case ErrorCodes.INSTALLMENT_ALREADY_EXISTS:
      return `Cuota ya existe en el sistema (subida en un batch previo)`;
  }
}
