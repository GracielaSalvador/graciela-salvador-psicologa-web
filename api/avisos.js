// GET /api/avisos → lo llama Vercel una vez al día (Cron Jobs, ver vercel.json).
// Avisa por correo, unos días antes, a quien tiene un acceso que va a terminar: tarjeta regalo, alta de terapia,
// acceso dado a mano o suscripción cancelada. Cada fin de acceso se avisa una sola vez.
// En Vercel tiene que existir la variable CRON_SECRET (Vercel la manda sola al llamar).
import { db, leerPersona, guardarPersona, accesos, enviarCorreo, plantilla, nombresApps, fecha, enlacesPago, DIA } from './_comun.js';
export const config = { runtime: 'edge' };
const ANTES = 5 * DIA;

export default async function handler(req) {
  const sec = process.env.CRON_SECRET;
  if (!sec || req.headers.get('authorization') !== `Bearer ${sec}`) return new Response('no autorizado', { status: 401 });
  const t = Date.now(), emails = [...new Set([...((await db('SMEMBERS', 'pacientes')) || []), ...((await db('SMEMBERS', 'personas')) || [])])];
  let enviados = 0, errores = 0;
  for (const email of emails) {
    try {
      const p = await leerPersona(email); if (!p) continue;
      const acc = accesos(p), avisos = p.avisos || {};
      const apps = ['m', 'g'].filter((a) => acc[a] > t && acc[a] - t <= ANTES && avisos[a] !== acc[a]);
      if (!apps.length) continue;
      // Si acaba de cancelar la suscripción ya recibió un correo con la fecha: no repetimos
      if (p.sub && p.sub.cancelada && t - p.sub.cancelada < 7 * DIA) { for (const a of apps) avisos[a] = acc[a]; p.avisos = avisos; await guardarPersona(email, p); continue; }
      const hasta = Math.max(...apps.map((a) => acc[a])), L = enlacesPago(), pago = apps.length > 1 ? (L.p || L[apps[0]]) : L[apps[0]];
      const regalo = (p.reg || []).some((r) => r.apps.some((a) => apps.includes(a)) && Math.abs(r.hasta - hasta) < DIA);
      await enviarCorreo(email, 'Tu acceso termina pronto', plantilla(apps[0], 'Tu acceso termina pronto', [
        `Te escribo para recordarte que tu acceso a ${nombresApps(apps)} termina el ${fecha(hasta)}.`,
        regalo ? 'Espero que este regalo te haya acompañado en estos meses.' : 'Espero que las herramientas te hayan acompañado este tiempo.',
        'Lo que has escrito sigue guardado en tu móvil. Si quieres conservarlo, en la app, en «Contacto y ajustes», puedes guardar una copia de seguridad.',
        ...(pago ? ['Si quieres seguir usándolas, puedes suscribirte aquí:', { enlace: ['Seguir con las herramientas', pago] }] : ['Si quieres seguir usándolas, podrás suscribirte desde la propia app.']),
        'Y si no, no tienes que hacer nada: no se te cobrará nada.']));
      for (const a of apps) avisos[a] = acc[a]; p.avisos = avisos; await guardarPersona(email, p); enviados++;
    } catch (e) { errores++; }
  }
  return new Response(JSON.stringify({ revisadas: emails.length, enviados, errores }), { headers: { 'Content-Type': 'application/json' } });
}
