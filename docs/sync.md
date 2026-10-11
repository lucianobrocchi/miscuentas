# Nube compartida: lo que carga uno lo ve el otro

Mis Cuentas guarda siempre los datos en el celular (localStorage), así que anda sin internet. Con la nube activada, además, cada cambio se sube a un archivo privado y los demás celulares que usan el mismo link lo reciben. No hay cuentas ni usuarios: hay **un link con una clave compartida**.

Si el link no trae la clave (o el servidor no está configurado), la app funciona exactamente como antes, solo en el celular, y no molesta con avisos.

## Qué hay en el código

| Archivo | Qué hace |
|---|---|
| `api/estado.js` | Función serverless de Vercel (Node). `GET` y `PUT` de un único documento en un Vercel Blob privado. `makeHandler({ blob, env })` recibe el Blob como dependencia: los tests usan uno en memoria. |
| `src/sync.js` | Lógica pura del cliente: captura la clave del link, decide qué subir y qué bajar, junta cambios, reintenta. Recibe `fetch`, `storage`, reloj y timers: se prueba en node. |
| `src/ui/_sync-ui.js` | Lo visible: hojas de "¿con qué datos seguís?", avisos, indicador de estado, conectar / desconectar, compartir el link. |
| `src/app.js`, `sw.js`, `src/ui/screens/mas.js`, `_mas-secciones.js`, `_hoy-logic.js`, `bienvenida.js`, `src/ui/_backup.js` | Ganchos mínimos (ver `git diff`). |
| `test/api.test.js`, `test/sync.test.js` (+ `test/_blob-double.js`, `test/_sync-harness.js`) | Pruebas. `npm test` no necesita instalar nada. |

## Lo que tenés que crear en Vercel (una sola vez)

1. **Blob privado.** En el panel de Vercel: proyecto `miscuentas` > Storage > Create > Blob > acceso **Private** > conectarlo al proyecto. Eso agrega solo la variable `BLOB_READ_WRITE_TOKEN`.
2. **Variable `MC_CLAVE`.** Proyecto > Settings > Environment Variables > nombre `MC_CLAVE`, el valor es la clave de la familia, en Production (y en Preview si querés probar). Mínimo 8 caracteres, sin espacios. Conviene que sea larga y al azar. Una forma de generarla en tu compu:
   ```
   node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
   ```
   Nadie del equipo de desarrollo necesita ver esa clave: la definís vos y se la pasás a tu familia.
3. **Volver a desplegar.** Las variables nuevas solo valen para los despliegues nuevos. El proyecto instala `@vercel/blob` desde `package.json` (dependencia `^2`).

Si falta alguna de las dos variables (o la clave tiene menos de 8 caracteres), la API contesta `503 { "error": "sin-nube", "falta": ["MC_CLAVE", ...] }` (solo nombres) y la app queda en "Sin nube configurada".

## Cómo se comparte el link

El link es `https://<tu-sitio>/#k=<la clave>`. La clave va después del `#` (fragmento): el navegador **no** la manda al servidor.

- Al abrir el link, la app guarda la clave en el celular (`localStorage`, `miscuentas.k`) y la borra de la dirección. Nunca se muestra en pantalla ni se registra.
- Para pasárselo a alguien: en **Más > Tus datos > La nube > Compartir el link con tu familia** (abre WhatsApp u otro; si no se puede, lo copia). Tratalo como una contraseña: quien lo tenga puede ver y cambiar los datos.
- **iPhone con la app instalada** (pantalla de inicio): la app instalada tiene su propio almacenamiento, separado del navegador, así que no recibe la clave de un link abierto en Safari. Solución: copiar el link del mensaje y, en la app instalada, ir a **Más > Tus datos > Conectar con el link de la familia** y pegarlo. El campo es de contraseña: la clave no se ve.
- `?k=<clave>` también se acepta, pero esa forma sí llega a los registros del servidor: usá siempre `#k=`.
- Para desconectar un celular (los datos se quedan en él): **Más > Tus datos > Desconectar este celular**.

## Qué se sincroniza

Todo el estado, **menos** las preferencias de cada dispositivo: tema, tamaño de letra, ojo de privacidad, modo de meses (4 o 12), fecha de la última copia, paso del armado y el modo ejemplo. Esas se quedan en cada celular y al recibir datos de la nube se conservan las locales. Los datos de ejemplo nunca se suben.

## Cómo se comporta

- **Primer arranque con clave.** La app consulta la nube.
  - Nube vacía y este celular con datos propios: los sube (así "se siembra" la nube al restaurar tu copia).
  - Nube con datos y este celular vacío o con el ejemplo: los baja.
  - Los dos con datos y distintos: una hoja pide elegir ("Usar los de la nube (guardados el ...)" o "Usar los de este celular (reemplazan los de la nube)"), con lo que se pierde en cada caso. Nunca se decide en silencio. Si son iguales, se unen sin preguntar.
- **Cada cambio** se sube 1,5 segundos después (si hay varios seguidos, es un solo guardado). Un cambio de tema, letra o privacidad no sube nada. Al pasar a segundo plano se sube lo pendiente enseguida.
- **Recibir:** al volver a primer plano y cada 45 segundos con la app visible se consulta (liviano: solo el número de versión). Si hay algo nuevo y no hay cambios sin subir, se aplica en silencio con el aviso "Se actualizaron los datos".
- **Los dos cambiaron cosas:** si fueron elementos distintos (por ejemplo, uno cargó un gasto y el otro un ingreso) se juntan solos ("Juntamos tus cambios con los de la otra persona."). Si los dos tocaron el mismo dato, o uno lo borró y el otro lo cambió, una hoja pregunta "Quedarme con lo de la nube" o "Quedarme con lo mío y reemplazar la nube" y dice qué se pierde. Si hay cualquier duda, pregunta.
- **No se pisa lo que estás haciendo:** si hay una hoja abierta, un campo en edición o un aviso "Deshacer" a la vista, lo que llega se aplica un poco después.
- **Sin conexión:** la app sigue andando con lo local. Los cambios quedan en cola (un solo estado pendiente: gana el último) y se reintentan a los 2, 4, 8, 16, 32 y 60 segundos (tope 60) y apenas vuelve la conexión. Si cerrás la app con algo pendiente, se sube al abrirla.
- **Borrar todo** y **Restaurar una copia** avisan "Esto cambia los datos de TODOS los que usan este link" antes de confirmar, y recién después se propagan.
- Todo lo que llega de la nube pasa por `importJSON`/`normalize` antes de aplicarse. Si no se puede leer (por ejemplo, lo guardó una versión más nueva de la app), no se toca lo local, se avisa con un mensaje amable y se puede elegir reemplazar la nube con lo de este celular.

Estados que se ven en Más > Tus datos: "Guardado en la nube", "Guardando…", "Sin conexión: se guarda en este celular y se sube cuando vuelva", "Sin nube configurada" y, solo si hace falta, "Falta elegir con qué datos seguir" o "No pudimos conectar con la nube. Revisá que el link sea el correcto."

## La API (`/api/estado`)

Siempre con `Authorization: Bearer <clave>`. Respuestas con `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.

| Pedido | Respuesta |
|---|---|
| `GET` | `200 { rev, savedAt, state }` (`rev` 0 y `state` null si no hay nada) |
| `GET ?meta=1` | `200 { rev, savedAt }` (para el control periódico) |
| `PUT { baseRev, state }` | `200 { rev, savedAt }` si `baseRev` es el `rev` actual (guarda y sube `rev` en 1); si no, `409 { rev, savedAt, state }` con lo que hay ahora |
| otro método | `405` |
| cuerpo de más de 1 MB | `413` |
| `state` sin `settings` o con listas que no son arrays; `baseRev` no entero | `400` |
| clave ausente o incorrecta | `404` genérico |
| sin `MC_CLAVE`, sin `BLOB_READ_WRITE_TOKEN` o clave de menos de 8 caracteres | `503 { error: 'sin-nube', falta: [...] }` (`falta` lista solo los nombres de las variables que faltan, nunca valores) |
| falla del almacenamiento | `502 { error: 'nube' }` (el mensaje real no se devuelve ni se registra) |

El archivo es `miscuentas/estado.json` en un Blob privado. La clave se compara en tiempo constante (hashes SHA-256 con `timingSafeEqual`). Para que dos guardados simultáneos no se pisen, la lectura va sin cache (`useCache: false`) y la escritura usa `ifMatch` con el ETag leído: si otro escribió en el medio, el Blob la rechaza y la respuesta es `409`.

## Rotar la clave

1. Generá una clave nueva y cambiá `MC_CLAVE` en Vercel; volvé a desplegar.
2. Desde ese momento la clave vieja da 404 y los celulares muestran "No pudimos conectar con la nube. Revisá que el link sea el correcto." (siguen funcionando en local, sin perder nada).
3. Mandá el link nuevo. Al abrirlo (o pegándolo en **Conectar con el link de la familia**) cada celular guarda la clave nueva. Como los datos ya coinciden con los de la nube, se unen sin preguntar.

Si el link se filtró, rotar la clave corta el acceso, pero no borra lo que ya vio quien lo tenía.

## Seguridad y privacidad

- El archivo está en un Blob privado: no tiene URL pública. Solo la función con la clave lo lee o lo escribe.
- Los datos viven en los servidores de Vercel sin cifrado de extremo a extremo: quien administre el proyecto de Vercel puede verlos. La clave en el celular está en `localStorage`, sin cifrar.
- No hay limitación de intentos en la función. Con una clave larga y al azar no importa; si querés más defensa, se puede agregar una regla de rate limit en el Firewall de Vercel para `/api/estado`.
- El service worker no cachea nada de `/api/`: va siempre por la red.
- Los tests y los ejemplos usan claves de prueba ilustrativas; no hay ninguna clave ni dato real en el repo.

## Límites conocidos

- No es en tiempo real: lo que cargás llega a los demás en hasta 45 segundos con la app abierta (o al volver a abrirla).
- Un solo documento y sin historial: si alguien elige "reemplazar la nube", lo anterior se pierde. La copia de seguridad (Más > Copia de seguridad) sigue siendo la red de seguridad.
- Todos los que tienen el link tienen los mismos permisos. No hay usuarios ni "quién cambió qué".
- El juntar automático es conservador: si dos celulares tocan el mismo dato, o una persona se borra mientras el otro carga datos, pregunta.
- Algunos datos los escribe la app sola (lo ya mostrado, la proyección del mes). Pueden hacer que el otro celular muestre "Se actualizaron los datos" sin que nadie haya cargado nada. Si dos celulares fijan la proyección del mismo mes, queda la de la nube.
- Si el celular tiene la clave pero la app instalada no (iPhone), hay que pegar el link a mano (ver arriba).
- El navegador muestra en la consola un `409` rojo cuando dos celulares chocan: es normal, así la app se entera del conflicto.
- Cada control periódico es una invocación de la función y una lectura del Blob. Con la app oculta no se consulta. Revisá los límites del plan de Vercel si se suman muchos celulares.

## Probar de punta a punta sin Vercel

`npm test` ya cubre la API (con un Blob en memoria) y el cliente (dos o más celulares simulados, reloj falso, sin conexión, conflictos). Para ver la app contra el handler real en el navegador, se puede levantar un servidor de Node que sirva los archivos y llame a `makeHandler({ blob: makeBlobDouble(), env: { MC_CLAVE: '...', BLOB_READ_WRITE_TOKEN: 'x' } })` en `/api/estado` (ver `test/_blob-double.js`), y abrir dos perfiles del navegador con el mismo link.
