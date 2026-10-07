// api/estado.js · función serverless de Vercel: guarda el estado de la familia en un Vercel Blob PRIVADO y lo comparte entre celulares.
// Contrato (ver docs/sync.md):
//   GET            -> 200 { rev, savedAt, state }       (rev 0 y state null si todavía no hay nada)
//   GET ?meta=1    -> 200 { rev, savedAt }              (liviano: sin el estado)
//   PUT { baseRev, state } -> 200 { rev, savedAt }      si baseRev === rev actual (guarda y sube rev en 1)
//                          -> 409 { rev, savedAt, state } si no (devuelve el estado actual)
// La clave compartida va en la variable de entorno MC_CLAVE y llega en el header "Authorization: Bearer <clave>".
// Clave ausente o incorrecta: 404 genérico (no se revela que esto existe). Sin MC_CLAVE o sin BLOB_READ_WRITE_TOKEN: 503 { error: 'sin-nube' }.
// La lógica vive en makeHandler({ blob, env }) para poder probarla con un Blob en memoria (test/api.test.js); el export default usa el real.

import { createHash, timingSafeEqual } from 'node:crypto';

export const BLOB_PATH = 'miscuentas/estado.json';
export const MAX_BODY = 1024 * 1024; // 1 MB
export const MIN_CLAVE = 8;

const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
const LISTAS = ['people', 'incomes', 'expenses', 'installments', 'debts', 'receivables', 'spent', 'plannedPurchases', 'pending'];

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const sha = (s) => createHash('sha256').update(String(s)).digest();

/** Comparación en tiempo constante: se comparan hashes (misma longitud), así no importa cuánto de la clave coincide. */
export function claveCorrecta(header, clave) {
  const m = /^Bearer (.+)$/.exec(typeof header === 'string' ? header : '');
  const dada = m ? m[1].trim() : '';
  const igual = timingSafeEqual(sha(dada), sha(clave));
  return Boolean(m) && igual;
}

/** Validación mínima: un objeto con settings y las listas básicas como arrays. El modelo completo lo valida el cliente. */
export function estadoValido(state) {
  if (!isObj(state) || !isObj(state.settings)) return false;
  for (const k of LISTAS) if (state[k] !== undefined && !Array.isArray(state[k])) return false;
  return true;
}

const esPrecondicion = (e) => e && (e.name === 'BlobPreconditionFailedError' || /precondition|already exists/i.test(String(e.message || '')));

async function leerCuerpo(req) {
  const declarado = Number(req.headers?.['content-length']);
  if (Number.isFinite(declarado) && declarado > MAX_BODY) return { error: 413 };
  let raw = req.body;
  if (raw === undefined || raw === null) {
    // sin cuerpo ya leído por la plataforma: se lee el stream cortando al pasar el límite
    const partes = [];
    let total = 0;
    try {
      for await (const parte of req) {
        const b = Buffer.isBuffer(parte) ? parte : Buffer.from(parte);
        total += b.length;
        if (total > MAX_BODY) return { error: 413 };
        partes.push(b);
      }
    } catch {
      return { error: 400 };
    }
    raw = Buffer.concat(partes).toString('utf8');
  } else if (Buffer.isBuffer(raw)) {
    if (raw.length > MAX_BODY) return { error: 413 };
    raw = raw.toString('utf8');
  }
  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw) > MAX_BODY) return { error: 413 };
    try {
      return { json: JSON.parse(raw) };
    } catch {
      return { error: 400 };
    }
  }
  if (isObj(raw)) {
    let largo = 0;
    try { largo = Buffer.byteLength(JSON.stringify(raw)); } catch { return { error: 400 }; }
    return largo > MAX_BODY ? { error: 413 } : { json: raw };
  }
  return { error: 400 };
}

export function makeHandler({ blob, env = process.env, now = () => Date.now() }) {
  return async function handler(req, res) {
    const send = (code, body, extra = {}) => {
      res.statusCode = code;
      for (const [k, v] of Object.entries({ ...HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extra })) res.setHeader(k, v);
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    try {
      const clave = String(env.MC_CLAVE || '').trim();
      if (clave.length < MIN_CLAVE || !env.BLOB_READ_WRITE_TOKEN) {
        // Solo nombres de lo que falta configurar (nunca valores): sirve para diagnosticar el panel de Vercel.
        const falta = [];
        if (clave.length < MIN_CLAVE) falta.push('MC_CLAVE');
        if (!env.BLOB_READ_WRITE_TOKEN) falta.push('BLOB_READ_WRITE_TOKEN');
        return send(503, { error: 'sin-nube', falta });
      }
      if (!claveCorrecta(req.headers?.authorization ?? req.headers?.Authorization, clave)) return send(404, { error: 'no-encontrado' });
      const metodo = String(req.method || '').toUpperCase();
      if (metodo !== 'GET' && metodo !== 'PUT') return send(405, { error: 'metodo' }, { Allow: 'GET, PUT' });

      const leer = async () => {
        const r = await blob.get(BLOB_PATH, { access: 'private', useCache: false });
        if (!r) return { rev: 0, savedAt: null, state: null, etag: null };
        if (r.statusCode !== 200 || !r.stream) throw new Error('lectura');
        const doc = JSON.parse(await new Response(r.stream).text());
        if (!isObj(doc) || !Number.isInteger(doc.rev) || doc.rev < 0) throw new Error('formato');
        return { rev: doc.rev, savedAt: typeof doc.savedAt === 'string' ? doc.savedAt : null, state: isObj(doc.state) ? doc.state : null, etag: r.blob?.etag || null };
      };

      if (metodo === 'GET') {
        const cur = await leer();
        const soloMeta = new URL(req.url || '/', 'http://local').searchParams.get('meta') === '1';
        return send(200, soloMeta ? { rev: cur.rev, savedAt: cur.savedAt } : { rev: cur.rev, savedAt: cur.savedAt, state: cur.state });
      }

      const cuerpo = await leerCuerpo(req);
      if (cuerpo.error) return send(cuerpo.error, { error: cuerpo.error === 413 ? 'muy-grande' : 'cuerpo' });
      const { baseRev, state } = cuerpo.json || {};
      if (!Number.isInteger(baseRev) || baseRev < 0 || !estadoValido(state)) return send(400, { error: 'invalido' });

      const cur = await leer();
      if (cur.rev !== baseRev) return send(409, { rev: cur.rev, savedAt: cur.savedAt, state: cur.state });
      const doc = { rev: cur.rev + 1, savedAt: new Date(now()).toISOString(), state };
      try {
        // ifMatch: el guardado solo vale si nadie escribió entre la lectura y la escritura (si no, el Blob lo rechaza)
        await blob.put(BLOB_PATH, JSON.stringify(doc), {
          access: 'private', addRandomSuffix: false, contentType: 'application/json', cacheControlMaxAge: 60,
          ...(cur.etag ? { allowOverwrite: true, ifMatch: cur.etag } : { allowOverwrite: cur.rev > 0 }),
        });
      } catch (e) {
        const ahora = await leer();
        if (ahora.rev !== cur.rev || esPrecondicion(e)) return send(409, { rev: ahora.rev, savedAt: ahora.savedAt, state: ahora.state });
        throw e;
      }
      return send(200, { rev: doc.rev, savedAt: doc.savedAt });
    } catch (e) {
      console.error('[estado] fallo de almacenamiento', e && e.name); // nunca se loguea el mensaje, el cuerpo ni la clave
      return send(502, { error: 'nube' });
    }
  };
}

let real = null;
/** Función real de Vercel: carga @vercel/blob recién al primer pedido (los tests nunca llegan acá). */
export default async function handler(req, res) {
  try {
    if (!real) real = makeHandler({ blob: await import('@vercel/blob') });
  } catch {
    res.statusCode = 502;
    for (const [k, v] of Object.entries({ ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' })) res.setHeader(k, v);
    res.end(JSON.stringify({ error: 'nube' }));
    return undefined;
  }
  return real(req, res);
}
