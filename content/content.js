/**
 * TextHumanize content orchestrator (loaded last).
 *
 * Owns the selection bubble, routes context-menu / keyboard actions from the
 * service worker, exposes THX.track, and boots the editor-chip and
 * image-hover subsystems.
 */

(() => {
  if (window.__thBooted) return;
  window.__thBooted = true;

  const { settings, ensureHost, esc } = window.THX;

  // Relay anonymous usage events to the service worker (never any content).
  window.THX.track = (event, params) => {
    try { chrome.runtime.sendMessage({ type: 'track', event, params }); } catch { /* */ }
  };

  // ── Selection capture → target ────────────────────────────────
  function captureSelection() {
    const active = document.activeElement;
    const editable = window.THX.editors?.editableOf(active);
    if (editable && (editable.kind === 'textarea' || editable.kind === 'input')) {
      const el = editable.el;
      const s = el.selectionStart ?? 0; const e = el.selectionEnd ?? 0;
      if (e > s) {
        return {
          text: el.value.slice(s, e), canReplace: true, label: 'field',
          replace: (v) => { el.setRangeText(v, s, e, 'end'); el.dispatchEvent(new Event('input', { bubbles: true })); },
        };
      }
    }
    const sel = getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = sel.toString();
    if (!text.trim()) return null;
    const range = sel.getRangeAt(0).cloneRange();
    const host = editable?.el || (range.commonAncestorContainer.parentElement?.closest('[contenteditable]'));
    if (host && host.isContentEditable) {
      return {
        text, canReplace: true, label: 'selection',
        replace: (v) => {
          const s2 = getSelection(); s2.removeAllRanges(); s2.addRange(range);
          if (!document.execCommand('insertText', false, v)) {
            range.deleteContents(); range.insertNode(document.createTextNode(v));
          }
          host.dispatchEvent(new Event('input', { bubbles: true }));
        },
      };
    }
    return { text, canReplace: false, label: 'selection' };
  }

  function selectionRect() {
    const sel = getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r && (r.width || r.height)) return r;
    }
    return null;
  }

  // ── Bubble ────────────────────────────────────────────────────
  let bubble = null;

  function showBubble() {
    if (!settings.selectionBubble) return;
    const rect = selectionRect();
    if (!rect) return hideBubble();
    const shadow = ensureHost();
    if (!bubble) {
      bubble = document.createElement('button');
      bubble.className = 'th-bubble';
      bubble.title = 'TextHumanize';
      bubble.innerHTML = window.THX.LOGO;
      bubble.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const target = captureSelection();
        hideBubble();
        if (target) {
          window.THX.panel.openFor(target, 'humanize', selectionRect());
          window.THX.track('selection_action', { tool: 'humanize' });
        }
      });
      shadow.appendChild(bubble);
    }
    const x = Math.min(innerWidth - 44, Math.max(8, rect.right + 6));
    const y = Math.min(innerHeight - 44, Math.max(8, rect.bottom + 6));
    bubble.style.left = `${x}px`;
    bubble.style.top = `${y}px`;
    bubble.classList.add('th-visible');
  }

  function hideBubble() { if (bubble) bubble.classList.remove('th-visible'); }

  document.addEventListener('mouseup', (e) => {
    if (window.top !== window) return; // bubble only in the top document
    if (window.THX.shadow && e.composedPath?.().some((n) => n === window.THX.shadow?.host)) return;
    setTimeout(() => {
      const sel = getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim().length >= 15) showBubble();
      else hideBubble();
    }, 10);
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideBubble(); window.THX.panel.close(); }
  }, true);
  addEventListener('scroll', hideBubble, true);

  // ── Site forensics: lightweight DOM fingerprints (the page's *code*) ──
  function collectSite() {
    const hosts = new Set();
    const paths = new Set();
    const add = (u) => {
      try {
        const url = new URL(u, location.href);
        hosts.add(url.hostname.toLowerCase());
        if (url.pathname && url.pathname !== '/') paths.add(url.pathname.toLowerCase().slice(0, 48));
      } catch { /* */ }
    };
    let n = 0;
    for (const s of document.querySelectorAll('script[src]')) { if (n++ > 60) break; add(s.getAttribute('src')); }
    n = 0;
    for (const l of document.querySelectorAll('link[href]')) { if (n++ > 60) break; add(l.getAttribute('href')); }
    n = 0;
    for (const im of document.images) { if (n++ > 24) break; add(im.currentSrc || im.src); }
    const attrs = new Set();
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      for (const a of el.attributes) attrs.add(a.name.toLowerCase());
    }
    const ids = [];
    for (const id of ['__next', '__nuxt', '___gatsby', '__docusaurus', 'gatsby-focus-wrapper', '__framer-badge-container', 'lovable-badge', 'base44-badge', 'swup', 'root', 'app', '__astro']) {
      if (document.getElementById(id)) ids.push(id);
    }
    // Sample data-* attribute names and class tokens across the document — these
    // reveal component stacks (Radix/shadcn, Framer, Elementor, Divi, Vue…) that
    // AI site generators emit. Bounded for speed.
    const dataAttrs = new Set();
    const classes = new Set();
    let e = 0;
    for (const el of document.querySelectorAll('*')) {
      if (e++ > 1200) break;
      if (el.hasAttributes()) {
        for (const a of el.attributes) { if (a.name.startsWith('data-') && dataAttrs.size < 80) dataAttrs.add(a.name.toLowerCase()); }
      }
      const cl = el.getAttribute && el.getAttribute('class');
      if (cl && classes.size < 160) { for (const c of cl.split(/\s+/)) { if (c) classes.add(c.toLowerCase()); if (classes.size >= 160) break; } }
    }
    let powered = '';
    const foot = document.querySelector('footer') || document.body;
    try { powered = (foot?.innerText || '').toLowerCase().slice(-600); } catch { /* */ }
    let fonts = '';
    try { fonts = (getComputedStyle(document.body).fontFamily || '').toLowerCase(); } catch { /* */ }
    return {
      generator: (document.querySelector('meta[name="generator"]')?.content || '').toLowerCase(),
      themeColor: (document.querySelector('meta[name="theme-color"]')?.content || '').toLowerCase(),
      hosts: [...hosts].slice(0, 60),
      paths: [...paths].slice(0, 60),
      attrs: [...attrs],
      dataAttrs: [...dataAttrs],
      classes: [...classes],
      ids,
      fonts,
      aiGradient: detectAiGradient(),
      powered,
      hostname: location.hostname,
    };
  }

  // Detect the "AI-startup" palette: a violet/indigo → cyan/blue gradient, the
  // near-universal look of pages spun up by AI builders. Bounded, best-effort.
  function detectAiGradient() {
    const rgbHue = (r, g, b) => {
      r /= 255; g /= 255; b /= 255;
      const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
      if (d < 0.06) return -1; // near-grey, ignore
      let h = 0;
      if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360; return h;
    };
    const sel = 'body, header, section, h1, [class*="hero" i], [class*="gradient" i], button, a[class*="btn" i], [class*="cta" i]';
    let violet = false; let cyan = false; let n = 0;
    try {
      for (const el of document.querySelectorAll(sel)) {
        if (n++ > 60) break;
        const cs = getComputedStyle(el);
        const bg = `${cs.backgroundImage} ${cs.background}`;
        if (!bg.includes('gradient')) continue;
        const cols = bg.match(/rgba?\([^)]+\)/gi) || [];
        for (const c of cols) {
          const m = c.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
          if (!m) continue;
          const h = rgbHue(+m[1], +m[2], +m[3]);
          if (h >= 250 && h <= 295) violet = true;       // violet / indigo
          if (h >= 170 && h <= 235) cyan = true;          // cyan / blue
        }
        if (violet && cyan) return true;
      }
    } catch { /* */ }
    return violet && cyan;
  }

  // ── Page collection for the popup "Scan this page" feature ──
  function collectPage() {
    const blocks = [];
    const seen = new Set();
    const sel = 'p, li, h1, h2, h3, blockquote, article, section, td, dd, figcaption';
    for (const el of document.querySelectorAll(sel)) {
      if (el.closest('nav, footer, header, aside')) continue;
      const txt = (el.innerText || '').trim().replace(/\s+/g, ' ');
      if (txt.length < 60) continue;
      const key = txt.slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      blocks.push(txt.slice(0, 600));
      if (blocks.length >= 40) break;
    }
    const images = [];
    const iseen = new Set();
    for (const img of document.images) {
      const r = img.getBoundingClientRect();
      if (r.width < 128 || r.height < 128) continue;
      const src = img.currentSrc || img.src;
      if (!src || iseen.has(src) || src.startsWith('data:')) continue;
      iseen.add(src);
      images.push(src);
      if (images.length >= 12) break;
    }
    let words = 0;
    try { words = (document.body.innerText.trim().match(/\S+/g) || []).length; } catch { /* */ }
    return { blocks, images, words, site: collectSite() };
  }

  // ── Actions from the service worker (context menu / commands / scan) ──
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'collect-page') {
      // Only the top document answers, so the popup gets one response.
      if (window.top !== window) return;
      sendResponse(collectPage());
      return;
    }
    if (message?.type !== 'th-action') return;
    let target = captureSelection();
    if (!target && message.selectionText) {
      target = { text: message.selectionText, canReplace: false, label: 'selection' };
    }
    hideBubble();
    if (target) {
      window.THX.panel.openFor(target, message.action, selectionRect());
      window.THX.track('menu_action', { tool: message.action });
    }
    sendResponse?.({ ok: true });
  });

  // ── Toolbar badge: quick "is this site AI-built?" from page code ──
  async function reportSiteBadge() {
    if (window.top !== window) return; // top document owns the badge
    try { await window.THX.send({ type: 'site-badge', site: collectSite() }); } catch { /* */ }
  }

  // ── Boot subsystems ───────────────────────────────────────────
  window.THX.editors?.boot();
  window.THX.images?.boot();
  window.THX.hover?.boot();

  // Fingerprints are usually all present by idle; give SPA shells a moment.
  if (document.readyState === 'complete') setTimeout(reportSiteBadge, 400);
  else addEventListener('load', () => setTimeout(reportSiteBadge, 400), { once: true });
})();
