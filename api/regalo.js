// Canjear una tarjeta regalo.
//   GET  /api/regalo   → formulario (correo + código)
//   POST /api/regalo   → comprueba el código con Payhip, lo marca como usado y abre el acceso 3, 6 o 12 meses
// Cada tarjeta es un producto de Payhip con «claves de licencia» (un código distinto en cada compra).
// En Vercel, PAYHIP_REGALOS guarda las claves secretas de esos productos así (una por producto, separadas por comas):
//   m3=CLAVE,m6=CLAVE,m12=CLAVE,g3=CLAVE,g6=CLAVE,g12=CLAVE,p3=CLAVE,p6=CLAVE,p12=CLAVE
//   (m = La Madrería, g = la general, p = las dos; el número son los meses)
import { T_CONSEJO, T_PRIVADO, T_HERR, nombresApps, db, APPS, appDeHost, pagina, formulario, limpiaCorreo, correoValido, leerPersona, guardarPersona, accesos, crearEnlace, enviarCorreo, plantilla, fecha, esc, DIA } from './_comun.js';
export const config = { runtime: 'edge' };

const form = (app, msg = '', correo = '', codigo = '') => pagina(app, 'Canjear un regalo', `
<h1>Canjear tu tarjeta regalo</h1>
<p>Escribe tu correo y el código de la tarjeta. El tiempo del regalo empieza a contar hoy, al canjearlo.</p>
${msg}
<form method="post" action="/api/regalo">
<label for="e">Tu correo</label><input id="e" name="email" type="email" autocomplete="email" inputmode="email" required value="${esc(correo)}" placeholder="nombre@correo.com">
<label for="c">Código de la tarjeta</label><input id="c" name="codigo" autocomplete="off" autocapitalize="characters" spellcheck="false" required value="${esc(codigo)}" placeholder="XXXXX-XXXXX-XXXXX-XXXXX">
<button type="submit">Canjear</button></form>
<small>Con este correo entrarás después en la app, sin contraseña. Si ya tenías acceso, el regalo se suma al final del que tienes.</small>`);

function productos() {
  const out = [];
  for (const par of String(process.env.PAYHIP_REGALOS || '').split(',')) {
    const [k, sec] = par.split('=').map((s) => (s || '').trim()); const m = /^([mgp])(\d+)$/.exec(k || '');
    if (m && sec) out.push({ apps: m[1] === 'p' ? ['m', 'g'] : [m[1]], meses: +m[2], sec });
  }
  return out;
}
async function verificar(codigo) {
  for (const p of productos()) {
    const r = await fetch('https://payhip.com/api/v2/license/verify?license_key=' + encodeURIComponent(codigo), { headers: { 'product-secret-key': p.sec } });
    if (!r.ok) continue;
    let j = null; try { j = await r.json(); } catch (e) {}
    if (j && j.data && j.data.license_key) return { ...p, d: j.data };
  }
  return null;
}

export default async function handler(req) {
  const app = new URL(req.url).searchParams.get('app') === 'g' || appDeHost(req) === 'g' ? 'g' : 'm';
  if (req.method !== 'POST') return form(app);
  try {
    const f = await formulario(req), email = limpiaCorreo(f.email), codigo = String(f.codigo || '').trim().toUpperCase();
    if (!correoValido(email)) return form(app, '<div class="err" role="alert">Ese correo no parece completo. Revísalo, por favor.</div>', f.email, codigo);
    if (codigo.length < 6) return form(app, '<div class="err" role="alert">Escribe el código tal y como aparece en la tarjeta.</div>', email, codigo);
    const intentos = await db('INCR', 'intentos:' + email); if (intentos === 1) await db('EXPIRE', 'intentos:' + email, '3600');
    if (intentos > 8) return form(app, '<div class="err" role="alert">Has hecho muchos intentos seguidos. Espera una hora y vuelve a probar.</div>', email, codigo);
    if (await db('GET', 'codigo:' + codigo)) return form(app, '<div class="err" role="alert">Este código ya se ha canjeado. Si crees que es un error, escribe a Graciela.</div>', email, codigo);
    const v = await verificar(codigo);
    if (!v) return form(app, '<div class="err" role="alert">No encontramos ese código. Revisa que esté bien escrito, con los guiones.</div>', email, codigo);
    if (v.d.enabled === false) return form(app, '<div class="err" role="alert">Este código está desactivado. Si crees que es un error, escribe a Graciela.</div>', email, codigo);
    if (+v.d.uses > 0) return form(app, '<div class="err" role="alert">Este código ya se ha canjeado. Si crees que es un error, escribe a Graciela.</div>', email, codigo);
    // Primero se reserva el código aquí (si dos personas lo intentan a la vez, solo una lo consigue)
    if (!(await db('SET', 'codigo:' + codigo, email, 'NX'))) return form(app, '<div class="err" role="alert">Este código ya se ha canjeado. Si crees que es un error, escribe a Graciela.</div>', email, codigo);
    const p = (await leerPersona(email)) || { creado: Date.now() }, acc = accesos(p);
    const desde = Math.max(Date.now(), ...v.apps.map((a) => acc[a])), hasta = desde + v.meses * 30.44 * DIA;
    p.reg = [...(p.reg || []), { apps: v.apps, hasta, codigo, meses: v.meses, canjeado: Date.now() }];
    await guardarPersona(email, p);
    // Y se marca como usado en Payhip
    await fetch('https://payhip.com/api/v2/license/usage', { method: 'PUT', headers: { 'product-secret-key': v.sec, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'license_key=' + encodeURIComponent(codigo) });
    const destino = v.apps.includes(app) ? app : v.apps[0], link = await crearEnlace(email, destino, 60 * 24 * 3);
    const nombres = nombresApps(v.apps);
    await enviarCorreo(email, 'Tu regalo ya está activo', plantilla(destino, 'Tu regalo ya está activo', [`Alguien que te quiere te ha regalado ${v.meses} meses de ${esc(nombres)}. Ya está activo, y tienes acceso hasta el ${fecha(hasta)}.`, T_HERR,
      'Para entrar, toca este enlace desde tu móvil:', { enlace: ['Entrar en la app', link] }, T_CONSEJO, T_PRIVADO, 'Si tienes cualquier duda, respóndeme a este correo.']));
    return pagina(destino, 'Regalo activado', `<h1>¡Tu regalo ya está activo!</h1><div class="ok">Tienes acceso a ${esc(nombres)} hasta el ${fecha(hasta)}.</div><p>Te hemos enviado a <b>${esc(email)}</b> un enlace para entrar desde este móvil.</p><a class="btn" href="/api/entrar?app=${destino}">Entrar ahora con mi correo</a>`);
  } catch (err) {
    return pagina(app, 'Algo ha fallado', `<h1>Algo ha fallado</h1><p>No hemos podido canjear el código. Vuelve a intentarlo en un rato; el código sigue siendo válido.</p><small>${esc(err.message)}</small>`, 500);
  }
}
