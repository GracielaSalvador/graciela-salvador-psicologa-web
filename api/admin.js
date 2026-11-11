// /api/admin → lo que usa la página de pacientes de Graciela (www.gracielasalvador.com/graciela/).
// Solo funciona con la contraseña ADMIN_PASSWORD de Vercel.
import { T_CONSEJO, enlacesPago, nombresApps, gratisConfig, FIJAS, db, esAdmin, crearAdmin, limpiaCorreo, correoValido, leerPersona, guardarPersona, accesos, crearEnlace, enviarCorreo, plantilla, APPS, fecha, DIA, MARGEN_ALTA } from './_comun.js';
export const config = { runtime: 'edge' };

const json = (o, st = 200, cookies = []) => { const h = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); for (const c of cookies) h.append('Set-Cookie', c); return new Response(JSON.stringify(o), { status: st, headers: h }); };
const resumen = (email, p) => { const acc = accesos(p), t = Date.now();
  return { email, nombre: p?.pac?.nombre || '', pac: p?.pac || null, m: acc.m > t ? acc.m : 0, g: acc.g > t ? acc.g : 0,
    sub: p?.sub ? { activa: !!p.sub.activa, apps: p.sub.apps || [], plan: p.sub.plan || '', periodo: p.sub.periodo || 0, inicio: p.sub.inicio || 0, cancelada: p.sub.cancelada || 0 } : null, reg: (p?.reg || []).map((r) => ({ apps: r.apps, hasta: r.hasta, meses: r.meses })), mano: p?.mano || [] }; };

export default async function handler(req) {
  let d = {}; try { d = req.method === 'POST' ? await req.json() : {}; } catch (e) {}
  try {
    if (d.accion === 'entrar') {
      const pass = process.env.ADMIN_PASSWORD;
      if (!pass) return json({ error: 'Falta ADMIN_PASSWORD en Vercel.' }, 500);
      const fallos = +(await db('GET', 'admin:fallos')) || 0;
      if (fallos > 10) return json({ error: 'Demasiados intentos. Espera unos minutos.' }, 429);
      if (String(d.clave || '') !== pass) { await db('INCR', 'admin:fallos'); await db('EXPIRE', 'admin:fallos', '900'); return json({ error: 'La contraseña no es correcta.' }, 401); }
      return json({ ok: true }, 200, [`gs_admin=${encodeURIComponent(await crearAdmin())}; Path=/; Max-Age=${30 * 86400}; HttpOnly; Secure; SameSite=Strict`]);
    }
    if (!(await esAdmin(req))) return json({ error: 'entrar' }, 401);
    if (d.accion === 'salir') return json({ ok: true }, 200, ['gs_admin=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict']);
    if (d.accion === 'gratis_ver') return json({ cfg: await gratisConfig() });
    if (d.accion === 'gratis_guardar') {
      const c = d.cfg || {}, out = {};
      for (const a of ['m', 'g']) { out[a] = {}; for (const [k, h] of Object.entries(c[a] || {})) if (/^[a-z0-9]{1,30}$/.test(k) && !FIJAS.includes(k)) out[a][k] = +h > 0 ? +h : 0; }
      await db('SET', 'gratis', JSON.stringify(out)); return json({ ok: true });
    }
    if (!d.accion || d.accion === 'lista') {
      // Todas las personas que han tenido algo alguna vez (pacientes, suscripciones, regalos)
      const emails = [...new Set([...((await db('SMEMBERS', 'pacientes')) || []), ...((await db('SMEMBERS', 'personas')) || [])])];
      const lista = [];
      for (const e of emails) { const p = await leerPersona(e); if (p) lista.push(resumen(e, p)); }
      lista.sort((a, b) => (a.pac?.alta ? 1 : 0) - (b.pac?.alta ? 1 : 0) || (a.nombre || a.email).localeCompare(b.nombre || b.email));
      return json({ lista, margenDias: MARGEN_ALTA / DIA, siempre: 8e15 });
    }
    const email = limpiaCorreo(d.email);
    if (!correoValido(email)) return json({ error: 'Ese correo no parece completo.' }, 400);
    const p = (await leerPersona(email)) || { creado: Date.now() };
    const apps = (Array.isArray(d.apps) ? d.apps : []).filter((a) => a === 'm' || a === 'g');
    if (d.accion === 'buscar') return json({ persona: await leerPersona(email) ? resumen(email, p) : null });
    if (d.accion === 'nueva') {
      if (!apps.length) return json({ error: 'Elige al menos una app.' }, 400);
      p.pac = { apps, nombre: String(d.nombre || '').slice(0, 60), desde: Date.now(), alta: null };
      await guardarPersona(email, p); await db('SADD', 'pacientes', email);
      const link = await crearEnlace(email, apps[0], 60 * 24 * 7);
      await enviarCorreo(email, 'Tus herramientas ya están abiertas', plantilla(apps[0], 'Tus herramientas ya están abiertas', [
        `Te he dado acceso a ${nombresApps(apps)} mientras estemos en terapia. Son herramientas que he preparado para acompañarte entre sesión y sesión: para los momentos difíciles, para entender lo que sientes y para practicar lo que vamos trabajando.`,
        'Para entrar, toca este enlace desde tu móvil:', { enlace: ['Entrar en la app', link] }, T_CONSEJO,
        'Lo que escribas en las herramientas se guarda solo en tu móvil. Nadie más puede verlo, tampoco yo, salvo que tú decidas enseñármelo.',
        'Si te cuesta entrar o tienes cualquier duda, respóndeme a este correo.']));
      return json({ ok: true, persona: resumen(email, p) });
    }
    if (d.accion === 'enlace') {
      const acc = accesos(p), t = Date.now(), app = p.pac?.apps?.[0] || (acc.m > t ? 'm' : acc.g > t ? 'g' : null);
      if (!app) return json({ error: 'Esta persona no tiene acceso ahora mismo.' }, 400);
      const link = await crearEnlace(email, app, 60 * 24 * 7);
      await enviarCorreo(email, 'Tu enlace para entrar', plantilla(app, 'Tu enlace para entrar', ['Aquí tienes tu enlace para entrar en la app. Tócalo desde el móvil en el que quieras usarla; no necesitas contraseña.', { enlace: ['Entrar en la app', link] },
        'El enlace solo sirve una vez. Si no lo has pedido tú, puedes ignorar este correo: sin el enlace, nadie puede entrar.']));
      return json({ ok: true });
    }
    if (!p.pac) return json({ error: 'Este correo no está en tu lista de pacientes.' }, 404);
    if (d.accion === 'alta') {
      p.pac.alta = Date.now(); await guardarPersona(email, p);
      const app = p.pac.apps[0], hasta = p.pac.alta + MARGEN_ALTA, L = enlacesPago(), pago = p.pac.apps.length > 1 ? (L.p || L[app]) : L[app];
      await enviarCorreo(email, 'Gracias por este camino', plantilla(app, 'Gracias por este camino', [
        'Ha sido un placer acompañarte en este proceso. Gracias por tu confianza y por todo lo que has puesto de tu parte.',
        ...(pago ? [`Tu acceso a ${nombresApps(p.pac.apps)} sigue abierto hasta el ${fecha(hasta)}. Si quieres seguir usando las herramientas después, puedes suscribirte aquí:`, { enlace: ['Seguir con las herramientas', pago] }]
          : [`Tu acceso a ${nombresApps(p.pac.apps)} sigue abierto hasta el ${fecha(hasta)}. Si quieres seguir usando las herramientas después, podrás suscribirte desde la propia app.`]),
        'Lo que has escrito sigue guardado en tu móvil. Si quieres conservar una copia, en el inicio de la app, en «Copia de seguridad», puedes guardarla.',
        'Y si en algún momento necesitas volver, ya sabes dónde estoy.']));
      return json({ ok: true, persona: resumen(email, p) });
    }
    if (d.accion === 'reactivar') {
      p.pac.alta = null; if (apps.length) p.pac.apps = apps; await guardarPersona(email, p);
      const link = await crearEnlace(email, p.pac.apps[0], 60 * 24 * 7);
      await enviarCorreo(email, 'Tu acceso vuelve a estar abierto', plantilla(p.pac.apps[0], 'Tu acceso vuelve a estar abierto', [`Me alegra volver a acompañarte. He vuelto a abrir tu acceso a ${nombresApps(p.pac.apps)} mientras estemos en terapia.`,
        'Lo que escribiste sigue en tu móvil, tal como lo dejaste. Para entrar, toca este enlace:', { enlace: ['Entrar en la app', link] }]));
      return json({ ok: true, persona: resumen(email, p) });
    }
    if (d.accion === 'apps') { if (!apps.length) return json({ error: 'Elige al menos una app.' }, 400); p.pac.apps = apps; await guardarPersona(email, p); return json({ ok: true, persona: resumen(email, p) }); }
    if (d.accion === 'quitar') { delete p.pac; await guardarPersona(email, p); await db('SREM', 'pacientes', email); return json({ ok: true }); }
    return json({ error: 'Acción desconocida.' }, 400);
  } catch (err) { return json({ error: err.message }, 500); }
}
