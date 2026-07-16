/**
 * Self-test for engine/content-type.js.
 * Run: node engine/content-type.test.mjs
 */
import { classifyContent } from './content-type.js';

let failures = 0;
function check(label, cond) {
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}`);
  if (!cond) failures++;
}

function show(name, r) {
  const top = Object.entries(r.signals.scores)
    .sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' ');
  console.log(`  ${name}: type=${r.type} conf=${r.confidence.toFixed(2)} profile=${r.suggestedProfile}  [${top}]`);
}

// ── Sample documents ──────────────────────────────────────────
const EMAIL = `Dear Dr. Smith,

Thank you for taking the time to meet last week. I wanted to follow up on the proposal we discussed and share the revised timeline for the pilot project.

Please let me know whether the attached schedule works for you, or if you would prefer to reconvene next month.

Best regards,
Alex Johnson`;

const SOCIAL = `Just shipped v2.0 of my little app! 🎉🔥 So pumped about this one. #buildinpublic #indiehackers @coolstartup — check it out, link in bio 👇`;

const CODE = `\`\`\`python
def fibonacci(n):
    if n < 2:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

for i in range(10):
    print(fibonacci(i))
\`\`\``;

const ARTICLE = `# The State of Remote Work

Remote work has reshaped how organisations operate over the past few years. Companies that once resisted distributed teams now embrace them, driven by both necessity and measurable gains in productivity.

## What Changed

The shift was not merely technological. Cultural expectations evolved as workers demonstrated that output, not presence, is what matters. Managers learned to lead by outcomes, and employees gained flexibility that improved retention across many sectors.

## Looking Ahead

The next phase will test whether hybrid models can preserve the benefits of both worlds while avoiding their pitfalls.`;

const CHAT = `hey! you free later? 😄 wanna grab food. idk maybe tacos? lmk`;

const MARKETING = `Limited time offer! 🔥 Buy now and save 40% on the ultimate productivity suite. Don't miss this exclusive deal — sign up today and supercharge your workflow. Act now, spots are limited!`;

// ── Classifications ───────────────────────────────────────────
console.log('=== classifications ===');
const rEmail = classifyContent(EMAIL, { lang: 'en' });
const rSocial = classifyContent(SOCIAL, { lang: 'en' });
const rCode = classifyContent(CODE, { lang: 'en' });
const rArticle = classifyContent(ARTICLE, { lang: 'en' });
const rChat = classifyContent(CHAT, { lang: 'en' });
const rMarketing = classifyContent(MARKETING, { lang: 'en' });
show('email', rEmail);
show('social', rSocial);
show('code', rCode);
show('article', rArticle);
show('chat', rChat);
show('marketing', rMarketing);

// ── Required assertions ───────────────────────────────────────
check(`"Dear … Best regards" letter -> email (got ${rEmail.type})`, rEmail.type === 'email');
check('email suggestedProfile is "email"', rEmail.suggestedProfile === 'email');
check(`tweet with hashtags/emoji -> social (got ${rSocial.type})`, rSocial.type === 'social');
check('social suggestedProfile is "social"', rSocial.suggestedProfile === 'social');

// ── Faithful-port sanity ──────────────────────────────────────
check(`fenced code -> code (got ${rCode.type})`, rCode.type === 'code');
check(`headed multi-para article -> article (got ${rArticle.type})`, rArticle.type === 'article');
check(`short emoji message -> chat (got ${rChat.type})`, rChat.type === 'chat');
check(`CTA-heavy copy -> marketing (got ${rMarketing.type})`, rMarketing.type === 'marketing');

// ── Structural guarantees ─────────────────────────────────────
const all = [rEmail, rSocial, rCode, rArticle, rChat, rMarketing];
check('confidence within [0,1] for all', all.every((r) => r.confidence >= 0 && r.confidence <= 1));
check('every score within [0,1]',
  all.every((r) => Object.values(r.signals.scores).every((v) => v >= 0 && v <= 1)));
check('signals carry processing hints',
  all.every((r) => typeof r.signals.maxIntensityCap === 'number' && typeof r.signals.protectStructure === 'boolean'));
check('short input -> general with 0.5 confidence',
  (() => { const r = classifyContent('hi'); return r.type === 'general' && r.confidence === 0.5; })());

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
