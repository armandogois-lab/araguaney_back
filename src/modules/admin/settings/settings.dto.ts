import { z } from 'zod';

export const SettingsUpdateSchema = z
  .object({
    default_sweep_rate: z.coerce.number().min(0).max(0.999999).optional(),
    shortfall_warning_threshold: z.coerce.number().min(0).max(1).optional(),
    concentration_warning_threshold: z.coerce.number().min(0).max(1).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Debe enviar al menos un campo a actualizar',
  });

export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>;
