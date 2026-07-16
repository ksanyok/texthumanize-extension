/**
 * THX.images — on-hover image provenance badge.
 *
 * When enabled (settings.imageHover, needs host permission), hovering an
 * image for a moment asks the service worker to fetch its bytes and scan
 * for AI-provenance signals (C2PA / XMP / EXIF / generator signatures via
 * the media-forensics engine). The verdict is shown in a small badge.
 *
 * Honest by construction: "AI markers found" is a positive signal; their
 * absence is reported as "no markers" (NOT "human-made").
 */

(() => {
  const { settings, ensureHost, send, esc, t } = window.THX;

  const MIN_SIZE = 128;         // ignore icons/avatars
  const DWELL_MS = 420;         // non-intrusive: require a short hover
  const cache = new Map();      // src → report

  let badge = null;
  let hoverTimer = null;
  let currentImg = null;

  function eligible(img) {
    if (!(img instanceof HTMLImageElement)) return false;
    if (!img.currentSrc && !img.src) return false;
    const r = img.getBoundingClientRect();
    return r.width >= MIN_SIZE && r.height >= MIN_SIZE;
  }

  function badgeEl() {
    if (badge) return badge;
    ensureHost();
    badge = document.createElement('div');
    badge.className = 'th-imgbadge';
    badge.addEventListener('mouseenter', () => { if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; } });
    badge.addEventListener('mouseleave', hideBadge);
    window.THX.shadow.appendChild(badge);
    return badge;
  }

  function place(img) {
    const r = img.getBoundingClientRect();
    const b = badgeEl();
    b.style.left = `${Math.max(6, r.left + 8)}px`;
    b.style.top = `${Math.max(6, r.top + 8)}px`;
  }

  function show(cls, html) {
    const b = badgeEl();
    b.className = `th-imgbadge ${cls}`;
    b.innerHTML = html;
    b.style.display = 'flex';
  }

  function hideBadge() {
    if (badge) badge.style.display = 'none';
    currentImg = null;
  }

  function renderVerdict(report) {
    if (report.needsPermission) {
      show('th-none', `<span class="th-dot"></span>${esc(t('imgEnableHint'))}`);
      return;
    }
    if (report.error) { hideBadge(); return; }
    if (report.isAiGenerated === true) {
      const gen = report.generator ? ` <small>${esc(report.generator)}</small>` : '';
      show('th-ai', `<span class="th-dot"></span>${esc(t('imgAi'))}${gen}`);
    } else if (report.provenance === 'authentic') {
      show('th-authentic', `<span class="th-dot"></span>${esc(t('imgAuthentic'))}`);
    } else {
      show('th-none', `<span class="th-dot"></span>${esc(t('imgNoMarkers'))} <small>${esc(t('imgNotGuarantee'))}</small>`);
    }
  }

  async function scan(img) {
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith('data:') && src.length > 2_000_000) return;
    place(img);
    if (cache.has(src)) { renderVerdict(cache.get(src)); return; }
    show('th-none th-scan', `<span class="th-dot"></span>${esc(t('imgScanning'))}`);
    try {
      const report = await send({ type: 'scan-image', src });
      cache.set(src, report);
      if (currentImg === img) renderVerdict(report);
      window.THX.track?.('image_scan', { verdict: report.isAiGenerated === true ? 'ai' : report.provenance || 'none' });
    } catch {
      if (currentImg === img) hideBadge();
    }
  }

  function onOver(e) {
    if (!settings.imageHover) return;
    const img = e.target;
    if (!eligible(img)) return;
    currentImg = img;
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => scan(img), DWELL_MS);
  }

  function onOut(e) {
    if (e.target !== currentImg) return;
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    hideTimer();
  }

  function hideTimer() {
    setTimeout(() => {
      // Keep the badge if the pointer moved onto it.
      if (badge && badge.matches(':hover')) return;
      hideBadge();
    }, 140);
  }

  function boot() {
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
  }

  window.THX.images = { boot, hideBadge };
})();
