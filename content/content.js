/**
 * TextHumanize — content script.
 *
 * Injects a selection bubble and an in-page floating panel (Shadow DOM,
 * fully style-isolated). Lets the user humanize / check / clean any
 * selected text on any page, and replace it in place when the selection
 * lives in an editable element. All processing happens in the extension
 * service worker — the page never talks to any server.
 */

(() => {
  if (window.__thContentLoaded) return;
  window.__thContentLoaded = true;

  const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;

  /** Current selection context captured at action time. */
  let captured = null;
  let settings = { intensity: 60, profile: 'web', selectionBubble: true };
  let lastSeed = 1;

  chrome.runtime.sendMessage({ type: 'get-settings' }, (res) => {
    if (res?.ok) settings = { ...settings, ...res.data };
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings?.newValue) {
      settings = { ...settings, ...changes.settings.newValue };
      if (!settings.selectionBubble) hideBubble();
    }
  });

  // ── Selection capture ─────────────────────────────────────────

  function isEditable(node) {
    if (!node) return null;
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el) return null;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return el;
    if (tag === 'INPUT' && /^(text|search|url|email)$/i.test(el.type || 'text')) return el;
    const ce = el.closest('[contenteditable]');
    if (ce && ce.isContentEditable) return ce;
    return null;
  }

  function captureSelection() {
    const active = document.activeElement;
    const field = isEditable(active);
    if (field && (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT')) {
      const start = field.selectionStart ?? 0;
      const end = field.selectionEnd ?? 0;
      if (end > start) {
        return {
          kind: 'field',
          field,
          start,
          end,
          text: field.value.slice(start, end),
        };
      }
      return null;
    }

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = sel.toString();
    if (!text.trim()) return null;
    const range = sel.getRangeAt(0).cloneRange();
    const editableHost = isEditable(range.commonAncestorContainer);
    return { kind: editableHost ? 'contenteditable' : 'static', range, text, editableHost };
  }

  function selectionRect() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect && (rect.width || rect.height)) return rect;
    }
    const active = document.activeElement;
    if (active && isEditable(active)) return active.getBoundingClientRect();
    return null;
  }

  // ── Shadow host ───────────────────────────────────────────────

  let host = null;
  let shadow = null;
  let bubble = null;
  let panel = null;

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement('texthumanize-root');
    host.style.all = 'initial';
    host.style.position = 'fixed';
    host.style.zIndex = '2147483646';
    host.style.inset = 'auto';
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS_TEXT;
    shadow.appendChild(style);
    (document.body || document.documentElement).appendChild(host);
  }

  // ── Bubble ────────────────────────────────────────────────────

  function showBubble() {
    if (!settings.selectionBubble) return;
    const rect = selectionRect();
    if (!rect) return hideBubble();
    ensureHost();
    if (!bubble) {
      bubble = document.createElement('button');
      bubble.className = 'th-bubble';
      bubble.title = 'TextHumanize';
      bubble.innerHTML = LOGO_SVG;
      bubble.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        captured = captureSelection();
        hideBubble();
        openPanel();
        if (captured) runAction('humanize');
      });
      shadow.appendChild(bubble);
    }
    const x = Math.min(window.innerWidth - 44, Math.max(8, rect.right + 6));
    const y = Math.min(window.innerHeight - 44, Math.max(8, rect.bottom + 6));
    bubble.style.left = `${x}px`;
    bubble.style.top = `${y}px`;
    bubble.classList.add('th-visible');
  }

  function hideBubble() {
    if (bubble) bubble.classList.remove('th-visible');
  }

  document.addEventListener('mouseup', (e) => {
    if (panel && panel.contains(e.target)) return;
    setTimeout(() => {
      const sel = captureSelection();
      if (sel && sel.text.trim().length >= 15) showBubble();
      else hideBubble();
    }, 10);
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideBubble();
      closePanel();
    }
  }, true);

  document.addEventListener('scroll', hideBubble, true);

  // ── Panel ─────────────────────────────────────────────────────

  const state = {
    busy: false,
    result: null,
    view: 'result', // result | diff | original
    lastAction: 'humanize',
  };

  function openPanel() {
    ensureHost();
    if (panel) panel.remove();
    panel = document.createElement('div');
    panel.className = 'th-panel';
    panel.innerHTML = `
      <div class="th-head" data-drag>
        <span class="th-logo">${LOGO_SVG}</span>
        <span class="th-title">TextHumanize</span>
        <span class="th-badge th-lang" hidden></span>
        <span class="th-badge th-offline">${t('offlineBadge')}</span>
        <button class="th-icon-btn th-close" title="${t('close')}">✕</button>
      </div>
      <div class="th-tabs">
        <button class="th-tab" data-action="humanize">${t('actHumanize')}</button>
        <button class="th-tab" data-action="check">${t('actCheck')}</button>
        <button class="th-tab" data-action="clean">${t('actClean')}</button>
      </div>
      <div class="th-body">
        <div class="th-loading" hidden>
          <span class="th-spinner"></span><span>${t('processing')}</span>
        </div>
        <div class="th-content"></div>
      </div>
      <div class="th-controls">
        <label class="th-slider-row">
          <span>${t('intensity')}</span>
          <input type="range" min="0" max="100" step="5" class="th-intensity">
          <b class="th-intensity-val"></b>
        </label>
      </div>
      <div class="th-actions">
        <button class="th-btn th-primary th-apply" hidden>${t('replaceInPage')}</button>
        <button class="th-btn th-copy" hidden>${t('copy')}</button>
        <button class="th-btn th-reroll" hidden title="${t('rerollHint')}">↻ ${t('reroll')}</button>
      </div>
      <div class="th-foot">
        <a href="https://github.com/ksanyok/TextHumanize" target="_blank" rel="noopener">
          ${t('credit')}
        </a>
      </div>`;

    shadow.appendChild(panel);

    // Position near selection, clamped.
    const rect = selectionRect();
    const pw = 400;
    const ph = 340;
    let x = rect ? rect.left : (window.innerWidth - pw) / 2;
    let y = rect ? rect.bottom + 10 : 80;
    x = Math.max(10, Math.min(window.innerWidth - pw - 10, x));
    y = Math.max(10, Math.min(window.innerHeight - ph - 10, y));
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;

    // Wire events.
    panel.querySelector('.th-close').addEventListener('click', closePanel);
    for (const tab of panel.querySelectorAll('.th-tab')) {
      tab.addEventListener('click', () => runAction(tab.dataset.action));
    }
    const slider = panel.querySelector('.th-intensity');
    const sliderVal = panel.querySelector('.th-intensity-val');
    slider.value = settings.intensity;
    sliderVal.textContent = settings.intensity;
    slider.addEventListener('input', () => { sliderVal.textContent = slider.value; });
    slider.addEventListener('change', () => {
      settings.intensity = Number(slider.value);
      if (state.lastAction === 'humanize') runAction('humanize');
    });
    panel.querySelector('.th-apply').addEventListener('click', applyReplacement);
    panel.querySelector('.th-copy').addEventListener('click', copyResult);
    panel.querySelector('.th-reroll').addEventListener('click', () => {
      lastSeed = (lastSeed * 1103515245 + 12345) & 0x7fffffff;
      runAction('humanize', { seed: lastSeed });
    });

    makeDraggable(panel, panel.querySelector('.th-head'));
  }

  function closePanel() {
    if (panel) { panel.remove(); panel = null; }
    state.result = null;
  }

  function makeDraggable(el, handle) {
    let sx = 0; let sy = 0; let ox = 0; let oy = 0; let dragging = false;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      ox = parseFloat(el.style.left); oy = parseFloat(el.style.top);
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      el.style.left = `${Math.max(0, ox + e.clientX - sx)}px`;
      el.style.top = `${Math.max(0, oy + e.clientY - sy)}px`;
    }, true);
    window.addEventListener('mouseup', () => { dragging = false; }, true);
  }

  // ── Actions ───────────────────────────────────────────────────

  function setBusy(busy) {
    state.busy = busy;
    if (!panel) return;
    panel.querySelector('.th-loading').hidden = !busy;
    panel.querySelector('.th-content').style.opacity = busy ? '0.35' : '1';
  }

  function setActiveTab(action) {
    if (!panel) return;
    for (const tab of panel.querySelectorAll('.th-tab')) {
      tab.classList.toggle('th-active', tab.dataset.action === action);
    }
  }

  function runAction(action, extraOverrides = {}) {
    if (!captured) captured = captureSelection();
    if (!captured || !captured.text.trim()) {
      renderMessage(t('noSelection'));
      return;
    }
    if (!panel) openPanel();
    state.lastAction = action;
    setActiveTab(action);
    setBusy(true);

    const overrides = { intensity: settings.intensity, ...extraOverrides };
    const typeMap = { humanize: 'humanize', check: 'analyze', clean: 'clean' };

    chrome.runtime.sendMessage(
      { type: typeMap[action], text: captured.text, overrides },
      (res) => {
        setBusy(false);
        if (chrome.runtime.lastError || !res?.ok) {
          renderMessage((chrome.runtime.lastError?.message) || res?.error || 'Error');
          return;
        }
        state.result = { action, data: res.data };
        renderResult();
      },
    );
  }

  // ── Rendering ─────────────────────────────────────────────────

  function esc(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function renderMessage(msg) {
    if (!panel) openPanel();
    panel.querySelector('.th-content').innerHTML = `<div class="th-note">${esc(msg)}</div>`;
  }

  function scoreMeter(label, prob, verdict) {
    const pct = Math.round(prob * 100);
    const cls = pct >= 60 ? 'th-red' : pct >= 35 ? 'th-yellow' : 'th-green';
    const verdictText = t(`verdict_${verdict}`) || verdict;
    return `
      <div class="th-meter-row">
        <span class="th-meter-label">${label}</span>
        <div class="th-meter"><div class="th-meter-fill ${cls}" style="width:${pct}%"></div></div>
        <b class="th-meter-num ${cls}">${pct}%</b>
        <span class="th-verdict ${cls}">${esc(verdictText)}</span>
      </div>`;
  }

  function updateLangBadge(lang) {
    const badge = panel?.querySelector('.th-lang');
    if (badge && lang) {
      badge.textContent = lang.toUpperCase();
      badge.hidden = false;
    }
  }

  function renderResult() {
    if (!panel || !state.result) return;
    const { action, data } = state.result;
    const content = panel.querySelector('.th-content');
    const applyBtn = panel.querySelector('.th-apply');
    const copyBtn = panel.querySelector('.th-copy');
    const rerollBtn = panel.querySelector('.th-reroll');
    const canReplace = captured && captured.kind !== 'static';

    if (action === 'check') {
      const d = data.detection;
      updateLangBadge(data.lang);
      const wm = data.watermark;
      const topSignals = Object.entries(d.scores || {})
        .sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([k, v]) => `<li>${esc(t(`metric_${k}`) || k)}: <b>${Math.round(v * 100)}%</b></li>`)
        .join('');
      content.innerHTML = `
        ${scoreMeter(t('aiScore'), d.aiProbability, d.verdict)}
        <div class="th-kv">
          <span>${t('confidence')}: <b>${Math.round(d.confidence * 100)}%</b></span>
          <span>${t('words')}: <b>${d.wordCount}</b></span>
        </div>
        ${topSignals ? `<div class="th-sub">${t('topSignals')}</div><ul class="th-list">${topSignals}</ul>` : ''}
        ${wm.hasWatermarks
          ? `<div class="th-warn">⚠ ${t('watermarksFound', [String(wm.removed)])}</div>`
          : `<div class="th-ok">✓ ${t('noWatermarks')}</div>`}
      `;
      applyBtn.hidden = true;
      copyBtn.hidden = true;
      rerollBtn.hidden = true;
      return;
    }

    if (action === 'clean') {
      updateLangBadge(data.lang);
      content.innerHTML = `
        ${data.hasWatermarks
          ? `<div class="th-warn">⚠ ${t('watermarksFound', [String(data.removed)])}</div>
             <ul class="th-list">${data.details.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
          : `<div class="th-ok">✓ ${t('noWatermarks')}</div>`}
        <div class="th-result-text">${esc(data.text)}</div>
      `;
      state.replacementText = data.text;
      applyBtn.hidden = !canReplace || !data.hasWatermarks;
      copyBtn.hidden = false;
      rerollBtn.hidden = true;
      return;
    }

    // humanize
    updateLangBadge(data.lang);
    const before = data.before ? Math.round(data.before.aiProbability * 100) : null;
    const after = data.after ? Math.round(data.after.aiProbability * 100) : null;
    const delta = before !== null && after !== null ? after - before : null;
    state.replacementText = data.text;

    content.innerHTML = `
      ${data.before ? scoreMeter(t('beforeLabel'), data.before.aiProbability, data.before.verdict) : ''}
      ${data.after ? scoreMeter(t('afterLabel'), data.after.aiProbability, data.after.verdict) : ''}
      ${delta !== null && delta < 0 ? `<div class="th-ok">▼ ${t('improvedBy', [String(-delta)])}</div>` : ''}
      <div class="th-result-text" contenteditable="true" spellcheck="false">${esc(data.text)}</div>
      <div class="th-kv th-dim">
        <span>${t('changesCount', [String(data.changes.length)])}</span>
        ${data.watermark && data.watermark.removed
          ? `<span>· ${t('hiddenRemoved', [String(data.watermark.removed)])}</span>` : ''}
      </div>
    `;

    const editableResult = content.querySelector('.th-result-text');
    editableResult.addEventListener('input', () => {
      state.replacementText = editableResult.innerText;
    });

    applyBtn.hidden = !canReplace;
    copyBtn.hidden = false;
    rerollBtn.hidden = false;
  }

  // ── Replace / copy ────────────────────────────────────────────

  function applyReplacement() {
    const text = state.replacementText;
    if (!captured || typeof text !== 'string') return;

    if (captured.kind === 'field') {
      const { field, start, end } = captured;
      field.focus();
      field.setRangeText(text, start, end, 'select');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      flashApplied();
      return;
    }

    if (captured.kind === 'contenteditable' && captured.range) {
      const range = captured.range;
      try {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        captured.editableHost?.dispatchEvent(new Event('input', { bubbles: true }));
        flashApplied();
      } catch {
        copyResult();
      }
    }
  }

  function flashApplied() {
    const btn = panel?.querySelector('.th-apply');
    if (!btn) return;
    const old = btn.textContent;
    btn.textContent = `✓ ${t('replaced')}`;
    btn.disabled = true;
    setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 1500);
  }

  function copyResult() {
    const text = state.replacementText;
    if (typeof text !== 'string') return;
    navigator.clipboard?.writeText(text).then(() => {
      const btn = panel?.querySelector('.th-copy');
      if (!btn) return;
      const old = btn.textContent;
      btn.textContent = `✓ ${t('copied')}`;
      setTimeout(() => { btn.textContent = old; }, 1500);
    }).catch(() => {});
  }

  // ── Messages from the service worker ─────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'th-action') return;
    captured = captureSelection();
    if (!captured && message.selectionText) {
      captured = { kind: 'static', text: message.selectionText };
    }
    hideBubble();
    openPanel();
    runAction(message.action);
    sendResponse({ ok: true });
  });

  // ── Assets ────────────────────────────────────────────────────

  const LOGO_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="22" height="22" rx="6" fill="url(#thg)"/>
    <path d="M7 8.2h10M12 8.2V17" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="17.4" cy="15.8" r="2.6" fill="#fff" opacity=".9"/>
    <defs><linearGradient id="thg" x1="0" y1="0" x2="24" y2="24">
      <stop stop-color="#6d5efc"/><stop offset="1" stop-color="#22b8cf"/>
    </linearGradient></defs></svg>`;

  const CSS_TEXT = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    [hidden] { display: none !important; }
    .th-bubble {
      position: fixed; width: 34px; height: 34px; border-radius: 50%;
      border: none; cursor: pointer; display: none; align-items: center; justify-content: center;
      background: #fff; box-shadow: 0 2px 12px rgba(20,20,45,.28), 0 0 0 1px rgba(120,120,160,.15);
      transition: transform .12s ease; z-index: 2147483646; padding: 0;
    }
    .th-bubble.th-visible { display: flex; }
    .th-bubble:hover { transform: scale(1.12); }
    .th-bubble svg { width: 20px; height: 20px; }

    .th-panel {
      position: fixed; width: 400px; max-width: calc(100vw - 20px);
      background: var(--bg); color: var(--fg);
      border-radius: 14px; box-shadow: 0 12px 40px rgba(10,10,30,.35), 0 0 0 1px var(--line);
      font-size: 13px; line-height: 1.45; overflow: hidden;
      animation: th-in .16s ease; z-index: 2147483647;
      --bg: #ffffff; --fg: #1b1c26; --dim: #6b6e85; --line: rgba(120,120,160,.18);
      --panel2: #f5f6fa; --accent: #6d5efc; --accent2: #22b8cf;
      --green: #14a05a; --yellow: #d99a06; --red: #d94f45;
    }
    @media (prefers-color-scheme: dark) {
      .th-panel {
        --bg: #23242e; --fg: #eceef6; --dim: #9aa0b8; --line: rgba(160,165,200,.16);
        --panel2: #2b2d3a;
      }
    }
    @keyframes th-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; } }

    .th-head {
      display: flex; align-items: center; gap: 7px; padding: 10px 12px;
      cursor: grab; user-select: none; border-bottom: 1px solid var(--line);
    }
    .th-logo { display: flex; }
    .th-title { font-weight: 650; font-size: 13.5px; letter-spacing: .1px; }
    .th-badge {
      font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 20px;
      background: var(--panel2); color: var(--dim); letter-spacing: .4px;
    }
    .th-offline { color: var(--green); }
    .th-close { margin-left: auto; }
    .th-icon-btn {
      border: none; background: transparent; color: var(--dim); cursor: pointer;
      font-size: 13px; padding: 4px 7px; border-radius: 7px;
    }
    .th-icon-btn:hover { background: var(--panel2); color: var(--fg); }

    .th-tabs { display: flex; gap: 4px; padding: 8px 12px 0; }
    .th-tab {
      border: 1px solid var(--line); background: transparent; color: var(--dim);
      font-size: 12px; font-weight: 600; padding: 5px 12px; border-radius: 8px; cursor: pointer;
      transition: all .12s;
    }
    .th-tab:hover { color: var(--fg); background: var(--panel2); }
    .th-tab.th-active {
      background: linear-gradient(120deg, var(--accent), var(--accent2));
      border-color: transparent; color: #fff;
    }

    .th-body { position: relative; padding: 10px 12px; min-height: 70px; max-height: 46vh; overflow-y: auto; }
    .th-loading {
      position: absolute; inset: 0; display: flex; gap: 8px; align-items: center;
      justify-content: center; color: var(--dim); font-size: 12px; z-index: 2;
    }
    .th-spinner {
      width: 16px; height: 16px; border-radius: 50%;
      border: 2px solid var(--line); border-top-color: var(--accent);
      animation: th-spin .7s linear infinite;
    }
    @keyframes th-spin { to { transform: rotate(360deg); } }

    .th-note { color: var(--dim); text-align: center; padding: 14px 6px; }
    .th-result-text {
      margin-top: 8px; background: var(--panel2); padding: 9px 11px; border-radius: 9px;
      white-space: pre-wrap; word-wrap: break-word; max-height: 180px; overflow-y: auto;
      outline: none; border: 1px solid transparent;
    }
    .th-result-text:focus { border-color: var(--accent); }

    .th-meter-row { display: flex; align-items: center; gap: 8px; margin: 5px 0; }
    .th-meter-label { width: 52px; color: var(--dim); font-size: 11.5px; flex-shrink: 0; }
    .th-meter { flex: 1; height: 7px; background: var(--panel2); border-radius: 6px; overflow: hidden; }
    .th-meter-fill { height: 100%; border-radius: 6px; transition: width .5s ease; }
    .th-meter-fill.th-green { background: var(--green); }
    .th-meter-fill.th-yellow { background: var(--yellow); }
    .th-meter-fill.th-red { background: var(--red); }
    .th-meter-num { width: 38px; text-align: right; font-size: 12.5px; }
    .th-meter-num.th-green, .th-verdict.th-green { color: var(--green); }
    .th-meter-num.th-yellow, .th-verdict.th-yellow { color: var(--yellow); }
    .th-meter-num.th-red, .th-verdict.th-red { color: var(--red); }
    .th-verdict { font-size: 11px; font-weight: 650; width: 74px; }

    .th-kv { display: flex; gap: 12px; margin-top: 6px; color: var(--dim); font-size: 12px; }
    .th-dim { font-size: 11.5px; }
    .th-sub { margin-top: 8px; font-weight: 650; font-size: 11.5px; color: var(--dim); text-transform: uppercase; letter-spacing: .5px; }
    .th-list { margin: 4px 0 0; padding-left: 18px; color: var(--dim); font-size: 12px; }
    .th-warn { margin-top: 8px; color: var(--yellow); font-weight: 600; font-size: 12.5px; }
    .th-ok { margin-top: 8px; color: var(--green); font-weight: 600; font-size: 12.5px; }

    .th-controls { padding: 2px 12px 6px; }
    .th-slider-row { display: flex; align-items: center; gap: 9px; color: var(--dim); font-size: 12px; }
    .th-slider-row b { width: 26px; text-align: right; color: var(--fg); }
    .th-intensity { flex: 1; accent-color: var(--accent); height: 18px; cursor: pointer; }

    .th-actions { display: flex; gap: 7px; padding: 4px 12px 10px; flex-wrap: wrap; }
    .th-btn {
      border: 1px solid var(--line); background: var(--panel2); color: var(--fg);
      font-size: 12.5px; font-weight: 600; padding: 7px 13px; border-radius: 9px; cursor: pointer;
      transition: all .12s;
    }
    .th-btn:hover { filter: brightness(1.06); }
    .th-btn:disabled { opacity: .6; cursor: default; }
    .th-primary {
      background: linear-gradient(120deg, var(--accent), var(--accent2));
      color: #fff; border-color: transparent;
    }

    .th-foot { padding: 7px 12px; border-top: 1px solid var(--line); text-align: center; }
    .th-foot a { color: var(--dim); font-size: 11px; text-decoration: none; }
    .th-foot a:hover { color: var(--accent); }
  `;
})();
