// router.js · router por hash. "Atrás" del celular funciona porque cada pantalla es una entrada del
// historial. Las hojas inferiores manejan su propio historial en sheet.js (se apoyan en history.state.sd).
//
// Rutas (contrato E): #/hoy  #/meses  #/meses/YYYY-MM  #/puedo  #/deudas  #/deudas/tarjeta
//   #/deudas/medeben  #/deudas/medeben/<personId>  #/mas  #/mas/<sec>  #/bienvenida  #/armar/<1-7>
// Se puede agregar query: #/deudas/medeben/ab12?pagar=1  ->  params.query.pagar === '1'

/** Convierte '/meses/:key' en un matcher. */
function compile(route) {
  const segs = route.path.split('/').filter(Boolean);
  return {
    ...route,
    segs,
    test(parts) {
      if (parts.length > segs.length) return null;
      const params = {};
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const optional = s.endsWith('?');
        const name = s.replace(/^:/, '').replace(/\?$/, '');
        if (i >= parts.length) { if (s.startsWith(':') && optional) continue; return null; }
        if (s.startsWith(':')) params[name] = decodeURIComponent(parts[i]);
        else if (s !== parts[i]) return null;
      }
      return params;
    },
  };
}

/**
 * createRouter({ routes, fallback, onChange })
 *   routes: [{ name:'meses', path:'/meses/:key?', screen:'meses', tab:'meses', notabs?:true }]
 *           ':param' obligatorio, ':param?' opcional (solo al final).
 *   fallback: hash al que se va si la ruta no existe (ej. '#/hoy').
 *   onChange(route, info): route = { name, screen, tab, params, query, hash, notabs }; info = { kind:'initial'|'push'|'pop'|'replace' }
 * Devuelve { start, go, back, current, parse, href, history }.
 */
export function createRouter({ routes, fallback = '#/hoy', onChange }) {
  const table = routes.map(compile);
  let cur = null;
  const stack = [];

  function normalize(hash) {
    let s = (hash || '').replace(/^#/, '');
    if (!s.startsWith('/')) s = '/' + s;
    return s.replace(/\/+$/, '') || '/';
  }

  function parse(hash) {
    const raw = normalize(hash);
    const [path, qs = ''] = raw.split('?');
    const parts = path.split('/').filter(Boolean);
    for (const r of table) {
      const params = r.test(parts);
      if (params) {
        const query = Object.fromEntries(new URLSearchParams(qs));
        return { name: r.name, screen: r.screen || r.name, tab: r.tab || null, notabs: !!r.notabs, params, query, hash: '#' + raw };
      }
    }
    return null;
  }

  function resolve(kind) {
    let route = parse(location.hash);
    if (!route) {
      location.replace(fallback);          // dispara hashchange otra vez
      return;
    }
    const prev = cur;
    if (kind === 'push' || kind === 'initial') {
      if (stack[stack.length - 2] === route.hash) { stack.pop(); kind = 'pop'; }
      else if (stack[stack.length - 1] !== route.hash) stack.push(route.hash);
    } else if (kind === 'replace') {
      stack[stack.length ? stack.length - 1 : 0] = route.hash;
    }
    cur = route;
    onChange?.(route, { kind, prev });
  }

  let replacing = false;
  const onHash = () => { resolve(replacing ? 'replace' : 'push'); replacing = false; };

  /** Navega. go('#/meses/2026-12') · go('#/hoy', {replace:true}). Si es la misma ruta no hace nada. */
  function go(hash, { replace = false } = {}) {
    const target = '#' + normalize(hash);
    if (cur && target === cur.hash) return;
    if (replace) { replacing = true; location.replace(target); }
    else location.hash = target;
  }

  /** Vuelve una pantalla; si no hay historial propio, va a `fallbackHash` (reemplazando). */
  function back(fallbackHash = fallback) {
    if (stack.length > 1) history.back();
    else go(fallbackHash, { replace: true });
  }

  return {
    parse,
    go,
    back,
    current: () => cur,
    /** Arranca el router: resuelve la ruta actual y escucha cambios. */
    start() {
      addEventListener('hashchange', onHash);
      // Si se recargó con una entrada "fantasma" de una hoja, se limpia.
      try { if (history.state && history.state.sd) history.replaceState(null, ''); } catch { /* sin historial */ }
      resolve('initial');
    },
    /** href('meses', {key:'2026-12'}) -> '#/meses/2026-12' */
    href(name, params = {}) {
      const r = table.find((x) => x.name === name);
      if (!r) return fallback;
      const parts = r.segs.map((sg) => (sg.startsWith(':') ? params[sg.replace(/^:/, '').replace(/\?$/, '')] : sg)).filter((p) => p != null && p !== '');
      return '#/' + parts.map(encodeURIComponent).join('/');
    },
    depth: () => stack.length,
  };
}
