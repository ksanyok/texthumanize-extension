/**
 * Built-in stop words (EN + RU) used by keyword/summary/sentiment fallbacks
 * when no language pack is supplied. Not exhaustive — the language packs carry
 * the full lists; this is a safety net.
 * @module engine/_stopwords
 */

export const STOPWORDS_EN = new Set(('a an the and or but if then else of to in on at by for with without from into ' +
  'over under again further this that these those is are was were be been being have has had do does did will would ' +
  'could should may might shall can not no nor only own same so than too very just because as until while about ' +
  'against between during before after above below up down out off through it its it\'s they them their there here ' +
  'what which who whom whose when where why how all any both each few more most other some such i you he she we me my ' +
  'your his her our their mine yours ours also which one two get got make made like really actually thing things').split(/\s+/));

export const STOPWORDS_RU = new Set(('и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по ' +
  'только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас ' +
  'нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтобы ' +
  'без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой ' +
  'тем чтоб нее сейчас были куда зачем всех никогда можно при наконец два об другой хоть после над больше тот через эти ' +
  'нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им ' +
  'более всегда конечно всю между это её очень').split(/\s+/));

/**
 * Resolve a stopword Set for a language, preferring the pack's list.
 * @param {string} [lang]
 * @param {{stop_words?: string[]|Set<string>}|null} [langPack]
 * @returns {Set<string>}
 */
export function stopwordsFor(lang, langPack) {
  const packWords = langPack?.stop_words;
  if (Array.isArray(packWords) && packWords.length) return new Set(packWords.map((w) => String(w).toLowerCase()));
  if (packWords instanceof Set && packWords.size) return packWords;
  const base = new Set([...STOPWORDS_EN, ...STOPWORDS_RU]);
  return base;
}
