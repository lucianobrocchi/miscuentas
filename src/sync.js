// sync.js · sincronización con la nube (lógica PURA y probable en node: fetch, storage, reloj, timers y avisos se inyectan).
// Qué hace: guarda lo que carga cada celular en /api/estado (ver api/estado.js y docs/sync.md) y trae lo que cargaron los demás,
// sin pisar nunca nada en silencio: si dos celulares cambiaron cosas distintas se juntan solas; si hay duda, se le pregunta a la persona.
// La clave compartida vive en localStorage ('miscuentas.k'). No se muestra, no se loguea y solo viaja en el header Authorization.
// Las preferencias de ESTE celular (tema, letra, privacidad, etc.) no se sincronizan y se conservan al aplicar lo de la nube.

import { normalize, importJSON, describeState } from './store.js';

export const KEY_STORAGE = 'miscuentas.k';
export const META_STORAGE = 'miscuentas.sync';
export const ENDPOINT = '/api/estado';
export const DEBOUNCE_MS = 1500;
export const POLL_MS = 45000;
export const BACKOFF_MS = [2000, 4000, 8000, 16000, 32000, 60000]; // 2, 4, 8, 16 s... con tope de 60 s
export const TIMEOUT_MS = 20000;
/** Preferencias de este dispositivo: nunca suben ni se pisan con lo de la nube. */
export const LOCAL_SETTINGS = ['theme', 'fontSize', 'privacy', 'mesesMode', 'lastBackupAt', 'onboardingStep', 'demo'];
const LISTAS = ['people', 'incomes', 'expenses', 'installments', 'debts', 'receivables', 'spent', 'plannedPurchases', 'pending'];
const LISTAS_CON_PERSONAS = ['incomes', 'expenses', 'installments', 'debts', 'receivables']; // referencian personas por nombre o id

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const copia = (x) => JSON.parse(JSON.stringify(x));

// ---------------------------------------------------------------- utilidades puras
function ordenar(x) {
  if (Array.isArray(x)) return x.map(ordenar);
  if (isObj(x)) return Object.fromEntries(Object.keys(x).sort().map((k) => [k, ordenar(x[k])]));
  return x;
}
/** Texto canónico (claves ordenadas, sin undefined): sirve para comparar estados. */
export const canon = (x) => JSON.stringify(ordenar(x === undefined ? null : JSON.parse(JSON.stringify(x))));

/** El estado sin las preferencias de este dispositivo: lo que se comparte. */
export function syncable(state) {
  const o = copia(state);
  if (isObj(o.settings)) for (const k of LOCAL_SETTINGS) delete o.settings[k];
  return o;
}

/** ¿Tiene algo propio cargado (no el ejemplo)? */
export function hasOwnData(state) {
  if (!state || state.settings?.demo) return false;
  return ['incomes', 'expenses', 'installments', 'debts', 'receivables', 'spent', 'plannedPurchases', 'people'].some((k) => Array.isArray(state[k]) && state[k].length > 0);
}

/** Lee un estado que vino de la nube pasándolo por importJSON/normalize (nunca se confía en la forma). -> { ok, state } | { ok:false, mensaje } */
export function leerEstadoRemoto(state, today = new Date()) {
  let texto;
  try { texto = JSON.stringify(state); } catch { return { ok: false, mensaje: 'Los datos de la nube no se pudieron leer.' }; }
  const r = importJSON(texto, { today });
  return r.ok ? { ok: true, state: r.state } : { ok: false, mensaje: r.mensaje };
}

/** Arma el estado a aplicar: lo de la nube más las preferencias de ESTE celular. Si estaba el ejemplo, deja de estarlo. */
export function conPreferenciasLocales(remoto, local, today = new Date()) {
  const next = copia(remoto);
  for (const k of LOCAL_SETTINGS) if (local?.settings && local.settings[k] !== undefined) next.settings[k] = local.settings[k];
  next.settings.demo = false;
  return normalize(next, { today });
}

// ---------------------------------------------------------------- clave en el link
const clavePosible = (s) => typeof s === 'string' && /^\S{4,256}$/.test(s);

/**
 * Lee la clave del link (#k=... o ?k=...), la guarda y la borra de la dirección. Se llama ANTES de que arranque el router.
 * Nunca devuelve ni registra la clave. Si la clave cambió, se descarta lo que se sabía de la nube (se vuelve a decidir con la nueva).
 */
export function captureKey({ location, history, storage }) {
  let encontrada = null;
  let limpiar = false;
  let hash = location.hash || '';
  let search = location.search || '';
  const mh = /^#k=([^&]*)(?:&(.*))?$/.exec(hash);
  if (mh) {
    try { encontrada = decodeURIComponent(mh[1]); } catch { encontrada = mh[1]; }
    hash = mh[2] ? `#${mh[2]}` : '';
    limpiar = true;
  }
  if (/[?&]k=/.test(search)) {
    const sp = new URLSearchParams(search);
    if (encontrada === null) encontrada = sp.get('k');
    sp.delete('k');
    const resto = sp.toString();
    search = resto ? `?${resto}` : '';
    limpiar = true;
  }
  if (!limpiar) return { capturada: false };
  let capturada = false;
  if (clavePosible(encontrada)) {
    try {
      const previa = storage.getItem(KEY_STORAGE);
      storage.setItem(KEY_STORAGE, encontrada);
      if (previa && previa !== encontrada) storage.removeItem(META_STORAGE);
      capturada = true;
    } catch { /* sin almacenamiento: la app sigue solo en el celular */ }
  }
  try { history.replaceState(history.state, '', location.pathname + search + hash); } catch { /* nada */ }
  return { capturada };
}

export function getKey(storage) {
  try { const k = storage.getItem(KEY_STORAGE); return clavePosible(k) ? k : null; } catch { return null; }
}
/** Desconecta este celular de la nube (no borra nada de lo cargado). */
export function forgetKey(storage) {
  try { storage.removeItem(KEY_STORAGE); storage.removeItem(META_STORAGE); } catch { /* nada */ }
}
/** El link para compartir con la familia (con la clave en el fragmento). Solo para copiarlo o mandarlo: no se muestra en pantalla. */
export function shareLink(storage, origin, pathname = '/') {
  const k = getKey(storage);
  return k ? `${origin}${pathname}#k=${encodeURIComponent(k)}` : null;
}

// ---------------------------------------------------------------- merge por id (solo si es inequívoco)
const igual = (a, b) => canon(a) === canon(b);

function indexar(lista) {
  const m = new Map();
  for (const x of lista || []) {
    if (!isObj(x) || typeof x.id !== 'string' || !x.id || m.has(x.id)) return null;
    m.set(x.id, x);
  }
  return m;
}

function juntarLista(nombre, b, l, r) {
  const bm = indexar(b), lm = indexar(l), rm = indexar(r);
  if (!bm || !lm || !rm) return { ok: false, motivo: `Hay datos repetidos o sin identificar en ${nombre}.` };
  const out = new Map();
  let tocoLocal = false;
  let tocoRemoto = false;
  for (const id of new Set([...bm.keys(), ...lm.keys(), ...rm.keys()])) {
    const bv = bm.get(id), lv = lm.get(id), rv = rm.get(id);
    const lc = !igual(bv, lv), rc = !igual(bv, rv);
    let res;
    if (!lc && !rc) res = rv;
    else if (lc && !rc) { res = lv; tocoLocal = true; }
    else if (!lc && rc) { res = rv; tocoRemoto = true; }
    else if (igual(lv, rv)) { res = rv; tocoLocal = true; tocoRemoto = true; }
    else return { ok: false, motivo: `Los dos cambiaron el mismo dato de ${nombre}.` };
    if (res !== undefined) out.set(id, res);
  }
  const lista = [];
  for (const x of r) if (out.has(x.id)) lista.push(out.get(x.id));
  for (const x of l) if (!rm.has(x.id) && out.has(x.id)) lista.push(out.get(x.id));
  const quitados = (lado) => [...bm.keys()].filter((id) => !lado.has(id));
  return { ok: true, lista, tocoLocal, tocoRemoto, quitadosLocal: quitados(lm), quitadosRemoto: quitados(rm) };
}

/**
 * Junta lo que cambió cada lado desde la última vez que coincidían (base), sin preguntar, SOLO si es inequívoco: ningún elemento
 * (por id) ni ajuste fue tocado por los dos lados de forma distinta. Recibe las tres partes ya normalizadas y sin preferencias locales.
 * -> { ok:true, state, tocoLocal, tocoRemoto } | { ok:false, motivo }
 */
export function mergeStates(base, local, remoto) {
  if (!isObj(base) || !isObj(local) || !isObj(remoto)) return { ok: false, motivo: 'No hay un punto en común para comparar.' };
  const out = { v: Math.max(Number(local.v) || 0, Number(remoto.v) || 0, Number(base.v) || 0) };
  let tocoLocal = false;
  let tocoRemoto = false;
  const flags = {};
  for (const nombre of LISTAS) {
    const m = juntarLista(nombre, base[nombre] || [], local[nombre] || [], remoto[nombre] || []);
    if (!m.ok) return m;
    out[nombre] = m.lista;
    flags[nombre] = m;
    tocoLocal ||= m.tocoLocal;
    tocoRemoto ||= m.tocoRemoto;
  }
  // si un lado sacó a una persona y el otro tocó datos que la nombran, no se puede saber qué quedó bien
  const p = flags.people;
  for (const [quita, otro] of [['quitadosLocal', 'tocoRemoto'], ['quitadosRemoto', 'tocoLocal']]) {
    if (p[quita].length && LISTAS_CON_PERSONAS.some((n) => flags[n][otro])) return { ok: false, motivo: 'Una persona se borró mientras el otro lado cargaba datos.' };
  }
  const bs = base.settings || {}, ls = local.settings || {}, rs = remoto.settings || {};
  const settings = {};
  for (const k of new Set([...Object.keys(bs), ...Object.keys(ls), ...Object.keys(rs)])) {
    if (LOCAL_SETTINGS.includes(k) || k === 'people') continue; // people (texto) se rearma solo desde la lista de personas
    if (k === 'pasos') {
      const pasos = {};
      for (const o of [rs.pasos, ls.pasos]) if (isObj(o)) for (const [pk, pv] of Object.entries(o)) if (pv === true) pasos[pk] = true;
      settings.pasos = pasos;
      if (!igual(ls.pasos, bs.pasos)) tocoLocal = true;
      if (!igual(rs.pasos, bs.pasos)) tocoRemoto = true;
      continue;
    }
    const lc = !igual(bs[k], ls[k]), rc = !igual(bs[k], rs[k]);
    let res;
    if (!lc && !rc) res = rs[k];
    else if (lc && !rc) { res = ls[k]; tocoLocal = true; }
    else if (!lc && rc) { res = rs[k]; tocoRemoto = true; }
    else if (igual(ls[k], rs[k])) { res = rs[k]; tocoLocal = true; tocoRemoto = true; }
    else return { ok: false, motivo: 'Los dos cambiaron el mismo ajuste.' };
    if (res !== undefined) settings[k] = res;
  }
  out.settings = settings;
  // "lo que ya se mostró": se junta todo; si los dos fijaron la proyección del mismo mes, queda la de la nube (no es un dato que cargó nadie)
  const sl = isObj(local.seen) ? local.seen : {}, sr = isObj(remoto.seen) ? remoto.seen : {};
  const seen = {};
  for (const t of ['hitos', 'tips', 'cierres']) seen[t] = [...new Set([...(sr[t] || []), ...(sl[t] || [])])];
  seen.proyecciones = { ...(sl.proyecciones || {}), ...(sr.proyecciones || {}) };
  out.seen = seen;
  if (!igual(local.seen, base.seen)) tocoLocal = true;
  if (!igual(remoto.seen, base.seen)) tocoRemoto = true;
  return { ok: true, state: out, tocoLocal, tocoRemoto };
}

// ---------------------------------------------------------------- el sincronizador
/**
 * createSync({ fetch, storage, getState, applyState, ... }) -> controlador.
 *  getState()                 estado actual de la app
 *  applyState(state, {kind})  reemplaza el estado de la app (guarda, re-dibuja). NO debe volver a llamar a changed().
 *  choose(info) / conflict(info)  hojas: devuelven Promise<'nube' | 'mio' | null> (null = decidir después)
 *  notify(kind, datos)        avisos: 'actualizado' | 'bajado' | 'unido' | 'invalido' | 'despues'
 *  canApply()                 false si la persona está en medio de algo (hoja abierta, escribiendo): se pospone
 * Estados (status.code): inicio · ok · guardando · offline · error · sin-nube · clave · decidir · invalido
 */
export function createSync(opts) {
  const {
    fetch: fetchFn, storage, getState, applyState, now = () => Date.now(), today = () => new Date(),
    setTimeout: st = globalThis.setTimeout.bind(globalThis), clearTimeout: ct = globalThis.clearTimeout.bind(globalThis),
    choose = async () => null, conflict = async () => null, notify = () => {}, canApply = () => true, isVisible = () => true,
    endpoint = ENDPOINT, onStatus = () => {},
  } = opts;

  let key = getKey(storage);
  let meta = leerMeta();
  let status = { code: 'inicio' };
  let debounceT = null, retryT = null, pollT = null;
  let retryN = 0;
  let cola = Promise.resolve();
  let bloqueado = false; // hay una decisión pendiente: no se sube nada hasta resolverla
  let decidiendo = false;
  let aplicando = false;
  let pendiente_ = null; // { tipo, remote } mientras haya decisión pendiente
  let detenido = false;
  let ultimoPoll = 0;
  const oyentes = new Set([onStatus]);

  function leerMeta() {
    try {
      const o = JSON.parse(storage.getItem(META_STORAGE));
      if (isObj(o) && (o.baseRev === null || Number.isInteger(o.baseRev)) && (o.base === null || isObj(o.base))) return { baseRev: o.baseRev, base: o.base, savedAt: typeof o.savedAt === 'string' ? o.savedAt : null };
    } catch { /* sin datos previos */ }
    return { baseRev: null, base: null, savedAt: null };
  }
  function guardarMeta() {
    try { storage.setItem(META_STORAGE, JSON.stringify(meta)); } catch { /* sin espacio: se vuelve a decidir al abrir */ }
  }

  const vista = (s) => syncable(normalize(s, { today: today() }));
  const baseCanon = () => (meta.base ? canon(meta.base) : null);
  /** ¿Hay cambios de este celular que todavía no están en la nube? */
  function pendienteDeSubir() {
    if (meta.baseRev === null) return false;
    if (meta.base === null) return true;
    return canon(vista(getState())) !== baseCanon();
  }

  function setStatus(code, extra = {}) {
    status = { code, rev: meta.baseRev, savedAt: meta.savedAt, pendiente: code === 'guardando' || code === 'offline' || code === 'error', ...extra };
    for (const f of oyentes) { try { f(status); } catch { /* un oyente roto no frena la sincronización */ } }
  }

  // ---- red
  async function request(method, body, query = '') {
    let timer = null;
    let ctl = null;
    try {
      ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const tiempo = new Promise((_, rej) => { timer = st(() => { try { ctl?.abort(); } catch { /* nada */ } rej(new Error('tiempo')); }, TIMEOUT_MS); });
      const res = await Promise.race([
        fetchFn(endpoint + query, {
          method, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl?.signal,
          headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        }),
        tiempo,
      ]);
      let json = null;
      try { json = await res.json(); } catch { /* sin cuerpo */ }
      return { status: res.status, json };
    } catch {
      return { status: 0, json: null };
    } finally {
      if (timer !== null) ct(timer);
    }
  }

  const serial = (fn) => { const p = cola.then(fn); cola = p.catch(() => {}); return p; };

  function limpiarRetry() { ct(retryT); retryT = null; }

  function reintentar(ms) {
    limpiarRetry();
    const espera = ms ?? BACKOFF_MS[Math.min(retryN, BACKOFF_MS.length - 1)];
    if (ms === undefined) retryN++;
    retryT = st(() => { retryT = null; serial(() => reconciliar()).catch(() => {}); }, espera);
  }

  /** Respuesta que no es 200: decide qué estado mostrar y si reintenta. */
  function fallo(r) {
    if (r.status === 503 && r.json?.error === 'sin-nube') return setStatus('sin-nube', { motivo: 'servidor' });
    if (r.status === 404 || r.status === 401 || r.status === 403) return setStatus('clave');
    if (r.status === 413) return setStatus('error', { motivo: 'grande' });
    if (r.status === 400) return setStatus('error', { motivo: 'invalido' });
    const sinRed = r.status === 0;
    if (pendienteDeSubir() || meta.baseRev === null) {
      setStatus(sinRed ? 'offline' : 'error', { motivo: sinRed ? 'red' : 'servidor' });
      reintentar();
    }
    return undefined; // un pedido de fondo que falla sin nada pendiente no molesta: el próximo lo reintenta
  }

  const remotoValido = (j) => isObj(j) && Number.isInteger(j.rev) && j.rev >= 0;

  // ---- aplicar
  function aplicar(remote, remState, kind) {
    const next = conPreferenciasLocales(remState, getState(), today());
    aplicando = true;
    try { applyState(next, { kind }); } finally { aplicando = false; }
    meta = { baseRev: remote.rev, base: vista(next), savedAt: remote.savedAt || null };
    guardarMeta();
    bloqueado = false;
    pendiente_ = null;
    retryN = 0;
    setStatus('ok');
    notify(kind, {});
  }

  function adoptar(remote, remPortion) {
    meta = { baseRev: remote.rev, base: remPortion, savedAt: remote.savedAt || null };
    guardarMeta();
    bloqueado = false;
    pendiente_ = null;
    setStatus('ok');
  }

  function posponer() { reintentar(5000); }

  function infoDe(tipo, remote, remState, motivo) {
    return {
      kind: tipo, motivo, savedAt: remote?.savedAt || null,
      remote: remState ? { rev: remote.rev, resumen: describeState(remState) } : null,
      local: { resumen: describeState(getState()) },
    };
  }

  async function preguntar(tipo, remote, remState, motivo) {
    const quien = tipo === 'primera' ? choose : conflict;
    decidiendo = true;
    let eleccion = null;
    try { eleccion = await quien(infoDe(tipo, remote, remState, motivo)); } catch { eleccion = null; }
    decidiendo = false;
    if (eleccion === 'nube' && remState) { aplicar(remote, remState, 'bajado'); return; }
    if (eleccion === 'mio') {
      meta = { baseRev: remote.rev, base: remState ? vista(remState) : null, savedAt: remote.savedAt || null };
      guardarMeta();
      bloqueado = false;
      pendiente_ = null;
      await subir();
      return;
    }
    bloqueado = true;
    pendiente_ = { tipo, remote };
    setStatus(tipo === 'invalido' ? 'invalido' : 'decidir', { tipo });
    notify('despues', { tipo });
  }

  // ---- primera vez en este celular (o clave nueva)
  async function primera(remote) {
    const local = getState();
    const propio = hasOwnData(local);
    if (remote.state === null || remote.rev === 0) {
      if (propio) { meta = { baseRev: 0, base: null, savedAt: null }; guardarMeta(); return subir(); } // siembra la nube con lo de este celular
      meta = { baseRev: 0, base: vista(local), savedAt: null };
      guardarMeta();
      setStatus('ok');
      return undefined;
    }
    const rem = leerEstadoRemoto(remote.state, today());
    if (!rem.ok) { bloqueado = true; pendiente_ = { tipo: 'invalido', remote }; setStatus('invalido', { mensaje: rem.mensaje, tipo: 'invalido' }); notify('invalido', { mensaje: rem.mensaje }); return undefined; }
    const remPortion = vista(rem.state);
    if (!hasOwnData(rem.state)) {
      if (!propio) { adoptar(remote, remPortion); return undefined; }
      meta = { baseRev: remote.rev, base: remPortion, savedAt: remote.savedAt || null }; guardarMeta(); return subir(); // la nube está vacía de datos
    }
    if (!propio) { if (!canApply()) return posponer(); aplicar(remote, rem.state, 'bajado'); return undefined; }
    if (canon(vista(local)) === canon(remPortion)) { adoptar(remote, remPortion); return undefined; }
    if (!canApply()) return posponer();
    return preguntar('primera', remote, rem.state);
  }

  // ---- la nube cambió desde la última vez
  async function nubeCambio(remote, profundidad = 0) {
    const local = getState();
    if (remote.state === null || remote.rev === 0) { // la nube quedó vacía: se vuelve a sembrar con lo de este celular
      if (hasOwnData(local)) { meta = { baseRev: 0, base: null, savedAt: null }; guardarMeta(); return subir(profundidad); }
      meta = { baseRev: 0, base: vista(local), savedAt: null }; guardarMeta(); setStatus('ok'); return undefined;
    }
    const rem = leerEstadoRemoto(remote.state, today());
    if (!rem.ok) { bloqueado = true; pendiente_ = { tipo: 'invalido', remote }; setStatus('invalido', { mensaje: rem.mensaje, tipo: 'invalido' }); notify('invalido', { mensaje: rem.mensaje }); return undefined; }
    const remPortion = vista(rem.state);
    const localPortion = vista(local);
    if (canon(localPortion) === canon(remPortion)) { adoptar(remote, localPortion); return undefined; }
    if (!pendienteDeSubir()) { if (!canApply()) return posponer(); aplicar(remote, rem.state, 'actualizado'); return undefined; }
    const m = mergeStates(meta.base ? vista(meta.base) : null, localPortion, remPortion);
    if (m.ok) {
      const unido = leerEstadoRemoto(m.state, today());
      if (unido.ok) {
        if (!canApply()) return posponer();
        const next = conPreferenciasLocales(unido.state, local, today());
        aplicando = true;
        try { applyState(next, { kind: 'unido' }); } finally { aplicando = false; }
        meta = { baseRev: remote.rev, base: remPortion, savedAt: remote.savedAt || null };
        guardarMeta();
        notify('unido', {});
        if (pendienteDeSubir()) return subir(profundidad + 1);
        setStatus('ok');
        return undefined;
      }
    }
    if (!canApply()) return posponer();
    return preguntar('conflicto', remote, rem.state, m.motivo);
  }

  // ---- reconciliar (consultar la nube) y subir
  async function reconciliar({ liviano = false } = {}) {
    if (detenido) return undefined;
    if (!key) { setStatus('sin-nube', { motivo: 'sin-clave' }); return undefined; }
    if (bloqueado || decidiendo) return undefined;
    const soloRev = liviano && meta.baseRev !== null;
    let r = await request('GET', null, soloRev ? '?meta=1' : '');
    if (r.status !== 200 || !remotoValido(r.json)) return fallo(r);
    retryN = 0;
    if (meta.baseRev === null) return primera(r.json);
    if (r.json.rev === meta.baseRev) {
      if (pendienteDeSubir() && !getState()?.settings?.demo) return subir();
      if (status.code !== 'ok') setStatus('ok');
      return undefined;
    }
    if (soloRev) {
      r = await request('GET');
      if (r.status !== 200 || !remotoValido(r.json)) return fallo(r);
    }
    return nubeCambio(r.json);
  }

  async function subir(profundidad = 0) {
    if (detenido || !key || bloqueado || meta.baseRev === null) return undefined;
    const local = getState();
    if (local?.settings?.demo) return undefined;
    if (profundidad > 4) { reintentar(); return undefined; }
    const porcion = vista(local);
    if (meta.base && canon(porcion) === baseCanon()) { setStatus('ok'); return undefined; }
    setStatus('guardando');
    const r = await request('PUT', { baseRev: meta.baseRev, state: porcion });
    if (r.status === 200 && isObj(r.json) && Number.isInteger(r.json.rev)) {
      meta = { baseRev: r.json.rev, base: porcion, savedAt: r.json.savedAt || new Date(now()).toISOString() };
      guardarMeta();
      retryN = 0;
      limpiarRetry();
      if (pendienteDeSubir()) programarSubida(); // cambió algo mientras se subía
      else setStatus('ok');
      return undefined;
    }
    if (r.status === 409 && remotoValido(r.json)) return nubeCambio(r.json, profundidad);
    return fallo(r);
  }

  function programarSubida() {
    ct(debounceT);
    debounceT = st(() => { debounceT = null; serial(() => subir()).catch(() => {}); }, DEBOUNCE_MS);
  }

  function programarPoll() {
    ct(pollT);
    pollT = st(() => {
      pollT = null;
      if (!detenido && isVisible() && !bloqueado && !decidiendo && retryT === null && status.code !== 'sin-nube' && status.code !== 'clave') serial(() => reconciliar({ liviano: true })).catch(() => {}).finally(programarPoll);
      else if (!detenido) programarPoll();
    }, POLL_MS);
  }

  // ---- API pública
  return {
    /** Arranca: primera consulta y vigilancia cada 45 s. Sin clave no hace nada (la app sigue solo en el celular). */
    start() {
      detenido = false;
      key = getKey(storage);
      if (!key) { setStatus('sin-nube', { motivo: 'sin-clave' }); return Promise.resolve(); }
      setStatus(meta.baseRev === null ? 'inicio' : pendienteDeSubir() ? 'guardando' : 'ok');
      programarPoll();
      return serial(() => reconciliar()).catch(() => {});
    },
    stop() { detenido = true; ct(debounceT); limpiarRetry(); ct(pollT); },
    /** Avisar que cambió el estado de la app por algo que hizo la persona. Solo sube si cambió algo compartible. */
    changed() {
      if (!key || detenido || aplicando) return;
      if (meta.baseRev === null) return; // todavía no se sabe qué hay en la nube: se decide primero
      if (bloqueado) { if (pendienteDeSubir()) setStatus(status.code === 'invalido' ? 'invalido' : 'decidir', { tipo: pendiente_?.tipo }); return; }
      if (getState()?.settings?.demo) return;
      if (!pendienteDeSubir()) { if (status.code === 'guardando') setStatus('ok'); return; } // cambio de preferencias de este celular
      setStatus('guardando');
      programarSubida();
    },
    /** Consultar la nube ahora (al volver a primer plano, o a pedido). Se ignora si se consultó hace menos de 2 s. */
    poll({ forzar = false } = {}) {
      if (!key || detenido) return Promise.resolve();
      if (!forzar && now() - ultimoPoll < 2000) return Promise.resolve();
      ultimoPoll = now();
      if (status.code === 'sin-nube' || status.code === 'clave') { key = getKey(storage); if (!key) return Promise.resolve(); }
      programarPoll();
      return serial(() => reconciliar({ liviano: true })).catch(() => {});
    },
    /** Volvió la conexión: se reintenta ya, sin esperar el backoff. */
    online() {
      if (!key || detenido) return Promise.resolve();
      retryN = 0;
      limpiarRetry();
      return serial(() => reconciliar()).catch(() => {});
    },
    /** Subir ya lo pendiente (sin esperar el debounce). */
    flush() { ct(debounceT); debounceT = null; return serial(() => subir()).catch(() => {}); },
    /** Reabre la decisión pendiente (hoja de elección o de conflicto). */
    decidir() {
      if (!key) return Promise.resolve();
      bloqueado = false;
      const era = pendiente_;
      pendiente_ = null;
      return serial(async () => {
        if (era?.tipo === 'invalido') { await preguntar('invalido', era.remote, null, 'No se pudieron leer los datos de la nube.'); return; }
        await reconciliar();
      }).catch(() => {});
    },
    /** Después de "Restaurar una copia" o "Borrar todo" ya confirmados: se sube enseguida. */
    propagar() { return this.flush(); },
    subscribe(fn) { oyentes.add(fn); return () => oyentes.delete(fn); },
    status: () => status,
    hasKey: () => !!key,
    pendienteDeSubir,
    /** Estado interno mínimo (para pruebas y para mostrar "guardado el ..."). */
    info: () => ({ baseRev: meta.baseRev, savedAt: meta.savedAt, bloqueado, status }),
  };
}
