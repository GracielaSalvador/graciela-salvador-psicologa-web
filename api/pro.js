// /api/pro → lo que usa el panel de las profesionales (www.gracielasalvador.com/profesionales/).
// Entran con su correo y un código de 6 números. Cada una solo ve y gestiona a sus propias pacientes.
import { soltarPaciente, db, limpiaCorreo, correoValido, leerPersona, guardarPersona, accesos, crearEnlace, enlacesEntrar, enviarCorreo, plantilla, nombresApps, fecha, DIA, MARGEN_ALTA, enlacesPago, T_CONSEJO,
  leerPro, guardarPro, proActiva, plazaOcupada, crearSesionPro, leerSesionPro, FIRMA_PRO, cuentaPropia } from './_comun.js';
export const config = { runtime: 'edge' };

const json = (o, st = 200, cookies = []) => { const h = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); for (const c of cookies) h.append('Set-Cookie', c); return new Response(JSON.stringify(o), { status: st, headers: h }); };
const COOKIE = (v, max) => `gs_pro=${encodeURIComponent(v)}; Path=/; Max-Age=${max}; HttpOnly; Secure; SameSite=Strict`;
const quien = (pr) => pr.nombre ? pr.nombre : 'tu psicóloga';

async function estado(email, pr) {
  const t = Date.now(), lista = [];
  for (const e of (await db('SMEMBERS', 'propac:' + email)) || []) {
    const p = await leerPersona(e); if (!p || !p.pp || p.pp.de !== email || p.pp.propia) continue;
    const hasta = accesos(p).m;
    lista.push({ email: e, alias: p.pp.alias || '', desde: p.pp.desde || 0, alta: p.pp.alta || 0, hasta: hasta > t ? hasta : 0, ocupa: plazaOcupada(p, email, t) });
  }
  lista.sort((a, b) => (b.ocupa - a.ocupa) || (a.alias || a.email).localeCompare(b.alias || b.email));
  const s = pr.sub || {};
  return { email, nombre: pr.nombre || '', plazas: pr.plazas || 0, usadas: lista.filter((x) => x.ocupa).length, activa: proActiva(pr, t), suspendida: !!pr.suspendida,
    manual: !!pr.manual, cancelada: !!(s.cancelada && !s.activa), hasta: pr.manual ? (pr.manualHasta || 0) : (s.activa ? 0 : s.hasta || 0), margenDias: MARGEN_ALTA / DIA, lista };
}

export default async function handler(req) {
  let d = {}; try { d = req.method === 'POST' ? await req.json() : {}; } catch (e) {}
  try {
    // 1) Pedir el código de entrada
    if (d.accion === 'codigo') {
      const email = limpiaCorreo(d.email);
      if (!correoValido(email)) return json({ error: 'Ese correo no parece completo.' }, 400);
      const libre = await db('SET', 'freno:pro:' + email, '1', 'NX', 'EX', '60');
      if (libre) {
        const pr = await leerPro(email);
        if (pr) {
          const pin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
          await db('SET', 'pinpro:' + email, JSON.stringify({ c: pin, n: 0 }), 'EX', '1800');
          await enviarCorreo(email, `Tu código para el panel: ${pin}`, plantilla('g', 'Tu código para el panel', [`Tu código para entrar en el panel de profesionales es: <b>${pin.slice(0, 3)} ${pin.slice(3)}</b>`,
            'Solo sirve una vez y caduca en 30 minutos. Si no lo has pedido tú, puedes ignorar este correo.'], null, FIRMA_PRO));
        }
      }
      return json({ ok: true });
    }
    // 2) Entrar con el código
    if (d.accion === 'entrar') {
      const email = limpiaCorreo(d.email), pin = String(d.pin || '').replace(/\D/g, ''), k = 'pinpro:' + email, v = correoValido(email) ? await db('GET', k) : null;
      if (!v) return json({ error: 'El código ha caducado o no es válido. Pide uno nuevo.' }, 400);
      const P = JSON.parse(v);
      if (P.c !== pin) { P.n = (P.n || 0) + 1; if (P.n >= 5) { await db('DEL', k); return json({ error: 'Demasiados intentos. Pide un código nuevo.' }, 400); } await db('SET', k, JSON.stringify(P), 'KEEPTTL'); return json({ error: 'Ese código no es correcto.' }, 400); }
      await db('DEL', k);
      return json({ ok: true }, 200, [COOKIE(await crearSesionPro(email), 30 * 86400)]);
    }
    const yo = await leerSesionPro(req);
    if (!yo) return json({ error: 'entrar' }, 401);
    if (d.accion === 'salir') return json({ ok: true }, 200, [COOKIE('', 0)]);
    const pr = await leerPro(yo);
    if (!pr) return json({ error: 'entrar' }, 401, [COOKIE('', 0)]);
    if (!d.accion || d.accion === 'estado') return json(await estado(yo, pr));
    if (d.accion === 'nombre') { pr.nombre = String(d.nombre || '').trim().slice(0, 60); await guardarPro(yo, pr); return json(await estado(yo, pr)); }
    if (d.accion === 'mi_acceso') { await cuentaPropia(yo); 
      await enviarCorreo(yo, 'Tu enlace para entrar en las apps', plantilla('g', 'Tu enlace para entrar en las apps', ['Aquí tienes tus enlaces para entrar en las dos apps, para que conozcas lo que ofreces a tus pacientes.', ...(await enlacesEntrar(yo, ['m', 'g'], 60 * 24)), T_CONSEJO], null, FIRMA_PRO));
      return json({ ok: true }); }

    const email = limpiaCorreo(d.email), t = Date.now();
    if (!correoValido(email)) return json({ error: 'Ese correo no parece completo.' }, 400);
    if (email === yo) return json({ error: 'Ese es tu propio correo. Tu acceso ya va incluido: pulsa «Entrar yo en las apps».' }, 400);
    const p = (await leerPersona(email)) || { creado: t };
    const mia = p.pp && p.pp.de === yo;

    if (d.accion === 'nueva' || d.accion === 'reabrir') {
      if (!proActiva(pr, t)) return json({ error: 'Tu plan no está activo. Para dar acceso a nuevas pacientes, renueva tu suscripción.' }, 403);
      if (p.pp && !mia && (!p.pp.fin || p.pp.fin > t) && !p.pp.alta) return json({ error: 'Esta persona ya tiene acceso a través de otra profesional.' }, 409);
      const est = await estado(yo, pr);
      if (!plazaOcupada(p, yo, t) && est.usadas >= (pr.plazas || 0)) return json({ error: `Has usado tus ${pr.plazas} plazas. Da el alta a alguna paciente para liberar una, o pasa a un plan con más plazas.` }, 403);
      const alias = d.accion === 'nueva' ? String(d.alias || '').slice(0, 40) : (mia ? p.pp.alias || '' : '');
      p.pp = { de: yo, alias, desde: mia && d.accion === 'reabrir' ? p.pp.desde : t, alta: null, fin: null };
      await guardarPersona(email, p); await db('SADD', 'propac:' + yo, email);
      const q = quien(pr);
      await enviarCorreo(email, 'Tus herramientas ya están abiertas', plantilla('g', 'Tus herramientas ya están abiertas', [
        `${q.charAt(0).toUpperCase() + q.slice(1)} te ha dado acceso a ${nombresApps(['g', 'm'])}: herramientas guiadas para acompañarte entre sesión y sesión, en los momentos difíciles y en tu día a día.`,
        ...(await enlacesEntrar(email, ['m', 'g'], 60 * 24 * 7)), T_CONSEJO,
        'Lo que escribas en las herramientas se guarda solo en tu móvil. Nadie más puede verlo: ni tu psicóloga ni nadie de Mi psicóloga en el bolsillo, salvo que tú decidas enseñarlo.',
        'Estas herramientas no sustituyen a tu proceso de terapia: son un apoyo para practicar lo que trabajáis juntas.'], null, FIRMA_PRO));
      return json(await estado(yo, pr));
    }
    if (!mia) return json({ error: 'Este correo no está en tu lista.' }, 404);
    if (d.accion === 'alias') { p.pp.alias = String(d.alias || '').slice(0, 40); await guardarPersona(email, p); return json(await estado(yo, pr)); }
    if (d.accion === 'enlace') {
      if (!(accesos(p).m > t)) return json({ error: 'Esta persona no tiene acceso ahora mismo.' }, 400);
      const link = await crearEnlace(email, 'g', 60 * 24 * 7);
      await enviarCorreo(email, 'Tu enlace para entrar', plantilla('g', 'Tu enlace para entrar', ['Aquí tienes tu enlace para entrar en la app. Tócalo desde el móvil en el que quieras usarla; no necesitas contraseña.', { enlace: ['Entrar en la app', link] }], null, FIRMA_PRO));
      return json({ ok: true });
    }
    if (d.accion === 'alta') {
      p.pp.alta = t; await guardarPersona(email, p);
      const hasta = accesos(p).m, L = enlacesPago();
      await enviarCorreo(email, 'Tu acceso a las herramientas', plantilla('g', 'Tu acceso a las herramientas', [
        `Tu psicóloga ha cerrado tu acceso a ${nombresApps(['g', 'm'])}. Sigue abierto hasta el ${fecha(hasta)}.`,
        ...(L.p ? ['Si quieres seguir usando las herramientas después, puedes suscribirte por tu cuenta aquí:', { enlace: ['Seguir con las herramientas', L.p] }] : []),
        'Lo que has escrito se guarda solo en tu móvil. <b>Antes de que termine tu acceso, guarda una copia de seguridad</b> desde la app, en «Contacto y ajustes» → «Copia de seguridad». Así, si vuelves más adelante, aunque sea desde otro móvil, podrás recuperarlo todo.'], null, FIRMA_PRO));
      return json(await estado(yo, pr));
    }
    if (d.accion === 'quitar') {
      // Quita el acceso ahora mismo (por ejemplo, si se equivocó de correo). No se borra nada del móvil de la paciente.
      await soltarPaciente(yo, email, p);
      return json(await estado(yo, pr));
    }
    return json({ error: 'Acción desconocida.' }, 400);
  } catch (err) { return json({ error: err.message }, 500); }
}
