/**
 * FIXTURE — Resoluciones humanas de la historia de nómina: qué hizo una persona con lo que Pacta escaló.
 * Son datos de fixture escritos a propósito (actor y comentario ficticios); el libro (`ledger.ts`) falla si alguna no
 * corresponde a una línea que de verdad escaló, así que no se pueden desalinear de las reglas.
 * Los comentarios son los «precedentes» que más adelante lee el aprendizaje (como datos no confiables).
 */
import type { HumanResolution } from "./ledger";

const ANA = "usr_ana_contadora";

export const HISTORY_RESOLUTIONS: readonly HumanResolution[] = [
  { month: "2026-02", employeeId: 1005, lineType: "salary", action: "approve", actor: ANA, comment: "Cambio de cuenta verificado con Recursos Humanos: nueva cuenta Davivienda." },
  { month: "2026-03", employeeId: 1002, lineType: "salary", action: "approve", actor: ANA, comment: "Bonificación trimestral por cumplimiento de metas, autorizada por gerencia." },
  { month: "2026-04", employeeId: 1002, lineType: "salary", action: "approve", actor: ANA, comment: "Regreso al salario base después de la bonificación de marzo; sin novedad." },
  { month: "2026-05", employeeId: 1004, lineType: "salary", action: "approve", actor: ANA, comment: "Incapacidad médica de 8 días radicada y aprobada por la EPS." },
  { month: "2026-06", employeeId: 1002, lineType: "salary", action: "approve", actor: ANA, comment: "Bonificación trimestral por cumplimiento de metas (segundo trimestre), autorizada por gerencia." },
  { month: "2026-07", employeeId: 1002, lineType: "salary", action: "approve", actor: ANA, comment: "Regreso al salario base después de la bonificación de junio; sin novedad." },
  { month: "2026-09", employeeId: 1002, lineType: "salary", action: "approve", actor: ANA, comment: "Bonificación trimestral por cumplimiento de metas (tercer trimestre), autorizada por gerencia." },
  { month: "2026-10", employeeId: 1002, lineType: "salary", action: "approve", actor: ANA, comment: "Regreso al salario base después de la bonificación de septiembre; sin novedad." },
];
