import type { Decimal } from '@prisma/client/runtime/library';

export type SettingsRow = {
  id: number;
  default_sweep_rate: Decimal;
  shortfall_warning_threshold: Decimal;
  concentration_warning_threshold: Decimal;
  updated_at: Date;
  updated_by: { id: string; email: string; full_name: string } | null;
};

export function toSettings(s: SettingsRow) {
  return {
    default_sweep_rate: s.default_sweep_rate.toFixed(6),
    shortfall_warning_threshold: s.shortfall_warning_threshold.toFixed(6),
    concentration_warning_threshold: s.concentration_warning_threshold.toFixed(6),
    updated_at: s.updated_at.toISOString(),
    updated_by: s.updated_by
      ? { id: s.updated_by.id, email: s.updated_by.email, full_name: s.updated_by.full_name }
      : null,
  };
}
