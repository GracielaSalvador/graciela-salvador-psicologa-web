// Para que la app funcione también sin conexión.
// Siempre intenta traer la versión más nueva de internet; si no hay conexión, enseña la última que se guardó.
// Así, cuando Graciela sube cambios, se ven en cuanto hay conexión, sin tener que hacer nada.
const CACHE = 'bolsillo-v6';
const BASE = '/bolsillo/';
const PRIMERO = [BASE, BASE + 'calma/', BASE + 'casa/', '/fuentes/fuentes.css', '/fuentes/nunito-sans.woff', '/fuentes/lora.woff'].concat([BASE + 'presente/']);  // se guardan al instalar: el inicio, «Calmarme» y la casa (en La Madrería, también lo del día del parto)

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(PRIMERO.map((u) =>
    fetch(u, { credentials: 'same-origin' }).then((r) => { if (r.ok) return c.put(u, r); }).catch(() => {})))));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('bolsillo-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const propia = url.origin === location.origin && (url.pathname.startsWith(BASE) || url.pathname.startsWith('/fuentes/'));
  const letras = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!propia && !letras) return;
  if (url.pathname.endsWith('.mp3')) { e.respondWith(audio(req, url)); return; }
  e.respondWith(fetch(req).then((r) => {
    // Solo se guarda lo que se ha abierto bien (la pantalla de contraseña no se guarda)
    if (r.ok || r.type === 'opaque') { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((m) => m || (req.mode === 'navigate' ? Response.redirect(new URL(BASE + '?sinconexion=1', location.origin).href, 302) : Response.error()))));
});

// Los audios: la primera vez se descarga el archivo entero y se guarda; después se sirve desde el móvil,
// también a trozos (el reproductor pide partes del archivo para poder avanzar y retroceder)
async function audio(req, url) {
  const c = await caches.open(CACHE), key = url.origin + url.pathname;
  let r = await c.match(key);
  if (!r) {
    try { r = await fetch(key, { credentials: 'same-origin' }); } catch (e) { return Response.error(); }
    if (r.status !== 200) return r;
    await c.put(key, r.clone());
  }
  const range = req.headers.get('range');
  if (!range) return r;
  const buf = await r.arrayBuffer(), m = /bytes=(\d*)-(\d*)/.exec(range) || [], ini = +m[1] || 0, fin = m[2] ? Math.min(+m[2], buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(ini, fin + 1), { status: 206, headers: { 'Content-Type': 'audio/mpeg', 'Content-Range': `bytes ${ini}-${fin}/${buf.byteLength}`, 'Content-Length': String(fin - ini + 1), 'Accept-Ranges': 'bytes' } });
}
