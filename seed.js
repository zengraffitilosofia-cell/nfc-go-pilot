require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

// ── Crea el negocio de ejemplo ─────────────────────────────────────────────
let business = db.prepare(`SELECT * FROM businesses WHERE slug = 'la-toscana'`).get();

if (!business) {
  db.prepare(
    `INSERT INTO businesses (name, slug, logo_url, reward_text)
     VALUES (?, ?, ?, ?)`
  ).run(
    'La Toscana',
    'la-toscana',
    null,
    '10% de descuento en tu próxima visita'
  );
  business = db.prepare(`SELECT * FROM businesses WHERE slug = 'la-toscana'`).get();
  console.log('✅ Negocio "La Toscana" creado.');
} else {
  console.log('ℹ️  El negocio "La Toscana" ya existe, omitiendo.');
}

// ── Genera 30 etiquetas ────────────────────────────────────────────────────
const existing = db
  .prepare(`SELECT COUNT(*) AS n FROM nfc_tags WHERE business_id = ?`)
  .get(business.id).n;

if (existing > 0) {
  console.log(`ℹ️  Ya hay ${existing} etiquetas para este negocio, omitiendo generación.`);
} else {
  const insert = db.prepare(
    `INSERT INTO nfc_tags (tag_code, business_id, discount_code) VALUES (?, ?, ?)`
  );
  const generate = db.transaction(() => {
    for (let i = 1; i <= 30; i++) {
      insert.run(uuidv4(), business.id, `TOSC-${String(i).padStart(3, '0')}`);
    }
  });
  generate();
  console.log('✅ 30 etiquetas generadas con prefijo TOSC-001 … TOSC-030.');
}

// ── Muestra resumen ────────────────────────────────────────────────────────
const tags = db
  .prepare(`SELECT tag_code, discount_code FROM nfc_tags WHERE business_id = ? LIMIT 5`)
  .all(business.id);

console.log('\nPrimeras 5 etiquetas generadas:');
tags.forEach(t => {
  console.log(`  • Código: ${t.discount_code}  →  URL: /c/${t.tag_code}`);
});
console.log('\nAbre http://localhost:3000/admin para ver el panel completo.');
