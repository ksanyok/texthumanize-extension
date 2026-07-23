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

  // True only while our extension context is still alive. After the extension
  // is reloaded/updated, content scripts on already-open tabs keep running but
  // every chrome.* call throws "Extension context invalidated" — guard them.
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  // getMessage throws "No matching signature" on a non-string key or non-string
  // substitutions — normalize both before handing them over. (See popup/bridge.js.)
  const t = (key, subs) => {
    if (typeof key !== 'string' || !key) return '';
    const args = Array.isArray(subs) ? subs.map((s) => String(s)) : undefined;
    try { return (args ? chrome.i18n.getMessage(key, args) : chrome.i18n.getMessage(key)) || key; } catch { return key; }
  };

  /** @type {any} */
  const settings = {
    intensity: 65,
    profile: 'web',
    selectionBubble: true,
    editorChip: true,
    imageHover: true,
    scanSites: [],
    effects: true,
    cleanWatermarks: true,
    telemetry: true,
  };

  try {
    chrome.runtime.sendMessage({ type: 'get-settings' }, (res) => {
      if (chrome.runtime.lastError) return; // context gone
      if (res?.ok) Object.assign(settings, res.data);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.settings?.newValue) {
        Object.assign(settings, changes.settings.newValue);
        window.THX.emit('settings', settings);
      }
    });
  } catch { /* extension context invalidated */ }

  /** Promise-based message send. Resolves to null if our context is gone. */
  function send(message) {
    return new Promise((resolve, reject) => {
      if (!alive()) return reject(new Error('context-invalidated'));
      try {
        chrome.runtime.sendMessage(message, (res) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (!res?.ok) return reject(new Error(res?.error || 'Engine error'));
          resolve(res.data);
        });
      } catch (e) { reject(e); }
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
    try { host.setAttribute('dir', chrome.i18n.getMessage('@@bidi_dir') || 'ltr'); } catch { /* */ }
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

  const VERSION = (() => { try { return chrome.runtime.getManifest().version; } catch { return '3.1.9'; } })();
  const LIB_URL = 'https://github.com/ksanyok/TextHumanize';

  window.THX = {
    t, send, esc, settings, ensureHost,
    get shadow() { return shadow; },
    version: VERSION, libUrl: LIB_URL,
    on, emit, fx, reduceMotion,
    LOGO: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="22" height="22" rx="6" fill="url(#thg)"/>
      <path d="M7 8.2h10M12 8.2V17" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="17.4" cy="15.8" r="2.6" fill="#fff" opacity=".9"/>
      <defs><linearGradient id="thg" x1="0" y1="0" x2="24" y2="24">
        <stop stop-color="#2a2d36"/><stop offset="1" stop-color="#0d0e12"/>
      </linearGradient></defs></svg>`,
  };

  // ── All injected CSS (panel, chip, badge, bubble, effects) ────
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    [hidden] { display: none !important; }

    :host {
      --bg: rgba(18,20,26,.88); --fg: #f3f4f8; --dim: #9096a6; --line: rgba(255,255,255,.10);
      --panel2: rgba(255,255,255,.05); --accent: #f6f7fb; --accent2: #c9cdda; --cta-fg: #0a0b0f;
      --green: #14a05a; --yellow: #d99a06; --red: #d94f45;
      --shadow: 0 12px 40px rgba(10,10,30,.32);
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --bg: rgba(18,20,26,.88); --fg: #f3f4f8; --dim: #9096a6; --line: rgba(255,255,255,.10);
        --panel2: rgba(255,255,255,.05);
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

    /* ── Hover AI badge + ring ── */
    .th-ring {
      position: fixed; z-index: 2147483644; pointer-events: none; display: none;
      border-radius: 8px; box-shadow: 0 0 0 2px var(--ring, rgba(109,94,252,.55)), 0 0 18px var(--ring, rgba(109,94,252,.35)) inset;
      transition: all .12s ease; box-sizing: border-box;
    }
    .th-ring.th-ai { --ring: rgba(217,79,69,.6); }
    .th-ring.th-human { --ring: rgba(18,161,80,.6); }
    .th-ring.th-mixed { --ring: rgba(217,149,6,.6); }
    .th-hbadge {
      position: fixed; z-index: 2147483646; display: none; align-items: center; gap: 5px;
      height: 27px; padding: 0 11px 0 9px; border-radius: 20px; border: none; cursor: pointer;
      font-size: 12.5px; font-weight: 800; color: #fff; letter-spacing: .2px; overflow: visible;
      box-shadow: 0 4px 16px rgba(0,0,0,.32); animation: th-pop .18s cubic-bezier(.34,1.56,.64,1);
      font-variant-numeric: tabular-nums; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .th-hbadge::before { content: ''; position: absolute; inset: 0; border-radius: 20px; pointer-events: none;
      background: linear-gradient(180deg, rgba(255,255,255,.28), transparent 58%); }
    .th-hbadge span { font-size: 13px; filter: drop-shadow(0 1px 1px rgba(0,0,0,.25)); }
    .th-hbadge.th-ai { background: linear-gradient(120deg, #e0524a, #e0732c); box-shadow: 0 4px 18px rgba(224,82,74,.5); }
    .th-hbadge.th-human { background: linear-gradient(120deg, #12a150, #12b3a0); box-shadow: 0 4px 18px rgba(18,161,80,.45); }
    .th-hbadge.th-mixed { background: linear-gradient(120deg, #d99506, #e0a83c); box-shadow: 0 4px 18px rgba(217,149,6,.45); }
    .th-hbadge.th-scan { background: #34364a; box-shadow: 0 4px 14px rgba(0,0,0,.35); }
    .th-hbadge:hover { filter: brightness(1.08); transform: scale(1.06); }
    .th-mini-spin { width: 11px; height: 11px; border-radius: 50%; border: 2px solid rgba(255,255,255,.4); border-top-color: #fff; animation: th-spin .6s linear infinite; display: inline-block; }

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
      position: fixed; width: 380px; max-width: calc(100vw - 20px);
      background: var(--bg); color: var(--fg); border-radius: 18px;
      box-shadow: 0 18px 50px rgba(0,0,0,.5), 0 0 0 1px var(--line);
      -webkit-backdrop-filter: blur(16px) saturate(1.2); backdrop-filter: blur(16px) saturate(1.2);
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
    .th-tab.th-active { background: linear-gradient(180deg, var(--accent), var(--accent2)); border-color: transparent; color: var(--cta-fg); font-weight: 700; }
    .th-tab .th-pro { display: none; }

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
    .th-list { margin: 4px 0 0; padding-inline-start: 18px; color: var(--dim); font-size: 12px; }
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
    .th-primary { background: linear-gradient(180deg, var(--accent), var(--accent2)); color: var(--cta-fg); border-color: transparent; font-weight: 700; box-shadow: inset 0 1px 0 rgba(255,255,255,.5); }

    .th-foot { padding: 7px 12px; border-top: 1px solid var(--line); text-align: center; display: flex; gap: 7px; align-items: center; justify-content: center; }
    .th-foot a { color: var(--dim); font-size: 11px; text-decoration: none; }
    .th-foot a:hover { color: var(--accent); }
    .th-ver { color: var(--dim); font-size: 10px; opacity: .7; font-variant-numeric: tabular-nums; }

    /* ── Aura orb (in-panel score) ── */
    .th-orbwrap { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 4px 0 12px; }
    .th-orb2 {
      position: relative; width: 96px; height: 96px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center; isolation: isolate;
      background: radial-gradient(120% 120% at 34% 26%, hsl(var(--h,120) 92% 68%), hsl(var(--h,120) 86% 46%) 56%, hsl(var(--h,120) 82% 30%));
      box-shadow: 0 12px 32px hsla(var(--h,120) 90% 45% / .45), inset 0 2px 7px rgba(255,255,255,.32);
      animation: th-orb-morph 6s ease-in-out infinite;
    }
    .th-orb2::before { content: ''; position: absolute; inset: -12px; border-radius: 50%; z-index: -1;
      background: radial-gradient(circle, hsla(var(--h,120) 95% 55% / .4), transparent 68%); animation: th-sb-pulse 3s ease-in-out infinite; }
    .th-orb2 b { font-size: 32px; font-weight: 800; color: #fff; letter-spacing: -1px; text-shadow: 0 2px 6px rgba(0,0,0,.28); font-variant-numeric: tabular-nums; }
    .th-orb2 b i { font-size: 14px; font-style: normal; opacity: .72; margin-left: 1px; }
    .th-orb-verdict { font-weight: 700; font-size: 13px; }
    @keyframes th-orb-morph { 0%,100% { border-radius: 50% 50% 50% 50%; } 33% { border-radius: 55% 45% 52% 48%; } 66% { border-radius: 46% 54% 45% 55%; } }

    /* ── Floating site-score orb (bottom-right) ── */
    .th-sb { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; display: flex; flex-direction: column; align-items: flex-end; gap: 9px; }
    .th-sb-orb {
      position: relative; width: 52px; height: 52px; border: none; cursor: pointer; padding: 0; isolation: isolate;
      border-radius: 50%; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center;
      background: radial-gradient(120% 120% at 32% 26%, hsl(var(--sb-hue,120) 92% 68%), hsl(var(--sb-hue,120) 86% 46%) 55%, hsl(var(--sb-hue,120) 82% 30%));
      box-shadow: 0 8px 24px hsla(var(--sb-hue,120) 90% 45% / .5), inset 0 1px 0 rgba(255,255,255,.35);
      animation: th-sb-float 5s ease-in-out infinite; transition: transform .14s;
    }
    .th-sb-orb:hover { transform: scale(1.07); }
    .th-sb-glow { position: absolute; inset: -8px; border-radius: 50%; z-index: -1;
      background: radial-gradient(circle, hsla(var(--sb-hue,120) 95% 55% / .5), transparent 68%); animation: th-sb-pulse 2.8s ease-in-out infinite; }
    .th-sb-face { position: absolute; top: 6px; font-size: 11px; opacity: .95; filter: drop-shadow(0 1px 1px rgba(0,0,0,.3)); }
    .th-sb-num { font-weight: 800; font-size: 17px; letter-spacing: -.5px; margin-top: 7px; font-variant-numeric: tabular-nums; text-shadow: 0 1px 2px rgba(0,0,0,.25); }
    .th-sb-num i { font-size: 9px; font-style: normal; opacity: .7; }
    .th-sb.th-inviting .th-sb-orb { animation: th-sb-float 5s ease-in-out infinite, th-sb-ring 1.7s ease-out infinite; }
    @keyframes th-sb-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
    @keyframes th-sb-pulse { 0%,100% { opacity: .45; transform: scale(1); } 50% { opacity: .78; transform: scale(1.12); } }
    @keyframes th-sb-ring { 0% { box-shadow: 0 8px 24px hsla(var(--sb-hue,120) 90% 45% / .5), 0 0 0 0 hsla(var(--sb-hue,120) 90% 58% / .5); } 100% { box-shadow: 0 8px 24px hsla(var(--sb-hue,120) 90% 45% / .5), 0 0 0 18px hsla(var(--sb-hue,120) 90% 58% / 0); } }
    .th-sb-card { display: none; width: 252px; background: var(--bg); color: var(--fg); border-radius: 14px; padding: 12px 13px;
      box-shadow: var(--shadow), 0 0 0 1px var(--line); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); animation: th-in .18s cubic-bezier(.34,1.4,.6,1); }
    .th-sb.th-open .th-sb-card { display: block; }
    .th-sb-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .th-sb-head { font-size: 13px; font-weight: 700; line-height: 1.25; }
    .th-sb-x { border: none; background: transparent; color: var(--dim); cursor: pointer; font-size: 12px; padding: 0 2px; line-height: 1; }
    .th-sb-x:hover { color: var(--fg); }
    .th-sb-plat { font-size: 11.5px; color: var(--dim); margin-top: 3px; }
    .th-sb-invite { font-size: 11.5px; color: var(--fg); margin-top: 9px; line-height: 1.38; }
    .th-sb-actions { margin-top: 10px; }
    .th-sb-toggle { width: 100%; border: 1px solid transparent; background: linear-gradient(180deg, var(--accent), var(--accent2)); color: var(--cta-fg); font-weight: 700; font-size: 12px; padding: 8px 10px; border-radius: 10px; cursor: pointer; transition: filter .12s; box-shadow: inset 0 1px 0 rgba(255,255,255,.5); }
    .th-sb-toggle:hover { filter: brightness(1.05); }
    .th-sb-toggle.th-sb-active { background: var(--panel2); color: var(--fg); border-color: var(--line); box-shadow: none; }
    .th-sb-foot { margin-top: 10px; padding-top: 9px; border-top: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; font-size: 10px; color: var(--dim); }
    .th-sb-foot a { color: var(--dim); text-decoration: none; font-weight: 600; }
    .th-sb-foot a:hover { color: var(--accent); }
    .th-sb-foot span { opacity: .7; font-variant-numeric: tabular-nums; }

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
