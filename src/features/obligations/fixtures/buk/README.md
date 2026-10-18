# Mock de la API de Buk (Colombia) — FIXTURE

Datos **ficticios** de "Andina Demo S.A.S." con la forma de las respuestas de la API pública de Buk (nómina de Colombia). Dinero simulado. No es un producto ni un documento oficial de Buk: se construyó sobre su documentación pública (`https://demo.buk.cl/apidocs?country=colombia`, consultada el 2026-10-17).

## Qué hay aquí

| Ruta | Rol |
|---|---|
| `../../sources/buk/` | Adaptador: esquemas Zod de las respuestas, cliente (`auth_token`, paginación), mapper y `BukPayrollReader` + `createBukObligationSource` (implementa `src/shared/ports/obligation-source.ts`) |
| `generate.ts` | Generador determinista de `payloads/` y `expected/` (`npm run mock:generate`) |
| `payloads/<escenario>/` | Respuestas por endpoint de Buk, `webhooks/` y `_pacta/` (datos propios de Pacta, no de Buk) |
| `expected/<escenario>.json` | Oráculo por evaluación (inicial / reevaluación), con los valores de los contratos compartidos |
| `oracle-rules.ts` | Reglas de nómina de platform-core §7.1 como **oráculo de pruebas**. El motor real es de `src/features/decisions/` |
| `handler.ts` | Handler Fetch del mock; la ruta `src/app/api/mock/buk/[...path]` lo expone (solo con `PACTA_SHOW_DEV_TOOLS=true` y sesión de Clerk) |
| `scenario.ts` | `openScenario(nombre, { baseUrl?, fetch? })`: lee un escenario por archivos o por HTTP |
| `buk-mock.test.ts` | Esquema estricto por endpoint, reglas de datos de fixture, oráculo por archivos y por HTTP, hashes de evidencia |

## Uso

```bash
npm run mock:generate   # regenera payloads/ y expected/ (byte-determinista: dos corridas, cero diff)
npm run mock:verify     # vitest de src/features/obligations
```

La app usa el mismo handler en proceso (`fetch: (u, i) => handleBukMock(new Request(u, i))`); no llama a su propia ruta por red.

## Escenarios (12 escenarios, 13 evaluaciones)

`nomina-limpia`, `nomina-anomalias` (inicial 9/1/2 y reevaluación 8/1/3 tras el webhook de Laura Gómez), `trampa-plantilla-borrador`, `trampa-omision`, `trampa-duplicado`, `trampa-licencia`, `trampa-sin-historial`, `trampa-prima-sin-concepto`, `trampa-prima-otro-monto`, `trampa-liquidacion-final`, `trampa-evidencia-desactualizada`, `trampa-fondos-insuficientes`.

## Mapeo a los contratos compartidos

- Valores en inglés (`approved | blocked | requires_approval`, `salary | bonus | final_settlement`, códigos como `EMPLOYEE_TERMINATED`). La prima de servicios es una línea `bonus`.
- Importe de la línea = neto a transferir (`liquid_reach`); `components` lleva un solo componente (los haberes y descuentos no suman el neto).
- Webhooks de Buk → señales `employment_event` en estado `proposed`: solo suben la cautela.
- `occurrenceId = obligationId:periodStart`; `lineId` conserva el id de la liquidación de Buk para distinguir duplicados.
- Supuestos propios del mock (no de Buk ni de los contratos): evidencia de RR. HH. vigente 2 días (`evidenceMaxAgeDays: 2` en la plantilla del escenario; el contrato propone 7), prima = (salario base + auxilio de transporte si aplica) / 2 (fórmula simplificada y ficticia, no cálculo laboral), un empleado sin salario base no entra al dataset y su línea escala.

## Fidelidad contra la documentación de Buk

El OpenAPI generado desde el Swagger oficial y su validación con Ajv (9.807 verificaciones) siguen en el paquete original `pacta-hris-mock`; no se portaron para no sumar dependencias (`swagger-parser`, `ajv`, `yaml`) ni ~1 MB de documentación al repositorio. Aquí los payloads se validan con los esquemas Zod estrictos, que son uno a uno con ese OpenAPI. Los payloads de Buk de este directorio son **idénticos byte a byte** a los del paquete original; solo cambia `_pacta/obligation.json` (ahora es un `ObligationTemplate` compartido).

## Reglas de datos

Cuentas solo `****1234`; documentos con prefijo `999` (inválidos a propósito); correos `.example`; cada colaborador lleva `custom_attributes.pacta_fixture`. Nunca datos reales (CLAUDE.md §6.10).
