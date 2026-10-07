// Doble en memoria de @vercel/blob (solo get y put con lo que usa api/estado.js). No es un test: lo importan api.test.js y sync.test.js.
// Imita: get -> null si no existe, o { statusCode:200, stream, blob:{ etag } }; put con allowOverwrite / ifMatch (BlobPreconditionFailedError).

export function makeBlobDouble() {
  const files = new Map(); // pathname -> { body, etag }
  let n = 0;
  const calls = { get: [], put: [] };
  const api = {
    files,
    calls,
    failNext: null, // { op:'get'|'put', error } para simular caídas
    async get(pathname, opts = {}) {
      calls.get.push({ pathname, opts });
      if (api.failNext?.op === 'get') { const e = api.failNext.error; api.failNext = null; throw e; }
      if (opts.access !== 'private') throw new Error('el blob tiene que ser privado');
      const f = files.get(pathname);
      if (!f) return null;
      return { statusCode: 200, stream: new Response(f.body).body, headers: new Headers(), blob: { pathname, etag: f.etag, size: f.body.length, contentType: 'application/json' } };
    },
    async put(pathname, body, opts = {}) {
      calls.put.push({ pathname, body, opts });
      if (api.failNext?.op === 'put') { const e = api.failNext.error; api.failNext = null; throw e; }
      if (opts.access !== 'private') throw new Error('el blob tiene que ser privado');
      if (opts.addRandomSuffix !== false) throw new Error('addRandomSuffix debe ser false');
      const ya = files.get(pathname);
      if (opts.ifMatch !== undefined && (!ya || ya.etag !== opts.ifMatch)) {
        const e = new Error('Precondition failed: ETag mismatch.');
        e.name = 'BlobPreconditionFailedError';
        throw e;
      }
      if (ya && !opts.allowOverwrite && opts.ifMatch === undefined) throw new Error('This blob already exists, use `allowOverwrite: true` to overwrite it');
      files.set(pathname, { body: String(body), etag: `"e${++n}"` });
      return { pathname, url: `https://store.private.blob.example/${pathname}`, etag: files.get(pathname).etag };
    },
  };
  return api;
}

/** req/res mínimos con la forma de Node/Vercel. */
export function fakeReq({ method = 'GET', url = '/api/estado', headers = {}, body } = {}) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { method, url, headers: h, body };
}
export function fakeRes() {
  const res = {
    statusCode: 200, headers: {}, texto: '',
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; },
    end(t = '') { res.texto = t; res.terminada = true; },
    get json() { return res.texto ? JSON.parse(res.texto) : null; },
  };
  return res;
}
