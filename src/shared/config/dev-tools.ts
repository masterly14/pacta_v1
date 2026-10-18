// Herramientas de prueba (simulador, factura de prueba, datos demo). Ocultas por defecto para que
// una demo no muestre controles de testing; se activan con PACTA_SHOW_DEV_TOOLS=true. Solo servidor.
export function devToolsEnabled(): boolean {
  return process.env.PACTA_SHOW_DEV_TOOLS === "true";
}
