/**
 * Purpose: datos propios de Pacta para leer RR. HH. en vivo (en el tick): lo último confirmado sale de la BD, la lectura se
 *   considera hecha en `asOf` (Pacta lee Buk al evaluar), los fondos son simulados y el calendario de beneficios es el
 *   del fixture. Es el equivalente en producción del almacén de `_pacta/` de los escenarios.
 * Runs in: servidor y pruebas.
 */
import { AUX, SMMLV } from "./fixtures/buk/builders";
import type { BenefitCalendar, LastConfirmed, PactaEvidenceStore } from "./sources/buk/evidence-store";

/** Fondos simulados de la demo ($80.000.000 COP libres). Dinero simulado: nunca representa una cuenta real. */
export const SIMULATED_TREASURY = { fundsAvailableMinor: 8_000_000_000, fundsReservedMinor: 0 };

/** Calendario de beneficios del fixture: prima en jun y dic con fórmula simplificada y ficticia (no es cálculo laboral). */
export const FIXTURE_BENEFIT_CALENDAR: BenefitCalendar = {
  primaMonths: ["06", "12"],
  formula: "prima_semestral_simplificada",
  smmlvMinor: SMMLV * 100,
  auxTransporteMinor: AUX * 100,
};

export class LiveEvidenceStore implements PactaEvidenceStore {
  constructor(
    private readonly asOf: string,
    private readonly confirmed: Record<string, LastConfirmed>,
  ) {}
  capturedAt() {
    return this.asOf;
  }
  lastConfirmed(counterpartyRef: string) {
    return this.confirmed[counterpartyRef] ?? null;
  }
  treasury() {
    return SIMULATED_TREASURY;
  }
  benefitCalendar() {
    return FIXTURE_BENEFIT_CALENDAR;
  }
  webhooksReceived() {
    return [];
  }
}
