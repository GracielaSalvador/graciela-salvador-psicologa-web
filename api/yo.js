// GET /api/yo → qué apps tiene abiertas este móvil (para poner los candados en el inicio). No devuelve nada privado salvo el propio correo.
import { leerCookie, leerSesion, COOKIE, leerPersona, accesos, crearSesion, cookieSesion, cookieApps, REVISAR_CADA, enlacesPago } from './_comun.js';
export const config = { runtime: 'edge' };
export default async function handler(req) {
  const h = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  let s = null; try { s = await leerSesion(leerCookie(req, COOKIE)); } catch (e) {}
  let out = { email: null, m: false, g: false, pago: enlacesPago() };
  if (s) {
    let acc = { m: s.m, g: s.g };
    if (Date.now() - s.c > REVISAR_CADA) {
      try { acc = accesos(await leerPersona(s.e)); h.append('Set-Cookie', cookieSesion(await crearSesion(s.e, acc))); h.append('Set-Cookie', cookieApps(acc)); } catch (e) {}
    }
    out = { ...out, email: s.e, m: acc.m > Date.now(), g: acc.g > Date.now(), hastaM: acc.m, hastaG: acc.g };
  }
  return new Response(JSON.stringify(out), { headers: h });
}
