/**
 * THX.hover — inline AI-likelihood on hover for any text block.
 *
 * Hovering a paragraph, list item, social post, article block… for a moment
 * highlights it and shows a small badge ("🤖 78%" / "👤 12%"). Clicking the
 * badge opens the full details panel (score, heatmap, Humanize/Rephrase).
 * Fast: a lightweight quick-score runs in the service worker; results are
 * cached per element. Top frame only, to avoid noise in ad iframes.
 */

(() => {
  const { settings, send, ensureHost, esc, t } = window.THX;

  const MIN_CHARS = 140;
  const MAX_CHARS = 6000;
  const DWELL_MS = 380;
  const BLOCK_TAGS = new Set(['P', 'LI', 'BLOCKQUOTE', 'ARTICLE', 'H1', 'H2', 'H3', 'H4', 'DD', 'FIGCAPTION', 'TD', 'DIV', 'SPAN', 'SECTION']);

  const cache = new WeakMap();
  let badge = null;
  let ring = null;
  let timer = null;
  let currentEl = null;

  function inOwnUi(el) {
    return window.THX.shadow && el.getRootNode?.() === window.THX.shadow;
  }

  /** Tightest block (≥ MIN_CHARS) around a node. */
  function blockOf(node) {
    let el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    while (el && el !== document.body && el !== document.documentElement) {
      if (el.isContentEditable) return null;
      if (el.closest('nav, footer, header, aside, button, a[href], input, textarea')) {
        // Allow the element itself if it's just inside a link but is real content.
        if (el.matches('nav, footer, header, aside, button, input, textarea')) return null;
      }
      if (BLOCK_TAGS.has(el.tagName)) {
        const txt = (el.innerText || '').trim();
        if (txt.length >= MIN_CHARS && txt.length <= MAX_CHARS) return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  function ensureEls() {
    const shadow = ensureHost();
    if (!ring) {
      ring = document.createElement('div');
      ring.className = 'th-ring';
      shadow.appendChild(ring);
    }
    if (!badge) {
      badge = document.createElement('button');
      badge.className = 'th-hbadge';
      badge.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
      badge.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!currentEl) return;
        const text = (currentEl.innerText || '').trim();
        const rect = currentEl.getBoundingClientRect();
        window.THX.panel.openFor({ text, canReplace: false, label: 'block' }, 'check', rect);
        window.THX.track?.('hover_open', { tool: 'check' });
        hide();
      });
      shadow.appendChild(badge);
    }
  }

  function place(el) {
    if (!ring || !badge || !el) return; // scroll can fire before els exist
    const r = el.getBoundingClientRect();
    ring.style.left = `${r.left}px`;
    ring.style.top = `${r.top}px`;
    ring.style.width = `${r.width}px`;
    ring.style.height = `${r.height}px`;
    ring.style.display = 'block';
    const bx = Math.min(innerWidth - 66, Math.max(4, r.right - 62));
    const by = Math.max(4, r.top - 12);
    badge.style.left = `${bx}px`;
    badge.style.top = `${by}px`;
  }

  function render(res) {
    const pct = Math.round(res.prob * 100);
    const cls = res.verdict === 'ai' ? 'th-ai' : res.verdict === 'human' ? 'th-human' : 'th-mixed';
    const face = res.verdict === 'ai' ? '🤖' : res.verdict === 'human' ? '👤' : '🤔';
    badge.className = `th-hbadge ${cls}`;
    badge.innerHTML = `<span>${face}</span> ${pct}%`;
    badge.style.display = 'flex';
    ring.className = `th-ring ${cls}`;
  }

  async function scan(el) {
    ensureEls();
    place(el);
    const cached = cache.get(el);
    if (cached) { render(cached); return; }
    badge.className = 'th-hbadge th-scan';
    badge.innerHTML = '<span class="th-mini-spin"></span>';
    badge.style.display = 'flex';
    try {
      const text = (el.innerText || '').trim();
      const res = await send({ type: 'quick-score', text });
      cache.set(el, res);
      if (currentEl === el) render(res);
    } catch {
      if (currentEl === el) hide();
    }
  }

  function hide() {
    if (badge) badge.style.display = 'none';
    if (ring) ring.style.display = 'none';
    currentEl = null;
  }

  function scanEnabledHere() {
    // Per-site only — OFF on every site until the user adds it to the list.
    // (No global switch, so a stale hoverAnalyze:true from old versions can't
    // turn it on everywhere.)
    const list = settings.scanSites;
    return Array.isArray(list) && list.includes(location.hostname);
  }

  function onOver(e) {
    if (!scanEnabledHere()) return;
    if (window.top !== window) return;
    const target = e.target;
    if (!target || inOwnUi(target)) return;
    if (badge && (target === badge || badge.contains(target))) return;
    const block = blockOf(target);
    if (!block) return;
    if (block === currentEl) return;
    currentEl = block;
    clearTimeout(timer);
    timer = setTimeout(() => { if (currentEl === block) scan(block); }, DWELL_MS);
  }

  function onMove(e) {
    if (!currentEl) return;
    if (badge && badge.style.display !== 'none' && (e.target === badge || badge.contains?.(e.target))) return;
    // Keep while pointer is within the current block or the badge.
    const r = currentEl.getBoundingClientRect();
    const pad = 24;
    const inside = e.clientX >= r.left - pad && e.clientX <= r.right + pad &&
      e.clientY >= r.top - pad && e.clientY <= r.bottom + pad;
    if (!inside) { clearTimeout(timer); hide(); }
  }

  function boot() {
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mousemove', onMove, true);
    addEventListener('scroll', () => { if (currentEl) place(currentEl); }, true);
  }

  window.THX.hover = { boot, hide };
})();
