/**
 * THX.editors — editor detection + the in-editor action chip.
 *
 * Detects the focused editable surface (textarea / input / contenteditable,
 * plus the rich editors used by Gmail, X, LinkedIn, Reddit, Notion, Slack,
 * ChatGPT, Discord, WordPress…), floats a small action chip in its corner,
 * and wires each quick action to the shared panel with an in-place replace.
 */

(() => {
  const { settings, ensureHost, t, esc } = window.THX;

  // Site adapters — only for labelling + a couple of quirky replace paths.
  const SITE_LABELS = [
    [/mail\.google\./, 'Gmail'],
    [/(twitter|x)\.com$/, 'X'],
    [/linkedin\./, 'LinkedIn'],
    [/reddit\./, 'Reddit'],
    [/facebook\./, 'Facebook'],
    [/notion\./, 'Notion'],
    [/(slack)\./, 'Slack'],
    [/(chatgpt|openai)\./, 'ChatGPT'],
    [/discord\./, 'Discord'],
    [/wordpress|wp-admin/, 'WordPress'],
    [/telegram\./, 'Telegram'],
    [/web\.whatsapp\./, 'WhatsApp'],
    [/medium\./, 'Medium'],
  ];

  function siteLabel() {
    const h = location.hostname;
    for (const [re, name] of SITE_LABELS) if (re.test(h)) return name;
    return '';
  }

  const INLINE_TOOLS = [
    { action: 'humanize', icon: '✨' },
    { action: 'check', icon: '🔍' },
    { action: 'tone', icon: '🎭' },
    { action: 'paraphrase', icon: '🔀', pro: true },
    { action: 'clean', icon: '🧹' },
  ];

  /** @returns {{el: Element, kind: string}|null} */
  function editableOf(node) {
    if (!node) return null;
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el) return null;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return { el, kind: 'textarea' };
    if (tag === 'INPUT' && /^(text|search|url|email|)$/i.test(el.type || 'text')) {
      // Ignore tiny one-line inputs (search boxes) — require a real writing surface.
      if ((el.getBoundingClientRect().width || 0) < 220) return null;
      return { el, kind: 'input' };
    }
    const ce = el.closest('[contenteditable=""],[contenteditable="true"]');
    if (ce && ce.isContentEditable) return { el: ce, kind: 'contenteditable' };
    return null;
  }

  function getText(active) {
    const { el, kind } = active;
    if (kind === 'textarea' || kind === 'input') {
      const s = el.selectionStart ?? 0; const e = el.selectionEnd ?? 0;
      if (e > s) return { text: el.value.slice(s, e), scope: 'selection', s, e };
      return { text: el.value, scope: 'all' };
    }
    const sel = getSelection();
    if (sel && !sel.isCollapsed && el.contains(sel.anchorNode)) {
      return { text: sel.toString(), scope: 'selection', range: sel.getRangeAt(0).cloneRange() };
    }
    return { text: el.innerText, scope: 'all' };
  }

  function makeReplacer(active, captured) {
    return (newText) => {
      const { el, kind } = active;
      el.focus();
      if (kind === 'textarea' || kind === 'input') {
        if (captured.scope === 'selection') {
          el.setRangeText(newText, captured.s, captured.e, 'end');
        } else {
          el.select();
          if (!document.execCommand('insertText', false, newText)) el.value = newText;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      // contenteditable / rich editors
      const sel = getSelection();
      if (captured.scope === 'selection' && captured.range) {
        sel.removeAllRanges(); sel.addRange(captured.range);
      } else {
        sel.removeAllRanges();
        const r = document.createRange();
        r.selectNodeContents(el);
        sel.addRange(r);
      }
      if (!document.execCommand('insertText', false, newText)) {
        // Fallback: direct range write.
        const r = sel.getRangeAt(0);
        r.deleteContents();
        r.insertNode(document.createTextNode(newText));
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
  }

  // ── Chip UI ───────────────────────────────────────────────────
  let chip = null;
  let currentActive = null;
  let hideTimer = null;

  function buildChip() {
    const shadow = ensureHost();
    chip = document.createElement('div');
    chip.className = 'th-chip';
    const label = siteLabel();
    chip.innerHTML = `
      <button class="th-chip-btn th-chip-main" title="TextHumanize${label ? ' · ' + label : ''}">${window.THX.LOGO}</button>
      <div class="th-chip-tools">
        ${INLINE_TOOLS.map((tool) => `
          <button class="th-chip-btn" data-action="${tool.action}" title="${esc(t(actionTitle(tool.action)))}">
            ${tool.icon}${tool.pro ? '<span class="th-pro">P</span>' : ''}
          </button>`).join('')}
      </div>`;
    shadow.appendChild(chip);

    const main = chip.querySelector('.th-chip-main');
    main.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      chip.classList.toggle('th-open');
    });
    main.addEventListener('mousedown', (e) => e.preventDefault());
    chip.querySelectorAll('.th-chip-btn[data-action]').forEach((b) => {
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        launch(b.dataset.action);
      });
    });
    chip.addEventListener('mouseenter', () => { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } });
  }

  function actionTitle(action) {
    return { humanize: 'actHumanize', check: 'actCheck', tone: 'actTone',
      paraphrase: 'actParaphrase', clean: 'actClean' }[action] || 'actHumanize';
  }

  function positionChip(el) {
    if (!chip) return;
    const r = el.getBoundingClientRect();
    if (r.width < 120 || r.height < 24 || r.bottom < 0 || r.top > innerHeight) { hideChip(); return; }
    const cw = chip.classList.contains('th-open') ? 220 : 34;
    let x = r.right - cw - 8;
    let y = r.bottom - 42;
    x = Math.max(6, Math.min(innerWidth - cw - 6, x));
    y = Math.max(6, Math.min(innerHeight - 42, y));
    chip.style.left = `${x}px`;
    chip.style.top = `${y}px`;
  }

  function showChip(active) {
    if (!settings.editorChip) return;
    currentActive = active;
    if (!chip) buildChip();
    chip.style.display = 'flex';
    positionChip(active.el);
  }

  function hideChip() {
    if (chip) { chip.style.display = 'none'; chip.classList.remove('th-open'); }
  }

  function launch(action) {
    if (!currentActive) return;
    const captured = getText(currentActive);
    if (!captured.text || !captured.text.trim()) return;
    const label = siteLabel();
    const target = {
      text: captured.text,
      canReplace: true,
      replace: makeReplacer(currentActive, captured),
      label: label || 'editor',
    };
    const anchor = chip ? chip.getBoundingClientRect() : currentActive.el.getBoundingClientRect();
    window.THX.panel.openFor(target, action, anchor);
    window.THX.track?.('editor_action', { tool: action, site: label || 'generic' });
  }

  // ── Focus / scroll wiring ─────────────────────────────────────
  function onFocusIn(e) {
    if (window.THX.shadow && e.target?.getRootNode?.() === window.THX.shadow) return;
    const active = editableOf(e.target);
    if (active) showChip(active);
  }

  function onFocusOut() {
    hideTimer = setTimeout(() => {
      const stillEditing = editableOf(document.activeElement);
      if (!stillEditing) hideChip();
    }, 180);
  }

  function reposition() {
    if (chip && chip.style.display !== 'none' && currentActive?.el?.isConnected) {
      positionChip(currentActive.el);
    }
  }

  function boot() {
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    addEventListener('scroll', reposition, true);
    addEventListener('resize', reposition);
    // If a field is already focused when we load.
    const active = editableOf(document.activeElement);
    if (active) showChip(active);
    window.THX.on('settings', () => { if (!settings.editorChip) hideChip(); });
  }

  window.THX.editors = { boot, editableOf, hideChip };
})();
