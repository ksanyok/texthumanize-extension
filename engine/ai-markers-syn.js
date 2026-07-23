/**
 * Plain-language replacements for the exact AI-marker words the detector's
 * `pattern`/`vocabulary` metrics score on (mirrors AI_MARKERS in detector.js).
 * The language packs miss most of these buzzwords, so the humanizer left them
 * in and the score barely moved. Merged into the debureaucratizer dictionary
 * at runtime — reuses its tested word-boundary + case-preserving replacement.
 *
 * EN verb inflections are enumerated (base / -s / -ing / -ed) so exact matching
 * catches "leveraging", "utilizes", etc. Cyrillic entries stay in the nominative
 * base — the debureaucratizer's gender-class picker keeps adjective agreement.
 *
 * @module engine/ai-markers-syn
 */

/**
 * De-nominalization: "the {noun} of X" → "{gerund} X" (EN). Turning noun
 * phrases back into verbs is the single biggest lever on the detector's `voice`
 * metric and reads far more human ("the integration of ML" → "integrating ML").
 * @type {Record<string, string>} nominalization → gerund/verb
 */
export const DE_NOMINALIZE_EN = {
  integration: 'integrating', utilization: 'using', implementation: 'implementing',
  optimization: 'improving', facilitation: 'helping', enhancement: 'improving',
  application: 'applying', creation: 'creating', development: 'developing',
  management: 'managing', consideration: 'considering', realization: 'realizing',
  transformation: 'transforming', exploration: 'exploring', examination: 'examining',
  evaluation: 'evaluating', identification: 'identifying', organization: 'organizing',
  automation: 'automating', generation: 'generating', adoption: 'adopting',
  expansion: 'expanding', reduction: 'reducing', improvement: 'improving',
  involvement: 'involving', assessment: 'assessing', documentation: 'documenting',
  configuration: 'configuring', modification: 'modifying', preservation: 'preserving',
  distribution: 'distributing', production: 'producing', construction: 'building',
  provision: 'providing', analysis: 'analyzing', measurement: 'measuring',
  collaboration: 'working together on', deployment: 'deploying', validation: 'validating',
};

/** RU/UK safe fixed-phrase de-nominalizations (no case reinflection needed). */
export const DE_NOMINALIZE_PHRASES = {
  ru: {
    'с использованием': ['используя'], 'в целях': ['чтобы'], 'путём': ['через'],
    'посредством': ['через'], 'в рамках': ['в'], 'с помощью': ['через'],
    'в процессе': ['при'], 'в результате': ['из-за'],
  },
  uk: {
    'з використанням': ['використовуючи'], 'з метою': ['щоб'], 'шляхом': ['через'],
    'за допомогою': ['через'], 'у межах': ['у'], 'в процесі': ['при'],
  },
};

/** @type {Record<string, Record<string, string[]>>} lang → {marker: [plain, …]} */
export const AI_MARKER_SYNONYMS = {
  en: {
    // ── adjectives ──
    synergistic: ['combined', 'joined-up'], multifaceted: ['many-sided', 'complex'],
    transformative: ['major', 'game-changing'], holistic: ['whole', 'all-round'],
    intricate: ['complex', 'detailed'], seamless: ['smooth'], comprehensive: ['full', 'complete', 'thorough'],
    'cutting-edge': ['latest', 'modern'], 'state-of-the-art': ['latest', 'top'],
    groundbreaking: ['new', 'major'], pivotal: ['key', 'central'], paramount: ['top', 'main'],
    crucial: ['key', 'central'], nuanced: ['subtle'], meticulous: ['careful', 'precise'],
    imperative: ['needed', 'a must'], robust: ['strong', 'solid'], innovative: ['new', 'fresh'],
    // ── adverbs ──
    // These sit in front of a verb ("can significantly enhance"), so only
    // adverbs are valid replacements — "a lot"/"much" are post-verbal and
    // produce "can much improve".
    significantly: ['greatly', 'sharply', 'markedly'], substantially: ['greatly', 'sharply'],
    considerably: ['greatly', 'far'], remarkably: ['very', 'really'], exceptionally: ['very', 'really'],
    tremendously: ['hugely', 'enormously'], profoundly: ['deeply'], fundamentally: ['basically'],
    essentially: ['basically', 'really'], particularly: ['especially', 'mainly'],
    specifically: ['exactly', 'namely'], notably: ['especially'], increasingly: ['more and more'],
    effectively: ['really', 'in effect'], ultimately: ['in the end'], consequently: ['so'],
    inherently: ['by nature'], intrinsically: ['by nature'], predominantly: ['mostly', 'mainly'],
    invariably: ['always'],
    // ── verbs (base / -s / -ing / -ed) ──
    utilize: ['use'], utilizes: ['uses'], utilizing: ['using'], utilized: ['used'],
    leverage: ['use', 'tap into'], leverages: ['uses'], leveraging: ['using'], leveraged: ['used'],
    facilitate: ['help', 'ease'], facilitates: ['helps', 'eases'], facilitating: ['helping', 'easing'], facilitated: ['helped', 'eased'],
    foster: ['build', 'grow'], fosters: ['builds', 'grows'], fostering: ['building', 'growing'], fostered: ['built', 'grew'],
    enhance: ['improve', 'boost'], enhances: ['improves', 'boosts'], enhancing: ['improving', 'boosting'], enhanced: ['improved', 'boosted'],
    streamline: ['simplify'], streamlines: ['simplifies'], streamlining: ['simplifying'], streamlined: ['simplified'],
    optimize: ['improve', 'tune'], optimizes: ['improves', 'tunes'], optimizing: ['improving', 'tuning'], optimized: ['improved', 'tuned'],
    underscore: ['show', 'stress'], underscores: ['shows', 'stresses'], underscoring: ['showing', 'stressing'], underscored: ['showed', 'stressed'],
    delve: ['dig', 'look'], delves: ['digs', 'looks'], delving: ['digging', 'looking'], delved: ['dug', 'looked'],
    harness: ['use', 'tap'], harnesses: ['uses', 'taps'], harnessing: ['using', 'tapping'], harnessed: ['used', 'tapped'],
    navigate: ['handle', 'work through'], navigates: ['handles'], navigating: ['handling'], navigated: ['handled'],
    exemplify: ['show'], exemplifies: ['shows'], exemplifying: ['showing'], exemplified: ['showed'],
    spearhead: ['lead'], spearheads: ['leads'], spearheading: ['leading'], spearheaded: ['led'],
    revolutionize: ['remake', 'change'], revolutionizes: ['remakes', 'changes'], revolutionizing: ['remaking', 'changing'], revolutionized: ['remade', 'changed'],
    necessitate: ['need', 'require'], necessitates: ['needs', 'requires'], necessitating: ['needing', 'requiring'], necessitated: ['needed', 'required'],
    elucidate: ['explain'], elucidates: ['explains'], elucidating: ['explaining'], elucidated: ['explained'],
    delineate: ['outline'], delineates: ['outlines'], delineating: ['outlining'], delineated: ['outlined'],
    substantiate: ['back up', 'prove'], substantiates: ['backs up', 'proves'], substantiating: ['backing up', 'proving'], substantiated: ['backed up', 'proved'],
  },
  ru: {
    // adjectives (nominative; gender-class picker keeps agreement)
    синергетический: ['совместный', 'общий'], многогранный: ['разносторонний', 'сложный'],
    трансформационный: ['крупный'], целостный: ['цельный', 'полный'], всеобъемлющий: ['полный', 'общий'],
    инновационный: ['новый', 'свежий'], надёжный: ['крепкий', 'прочный'], основополагающий: ['базовый', 'главный'],
    первостепенный: ['главный', 'важный'], фундаментальный: ['основной', 'базовый'], многофакторный: ['сложный'],
    // adverbs
    значительно: ['сильно', 'намного'], существенно: ['сильно', 'заметно'], чрезвычайно: ['очень'],
    безусловно: ['конечно'], несомненно: ['точно', 'ясно'], принципиально: ['в целом'],
    непосредственно: ['прямо'], кардинально: ['резко', 'сильно'], всесторонне: ['подробно'],
    исключительно: ['только', 'очень'], преимущественно: ['в основном', 'чаще'],
    // verbs
    осуществлять: ['делать', 'проводить'], осуществляет: ['делает', 'проводит'],
    реализовывать: ['воплощать', 'делать'], реализует: ['воплощает', 'делает'],
    способствовать: ['помогать'], способствует: ['помогает'],
    обеспечивать: ['давать'], обеспечивает: ['даёт'],
  },
  uk: {
    синергетичний: ['спільний', 'загальний'], багатогранний: ['різнобічний', 'складний'],
    інноваційний: ['новий', 'свіжий'], надійний: ['міцний'], всеосяжний: ['повний', 'загальний'],
    основоположний: ['базовий', 'головний'], фундаментальний: ['основний', 'базовий'],
    значно: ['сильно', 'набагато'], суттєво: ['сильно', 'помітно'], надзвичайно: ['дуже'],
    безумовно: ['звісно'], безсумнівно: ['точно'], кардинально: ['різко'], всебічно: ['докладно'],
    здійснювати: ['робити', 'проводити'], здійснює: ['робить', 'проводить'],
    реалізовувати: ['втілювати', 'робити'], реалізує: ['втілює', 'робить'],
    сприяти: ['допомагати'], сприяє: ['допомагає'],
    забезпечувати: ['давати'], забезпечує: ['дає'],
  },
};
