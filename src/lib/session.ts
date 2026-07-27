import type {
  CardKind, CaseCell, Deck, DayStats, Progress, Settings, StoredCard, Word,
} from '../types.ts';
import { CASES, CASE_LABEL, cardKey } from '../types.ts';
import { isGraduated } from './scheduler.ts';
import { normalizeLoose } from './greek.mjs';

/**
 * Учебный день начинается в 4 утра: занятие в час ночи логичнее засчитать
 * во вчерашний день, иначе «вчера позанимался» ломает стрик.
 */
const DAY_CUTOFF_HOUR = 4;

export function dayKey(d: Date): string {
  const shifted = new Date(d.getTime() - DAY_CUTOFF_HOUR * 3600_000);
  const y = shifted.getFullYear();
  const m = String(shifted.getMonth() + 1).padStart(2, '0');
  const day = String(shifted.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function emptyDay(): DayStats {
  return { newWords: 0, unlocked: 0, reviewed: 0, correct: 0 };
}

/**
 * Ступени. Слово не вываливает все свои карточки разом: следующая открывается,
 * только когда предыдущая выпустилась из фазы обучения. Порядок — по возрастанию
 * сложности: узнал → услышал → воспроизвёл → воспроизвёл в контексте.
 */
const LADDER: CardKind[] = ['recognize', 'listen', 'produce', 'cloze', 'case'];

function ladderFor(word: Word, settings: Settings, ttsAvailable: boolean): CardKind[] {
  const enabled = new Set(settings.enabledKinds);
  return LADDER.filter((k) => {
    if (!enabled.has(k)) return false;
    if (k === 'cloze') return !!word.example && !!clozeSentence(word);
    if (k === 'listen') return ttsAvailable;
    if (k === 'case') return drillableCells(word).length > 0;
    return true;
  });
}

/**
 * Клетки падежной таблицы, которые имеет смысл спрашивать.
 *
 * Отсеиваем совпадающие с исходной формой — у среднего рода винительный
 * равен именительному, и спрашивать его значит просить переписать вопрос.
 * Звательный оставляем только у мужского рода: у остальных он совпадает
 * с именительным без артикля.
 */
export function drillableCells(word: Word): CaseCell[] {
  const d = word.declension;
  if (!d) return [];
  const base = d.nom[0];
  const out: CaseCell[] = [];
  for (const c of CASES) {
    if (c === 'voc' && word.article !== 'ο') continue;
    for (const num of [0, 1] as const) {
      // Звательный во множественном числе в живой речи не встречается
      // и совпадает с именительным без артикля — тренировать нечего.
      if (c === 'voc' && num === 1) continue;
      const form = d[c][num];
      if (!form || form === base) continue;
      out.push({ case: c, number: num });
    }
  }
  return out;
}

export function cellForm(word: Word, cell: CaseCell): string | null {
  return word.declension?.[cell.case][cell.number] ?? null;
}

export function cellLabel(cell: CaseCell): string {
  return `${CASE_LABEL[cell.case]} падеж, ${cell.number === 0 ? 'ед. ч.' : 'мн. ч.'}`;
}

/** Какие карточки слова уже разблокированы (существующие + готовые к созданию). */
export function unlockedKinds(
  word: Word,
  cards: Record<string, StoredCard>,
  settings: Settings,
  ttsAvailable: boolean,
): CardKind[] {
  const ladder = ladderFor(word, settings, ttsAvailable);
  const out: CardKind[] = [];
  for (let i = 0; i < ladder.length; i++) {
    if (i === 0) {
      out.push(ladder[i]);
      continue;
    }
    if (isGraduated(cards[cardKey(word.id, ladder[i - 1])])) out.push(ladder[i]);
    else break;
  }
  return out;
}

export type QueueItem =
  | { type: 'intro'; word: Word }
  | { type: 'card'; word: Word; kind: CardKind; isNew: boolean; cell?: CaseCell };

/** Падежная карточка каждый раз спрашивает случайную клетку таблицы. */
function withCell(item: Extract<QueueItem, { type: 'card' }>): QueueItem {
  if (item.kind !== 'case') return item;
  const cells = drillableCells(item.word);
  if (!cells.length) return item;
  return { ...item, cell: cells[Math.floor(Math.random() * cells.length)] };
}

export interface SessionPlan {
  items: QueueItem[];
  dueCount: number;
  newWordCount: number;
  unlockedCount: number;
  /** Сколько повторений ещё ждёт своей очереди из-за дневного лимита */
  deferred: number;
}

export interface PlanCounts {
  due: number;
  newWords: number;
  unlocked: number;
  total: number;
}

function topicAllowed(word: Word, settings: Settings) {
  return settings.enabledTopics.length === 0 || settings.enabledTopics.includes(word.topic);
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildSession(
  deck: Deck,
  progress: Progress,
  now: Date,
  ttsAvailable: boolean,
): SessionPlan {
  const { settings, cards } = progress;
  const today = progress.days[dayKey(now)] ?? emptyDay();
  const byId = new Map(deck.words.map((w) => [w.id, w]));
  const words = deck.words.filter((w) => topicAllowed(w, settings));

  // 1. Просроченные повторения.
  const nowMs = now.getTime();
  let due: QueueItem[] = [];
  for (const card of Object.values(cards)) {
    const word = byId.get(card.wordId);
    if (!word || !topicAllowed(word, settings)) continue;
    if (!settings.enabledKinds.includes(card.kind)) continue;
    if (card.kind === 'listen' && !ttsAvailable) continue;
    if (new Date(card.due).getTime() <= nowMs) {
      due.push(withCell({ type: 'card', word, kind: card.kind, isNew: false }));
    }
  }
  due = shuffle(due);

  let deferred = 0;
  if (settings.maxReviewsPerDay > 0) {
    const left = Math.max(0, settings.maxReviewsPerDay - today.reviewed);
    if (due.length > left) {
      deferred = due.length - left;
      due = due.slice(0, left);
    }
  }

  // 2. Ступени, открывшиеся у уже начатых слов. Это дёшево — слово знакомое,
  //    поэтому лимит мягче, чем на новые слова, но он всё же нужен:
  //    иначе после «выпуска» большой пачки прилетит лавина.
  const unlockedBudget = Math.max(0, settings.newWordsPerDay * 2 - today.unlocked);
  const unlockedUnits: QueueItem[][] = [];
  for (const word of words) {
    if (unlockedUnits.length >= unlockedBudget) break;
    const started = LADDER.some((k) => cards[cardKey(word.id, k)]);
    if (!started) continue;
    for (const kind of unlockedKinds(word, cards, settings, ttsAvailable)) {
      if (cards[cardKey(word.id, kind)]) continue;
      unlockedUnits.push([withCell({ type: 'card', word, kind, isNew: true })]);
      break; // за раз открываем одному слову только одну новую ступень
    }
  }

  // 3. Совсем новые слова: знакомство + первая карточка.
  const newBudget = Math.max(0, settings.newWordsPerDay - today.newWords);
  const newUnits: QueueItem[][] = [];
  for (const word of words) {
    if (newUnits.length >= newBudget) break;
    const started = LADDER.some((k) => cards[cardKey(word.id, k)]);
    if (started) continue;
    const first = unlockedKinds(word, cards, settings, ttsAvailable)[0];
    if (!first) continue;
    newUnits.push([
      { type: 'intro', word },
      { type: 'card', word, kind: first, isNew: true },
    ]);
  }

  const units = shuffle([...newUnits, ...unlockedUnits]);
  const items = interleave(due, units);

  return {
    items,
    dueCount: due.length,
    newWordCount: newUnits.length,
    unlockedCount: unlockedUnits.length,
    deferred,
  };
}

/**
 * Перемешивание блоками: новые слова распределяются по всей сессии, а не
 * стоят стеной в начале. Порядок внутри блока сохраняется — знакомство
 * всегда идёт перед своей карточкой.
 */
function interleave(reviews: QueueItem[], units: QueueItem[][]): QueueItem[] {
  if (!units.length) return reviews;
  if (!reviews.length) return units.flat();

  const gap = Math.max(1, Math.floor(reviews.length / (units.length + 1)));
  const out: QueueItem[] = [];
  let ri = 0;
  for (const unit of units) {
    for (let i = 0; i < gap && ri < reviews.length; i++) out.push(reviews[ri++]);
    out.push(...unit);
  }
  while (ri < reviews.length) out.push(reviews[ri++]);
  return out;
}

/** Дешёвый подсчёт для главного экрана — без сборки самой очереди. */
export function countPending(
  deck: Deck,
  progress: Progress,
  now: Date,
  ttsAvailable: boolean,
): PlanCounts {
  const plan = buildSession(deck, progress, now, ttsAvailable);
  return {
    due: plan.dueCount,
    newWords: plan.newWordCount,
    unlocked: plan.unlockedCount,
    total: plan.items.filter((i) => i.type === 'card').length,
  };
}

// ─── Упражнения ───────────────────────────────────────────────────────────

/**
 * Отвлекающие варианты для выбора из четырёх. Берём в первую очередь слова
 * той же части речи и темы: различать «стол» и «стул» полезнее,
 * чем «стол» и «понимать».
 */
export function distractors(word: Word, deck: Deck, count: number): Word[] {
  const pool = deck.words.filter((w) => w.id !== word.id && w.ru !== word.ru);
  const tiers = [
    pool.filter((w) => w.pos === word.pos && w.topic === word.topic),
    pool.filter((w) => w.pos === word.pos && w.topic !== word.topic),
    pool,
  ];
  const picked: Word[] = [];
  const seen = new Set<string>();
  for (const tier of tiers) {
    for (const w of shuffle(tier)) {
      if (picked.length >= count) break;
      if (seen.has(w.id)) continue;
      seen.add(w.id);
      picked.push(w);
    }
    if (picked.length >= count) break;
  }
  return picked;
}

/** Греческий и коптский блок + расширенный греческий. */
const GREEK_CLASS = 'Ͱ-Ͽἀ-῿';
const GREEK_LETTER = new RegExp(`[${GREEK_CLASS}]`);
const NON_GREEK = new RegExp(`[^${GREEK_CLASS}]`, 'g');

export interface Cloze {
  before: string;
  /** Форма слова ровно как в предложении — её и ждём в ответе */
  hidden: string;
  after: string;
}

/**
 * Заменяет слово в примере на пропуск. Греческие слова в предложении стоят
 * в изменённой форме, поэтому ищем по общей основе, а не по точному совпадению.
 * Знаки препинания и артикль остаются в видимой части: в пропуск должно
 * попасть одно слово, иначе непонятно, что от тебя хотят.
 */
export function clozeSentence(word: Word): Cloze | null {
  if (!word.example) return null;
  const stemSource = normalizeLoose(word.el);
  const stem = stemSource.slice(0, Math.max(3, stemSource.length - 2));
  const tokens = word.example.split(/(\s+)/);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const bare = normalizeLoose(token).replace(NON_GREEK, '');
    if (!bare || !bare.startsWith(stem)) continue;

    // Отделяем пунктуацию, прилипшую к слову: «ψυγείο.» → «ψυγείο» + «.»
    let start = 0;
    let end = token.length;
    while (start < end && !GREEK_LETTER.test(token[start])) start++;
    while (end > start && !GREEK_LETTER.test(token[end - 1])) end--;

    return {
      before: tokens.slice(0, i).join('') + token.slice(0, start),
      hidden: token.slice(start, end),
      after: token.slice(end) + tokens.slice(i + 1).join(''),
    };
  }
  return null;
}

/**
 * Что произносить.
 *
 * У существительных — вместе с артиклем. Артикль считается частью слова:
 * он показывается в вопросе, требуется в ответе и учитывается в падежах.
 * Если при этом произносить одно «σπίτι», получается расхождение между тем,
 * что слышно, и тем, что написано, — а на карточке аудирования звук вообще
 * единственный источник, и род из него не узнать.
 */
export function spokenForm(word: Word): string {
  return word.pos === 'noun' && word.article ? word.display : word.el;
}

/**
 * Что ждём в поле ввода.
 * Существительные — вместе с артиклем: род выучивается только так.
 * Пропуск в предложении — ту форму, которая реально стоит в тексте:
 * подставлять словарную форму в готовую фразу бессмысленно.
 */
export function expectedAnswer(
  word: Word,
  kind: CardKind,
  settings: Settings,
  cell?: CaseCell,
): string {
  if (kind === 'cloze') {
    const c = clozeSentence(word);
    if (c) return c.hidden;
  }
  if (kind === 'case' && cell) {
    // Артикль здесь не опция: ο → τον → του меняется вместе со словом,
    // и без него упражнение теряет половину смысла.
    const form = cellForm(word, cell);
    if (form) return form;
  }
  if (word.pos === 'noun' && word.article && settings.requireArticle) return word.display;
  return word.el;
}
