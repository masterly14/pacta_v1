import { z } from "zod";

// Primitivas del historial bancario (vertical B). Reutiliza las del contrato compartido
// para que dinero, fechas e identificadores se validen igual en todo el proyecto.
export {
  AmountMinorSchema,
  CalendarDateSchema,
  CurrencyCodeSchema,
  EntityIdSchema,
  UtcInstantSchema,
} from "@/shared/schemas/invoice-context";

// `amount` del CSV es siempre positivo; el sentido del movimiento va aparte (AmountMinorSchema no admite negativos).
export const DirectionSchema = z.enum(["debit", "credit"]);
export type Direction = z.infer<typeof DirectionSchema>;

export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "Debe ser un sha256 en hexadecimal minúscula");

export const RowNumberSchema = z.int().positive();

// bank_transactions.amount_minor es Int4 con signo (negativo = salida). Distinto de AmountMinorSchema (≥ 0).
export const INT32_MAX = 2_147_483_647;
export const SignedAmountMinorSchema = z
  .int()
  .min(-INT32_MAX)
  .max(INT32_MAX)
  .refine((amount) => amount !== 0, "Un movimiento no puede tener importe 0");

// ---------------------------------------------------------------------------
// Etiquetas del lote (opcionales, libres, solo contexto: no son permiso ni frontera de seguridad)
// ---------------------------------------------------------------------------

export const MAX_TAGS_PER_BATCH = 10;
export const MAX_TAG_LENGTH = 40;
export const MAX_CONTEXT_NOTE_LENGTH = 280;

const TAG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// minúsculas, sin tildes, espacios -> guion. "RRHH", " rrhh " y "Recursos Humanos" => "rrhh" / "recursos-humanos".
export function normalizeTag(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

export const TagSchema = z
  .string()
  .max(200) // tope de entrada antes de normalizar
  .transform(normalizeTag)
  .pipe(
    z
      .string()
      .max(MAX_TAG_LENGTH)
      .regex(TAG_PATTERN, "La etiqueta solo admite letras, números y guiones (1 a 40 caracteres)"),
  );

// Normaliza cada etiqueta y colapsa duplicados; el máximo se comprueba tras colapsar.
export const TagsSchema = z
  .array(TagSchema)
  .max(50) // tope de entrada
  .transform((tags) => [...new Set(tags)])
  .pipe(z.array(z.string()).max(MAX_TAGS_PER_BATCH));

// Texto informativo. Dato no confiable: nunca se interpreta ni se envía a un LLM.
export const ContextNoteSchema = z.string().trim().min(1).max(MAX_CONTEXT_NOTE_LENGTH);

export type Tag = z.output<typeof TagSchema>;
export type Tags = z.output<typeof TagsSchema>;
export type ContextNote = z.infer<typeof ContextNoteSchema>;
