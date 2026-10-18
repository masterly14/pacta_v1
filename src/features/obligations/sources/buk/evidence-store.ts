/**
 * FIXTURE / Pacta — Datos propios de Pacta (NO vienen de Buk) que el adaptador necesita:
 *  - última cuenta y último monto CONFIRMADOS por contraparte,
 *  - fondos disponibles y reservados,
 *  - calendario de beneficios del escenario con fórmula simplificada y ficticia,
 *  - hora de captura de cada instantánea y webhooks de Buk recibidos.
 * En producción los respalda Postgres (ejecuciones confirmadas, tesorería, plantillas); en la demo, los archivos `_pacta/`.
 */
import type { BukWebhook } from "./schemas";

export type SnapshotResource = "employees" | "payroll" | "licences" | "terminations" | "periods";

export type LastConfirmed = {
  beneficiaryReference: string | null;
  amountMinor: number | null;
};

export type BenefitCalendar = {
  /** Meses (MM) en que toca prima de servicios. */
  primaMonths: string[];
  /** Fórmula simplificada y ficticia: (salario base + auxilio de transporte si aplica) / 2. No es cálculo laboral legal. */
  formula: "prima_semestral_simplificada";
  smmlvMinor: number;
  auxTransporteMinor: number;
};

export type PactaEvidenceStore = {
  capturedAt(resource: SnapshotResource): string;
  lastConfirmed(counterpartyRef: string): LastConfirmed | null;
  treasury(): { fundsAvailableMinor: number | null; fundsReservedMinor: number | null };
  benefitCalendar(): BenefitCalendar;
  /** Webhooks recibidos con su hora de recepción (UTC). */
  webhooksReceived(): { receivedAt: string; body: BukWebhook }[];
};
