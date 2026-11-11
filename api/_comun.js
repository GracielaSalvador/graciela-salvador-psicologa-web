// Piezas compartidas del sistema de accesos de «Mi psicóloga en el bolsillo».
// Lo usan las funciones de /api y la puerta de entrada (middleware.js).
// Nada de lo que la gente escribe en las herramientas pasa por aquí: eso sigue guardado solo en su móvil.
// Aquí solo se sabe quién tiene acceso (su correo), a qué app y hasta cuándo.
//
// Variables que hay que poner en Vercel (Settings → Environment Variables):
//   SESSION_SECRET        texto largo al azar: firma las sesiones para que nadie pueda inventárselas
//   ADMIN_PASSWORD        la contraseña de Graciela para su página de pacientes
//   KV_REST_API_URL / KV_REST_API_TOKEN   la base de datos (se ponen solas al conectar Upstash Redis en Vercel)
//   RESEND_API_KEY        para enviar los correos
//   MAIL_FROM             remitente de los correos, por ejemplo: Graciela Salvador <hola@gracielasalvador.com>
//   PAYHIP_API_KEY        para comprobar que los avisos vienen de verdad de Payhip
//   PAYHIP_REGALOS        las claves secretas de las tarjetas regalo (ver la guía)
//   PAYHIP_LINK_M / PAYHIP_LINK_G / PAYHIP_LINK_P   enlaces de Payhip para suscribirse a La Madrería, la general y las dos

export const HOST_M = 'madreria.gracielasalvador.com';
export const HOST_G = 'www.gracielasalvador.com';
export const APPS = { m: { ruta: 'madreria', host: HOST_M, nombre: 'Mi psicóloga en el bolsillo, edición La Madrería' }, g: { ruta: 'bolsillo', host: HOST_G, nombre: 'Mi psicóloga en el bolsillo' } };
// Los nombres de las apps en los correos y avisos (primero la general, después la edición La Madrería)
export const nombresApps = (apps) => ['g', 'm'].filter((a) => apps.includes(a)).map((a) => APPS[a].nombre).join(' y ');
export const RUTA_APP = { madreria: 'm', bolsillo: 'g' };
// Lo que se abre sin cuenta: el inicio, la casa, la página legal y dos herramientas en cada app
export const GRATIS = { m: ['', 'calma', 'carga', 'casa', 'legal'], g: ['', 'calma', 'emociones', 'casa', 'legal'] };
// Graciela puede cambiar qué herramientas son gratis desde su página (se guarda en «gratis»: { m: { calma: 0, ... }, g: {...} };
// 0 = siempre, un número = gratis hasta esa fecha). El inicio, la casa y la página legal son siempre gratis.
export const FIJAS = ['', 'casa', 'legal'];
let _gc = null, _gt = 0;
export async function gratis() {
  if (_gc && Date.now() - _gt < 60000) return _gc;
  let cfg = null; try { const v = await db('GET', 'gratis'); if (v) cfg = JSON.parse(v); } catch (e) {}
  const t = Date.now(), out = {};
  for (const a of ['m', 'g']) { const c = cfg && cfg[a]; out[a] = c ? [...FIJAS, ...Object.entries(c).filter(([, h]) => !h || h > t).map(([k]) => k)] : GRATIS[a]; }
  _gc = out; _gt = t; return out;
}
export const gratisConfig = async () => { try { const v = await db('GET', 'gratis'); if (v) return JSON.parse(v); } catch (e) {}
  const o = {}; for (const a of ['m', 'g']) o[a] = Object.fromEntries(GRATIS[a].filter((k) => !FIJAS.includes(k)).map((k) => [k, 0])); return o; };
export const DIA = 86400000;
export const MARGEN_ALTA = 14 * DIA;          // margen de una paciente al recibir el alta
export const SESION_DIAS = 180;               // cuánto recuerda el móvil la sesión
export const REVISAR_CADA = 6 * 3600000;      // cada cuánto se vuelve a mirar la base de datos
const SIEMPRE = 8.64e15;                      // «sin fecha de fin»

const env = (k) => (typeof process !== 'undefined' && process.env ? process.env[k] : undefined);
export const ahora = () => Date.now();
export const limpiaCorreo = (e) => String(e || '').trim().toLowerCase();
export const correoValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length < 200;
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fecha = (ts) => new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' });

/* ---------- Base de datos (Upstash Redis, por su API web) ---------- */
export async function db(...cmd) {
  const url = env('KV_REST_API_URL') || env('UPSTASH_REDIS_REST_URL'), tok = env('KV_REST_API_TOKEN') || env('UPSTASH_REDIS_REST_TOKEN');
  if (!url || !tok) throw new Error('Falta conectar la base de datos en Vercel.');
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error('Base de datos: ' + j.error);
  return j.result;
}
export async function leerPersona(email) { const v = await db('GET', 'u:' + email); return v ? JSON.parse(v) : null; }
// Además, cada correo se apunta en «personas» para que Graciela vea a todo el mundo en su página (pacientes, suscripciones y regalos)
export async function guardarPersona(email, p) { await db('SET', 'u:' + email, JSON.stringify(p)); await db('SADD', 'personas', email); }

/* Hasta cuándo tiene acceso una persona a cada app, juntando todo lo que tenga (suscripción, paciente, regalos, acceso a mano) */
export function accesos(p) {
  const out = { m: 0, g: 0 };
  if (!p) return out;
  const sube = (app, t) => { if (t > out[app]) out[app] = t; };
  if (p.sub) { for (const a of ['m', 'g']) if (p.sub[a]) sube(a, p.sub[a]); if (p.sub.activa) for (const a of p.sub.apps || []) sube(a, SIEMPRE); }
  if (p.pac && p.pac.apps) for (const a of p.pac.apps) sube(a, p.pac.alta ? p.pac.alta + MARGEN_ALTA : SIEMPRE);
  for (const r of p.reg || []) for (const a of r.apps) sube(a, r.hasta);
  for (const m of p.mano || []) for (const a of m.apps) sube(a, m.hasta);
  return out;
}
export const tieneAlgo = (acc, t = ahora()) => acc.m > t || acc.g > t;

/* ---------- Sesión firmada (cookie) ---------- */
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uTxt = (s) => b64u(new TextEncoder().encode(s));
const deB64u = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
async function firma(txt) {
  const sec = env('SESSION_SECRET');
  if (!sec || sec.length < 16) throw new Error('Falta SESSION_SECRET en Vercel.');
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(sec), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(txt)));
}
export async function crearSesion(email, acc) {
  const cuerpo = b64uTxt(JSON.stringify({ e: email, m: acc.m, g: acc.g, c: ahora() }));
  return cuerpo + '.' + (await firma(cuerpo));
}
export async function leerSesion(valor) {
  if (!valor || valor.indexOf('.') < 0) return null;
  const [cuerpo, f] = valor.split('.');
  try { if ((await firma(cuerpo)) !== f) return null; return JSON.parse(deB64u(cuerpo)); } catch (e) { return null; }
}
export function leerCookie(req, nombre) {
  const c = req.headers.get('cookie') || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + nombre + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
export const COOKIE = 'gs_ses';
export const cookieSesion = (v) => `${COOKIE}=${encodeURIComponent(v)}; Path=/; Max-Age=${SESION_DIAS * 86400}; HttpOnly; Secure; SameSite=Lax`;
export const cookieApps = (acc) => `gs_apps=${['m', 'g'].filter((a) => acc[a] > ahora()).join('-') || 'ninguna'}; Path=/; Max-Age=${SESION_DIAS * 86400}; Secure; SameSite=Lax`;
export const borrarCookies = [`${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, 'gs_apps=; Path=/; Max-Age=0; Secure; SameSite=Lax'];

/* Enlaces de un solo uso para entrar sin contraseña */
export async function crearEnlace(email, app, minutos = 30) {
  const bytes = crypto.getRandomValues(new Uint8Array(24)), t = b64u(bytes);
  await db('SET', 'login:' + t, JSON.stringify({ e: email, a: app }), 'EX', String(minutos * 60));
  const A = APPS[app] || APPS.m;
  return `https://${A.host}/api/entrar?t=${t}`;
}

/* ---------- Correos (Resend) ---------- */
export async function enviarCorreo(para, asunto, html) {
  const key = env('RESEND_API_KEY'), from = env('MAIL_FROM') || 'Graciela Salvador <hola@gracielasalvador.com>';
  if (!key) throw new Error('Falta RESEND_API_KEY en Vercel.');
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [para], subject: asunto, html, text: textoPlano(html) }) });
  if (!r.ok) throw new Error('No se pudo enviar el correo (' + r.status + ').');
}
// Los correos se escriben como un correo normal de persona a persona (texto sencillo, un enlace y versión en texto plano),
// para que Gmail los deje en «Principal» y no en «Promociones»
export function plantilla(app, titulo, parrafos, boton) {
  const M = app === 'm', ac = M ? '#11667D' : '#166A7E';
  const p = (t) => `<p style="margin:0 0 14px">${t}</p>`;
  return `<!doctype html><html lang="es"><body style="margin:0;padding:16px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#222">
<div style="max-width:560px">
${p('Hola:')}${parrafos.map(p).join('')}
${boton ? p(`<a href="${esc(boton[1])}" style="color:${ac};font-weight:bold">${esc(boton[0])}</a>`) : ''}
${p('Un abrazo,<br>Graciela')}
<p style="margin:18px 0 0;font-size:12px;color:#777">Graciela Salvador · Psicóloga sanitaria. Lo que escribes en las herramientas se guarda solo en tu móvil; aquí solo sabemos tu correo y a qué tienes acceso.</p>
</div></body></html>`;
}
// La versión en texto plano del mismo correo
export function textoPlano(html) {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, (m, u, t) => `${t}: ${u.replace(/&amp;/g, '&')}`)
    .replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------- Páginas sencillas (formularios y mensajes) ---------- */
export function pagina(app, titulo, cuerpo, status = 200, extra = {}) {
  const M = app !== 'g';
  const claro = M ? '--bg:#FDFDFB;--surface:#FFFFFF;--ink:#16343B;--muted:#5E6F72;--line:#DCE6E8;--accent:#11667D;--deep:#0B4757;--tint:#E3EFF1;--on:#FFFFFF;--err:#8E4E33;--errbg:#F6E3D6;--ok:#2C6E5D;--okbg:#E2F0EA'
    : '--bg:#F5F9F9;--surface:#FFFFFF;--ink:#17343B;--muted:#5C747A;--line:#D7E5E8;--accent:#166A7E;--deep:#0F4C5C;--tint:#E4EFF1;--on:#FFFFFF;--err:#8E4E33;--errbg:#F4E3DA;--ok:#2C6E5D;--okbg:#E2F0EA';
  const oscuro = M ? '--bg:#0D1B1F;--surface:#142629;--ink:#E4EEEF;--muted:#9DB1B5;--line:#26393D;--accent:#5DB4C6;--deep:#A0D5E0;--tint:#183339;--on:#0D1B1F;--err:#E8B39A;--errbg:#3A2A23;--ok:#8CCDB6;--okbg:#17332B'
    : '--bg:#0C1C21;--surface:#12282E;--ink:#E2EEF0;--muted:#9AB2B8;--line:#234046;--accent:#5FB2C3;--deep:#9AD3DE;--tint:#18343B;--on:#0C1C21;--err:#E8B39A;--errbg:#3A2A23;--ok:#8CCDB6;--okbg:#17332B';
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex"><title>${esc(titulo)} · Mi psicóloga en el bolsillo</title>
<link rel="stylesheet" href="/fuentes/fuentes.css">
<style>:root{${claro}}@media (prefers-color-scheme:dark){:root{${oscuro};color-scheme:dark}}
*{box-sizing:border-box}html,body{margin:0;min-height:100%}
body{background:var(--bg);color:var(--ink);font-family:"Nunito Sans","Segoe UI",system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px 16px}
main{width:100%;max-width:420px;background:var(--surface);border:1px solid var(--line);border-radius:26px;padding:28px 22px;display:flex;flex-direction:column;gap:14px${M ? ';border-top:6px solid #B9B20E' : ''}}
.brand{font-size:.76rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}.brand b{color:var(--deep)}
h1{font-family:Lora,Georgia,serif;font-weight:500;color:var(--deep);font-size:1.6rem;margin:0;line-height:1.2}
p{margin:0;color:var(--muted);line-height:1.55}
form{display:flex;flex-direction:column;gap:10px}
label{font-weight:700;font-size:.92rem}
input{width:100%;font:inherit;font-size:1.05rem;padding:13px 14px;border-radius:14px;border:1.5px solid var(--line);background:var(--bg);color:var(--ink)}
input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.btn,button{display:block;text-align:center;font:inherit;font-weight:800;font-size:1rem;border:0;border-radius:999px;padding:13px;background:var(--accent);color:var(--on);cursor:pointer;text-decoration:none}
.btn.ghost{background:transparent;color:var(--accent);border:1.5px solid var(--line)}
.err{background:var(--errbg);color:var(--err);border-radius:12px;padding:10px 12px;font-size:.95rem}
.ok{background:var(--okbg);color:var(--ok);border-radius:12px;padding:10px 12px;font-size:.95rem}
small{color:var(--muted);font-size:.84rem;line-height:1.45}
.sep{border-top:1px solid var(--line);margin:4px 0}
details summary{cursor:pointer;color:var(--accent);font-weight:700}
.lock{width:52px;height:52px;border-radius:16px;background:var(--tint);display:grid;place-items:center;color:var(--accent)}
</style></head><body><main>
<div class="brand"><b>Graciela Salvador</b> · ${M ? 'La Madrería' : 'Psicóloga'}</div>
${cuerpo}
</main></body></html>`;
  const h = new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  for (const c of extra.cookies || []) h.append('Set-Cookie', c);
  return new Response(html, { status, headers: h });
}
export const appDeHost = (req) => (new URL(req.url).hostname === HOST_M ? 'm' : 'g');
export async function formulario(req) {
  try { return Object.fromEntries((await req.formData()).entries()); } catch (e) { try { return await req.json(); } catch (e2) { return {}; } }
}
export const enlacesPago = () => ({ m: env('PAYHIP_LINK_M') || '', g: env('PAYHIP_LINK_G') || '', p: env('PAYHIP_LINK_P') || '' });

/* ---------- Acceso de Graciela a su página de pacientes ---------- */
export async function crearAdmin() { const cuerpo = b64uTxt(JSON.stringify({ adm: 1, x: ahora() + 30 * DIA })); return cuerpo + '.' + (await firma('admin:' + cuerpo)); }
export async function esAdmin(req) {
  const v = leerCookie(req, 'gs_admin'); if (!v || v.indexOf('.') < 0) return false;
  const [cuerpo, f] = v.split('.');
  try { if ((await firma('admin:' + cuerpo)) !== f) return false; return JSON.parse(deB64u(cuerpo)).x > ahora(); } catch (e) { return false; }
}
