// /api/admin → lo que usa la página de pacientes de Graciela (www.gracielasalvador.com/graciela/).
// Solo funciona con la contraseña ADMIN_PASSWORD de Vercel.
import { T_CONSEJO, enlacesPago, nombresApps, gratisConfig, FIJAS, db, esAdmin, crearAdmin, limpiaCorreo, correoValido, leerPersona, guardarPersona, accesos, crearEnlace, enviarCorreo, plantilla, APPS, fecha, DIA, MARGEN_ALTA, enlaceBaja, esc, leerPro, guardarPro, proActiva, plazaOcupada, cerrarPro, abrirPro, cuentaPropia } from './_comun.js';
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
    if (d.accion === 'novedades_prueba' || d.accion === 'novedades_envio') {
      const app = ['m', 'g', 'ambas'].includes(d.app) ? d.app : '', asunto = String(d.asunto || '').trim().slice(0, 120), texto = String(d.texto || '').trim().slice(0, 4000);
      if (!app || !asunto || !texto) return json({ error: 'Faltan el asunto, el texto o la app.' }, 400);
      const parrafos = texto.split(/\n\s*\n/).map((x) => esc(x.trim()).replace(/\n/g, '<br>')).filter(Boolean);
      const destApps = app === 'ambas' ? ['m', 'g'] : [app];
      const correo = async (email) => enviarCorreo(email, asunto, plantilla(destApps[0], asunto, [...parrafos,
        { enlace: ['Abrir la app', `https://${APPS[destApps[0]].host}/${APPS[destApps[0]].ruta}/`] },
        `<span style="font-size:12px;color:#777">Te escribo porque tienes acceso a ${nombresApps(destApps)}. Si prefieres no recibir estos avisos de novedades, <a href="${esc(await enlaceBaja(email))}" style="color:#777">pulsa aquí</a></span>`]));
      if (d.accion === 'novedades_prueba') { await correo((process.env.MAIL_FROM || 'hola@gracielasalvador.com').replace(/^.*</, '').replace(/>.*$/, '')); return json({ ok: true }); }
      // Envío por tandas: cada llamada manda unos pocos y dice cuántos quedan
      const id = String(d.id || ''), clave = 'nov:' + id;
      if (!/^[a-z0-9]{6,20}$/.test(id)) return json({ error: 'Envío no válido.' }, 400);
      let pend = await db('GET', clave);
      if (pend === null) {
        const t = Date.now(), emails = [...new Set([...((await db('SMEMBERS', 'pacientes')) || []), ...((await db('SMEMBERS', 'personas')) || [])])], lista = [];
        for (const e of emails) { const p = await leerPersona(e); if (!p || p.noNov) continue; const acc = accesos(p); if (destApps.some((a) => acc[a] > t)) lista.push(e); }
        pend = JSON.stringify(lista); await db('SET', clave, pend, 'EX', '86400');
      }
      const lista = JSON.parse(pend), tanda = lista.splice(0, 8); let fallos = 0;
      for (const e of tanda) { try { await correo(e); } catch (err) { fallos++; } await new Promise((r) => setTimeout(r, 600)); }
      await db('SET', clave, JSON.stringify(lista), 'EX', '86400');
      return json({ enviados: tanda.length - fallos, fallos, quedan: lista.length });
    }
    // ---------- Profesionales ----------
    if (d.accion === 'pros_lista') {
      const t = Date.now(), out = [];
      for (const pe of (await db('SMEMBERS', 'pros')) || []) {
        const pr = await leerPro(pe); if (!pr) continue; let usadas = 0;
        for (const e of (await db('SMEMBERS', 'propac:' + pe)) || []) { if (plazaOcupada(await leerPersona(e), pe, t)) usadas++; }
        const sub = pr.sub || {};
        out.push({ email: pe, nombre: pr.nombre || '', plazas: pr.plazas || 0, usadas, activa: proActiva(pr, t), suspendida: !!pr.suspendida, manual: !!pr.manual,
          hasta: pr.manual ? pr.manualHasta || 0 : (sub.activa ? 0 : sub.hasta || 0), plan: pr.manual ? 'A mano' : sub.plan || '', creado: pr.creado || 0 });
      }
      out.sort((a, b) => (b.activa - a.activa) || (a.nombre || a.email).localeCompare(b.nombre || b.email));
      return json({ pros: out });
    }
    if (/^pro_/.test(d.accion || '')) {
      const pe = limpiaCorreo(d.email); if (!correoValido(pe)) return json({ error: 'Ese correo no parece completo.' }, 400);
      let pr = await leerPro(pe);
      if (d.accion === 'pro_crear') {
        // Alta a mano (por ejemplo, un centro con plazas a medida que paga con factura)
        const nuevo = !pr; pr = pr || { email: pe, creado: Date.now() };
        pr.manual = true; pr.plazas = Math.max(1, Math.min(500, +d.plazas || 10)); pr.manualHasta = +d.hasta > 0 ? +d.hasta : 0; if (d.nombre) pr.nombre = String(d.nombre).slice(0, 60);
        await guardarPro(pe, pr); if (pr.cerrada && proActiva(pr)) await abrirPro(pe, pr); await cuentaPropia(pe);
        if (nuevo) await enviarCorreo(pe, 'Tu panel de profesional ya está listo', plantilla('g', 'Tu panel de profesional ya está listo', [
          `Te he dado de alta en Mi psicóloga en el bolsillo para profesionales, con ${pr.plazas} plazas.`,
          'Desde tu panel puedes dar acceso a tus pacientes con su correo, darles el alta y ver todas las herramientas con su enlace para mandárselas. Entras con este mismo correo y un código, sin contraseñas.',
          { enlace: ['Entrar en mi panel', 'https://www.gracielasalvador.com/profesionales/'] },
          'Antes de nada, en «Mi cuenta» escribe el nombre de tu consulta: tus pacientes lo verán en la app y en sus correos.']));
        return json({ ok: true });
      }
      if (!pr) return json({ error: 'No hay ninguna profesional con ese correo.' }, 404);
      if (d.accion === 'pro_plazas') { pr.plazas = Math.max(1, Math.min(500, +d.plazas || pr.plazas)); await guardarPro(pe, pr); return json({ ok: true }); }
      if (d.accion === 'pro_suspender') { pr.suspendida = true; await guardarPro(pe, pr); if (!pr.cerrada) await cerrarPro(pe, pr); return json({ ok: true }); }
      if (d.accion === 'pro_reactivar') { pr.suspendida = false; await guardarPro(pe, pr); if (pr.cerrada && proActiva(pr)) await abrirPro(pe, pr); return json({ ok: true }); }
      return json({ error: 'Acción desconocida.' }, 400);
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
        'Lo que has escrito se guarda solo en tu móvil. <b>Antes de que termine tu acceso, guarda una copia de seguridad</b> desde la app, en «Contacto y ajustes» → «Copia de seguridad». Así, si vuelves más adelante, aunque sea desde otro móvil, podrás recuperarlo todo.',
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
