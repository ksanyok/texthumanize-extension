/**
 * TextHumanize content-layer core — shared namespace `window.THX`.
 *
 * Loaded first (classic script). Owns the single closed Shadow-DOM host,
 * i18n, messaging to the service worker, live settings, tasteful effects
 * and all injected CSS. Other content scripts (panel/editors/images/
 * orchestrator) build on this.
 */

(() => {
  if (window.THX) return;

  const t = (key, subs) => (chrome.i18n.getMessage(key, subs) || key);

  /** @type {any} */
  const settings = {
    intensity: 60,
    profile: 'web',
    selectionBubble: true,
    editorChip: true,
    imageHover: false,
    effects: true,
    cleanWatermarks: true,
    telemetry: true,
  };

  chrome.runtime.sendMessage({ type: 'get-settings' }, (res) => {
    if (res?.ok) Object.assign(settings, res.data);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings?.newValue) {
      Object.assign(settings, changes.settings.newValue);
      window.THX.emit('settings', settings);
    }
  });

  /** Promise-based message send. */
  function send(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res?.ok) return reject(new Error(res?.error || 'Engine error'));
        resolve(res.data);
      });
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── Shadow host (single, shared, closed) ──────────────────────
  let host = null;
  let shadow = null;

  function ensureHost() {
    if (host && host.isConnected) return shadow;
    host = document.createElement('texthumanize-root');
    host.style.cssText = 'all:initial;position:fixed;inset:auto;z-index:2147483646;';
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);
    (document.body || document.documentElement).appendChild(host);
    return shadow;
  }

  // ── Tiny event bus ────────────────────────────────────────────
  const bus = {};
  function on(evt, fn) { (bus[evt] = bus[evt] || []).push(fn); }
  function emit(evt, data) { (bus[evt] || []).forEach((fn) => { try { fn(data); } catch { /* */ } }); }

  // ── Effects (tasteful, reduced-motion aware, cheap) ───────────
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fx = {
    get enabled() { return settings.effects && !reduceMotion; },

    /** Sparkle burst at an element's center (sign of a completed transform). */
    sparkle(el, count = 12) {
      if (!this.enabled || !el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const layer = ensureHost();
      const wrap = document.createElement('div');
      wrap.className = 'th-fx-layer';
      for (let i = 0; i < count; i++) {
        const p = document.createElement('span');
        p.className = 'th-spark';
        const ang = (Math.PI * 2 * i) / count + Math.random();
        const dist = 26 + Math.random() * 34;
        p.style.setProperty('--tx', `${Math.cos(ang) * dist}px`);
        p.style.setProperty('--ty', `${Math.sin(ang) * dist}px`);
        p.style.left = `${cx}px`;
        p.style.top = `${cy}px`;
        p.style.animationDelay = `${Math.random() * 60}ms`;
        wrap.appendChild(p);
      }
      layer.appendChild(wrap);
      setTimeout(() => wrap.remove(), 900);
    },

    /** Animated count-up used for score numbers. */
    countUp(node, from, to, suffix = '%', ms = 550) {
      if (!node) return;
      if (!this.enabled) { node.textContent = `${Math.round(to)}${suffix}`; return; }
      const start = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - start) / ms);
        const eased = 1 - Math.pow(1 - k, 3);
        node.textContent = `${Math.round(from + (to - from) * eased)}${suffix}`;
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },

    /** One-shot shimmer sweep across an element. */
    shimmer(el) {
      if (!this.enabled || !el) return;
      el.classList.remove('th-shimmer');
      void el.offsetWidth;
      el.classList.add('th-shimmer');
    },
  };

  window.THX = {
    t, send, esc, settings, ensureHost,
    get shadow() { return shadow; },
    on, emit, fx, reduceMotion,
    LOGO: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="22" height="22" rx="6" fill="url(#thg)"/>
      <path d="M7 8.2h10M12 8.2V17" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="17.4" cy="15.8" r="2.6" fill="#fff" opacity=".9"/>
      <defs><linearGradient id="thg" x1="0" y1="0" x2="24" y2="24">
        <stop stop-color="#6d5efc"/><stop offset="1" stop-color="#22b8cf"/>
      </linearGradient></defs></svg>`,
  };

  // ── All injected CSS (panel, chip, badge, bubble, effects) ────
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    [hidden] { display: none !important; }

    :host {
      --bg: #ffffff; --fg: #1b1c26; --dim: #6b6e85; --line: rgba(120,120,160,.18);
      --panel2: #f5f6fa; --accent: #6d5efc; --accent2: #22b8cf;
      --green: #14a05a; --yellow: #d99a06; --red: #d94f45;
      --shadow: 0 12px 40px rgba(10,10,30,.32);
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --bg: #23242e; --fg: #eceef6; --dim: #9aa0b8; --line: rgba(160,165,200,.16);
        --panel2: #2b2d3a;
      }
    }

    /* ── Selection bubble ── */
    .th-bubble {
      position: fixed; width: 34px; height: 34px; border-radius: 50%;
      border: none; cursor: pointer; display: none; align-items: center; justify-content: center;
      background: #fff; box-shadow: 0 2px 12px rgba(20,20,45,.28), 0 0 0 1px rgba(120,120,160,.15);
      transition: transform .12s cubic-bezier(.34,1.56,.64,1); z-index: 2147483646; padding: 0;
    }
    .th-bubble.th-visible { display: flex; animation: th-pop .18s cubic-bezier(.34,1.56,.64,1); }
    .th-bubble:hover { transform: scale(1.14) rotate(4deg); }
    .th-bubble svg { width: 20px; height: 20px; }
    @keyframes th-pop { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }

    /* ── Editor chip ── */
    .th-chip {
      position: fixed; display: flex; align-items: center; gap: 0;
      background: var(--bg); border-radius: 22px; box-shadow: var(--shadow), 0 0 0 1px var(--line);
      z-index: 2147483645; overflow: hidden; height: 34px;
      transition: box-shadow .2s; animation: th-pop .2s cubic-bezier(.34,1.56,.64,1);
    }
    .th-chip-btn {
      border: none; background: transparent; cursor: pointer; height: 34px; width: 34px;
      display: flex; align-items: center; justify-content: center; font-size: 15px;
      color: var(--fg); transition: background .12s;
    }
    .th-chip-main {
      width: 34px; background: linear-gradient(120deg, var(--accent), var(--accent2));
    }
    .th-chip-main svg { width: 18px; height: 18px; }
    .th-chip-tools { display: flex; max-width: 0; transition: max-width .28s cubic-bezier(.4,0,.2,1); }
    .th-chip.th-open .th-chip-tools { max-width: 260px; }
    .th-chip-btn:hover { background: var(--panel2); }
    .th-chip-btn .th-pro {
      position: absolute; top: 3px; right: 3px; font-size: 7px; font-weight: 800;
      color: #fff; background: var(--accent); border-radius: 3px; padding: 0 2px; line-height: 1.3;
    }

    /* ── Image provenance badge ── */
    .th-imgbadge {
      position: fixed; z-index: 2147483646; display: flex; align-items: center; gap: 5px;
      padding: 4px 9px; border-radius: 20px; font-size: 11.5px; font-weight: 650;
      background: rgba(20,20,30,.82); color: #fff; backdrop-filter: blur(6px);
      box-shadow: 0 3px 14px rgba(0,0,0,.35); animation: th-pop .16s ease; pointer-events: auto;
      cursor: default; max-width: 260px;
    }
    .th-imgbadge.th-ai { background: linear-gradient(120deg, #d94f45, #e0732c); }
    .th-imgbadge.th-authentic { background: linear-gradient(120deg, #14a05a, #12b3a0); }
    .th-imgbadge.th-none { background: rgba(40,42,54,.9); }
    .th-imgbadge .th-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: .9; }
    .th-imgbadge.th-scan .th-dot { animation: th-blink .8s infinite; }
    @keyframes th-blink { 50% { opacity: .25; } }
    .th-imgbadge small { opacity: .8; font-weight: 500; }

    /* ── Panel ── */
    .th-panel {
      position: fixed; width: 408px; max-width: calc(100vw - 20px);
      background: var(--bg); color: var(--fg); border-radius: 15px;
      box-shadow: var(--shadow), 0 0 0 1px var(--line);
      font-size: 13px; line-height: 1.45; overflow: hidden; z-index: 2147483647;
      animation: th-in .18s cubic-bezier(.34,1.4,.6,1);
    }
    @keyframes th-in { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }
    .th-head { display: flex; align-items: center; gap: 7px; padding: 10px 12px; cursor: grab; user-select: none; border-bottom: 1px solid var(--line); position: relative; overflow: hidden; }
    .th-head::after { content: ''; position: absolute; inset: 0; background: linear-gradient(110deg, transparent 30%, rgba(255,255,255,.14) 50%, transparent 70%); transform: translateX(-120%); }
    .th-shimmer.th-head::after, .th-head.th-shimmer::after { animation: th-sweep 1s ease; }
    @keyframes th-sweep { to { transform: translateX(120%); } }
    .th-title { font-weight: 650; font-size: 13.5px; }
    .th-badge { font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 20px; background: var(--panel2); color: var(--dim); letter-spacing: .4px; }
    .th-offline { color: var(--green); }
    .th-spacer { flex: 1; }
    .th-icon-btn { border: none; background: transparent; color: var(--dim); cursor: pointer; font-size: 13px; padding: 4px 7px; border-radius: 7px; }
    .th-icon-btn:hover { background: var(--panel2); color: var(--fg); }

    .th-tabs { display: flex; gap: 4px; padding: 8px 12px 0; flex-wrap: wrap; }
    .th-tab { border: 1px solid var(--line); background: transparent; color: var(--dim); font-size: 12px; font-weight: 600; padding: 5px 11px; border-radius: 8px; cursor: pointer; transition: all .12s; position: relative; }
    .th-tab:hover { color: var(--fg); background: var(--panel2); }
    .th-tab.th-active { background: linear-gradient(120deg, var(--accent), var(--accent2)); border-color: transparent; color: #fff; }
    .th-tab .th-pro { font-size: 8px; font-weight: 800; margin-left: 4px; color: var(--accent); }
    .th-tab.th-active .th-pro { color: #fff; }

    .th-body { position: relative; padding: 11px 12px; min-height: 72px; max-height: 48vh; overflow-y: auto; }
    .th-loading { position: absolute; inset: 0; display: flex; gap: 8px; align-items: center; justify-content: center; color: var(--dim); font-size: 12px; z-index: 2; background: color-mix(in srgb, var(--bg) 70%, transparent); }
    .th-spinner { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--line); border-top-color: var(--accent); animation: th-spin .7s linear infinite; }
    @keyframes th-spin { to { transform: rotate(360deg); } }

    .th-note { color: var(--dim); text-align: center; padding: 14px 6px; }
    .th-result-text { margin-top: 8px; background: var(--panel2); padding: 9px 11px; border-radius: 9px; white-space: pre-wrap; word-wrap: break-word; max-height: 190px; overflow-y: auto; outline: none; border: 1px solid transparent; }
    .th-result-text:focus { border-color: var(--accent); }
    .th-result-text del { color: var(--red); text-decoration: line-through; opacity: .7; }
    .th-result-text ins { color: var(--green); text-decoration: none; font-weight: 600; }

    .th-meter-row { display: flex; align-items: center; gap: 8px; margin: 5px 0; }
    .th-meter-label { width: 54px; color: var(--dim); font-size: 11.5px; flex-shrink: 0; }
    .th-meter { flex: 1; height: 7px; background: var(--panel2); border-radius: 6px; overflow: hidden; }
    .th-meter-fill { height: 100%; border-radius: 6px; width: 0; transition: width .6s cubic-bezier(.4,0,.2,1); }
    .th-green { background: var(--green); } .th-yellow { background: var(--yellow); } .th-red { background: var(--red); }
    .th-meter-num { width: 40px; text-align: right; font-size: 12.5px; font-variant-numeric: tabular-nums; }
    .th-c-green { color: var(--green); } .th-c-yellow { color: var(--yellow); } .th-c-red { color: var(--red); }
    .th-verdict { font-size: 11px; font-weight: 650; width: 76px; }

    .th-kv { display: flex; gap: 12px; margin-top: 6px; color: var(--dim); font-size: 12px; flex-wrap: wrap; }
    .th-sub { margin-top: 8px; font-weight: 650; font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: .5px; }
    .th-list { margin: 4px 0 0; padding-left: 18px; color: var(--dim); font-size: 12px; }
    .th-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .th-pill { font-size: 11px; padding: 3px 9px; border-radius: 20px; background: var(--panel2); color: var(--fg); }
    .th-warn { margin-top: 8px; color: var(--yellow); font-weight: 600; font-size: 12.5px; }
    .th-ok { margin-top: 8px; color: var(--green); font-weight: 600; font-size: 12.5px; }

    .th-controls { padding: 2px 12px 6px; }
    .th-slider-row { display: flex; align-items: center; gap: 9px; color: var(--dim); font-size: 12px; }
    .th-slider-row b { width: 26px; text-align: right; color: var(--fg); }
    .th-intensity { flex: 1; accent-color: var(--accent); height: 18px; cursor: pointer; }

    .th-actions { display: flex; gap: 7px; padding: 4px 12px 10px; flex-wrap: wrap; }
    .th-btn { border: 1px solid var(--line); background: var(--panel2); color: var(--fg); font-size: 12.5px; font-weight: 600; padding: 7px 13px; border-radius: 9px; cursor: pointer; transition: all .12s; }
    .th-btn:hover { filter: brightness(1.06); transform: translateY(-1px); }
    .th-btn:disabled { opacity: .6; cursor: default; transform: none; }
    .th-primary { background: linear-gradient(120deg, var(--accent), var(--accent2)); color: #fff; border-color: transparent; }

    .th-foot { padding: 7px 12px; border-top: 1px solid var(--line); text-align: center; }
    .th-foot a { color: var(--dim); font-size: 11px; text-decoration: none; }
    .th-foot a:hover { color: var(--accent); }

    /* ── FX ── */
    .th-fx-layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
    .th-spark {
      position: fixed; width: 7px; height: 7px; margin: -3px 0 0 -3px; border-radius: 50%;
      background: radial-gradient(circle, #fff 0%, var(--accent2) 45%, var(--accent) 100%);
      animation: th-spark .8s cubic-bezier(.2,.7,.3,1) forwards;
    }
    @keyframes th-spark {
      0% { transform: translate(0,0) scale(0); opacity: 1; }
      35% { transform: translate(calc(var(--tx)*.6), calc(var(--ty)*.6)) scale(1.1); opacity: 1; }
      100% { transform: translate(var(--tx), var(--ty)) scale(0); opacity: 0; }
    }
  `;
})();
