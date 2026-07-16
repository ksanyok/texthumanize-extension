/**
 * Anonymous, content-free usage telemetry.
 *
 * PRIVACY CONTRACT — read before touching this file:
 *   • The user's text/content is NEVER sent or stored here. Ever.
 *   • Events carry only: an anonymous random install id, an event name,
 *     coarse non-identifying params (tool id, language code, verdict bucket,
 *     extension version), and a timestamp.
 *   • Counts are always kept locally (chrome.storage.local) so the user can
 *     see their own usage. Nothing leaves the device unless a collector
 *     endpoint (GA4 Measurement Protocol) is configured below AND the user
 *     hasn't turned telemetry off in settings.
 *   • Default is ON but fully disclosed in the privacy policy, the store
 *     listing and a first-run notice, with a one-click off switch.
 *
 * To enable remote collection later, fill GA4_MEASUREMENT_ID + GA4_API_SECRET
 * (or point ENDPOINT at your own collector). Until then it's local-only.
 *
 * @module engine/telemetry
 */

// ── Collector config (empty by default → local-only, nothing is sent) ──
const GA4_MEASUREMENT_ID = '';   // e.g. 'G-XXXXXXXXXX'
const GA4_API_SECRET = '';       // GA4 → Admin → Data Streams → Measurement Protocol
const CUSTOM_ENDPOINT = '';      // optional: your own https collector (POST JSON array)

const MAX_QUEUE = 40;
const FLUSH_MS = 15000;

let installId = null;
let version = '0.0.0';
let queue = [];
let flushTimer = null;

async function ensureInstallId() {
  if (installId) return installId;
  const stored = await chrome.storage.local.get('th_install_id');
  if (stored.th_install_id) {
    installId = stored.th_install_id;
  } else {
    installId = (crypto.randomUUID && crypto.randomUUID()) ||
      `id-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
    await chrome.storage.local.set({ th_install_id: installId });
  }
  return installId;
}

/** @param {string} v */
export function setVersion(v) { version = v || version; }

async function isEnabled() {
  const s = await chrome.storage.sync.get('settings');
  // Default ON, disclosed. `telemetry === false` disables everything remote.
  return (s.settings?.telemetry ?? true) !== false;
}

/**
 * Record a usage event. Content is NEVER accepted here — callers pass only
 * coarse, non-identifying params.
 * @param {string} name  e.g. 'tool_used'
 * @param {Record<string, string|number|boolean>} [params]
 */
export async function track(name, params = {}) {
  // Always bump local counters (private, on-device).
  await bumpLocal(name, params);

  if (!(await isEnabled())) return;
  if (!hasRemote()) return; // No collector configured → local-only.

  await ensureInstallId();
  queue.push({
    name,
    params: sanitize(params),
    ts: Date.now(),
  });
  if (queue.length >= MAX_QUEUE) return flush();
  scheduleFlush();
}

/** Strip anything that isn't a short scalar — defence in depth against content leaks. */
function sanitize(params) {
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'number' || typeof v === 'boolean') { out[k] = v; continue; }
    if (typeof v === 'string') { out[k] = v.slice(0, 40); }
  }
  return out;
}

function hasRemote() {
  return (!!GA4_MEASUREMENT_ID && !!GA4_API_SECRET) || !!CUSTOM_ENDPOINT;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flush(); }, FLUSH_MS);
}

async function flush() {
  if (!queue.length || !hasRemote()) return;
  const batch = queue.splice(0, queue.length);
  try {
    if (CUSTOM_ENDPOINT) {
      await fetch(CUSTOM_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ installId, version, events: batch }),
        keepalive: true,
      });
    } else {
      const url = `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`;
      await fetch(url, {
        method: 'POST',
        body: JSON.stringify({
          client_id: installId,
          events: batch.map((e) => ({
            name: e.name,
            params: { ...e.params, engagement_time_msec: 1, ext_version: version },
          })),
        }),
        keepalive: true,
      });
    }
  } catch {
    // Fail silent — telemetry must never disrupt the product.
  }
}

async function bumpLocal(name, params) {
  try {
    const key = 'th_usage';
    const stored = await chrome.storage.local.get(key);
    const usage = stored[key] || { events: {}, tools: {}, firstSeen: Date.now() };
    usage.events[name] = (usage.events[name] || 0) + 1;
    if (params.tool) usage.tools[params.tool] = (usage.tools[params.tool] || 0) + 1;
    usage.lastSeen = Date.now();
    await chrome.storage.local.set({ [key]: usage });
  } catch { /* ignore */ }
}

/** Local, on-device usage summary for the user's own "stats" view. */
export async function getUsage() {
  const stored = await chrome.storage.local.get('th_usage');
  return stored.th_usage || { events: {}, tools: {}, firstSeen: null };
}

export function isRemoteConfigured() { return hasRemote(); }
