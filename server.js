require('dotenv').config();
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

app.set('view engine', 'ejs');
app.set('views', './views');
app.use(express.static('./public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Rate limiting ────────────────────────────────────────────────────────────
const claimLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.' },
});

// ─── Cookie helpers ───────────────────────────────────────────────────────────
const ADMIN_COOKIE = 'nfcgo_admin';

function parseCookies(header) {
  const cookies = {};
  (header || '').split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const key = part.slice(0, idx).trim();
    try { cookies[key] = decodeURIComponent(part.slice(idx + 1).trim()); }
    catch { cookies[key] = part.slice(idx + 1).trim(); }
  });
  return cookies;
}

function requireAdmin(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[ADMIN_COOKIE] === ADMIN_PASSWORD) return next();
  res.redirect('/admin/login');
}

function setCookieAdmin(res) {
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_COOKIE}=${encodeURIComponent(ADMIN_PASSWORD)}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax`
  );
}

function clearCookieAdmin(res) {
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

// ─── Flash helper (query-param based, no extra deps) ─────────────────────────
function flashFromQuery(req) {
  if (req.query.ok)  return { type: 'success', msg: String(req.query.ok).slice(0, 200) };
  if (req.query.err) return { type: 'error',   msg: String(req.query.err).slice(0, 200) };
  return null;
}

function redirectFlash(res, path, type, msg) {
  const key = type === 'success' ? 'ok' : 'err';
  res.redirect(`${path}?${key}=${encodeURIComponent(msg)}`);
}

// ─── CSV sanitizer ────────────────────────────────────────────────────────────
function csvCell(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  // Prevent formula injection (Excel / LibreOffice)
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${safe.replace(/"/g, '""')}"`;
}

// ════════════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ════════════════════════════════════════════════════════════════════════════════

// ─── Tag landing page ─────────────────────────────────────────────────────────
app.get('/c/:tag_code', (req, res) => {
  const { tag_code } = req.params;
  const tag = db
    .prepare(
      `SELECT t.*, b.name AS business_name, b.logo_url, b.reward_text, b.slug
       FROM nfc_tags t
       JOIN businesses b ON b.id = t.business_id
       WHERE t.tag_code = ?`
    )
    .get(tag_code);

  if (!tag || tag.status !== 'active') {
    return res.render('landing', {
      state: 'claimed',
      tag: tag || null,
      business: tag
        ? { name: tag.business_name, logo_url: tag.logo_url, reward_text: tag.reward_text }
        : null,
      discount_code: tag?.discount_code || null,
    });
  }

  res.render('landing', {
    state: 'active',
    tag,
    business: { name: tag.business_name, logo_url: tag.logo_url, reward_text: tag.reward_text },
    discount_code: null,
  });
});

// ─── Claim endpoint ───────────────────────────────────────────────────────────
app.post('/claim/:tag_code', claimLimiter, (req, res) => {
  const { tag_code } = req.params;

  const claim = db.transaction(() => {
    const tag = db
      .prepare(
        `SELECT t.*, b.name AS business_name, b.logo_url, b.reward_text, b.slug
         FROM nfc_tags t
         JOIN businesses b ON b.id = t.business_id
         WHERE t.tag_code = ?`
      )
      .get(tag_code);

    if (!tag) return { ok: false, error: 'Etiqueta no encontrada.', status: 404 };
    if (tag.status !== 'active')
      return { ok: false, error: 'Este premio ya ha sido reclamado.', status: 409 };

    db.prepare(
      `UPDATE nfc_tags SET status = 'claimed', claimed_at = CURRENT_TIMESTAMP WHERE tag_code = ?`
    ).run(tag_code);

    return {
      ok: true,
      discount_code: tag.discount_code,
      business_name: tag.business_name,
      reward_text: tag.reward_text,
    };
  });

  const result = claim();
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

// ════════════════════════════════════════════════════════════════════════════════
// ADMIN: AUTH
// ════════════════════════════════════════════════════════════════════════════════

app.get('/admin/login', (req, res) => {
  res.render('admin-login', { error: null });
});

app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    setCookieAdmin(res);
    return res.redirect('/admin');
  }
  res.render('admin-login', { error: 'Contraseña incorrecta.' });
});

app.get('/admin/logout', (req, res) => {
  clearCookieAdmin(res);
  res.redirect('/admin/login');
});

// ════════════════════════════════════════════════════════════════════════════════
// ADMIN: DASHBOARD
// ════════════════════════════════════════════════════════════════════════════════

app.get('/admin', requireAdmin, (req, res) => {
  const businesses = db
    .prepare(
      `SELECT b.*,
              COUNT(t.id) AS tag_count,
              SUM(CASE WHEN t.status='claimed' THEN 1 ELSE 0 END) AS claimed_count
       FROM businesses b
       LEFT JOIN nfc_tags t ON t.business_id = b.id
       GROUP BY b.id
       ORDER BY b.created_at DESC`
    )
    .all();

  const stats = db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status='active'   THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status='claimed'  THEN 1 ELSE 0 END) AS claimed,
        SUM(CASE WHEN status='disabled' THEN 1 ELSE 0 END) AS disabled
       FROM nfc_tags`
    )
    .get();

  res.render('admin', {
    businesses,
    stats,
    page: 'dashboard',
    flash: flashFromQuery(req),
    baseUrl: BASE_URL,
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// ADMIN: BUSINESSES — CREATE / EDIT / DELETE
// ════════════════════════════════════════════════════════════════════════════════

app.post('/admin/businesses', requireAdmin, (req, res) => {
  const { name, slug, logo_url, reward_text } = req.body;
  if (!name || !slug || !reward_text) {
    return redirectFlash(res, '/admin', 'error', 'Nombre, slug y texto de recompensa son obligatorios.');
  }
  const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  try {
    db.prepare(
      `INSERT INTO businesses (name, slug, logo_url, reward_text) VALUES (?, ?, ?, ?)`
    ).run(name, cleanSlug, logo_url || null, reward_text);
    redirectFlash(res, '/admin', 'success', `Negocio "${name}" creado correctamente`);
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return redirectFlash(res, '/admin', 'error', `El slug "${cleanSlug}" ya existe.`);
    }
    throw e;
  }
});

app.post('/admin/businesses/:id/edit', requireAdmin, (req, res) => {
  const { name, logo_url, reward_text, active } = req.body;
  const info = db.prepare(
    `UPDATE businesses SET name=?, logo_url=?, reward_text=?, active=? WHERE id=?`
  ).run(name, logo_url || null, reward_text, active === '1' ? 1 : 0, req.params.id);

  if (info.changes === 0) return res.redirect('/admin');
  redirectFlash(res, `/admin/businesses/${req.params.id}`, 'success', 'Cambios guardados');
});

// ─── DELETE business (cascade) ────────────────────────────────────────────────
app.post('/admin/businesses/:id/delete', requireAdmin, (req, res) => {
  const business = db.prepare(`SELECT * FROM businesses WHERE id=?`).get(req.params.id);
  if (!business) return redirectFlash(res, '/admin', 'error', 'Negocio no encontrado.');

  db.transaction(() => {
    db.prepare(`DELETE FROM nfc_tags  WHERE business_id=?`).run(req.params.id);
    db.prepare(`DELETE FROM businesses WHERE id=?`).run(req.params.id);
  })();

  redirectFlash(res, '/admin', 'success', `Negocio "${business.name}" eliminado`);
});

// ════════════════════════════════════════════════════════════════════════════════
// ADMIN: BUSINESS DETAIL
// ════════════════════════════════════════════════════════════════════════════════

app.get('/admin/businesses/:id', requireAdmin, (req, res) => {
  const business = db.prepare(`SELECT * FROM businesses WHERE id=?`).get(req.params.id);
  if (!business) return res.redirect('/admin');

  const tags = db
    .prepare(`SELECT * FROM nfc_tags WHERE business_id=? ORDER BY discount_code`)
    .all(req.params.id);

  const stats = db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status='active'   THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status='claimed'  THEN 1 ELSE 0 END) AS claimed,
        SUM(CASE WHEN status='disabled' THEN 1 ELSE 0 END) AS disabled
       FROM nfc_tags WHERE business_id=?`
    )
    .get(req.params.id);

  res.render('admin', {
    businesses: null,
    business,
    tags,
    stats,
    page: 'business',
    flash: flashFromQuery(req),
    baseUrl: BASE_URL,
  });
});

// ─── Generate tags ────────────────────────────────────────────────────────────
app.post('/admin/businesses/:id/generate', requireAdmin, (req, res) => {
  const business = db.prepare(`SELECT * FROM businesses WHERE id=?`).get(req.params.id);
  if (!business) return res.redirect('/admin');

  const count   = Math.min(parseInt(req.body.count,    10) || 30, 200);
  const prefix  = (req.body.prefix || business.slug).replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const startAt = parseInt(req.body.start_at, 10) || 1;

  const insert = db.prepare(
    `INSERT INTO nfc_tags (tag_code, business_id, discount_code) VALUES (?, ?, ?)`
  );
  db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const num = String(startAt + i).padStart(3, '0');
      insert.run(uuidv4(), business.id, `${prefix}-${num}`);
    }
  })();

  redirectFlash(res, `/admin/businesses/${req.params.id}`, 'success', `${count} etiquetas generadas`);
});

// ─── Reset ALL tags of a business ────────────────────────────────────────────
app.post('/admin/businesses/:id/reset-all', requireAdmin, (req, res) => {
  const business = db.prepare(`SELECT * FROM businesses WHERE id=?`).get(req.params.id);
  if (!business) return res.redirect('/admin');

  const result = db.prepare(
    `UPDATE nfc_tags SET status='active', claimed_at=NULL WHERE business_id=?`
  ).run(req.params.id);

  redirectFlash(
    res,
    `/admin/businesses/${req.params.id}`,
    'success',
    `${result.changes} etiqueta(s) reseteadas a "disponible"`
  );
});

// ─── Export CSV ───────────────────────────────────────────────────────────────
app.get('/admin/businesses/:id/export.csv', requireAdmin, (req, res) => {
  const business = db.prepare(`SELECT * FROM businesses WHERE id=?`).get(req.params.id);
  if (!business) return res.redirect('/admin');

  const tags = db
    .prepare(`SELECT * FROM nfc_tags WHERE business_id=? ORDER BY discount_code`)
    .all(req.params.id);

  const header = [
    csvCell('Codigo descuento'),
    csvCell('Tag UUID'),
    csvCell('Estado'),
    csvCell('Fecha reclamacion'),
    csvCell('URL NFC'),
  ].join(',');

  const rows = tags.map(t => [
    csvCell(t.discount_code),
    csvCell(t.tag_code),
    csvCell(t.status === 'active' ? 'Disponible' : t.status === 'claimed' ? 'Reclamada' : 'Desactivada'),
    csvCell(t.claimed_at || ''),
    csvCell(`${BASE_URL}/c/${t.tag_code}`),
  ].join(','));

  const csv = [header, ...rows].join('\r\n');
  const filename = `${business.slug}-etiquetas.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send('﻿' + csv); // UTF-8 BOM for Excel
});

// ════════════════════════════════════════════════════════════════════════════════
// ADMIN: TAGS — INDIVIDUAL & BULK ACTIONS
// ════════════════════════════════════════════════════════════════════════════════

// ─── Disable single tag ───────────────────────────────────────────────────────
app.post('/admin/tags/:id/disable', requireAdmin, (req, res) => {
  const tag = db.prepare(`SELECT * FROM nfc_tags WHERE id=?`).get(req.params.id);
  if (!tag) return res.redirect('/admin');
  db.prepare(`UPDATE nfc_tags SET status='disabled' WHERE id=?`).run(req.params.id);
  res.redirect(`/admin/businesses/${tag.business_id}`);
});

// ─── Enable / reset single tag ────────────────────────────────────────────────
app.post('/admin/tags/:id/enable', requireAdmin, (req, res) => {
  const tag = db.prepare(`SELECT * FROM nfc_tags WHERE id=?`).get(req.params.id);
  if (!tag) return res.redirect('/admin');
  // Also clears claimed_at so the tag is truly fresh
  db.prepare(`UPDATE nfc_tags SET status='active', claimed_at=NULL WHERE id=?`).run(req.params.id);
  res.redirect(`/admin/businesses/${tag.business_id}`);
});

// ─── Bulk delete tags (JSON endpoint) ────────────────────────────────────────
app.post('/admin/businesses/:id/tags/bulk-delete', requireAdmin, (req, res) => {
  const business = db.prepare(`SELECT id FROM businesses WHERE id=?`).get(req.params.id);
  if (!business) return res.status(404).json({ error: 'Negocio no encontrado.' });

  const raw = req.body.ids;
  if (!Array.isArray(raw) || raw.length === 0)
    return res.status(400).json({ error: 'No se seleccionaron etiquetas.' });

  const ids = raw.map(x => parseInt(x, 10)).filter(x => Number.isInteger(x) && x > 0);
  if (ids.length === 0) return res.status(400).json({ error: 'IDs inválidos.' });

  const placeholders = ids.map(() => '?').join(',');
  const result = db.transaction(() =>
    db.prepare(
      `DELETE FROM nfc_tags WHERE id IN (${placeholders}) AND business_id=?`
    ).run(...ids, business.id)
  )();

  res.json({ ok: true, deleted: result.changes });
});

// ─── Bulk reset tags (JSON endpoint) ─────────────────────────────────────────
app.post('/admin/businesses/:id/tags/bulk-reset', requireAdmin, (req, res) => {
  const business = db.prepare(`SELECT id FROM businesses WHERE id=?`).get(req.params.id);
  if (!business) return res.status(404).json({ error: 'Negocio no encontrado.' });

  const raw = req.body.ids;
  if (!Array.isArray(raw) || raw.length === 0)
    return res.status(400).json({ error: 'No se seleccionaron etiquetas.' });

  const ids = raw.map(x => parseInt(x, 10)).filter(x => Number.isInteger(x) && x > 0);
  if (ids.length === 0) return res.status(400).json({ error: 'IDs inválidos.' });

  const placeholders = ids.map(() => '?').join(',');
  const result = db.transaction(() =>
    db.prepare(
      `UPDATE nfc_tags SET status='active', claimed_at=NULL
       WHERE id IN (${placeholders}) AND business_id=?`
    ).run(...ids, business.id)
  )();

  res.json({ ok: true, reset: result.changes });
});

// ─── Root redirect ────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/admin'));

app.listen(PORT, () => {
  console.log(`NFC GO corriendo en ${BASE_URL}`);
});
