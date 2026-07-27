// Общие для сборки колоды и рантайма примитивы работы с греческим текстом.
// Файл намеренно .mjs: его импортирует и Node (scripts/build-deck.mjs), и Vite.

const COMBINING = /[̀-ͅ]/g;

/** Убирает тонос и диалитику, оставляя базовые буквы: «άνθρωπος» → «ανθρωπος». */
export function stripAccents(s) {
  return s.normalize('NFD').replace(COMBINING, '').normalize('NFC');
}

/**
 * Приведение к каноничному виду без потери ударения.
 * Схлопывает пробелы, опускает регистр, унифицирует конечную сигму.
 */
export function normalize(s) {
  return s
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/ς/g, 'σ');
}

/** Каноничный вид, дополнительно игнорирующий ударения. */
export function normalizeLoose(s) {
  return stripAccents(normalize(s));
}

const TRANSLIT = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i',
  κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's',
  ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};

/**
 * Стабильный идентификатор слова. Строится из греческой формы без ударений,
 * поэтому переживает правку перевода, примера и даже расстановки тоноса.
 */
export function slugify(greek) {
  return normalizeLoose(greek)
    .split('')
    .map((ch) => TRANSLIT[ch] ?? (/[a-z0-9]/.test(ch) ? ch : ' '))
    .join('')
    .trim()
    .replace(/\s+/g, '-');
}

const VOWELS = 'αεηιουω';
const TONOS = {
  α: 'ά', ε: 'έ', η: 'ή', ι: 'ί', ο: 'ό', υ: 'ύ', ω: 'ώ',
  ϊ: 'ΐ', ϋ: 'ΰ',
};

export function isVowel(ch) {
  return VOWELS.includes(stripAccents(ch ?? '').toLowerCase());
}

/** Ставит тонос на гласную; если он уже стоит — снимает. */
export function toggleTonos(ch) {
  const bare = stripAccents(ch);
  if (bare !== ch) return bare;
  return TONOS[ch] ?? ch;
}

/**
 * Сравнение ответа пользователя с эталоном.
 * Возвращает 'exact' | 'accent' (верно, но ударение не там) | 'wrong'.
 */
export function compareAnswer(input, expected) {
  const a = normalize(input);
  const b = normalize(expected);
  if (a === b) return 'exact';
  if (normalizeLoose(a) === normalizeLoose(b)) return 'accent';
  return 'wrong';
}

/** Расстояние Левенштейна — для подсказки «ты был близко». */
export function editDistance(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Стандартная греческая раскладка — та же, что на телефоне и в macOS. */
export const KEYBOARD_ROWS = [
  ['ς', 'ε', 'ρ', 'τ', 'υ', 'θ', 'ι', 'ο', 'π'],
  ['α', 'σ', 'δ', 'φ', 'γ', 'η', 'ξ', 'κ', 'λ'],
  ['ζ', 'χ', 'ψ', 'ω', 'β', 'ν', 'μ'],
];
