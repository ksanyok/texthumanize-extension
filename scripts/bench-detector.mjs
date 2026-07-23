#!/usr/bin/env node
/**
 * Detector discrimination benchmark.
 *
 * Answers three questions the WEIGHTS table only assumes:
 *   1. Which metrics actually SEPARATE human from AI text (per language)?
 *   2. Does the assigned weight match the observed discriminative power?
 *   3. Which metrics survive humanization (paraphrase-robust), and does the
 *      overall score stay honest on definitely-human text (false positives)?
 *
 *   node scripts/bench-detector.mjs            # summary tables
 *   node scripts/bench-detector.mjs -v         # + per-sample scores
 *
 * Corpus notes: "classic" human samples are pre-1929 public-domain prose —
 * the only texts here that are *guaranteed* human. "informal"/"modern" human
 * samples are stylistic stand-ins authored for this bench; treat their
 * absolute scores as directional, not ground truth.
 */
import { readFileSync } from 'node:fs';
import { AIDetector } from '../engine/detector.js';
import { humanize } from '../engine/pipeline.js';

const VERBOSE = process.argv.includes('-v');
const pack = (code) => JSON.parse(readFileSync(new URL(`../data/langs/${code}.json`, import.meta.url)));

const CORPUS = [
  // ── EN human ──
  { lang: 'en', label: 'human', name: 'classic-austen', text:
    'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife. However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered as the rightful property of some one or other of their daughters. "My dear Mr. Bennet," said his lady to him one day, "have you heard that Netherfield Park is let at last?" Mr. Bennet replied that he had not. "But it is," returned she; "for Mrs. Long has just been here, and she told me all about it." Mr. Bennet made no answer.' },
  { lang: 'en', label: 'human', name: 'classic-twain', text:
    'You don\'t know about me without you have read a book by the name of The Adventures of Tom Sawyer; but that ain\'t no matter. That book was made by Mr. Mark Twain, and he told the truth, mainly. There was things which he stretched, but mainly he told the truth. That is nothing. I never seen anybody but lied one time or another, without it was Aunt Polly, or the widow, or maybe Mary. Aunt Polly — Tom\'s Aunt Polly, she is — and Mary, and the Widow Douglas is all told about in that book, which is mostly a true book, with some stretchers, as I said before.' },
  { lang: 'en', label: 'human', name: 'informal-forum', text:
    'ok so quick update on the deck build. got the joists in saturday, and of course it rained sunday so everything sat under a tarp. the inspector comes tuesday. one thing nobody tells you: the ledger flashing is the part that eats your whole weekend, not the framing. i went through two boxes of screws because the first ones were garbage and snapped at the head. anyway. if your posts are even slightly out of plumb fix it NOW, not after the beams go on. ask me how i know lol. total cost so far is sitting around 2300 which is... not what the youtube guys promised.' },
  { lang: 'en', label: 'human', name: 'modern-technical', text:
    'The migration took three weekends instead of one. Our old cluster ran Postgres 11 with a pile of hand-written triggers nobody had touched since 2019, and two of them silently depended on a locale setting that the new boxes did not share. We found that out the bad way: order totals off by a cent in some locales, only on refunds. The fix itself was four lines. Finding it was two days of diffing WAL dumps. If you take one thing from this postmortem, pin your locales in the container image and test refunds, not just checkouts.' },
  // ── EN AI ──
  { lang: 'en', label: 'ai', name: 'ai-corporate', text:
    "In today's rapidly evolving digital landscape, it is important to note that leveraging synergistic solutions can significantly enhance productivity. Furthermore, organizations must carefully consider the multifaceted implications of these transformative technologies. Moreover, it should be noted that the implementation of such systems requires careful consideration of numerous factors. In conclusion, the utilization of robust frameworks plays a crucial role in navigating the complexities of modern business environments." },
  { lang: 'en', label: 'ai', name: 'ai-assistant', text:
    "Great question! Let's break down how solar panels work. Essentially, solar panels convert sunlight into electricity through the photovoltaic effect. When sunlight hits the panel, it excites electrons in the silicon cells, creating an electric current. Here are the key components: First, the panels themselves capture sunlight. Second, an inverter converts the direct current into alternating current. Third, your home's electrical panel distributes the power. It's worth noting that modern panels are remarkably efficient, converting around 20% of sunlight into usable energy. Ultimately, solar power offers a sustainable and cost-effective solution for reducing your carbon footprint." },
  { lang: 'en', label: 'ai', name: 'ai-listicle', text:
    'Artificial intelligence has become an integral part of our daily lives. It is worth noting that these powerful tools offer a wide range of benefits across various industries. Additionally, the seamless integration of machine learning algorithms enables businesses to unlock unprecedented opportunities. However, it is essential to delve deeper into the ethical considerations. Ultimately, striking the right balance remains pivotal for sustainable growth.' },
  { lang: 'en', label: 'ai', name: 'ai-academic', text:
    'The proliferation of digital technologies has fundamentally transformed contemporary society. This transformation is characterized by the widespread adoption of interconnected systems. The implementation of these frameworks necessitates comprehensive evaluation. Furthermore, the utilization of advanced methodologies facilitates the optimization of organizational processes. It is important to note that such developments require careful consideration of both technical and social factors.' },
  // ── RU human ──
  { lang: 'ru', label: 'human', name: 'classic-chekhov', text:
    'Говорили, что на набережной появилось новое лицо: дама с собачкой. Дмитрий Дмитрич Гуров, проживший в Ялте уже две недели и привыкший тут, тоже стал интересоваться новыми лицами. Сидя в павильоне у Верне, он видел, как по набережной прошла молодая дама, невысокого роста блондинка, в берете; за нею бежал белый шпиц. И потом он встречал её в городском саду и на сквере по нескольку раз в день. Она гуляла одна, всё в том же берете, с белым шпицем; никто не знал, кто она, и называли её просто так: дама с собачкой.' },
  { lang: 'ru', label: 'human', name: 'informal-forum', text:
    'короче, поменял я этот датчик. три часа, два содранных пальца и одна потерянная головка на десять. кто проектировал этот моторный отсек — отдельный привет ему. по деньгам: датчик 1800, прокладка 200, и ещё герметик у меня был. на сервисе просили пять с половиной, так что вроде сэкономил, но по времени конечно ад. да, важное: не берите аналог за 900, у меня такой сдох через месяц, оригинал ходит уже полгода. чек энджин потух сам на второй день, ошибку скидывать не пришлось.' },
  { lang: 'ru', label: 'human', name: 'modern-report', text:
    'Ремонт моста на Садовой опять перенесли, теперь на сентябрь. Подрядчик объясняет задержку тем, что при вскрытии опор нашли трещины, которых не было в проектной документации две тысячи восьмого года. Жители соседних домов жалуются в первую очередь не на сроки, а на объезд: автобусы идут через узкую Полевую, и по утрам там стоит всё намертво. В мэрии обещали пустить два дополнительных рейса, но пока на маршруте те же четыре машины, что и весной.' },
  // ── RU AI ──
  { lang: 'ru', label: 'ai', name: 'ai-корпоративный', text:
    'В современном мире стремительно развивающихся технологий важно отметить, что использование синергетических решений может значительно повысить производительность. Кроме того, организациям следует тщательно учитывать многогранные последствия этих трансформационных технологий. Более того, следует отметить, что внедрение подобных систем требует внимательного рассмотрения множества факторов. Таким образом, использование надёжных решений играет ключевую роль в достижении устойчивого успеха.' },
  { lang: 'ru', label: 'ai', name: 'ai-ассистент', text:
    'Отличный вопрос! Давайте разберёмся, как работают солнечные панели. По сути, солнечные панели преобразуют солнечный свет в электричество благодаря фотоэлектрическому эффекту. Когда свет попадает на панель, он возбуждает электроны в кремниевых ячейках, создавая электрический ток. Вот ключевые компоненты: во-первых, сами панели улавливают свет. Во-вторых, инвертор преобразует постоянный ток в переменный. В-третьих, электрощит распределяет энергию по дому. Стоит отметить, что современные панели удивительно эффективны. В конечном итоге, солнечная энергия предлагает устойчивое и экономичное решение.' },
  { lang: 'ru', label: 'ai', name: 'ai-статья', text:
    'Искусственный интеллект стал неотъемлемой частью нашей повседневной жизни. Стоит отметить, что эти мощные инструменты предоставляют широкий спектр преимуществ в различных отраслях. Кроме того, бесшовная интеграция алгоритмов машинного обучения позволяет компаниям раскрывать беспрецедентные возможности. Однако необходимо более глубоко изучить этические аспекты. В конечном итоге, поиск правильного баланса остаётся ключевым фактором устойчивого развития.' },
  // ── UK ──
  { lang: 'uk', label: 'human', name: 'classic-kotsiubynsky', text:
    'Іван був дев\'ятнадцятою дитиною в гуцульській родині Палійчуків. Двадцятою і останньою була Анничка. Не знати, чи то вічний шум Черемошу і скарги гірських потоків, що сповняли самотню хату на високій кичері, чи сум чорних смерекових лісів лякав дитину, тільки Іван все плакав, кричав по ночах, погано ріс і дивився на неню таким глибоким, старече розумним зором, що мати в тривозі одвертала од нього очі.' },
  { lang: 'uk', label: 'ai', name: 'ai-корпоративний', text:
    'У сучасному світі стрімкого розвитку технологій важливо зазначити, що використання синергетичних рішень може значно підвищити продуктивність. Крім того, організаціям слід ретельно враховувати багатогранні наслідки цих трансформаційних технологій. Більш того, слід зазначити, що впровадження подібних систем потребує уважного розгляду численних факторів.' },
  // ── DE ──
  { lang: 'de', label: 'human', name: 'classic-kafka', text:
    'Als Gregor Samsa eines Morgens aus unruhigen Träumen erwachte, fand er sich in seinem Bett zu einem ungeheueren Ungeziefer verwandelt. Er lag auf seinem panzerartig harten Rücken und sah, wenn er den Kopf ein wenig hob, seinen gewölbten, braunen, von bogenförmigen Versteifungen geteilten Bauch, auf dessen Höhe sich die Bettdecke, zum gänzlichen Niedergleiten bereit, kaum noch erhalten konnte. Seine vielen, im Vergleich zu seinem sonstigen Umfang kläglich dünnen Beine flimmerten ihm hilflos vor den Augen.' },
  { lang: 'de', label: 'ai', name: 'ai-unternehmen', text:
    'In der heutigen sich schnell entwickelnden digitalen Landschaft ist es wichtig zu beachten, dass die Nutzung synergetischer Lösungen die Produktivität erheblich steigern kann. Darüber hinaus müssen Organisationen die vielfältigen Auswirkungen dieser transformativen Technologien sorgfältig berücksichtigen. Zusammenfassend spielt der Einsatz robuster Frameworks eine entscheidende Rolle für den nachhaltigen Erfolg.' },
];

const detector = new AIDetector();
const packs = {};
const results = [];

for (const s of CORPUS) {
  packs[s.lang] = packs[s.lang] || pack(s.lang);
  const r = detector.detect(s.text, { lang: s.lang, langPack: packs[s.lang] });
  results.push({ ...s, pct: Math.round(r.aiProbability * 100), scores: r.scores, words: r.wordCount });
  if (VERBOSE) console.log(`${s.lang} ${s.label.padEnd(6)} ${s.name.padEnd(22)} → ${Math.round(r.aiProbability * 100)}%`);
}

// ── 1. Overall separation + false positives ──
console.log('\n══ OVERALL (goal: human low, ai high) ══');
console.log(`${'sample'.padEnd(30)}${'label'.padEnd(8)}score`);
for (const r of results) {
  const warn = (r.label === 'human' && r.pct >= 50) ? '  ⚠ FALSE POSITIVE'
    : (r.label === 'ai' && r.pct <= 50) ? '  ⚠ MISSED' : '';
  console.log(`${(r.lang + '/' + r.name).padEnd(30)}${r.label.padEnd(8)}${String(r.pct).padStart(4)}%${warn}`);
}

// ── 2. Per-metric discrimination ──
const metricNames = Object.keys(results[0].scores);
const humans = results.filter((r) => r.label === 'human');
const ais = results.filter((r) => r.label === 'ai');
const meanOf = (rows, m) => rows.reduce((a, r) => a + r.scores[m], 0) / rows.length;

// Current weights, mirrored from engine/detector.js WEIGHTS (for comparison).
const WEIGHTS = { pattern: 0.19, burstiness: 0.14, voice: 0.11, stylometry: 0.10, entity: 0.08,
  structure: 0.08, discourse: 0.06, rhythm: 0.05, entropy: 0.04, opening: 0.03, grammar: 0.03,
  vocabulary: 0.02, perplexity: 0.02, semantic_rep: 0.02, readability: 0.005, punctuation: 0.005 };

console.log('\n══ PER-METRIC SEPARATION (mean(ai) − mean(human); >0 good, ≈0 dead, <0 inverted) ══');
console.log(`${'metric'.padEnd(15)}${'human'.padStart(7)}${'ai'.padStart(7)}${'sep'.padStart(8)}${'weight'.padStart(8)}   verdict`);
const rows = metricNames
  .map((m) => ({ m, h: meanOf(humans, m), a: meanOf(ais, m), w: WEIGHTS[m] ?? 0 }))
  .map((r) => ({ ...r, sep: r.a - r.h }))
  .sort((x, y) => y.sep - x.sep);
for (const r of rows) {
  const verdict = r.sep > 0.15 ? 'strong'
    : r.sep > 0.05 ? 'ok'
    : r.sep > -0.05 ? (r.w >= 0.05 ? 'DEAD but weighted' : 'dead')
    : 'INVERTED';
  console.log(`${r.m.padEnd(15)}${r.h.toFixed(3).padStart(7)}${r.a.toFixed(3).padStart(7)}`
    + `${((r.sep > 0 ? '+' : '') + r.sep.toFixed(3)).padStart(8)}${r.w.toFixed(2).padStart(8)}   ${verdict}`);
}

// ── 3. Length sensitivity (how much of the ensemble is alive per size) ──
console.log('\n══ LENGTH SENSITIVITY (ai-corporate en, truncated) ══');
const base = CORPUS.find((s) => s.name === 'ai-corporate').text;
for (const n of [20, 35, 50, 80, 120, 250]) {
  const t = base.split(/\s+/).slice(0, n).join(' ');
  const r = detector.detect(t, { lang: 'en', langPack: packs.en });
  const alive = Object.values(r.scores).filter((v) => v !== 0.5).length;
  console.log(`${String(n).padStart(4)} words → ${String(Math.round(r.aiProbability * 100)).padStart(3)}%   `
    + `active metrics ${alive}/${Object.keys(r.scores).length}`);
}

// ── 4. Humanization resistance: which metrics survive our own rewriter ──
console.log('\n══ HUMANIZATION RESISTANCE (mean over en+ru AI samples, int=65) ══');
const deltas = new Map();
for (const s of results.filter((r) => r.label === 'ai' && (r.lang === 'en' || r.lang === 'ru'))) {
  const out = humanize(s.text, { lang: s.lang, langPack: packs[s.lang], intensity: 65, profile: 'web', seed: 1 });
  const after = detector.detect(out.text, { lang: s.lang, langPack: packs[s.lang] });
  for (const m of metricNames) {
    deltas.set(m, (deltas.get(m) || []).concat(after.scores[m] - s.scores[m]));
  }
}
const resist = [...deltas.entries()]
  .map(([m, ds]) => ({ m, before: meanOf(ais, m), d: ds.reduce((a, b) => a + b, 0) / ds.length }))
  .sort((a, b) => a.d - b.d);
for (const r of resist) {
  const note = r.before > 0.55 && r.d > -0.03 ? '  ← RESISTS (humanizer blind spot)'
    : r.d < -0.08 ? '  ← humanizer moves this' : '';
  console.log(`${r.m.padEnd(15)} before ${r.before.toFixed(2)}  Δafter ${(r.d > 0 ? '+' : '') + r.d.toFixed(3)}${note}`);
}
