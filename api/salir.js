// GET /api/salir → cierra la sesión en este móvil (lo escrito en las herramientas no se borra)
import { borrarCookies, appDeHost, APPS } from './_comun.js';
export const config = { runtime: 'edge' };
export default async function handler(req) {
  const h = new Headers({ Location: `/${APPS[appDeHost(req)].ruta}/`, 'Cache-Control': 'no-store' });
  for (const c of borrarCookies) h.append('Set-Cookie', c);
  return new Response(null, { status: 303, headers: h });
}
