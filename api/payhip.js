// POST /api/payhip → avisos automáticos de Payhip (webhooks).
// En Payhip: Settings → Developer → Webhook URL: https://www.gracielasalvador.com/api/payhip
// Qué app abre cada producto se deduce de su nombre en Payhip:
//   «Pack» o «las dos» → las dos · si no, «Madrería» → La Madrería · si no, la general · «Pack» o «las dos» → las dos
//   «Anual» o «año» → periodo de un año; si no, mensual
//   «Profesionales» → plan para psicólogas: «Consulta+» da 25 plazas; si no, 10
// Las tarjetas regalo no pasan por aquí: se canjean con su código en /api/regalo.
import { T_CONSEJO, T_PRIVADO, nombresApps, leerPersona, guardarPersona, limpiaCorreo, crearEnlace, enviarCorreo, plantilla, APPS, fecha, accesos, DIA, db, leerPro, guardarPro, abrirPro, cerrarPro, cuentaPropia, FIRMA_PRO, MARGEN_PRO } from './_comun.js';
export const config = { runtime: 'edge' };

const sin = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export function leerProducto(nombre) {
  const n = sin(nombre);
  if (/regalo|tarjeta/.test(n)) return null;
  const periodoP = /anual|ano\b|year|12 meses/.test(n) ? 372 * DIA : 35 * DIA;
  // Planes para profesionales: «Profesionales: Consulta» (10 plazas) y «Profesionales: Consulta+» (25 plazas)
  if (/profesional/.test(n)) return { pro: true, plazas: /consulta\s*\+|consulta plus|\b25\b/.test(n) ? 25 : 10, periodo: periodoP };
  const apps = /pack|las dos|ambas/.test(n) ? ['m', 'g'] : /madreria/.test(n) ? ['m'] : ['g'];
  const periodo = /anual|ano\b|year|12 meses/.test(n) ? 372 * DIA : 35 * DIA;
  return { apps, periodo };
}
async function hex(txt) { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join(''); }

async function bienvenida(email, prod, nombre) {
  const app = prod.apps[0], link = await crearEnlace(email, app, 60 * 24 * 3);
        await enviarCorreo(email, 'Te doy la bienvenida', plantilla(app, 'Te doy la bienvenida', [`Gracias por suscribirte a ${nombresApps(prod.apps)}. Ya tienes abiertas todas las herramientas.`,
          'Las he preparado para acompañarte en el día a día: para los momentos difíciles, para entender lo que sientes y para cuidarte un poco más. Úsalas a tu ritmo, cuando las necesites.',
          'Para entrar, toca este enlace desde tu móvil:', { enlace: ['Entrar en la app', link] }, ...(/acompa|asesor/.test(sin(`${nombre}`)) ? ['Tu plan incluye una asesoría conmigo cada mes. Para reservar la primera, escríbeme cuando quieras a hola@gracielasalvador.com o por WhatsApp al 698 98 20 95, y buscamos juntas un hueco.'] : []), T_CONSEJO, T_PRIVADO,
          'Puedes cancelar tu suscripción cuando quieras con el enlace que viene en tu recibo de Payhip. Si no lo encuentras, o tienes cualquier duda, respóndeme a este correo y te ayudo.']));
}
const PANEL = 'https://www.gracielasalvador.com/profesionales/';
async function bienvenidaPro(email, pr) {
  await enviarCorreo(email, 'Tu panel de profesional ya está listo', plantilla('g', 'Tu panel de profesional ya está listo', [
    `Gracias por confiar en Mi psicóloga en el bolsillo para acompañar a tus pacientes. Tu plan incluye ${pr.plazas} plazas.`,
    'Desde tu panel puedes dar acceso a tus pacientes con su correo, darles el alta y ver todas las herramientas con su enlace para mandárselas. Entras con este mismo correo y un código, sin contraseñas.',
    { enlace: ['Entrar en mi panel', PANEL] },
    'Antes de nada, en «Mi cuenta» escribe el nombre de tu consulta: tus pacientes lo verán en la app («Te lo ofrece…») y en sus correos.',
    'Tu cuenta incluye también las dos ediciones para ti, sin ocupar plaza. Desde «Mi cuenta» te puedes enviar el enlace para entrar.',
    'Si tienes cualquier duda, responde a este correo.']));
}
async function suscripcionPro(d, email, prod, ahora) {
  const pr = (await leerPro(email)) || { email, creado: ahora }, s = pr.sub || {};
  if (d.type === 'subscription.created' || d.type === 'paid') {
    if (d.type === 'paid') { s.ultimo = ahora; s.periodo = prod.periodo; if (!s.cancelada || s.cancelada < ahora - 60000) s.activa = true; }
    else Object.assign(s, { activa: true, id: d.subscription_id, plan: d.plan_name || d.product_name, inicio: ahora, ultimo: ahora, periodo: prod.periodo, cancelada: 0, hasta: 0 });
    pr.sub = s; pr.plazas = prod.plazas; await guardarPro(email, pr);
    if (pr.cerrada) await abrirPro(email, pr);
    await cuentaPropia(email);
    if (!pr.bienv) { pr.bienv = ahora; await guardarPro(email, pr); await bienvenidaPro(email, pr); }
  } else if (d.type === 'subscription.deleted') {
    if (s.id && d.subscription_id && s.id !== d.subscription_id && s.activa) return;   // cambio de plan: sigue la nueva
    s.activa = false; s.cancelada = ahora; s.hasta = Math.max((s.ultimo || s.inicio || ahora) + (s.periodo || prod.periodo), ahora + 3 * DIA);
    pr.sub = s; await guardarPro(email, pr);
    await enviarCorreo(email, 'Tu plan de profesional se ha cancelado', plantilla('g', 'Tu plan de profesional se ha cancelado', [
      `Te confirmo que tu plan se ha cancelado. Seguirá activo hasta el ${fecha(s.hasta)}. Después, tus pacientes conservarán el acceso ${MARGEN_PRO / DIA} días más y les llegará un aviso.`,
      'Si quieres volver, puedes suscribirte de nuevo cuando quieras: tus pacientes recuperarán el acceso sin perder nada.']));
  } else if (d.type === 'refunded' && +d.amount_refunded >= +d.price) {
    s.activa = false; s.hasta = ahora; pr.sub = s; await guardarPro(email, pr); await cerrarPro(email, pr, ahora);
  }
}
export default async function handler(req) {
  if (req.method !== 'POST') return new Response('ok');
  let d = null; try { d = await req.json(); } catch (e) { const f = await req.formData().catch(() => null); d = f ? Object.fromEntries(f.entries()) : null; }
  if (!d) return new Response('sin datos', { status: 400 });
  const key = process.env.PAYHIP_API_KEY;
  if (!key || d.signature !== (await hex(key))) return new Response('firma no válida', { status: 401 });
  try {
    await db('LPUSH', 'payhip:log', JSON.stringify({ t: Date.now(), type: d.type, email: d.email || d.customer_email, prod: d.product_name || d.plan_name || (d.items || []).map((i) => i.product_name).join(' | ') }));
    await db('LTRIM', 'payhip:log', '0', '199');
    const ahora = Date.now();
    if (d.type === 'subscription.created' || d.type === 'subscription.deleted') {
      const email = limpiaCorreo(d.customer_email), prod = leerProducto(`${d.product_name || ''} ${d.plan_name || ''}`);
      if (!email || !prod) return new Response('ok');
      if (prod.pro) { await suscripcionPro(d, email, prod, ahora); return new Response('ok'); }
      const p = (await leerPersona(email)) || { creado: ahora }, s = p.sub || {};
      if (d.type === 'subscription.created') {
        p.sub = { ...s, apps: prod.apps, activa: true, id: d.subscription_id, plan: d.plan_name || d.product_name, inicio: ahora, ultimo: ahora, periodo: prod.periodo };
        for (const a of prod.apps) p.sub[a] = Math.max(s[a] || 0, ahora + prod.periodo);
        await guardarPersona(email, p);
        if (!s.bienv) { p.sub.bienv = ahora; await guardarPersona(email, p); await bienvenida(email, prod, `${d.product_name || ''} ${d.plan_name || ''}`); }
      } else if (s.id && d.subscription_id && s.id !== d.subscription_id && s.activa) {
        // Cancela una suscripción antigua pero ya tiene otra activa (p. ej., cambio de plan): se mantiene la nueva
        return new Response('ok');
      } else {
        // Cancelada: se mantiene hasta el final del periodo pagado
        const base = (s.ultimo || s.inicio || ahora) + (s.periodo || prod.periodo);
        p.sub = { ...s, activa: false, cancelada: ahora };
        for (const a of s.apps || prod.apps) p.sub[a] = Math.max(base, ahora + 3 * DIA);
        await guardarPersona(email, p);
        const app = (s.apps || prod.apps)[0], hasta = accesos(p)[app];
        await enviarCorreo(email, 'Tu suscripción se ha cancelado', plantilla(app, 'Tu suscripción se ha cancelado', [`Te confirmo que tu suscripción se ha cancelado. Seguirás teniendo acceso hasta el ${fecha(hasta)}.`, 'Lo que has escrito se guarda solo en tu móvil. <b>Antes de que termine tu acceso, guarda una copia de seguridad</b> desde la app, en «Contacto y ajustes» → «Copia de seguridad». Así, si vuelves más adelante, aunque sea desde otro móvil, podrás recuperarlo todo.', 'Gracias por haberme dejado acompañarte este tiempo. Si algún día quieres volver, lo encontrarás todo como lo dejaste.']));
      }
    } else if (d.type === 'paid' || d.type === 'refunded') {
      const email = limpiaCorreo(d.email);
      const todos = (d.items || []).map((i) => leerProducto(i.product_name)).filter(Boolean), prods = todos.filter((x) => !x.pro);
      if (email && todos.some((x) => x.pro)) { if (d.type === 'paid') await new Promise((r) => setTimeout(r, 2500)); await suscripcionPro(d, email, todos.find((x) => x.pro), ahora); }
      if (!email || !prods.length) return new Response('ok');
      // Payhip manda «paid» y «subscription.created» casi a la vez: esperamos un poco y releemos para no pisar el alta
      if (d.type === 'paid') await new Promise((r) => setTimeout(r, 2500));
      const p = (await leerPersona(email)) || { creado: ahora }, s = p.sub || {};
      if (d.type === 'paid') {
        for (const pr of prods) { for (const a of pr.apps) s[a] = Math.max(s[a] || 0, ahora + pr.periodo); s.ultimo = ahora; s.periodo = pr.periodo; s.apps = [...new Set([...(s.apps || []), ...pr.apps])]; }
        if (!s.cancelada || s.cancelada < ahora - 60000) s.activa = true;
      } else if (+d.amount_refunded >= +d.price) {
        for (const pr of prods) for (const a of pr.apps) s[a] = ahora;
        s.activa = false;
      }
      const nuevo = d.type === 'paid' && !s.bienv; if (nuevo) s.bienv = ahora;
      p.sub = s; await guardarPersona(email, p);
      if (nuevo) await bienvenida(email, prods[0], (d.items || []).map((i) => i.product_name).join(' '));
    }
    return new Response('ok');
  } catch (err) {
    return new Response('error: ' + err.message, { status: 500 });
  }
}
