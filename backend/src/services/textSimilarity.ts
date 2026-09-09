/**
 * Telling whether two people are describing the same problem.
 *
 * This is a token-overlap baseline, and it is deliberately a baseline. The
 * right tool is a multilingual sentence embedding — "nali jam hai" and "drain
 * blocked, sewage on the road" are the same complaint and share not one token,
 * and nothing here will ever notice that. See docs/advanced-capabilities.md §2.
 *
 * What this does buy, today, without a model or a GPU: it catches the common
 * case, which is several neighbours writing recognisably similar sentences
 * about the same nala within a few days. It runs in microseconds, it is
 * deterministic, and an officer can be shown exactly which words two complaints
 * shared — which matters, because the consequence of grouping is that somebody
 * else's report raises the priority of yours.
 */

/**
 * Words that carry no signal about *which* problem this is.
 *
 * Mixed English and romanised Hindi on purpose: citizens write in both within
 * one sentence, and a stoplist covering only English would leave "hai", "mein"
 * and "nahi" as the highest-frequency tokens in the corpus.
 */
const STOPWORDS = new Set([
  // English
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'has', 'have',
  'this', 'that', 'with', 'from', 'been', 'was', 'were', 'our', 'out', 'very',
  'there', 'here', 'they', 'them', 'their', 'please', 'kindly', 'sir', 'madam',
  'since', 'because', 'about', 'into', 'over', 'near', 'also', 'more', 'much',
  'been', 'being', 'will', 'would', 'could', 'should', 'when', 'where', 'what',
  // Romanised Hindi
  'hai', 'hain', 'ho', 'hua', 'hui', 'raha', 'rahi', 'rahe', 'gaya', 'gayi',
  'nahi', 'nhi', 'mein', 'me', 'ka', 'ki', 'ke', 'ko', 'se', 'par', 'aur',
  'bhi', 'kar', 'karo', 'kare', 'karna', 'diya', 'kripya', 'jaldi', 'bahut',
  'humare', 'hamare', 'humari', 'hamari', 'apne', 'yahan', 'wahan', 'kuch',
  'koi', 'jo', 'ab', 'to', 'tha', 'thi', 'the', 'kai', 'din', 'roz',
])

/**
 * Split text into the words that actually distinguish one complaint from
 * another.
 *
 * Unicode-aware, so Devanagari survives: a complaint written in the script
 * rather than transliterated must still cluster with itself.
 */
export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
}

/** Adjacent word pairs, which catch phrasing that single words miss. */
function bigrams(tokens: string[]): string[] {
  const pairs: string[] = []
  for (let i = 0; i < tokens.length - 1; i++) pairs.push(`${tokens[i]} ${tokens[i + 1]}`)
  return pairs
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const item of a) if (b.has(item)) shared++
  return shared / (a.size + b.size - shared)
}

export interface Similarity {
  score: number
  /** The words both texts used, for showing an officer why these were grouped. */
  sharedTerms: string[]
}

/**
 * How alike two complaint texts are, 0-1.
 *
 * Unigram overlap carries most of the weight; bigram overlap is a bonus, since
 * two texts sharing "street light" as a phrase are more alike than two that
 * happen to use both words apart.
 */
export function similarity(a: string, b: string): Similarity {
  const aTokens = tokenise(a)
  const bTokens = tokenise(b)

  const aSet = new Set(aTokens)
  const bSet = new Set(bTokens)
  const unigram = jaccard(aSet, bSet)
  const bigram = jaccard(new Set(bigrams(aTokens)), new Set(bigrams(bTokens)))

  const sharedTerms = [...aSet].filter((t) => bSet.has(t)).slice(0, 8)

  return {
    score: Number((unigram * 0.7 + bigram * 0.3).toFixed(3)),
    sharedTerms,
  }
}

/**
 * Metres between two points. Duplicated from the EXIF service on purpose —
 * that one is about verifying a photograph, this one is about grouping
 * complaints, and tying them together would couple two things that have no
 * reason to change together.
 */
export function metresBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
