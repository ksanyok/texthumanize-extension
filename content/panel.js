/**
 * THX.panel — the shared floating result panel.
 *
 * Renders results for every text/analysis tool and drives replace/copy.
 * Decoupled from the DOM: callers pass a `target` describing the text and
 * how (if at all) to write a result back.
 *
 * target = {
 *   text: string,
 *   canReplace: boolean,
 *   replace(newText): void,   // optional
 *   lang?: string,
 *   label?: string,           // e.g. "Gmail", "selection"
 * }
 */

(() => {
  const { t, esc, send, settings, ensureHost, fx } = window.THX;

  const TOOL_TABS = [
    { action: 'humanize', i18n: 'actHumanize' },
    { action: 'check', i18n: 'actCheck' },
    { action: 'tone', i18n: 'actTone' },
    { action: 'paraphrase', i18n: 'actParaphrase', pro: true },
    { action: 'clean', i18n: 'actClean' },
  ];

  const MSG_TYPE = {
    humanize: 'humanize', check: 'analyze', clean: 'clean',
    tone: 'tone', readability: 'readability', paraphrase: 'paraphrase',
    stylometry: 'stylometry',
  };

  let panel = null;
  let target = null;
  const state = { action: 'humanize', result: null, replacement: null, view: 'result', seed: 1 };

  function close() {
    if (panel) { panel.remove(); panel = null; }
    state.result = null;
  }

  function openFor(newTarget, action = 'humanize', anchorRect = null) {
    target = newTarget;
    state.action = action;
    build(anchorRect);
    run(action);
  }

  function build(anchorRect) {
    const shadow = ensureHost();
    if (panel) panel.remove();
    panel = document.createElement('div');
    panel.className = 'th-panel';
    panel.innerHTML = `
      <div class="th-head" data-drag>
        <span>${window.THX.LOGO}</span>
        <span class="th-title">TextHumanize</span>
        <span class="th-badge th-lang" hidden></span>
        <span class="th-badge th-offline">${esc(t('offlineBadge'))}</span>
        <span class="th-spacer"></span>
        <button class="th-icon-btn th-pop" title="${esc(t('openWorkspace'))}">⤢</button>
        <button class="th-icon-btn th-close" title="${esc(t('close'))}">✕</button>
      </div>
      <div class="th-tabs"></div>
      <div class="th-body">
        <div class="th-loading" hidden><span class="th-spinner"></span><span>${esc(t('processing'))}</span></div>
        <div class="th-content"></div>
      </div>
      <div class="th-controls" hidden>
        <label class="th-slider-row">
          <span>${esc(t('intensity'))}</span>
          <input type="range" min="0" max="100" step="5" class="th-intensity" value="${settings.intensity}">
          <b class="th-intensity-val">${settings.intensity}</b>
        </label>
      </div>
      <div class="th-actions">
        <button class="th-btn th-primary th-apply" hidden>${esc(t('replaceInPage'))}</button>
        <button class="th-btn th-copy" hidden>${esc(t('copy'))}</button>
        <button class="th-btn th-reroll" hidden>↻ ${esc(t('reroll'))}</button>
      </div>
      <div class="th-foot">
        <a href="${window.THX.libUrl}" target="_blank" rel="noopener">${esc(t('credit'))}</a>
        <span class="th-ver">v${esc(window.THX.version)}</span>
      </div>`;
    shadow.appendChild(panel);

    const tabs = panel.querySelector('.th-tabs');
    for (const tab of TOOL_TABS) {
      const b = document.createElement('button');
      b.className = 'th-tab';
      b.dataset.action = tab.action;
      b.innerHTML = esc(t(tab.i18n)) + (tab.pro ? ' <span class="th-pro">PRO</span>' : '');
      b.addEventListener('click', () => run(tab.action));
      tabs.appendChild(b);
    }

    // Position near the anchor, clamped to viewport.
    const pw = 408; const ph = 340;
    let x = anchorRect ? anchorRect.left : (innerWidth - pw) / 2;
    let y = anchorRect ? anchorRect.bottom + 10 : 90;
    x = Math.max(10, Math.min(innerWidth - pw - 10, x));
    y = Math.max(10, Math.min(innerHeight - ph - 10, y));
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;

    panel.querySelector('.th-close').addEventListener('click', close);
    panel.querySelector('.th-pop').addEventListener('click', () => {
      send({ type: 'open-workspace', text: target?.text || '' }).catch(() => {});
      close();
    });
    const slider = panel.querySelector('.th-intensity');
    const sliderVal = panel.querySelector('.th-intensity-val');
    slider.addEventListener('input', () => { sliderVal.textContent = slider.value; });
    slider.addEventListener('change', () => { if (state.action === 'humanize') run('humanize'); });
    panel.querySelector('.th-apply').addEventListener('click', apply);
    panel.querySelector('.th-copy').addEventListener('click', copy);
    panel.querySelector('.th-reroll').addEventListener('click', () => {
      state.seed = (state.seed * 1103515245 + 12345) & 0x7fffffff;
      run(state.action, { seed: state.seed });
    });
    makeDraggable(panel, panel.querySelector('.th-head'));
  }

  function setActiveTab(action) {
    if (!panel) return;
    for (const b of panel.querySelectorAll('.th-tab')) {
      b.classList.toggle('th-active', b.dataset.action === action);
    }
  }

  function busy(on) {
    if (!panel) return;
    panel.querySelector('.th-loading').hidden = !on;
    panel.querySelector('.th-content').style.opacity = on ? '.35' : '1';
  }

  function run(action, extra = {}) {
    if (!target || !target.text || !target.text.trim()) { message(t('noSelection')); return; }
    state.action = action;
    setActiveTab(action);
    panel.querySelector('.th-controls').hidden = action !== 'humanize';
    busy(true);

    const slider = panel.querySelector('.th-intensity');
    const overrides = { intensity: Number(slider.value), ...extra };
    send({ type: MSG_TYPE[action], text: target.text, overrides })
      .then((data) => { busy(false); state.result = { action, data }; render(); })
      .catch((err) => { busy(false); message(String(err.message || err)); });
  }

  function message(msg) {
    if (!panel) return;
    panel.querySelector('.th-content').innerHTML = `<div class="th-note">${esc(msg)}</div>`;
    ['.th-apply', '.th-copy', '.th-reroll'].forEach((s) => { panel.querySelector(s).hidden = true; });
  }

  function langBadge(lang) {
    const b = panel?.querySelector('.th-lang');
    if (b && lang) { b.textContent = lang.toUpperCase(); b.hidden = false; }
  }

  function cls(pct) { return pct >= 60 ? 'red' : pct >= 35 ? 'yellow' : 'green'; }
  function hueFor(pct) { return Math.max(2, Math.round(130 - pct * 1.7)); }

  /** The living Aura score orb — hero element for the check view. */
  function orb(prob, verdict) {
    const pct = Math.round(prob * 100);
    return `<div class="th-orbwrap">
      <div class="th-orb2" style="--h:${hueFor(pct)}">
        <b><span data-count="${pct}" data-suffix="">0</span><i>%</i></b>
      </div>
      <div class="th-orb-verdict th-c-${cls(pct)}">${esc(t(`verdict_${verdict}`) || verdict)}</div>
    </div>`;
  }

  function meter(label, prob, verdict) {
    const pct = Math.round(prob * 100);
    const c = cls(pct);
    return `<div class="th-meter-row">
      <span class="th-meter-label">${esc(label)}</span>
      <div class="th-meter"><div class="th-meter-fill th-${c}" data-w="${pct}"></div></div>
      <b class="th-meter-num th-c-${c}" data-count="${pct}">0%</b>
      <span class="th-verdict th-c-${c}">${esc(t(`verdict_${verdict}`) || verdict)}</span>
    </div>`;
  }

  function animateMeters() {
    if (!panel) return;
    panel.querySelectorAll('.th-meter-fill').forEach((el) => {
      requestAnimationFrame(() => { el.style.width = `${el.dataset.w}%`; });
    });
    panel.querySelectorAll('[data-count]').forEach((el) => {
      fx.countUp(el, 0, Number(el.dataset.count), el.dataset.suffix ?? '%');
    });
  }

  function render() {
    if (!panel || !state.result) return;
    const { action, data } = state.result;
    const content = panel.querySelector('.th-content');
    const applyBtn = panel.querySelector('.th-apply');
    const copyBtn = panel.querySelector('.th-copy');
    const rerollBtn = panel.querySelector('.th-reroll');
    applyBtn.hidden = copyBtn.hidden = rerollBtn.hidden = true;
    const canReplace = target && target.canReplace;

    const renderer = RENDER[action] || RENDER.humanize;
    renderer(data, content, { applyBtn, copyBtn, rerollBtn, canReplace });
    animateMeters();
  }

  const RENDER = {
    humanize(data, content, ui) {
      langBadge(data.lang);
      const before = data.before ? Math.round(data.before.aiProbability * 100) : null;
      const after = data.after ? Math.round(data.after.aiProbability * 100) : null;
      const delta = before != null && after != null ? after - before : null;
      state.replacement = data.text;
      content.innerHTML = `
        ${data.before ? meter(t('beforeLabel'), data.before.aiProbability, data.before.verdict) : ''}
        ${data.after ? meter(t('afterLabel'), data.after.aiProbability, data.after.verdict) : ''}
        ${delta != null && delta < 0 ? `<div class="th-ok">▼ ${esc(t('improvedBy', [String(-delta)]))}</div>` : ''}
        <div class="th-result-text" contenteditable="true" spellcheck="false">${esc(data.text)}</div>
        <div class="th-kv"><span>${esc(t('changesCount', [String(data.changes.length)]))}</span>
        ${data.watermark?.removed ? `<span>· ${esc(t('hiddenRemoved', [String(data.watermark.removed)]))}</span>` : ''}</div>`;
      const rt = content.querySelector('.th-result-text');
      rt.addEventListener('input', () => { state.replacement = rt.innerText; });
      ui.applyBtn.hidden = !ui.canReplace;
      ui.copyBtn.hidden = false;
      ui.rerollBtn.hidden = false;
      if (delta != null && delta < 0) fx.sparkle(panel.querySelector('.th-head'));
    },

    check(data, content) {
      langBadge(data.lang);
      const d = data.detection; const wm = data.watermark;
      const top = Object.entries(d.scores || {}).sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([k, v]) => `<li>${esc(t(`metric_${k}`) || k)} — <b>${Math.round(v * 100)}%</b></li>`).join('');
      content.innerHTML = `
        ${orb(d.aiProbability, d.verdict)}
        <div class="th-kv" style="justify-content:center"><span>${esc(t('confidence'))}: <b>${Math.round(d.confidence * 100)}%</b></span>
        <span>${esc(t('words'))}: <b>${d.wordCount}</b></span></div>
        ${top ? `<div class="th-sub">${esc(t('topSignals'))}</div><ul class="th-list">${top}</ul>` : ''}
        ${wm.hasWatermarks ? `<div class="th-warn">⚠ ${esc(t('watermarksFound', [String(wm.removed)]))}</div>`
          : `<div class="th-ok">✓ ${esc(t('noWatermarks'))}</div>`}`;
    },

    clean(data, content, ui) {
      langBadge(data.lang);
      state.replacement = data.text;
      content.innerHTML = `
        ${data.hasWatermarks ? `<div class="th-warn">⚠ ${esc(t('watermarksFound', [String(data.removed)]))}</div>
          <ul class="th-list">${data.details.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
          : `<div class="th-ok">✓ ${esc(t('noWatermarks'))}</div>`}
        <div class="th-result-text">${esc(data.text)}</div>`;
      ui.applyBtn.hidden = !ui.canReplace || !data.hasWatermarks;
      ui.copyBtn.hidden = false;
      if (data.hasWatermarks) fx.sparkle(panel.querySelector('.th-head'));
    },

    tone(data, content, ui) {
      langBadge(data.lang);
      const levelName = t(`tone_${data.level}`) || data.level;
      const pct = Math.round((data.formalityScore ?? data.score ?? 0.5) * 100);
      const sig = (data.indicators || Object.entries(data.signals || {})
        .filter(([, v]) => v).map(([k]) => k)).slice(0, 6);
      content.innerHTML = `
        <div class="th-meter-row"><span class="th-meter-label">${esc(t('formality'))}</span>
          <div class="th-meter"><div class="th-meter-fill th-yellow" data-w="${pct}"></div></div>
          <b class="th-meter-num" data-count="${pct}">0%</b></div>
        <div class="th-kv"><span>${esc(t('toneLevel'))}: <b>${esc(levelName)}</b></span></div>
        ${sig.length ? `<div class="th-chips">${sig.map((s) => `<span class="th-pill">${esc(String(s))}</span>`).join('')}</div>` : ''}
        <div class="th-sub">${esc(t('toneAdjust'))}</div>
        <div class="th-actions" style="padding:6px 0 0">
          <button class="th-btn th-tone-set" data-lvl="formal">${esc(t('toneMoreFormal'))}</button>
          <button class="th-btn th-tone-set" data-lvl="informal">${esc(t('toneMoreCasual'))}</button>
        </div>`;
      content.querySelectorAll('.th-tone-set').forEach((b) => b.addEventListener('click', () => {
        busy(true);
        send({ type: 'tone-adjust', text: target.text, overrides: { target: b.dataset.lvl } })
          .then((r) => {
            busy(false);
            state.replacement = r.text;
            content.querySelector('.th-actions')?.insertAdjacentHTML('afterend',
              `<div class="th-result-text" contenteditable="true" spellcheck="false">${esc(r.text)}</div>`);
            const rt = content.querySelector('.th-result-text');
            rt.addEventListener('input', () => { state.replacement = rt.innerText; });
            ui.applyBtn.hidden = !ui.canReplace;
            ui.copyBtn.hidden = false;
            fx.sparkle(panel.querySelector('.th-head'));
          })
          .catch((e) => { busy(false); message(String(e.message || e)); });
      }));
    },

    paraphrase(data, content, ui) {
      langBadge(data.lang);
      state.replacement = data.text;
      content.innerHTML = `
        <div class="th-result-text" contenteditable="true" spellcheck="false">${esc(data.text)}</div>
        <div class="th-kv"><span>${esc(t('changesCount', [String((data.changes || []).length)]))}</span></div>`;
      const rt = content.querySelector('.th-result-text');
      rt.addEventListener('input', () => { state.replacement = rt.innerText; });
      ui.applyBtn.hidden = !ui.canReplace;
      ui.copyBtn.hidden = false;
      ui.rerollBtn.hidden = false;
      fx.sparkle(panel.querySelector('.th-head'));
    },

    readability(data, content) {
      const g = data.gradeLevel ?? data.fleschKincaidGrade;
      const rows = [
        ['fleschReadingEase', data.fleschReadingEase],
        ['fleschKincaidGrade', data.fleschKincaidGrade],
        ['gunningFog', data.gunningFog],
        ['smog', data.smog],
        ['colemanLiau', data.colemanLiau],
      ];
      content.innerHTML = `
        <div class="th-kv"><span>${esc(t('readingLevel'))}: <b>${esc(String(data.readingLevel || ''))}</b></span>
        <span>${esc(t('grade'))}: <b>${g != null ? Math.round(g) : '—'}</b></span></div>
        <ul class="th-list">${rows.map(([k, v]) => `<li>${esc(t(`metric_${k}`) || k)}: <b>${v != null ? (Math.round(v * 10) / 10) : '—'}</b></li>`).join('')}</ul>`;
    },

    stylometry(data, content) {
      const p = data.profile || data;
      const entries = Object.entries(p).filter(([, v]) => typeof v === 'number').slice(0, 8);
      content.innerHTML = `
        ${data.summary ? `<div class="th-kv"><span>${esc(String(data.summary))}</span></div>` : ''}
        <ul class="th-list">${entries.map(([k, v]) => `<li>${esc(k)}: <b>${Math.round(v * 100) / 100}</b></li>`).join('')}</ul>`;
    },
  };

  function apply() {
    if (!target || typeof state.replacement !== 'string') return;
    try {
      target.replace(state.replacement);
      const btn = panel?.querySelector('.th-apply');
      if (btn) { const old = btn.textContent; btn.textContent = `✓ ${t('replaced')}`; btn.disabled = true;
        fx.sparkle(btn);
        setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 1400); }
    } catch { copy(); }
  }

  function copy() {
    if (typeof state.replacement !== 'string') return;
    navigator.clipboard?.writeText(state.replacement).then(() => {
      const btn = panel?.querySelector('.th-copy');
      if (btn) { const old = btn.textContent; btn.textContent = `✓ ${t('copied')}`;
        setTimeout(() => { btn.textContent = old; }, 1400); }
    }).catch(() => {});
  }

  function makeDraggable(el, handle) {
    let sx = 0; let sy = 0; let ox = 0; let oy = 0; let dragging = false;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true; sx = e.clientX; sy = e.clientY;
      ox = parseFloat(el.style.left); oy = parseFloat(el.style.top); e.preventDefault();
    });
    addEventListener('mousemove', (e) => {
      if (!dragging) return;
      el.style.left = `${Math.max(0, ox + e.clientX - sx)}px`;
      el.style.top = `${Math.max(0, oy + e.clientY - sy)}px`;
    }, true);
    addEventListener('mouseup', () => { dragging = false; }, true);
  }

  window.THX.panel = { openFor, close, isOpen: () => !!panel };
})();
