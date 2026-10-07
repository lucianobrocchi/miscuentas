// Apoyo de test/sync.test.js: reloj falso, "nube" (el handler REAL de api/estado.js con un Blob en memoria) y celulares de mentira.
import { makeHandler } from '../api/estado.js';
import { createSync, KEY_STORAGE } from '../src/sync.js';
import { normalize } from '../src/store.js';
import { makeBlobDouble, fakeReq, fakeRes } from './_blob-double.js';

export const KEY = 'clave-de-prueba-123'; // ilustrativa
export const ENV = { MC_CLAVE: KEY, BLOB_READ_WRITE_TOKEN: 'token-de-prueba' };

export const settle = async () => { for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r)); };

export function makeClock(start = Date.parse('2026-10-07T12:00:00Z')) {
  let t = start;
  let id = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimeout(fn, ms) { const i = ++id; timers.set(i, { at: t + ms, fn }); return i; },
    clearTimeout(i) { timers.delete(i); },
    pending: () => [...timers.values()].map((x) => x.at - t).sort((a, b) => a - b),
    async advance(ms) {
      const fin = t + ms;
      for (;;) {
        await settle();
        const due = [...timers.entries()].filter(([, x]) => x.at <= fin).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        t = Math.max(t, due[1].at);
        due[1].fn();
      }
      t = fin;
      await settle();
    },
  };
}

export function makeCloud(clock, { env = ENV } = {}) {
  const blob = makeBlobDouble();
  const handler = makeHandler({ blob, env, now: () => clock.now() });
  const net = { offline: false, hang: false, status: null, log: [], blob };
  net.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    net.log.push({ at: clock.now(), method, url: String(url), headers: init.headers || {}, body: init.body });
    if (net.offline) throw new TypeError('Failed to fetch');
    if (net.hang) return new Promise(() => {});
    if (net.status) return { status: net.status, json: async () => ({}) };
    const res = fakeRes();
    await handler(fakeReq({ method, url, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined }), res);
    return { status: res.statusCode, json: async () => res.json };
  };
  net.count = (method, filtro = () => true) => net.log.filter((l) => l.method === method && filtro(l)).length;
  net.doc = () => { const f = blob.files.get('miscuentas/estado.json'); return f ? JSON.parse(f.body) : null; };
  return net;
}

export const datos = (extra = {}, settings = {}) => normalize({
  settings: { onboarded: true, ...settings },
  people: [{ id: 'p1', name: 'Ana', role: 'yo' }],
  incomes: [{ id: 'i1', name: 'Sueldo', owner: 'Ana', amount: 1000, kind: 'sueldo' }],
  expenses: [{ id: 'e1', name: 'Alquiler', owner: 'Ana', amount: 400, kind: 'otro' }],
  ...extra,
});

export function makePhone({ clock, net, key = KEY, state, nombre = 'celular' } = {}) {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  if (key) storage.setItem(KEY_STORAGE, key);
  const p = { nombre, storage, store, state: state || normalize({}), applied: [], notices: [], chooses: [], conflicts: [], answer: { choose: null, conflict: null }, canApply: true, visible: true };
  p.make = () => createSync({
    fetch: (...a) => net.fetch(...a), storage, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    getState: () => p.state,
    applyState: (s, info) => { p.state = s; p.applied.push(info.kind); },
    choose: async (i) => { p.chooses.push(i); return p.answer.choose; },
    conflict: async (i) => { p.conflicts.push(i); return p.answer.conflict; },
    notify: (k, d) => p.notices.push(k),
    canApply: () => p.canApply,
    isVisible: () => p.visible,
  });
  p.ctrl = p.make();
  p.edit = (fn) => { const d = structuredClone(p.state); fn(d); p.state = d; p.ctrl.changed(); };
  p.start = async () => { const r = p.ctrl.start(); await settle(); return r; };
  p.restart = async () => { p.ctrl.stop(); p.ctrl = p.make(); return p.start(); };
  return p;
}
