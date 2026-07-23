import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteForensics, HEURISTICS, WEIGHTS } from './site-forensics.js';

test('Framer via data-* attribute on a custom domain (no CDN host)', () => {
  const r = siteForensics({ dataAttrs: ['data-framer-name', 'data-framer-component-type'] });
  assert.equal(r.platformId, 'framer');
  assert.equal(r.kind, 'builder');
});

test('Elementor via class token → builder', () => {
  const r = siteForensics({ classes: ['elementor-widget', 'elementor-kit-5'] });
  assert.equal(r.platformId, 'elementor');
});

test('shadcn/Radix/Lucide/Geist stack reads as AI even with no builder host', () => {
  const r = siteForensics({ dataAttrs: ['data-radix-popper-content-wrapper'], classes: ['lucide', 'lucide-menu', 'bg-background'], fonts: 'geist, sans-serif' });
  assert.ok(r.aiBuilt >= 0.5, `aiBuilt ${r.aiBuilt}`);
  assert.ok(r.signals.some((s) => s.code === 'heuristic' && s.id === 'shadcn'));
});

test('AI violet→cyan gradient is a signal but weak on its own', () => {
  const r = siteForensics({ aiGradient: true });
  assert.ok(r.signals.some((s) => s.code === 'heuristic' && s.id === 'aiGradient'));
  assert.equal(r.verdict, 'human');
});

test('WEIGHTS and HEURISTICS are exported (tunable model surface)', () => {
  assert.ok(WEIGHTS.kind['ai-builder'] > WEIGHTS.kind.cms);
  assert.ok(Array.isArray(HEURISTICS) && HEURISTICS.length >= 4);
});

test('AI builder host → high aiBuilt + aiBuilder flag', () => {
  const r = siteForensics({ hosts: ['cdn.durable.co', 'fonts.googleapis.com'] });
  assert.equal(r.platformId, 'durable');
  assert.equal(r.aiBuilder, true);
  assert.equal(r.verdict, 'ai');
  assert.ok(r.aiBuilt >= 0.8, `aiBuilt ${r.aiBuilt}`);
});

test('Framer generator → builder, mixed-ish', () => {
  const r = siteForensics({ generator: 'framer', hosts: ['framerusercontent.com'] });
  assert.equal(r.platformId, 'framer');
  assert.equal(r.kind, 'builder');
  assert.ok(r.aiBuilt >= 0.35 && r.aiBuilt < 0.8);
});

test('WordPress → CMS, low aiBuilt (human) when no AI content', () => {
  const r = siteForensics({ generator: 'wordpress 6.4', paths: ['/wp-content/themes/x/'] });
  assert.equal(r.platformId, 'wordpress');
  assert.equal(r.kind, 'cms');
  assert.equal(r.verdict, 'human');
});

test('Next.js framework alone → hand-built, human', () => {
  const r = siteForensics({ ids: ['__next'], paths: ['/_next/static/chunks/main.js'] });
  assert.equal(r.platformId, 'next');
  assert.equal(r.verdict, 'human');
  assert.ok(r.aiBuilt < 0.35);
});

test('no fingerprints → hand-coded baseline', () => {
  const r = siteForensics({ hosts: ['example.com'] });
  assert.equal(r.platform, null);
  assert.equal(r.verdict, 'human');
  assert.equal(r.signals[0].code, 'handcoded');
});

test('AI-watermarked images push a plain CMS toward AI', () => {
  const base = siteForensics({ generator: 'wordpress' });
  const withImgs = siteForensics({ generator: 'wordpress' }, { images: 4, aiImages: 4, textBlocks: 10, aiTextShare: 0.2 });
  assert.ok(withImgs.aiBuilt > base.aiBuilt);
  assert.ok(withImgs.aiBuilt >= 0.6, `expected ai-ish, got ${withImgs.aiBuilt}`);
  assert.ok(withImgs.signals.some((s) => s.code === 'aiImages' && s.aiImages === 4));
});

test('AI-builder precedence over a generic framework signal', () => {
  // A Durable site that also ships a framework bundle path.
  const r = siteForensics({ hosts: ['durable.co'], ids: ['__next'], paths: ['/_next/'] });
  assert.equal(r.platformId, 'durable');
  assert.equal(r.aiBuilder, true);
});

test('shared CDN host alone is weak, does not misclassify', () => {
  const r = siteForensics({ hosts: ['fonts.gstatic.com', 'www.googletagmanager.com'] });
  assert.equal(r.platform, null);
});

// ── Own-hostname matching (default hosting subdomains) — 2026 catalog ──

test('Lovable default subdomain → ai-builder from hostname alone', () => {
  const r = siteForensics({ hostname: 'my-cool-app.lovable.app' });
  assert.equal(r.platformId, 'lovable');
  assert.equal(r.aiBuilder, true);
  assert.equal(r.verdict, 'ai');
  assert.ok(r.signals.some((s) => s.code === 'platform' && s.hits.some((h) => h.includes('subdomain'))));
});

test('base44 (new builder) recognised by subdomain', () => {
  const r = siteForensics({ hostname: 'store.base44.app' });
  assert.equal(r.platformId, 'base44');
  assert.equal(r.aiBuilder, true);
});

test('v0 requires the v0- prefix on vercel.app', () => {
  const yes = siteForensics({ hostname: 'v0-dtc-skincare-website.vercel.app' });
  assert.equal(yes.platformId, 'v0');
  assert.equal(yes.aiBuilder, true);
});

test('bare vercel.app is a vibe host, not v0, not an AI verdict alone', () => {
  const r = siteForensics({ hostname: 'my-blog.vercel.app' });
  assert.notEqual(r.platformId, 'v0');
  assert.ok(r.signals.some((s) => s.code === 'vibeHost'));
  assert.equal(r.verdict, 'human'); // weak on its own
});

test('vibe host stacks with the shadcn smell to reach AI-ish', () => {
  const bare = siteForensics({ hostname: 'app.netlify.app' });
  const withStack = siteForensics({
    hostname: 'app.netlify.app',
    dataAttrs: ['data-radix-popper-content-wrapper'],
    classes: ['lucide-menu', 'bg-background'], fonts: 'geist',
  });
  assert.ok(withStack.aiBuilt > bare.aiBuilt);
  assert.ok(withStack.aiBuilt >= 0.5, `expected ai-ish, got ${withStack.aiBuilt}`);
});

test('dot-boundary: look-alike domain does NOT match a builder suffix', () => {
  const r = siteForensics({ hostname: 'notlovable.app' });
  assert.notEqual(r.platformId, 'lovable');
});

test('Wix free path-style host still identifies Wix by subdomain suffix', () => {
  const r = siteForensics({ hostname: 'janedoe.wixsite.com' });
  assert.equal(r.platformId, 'wix');
  assert.equal(r.kind, 'builder');
});

test('own subdomain outranks a spurious framework bundle', () => {
  // Lovable ships a Vite/React bundle; the framework must not win.
  const r = siteForensics({ hostname: 'x.lovable.app', ids: ['__next'], paths: ['/_next/'] });
  assert.equal(r.platformId, 'lovable');
});

test('Webflow free-tier badge class confirms the platform', () => {
  const r = siteForensics({ classes: ['w-webflow-badge', 'w-mod-js'] });
  assert.equal(r.platformId, 'webflow');
});

test('a plain custom-domain hand-coded Next.js site stays human', () => {
  const r = siteForensics({ hostname: 'www.acme-corp.com', ids: ['__next'], paths: ['/_next/static/x.js'] });
  assert.equal(r.verdict, 'human');
  assert.ok(!r.signals.some((s) => s.code === 'vibeHost'));
});
