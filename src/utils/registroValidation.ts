import { z } from 'zod';

const safeText = z
  .string()
  .max(500)
  .transform((v) => v.replace(/[<>]/g, '').trim());

const boolRecord = z.record(z.boolean());
const textRecord = z.record(safeText.max(1000));

const dataUrlOrPath = z
  .string()
  .max(1_500_000)
  .refine((v) => v.startsWith('data:') || v.startsWith('organizations/'), 'Evidencia inválida');

const maybeDataUrlOrPath = z
  .string()
  .max(1_500_000)
  .refine((v) => v.length === 0 || v.startsWith('data:') || v.startsWith('organizations/'), 'Firma inválida');

export const registroPayloadSchema = z.object({
  service_id: safeText.max(64).nullable(),
  operador: safeText.min(1).max(120),
  checklist_tracto: z.record(z.unknown()),
  checklist_caja: boolRecord,
  inspeccion_agricola: z.object({
    verificado: boolRecord,
    contaminacion: textRecord,
    tipo: z.record(z.enum(['Sin comentario', 'Texto libre']))
  }),
  inspeccion_mecanica: z.object({
    habilitada: z.boolean(),
    tractor: boolRecord,
    cajaTrailer: boolRecord,
    observaciones: safeText.max(2000)
  }),
  image_urls: z.array(dataUrlOrPath).max(12),
  firma_operador: maybeDataUrlOrPath.optional().nullable(),
  firma_oficial: maybeDataUrlOrPath.optional().nullable(),
  comentarios_tipo: z.enum(['Sin comentarios', 'Rechazado', 'Texto libre']),
  comentarios: safeText.max(4000),
  evidencias_exif: z.record(z.unknown()),
  user_id: z.string().uuid(),
  organization_id: safeText.min(1).max(120)
});

export type RegistroPayload = z.infer<typeof registroPayloadSchema>;

export function validateRegistroPayload(payload: unknown): RegistroPayload {
  return registroPayloadSchema.parse(payload);
}
