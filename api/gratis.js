// /api/gratis → qué herramientas están abiertas sin cuenta ahora mismo (lo usa el inicio de cada app para poner los candados)
import { gratis } from './_comun.js';
export const config = { runtime: 'edge' };
export default async function handler() {
  return new Response(JSON.stringify(await gratis()), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } });
}
