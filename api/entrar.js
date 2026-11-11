// Entrar con el correo, sin contraseña.
//   GET  /api/entrar            → formulario para escribir el correo
//   POST /api/entrar            → si ese correo tiene acceso, le llega un enlace para entrar
//   GET  /api/entrar?t=...      → el enlace del correo: abre la sesión en este móvil y lleva a la app
import { db, APPS, appDeHost, pagina, formulario, limpiaCorreo, correoValido, leerPersona, accesos, tieneAlgo, crearSesion, cookieSesion, cookieApps, crearEnlace, enviarCorreo, plantilla, enlacesPago, esc } from './_comun.js';
export const config = { runtime: 'edge' };

const form = (app, msg = '', correo = '') => pagina(app, 'Entrar', `
<h1>Entrar con tu correo</h1>
<p>Escribe el correo con el que te suscribiste, canjeaste un regalo o te dio de alta Graciela. Te llegará un enlace para entrar, sin contraseña.</p>
${msg}
<form method="post" action="/api/entrar"><label for="e">Tu correo</label>
<input id="e" name="email" type="email" autocomplete="email" inputmode="email" required value="${esc(correo)}" placeholder="nombre@correo.com">
<input type="hidden" name="app" value="${app}"><button type="submit">Enviarme el enlace</button></form>
<div class="sep"></div>
<a class="btn ghost" href="/api/regalo">Tengo una tarjeta regalo</a>
<small>El móvil recordará la sesión durante meses. Lo que escribes en las herramientas sigue guardado solo en tu móvil.</small>`);

export default async function handler(req) {
  const url = new URL(req.url), app = url.searchParams.get('app') === 'g' || appDeHost(req) === 'g' ? 'g' : 'm';
  try {
    const t = url.searchParams.get('t');
    if (req.method === 'GET' && t) {
      const v = await db('GET', 'login:' + t);
      if (!v) return form(app, '<div class="err" role="alert">Este enlace ya se ha usado o ha caducado. Pide uno nuevo aquí abajo.</div>');
      await db('DEL', 'login:' + t);
      const { e, a } = JSON.parse(v), p = await leerPersona(e), acc = accesos(p);
      const destino = acc[a] > Date.now() ? a : acc.m > Date.now() ? 'm' : acc.g > Date.now() ? 'g' : a;
      const A = APPS[destino];
      // La sesión se guarda en el dominio de cada app; si el enlace llega al otro, se reenvía allí
      if (new URL(req.url).hostname !== A.host && /gracielasalvador\.com$/.test(new URL(req.url).hostname)) {
        const nuevo = await crearEnlace(e, destino, 5);
        return Response.redirect(nuevo, 303);
      }
      const h = new Headers({ Location: `/${A.ruta}/`, 'Cache-Control': 'no-store' });
      h.append('Set-Cookie', cookieSesion(await crearSesion(e, acc))); h.append('Set-Cookie', cookieApps(acc));
      return new Response(null, { status: 303, headers: h });
    }
    if (req.method === 'POST') {
      const f = await formulario(req), email = limpiaCorreo(f.email), ap = f.app === 'g' ? 'g' : f.app === 'm' ? 'm' : app;
      if (!correoValido(email)) return form(ap, '<div class="err" role="alert">Ese correo no parece completo. Revísalo, por favor.</div>', f.email);
      // Como mucho un correo por minuto a la misma dirección
      const libre = await db('SET', 'freno:' + email, '1', 'NX', 'EX', '60');
      if (libre) {
        const p = await leerPersona(email), acc = accesos(p);
        if (tieneAlgo(acc)) {
          const destino = acc[ap] > Date.now() ? ap : acc.m > Date.now() ? 'm' : 'g';
          const link = await crearEnlace(email, destino);
          await enviarCorreo(email, 'Tu enlace para entrar', plantilla(destino, 'Tu enlace para entrar', ['Toca el botón para entrar en la app desde este móvil. No necesitas contraseña.', 'El enlace sirve una sola vez durante 30 minutos. Si no lo has pedido tú, puedes ignorar este correo.'], ['Entrar', link]));
        } else {
          const L = enlacesPago(), pago = L[ap] || L.p;
          await enviarCorreo(email, 'Sobre tu acceso', plantilla(ap, 'Todavía no tienes acceso', ['Hemos recibido una petición para entrar con este correo, pero todavía no tiene acceso a las herramientas.',
            `${pago ? `Puedes <a href="${esc(pago)}">suscribirte aquí</a> o` : 'Puedes'} canjear una tarjeta regalo en <a href="https://${APPS[ap].host}/api/regalo">esta página</a>. Si estás en terapia con Graciela, pídele que te dé de alta con este correo.`,
            'Si no lo has pedido tú, puedes ignorar este correo.']));
        }
      }
      return pagina(ap, 'Revisa tu correo', `<h1>Revisa tu correo</h1><p>Si <b>${esc(email)}</b> tiene acceso, te acabamos de enviar un enlace para entrar. Puede tardar un par de minutos; mira también en la carpeta de correo no deseado.</p><a class="btn ghost" href="/api/entrar?app=${ap}">Probar con otro correo</a>`);
    }
    return form(app);
  } catch (err) {
    return pagina(app, 'Algo ha fallado', `<h1>Algo ha fallado</h1><p>No hemos podido completar la entrada. Vuelve a intentarlo en un rato.</p><small>${esc(err.message)}</small>`, 500);
  }
}
