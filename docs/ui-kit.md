# Kit de UI de Mis Cuentas 2.0

Guía para quien escribe pantallas (`src/ui/screens/*.js`) y editores (`src/ui/editors.js`). Describe la API **exacta** de lo que existe en `src/app.js`, `src/ui/*.js` y `styles/*.css`. No hace falta leer el código del kit para usarlo.

Todos los ejemplos usan datos inventados (Vos, Pareja, Hija, Hijo; cifras redondas). Para ver cada componente en vivo, claro y oscuro, abrí la galería: `python3 -m http.server 8100` y entrá a `http://localhost:8100/dev/kit.html` (parámetros: `?theme=dark`, `?fs=grande` o `?fs=masgrande`, `?privacy=1`).

## Índice

1. [Cómo se arma una pantalla](#1-cómo-se-arma-una-pantalla)
2. [`ctx`: todo lo que recibe una pantalla](#2-ctx-todo-lo-que-recibe-una-pantalla)
3. [Reglas duras de la interfaz](#3-reglas-duras-de-la-interfaz)
4. [Rutas y navegación](#4-rutas-y-navegación)
5. [Componentes (`ctx.ui`)](#5-componentes-ctxui)
6. [Campos de formulario (`ctx.ui.fields`)](#6-campos-de-formulario-ctxuifields)
7. [Hojas, confirmaciones y toasts](#7-hojas-confirmaciones-y-toasts)
8. [Gráficos (`ctx.charts`)](#8-gráficos-ctxcharts)
9. [Utilidades de `dom.js`](#9-utilidades-de-domjs)
10. [Clases CSS](#10-clases-css)
11. [Íconos](#11-íconos)
12. [Recetas](#12-recetas)
13. [Lista de control antes de entregar una pantalla](#13-lista-de-control-antes-de-entregar-una-pantalla)

---

## 1. Cómo se arma una pantalla

Cada archivo `src/ui/screens/<nombre>.js` exporta por defecto un objeto:

```js
export default {
  id: 'hoy',
  title: 'Hoy',                       // string, o (ctx, params) => string. Va a <title> y a la barra superior
  async mount(root, ctx, params, route) {
    // root: un <div class="screen"> vacío (flex en columna, gap 12px). Llenalo.
    // params: { key } en #/meses/2026-12 · { personId } · { sec } · { step } (ver §4). route.query = { pagar: '1' } para #/...?pagar=1
    root.append(ctx.ui.pageTitle('Hoy'));
    return () => { /* unmount opcional: limpiar timers, listeners globales */ };
  },
};
```

- `mount` puede ser `async`. Si tira un error, la app muestra "Algo no salió como esperábamos" con botón "Probar de nuevo" (no se rompe).
- Si el archivo todavía no existe, la app muestra "Esta pantalla se está construyendo" (no se rompe).
- **Re-render:** cada vez que el estado cambia (`ctx.update`, `ctx.setPrivacy`) o se llama `ctx.rerender()`, app.js vuelve a llamar `unmount()` y `mount()` con un `root` nuevo y conserva el scroll. Por eso `mount` tiene que ser una función **pura del estado**: leé `ctx.state` adentro, no guardes referencias viejas.
- Las pantallas **no** tocan `document.body`, `#tabbar` ni `#topbar` directamente: usan `ctx.header()`, `ctx.setBadges()` y `ctx.screenMode()`.
- Pantalla mínima:

```js
export default {
  id: 'meses', title: 'Meses',
  mount(root, ctx) {
    const { ui, derive, state } = ctx;
    ctx.header({ title: 'Los próximos meses' });
    root.append(ui.pageTitle('Los próximos meses', 'Lo que te sobra cada mes.'), ui.btn({ label: 'Ver tarjeta', onClick: () => ctx.nav('#/deudas/tarjeta') }));
  },
};
```

## 2. `ctx`: todo lo que recibe una pantalla

| Miembro | Qué es |
|---|---|
| `ctx.state` | **getter** del estado v2 actual (nunca lo mutes: usá `update`). |
| `ctx.update(fn, { undoLabel, rerender = true, onUndo })` | Aplica `fn(borrador)` sobre una copia del estado, guarda en localStorage y re-renderiza. `fn` muta el borrador o devuelve un estado completo. Con `undoLabel` muestra un toast con **Deshacer** (6 s) que restaura el estado anterior. Devuelve el estado nuevo. |
| `ctx.derive` | El módulo `src/derive.js` (ver `docs/derive-api.md`): `ctx.derive.hero(ctx.state, ctx.today())`. |
| `ctx.format` | El módulo `src/format.js`: `money`, `compact`, `monthName`, `longDate`, `plural`, `parseMoney`, fechas. Para textos y fechas. |
| `ctx.nav(hash, { replace })` | Navega (`'#/meses/2026-12'`). **Async**: si hay hojas abiertas las cierra primero. Se puede llamar desde adentro de una hoja. |
| `ctx.back(fallbackHash)` | Vuelve una pantalla; si no hay historial propio, va a `fallbackHash`. |
| `ctx.sheet` | El módulo `sheet.js` (§7): `open`, `confirm`, `info`, `openRoute`, `closeAll`. |
| `ctx.toast(msg, opts)` | §7. |
| `ctx.ui` | Todos los componentes de §5, más `ctx.ui.fields` (§6), `ctx.ui.h`, `ctx.ui.icon`, `ctx.ui.fmt`. |
| `ctx.charts` | Gráficos de §8. |
| `ctx.editors.open(kind, id, opts)` | **Async**, carga `src/ui/editors.js` bajo demanda. Devuelve una Promise. `kind`: `'ingreso'`, `'gasto'`, `'cuota'`, `'deuda'`, `'persona'`, etc. (los define `editors.js`). |
| `ctx.today()` | `Date` de "hoy" (inyectable con `?hoy=2026-10-04` en la URL para pruebas). **Siempre** usá esto, nunca `new Date()`. |
| `ctx.header(cfg)` | Barra superior de la pantalla: `{ eyebrow, title, back, actions }`. `back: true` = botón Volver al padre de la ruta; `back: '#/deudas'` = a esa ruta; `ctx.header(false)` oculta la barra. |
| `ctx.setBadges({ mas: true, deudas: false })` | Punto ámbar sobre "Más" / "Deudas" en la barra inferior. Solo si faltan datos que cambian el resultado. |
| `ctx.screenMode(name)` | Pone `body[data-screen]` (ej. `'revelacion'` para el fondo oscuro de la Revelación). `screenMode(null)` vuelve al de la ruta. |
| `ctx.rerender()` | Vuelve a montar la pantalla sin cambiar el estado. |
| `ctx.isPrivate()` / `ctx.setPrivacy(bool)` | Ojo de privacidad. |
| `ctx.route()` | Ruta actual `{ name, screen, tab, params, query, hash, notabs }`. |
| `ctx.version` | `'2.0.0'`. |

El **encabezado por defecto** lo pone app.js antes de `mount`: título de la ruta (en Hoy queda vacío) y botón Volver si la ruta es hija (`#/deudas/tarjeta`, `#/deudas/medeben/<id>`, `#/mas/<sec>`). Solo llamás `ctx.header()` para personalizarlo (en Hoy: fecha y saludo).

## 3. Reglas duras de la interfaz

Los tests (`test/a11y-lint.test.js`, `test/contrast.test.js`) fallan si las rompés.

1. **Letra mínima 16px (1rem)** en CSS, JS y atributos SVG. Nada de `font-size: 0.9rem`. Usá las clases `t-*` (§10).
2. **Cero colores literales** (`#fff`, `rgb()`): solo variables (`var(--ink)`) o clases del kit.
3. **Sin emojis.** Solo los íconos del sprite (§11).
4. **Nada de `confirm()` / `alert()` / `prompt()`:** usá `ctx.sheet.confirm()`.
5. **Campos numéricos:** nunca `type="number"` ni `step`. Usá `fields.money` / `ui.moneyInput` (`inputmode`, coma o punto).
6. **Privacidad (el ojo):** todo monto se muestra con `ui.amt(n)` y todo nombre de persona con `ui.personName(nombre, indice)`. Los textos que pasás como **string** a cualquier componente del kit (títulos, detalles, botones, toasts, hojas) ya pasan por `ui.txt()`, que protege los `$1.234` y los nombres conocidos que haya adentro (así las frases que arma `derive` también se ocultan). Si armás un nodo a mano con `h()`, envolvé el string: `h('p', null, ui.txt(frase))`.
7. **Estado = palabra + forma + color**, nunca solo color: usá `ui.status(code)` (§5.3).
8. **Voseo rioplatense**, sin las palabras: "colchón", "plástico", "financiación", "moroso", "liberás" (decí "queda libre"), "5 minutos"; "Justo" se dice "Ajustado".
9. **Toques:** botones y filas ≥ 48px (los componentes ya lo cumplen).
10. **Hojas de decisión** llevan el pie `ui.disclaimer()`: "Es una estimación con los datos que cargaste. No es asesoramiento financiero."
11. **Máximo 2 toques** desde Hoy a cualquier detalle. Todo gesto (swipe) tiene botón visible equivalente.

Importaciones desde una pantalla (`src/ui/screens/x.js`): `import { h, debounce, on, announce, vibrate } from '../dom.js';` (lo básico ya viene en `ctx.ui`).

## 4. Rutas y navegación

Router por hash. Tabla en `src/app.js` (`ROUTES`). `ctx.nav('#/…')` o un `<a href="#/…">`.

| Hash | Pantalla (`src/ui/screens/…`) | `params` | Pestaña activa |
|---|---|---|---|
| `#/hoy` | `hoy.js` | — | Hoy |
| `#/meses` · `#/meses/2026-12` | `meses.js` | `key` opcional (`'2026-12'`) | Meses |
| `#/puedo` | `puedo.js` | — | ¿Me alcanza? |
| `#/deudas` | `deudas.js` | — | Deudas |
| `#/deudas/tarjeta` | `tarjeta.js` | — | Deudas (hija, Volver a `#/deudas`) |
| `#/deudas/medeben` · `#/deudas/medeben/<personId>` | `medeben.js` | `personId` opcional | Deudas (con `personId`, Volver a `#/deudas/medeben`) |
| `#/mas` · `#/mas/<sec>` | `mas.js` | `sec` opcional | Más |
| `#/bienvenida` | `bienvenida.js` | — | sin barras |
| `#/armar/<1-7>` | `onboarding.js` | `step` (string `'1'`…`'7'`) | sin barras |

- Ruta desconocida → `#/hoy` (o `#/bienvenida` si no hay datos).
- Se pueden agregar parámetros de consulta: `#/deudas/medeben/ab12?pagar=1` → `route.query.pagar === '1'` (4.º argumento de `mount`).
- "Atrás" del celular funciona porque cada pantalla es una entrada de historial.
- Bienvenida y Armar ocultan la barra inferior y la superior (traen su propio encabezado).
- **Hoja de ruta** (ej. detalle de un mes en `#/meses/2026-12`): usá `ctx.sheet.openRoute(clave, opts)` desde `mount` cuando `params.key` existe (§7.4). Es idempotente y se cierra sola al cambiar de ruta.
- Escritorio (≥1024px): atajos de teclado `1`–`5` van a los 5 destinos (si no hay foco en un campo ni hoja abierta).

## 5. Componentes (`ctx.ui`)

Todos devuelven **Elements** (nunca strings de HTML). Los parámetros `string` pasan por `ui.txt()` (privacidad). `tone`: `'ok' | 'warn' | 'bad' | 'info' | 'brand' | 'neutral'` (también aceptan los códigos de derive: `bien`, `justo`, `falta`, `estimado`, etc.).

### 5.1 Montos y nombres

```js
ui.amt(value, { compact=false, plus=false, symbol=true, cls, text })      // Element <span.amt>
ui.amt(105948)                       // $105.948
ui.amt(-342688)                      // −$342.688  (signo menos real)
ui.amt(106000, { compact: true })    // 106 mil
ui.amt(5000, { plus: true })         // +$5.000
ui.personName(name, index = 0)       // <span.pname>: con el ojo se ve "Persona {index+1}"
ui.aliasName(name, index)            // string plano (toasts, aria-label): alias si hay privacidad
ui.txt(text)                         // string -> string | Node[] con $montos y nombres protegidos
ui.setKnownNames(state.people)       // lo llama app.js solo; role 'yo' no se oculta
ui.srMoney(n)                        // '105948 pesos' | 'menos 342688 pesos' | 'monto oculto'  (para aria-label)
ui.fmt.money(n, { plus, symbol }) · ui.fmt.compact(n) · ui.fmt.pct(6.493) -> '6,49%' · ui.fmt.plural(n,'mes','meses')
ui.fmt.parseMoney('1.290,50') -> 1291 · ui.fmt.parseDecimal('6,49') -> 6.49   // tolerante: coma o punto
```

Ejemplo (frase con monto): `h('p', null, 'Te sobran ', ui.amt(82000), ' este mes')`.
Para precios dentro de una frase que viene de `derive`, alcanza con pasar el string: `ui.notice({ title: hero.aviso.texto })`.

### 5.2 Íconos, chips

```js
ui.iconTile(name, tone = 'brand', { size })       // cuadro 44x44 (size:'lg' = 56) con fondo del tono. Ej: ui.iconTile('tarjeta','warn')
ui.chip(label, { tone='neutral', icon, onHero=false, cls })        // chip de lectura 28px. ui.chip('estimado',{tone:'info'})
ui.chipButton(label, { selected=false, onClick, icon, value, disabled, ariaLabel, tone, cls })   // chip seleccionable, alto táctil 48px, aria-pressed
```

### 5.3 Estados (forma + palabra + color)

```js
ui.status(code, { label, onHero=false, cls })     // chip 32px con forma y palabra
ui.status('bien')                                  // "Alcanza"   (círculo con tilde, verde)
ui.status('justo')                                 // "Ajustado"  (cuadrado, ámbar)      también 'cubierto'
ui.status('falta')                                 // "Falta plata" (triángulo, terracota)
ui.status('provisorio') / 'estimado' / 'pendiente' // "Provisorio" / "Estimado" / "Falta un dato" (rombo, azul)
ui.status('verde'|'ambar'|'terracota')             // veredicto de ¿Me alcanza?: "Sin costo" / "Con costo" / "No conviene"
ui.status('warn', { label: 'Alcanza, ojo con enero' })   // tono ámbar con texto propio (así lo usa derive.hero().chip)
ui.statusGlyph(code)                               // solo la forma (con aria-label), para el mapa de meses
ui.legend([{ code:'verde' }, { code:'ambar' }, { code:'terracota' }])   // leyenda fija en palabras
```
`ui.statusInfo(code)` devuelve `{ tone, shape, label }`; `ui.STATUS` es la tabla. Sobre el hero usá `onHero: true`.

### 5.4 Botones y enlaces

```js
ui.btn({ label, icon, iconRight, variant='primary', onClick, href, inline=false, disabled=false, type='button', ariaLabel, cls, dataset, autofocus })
// variant: 'primary' (56px, relleno) | 'secondary' (56px, contorno) | 'text' (48px) | 'ghost' (48px gris) | 'danger' (56px terracota)
//          | 'onhero' (blanco sobre fondo pino) | 'onhero-ghost'
// Ocupa todo el ancho; { inline:true } lo ajusta al contenido. Con href es un <a>.
ui.btn({ label: 'Anotar $50.000', onClick: guardar })
ui.btn({ label: 'Mandarle la cuenta por WhatsApp', variant: 'secondary', icon: 'whatsapp', onClick })
ui.iconButton({ icon, label, onClick, pressed, cls })      // 48x48, label = aria-label (obligatorio)
ui.link({ label, href, onClick, icon, cls })               // "Ver todo", 48px de alto
ui.fab({ label: 'Agregar', icon: 'mas', onClick })         // botón flotante a la derecha, sobre la barra
```

### 5.5 Tarjetas y bloques

```js
ui.card(children, { pad='md'|'sm'|'none', tone, as='section', cls, ariaLabel })   // blanca, radio 24. tone: ok|warn|bad|info = fondo del estado
ui.sectionTitle(title, { label, href, onClick } | null, { level=2, cls })          // "Lo que vence" + "Ver todo"
ui.pageTitle(title, sub)                                                           // h1 30/36 + bajada
ui.footnote(text)                                                                  // 16px --ink-3
ui.disclaimer()                                                                    // pie obligatorio de hojas de decisión
ui.kv([{ label, value, tone, strong, hint }], { cls })                             // lista etiqueta/valor (<dl>)
ui.stat({ label, value, valueClass='display', sub, chips, tone, cls })             // dato destacado; valueClass: display(44) | big(32) | date(26) | h1
ui.disclosure({ summary='Ver los números', content, open=false })                  // <details>
ui.dataTable({ caption, head:['Mes','Deuda'], rows:[['Oct', ui.amt(1)]] })         // tabla accesible
ui.pill('Sin internet no pasa nada: todo está guardado en tu celular.')            // pastilla gris
ui.ribbon({ text, actionLabel, onClick })                                          // cinta ámbar (la del ejemplo la pone app.js sola)
```

Ejemplo "Total del último resumen" (3 líneas):
```js
root.append(ui.card(ui.stat({ label: 'Total del último resumen (septiembre)', value: ui.amt(1800000),
  sub: 'Interés que se suma por mes: $116.820', chips: [ui.chip('Cierra el 1', { tone: 'info' }), ui.chip('6,49% por mes', { tone: 'warn' })] })));
```

### 5.6 Filas (72px) y listas

```js
ui.row({ icon, tone='brand', title, sub, value, valueSub, chip:{label,tone,icon}, onClick, href, size='md'|'lg', valueClass:'big'|'date', pending=false, chevron, ariaLabel, cls, dataset })
ui.rowList([row, row, ...], { cls, ariaLabel })      // contenedor blanco con líneas finas, role=list
```
- Con `onClick`/`href` la fila es un botón/enlace con chevron (`chevron:false` lo saca).
- `value` / `title` / `sub` aceptan string o Node. `valueClass:'big'` = número 32px (Para gastar hoy); `'date'` = 26px en dos líneas ("abril 2027").
- `chip` sin `value` se ubica debajo del texto (ej. "Completar"). `pending:true` = borde punteado azul de "dato pendiente".
- El detalle (`sub`) usa el ancho completo cuando hay solo `value`; las filas crecen en alto si el texto es largo (el mínimo es 72px). A 360px, `big`/`date` bajan debajo del texto.
```js
root.append(ui.rowList([
  ui.row({ icon: 'tarjeta', tone: 'warn', title: 'Visa · 13 de octubre', sub: 'En 9 días · mínimo de tu resumen', value: ui.amt(270000), onClick: () => ctx.nav('#/deudas/tarjeta') }),
  ui.row({ icon: 'documento', tone: 'info', title: 'Plan de pagos de AFIP', sub: 'Falta cargar monto y cuotas', chip: { label: 'Completar', tone: 'info' }, pending: true, onClick: abrir }),
]));
```

### 5.7 Segmentado y opciones (radios reales)

```js
ui.segmented({ options:[{value,label,icon}], value, onChange:(v)=>..., ariaLabel, name, cls })   // 52px. el.value (get/set), el.setValue(v)
ui.segmented({ options: [{ value: '4', label: '4 meses' }, { value: '12', label: '12 meses' }], value: ui.pref.get('mesesMode', '4'), onChange: (v) => ui.pref.set('mesesMode', v) })

ui.optionGroup({ options:[{ value, title, sub, end, tag, tagTone }], value, onChange, name, ariaLabel, cls })   // opciones de 72/88px (cuánto pagar, cómo cubrir enero)
ui.optionGroup({ name: 'pago', value: 'sobra', ariaLabel: 'Cuánto pagar', options: [
  { value: 'min', title: 'Solo el mínimo', sub: 'Salís en junio 2027', end: ui.amt(270000) },
  { value: 'sobra', title: 'Lo que sobra', sub: 'Salís en abril 2027', end: ui.amt(352000), tag: 'Recomendado' }] })

ui.monthMap({ items:[{ key, label:'Dic', state:'verde'|'ambar'|'terracota'|null, ariaLabel }], value, onChange:(key)=>..., ariaLabel })  // mapa de meses de ¿Me alcanza?
//   state null = "calculando" (círculo punteado). el.setItems(items, valorActual), el.setValue(key). Con ui.legend(...) debajo.
```
`ui.pref.get(clave, defecto)` / `ui.pref.set(clave, valor)` guardan preferencias de vista en localStorage (con try/catch).

### 5.8 Campo de dinero suelto, stepper

```js
ui.moneyInput({ value, onChange:(n|null)=>..., kind='money'|'rate'|'int', big=false, name, id, ariaLabel, ariaDescribedby, max=999999999, placeholder, autofocus, onEnter, suffix, invalid })
```
Devuelve un `<div.money>` con `.input` (el `<input>`), `.getValue()`, `.setValue(n)`, `.focus()`, `.setInvalid(bool)`.
- `kind:'money'` (por defecto): `$` delante, puntos de miles mientras se escribe (`1234567` → `1.234.567`), `inputmode="numeric"`, tope de 9 dígitos. Al **pegar** texto se lee con `parseMoney` (acepta `$ 1.234.567,50`).
- `kind:'rate'`: decimales con coma o punto (`6,49` / `6.49`), `inputmode="decimal"`, sufijo `%`.
- `kind:'int'`: solo dígitos sin `$` (días, cuotas).
- **Nunca** lleva `step`. Para formularios usá `fields.money` (trae etiqueta, ayuda y error): §6.

```js
ui.stepper({ value=0, min=0, max=999, step=1, onChange:(n)=>..., ariaLabel, unit, format, id })   // − [valor] + ; botones 72x56; el.getValue() / el.setValue(n)
ui.stepper({ value: 10, min: 1, max: 60, unit: 'cuotas', ariaLabel: 'Cuotas que faltan', onChange: (n) => { cuotas = n; } })
```

### 5.9 Avisos, vacíos, hitos, glosario

```js
ui.notice({ tone='info', title, text, action:{label,onClick,href}, icon, dashed=false, role, cls })
//  tone: warn (ámbar) | info (azul) | ok | bad | brand.  dashed:true = borde punteado azul "Falta un dato".
ui.notice({ tone: 'warn', title: 'Ya cerró el resumen de septiembre', text: 'Cargalo para ver el monto exacto.', action: { label: 'Cargar resumen nuevo', onClick: abrir } })

ui.empty({ title, text, action:{label,onClick,href,icon}, secondary:{label,onClick,href}, art='barras', cls })
//  art: 'barras' | 'tarjeta' | 'personas' | 'lista' | 'obra'. UN botón principal de 56px; el secundario es de texto.
ui.empty({ title: 'Nadie te debe plata', text: 'Si alguien te debe, anotalo y vemos cuándo te la devuelve.', art: 'personas', action: { label: 'Anotar una deuda', onClick } })

ui.milestone({ title, text, action:{label,onClick}, secondary:{label,onClick,icon} })      // hito sobrio (ícono llave sobre fondo ok)

ui.glossary(term, { label='Qué es esto', cls })     // botón que abre la hoja del término. term: 'pagoMinimo' | 'saldoActual' | 'interesMensual' | 'estimado' | 'provisorio' | 'planilla' | 'neto'
ui.openGlossary(term | { title, body:[párrafos] })  // abre la hoja directo
ui.GLOSSARY                                         // tabla de términos: se puede ampliar
```

### 5.10 Barras y progreso

```js
ui.divergingScale(values)                            // máximo común para barras divergentes (positivos 75%, negativos 25%)
ui.divergingBar({ value, max, tone='ok', estimated=false, cls })    // 16px; cero al 25%; estimado = borde punteado
ui.progressBar({ value, max=100, tone='brand', label, dashed=false, cls })      // role=progressbar
ui.progressSteps({ total=7, current=0, label })      // 7 segmentos de 6px (onboarding)
ui.ring({ value, total, label, size=88 })            // anillo "4 de 7"
ui.pips({ total, paid=0, ariaLabel, cls })           // puntos de cuotas (el actual lleva anillo); si total > 12 muestra barra
ui.pips({ total: 36, paid: 26 })                     // 26 de 36 pagas; la 27 es la actual
```

### 5.11 Hero de Hoy

```js
ui.hero({
  label,                          // "Va a la tarjeta este mes" · "Te faltan este mes" · "Te sobran en octubre"
  value,                          // número (con signo). Alternativa: valueText:'—'
  status, statusLabel,            // chip de estado (código o tono) y su texto propio
  caption,                        // "Esa plata va a pagar la tarjeta"
  note: { text, onClick },        // "Incluye 3 datos estimados" (tocable)
  aviso: { icon, text, onClick }, // botón-aviso de 48px: "Ojo con enero: faltan $342.688"
  strip,                          // tira de meses (ver charts.monthStrip). Acepta la tira de derive.hero().tira tal cual
  stripOptions,                   // { showValues, onHero, barWidth }
  onOpen,                         // al tocar el número (ej. () => ctx.nav('#/meses/2026-10'))
  ariaLabel, countKey='hero', cls
})
```
El número es lo más grande de la app (40–56px), cuenta de 0 a su valor en 600 ms **solo la primera vez por sesión** (no con `prefers-reduced-motion`) y baja de tamaño solo si no entra (`fitText`). Con el ojo se ve `••••` en el mismo tamaño.

Receta desde `derive.hero` (campos reales de `docs/derive-api.md`):
```js
const hero = ctx.derive.hero(ctx.state, ctx.today());
if (hero.estado !== 'ok') return root.append(ui.empty({ title: hero.texto, action: { label: hero.accion.texto, onClick: () => ctx.nav(hero.accion.ruta) } }));
root.append(ui.hero({
  label: hero.rotulo, value: hero.numero, status: hero.chip.tone, statusLabel: hero.chip.texto, caption: hero.subtitulo,
  note: hero.estimados.n ? { text: `Incluye ${hero.estimados.n} datos estimados`, onClick: () => ctx.nav('#/mas') } : null,
  aviso: { icon: hero.aviso.accion ? 'alerta' : 'tilde', text: hero.aviso.texto, onClick: hero.aviso.accion ? () => ctx.nav('#/meses/' + hero.aviso.key) : undefined },
  strip: hero.tira, onOpen: () => ctx.nav('#/meses/' + hero.mes) }));
```
(El chip nunca es verde puro si hay datos pendientes o un mes futuro en falta: `derive` ya lo decide y manda `tone: 'warn'`.)

### 5.12 ¿Me alcanza?

```js
ui.verdict({ code:'ambar'|'verde'|'terracota', title, text, rows:[{label,value,strong,tone}], footer, cls })   // role=status aria-live=polite, borde izquierdo de 6px
ui.verdict({ code: 'ambar', title: 'Se puede, pero tiene costo', text: 'Un viaje de $300.000 en diciembre te sale $385.000.', rows: [{ label: 'Interés extra', value: ui.amt(85000), strong: true }], footer: ui.disclaimer() })
ui.monthMap(...)     // §5.7
ui.legend(...)       // §5.3
```

### 5.13 Onboarding y bienvenida

```js
ui.stepShell({ step, total=7, stepLabel, question, help, content:[nodos], reward:{text}, onBack, onSkip, skipLabel='Seguir después',
               primary:{label,onClick,disabled,icon}, secondary:{label,onClick}, extra, cls })
```
Cáscara de un paso: barra de 7 segmentos, Volver / "Seguir después", "Paso 2 de 7 · Lo que cobrás", pregunta 32/38, ayuda, contenido, recompensa verde (con tilde) y botones pegados abajo. `content` suele ser `[campo.el]` de `ui.fields`.
```js
const sueldo = ui.fields.money({ label: 'Sueldo neto por mes', value: s.sueldo, name: 'sueldo', help: 'neto', required: true });
root.append(ui.stepShell({ step: 2, stepLabel: 'Lo que cobrás', question: '¿Cuánto cobrás de sueldo por mes?', content: [sueldo.el],
  primary: { label: 'Seguir', onClick: () => sueldo.validate() && guardar(sueldo.get()) }, secondary: { label: 'No lo sé todavía', onClick: saltear }, onBack: () => ctx.back('#/armar/1') }));
```

```js
ui.welcome({ mark=true, title:['Tu plata,','clara.'], lead, bullets:[{icon,text}], children, actions:[btn...], footLink:{label,onClick}, cls })
```
Pantalla oscura a pantalla completa (Bienvenida y Revelación). Los botones llevan `variant: 'onhero'` / `'onhero-ghost'`. El fondo pino con brillo lo pone `body[data-screen="bienvenida"|"revelacion"]` (la ruta `#/bienvenida` ya lo activa; para la Revelación llamá `ctx.screenMode('revelacion')`). Frases que aparecen en orden: `<div class="reveal-phrases"><p class="reveal-phrase" style="--i:0">…</p>…</div>`.

## 6. Campos de formulario (`ctx.ui.fields`)

Los usan **igual** el onboarding y los editores (un solo código). Todos devuelven un controlador:

```js
{ el, name, get(), set(v), setError(msg|null), clearError(), validate() -> boolean, focus(), onChange(fn), input? }
```
- `el` es el Node que se agrega a la pantalla u hoja. La etiqueta va **siempre arriba** (nunca el placeholder como etiqueta), la ayuda abajo (16px) y el error en lenguaje de casa con ícono.
- Opciones comunes: `label`, `hint` (ayuda debajo), `help` (término del glosario: agrega "Qué es esto"), `helpLabel`, `name`, `required`, `requiredMsg`, `validate:(v)=>string|null`, `onChange`.
- `validate()` marca el error en el propio campo y devuelve `false`. `validateAll(lista)` valida todos, enfoca el primero con error y devuelve `true` si todo está bien. `collect(lista)` arma `{ name: valor }`.

```js
fields.money({ label, value, hint, help, onChange, big=true, name, required, requiredMsg, max, placeholder, autofocus, validate, onEnter })   // get() -> number | null
fields.rate({ label:'Interés por mes', value:6.49, help:'interesMensual' })      // decimal con coma o punto, sufijo %
fields.int({ label, value })                                                      // entero sin $ ni puntos
fields.text({ label, value, hint, name, maxLength, required, autocomplete, placeholder, multiline, rows, onEnter })   // get() -> string
fields.textarea({ label, value, rows })                                           // texto largo (mensaje de WhatsApp editable)
fields.date({ label, value:'2026-10-04', min, max })                              // selector nativo; get() -> 'YYYY-MM-DD' | null
fields.stepper({ label, value, min, max, step, unit, hint, format })              // − [n] + ; get() -> number
fields.toggle({ label, hint, value=false, name, onChange })                       // interruptor (role=switch); get() -> boolean
fields.choice({ label, options:[{ value, label, sub?, end?, tag? }], value, variant:'segmented'|'options'|'chips', onChange })   // get() -> el valor ORIGINAL (boolean/null/number/string)
fields.monthChips({ label, options, value, multi=false, allowEmpty=false, onChange })   // chips de mes; multi:true -> get() devuelve array
fields.person({ label='¿De quién es?', people:[{id,name}], value, allowNone, noneLabel, onChange })   // chips de personas; get() -> id | null
fields.group({ legend, children:[campo.el...], cls })                             // <fieldset> con título
fields.monthRange('2026-10', 12)  -> [{ value:'2026-10', label:'Oct 26' }, ...]   // opciones para monthChips
fields.MONTHS_OF_YEAR             -> [{ value:1, label:'Ene' }, ... { value:12, label:'Dic' }]
```

Ejemplos:
```js
// Sí / No / No sé (tres botones grandes)
const neto = fields.choice({ label: '¿Ese sueldo ya tiene restados los descuentos?', variant: 'options', value: null, help: 'neto',
  options: [{ value: true, label: 'Sí, ya están restados' }, { value: false, label: 'No, hay que restarlos' }, { value: null, label: 'No sé' }] });
// Validar al guardar
const campos = [sueldo, cuotas]; if (!fields.validateAll(campos)) return;
```
Validaciones amables sugeridas: sueldo > 20.000.000 → `'Mirá bien los ceros, por favor.'`; tasa > 15 → `'79% parece la tasa anual. ¿Usamos 6,49% por mes?'`.

## 7. Hojas, confirmaciones y toasts

### 7.1 `ctx.sheet.open(opts)`

Hoja inferior en celular; diálogo centrado de 560px en escritorio (≥1024px). Usa `<dialog>`: foco atrapado, foco devuelto al disparador, Esc / toque en el fondo / botón **Cerrar** (siempre visible) / swipe del handle cierran, y el botón **Atrás del celular cierra la hoja** sin salir de la pantalla.

```js
const hoja = ctx.sheet.open({
  title: 'Para gastar hoy',                    // obligatorio (accesibilidad)
  render(body, close) { body.append(...) },    // llena el cuerpo (scroll interno). close(resultado) cierra
  footer: (close, handle) => [ui.btn({ label: 'Guardar', onClick: () => close() }), ui.btn({ label: 'Cancelar', variant: 'text', onClick: () => close() })],   // barra fija (Node, array o función)
  onClose(resultado) {},                       // al cerrar por cualquier camino
  size: 'auto' | 'tall',                       // tall = 85% de alto (detalle de un mes)
  dirty: () => hayCambios,                     // si devuelve true, cerrar pide "Tenés cambios sin guardar" dentro de la misma hoja
  focus: '#campo',                             // selector a enfocar al abrir (por defecto el título; [autofocus] se respeta)
  closeLabel: 'Cerrar', cls: 'mi-clase',
});
// hoja: { el, body, closed: Promise<resultado>, close(r), setTitle(t), setFooter(nodo) }
```
Se pueden apilar hojas (la de arriba se cierra primero). Para cerrar **todas** antes de navegar: `await ctx.sheet.closeAll()` (`ctx.nav` ya lo hace solo).

### 7.2 `ctx.sheet.confirm(opts)` — reemplaza `confirm()`; todo borrado pasa por acá

```js
const ok = await ctx.sheet.confirm({
  title: '¿Borrar el préstamo de $12.000?',
  message: 'Dejás de pagarlo en la proyección y tu plata libre sube $12.000 por mes.',   // string o Node
  confirmLabel: 'Borrar', cancelLabel: 'Cancelar', tone: 'bad', icon: 'papelera',
});
if (ok) ctx.update((d) => { d.installments = d.installments.filter((c) => c.id !== id); }, { undoLabel: 'Borrado.' });
```
`tone:'bad'` = botón terracota (usar siempre al borrar). Devuelve `Promise<boolean>`.

### 7.3 `ctx.sheet.info({ title, content, actionLabel='Entendido' })`

Hoja informativa simple (ej. "Qué supone esta fecha"). `content` string o Node.

### 7.4 `ctx.sheet.openRoute(clave, opts)` — hoja que vive en la URL

Para el detalle del mes (`#/meses/2026-12`) y similares. Se llama desde `mount()` cuando hay parámetro; **no empuja historial** (la URL ya cambió):

```js
mount(root, ctx, params) {
  ...
  if (params.key) ctx.sheet.openRoute('mes:' + params.key, {
    title: 'Diciembre', size: 'tall',
    render: (body) => body.append(detalleDelMes(params.key)),
    onDismiss: () => ctx.back('#/meses'),          // qué hacer cuando la persona la cierra (X, Esc, fondo, swipe)
  });
}
```
- **Idempotente:** si `mount` se vuelve a ejecutar con la hoja abierta (cambió el estado), la hoja **no se duplica**: se vuelve a llenar con `render` y conserva el scroll.
- Si la ruta cambia y la nueva pantalla no la declara, app.js la cierra sola. Atrás del celular también.
- En escritorio el detalle suele ser un panel fijo (`.col-side` con `.list-detail`, §10) en vez de hoja: decidilo con `matchMedia('(min-width: 1024px)').matches`.

### 7.5 `ctx.toast(mensaje, opts)`

```js
ctx.toast('Anotado. Hijo ahora te debe $350.000.', { actionLabel: 'Deshacer', onAction: () => revertir(), duration: 6000, tone })
// -> { el, remove(), dismiss() }.  Uno a la vez (el nuevo reemplaza al anterior). Se pausa al apoyar el dedo o el mouse.
```
Mensaje corto en voseo, **con el efecto**: "Anotado. Hijo ahora te debe $350.000." / "Listo, cambiamos tu plan." / "Borrado." Para acciones que se pueden deshacer lo más simple es `ctx.update(fn, { undoLabel: 'Borrado.' })`, que arma el toast y restaura el estado por vos. `duration: 0` = no se va solo. Se ve también con una hoja abierta.

## 8. Gráficos (`ctx.charts`)

Sin librerías. Reglas comunes: `role="img"` + `aria-label` en palabras, tabla equivalente bajo "Ver los números", texto de 16px reales (el SVG mide su contenedor), etiquetas directas sobre el dato, estimado = trazo/borde punteado, estado = color + palabra/forma, animación de entrada de 420 ms (sin movimiento con `prefers-reduced-motion`).

```js
charts.monthStrip(items, { showValues = items.length<=6, onHero = true, barWidth, ariaLabel })
// items: [{ key, label:'Oct', value, state:'bien'|'justo'|'cubierto'|'falta', current, estimated, onClick, ariaLabel }]
// Acepta también la tira de derive.hero().tira ({ key, mes, free, code, actual }) sin convertir.
// 4 columnas de botones; más de 6 meses = 6 columnas en 2 filas (12 columnas desde 1024px). onHero:false = sobre tarjeta blanca.

charts.monthRows(items, { mode:'4'|'12', ariaLabel })
// items: [{ key, name:'Octubre', short:'Oct', value, state, estimated, event:'Movilidad: 21 días', eventIcon:'bandera', onClick, selected }]
// '4' = filas de 96px (mes, chip de estado, número 28px, barra divergente, evento). '12' = filas de 56px (nombre, barra, número, ícono de evento).

charts.debtLine({ series:[{ name:'Tu plan', points:[{key:'2026-10', value:1800000}], style:'solid', endLabel:'abril 2027' },
                          { name:'Solo el mínimo', points:[...], style:'dashed', endLabel:'junio 2027' }],
                  height=160, ariaLabel, tableCaption, showTable=true })
// Línea de la deuda. Se redibuja sola si cambia el ancho. Devuelve <div.chart> con el SVG y el desplegable "Ver los números".

charts.timeline({ from:'2026-10', to:'2029-03', todayKey:'2026-10', ariaLabel,
                  items:[{ id, label, sub, start, end, dateLabel:'abril 2027', tone:'brand'|'info', pending, pipsInfo:{total,paid}, onClick, ariaLabel }] })
// Línea de tiempo de liberaciones (Gantt): eje común con años y "Hoy", filas de 96px, barras de 14px. pending:true = barra punteada azul "a completar".

charts.stacked({ parts:[{ label:'Hijo', value:400000, tone:'info', labelNode }, { label:'Resto', value:1400000, tone:'brand' }], ariaLabel, cls })
// Barra apilada "quién debe qué": cada parte con nombre + monto debajo (nunca solo color). labelNode: p. ej. ui.personName('Hijo', 3).

charts.longMonth('2027-04') -> 'abril 2027'
```

## 9. Utilidades de `dom.js`

`import { … } from '../dom.js'` (desde `src/ui/screens/`):

```js
h(tag, attrs, ...children)   // crea elementos. attrs: class (string|array|{clase:bool}), style (string|objeto, acepta '--var'), dataset, on<evento>, ref(fn), html (solo texto propio), true=>atributo vacío, false/null se omiten
cx(...clases)                // une clases condicionales
mount(el, ...hijos)          // vacía y llena
icon(name, { size:'sm'|'lg', cls, label })   // <svg><use href="#i-name">; sin label es decorativo (aria-hidden)
on(root, 'click', '[data-x]', (e, el) => ..., opts)   // delegación; devuelve la función para desuscribir
debounce(fn, ms = 250)       // con .cancel()
announce(msg)                // anuncia a lectores de pantalla (región #live)
lsGet(key, fallback) / lsSet(key, value)   // localStorage con try/catch
vibrate(ms = 8)              // al confirmar un gasto o un acuerdo
fitText(el, { min }) / autoFit(el, opts)   // baja el font-size hasta que entre en una línea (.fit)
countUp(el, to, { format, duration:600, key, once:true })   // cuenta de 0 al valor; solo la 1.ª vez por sesión y no con reduced-motion
reducedMotion() · remPx() · isPrivate() · uid() · MINUS · fmt · srMoney · toneOf · STATUS · statusInfo
```

## 10. Clases CSS

Colores y tamaños salen de `styles/tokens.css`. **No inventes colores.** Tamaño de letra del usuario: `html[data-fontsize="grande"|"masgrande"]` (112,5% / 125%): todo está en rem.

**Tipografía** (`t-*`, todas ≥ 16px): `t-hero` (40–56) · `t-display` (44) · `t-q` (32, pregunta) · `t-big` (32) · `t-date` (26) · `t-h1` (30) · `t-sheet` (24) · `t-h2` (20) · `t-body` (18) · `t-row` (18/700) · `t-small` (16) · `t-label` (16/700). Color: `muted` (ink-2) · `faint` (ink-3) · `brand` · `tone-ok|warn|bad|info`. `num` = cifras tabulares. `nowrap`, `center`, `right`.

**Layout:** `stack` (columna, 12px) · `stack-1|2|3|4|6|8` · `cluster` (fila con wrap, 8px) · `cluster-3` · `between` (fila con espacio entre) · `grow` · `auto-grid` (`repeat(auto-fit,minmax(9.5rem,1fr))`) · `divider`. La pantalla (`.screen`) ya apila sus hijos con 12px.

**Tonos:** `tone-bg-ok|warn|bad|info|brand|neutral` (fondo + texto del estado); `card-ok|warn|bad|info` (fondo de tarjeta).

**Escritorio (≥1024px):**
```js
h('div', { class: 'desk-cols' },                 // en celular se apila; en escritorio: 7 + 5 columnas de una grilla de 12
  h('div', { class: 'col-main' }, hero, ...),
  h('div', { class: 'col-side' }, paraGastar, salida, vence))
// variantes: 'desk-cols list-detail' (lista 5 cols + detalle PEGAJOSO 7 cols, para Meses), 'desk-cols even' (6 + 6)
```
`desk-only` / `mobile-only` muestran u ocultan bloques según el ancho. El contenido se centra en máx. 1120px con el riel de 248px a la izquierda; las hojas pasan a diálogos centrados; la letra **no** se achica.

**Otras:** `section-title`, `page-title`, `footnote`, `actions` (botones en columna; `actions row-wide` = lado a lado desde 640px), `eyebrow`, `sr-only` (solo lectores de pantalla), `skip-link`, `ribbon`, `pill-note`.

## 11. Íconos

Sprite SVG inline en `index.html`; trazo 2px, `currentColor`. `ui.icon('nombre')` o `ctx.ui.icon`. `ui.iconTile('nombre', tono)` para el cuadro de 44px.

`home` · `calendario` · `ayuda-circulo` · `tarjeta` · `mas-puntos` · `ojo` · `ojo-tachado` · `chevron` · `volver` · `alerta` · `tilde` · `mas` · `menos` · `bandera` · `banco` · `documento` · `usuarios` · `destello` · `escudo` · `billetera` · `whatsapp` · `lapiz` · `papelera` · `descargar` · `subir` · `luna` · `sol` · `llave` · `reloj` · `x` · `info` · `flecha-arriba` · `compartir` · `copiar` · `campana` · `texto` · `barras` · `candado` · `celular` · `inicio-pantalla` · formas de estado `forma-ok` (círculo con tilde) · `forma-justo` (cuadrado) · `forma-falta` (triángulo) · `forma-info` (rombo) · y `marca` (mosaico de la app, usado como `<svg viewBox="0 0 64 64"><use href="#i-marca"/></svg>`).

Para sumar un ícono: agregá un `<symbol id="i-nombre" viewBox="0 0 24 24">` en `index.html` (rejilla de 24px, trazo 2px, puntas redondeadas, sin `fill` ni colores).

## 12. Recetas

**Hoja con formulario, validación y deshacer** (editor de un préstamo):
```js
function abrirEditor(ctx, cuota) {
  const { ui } = ctx; const f = ui.fields;
  const monto = f.money({ label: 'Cuota por mes', value: cuota?.amount, required: true, requiredMsg: 'Poné cuánto se descuenta por mes.' });
  const faltan = f.stepper({ label: 'Cuotas que faltan', value: cuota?.remaining ?? 10, min: 1, max: 120, unit: 'cuotas', hint: 'Incluida la de este mes' });
  const campos = [monto, faltan];
  let sucio = false; campos.forEach((c) => c.onChange(() => { sucio = true; }));
  ctx.sheet.open({
    title: 'Préstamo por planilla', size: 'tall', dirty: () => sucio,
    render: (body) => body.append(ui.h('div', { class: 'stack-4' }, monto.el, faltan.el)),
    footer: (close) => [
      ui.btn({ label: 'Guardar', onClick: () => { if (!f.validateAll(campos)) return; sucio = false;
        ctx.update((d) => { /* ... d.installments ... */ }, { undoLabel: 'Listo, cambiamos tu plan.' }); close(); } }),
      cuota ? ui.btn({ label: 'Borrar este préstamo', variant: 'danger', onClick: () => borrar(ctx, cuota, close) }) : null,
    ],
  });
}
```

**Lista de "Lo que vence"** con fila pendiente: `ui.sectionTitle('Lo que vence', { label: 'Ver todo', href: '#/deudas' })` + `ui.rowList([...ui.row()])` (ejemplo en §5.6).

**Veredicto en vivo con mapa de meses** (¿Me alcanza?): `const mapa = ui.monthMap({ items, value, onChange: recalcular })`, un contenedor `<div role="status" aria-live="polite">` que se reemplaza con `ui.verdict(...)`, y `ui.legend(...)` fija bajo el mapa. Recalculá con `debounce(fn, 250)`; mientras corre el cálculo poné `state: null` en los items (círculo punteado).

**Tarjeta de respuestas de Hoy** (dos filas de 88px):
```js
ui.rowList([
  ui.row({ icon: 'billetera', title: 'Referencia para gastar hoy', sub: 'por día hasta fin de mes', value: ui.amt(3500), valueClass: 'big', size: 'lg', onClick: abrirHoja }),
  ui.row({ icon: 'bandera', tone: 'ok', title: 'Salís de la tarjeta', sub: 'faltan 7 meses', value: 'abril 2027', valueClass: 'date', size: 'lg', onClick: abrirSalida }),
])
```

**Gráfico de deuda con comparación**: ver `charts.debtLine` (§8) y el `aria-label` en palabras: "La deuda baja de $1.800.000 a cero en abril 2027 con tu plan, y en junio 2027 pagando solo el mínimo."

## 13. Lista de control antes de entregar una pantalla

- [ ] Se ve bien a **360px** y a 390px (sin scroll horizontal, nada cortado), en claro y oscuro, y con letra Grande / Más grande.
- [ ] Todo monto sale con `ui.amt` (o string pasado a un componente); todo nombre con `ui.personName`. Probá el ojo.
- [ ] Cada estado tiene palabra + forma + color (`ui.status`).
- [ ] Cada gráfico tiene `aria-label` y tabla alternativa.
- [ ] Ninguna acción depende de un gesto sin botón equivalente.
- [ ] Textos en voseo, sin palabras prohibidas (§3.8) y sin emojis.
- [ ] Las hojas de decisión llevan `ui.disclaimer()`.
- [ ] `npm test` en verde (incluye el lint de tamaños de letra y de contraste).
- [ ] Probado con `?hoy=2026-10-04` y con el ejemplo cargado (Bienvenida → "Ver un ejemplo").
