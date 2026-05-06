const PREFIXES = new Set(['V', 'E', 'J', 'G', 'P']);

/**
 * Normalize a Venezuelan RIF/cédula to canonical form `X-NNNNNNNN-N`
 * (8 digits + 1 check digit). Accepts inputs with or without hyphens,
 * mixed case, surrounding whitespace.
 *
 * Returns null if the input cannot be normalized.
 */
export function normalizeRif(input: string): string | null {
  if (typeof input !== 'string') return null;
  const compact = input.replace(/\s+/g, '').toUpperCase();
  if (!compact) return null;

  const m = compact.match(/^([VEJGP])-?(\d{1,9})-?(\d)$/);
  if (!m) return null;

  const [, prefix, digits, check] = m;
  if (!PREFIXES.has(prefix!)) return null;
  const padded = digits!.padStart(8, '0');
  if (padded.length > 8) return null; // more than 9 digits before check
  return `${prefix}-${padded}-${check}`;
}

export function isValidRif(input: string): boolean {
  return normalizeRif(input) !== null;
}
