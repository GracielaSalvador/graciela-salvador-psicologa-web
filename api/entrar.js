// Entrar con el correo, sin contraseña.
//   GET  /api/entrar            → formulario para escribir el correo
//   POST /api/entrar            → si ese correo tiene acceso, le llega un código de 6 números para entrar
//   GET  /api/entrar?t=...      → el enlace del correo: abre la sesión en este móvil y lleva a la app
import { db, APPS, appDeHost, pagina, formulario, limpiaCorreo, correoValido, leerPersona, accesos, tieneAlgo, crearSesion, cookieSesion, cookieApps, crearEnlace, enviarCorreo, plantilla, enlacesPago, esc } from './_comun.js';
export const config = { runtime: 'edge' };

const form = (app, msg = '', correo = '') => pagina(app, 'Entrar', `
<h1>Entrar con tu correo</h1>
<p>Escribe el correo con el que te suscribiste, canjeaste un regalo o te dio de alta Graciela. Te llegará un código de 6 números para entrar, sin contraseña.</p>
${msg}
<form method="post" action="/api/entrar"><label for="e">Tu correo</label>
<input id="e" name="email" type="email" autocomplete="email" inputmode="email" required value="${esc(correo)}" placeholder="nombre@correo.com">
<input type="hidden" name="app" value="${app}"><button type="submit">Enviarme el código</button></form>
<div class="sep"></div>
<a class="btn ghost" href="/api/regalo">Tengo una tarjeta regalo</a>
<small>El móvil recordará la sesión durante meses. Lo que escribes en las herramientas sigue guardado solo en tu móvil.</small>`);

// «Revisa tu correo», con el hueco para escribir el código de 6 números
const revisa = (ap, email, msg) => pagina(ap, 'Revisa tu correo', `<h1>Revisa tu correo</h1><p>Si <b>${esc(email)}</b> tiene acceso, te acabamos de enviar un correo con un código de 6 números. Escríbelo aquí para entrar.</p><p class="hint">Puede tardar un par de minutos; mira también en Promociones o en Spam.</p>
${msg}<form method="post" action="/api/entrar"><label for="pin">Código del correo</label>
<input id="pin" name="pin" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123 456" required style="letter-spacing:.2em;font-size:1.3rem;text-align:center">
<input type="hidden" name="email" value="${esc(email)}"><input type="hidden" name="app" value="${ap}"><button type="submit">Entrar</button></form>
<div class="sep"></div><a class="btn ghost" href="/api/entrar?app=${ap}">Probar con otro correo</a>`);

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
      // Entrar con el código de 6 números (para la app instalada en iPhone, que no comparte la sesión con Safari)
      if (f.pin !== undefined) {
        const pin = String(f.pin || '').replace(/\D/g, ''), k = 'pin:' + email, v = correoValido(email) ? await db('GET', k) : null;
        if (!v) return revisa(ap, email, '<div class="err" role="alert">El código ha caducado o no es válido. Pide uno nuevo.</div>');
        const P = JSON.parse(v);
        if (P.c !== pin) {
          P.n = (P.n || 0) + 1;
          if (P.n >= 5) { await db('DEL', k); return revisa(ap, email, '<div class="err" role="alert">Demasiados intentos. Pide un código nuevo.</div>'); }
          await db('SET', k, JSON.stringify(P), 'KEEPTTL');
          return revisa(ap, email, '<div class="err" role="alert">Ese código no es correcto. Revísalo, por favor.</div>');
        }
        await db('DEL', k);
        const p = await leerPersona(email), acc = accesos(p), A = APPS[acc[ap] > Date.now() ? ap : P.a] || APPS[ap];
        const host = new URL(req.url).hostname, h = new Headers({ Location: host === A.host ? `/${A.ruta}/` : `https://${A.host}/${A.ruta}/`, 'Cache-Control': 'no-store' });
        h.append('Set-Cookie', cookieSesion(await crearSesion(email, acc))); h.append('Set-Cookie', cookieApps(acc));
        return new Response(null, { status: 303, headers: h });
      }
      if (!correoValido(email)) return form(ap, '<div class="err" role="alert">Ese correo no parece completo. Revísalo, por favor.</div>', f.email);
      // Como mucho un correo por minuto a la misma dirección
      const libre = await db('SET', 'freno:' + email, '1', 'NX', 'EX', '60');
      if (libre) {
        const p = await leerPersona(email), acc = accesos(p);
        if (tieneAlgo(acc)) {
          const destino = acc[ap] > Date.now() ? ap : acc.m > Date.now() ? 'm' : 'g';
          // Para entrar se usa solo un código: así la persona no sale de la app (en iPhone, la app instalada no comparte nada con Safari)
          const pin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
          await db('SET', 'pin:' + email, JSON.stringify({ c: pin, a: destino, n: 0 }), 'EX', '1800');
          await enviarCorreo(email, `Tu código para entrar: ${pin}`, plantilla(destino, 'Tu código para entrar', [`Tu código para entrar en la app es: <b>${pin.slice(0, 3)} ${pin.slice(3)}</b>`,
            'Escríbelo en la pantalla de la app que te lo ha pedido. Solo sirve una vez y caduca en 30 minutos.',
            'Si no lo has pedido tú, puedes ignorar este correo: sin el código, nadie puede entrar.']));
        } else {
          const L = enlacesPago(), pago = L[ap] || L.p;
          await enviarCorreo(email, 'Sobre tu acceso', plantilla(ap, 'Todavía no tienes acceso', ['Alguien ha pedido entrar en la app con este correo, pero todavía no tiene acceso a las herramientas.',
            ...(pago ? ['Si quieres usarlas, puedes suscribirte aquí:', { enlace: ['Suscribirme', pago] }] : []),
            'Si tienes una tarjeta regalo, puedes canjearla aquí:', { enlace: ['Canjear mi regalo', `https://${APPS[ap].host}/api/regalo`] },
            'Y si estás en terapia conmigo, dímelo y te doy acceso con este correo.', 'Si no lo has pedido tú, puedes ignorar este mensaje.']));
        }
      }
      return revisa(ap, email, '');
    }
    return form(app);
  } catch (err) {
    return pagina(app, 'Algo ha fallado', `<h1>Algo ha fallado</h1><p>No hemos podido completar la entrada. Vuelve a intentarlo en un rato.</p><small>${esc(err.message)}</small>`, 500);
  }
}
