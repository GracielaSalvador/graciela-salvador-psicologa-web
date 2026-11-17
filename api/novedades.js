// GET /api/novedades?b=... → dejar de recibir los correos de novedades (enlace al pie de esos correos)
import { leerBaja, leerPersona, guardarPersona, pagina } from './_comun.js';
export const config = { runtime: 'edge' };
export default async function handler(req) {
  const email = await leerBaja(new URL(req.url).searchParams.get('b'));
  if (!email) return pagina('g', 'Enlace no válido', '<h1>Este enlace no funciona</h1><p>Si quieres dejar de recibir los avisos de novedades, escríbeme a hola@gracielasalvador.com y lo hago yo.</p>', 400);
  const p = await leerPersona(email);
  if (p) { p.noNov = true; await guardarPersona(email, p); }
  return pagina('g', 'Hecho', '<h1>Hecho</h1><p>Ya no recibirás más correos de novedades. Seguirás recibiendo solo los avisos importantes sobre tu acceso, como cuándo termina.</p>');
}
