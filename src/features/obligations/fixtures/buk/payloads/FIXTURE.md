# ⚠️ FIXTURE — datos ficticios, dinero simulado

Los JSON de este directorio son **respuestas simuladas** con la forma exacta de la API de Buk (Colombia) según su documentación pública. No vienen de ningún tenant real de Buk.

- Empresa ficticia: **Andina Demo S.A.S.**; tenant ficticio `andina-demo-fixture.buk.co`.
- Personas ficticias. Cada colaborador lleva `custom_attributes.pacta_fixture` (Buk documenta `custom_attributes` como un objeto libre).
- Documentos **falsos a propósito**: 10 dígitos con prefijo `999`. Correos en `.example`. Teléfonos `300 000 xxxx`.
- Cuentas bancarias **solo** como `****1234`. Nunca un número completo.
- Montos en COP, plausibles para 2026 pero ficticios. El cálculo de nómina está simplificado (salud 4 %, pensión 4 %, FSP 1 %, sin retención en la fuente) y no es asesoría laboral.
- `_pacta/` **no** es Buk: son datos propios de Pacta (plantilla §9, fondos simulados, última cuenta y monto confirmados, calendario de beneficios, hora de cada captura).
- Se regeneran con `npm run mock:generate`.
