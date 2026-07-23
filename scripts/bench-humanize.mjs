#!/usr/bin/env node
/**
 * Humanization benchmark.
 *
 * Runs the real pipeline over a fixed corpus of AI-flavoured texts and reports
 * the detector score before and after, plus which AI markers survived. Use it to
 * check that a change to the naturalizer/debureaucratizer actually moves the
 * needle instead of eyeballing one sample.
 *
 *   node scripts/bench-humanize.mjs            # summary table
 *   node scripts/bench-humanize.mjs -v          # + full before/after text
 *   node scripts/bench-humanize.mjs --lang en   # one language only
 */
import { readFileSync } from 'node:fs';
import { humanize } from '../engine/pipeline.js';
import { AIDetector } from '../engine/detector.js';

const argv = process.argv.slice(2);
const VERBOSE = argv.includes('-v') || argv.includes('--verbose');
const ONLY = argv.includes('--lang') ? argv[argv.indexOf('--lang') + 1] : null;

const pack = (code) => JSON.parse(readFileSync(new URL(`../data/langs/${code}.json`, import.meta.url)));

/** Phrases a humanizer is expected to remove; survivors are reported. */
const MARKERS = {
  en: ["in today's", 'rapidly evolving', 'digital landscape', 'it is important to note',
    'furthermore', 'moreover', 'it should be noted', 'delve', 'leverage', 'leveraging',
    'synergistic', 'multifaceted', 'transformative', 'seamless', 'robust', 'pivotal',
    'in conclusion', 'navigate the complexities', 'testament to', 'plays a crucial role',
    'it is worth noting', 'a wide range of', 'in the realm of', 'ever-evolving'],
  ru: ['в современном мире', 'стремительно развивающ', 'важно отметить', 'кроме того',
    'более того', 'следует отметить', 'играет ключевую роль', 'в заключение',
    'широкий спектр', 'неотъемлемой частью', 'таким образом', 'в конечном итоге'],
  uk: ['у сучасному світі', 'важливо зазначити', 'крім того', 'більш того',
    'слід зазначити', 'відіграє ключову роль', 'на завершення', 'широкий спектр'],
  de: ['in der heutigen', 'es ist wichtig zu', 'darüber hinaus', 'zusammenfassend',
    'eine entscheidende rolle', 'vielfältige'],
  es: ['en el mundo actual', 'es importante señalar', 'además', 'en conclusión',
    'desempeña un papel crucial', 'amplia gama'],
};

const CORPUS = [
  { lang: 'en', name: 'corporate/tech', text:
    "In today's rapidly evolving digital landscape, it is important to note that leveraging "
    + 'synergistic solutions can significantly enhance productivity. Furthermore, organizations '
    + 'must carefully consider the multifaceted implications of these transformative technologies. '
    + 'Moreover, it should be noted that the implementation of such systems requires careful '
    + 'consideration of numerous factors. In conclusion, the utilization of robust frameworks '
    + 'plays a crucial role in navigating the complexities of modern business environments.' },
  { lang: 'en', name: 'blog/listicle', text:
    'Artificial intelligence has become an integral part of our daily lives. It is worth noting '
    + 'that these powerful tools offer a wide range of benefits across various industries. '
    + 'Additionally, the seamless integration of machine learning algorithms enables businesses '
    + 'to unlock unprecedented opportunities. However, it is essential to delve deeper into the '
    + 'ethical considerations. Ultimately, striking the right balance remains pivotal.' },
  { lang: 'en', name: 'academic-ish', text:
    'The proliferation of digital technologies has fundamentally transformed contemporary society. '
    + 'This transformation is characterized by the widespread adoption of interconnected systems. '
    + 'The implementation of these frameworks necessitates comprehensive evaluation. Furthermore, '
    + 'the utilization of advanced methodologies facilitates the optimization of organizational '
    + 'processes. It is important to note that such developments require careful consideration.' },
  { lang: 'ru', name: 'корпоративный', text:
    'В современном мире стремительно развивающихся технологий важно отметить, что использование '
    + 'синергетических решений может значительно повысить производительность. Кроме того, '
    + 'организациям следует тщательно учитывать многогранные последствия этих трансформационных '
    + 'технологий. Более того, следует отметить, что внедрение подобных систем требует '
    + 'внимательного рассмотрения множества факторов. Таким образом, использование надёжных '
    + '框架 играет ключевую роль.'.replace('框架', 'решений') },
  { lang: 'ru', name: 'блог', text:
    'Искусственный интеллект стал неотъемлемой частью нашей повседневной жизни. Стоит отметить, '
    + 'что эти мощные инструменты предоставляют широкий спектр преимуществ в различных отраслях. '
    + 'Кроме того, бесшовная интеграция алгоритмов машинного обучения позволяет компаниям '
    + 'раскрывать беспрецедентные возможности. Однако необходимо более глубоко изучить этические '
    + 'аспекты. В конечном итоге, поиск правильного баланса остаётся ключевым.' },
  { lang: 'uk', name: 'корпоративний', text:
    'У сучасному світі стрімкого розвитку технологій важливо зазначити, що використання '
    + 'синергетичних рішень може значно підвищити продуктивність. Крім того, організаціям слід '
    + 'ретельно враховувати багатогранні наслідки цих трансформаційних технологій. Більш того, '
    + 'слід зазначити, що впровадження подібних систем потребує уважного розгляду.' },
  { lang: 'de', name: 'unternehmen', text:
    'In der heutigen sich schnell entwickelnden digitalen Landschaft ist es wichtig zu beachten, '
    + 'dass die Nutzung synergetischer Lösungen die Produktivität erheblich steigern kann. '
    + 'Darüber hinaus müssen Organisationen die vielfältigen Auswirkungen dieser Technologien '
    + 'sorgfältig berücksichtigen. Zusammenfassend spielt der Einsatz robuster Frameworks eine '
    + 'entscheidende Rolle.' },
  { lang: 'es', name: 'corporativo', text:
    'En el mundo actual de tecnologías en rápida evolución, es importante señalar que el '
    + 'aprovechamiento de soluciones sinérgicas puede mejorar significativamente la productividad. '
    + 'Además, las organizaciones deben considerar cuidadosamente las implicaciones multifacéticas '
    + 'de estas tecnologías transformadoras. En conclusión, la utilización de marcos robustos '
    + 'desempeña un papel crucial.' },
];

/**
 * Mechanical damage the rewriter can inflict. Every one of these was a real
 * bug: deleting an opening cliché used to leave "…daily lives.  these powerful
 * tools…", and adverb swaps produced "can much improve". Grammar in general
 * can't be checked here, but this class of breakage is objective.
 */
const DAMAGE = [
  { id: 'double-space', re: /\S {2,}\S/, note: 'collapsed text left a double space' },
  { id: 'leading-space', re: /^\s/, note: 'output starts with whitespace' },
  { id: 'lowercase-sentence', re: /[.!?]\s+\p{Ll}/u, note: 'sentence starts lower-case' },
  { id: 'space-before-punct', re: /\s+[,.;:!?]/, note: 'space before punctuation' },
  { id: 'double-punct', re: /[,;:]\s*[,;:]|\.\s*\./, note: 'doubled punctuation' },
  { id: 'dangling-comma', re: /,\s*$/, note: 'ends on a comma' },
  { id: 'bad-adverb', re: /\b(?:can|could|will|would|may|might|to)\s+(?:much|a lot)\s+\p{L}/u,
    note: 'pre-verbal "much"/"a lot"' },
  { id: 'help-gerund', re: /\bhelps?\s+\p{Ll}+ing\b/u, note: '"helps improving" (needs bare infinitive)' },
];

const detector = new AIDetector();
const rows = [];
let damaged = 0;

for (const item of CORPUS) {
  if (ONLY && item.lang !== ONLY) continue;
  const langPack = pack(item.lang);
  const before = detector.detect(item.text, { lang: item.lang, langPack });
  const res = humanize(item.text, {
    lang: item.lang, langPack, intensity: 65, profile: 'web', seed: 1,
  });
  const after = detector.detect(res.text, { lang: item.lang, langPack });

  const lower = res.text.toLowerCase();
  const survivors = (MARKERS[item.lang] || []).filter((m) => lower.includes(m));

  // Check every seed, not just the one we report: these bugs are RNG-dependent
  // and a single sample hides them.
  const faults = new Map();
  for (let seed = 1; seed <= 12; seed += 1) {
    const t = humanize(item.text, { lang: item.lang, langPack, intensity: 65, profile: 'web', seed }).text;
    for (const d of DAMAGE) {
      if (d.re.test(t)) faults.set(d.id, d.note);
    }
  }
  if (faults.size) {
    damaged += faults.size;
    for (const [id, note] of faults) console.log(`  ⚠ ${item.lang}/${item.name}: ${id} — ${note}`);
  }

  rows.push({
    lang: item.lang,
    name: item.name,
    before: Math.round(before.aiProbability * 100),
    after: Math.round(after.aiProbability * 100),
    survivors,
    markers: (MARKERS[item.lang] || []).length,
    changes: res.changes.length,
    ratio: res.changeRatio,
  });

  if (VERBOSE) {
    console.log(`\n${'='.repeat(78)}\n${item.lang} · ${item.name}`);
    console.log(`\nBEFORE (${Math.round(before.aiProbability * 100)}%):\n${item.text}`);
    console.log(`\nAFTER  (${Math.round(after.aiProbability * 100)}%):\n${res.text}`);
    if (survivors.length) console.log(`\nSURVIVING MARKERS: ${survivors.join(' · ')}`);
  }
}

console.log(`\n${'lang'.padEnd(5)}${'sample'.padEnd(16)}${'before'.padStart(7)}${'after'.padStart(7)}`
  + `${'Δ'.padStart(7)}${'ratio'.padStart(8)}   surviving markers`);
console.log('─'.repeat(96));
let sumBefore = 0; let sumAfter = 0; let sumSurv = 0; let sumMark = 0;
for (const r of rows) {
  sumBefore += r.before; sumAfter += r.after; sumSurv += r.survivors.length; sumMark += r.markers;
  const d = r.after - r.before;
  console.log(`${r.lang.padEnd(5)}${r.name.slice(0, 15).padEnd(16)}${String(r.before).padStart(7)}`
    + `${String(r.after).padStart(7)}${String(d).padStart(7)}${r.ratio.toFixed(2).padStart(8)}   `
    + `${r.survivors.length}/${r.markers}${r.survivors.length ? ': ' + r.survivors.slice(0, 4).join(', ') : ''}`);
}
console.log('─'.repeat(96));
const n = rows.length || 1;
console.log(`${'mean'.padEnd(21)}${String(Math.round(sumBefore / n)).padStart(7)}`
  + `${String(Math.round(sumAfter / n)).padStart(7)}`
  + `${String(Math.round((sumAfter - sumBefore) / n)).padStart(7)}`
  + `${''.padStart(8)}   ${sumSurv}/${sumMark} markers survived`);
console.log(damaged ? `\n${damaged} mechanical fault(s) — see ⚠ above` : '\nno mechanical faults');
process.exit(damaged ? 1 : 0);
