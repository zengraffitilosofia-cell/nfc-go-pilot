/* ─────────────────────────────────────────────────────────────────────────────
   NFC GO · Admin Panel — public/admin.js
   Cargado solo en /admin (no en la landing pública).
───────────────────────────────────────────────────────────────────────────── */

// ── Datos de contexto inyectados por el servidor vía data-attributes ──────────
const jsData     = document.getElementById('js-data');
const BUSINESS_ID = jsData?.dataset.businessId || null;
const BASE_URL    = jsData?.dataset.baseUrl || '';

// ════════════════════════════════════════════════════════════════════════════════
// TOAST — auto-ocultamiento y creación programática
// ════════════════════════════════════════════════════════════════════════════════

(function initToast() {
  const toast = document.getElementById('admin-toast');
  if (!toast) return;
  // Aparece ya visible; ocultamos tras 4 s
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setTimeout(() => hideToast(toast), 4000);
    });
  });
})();

function hideToast(el) {
  el.classList.add('toast--hiding');
  el.addEventListener('transitionend', () => el.remove(), { once: true });
}

/**
 * Muestra un toast efímero en el área de contenido (llamada desde JS).
 * @param {'success'|'error'} type
 * @param {string} msg
 */
function showToast(type, msg) {
  const existing = document.getElementById('admin-toast');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.id        = 'admin-toast';
  el.className = `toast toast--${type}`;
  el.textContent = `${type === 'success' ? '✓' : '✕'} ${msg}`;

  const anchor = document.getElementById('admin-toast-anchor');
  if (anchor) anchor.after(el);
  else document.querySelector('.admin-content')?.prepend(el);

  setTimeout(() => hideToast(el), 4000);
}

// ════════════════════════════════════════════════════════════════════════════════
// DELETE BUSINESS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Llamado por el botón "Eliminar" en la tabla de negocios.
 * Crea un form dinámico y lo envía tras confirmación.
 */
function deleteBusiness(btn) {
  const { businessId, businessName } = btn.dataset;
  if (!confirm(
    `¿Eliminar el negocio "${businessName}" y TODAS sus etiquetas?\n\n` +
    `Esta acción no se puede deshacer.`
  )) return;

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = `/admin/businesses/${businessId}/delete`;
  document.body.appendChild(form);
  form.submit();
}

// ════════════════════════════════════════════════════════════════════════════════
// SELECCIÓN MASIVA & BULK ACTIONS
// ════════════════════════════════════════════════════════════════════════════════

(function initBulkActions() {
  const cbAll   = document.getElementById('cb-select-all');
  const toolbar = document.getElementById('bulk-toolbar');
  const countEl = document.getElementById('selected-count');
  if (!cbAll || !BUSINESS_ID) return;

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function allCheckboxes() { return [...document.querySelectorAll('.tag-cb')]; }
  function checkedIds()    { return allCheckboxes().filter(cb => cb.checked).map(cb => parseInt(cb.value)); }

  function syncToolbar() {
    const all     = allCheckboxes();
    const checked = all.filter(cb => cb.checked);
    const n       = checked.length;

    countEl.textContent = n;
    toolbar.classList.toggle('bulk-toolbar--visible', n > 0);

    cbAll.checked       = n > 0 && n === all.length;
    cbAll.indeterminate = n > 0 && n < all.length;
  }

  // ── Seleccionar todo ──────────────────────────────────────────────────────────
  cbAll.addEventListener('change', () => {
    // Solo afecta a filas visibles (no filtradas)
    document.querySelectorAll('.tag-row:not([style*="display: none"]) .tag-cb')
      .forEach(cb => cb.checked = cbAll.checked);
    syncToolbar();
  });

  document.querySelectorAll('.tag-cb').forEach(cb => {
    cb.addEventListener('change', syncToolbar);
  });

  // ── Fetch helper ──────────────────────────────────────────────────────────────
  async function bulkAction(endpoint, confirmMsg, successKey, successLabel) {
    const ids = checkedIds();
    if (ids.length === 0) { showToast('error', 'No hay etiquetas seleccionadas.'); return; }
    if (!confirm(confirmMsg)) return;

    try {
      const resp = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ids }),
      });
      const data = await resp.json();

      if (resp.ok && data.ok) {
        const n = data[successKey] ?? ids.length;
        window.location.href =
          `/admin/businesses/${BUSINESS_ID}?ok=${encodeURIComponent(`${n} ${successLabel}`)}`;
      } else {
        showToast('error', data.error || 'Error desconocido.');
      }
    } catch {
      showToast('error', 'Error de red. Comprueba la conexión.');
    }
  }

  // ── Bulk delete ───────────────────────────────────────────────────────────────
  document.getElementById('btn-bulk-delete')?.addEventListener('click', () => {
    const n = checkedIds().length;
    bulkAction(
      `/admin/businesses/${BUSINESS_ID}/tags/bulk-delete`,
      `¿Eliminar ${n} etiqueta(s) permanentemente?\n\nEsta acción no se puede deshacer.`,
      'deleted',
      'etiqueta(s) eliminada(s)'
    );
  });

  // ── Bulk reset ────────────────────────────────────────────────────────────────
  document.getElementById('btn-bulk-reset')?.addEventListener('click', () => {
    const n = checkedIds().length;
    bulkAction(
      `/admin/businesses/${BUSINESS_ID}/tags/bulk-reset`,
      `¿Resetear ${n} etiqueta(s) a "disponible"?\n\nSe borrará la fecha de reclamación.`,
      'reset',
      'etiqueta(s) reseteada(s)'
    );
  });
})();

// ════════════════════════════════════════════════════════════════════════════════
// FILTRO EN TIEMPO REAL
// ════════════════════════════════════════════════════════════════════════════════

(function initFilter() {
  const input      = document.getElementById('tag-filter');
  const emptyMsg   = document.getElementById('filter-empty');
  const cbAll      = document.getElementById('cb-select-all');
  if (!input) return;

  input.addEventListener('input', () => {
    const q     = input.value.toLowerCase().trim();
    const rows  = [...document.querySelectorAll('.tag-row')];
    let visible = 0;

    rows.forEach(row => {
      const match = !q || (row.dataset.search || '').includes(q);
      row.style.display = match ? '' : 'none';
      if (match) visible++;
    });

    if (emptyMsg) emptyMsg.classList.toggle('hidden', visible > 0);

    // Desmarcar todo al filtrar para evitar selecciones ocultas
    if (cbAll) {
      cbAll.checked       = false;
      cbAll.indeterminate = false;
    }
    document.querySelectorAll('.tag-cb').forEach(cb => cb.checked = false);
    const toolbar = document.getElementById('bulk-toolbar');
    if (toolbar) toolbar.classList.remove('bulk-toolbar--visible');
    const countEl = document.getElementById('selected-count');
    if (countEl) countEl.textContent = '0';
  });
})();

// ════════════════════════════════════════════════════════════════════════════════
// COPIAR URL AL PORTAPAPELES
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Llamado por el botón "Copiar" en cada fila de etiqueta.
 */
function copyUrl(btn) {
  const url = btn.dataset.url;

  const finish = (ok) => {
    const orig = btn.textContent;
    btn.textContent = ok ? '¡Copiado!' : 'Error';
    btn.classList.toggle('btn--copied', ok);
    setTimeout(() => {
      btn.textContent = orig;
      btn.classList.remove('btn--copied');
    }, 1500);
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(() => finish(true)).catch(() => finish(false));
  } else {
    // Fallback para contextos no-HTTPS o navegadores antiguos
    try {
      const ta = Object.assign(document.createElement('textarea'), {
        value: url,
        style: 'position:fixed;opacity:0',
      });
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      ta.remove();
      finish(true);
    } catch {
      finish(false);
    }
  }
}
