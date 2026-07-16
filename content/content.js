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

  // ── Actions from the service worker (context menu / commands) ──
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

  // ── Boot subsystems ───────────────────────────────────────────
  window.THX.editors?.boot();
  window.THX.images?.boot();
})();
