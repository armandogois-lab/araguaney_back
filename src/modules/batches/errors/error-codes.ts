export const ErrorCodes = {
  // Row-level
  MISSING_FIELD: 'missing_field',
  INVALID_DATE: 'invalid_date',
  INVALID_AMOUNT: 'invalid_amount',
  INVALID_INSTALLMENT_NUMBER: 'invalid_installment_number',
  INVALID_RIF: 'invalid_rif',
  PURCHASE_DATE_FUTURE: 'purchase_date_future',
  DUE_BEFORE_PURCHASE: 'due_before_purchase',
  FIELD_TOO_LONG: 'field_too_long',
  // Cross-row (per group)
  INCONSISTENT_MERCHANT: 'inconsistent_merchant',
  INCONSISTENT_PURCHASE_DATE: 'inconsistent_purchase_date',
  INCONSISTENT_END_USER: 'inconsistent_end_user',
  INCONSISTENT_TOTAL: 'inconsistent_total',
  INVALID_INSTALLMENT_COUNT: 'invalid_installment_count',
  INSTALLMENT_NUMBERS_NOT_CONTIGUOUS: 'installment_numbers_not_contiguous',
  DUPLICATE_INSTALLMENT_ID_IN_ORDER: 'duplicate_installment_id_in_order',
  MERCHANT_NAME_DRIFT: 'merchant_name_drift',
  // DB collision
  ORDER_ALREADY_EXISTS: 'order_already_exists',
  INSTALLMENT_ALREADY_EXISTS: 'installment_already_exists',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
