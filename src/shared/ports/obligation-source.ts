import type { FiscalDataset, FiscalItem, ObligationTemplate, PayrollDataset, PayrollEmployee } from "../schemas/obligation-config";
import type { ObligationContext, ObligationPeriod } from "../schemas/obligation-context";

// Puerto de la fuente configurada (plantilla + dataset). No lee correo ni llama al LLM.
// `getFacts` devuelve un solo hecho. Si la referencia es ambigua, devuelve null.

export type ConfiguredCounterpartyFact =
  | { kind: "payroll"; employee: PayrollEmployee }
  | { kind: "fiscal"; item: FiscalItem };

export type ObligationSource = {
  generateLines(template: ObligationTemplate, dataset: PayrollDataset | FiscalDataset, period: ObligationPeriod, asOf: string): ObligationContext[];
  getFacts(counterpartyRef: string, asOf: string): ConfiguredCounterpartyFact | null;
};
