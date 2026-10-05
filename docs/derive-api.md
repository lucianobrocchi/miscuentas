# Mis Cuentas 2.0: API de la lógica (derive, store, format, adapter, demo, engine)

Para quien arma pantallas (Hoy, Meses, Probá antes de gastar, Deudas, Tarjeta, Me deben, Más, Bienvenida, Armado y editores).
Todo lo de este documento es lógica pura: sin DOM, sin red, se prueba con `npm test`. Las cifras de los ejemplos salen del
ejemplo ilustrativo `demo()` (nombres genéricos, números redondos) con hoy = domingo 4 de octubre de 2026. No son datos de nadie.

## 0. Reglas que valen para todo

1. **`today` siempre es un `Date` que pasa la app** (`ctx.today()`). Nunca llamar a `new Date()` en una pantalla para calcular
   algo: así los tests y el "ejemplo" son estables. Casi todas las funciones tienen la forma `fn(state, today, opts)`.
2. **`state` es el estado v2 completo** (ver sección 1). Ninguna función modifica el estado: se prueba con el estado congelado.
   Los resultados de `run()` y de las demás funciones son de **solo lectura** (están memoizados): no los modifiques.
3. **Los mutadores de `store.js` reciben el borrador (`draft`)** que entrega `ctx.update(fn)`: `ctx.update((d) => registrarGasto(d, { amount: 5000, cat: 'casa' }))`.
4. **Los textos ya vienen escritos** (voseo rioplatense, sin las palabras prohibidas): usalos tal cual. No armes frases con
   números por tu cuenta si la función ya devuelve `texto`. Los textos prohibidos se verifican por test sobre todas las salidas:
   "colchón", "plástico", "financiación", "TNA"/"TEM" sin glosario, "liberás", "moroso", "5 minutos", "Vas bien", "Justo" (se dice "Ajustado"),
   "$5.744 por día". "Podés respirar" solo sale si no hay datos estimados ni pendientes.
5. **Códigos de estado** (siempre en minúscula, para decidir color e ícono): `code` de un mes = `'bien'` (Alcanza, tono `ok`),
   `'justo'` (Ajustado, tono `warn`), `'cubierto'` (Ajustado: falta pero lo cubre la plata guardada, tono `warn`), `'falta'` (Falta plata, tono `bad`).
   Veredicto de ¿Me alcanza?: `'verde'` (Entra sin problemas), `'ambar'` (Se puede, pero tiene costo), `'terracota'` (No conviene ahora).
   Nunca se muestra solo por color: usá `label`/`titulo`.
6. **Las fechas de la tarjeta son las reales del último resumen cargado** (`debt.statement`), no días fijos.
7. **Qué NO modela el motor** (declararlo en Ayuda y bajo la fecha de salida; está en `LIMITACIONES`): consumos nuevos de las tarjetas, aumentos de sueldo
   ni suba de precios, que el banco puede cobrar más interés, y que el faltante de un mes se suma a la tarjeta.

## 1. Estado v2 (`store.js`)

Clave de storage `'miscuentas.v1'` (no cambia; el estado lleva `v: 2`). `load()` y `normalize()` completan lo que falte, así que los datos
viejos siguen funcionando (migración idempotente: `normalize(normalize(x))` es igual a `normalize(x)`).

```js
state = {
  v: 2,
  settings: {
    start,                 // 'YYYY-MM'. NO manda: el motor siempre usa el mes real de hoy (toEngine)
    horizon: 12, strategy: 'avalanche' | 'snowball' | 'none',   // 'none' = solo el mínimo
    buffer: 0, cash: 0,    // cash = "Plata de hoy" (lo que hay en la cuenta)
    deficitRate: 0,
    people: 'Vos, Pareja',  // legado: texto sincronizado con people[]
    name: '',              // cómo le decimos
    theme: 'auto' | 'light' | 'dark',
    fontSize: 'normal' | 'grande' | 'masgrande',
    privacy: false,        // ojo: oculta montos y nombres
    onboarded: false, onboardingStep: 0,   // 0 a 7
    pasos: { familia: true, sueldo: true, movilidad: true, gastos: true, planilla: true, tarjeta: true, medeben: true },  // pasos del armado ya respondidos (aunque sea "no tengo")
    salaryNetOfPayroll: null,  // true | false | null (no sé). Ver sección 6
    cobroEsteMes: null,        // true | false | null: ¿ya cobró este mes?
    lastBackupAt: null,        // 'YYYY-MM-DD'
    mesesMode: '4' | '12',
    demo: false,               // true mientras se mira el ejemplo (cinta ámbar fija)
  },
  people:       [{ id, name, role: 'yo'|'pareja'|'hijo'|'hija'|'otro' }],
  incomes:      [{ id, name, owner, amount, kind: 'sueldo'|'movilidad'|'aguinaldo'|'otro', estimated?: true,
                   months?: [6, 12], from?: 'YYYY-MM', to?: 'YYYY-MM', overrides?: {'YYYY-MM': monto}, perDay?, days?: {'YYYY-MM': n},
                   // solo movilidad (la UI edita esto y el adaptador lo expande por día trabajado):
                   fullMonthAmount?, fullMonthDays?, noPayMonths?: [1], daysByMonthNumber?: {7: 15}, movilidadVencida?: true }],
  expenses:     [{ id, name, owner, amount, kind: 'casa'|'gustos'|'otro'|'compra', estimated?: true, months?, from?, to?, overrides? }],
  installments: [{ id, name, owner, amount, remaining, first: 'YYYY-MM', payroll?: true, total?: 36 }],
                // 'remaining' se cuenta DESDE 'first', incluida. 'total' (opcional) es el total de cuotas, para decir "cuota 27 de 36"
  debts:        [{ id, name, kind: 'card'|'loan'|'other', creditor, balance, rate /* % mensual */, minPayment,
                   statement: null | { closedOn, dueOn, nextCloseOn, nextDueOn,   // 'YYYY-MM-DD' (fechas COMPLETAS)
                                       total, min, label: 'septiembre', loadedAt, newCharges?, interes? },
                   payments: [{ id, date, amount }],        // lo que pagaste ("Ya pagué")
                   planned: { 'YYYY-MM': monto },           // pago ELEGIDO ese mes ("Otro monto")
                   holders: [{ personId, amount }],         // reparto informativo entre titulares
                   paidOffOn?: 'YYYY-MM-DD' }],
  receivables:  [{ id, person, personId, name, balance, rate, monthlyPayment, payments: [{ id, date, amount, destino? }], note }],
  spent:        [{ id, date, amount, cat: 'casa'|'gustos', label? }],   // solo 'gustos' resta de "Referencia" (Para gastar hoy)
  plannedPurchases: [{ id, name, amount, modo: 'una'|'cuotas'|'mensual', desde, cuotas, montoCuota?, hasta?, hecha, hechaEl? }],
  pending:      [{ id, label, target }],      // datos que faltan: 'afip', 'aguinaldo', 'planilla', 'titulares'
  seen:         { hitos: [], tips: [], cierres: ['2026-10'], proyecciones: {'YYYY-MM': esperado} },
}
```

## 2. `store.js`

| Función | Qué hace |
|---|---|
| `STORAGE_KEY`, `VERSION`, `MENSAJE_ARCHIVO_INVALIDO`, `MENSAJE_ARCHIVO_NUEVO` | constantes ("Ese archivo no parece una copia de Mis Cuentas. Probá con otro.") |
| `uid()` | id corto único |
| `currentMonth(today?)` | `'YYYY-MM'` |
| `emptyState(today?)` | estado v2 vacío |
| `normalize(raw, { today? })` / `migrate` | completa y valida cualquier estado (v1, v2 o roto); no muta la entrada; idempotente |
| `load(storage?, { today? })` | lee `localStorage` (o el que le pases); nunca tira: ante cualquier problema devuelve `emptyState()` |
| `save(state, storage?)` | `true` si pudo guardar; `false` si el storage está lleno o bloqueado (la app sigue andando) |
| `exportJSON(state, today?)` | `{ nombreArchivo: 'mis-cuentas-2026-10-04.json', contenido }`; después llamar `marcarCopia(draft)` |
| `importJSON(text, { today? })` | `{ ok: true, state, resumen: { texto, ... }, descartados }` o `{ ok: false, mensaje }` (mensaje amable, listo para mostrar) |
| `describeState(state)` | `{ personas, ingresos, gastos, cuotas, deudas, meDeben, texto: '4 personas, 3 ingresos, ...' }`: sirve para decir qué reemplaza una copia |

Mutadores (reciben el borrador `draft`, devuelven lo que se indica):

| Función | Qué hace / devuelve |
|---|---|
| `registrarPagoDeuda(draft, debtId, { amount, date? }, today?)` | "Ya pagué": agrega a `debt.payments` y baja `balance`. Devuelve el pago o `null` |
| `aplicarResumen(draft, debtId, stmt, today?)` | carga el resumen nuevo. `stmt = { closedOn, dueOn, nextCloseOn?, nextDueOn?, total, min, rate?, label?, newCharges?, interes? }`. `balance = total − lo pagado después del cierre`; `minPayment = min`; limpia pagos elegidos de meses pasados. `true`/`false` |
| `anotarCobro(draft, receivableId, { amount, date?, destino: 'tarjeta'\|'guardada'\|'gastada', debtId? }, today?)` | "Anotar que me pagaron": baja `balance`; `'tarjeta'` también paga la Visa, `'guardada'` suma a `settings.cash`. `{ ok, saldoNuevo }` |
| `registrarGasto(draft, { amount, cat: 'casa'\|'gustos', date?, label? }, today?)` | "Anoté un gasto". Devuelve el gasto o `null` |
| `crearCompraPlanificada(draft, gasto)` | desde ¿Me alcanza? ("Lo voy a hacer"); `gasto = { nombre, monto, modo, desde, cuotas, montoCuota?, hasta? }`. Devuelve el id |
| `marcarCompraHecha(draft, id, today?)` | la marca hecha; NO crea un gasto aparte |
| `elegirPagoTarjeta(draft, debtId, { opcion: 'minimo'\|'sobra'\|'otro', monto?, mes? })` | `'minimo'` → `settings.strategy = 'none'`; `'sobra'` → `'avalanche'`; `'otro'` → `debt.planned[mes] = monto`. Con `mes`, `'minimo'`/`'sobra'` borran el pago elegido de ese mes |
| `aplicarCambios(draft, cambios)` | aplica lo que devuelve `opcionesMesDificil(...).opciones[i].cambios` (agregar ítems, editar, montos de un mes) |
| `aplicarAumento(draft, incomeId, { desde, monto })` | "Me aumentaron el sueldo desde {mes}": corta el ingreso el mes anterior y crea el nuevo desde `desde`. Devuelve el id nuevo o `null` |
| `guardarProyeccion(draft, valor, today?)` | guarda (una sola vez por mes) lo que el plan decía que iba a sobrar, para el cierre de mes. Llamarla al abrir Hoy si `state.seen.proyecciones[mes] === undefined`, con `Math.round(hero.free)` |
| `ajustarGastosCasa(draft, monto)` | cierre de mes: cambia el gasto 'casa' y lo marca como no estimado |
| `marcarVisto(draft, 'hitos'\|'tips'\|'cierres', id)` | recuerda que algo ya se mostró |
| `marcarCopia(draft, today?)` / `diasDesdeCopia(state, today?)` | `lastBackupAt` / días desde la última copia (`null` si nunca) |
| `agregarPersona(draft, { name, role? })` | agrega a `people[]` y sincroniza `settings.people`. Devuelve el id (si ya existe, el existente) |

## 3. `derive.js`

Todo se importa por nombre: `import { hero, veredicto } from '../derive.js'` o por `ctx.derive.hero(...)`.
Abajo, `s` = estado, `t` = `today`. Las cifras de los ejemplos son del ejemplo ilustrativo.

### Núcleo

**`run(s, { extra?, strategy?, today? })`** → resultado de `simulate()` del motor sobre el estado adaptado, memoizado por contenido (máx. 50 entradas).
`extra` = gastos hipotéticos (misma forma que `expenses`); `strategy` = `'avalanche'|'snowball'|'none'`. Trae además `sim.eng` (no enumerable): el estado del motor con
`flags`, `pending` y `omitidos` (ver `toEngine`). Cada mes: `months[i] = { key, income, collections, owed, expenses, installments, installmentCount, freedInstallments,
debtPayments, payments: {[debtId]: monto}, interest, free, shortfall, cash, debtTotal, debts: {[debtId]: saldo}, status }`. Además `debts: [{ id, name, paidOn }]`,
`receivables: [{ id, person, name, bal, paidOn }]`, `debtFreeMonth`, `totalInterest`.
**`limpiarMemo()`** vacía el memo (para tests). **`estadosDe(sim)`** → un estado por mes (array paralelo a `sim.months`, memoizado).

**`monthState(m, prevCash = 0)`** → `{ code, pct, label, tone, faltante, shortfall, fromCash }`. `bien` = sobra el 5% o más de lo que entra; `justo` = de 0 a 5%;
`cubierto` = falta pero lo cubre la plata guardada; `falta` = no alcanza (`faltante` = lo que no cubre la plata guardada).

### Hoy

**`hero(s, t)`** → según `estado`:
- `'sinDatos'` / `'sinIngresos'` → `{ estado, mes, mesNombre, texto, accion: { texto, ruta } }` ("Empecemos por lo que cobrás" [Empezar]).
- `'parcial'` (solo ingresos) → igual + `numero` (lo que entra) y `texto` ("Entran $900.000. Cargá tus gastos para saber cuánto sobra.").
- `'ok'` → `{ estado, mes, mesNombre, free, code, label, tone, pct, rotulo, numero, subtitulo, tieneDeuda, aLaTarjeta, chip, provisorio, motivos, estimados, aviso, tira }`.
  - `rotulo`: **"Va a la tarjeta este mes"** mientras haya deuda; **"Te sobran en octubre"** solo sin deuda; "Te faltan este mes" si falta. `numero` es el monto positivo a mostrar en grande; `free` es el real con signo.
  - `aLaTarjeta`: `{ total, minimo, extra, elegido } | null` (`elegido` = hay un pago elegido para este mes).
  - `chip`: `{ texto, tone, matiz, provisorio, detalle? }`: "Alcanza" / "Ajustado" / "Falta plata". **Nunca es verde puro** si hay datos pendientes ("Provisorio") o un mes futuro con falta ("Alcanza, ojo con enero", `matiz: 'ojo'`).
  - `provisorio` + `motivos: string[]` (por qué: AFIP, planilla, resumen viejo, si ya cobró). `estimados: { n, texto: 'Incluye 4 datos estimados' | null }`.
  - `aviso`: `{ tipo: 'falta'|'justo'|'bien'|'mesActualFalta', key, mesNombre, amount, texto, accion: 'mes'|null }` ("Ojo con enero: faltan $202.000", "Con lo que cargaste, los próximos 12 meses alcanzan.", "Hay 3 formas de cubrirlo").
  - `tira`: 4 meses `{ key, mes: 'Oct', free, compacto: '84 mil', code, tone, actual }`.

**`plataDeHoy(s)`** → `{ hay, rotulo: 'Plata de hoy', monto, cobroEsteMes, pregunta: '¿Ya cobraste este mes?' | null }` (la pregunta aparece si hay plata y no se sabe si ya cobró).

**`paraGastarHoy(s, t)`** → "Referencia" (nunca un saldo): `{ estado: 'ok'|'agotado'|'sinGustos', referencia: true, gustos, gastado, restante, dias, porDia, hastaFecha, texto, calculo }`. Solo los gastos anotados como `'gustos'` restan; uno de la casa nunca dice "ya usaste tus gustos".

**`salidaTarjeta(s, t, { debtId?, strategy? })`** → `{ estado: 'fecha'|'muyLejos'|'noTermina'|'sinDeuda'|'sinTarjeta', hayTarjeta, paidOn: 'YYYY-MM'|null, mesNombre: 'marzo 2027', mesesQueFaltan, detalle: 'faltan 6 meses', texto, supuesto, queSupone: string[], provisoria, etiqueta: 'Fecha provisoria'|null, motivos }`.
`supuesto` ("Si de acá en más pagás completo lo que consumís en el mes") va **debajo de la fecha en 16px o más**; `queSupone` es el contenido de la hoja "Qué supone esta fecha". Si `provisoria`, mostrar `etiqueta`.
`'muyLejos'` = más de 24 meses (nunca se muestra un número absurdo).

**`vencimientos(s, t)`** → `{ filas, todas, vacio }`. `filas` = máximo 3, ordenadas por fecha; la de "Lo que te deben" reemplaza a la menos urgente. `vacio` = "No vence nada en los próximos 15 días." (+ " Podés respirar." solo si no hay estimados ni pendientes) o `null`.
Fila: `{ id, tipo: 'tarjeta'|'planilla'|'pendiente'|'medeben', titulo, fecha, fechaTexto, dias, detalle, monto, montoRotulo, estado, chip, boton: { texto, accion }|null, ruta, pagado, fechasResumen, urgente? }`.
Fila de tarjeta, `estado`: `'pendiente'` (monto = mínimo del resumen, boton "Ya pagué"), `'parcial'`, `'pagado'`, `'viejo'` (**el resumen ya cerró uno nuevo: `monto` es `null`**, `detalle` = "Falta cargar el resumen nuevo para saber cuánto pagar", boton "Cargar resumen nuevo"), `'esperandoCierre'`, `'sinResumen'`.
`pagado` = `{ total, fecha, texto: 'Pagaste $270.000 de la Visa el 30 de septiembre' } | null`. `fechasResumen` = "El último resumen que cargaste cerró el 28 de septiembre y vence el 10 de octubre." (mostrar siempre).

**`ahoraToca(s, t)`** → una sola tarjeta de acción o `null`: `{ tipo: 'cargarResumen'|'pagarTarjeta'|'anotarCobro', titulo, texto, boton: { texto, accion }, urgente?, debtId? }`.

**`siguientePaso(s, t)`** → hasta 3 tarjetas bajo el pliegue, en orden: `[{ id: 'idea'|'liberacion'|'datos', titulo, texto, boton: { texto, ruta }, personId?, progreso? }]`.

**`hitos(s, t, seen = s.seen)`** → cuotas y deudas que terminaron hace poco y no se mostraron: `[{ id, tipo: 'cuota'|'deuda', titulo: '¡Se terminó!', texto, monto, desde }]`. Después: `marcarVisto(draft, 'hitos', id)`.

**`indicadores(s, t)`** → `{ mas: boolean, deudas: boolean }` (puntos ámbar de la barra inferior; `mas` solo si faltan datos que cambian el resultado).

**`cierreDeMes(s, t, { gastoTotal?, pagoVisa? })`** → `{ aplica, mes, mesNombre, pregunta: '¿Cómo te fue en octubre?', esperado, textoEsperado: 'Esperábamos que te sobraran $84.364', resultado }`.
`aplica` = es el primer día hábil del mes (hasta el día 7) y no se mostró (`seen.cierres`). `resultado` (si pasás `gastoTotal`) = `{ gastoTotal, pagoVisa, previstos, diferencia, sobroReal, sugerido, boton: 'Ajustar mis gastos de la casa a $700.000' | null, texto }`. El botón aplica `ajustarGastosCasa(draft, resultado.sugerido)`; marcar visto con `marcarVisto(draft, 'cierres', mes)`.

### Decidir

**`gustosEscenarios(s, t, { montos? })`** → `{ hayGustos, hayTarjeta, actual, gustosId, escenarios: [{ monto, esActual, salida, salidaTexto, interesTotal, ahorroVsActual }], notaPie, rango: { min, max } | null }` (4 corridas; `ahorroVsActual` negativo = cuesta más).
Para el botón "Usar $X": `update((d) => { d.expenses.find((e) => e.id === gustosId).amount = X })`.

**`opcionesMesDificil(s, 'YYYY-MM', t)`** → `null` (mes fuera de rango) o `{ key, mesNombre, hayProblema, faltante, causa, intro, opciones: [{ id: 'tarjeta'|'reserva'|'sinGustos', titulo, etiqueta, disponible, texto, faltanteDespues, salida, costoInteres, cambios, ... }], pie }`.
"Elegir este plan" → `update((d) => aplicarCambios(d, opcion.cambios))`. La opción `'tarjeta'` es el plan de hoy (`cambios: {}`).

**`veredicto(s, gasto, t, { conTope = true })`** → `gasto = { nombre, monto, modo: 'una'|'cuotas'|'mensual', desde: 'YYYY-MM', cuotas?, montoCuota?, hasta? }`.
('una': `monto` = precio total; 'cuotas': `monto` = precio total o `montoCuota` = cada cuota; 'mensual': `monto` = por mes.)
Devuelve `{ codigo, color, titulo, texto, desc, gasto (normalizado), costoTotal, precioTotal, extraInterest, teSale, mesPeor, primerMesFalta, salidaAntes, salidaDespues, salidaAntesTexto, salidaDespuesTexto, delayMonths, mesesAfectados, filas: [{ k, v }], antesDespues: [4 meses], siLoNecesitas: { key, sinCosto, texto } | null, tope, pie }`.
Si todavía no escribió cuánto cuesta, `vacio: true` (con `texto` "Poné cuánto cuesta y te digo si te alcanza."): mostrá eso y no un veredicto; lo mismo en `mapaMeses` (`vacio`).
Criterio: **terracota** si algún mes queda en `falta` y empeora (también un mes que ya era negativo), o la tarjeta deja de terminarse; **ámbar** si atrasa la salida, el interés extra supera el 1% del gasto o algún mes pasa a más ajustado; si no, **verde**. NO usa `compare().newNegativeMonths`.
`siLoNecesitas` (si no es verde) = "Si igual lo necesitás, lo mejor es mayo: ..." (el primer mes de los próximos 12 que no suma interés). `tope` (si no es verde y `conTope`) = `topeSinCosto` del mes elegido. `pie` = leyenda obligatoria.

**`mapaMeses(s, gasto, t)`** → `{ meses: [12 × { key, mes, codigo, glifo: 'circulo'|'cuadrado'|'triangulo', etiqueta: 'Sin costo'|'Con costo'|'No conviene', costoExtra, faltante, sinInteres }], mejorMomento: { key, mesNombre } | null, textoSinMejor, leyenda: LEYENDA_MAPA }`. La leyenda fija bajo el mapa sale de `leyenda`. Corre 12 veces el motor (~20 ms): usar debounce de 250 ms.

**`topeSinCosto(s, 'YYYY-MM', { modo?, cuotas?, today? })`** → la pregunta inversa "¿Cuánto puedo gastar en {mes} sin que me cueste?": `{ key, mesNombre, modo, cuotas, sinCosto, sinFaltar, porMesSinCosto, porMesSinFaltar, texto, textoSinFaltar }`.
`sinCosto` = el mayor total (múltiplo de $1.000) con veredicto verde. Mientras haya deuda en la tarjeta suele ser $0 y `texto` lo dice con honestidad ("En diciembre no hay plata que no cueste..."); `sinFaltar` = hasta cuánto no falta plata (con interés).

**`PIE_DECISION`** = "Es una estimación con los datos que cargaste. No es asesoramiento financiero." (pie obligatorio de las hojas de decisión).

### Tarjeta

**`escenariosPago(s, t, { otro?, debtId? })`** → `{ estado: 'ok'|'sinTarjeta', debtId, nombre, fecha, key, titulo: 'Cuánto pagar el 10 de octubre', opciones, elegida: 'minimo'|'sobra'|'otro', minimoDelResumen, maximoQueAlcanza, resumenViejo, aviso, pie, pieDecision }`.
`opciones`: `[{ id: 'minimo'|'sobra'|'otro', titulo, monto, paidOn, salidaTexto, totalInterest, ahorro, recomendada, aviso?, faltaPlata? }]`. `'otro'` aparece si pasás `otro` (para evaluar en vivo) o si ya hay un pago elegido guardado. Un `otro` mayor que `maximoQueAlcanza` trae `aviso` ("te faltarían $X, que se suman a la deuda").
Guardar la elección: `elegirPagoTarjeta(draft, debtId, { opcion, monto, mes: escenarios.key })`. "Ya pagué": `registrarPagoDeuda`.

**`precargaResumen(debt)`** → `{ hayAnterior, closedOn, dueOn, rate, nota }`: lo que se precarga al cargar un resumen nuevo (las fechas del resumen anterior más un mes y la tasa que ya estaba).
**`validarResumen(input, { debt?, today? })`** → pantalla "Revisá" antes de guardar el resumen. `input = { total, min, rate, closedOn, dueOn, nextCloseOn?, nextDueOn?, newCharges?, interes? }` (cada campo puede ser el texto tal cual se escribió).
Devuelve `{ ok, confirmar, avisos: [{ campo, nivel: 'corregir'|'confirmar', texto, sugerido? }], valores, filas: [{ rotulo, valor }] }`. `ok: false` si hay algo para `corregir` (no se puede guardar); `confirmar: true` si hay algo para confirmar con un "Sí, está bien".
Reglas: tasa mayor a 15 se toma como anual y se convierte (`valores.rate` ya viene convertido: "79% parece la tasa anual. ¿Usamos 6,49% por mes?"); mínimo fuera del 5% al 30% del total se confirma; más de 9 dígitos, "Mirá bien los ceros, por favor."; el cierre no puede ser futuro; el vencimiento va después del cierre; con `debt` compara contra el resumen anterior.
Guardar: `update((d) => aplicarResumen(d, debtId, validacion.valores))`. `filas` es la lista de la pantalla "Revisá".
**`curvaDeuda(s, t, { meses? })`** → `{ plan: [{ key, deuda }], soloMinimo: [{ key, deuda }], planTermina, minimoTermina }` (gráfico "Cómo baja").
**`interesTarjeta(debt)`** → `{ balance, rate, tasaTexto: '6,49%', porMes, porDia, delResumen, mostrar, anualAprox }`. Va SOLO en la pantalla Tarjeta, bajo "Cuánto cuesta esta deuda"; si el resumen informa el interés en pesos, `mostrar` es ese.
**`cicloTarjeta(s, t, { debtId? })`** → `{ hayResumen, viejo, fechas: { cerroEl, venceEl, proximoCierre, proximoVencimiento } | null, texto, consejo, nota, pide }`. `consejo` = "Como pagás cerca del mínimo, lo que comprás con la tarjeta se suma a la deuda y paga interés." (o `null`); `nota` = "Fijate la fecha de cierre en tu resumen."
**`titularesTarjeta(s, { debtId? })`** → `{ total, repartido, diferencia, cuadra, partes: [{ personId, nombre, monto }], resto, texto: 'Cuadra' | 'Faltan $X' | 'Te pasaste por $X' }`.
**`resumenViejo(debt, t)`** → boolean (ya cerró un resumen más nuevo que el cargado). **`proximoPago(debt, t)`** → `{ fecha, key, tipo: 'vigente'|'proximo'|'sinFecha' }`.
**`icsVencimiento(s, t, { debtId? })`** → `{ ok: true, nombreArchivo, contenido (texto .ics), fecha } | { ok: false, mensaje }`. Evento a las 9:00 del vencimiento real del resumen con `VALARM` 2 días antes (funciona sin internet). Para el botón "Avisarme en mi calendario": `new Blob([contenido], { type: 'text/calendar' })`.

### Deudas y Me deben

**`liberaciones(s, t)`** → `{ items, escalera, proxima, faltaPagarPlanilla }`. `items[i]` = `{ id, tipo: 'prestamo'|'cuota'|'tarjeta'|'pendiente', nombre, monto, fin, desde, quedan, cuotaActual, cuotasTotal, noTermina, aCompletar, planilla, saldo?, target? }` (ordenados por `desde`; `fin`/`desde` son `'YYYY-MM'`).
`escalera` = `[{ desde, monto, texto: 'Desde abril 2027: +$270.000 (ya no pagás la tarjeta)' }]`. `faltaPagarPlanilla` = lo que falta pagar por planilla en total (sin AFIP).
**`deudaSobreIngreso(s, t)`** → `{ porCien, deudas, tarjetaMinimo, prestamos, ingresos, textoHoy: '$31 de cada $100 que cobrás van a deudas', detalle, alivio: { key, mesNombre, porCien } | null, textoAlivio: 'En abril de 2027 baja a $8 de cada $100' | null }`. **Lo primero que se muestra es la fecha (`textoAlivio`); `textoHoy` va chico debajo.**
**`meDeben(s, t)`** → `{ total, entraPorMes, personas: [{ id, personId, nombre, balance, monthlyPayment, pagadoEsteMes, receivableIds, estado: 'acordado'|'parte'|'conversar'|'nada', estadoTexto, tono: 'ok'|'warn'|'brand'|'info', detalle }], sinCuota, texto }`. Sin ícono de alerta; "Para conversar" usa el color pino (`brand`).
**`escenariosCobro(s, receivableId, t, { montos? })`** → `null` o `{ receivableId, personId, persona, nombre, balance, rate, interesPorMes, cuotaActual, salidaTarjetaActual, advertenciaActual, escenarios: [{ monto, esActual, terminaEn, terminaTexto, meses, interesTotal, salidaTarjeta, mesesAntes, ahorro, advertencia }] }`. `advertencia` = "Con esta cuota su deuda no baja: el interés es $X por mes." (si hay interés y la cuota no lo cubre; ahí `terminaEn` es `null`).
**`interesDeCobro(s, receivableId)`** → `{ rate, porMes, texto } | null`. **`mensajeWhatsApp(s, receivableId, t, { monto? })`** → texto editable que dice "según el último resumen (aproximado)" (no se envía solo: `navigator.share` o `wa.me`).

### Meses

**`proyeccion(s, t, { n = 12 })`** → `{ hayIngresos, filas, mejorMes, mesDificil }`. `filas[i]` = `{ i, key, mesNombre, mesCorto, free, compacto, code, label, tone, pct, esActual, estimado, eventos: string[], evento }` (`evento` = primer evento o "Un mes sin sorpresas."). `mejorMes.texto` = "Mejor mes: junio +$804.364"; `mesDificil.texto` = "Mes difícil: enero −$202.000" (solo existe si algún mes está en falta).
**`eventosMes(s, i, t)`** → `[{ tipo: 'movilidad'|'aguinaldo'|'cuotaTermina'|'tarjetaFin'|'sinTarjeta'|'cobroTermina', texto, monto?, sinCobro? }]` (índice 0 = mes actual; fuera de rango = `[]`). Textos: "Movilidad: 21 días (feriado del 12)", "Feria de enero: este mes no cobrás movilidad", "Feria de invierno: movilidad de 15 días", "Aguinaldo estimado: +$450.000", "Último pago de la tarjeta", "Primer mes sin tarjeta: +$270.000".
**`lineasMes(s, i, t)`** → `null` (fuera de rango) o `{ key, mesNombre, free, code, label, tone, entra, entraTotal, sale, saleTotal, queSobra, avisos, eventos, pie }`. Línea: `{ id, lista: 'incomes'|'expenses'|'installments'|'debts'|'receivables', nombre, detalle, monto, estimado, kind?, items? }` (tocarla abre el editor de `lista`/`id`; `id: 'planilla'` y `'cobros'` son agrupadas). **`entraTotal − saleTotal = free`**. `queSobra = { tipo: 'tarjeta'|'falta'|'guardado', vaALaTarjeta, deudaQueda, guardado, texto }`.

### Datos que faltan, armado y textos

**`completitud(s, t)`** → `{ hechos, total: 7, completo, pasos: [{ n, id, titulo, estado: 'hecho'|'pendiente', ruta: '#/armar/N' }], faltan: [{ id, texto, paso }], siguiente }` (medidor "4 de 7" y chips de lo pendiente). **`faltanDatosClave(s, t)`** → `{ hay, items }` solo con lo que cambia el resultado (AFIP, planilla).
**`recompensa(s, paso, t)`** → lo que se dice al terminar cada paso 1 a 7: `{ texto, detalle, provisoria?, accion? } | null`. El paso 6 es una fecha y una acción ("Ver mi panorama") con el supuesto en `detalle`; nunca el interés por día.
**`revelacion(s, t)`** → `{ frases: [{ tipo: 'mes'|'mesDificil'|'salida', texto }], supuesto }` (pantalla final del armado).
**`glosario(termino)`** → `{ titulo, texto } | null` para 'pago minimo', 'saldo actual', 'interes mensual', 'estimado', 'provisorio' (tolera tildes y mayúsculas). `GLOSARIO` es el objeto completo.
**`LIMITACIONES`** (array de textos de "Cómo se calculan los números" y de la hoja "Qué supone esta fecha", incluye "No incluye aumentos de sueldo ni suba de precios."), **`ASUME_SALIDA`**, **`LEYENDA_MAPA`**.
También reexporta `toEngine`, `estadoResumen`, `pagosDelMes`, `pagosDelResumen`, `normalizarGasto`, `gastoAExtras`, `cuotasQueFaltan`, `haceTiempo`, `addDays`, `addMonthsDate`.

## 4. `adapter.js`

- **`toEngine(state, today?, { start? })`** → lo que lee `simulate` (`{ settings, incomes, expenses, installments, debts, receivables }`) más:
  - `flags: { provisorio, motivos: string[], motivosDetalle: [{ code: 'planilla'|'afip'|'resumenViejo'|'cobro', texto, target }], estimados: { n, items } }`
  - `pending: [{ id, label, target, cambiaResultado }]` (los de `state.pending` más los ítems incompletos) y `omitidos: [{ lista, id, nombre, motivo }]` (lo que no se mandó al motor).
  Reglas: el mes de inicio es el mes real de `today`; movilidad por día con feriados de `calendar.js`, meses sin cobro (`noPayMonths`), días fijos por número de mes (`daysByMonthNumber`) y `movilidadVencida` (corre el calendario un mes);
  aguinaldo estimado = 50% del sueldo; ítems sin monto o sin cuotas que faltan se omiten y quedan como pendientes; compras planificadas como gastos; pagos de este mes (después del cierre del resumen) ya descontados del saldo y fijados como pago elegido;
  lo que te pagaron este mes no se cuenta dos veces. Pura: no modifica el estado y devuelve copias profundas.
- **`estadoResumen(debt, today?)`** → `{ fase: 'sinResumen'|'vigente'|'vencido'|'viejo', hayResumen, viejo, vencido, closedOn, dueOn, nextCloseOn, nextDueOn, label, diasParaVencer, diasParaCierre }`.
- **`cuotasQueFaltan({ actual, total, descontadaEsteMes }, today?)`** → `{ remaining, first, termina }`: para "cuota actual X de N" (la X ya se descontó). Se guarda `installments[].remaining/first`.
- **`pagosDelMes(item, 'YYYY-MM')`** y **`pagosDelResumen(debt, { key? })`** → `{ total, pagos, ultimo }` (los segundos son los posteriores al cierre del resumen vigente).
- **`normalizarGasto(gasto, start)`** y **`gastoAExtras(gasto, start, id?)`** → forma normalizada del gasto de ¿Me alcanza? y gastos para `run({ extra })`.

## 5. `format.js`

`money(n)` → "−$342.688" (sin centavos, signo menos U+2212) · `num(n)` → "1.290.000" · `compact(n)` → "106 mil", "1,3 M", "−343 mil" · `ariaMoney(n)` → "105948 pesos" · `pct(n)` → "6,49%" ·
`parseMoney(texto, { decimales? })` → número o `null` (tolera "$ 1.234.567", "1,5", "300 mil") · `parseRate(texto)` → `{ valor, convertida, original, aviso } | null` (tolera coma; mayor a 15 se toma como tasa anual y se convierte: "79% parece la tasa anual. ¿Usamos 6,49% por mes?") ·
`revisarMonto(n, { tipo?: 'sueldo' })` → `{ ok, aviso: 'Mirá bien los ceros, por favor.' }` (más de 9 dígitos o sueldo mayor a 20 millones) ·
`monthName('2026-10', { year?, de?, short?, capital? })` → "octubre" / "octubre 2026" / "Oct" · `longDate(d, { weekday?, year?, capital? })` → "4 de octubre" · `haceTiempo(d, hoy)` · `plural(n, uno, otros, { sinNumero? })` · `lista([...])` → "a, b y c" ·
fechas: `toDate`, `toISO`, `monthKeyOf`, `addDays`, `addMonthsDate`, `daysBetween`, `lastDayOfMonth`, `MINUS`.
Campos de monto: usá `inputmode="decimal"`, nunca `step` restrictivo, y `parseMoney` para leer.

## 6. Decisiones que conviene conocer

- **Planilla (`settings.salaryNetOfPayroll`)**: `false` = los préstamos y el plan de AFIP se descuentan del recibo DESPUÉS del neto cargado, así que se restan (es el caso de la usuaria). `true` = el sueldo cargado ya viene sin esos descuentos: el adaptador se los suma para no restarlos dos veces, y al terminar un préstamo se ve la liberación.
  `null` (no sé) = se restan igual (lo conservador) pero **no en silencio**: `flags.provisorio = true` con el motivo "No sabemos si los descuentos del recibo ya están restados de tu sueldo", chip "Provisorio" y pendiente `'planilla'`. Se pregunta una sola vez, con ayuda del recibo.
- **Plata de hoy**: si `cobroEsteMes` es `true` (o no se sabe), el saldo de la cuenta ya incluye el sueldo de este mes, que el motor cuenta aparte: se descuenta del saldo para no sumarlo dos veces (nunca queda negativo).
- **Pago elegido de la tarjeta**: `debts[].planned['YYYY-MM']` reemplaza mínimo y barrido de esa deuda ese mes; lo que no se paga queda en caja. Un pago "Ya pagué" (después del cierre del resumen) se repone al saldo y se fija como pago elegido de este mes.
- **El resumen viejo no mueve números en silencio**: con un resumen que ya cerró otro nuevo, `vencimientos` no muestra monto, la fecha de salida es "provisoria" y `flags.motivosDetalle` incluye `'resumenViejo'`.
- **Desempate de nombres**: la API usa `(state, i, today)` para las funciones por mes (`eventosMes`, `lineasMes`) y `(state, today, seen)` para `hitos`; ninguna recibe la simulación (se memoiza por dentro con `run`).

## 7. Motor (`engine.js`): cambios aditivos

- `debts[].planned: { 'YYYY-MM': monto }`: pago elegido ese mes (reemplaza mínimo y barrido; se topea al saldo; si deja el mes en falta, el faltante se financia como siempre).
- Cada mes devuelve además `payments: { [debtId]: monto pagado }` (mínimo o elegido + barrido; incluye la deuda `_deficit` si existe), junto a `debtPayments`.

## 8. `demo.js`

`demo(today?)` → estado v2 completo, ilustrativo: sueldo $900.000, movilidad $300.000 por 22 días (sin cobro en enero, 15 días en julio), aguinaldo estimado, gastos de la casa y gustos estimados,
préstamos de $80.000 x 10 y $12.000 x 29 por planilla, tarjeta de $1.800.000 al 6,49% con mínimo $270.000 (resumen cargado hace pocos días), "Hijo" debe $400.000, plan de AFIP pendiente. `settings.demo = true` (cinta ámbar "Esto es un ejemplo, no son tus números · Cargar lo mío").
Con hoy = 4/10/2026: octubre $84.364 (Alcanza), noviembre $70.727, diciembre $534.364, enero −$202.000 (Falta plata), salís de la tarjeta en marzo de 2027, solo con el mínimo en julio de 2027. La app solo lo ofrece si no hay datos propios.
