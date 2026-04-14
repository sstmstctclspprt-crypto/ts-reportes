import { z } from 'zod';

/** Limpia caracteres típicos de XSS en texto plano; longitud se valida antes del transform. */
function sanitizedString(opts: { max: number; min?: number }) {
  let s = z.string().max(opts.max);
  if (opts.min != null) {
    s = s.min(opts.min);
  }
  return s.transform((v) => v.replace(/[<>]/g, '').trim());
}

const boolRecord = z.record(z.string(), z.boolean());

const textRecord = z.record(z.string(), sanitizedString({ max: 1000 }));

const dataUrlOrPath = z
  .string()
  .max(1_500_000)
  .refine((v) => v.startsWith('data:') || v.startsWith('organizations/'), 'Evidencia inválida');

const maybeDataUrlOrPath = z
  .string()
  .max(1_500_000)
  .refine(
    (v) => v.length === 0 || v.startsWith('data:') || v.startsWith('organizations/'),
    'Firma inválida'
  );

export const registroPayloadSchema = z.object({
  service_id: z.union([z.null(), sanitizedString({ max: 64 })]),
  operador: sanitizedString({ min: 1, max: 120 }),
  checklist_tracto: z.record(z.string(), z.unknown()),
  checklist_caja: boolRecord,
  inspeccion_agricola: z.object({
    verificado: boolRecord,
    contaminacion: textRecord,
    tipo: z.record(z.string(), z.enum(['Sin comentario', 'Texto libre']))
  }),
  inspeccion_mecanica: z.object({
    habilitada: z.boolean(),
    tractor: boolRecord,
    cajaTrailer: boolRecord,
    observaciones: sanitizedString({ max: 2000 })
  }),
  image_urls: z.array(dataUrlOrPath).max(12),
  firma_operador: maybeDataUrlOrPath.optional().nullable(),
  firma_oficial: maybeDataUrlOrPath.optional().nullable(),
  comentarios_tipo: z.enum(['Sin comentarios', 'Rechazado', 'Texto libre']),
  comentarios: sanitizedString({ max: 4000 }),
  evidencias_exif: z.record(z.string(), z.unknown()),
  user_id: z.string().uuid(),
  organization_id: sanitizedString({ min: 1, max: 120 })
});

export type RegistroPayload = z.infer<typeof registroPayloadSchema>;

export function validateRegistroPayload(payload: unknown): RegistroPayload {
  return registroPayloadSchema.parse(payload);
}
