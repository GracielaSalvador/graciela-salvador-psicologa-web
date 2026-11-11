// POST /api/payhip → avisos automáticos de Payhip (webhooks).
// En Payhip: Settings → Developer → Webhook URL: https://www.gracielasalvador.com/api/payhip
// Qué app abre cada producto se deduce de su nombre en Payhip:
//   «Madrería» → La Madrería · «General» o «Bolsillo» → la general · «Pack» o «las dos» → las dos
//   «Anual» o «año» → periodo de un año; si no, mensual
// Las tarjetas regalo no pasan por aquí: se canjean con su código en /api/regalo.
import { nombresApps, leerPersona, guardarPersona, limpiaCorreo, crearEnlace, enviarCorreo, plantilla, APPS, fecha, accesos, DIA, db } from './_comun.js';
export const config = { runtime: 'edge' };

const sin = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export function leerProducto(nombre) {
  const n = sin(nombre);
  if (/regalo|tarjeta/.test(n)) return null;
  const apps = /pack|las dos|ambas/.test(n) || (/madreria/.test(n) && /general|bolsillo/.test(n)) ? ['m', 'g'] : /madreria/.test(n) ? ['m'] : ['g'];
  const periodo = /anual|ano\b|year|12 meses/.test(n) ? 372 * DIA : 35 * DIA;
  return { apps, periodo };
}
async function hex(txt) { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join(''); }

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
      const p = (await leerPersona(email)) || { creado: ahora }, s = p.sub || {};
      if (d.type === 'subscription.created') {
        p.sub = { ...s, apps: prod.apps, activa: true, id: d.subscription_id, plan: d.plan_name || d.product_name, inicio: ahora, ultimo: ahora, periodo: prod.periodo };
        for (const a of prod.apps) p.sub[a] = Math.max(s[a] || 0, ahora + prod.periodo);
        await guardarPersona(email, p);
        const app = prod.apps[0], link = await crearEnlace(email, app, 60 * 24 * 3);
        await enviarCorreo(email, 'Te doy la bienvenida a Mi psicóloga en el bolsillo', plantilla(app, 'Ya tienes acceso', [`Gracias por suscribirte a ${nombresApps(prod.apps)}. Ya tienes abiertas todas las herramientas.`, 'Toca el enlace para entrar desde tu móvil. Más adelante podrás entrar siempre con este correo, sin contraseña.', 'Puedes gestionar o cancelar tu suscripción cuando quieras desde tu cuenta de Payhip.'], ['Entrar en la app', link]));
      } else {
        // Cancelada: se mantiene hasta el final del periodo pagado
        const base = (s.ultimo || s.inicio || ahora) + (s.periodo || prod.periodo);
        p.sub = { ...s, activa: false, cancelada: ahora };
        for (const a of s.apps || prod.apps) p.sub[a] = Math.max(base, ahora + 3 * DIA);
        await guardarPersona(email, p);
        const app = (s.apps || prod.apps)[0], hasta = accesos(p)[app];
        await enviarCorreo(email, 'Tu suscripción se ha cancelado', plantilla(app, 'Tu suscripción se ha cancelado', [`Seguirás teniendo acceso hasta el <b>${fecha(hasta)}</b>.`, 'Lo que has escrito sigue guardado en tu móvil. Si quieres conservarlo, en el inicio de la app, en «Copia de seguridad», puedes guardar una copia.', 'Si algún día quieres volver, lo encontrarás todo como lo dejaste.']));
      }
    } else if (d.type === 'paid' || d.type === 'refunded') {
      const email = limpiaCorreo(d.email);
      const prods = (d.items || []).map((i) => leerProducto(i.product_name)).filter(Boolean);
      if (!email || !prods.length) return new Response('ok');
      const p = (await leerPersona(email)) || { creado: ahora }, s = p.sub || {};
      if (d.type === 'paid') {
        for (const pr of prods) { for (const a of pr.apps) s[a] = Math.max(s[a] || 0, ahora + pr.periodo); s.ultimo = ahora; s.periodo = pr.periodo; s.apps = [...new Set([...(s.apps || []), ...pr.apps])]; }
      } else if (+d.amount_refunded >= +d.price) {
        for (const pr of prods) for (const a of pr.apps) s[a] = ahora;
        s.activa = false;
      }
      p.sub = s; await guardarPersona(email, p);
    }
    return new Response('ok');
  } catch (err) {
    return new Response('error: ' + err.message, { status: 500 });
  }
}
