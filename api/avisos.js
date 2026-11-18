// GET /api/avisos → lo llama Vercel una vez al día (Cron Jobs, ver vercel.json).
// Avisa por correo, unos días antes, a quien tiene un acceso que va a terminar: tarjeta regalo, alta de terapia,
// acceso dado a mano o suscripción cancelada. Cada fin de acceso se avisa una sola vez.
// En Vercel tiene que existir la variable CRON_SECRET (Vercel la manda sola al llamar).
import { db, leerPersona, guardarPersona, accesos, enviarCorreo, plantilla, nombresApps, fecha, enlacesPago, DIA, leerPro, proActiva, cerrarPro, abrirPro, FIRMA_PRO, soltarPaciente, PURGA_PRO, MARGEN_ALTA } from './_comun.js';
export const config = { runtime: 'edge' };
const ANTES = 5 * DIA;

export default async function handler(req) {
  const sec = process.env.CRON_SECRET;
  if (!sec || req.headers.get('authorization') !== `Bearer ${sec}`) return new Response('no autorizado', { status: 401 });
  // Primero, las profesionales: si su plan ha dejado de estar activo, sus pacientes pasan a tener MARGEN_PRO de margen (y al revés si vuelve)
  let prosCerradas = 0, borradas = 0;
  for (const pe of (await db('SMEMBERS', 'pros')) || []) {
    try { const pr = await leerPro(pe); if (!pr) continue;
      const act = proActiva(pr);
      if (!act && !pr.cerrada) { await cerrarPro(pe, pr); prosCerradas++; } else if (act && pr.cerrada) await abrirPro(pe, pr);
      // Pasados 30 días desde que una paciente perdió el acceso (alta o cierre del plan), se borran sus datos
      const tn = Date.now();
      for (const e of (await db('SMEMBERS', 'propac:' + pe)) || []) {
        const p = await leerPersona(e);
        if (!p || !p.pp || p.pp.de !== pe) { await db('SREM', 'propac:' + pe, e); continue; }
        if (p.pp.propia) continue;
        const fin = Math.min(p.pp.fin || Infinity, p.pp.alta ? p.pp.alta + MARGEN_ALTA : Infinity);
        if (fin !== Infinity && tn > fin + PURGA_PRO) { await soltarPaciente(pe, e, p); borradas++; }
      }
    } catch (e) { console.log('ERRPRO', e.message); }
  }
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
      const dePro = !!(p.pp && !p.pp.propia && p.pp.fin && Math.abs(p.pp.fin - hasta) < DIA);
      await enviarCorreo(email, 'Tu acceso termina pronto', plantilla(apps[0], 'Tu acceso termina pronto', [
        `Te escribo para recordarte que tu acceso a ${nombresApps(apps)} termina el ${fecha(hasta)}.`,
        dePro ? 'El plan con el que tu psicóloga te daba acceso ha terminado.' : regalo ? 'Espero que este regalo te haya acompañado en estos meses.' : 'Espero que las herramientas te hayan acompañado este tiempo.',
        'Lo que has escrito se guarda solo en tu móvil. <b>Antes de que termine tu acceso, guarda una copia de seguridad</b> desde la app, en «Contacto y ajustes» → «Copia de seguridad». Así, si vuelves más adelante, aunque sea desde otro móvil, podrás recuperarlo todo.',
        ...(pago ? ['Si quieres seguir usándolas, puedes suscribirte aquí:', { enlace: ['Seguir con las herramientas', pago] }] : ['Si quieres seguir usándolas, podrás suscribirte desde la propia app.']),
        'Y si no, no tienes que hacer nada: no se te cobrará nada.'], null, dePro || (p.pp && !p.pp.propia) ? FIRMA_PRO : undefined));
      for (const a of apps) avisos[a] = acc[a]; p.avisos = avisos; await guardarPersona(email, p); enviados++;
    } catch (e) { errores++; }
  }
  return new Response(JSON.stringify({ revisadas: emails.length, enviados, errores, prosCerradas, borradas }), { headers: { 'Content-Type': 'application/json' } });
}
