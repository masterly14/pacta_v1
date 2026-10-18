/**
 * Umbrales del aprendizaje histórico. Se fijaron ANTES de la primera corrida del backtest y no se ajustan para que una
 * métrica salga bien: cambiarlos exige una razón escrita aquí y repetir el backtest.
 * Todo es entero: importes en unidades menores, razones en puntos básicos.
 */

/** Con menos observaciones no hay perfil: rige solo la regla fija de tolerancia. */
export const MIN_OBSERVATIONS = 3;

/** Las últimas N observaciones definen la línea base (mediana). */
export const BASELINE_WINDOW = 6;

/** Una desviación mayor que K unidades de escala robusta del perfil escala la línea. */
export const K_ROBUST = 4;

/** La escala robusta nunca baja de este porcentaje de la línea base (100 bps = 1 %): un salario fijo no tiene escala cero. */
export const SCALE_FLOOR_BPS = 100;

/** Factor que convierte la MAD en una desviación estándar equivalente (1,4826), en diezmilésimas. */
export const MAD_TO_SIGMA_X10000 = 14_826;

/** Un cambio de nivel necesita este número de observaciones consecutivas consistentes. */
export const LEVEL_SHIFT_RUN = 2;

/** Un concepto es recurrente si se repite con una cadencia estable (fracción mínima de intervalos iguales, en %). */
export const CADENCE_STABILITY_PCT = 60;
