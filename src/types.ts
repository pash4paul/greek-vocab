export type Pos =
  | 'noun' | 'verb' | 'adj' | 'adv' | 'phrase' | 'prep' | 'pron' | 'num' | 'other';

export interface WordForms {
  plural?: string;
  genitive?: string;
  past?: string;
  /** 6 форм настоящего времени: εγώ, εσύ, αυτός, εμείς, εσείς, αυτοί */
  present?: string[];
  /** 3 рода: мужской, женский, средний */
  gender?: string[];
}

export type GrammCase = 'nom' | 'gen' | 'acc' | 'voc';

export const CASES: GrammCase[] = ['nom', 'gen', 'acc', 'voc'];

export const CASE_LABEL: Record<GrammCase, string> = {
  nom: 'именительный',
  gen: 'родительный',
  acc: 'винительный',
  voc: 'звательный',
};

export const CASE_SHORT: Record<GrammCase, string> = {
  nom: 'им.', gen: 'род.', acc: 'вин.', voc: 'зв.',
};

/**
 * Формы уже вместе с артиклем: [ед. ч., мн. ч.].
 * null — клетка, которую правила не выводят и никто не заполнил руками.
 */
export type Declension = Record<GrammCase, [string | null, string | null]>;

/** Конкретная клетка таблицы — то, что спрашивает упражнение на падежи. */
export interface CaseCell {
  case: GrammCase;
  /** 0 — единственное, 1 — множественное */
  number: 0 | 1;
}

export interface Word {
  id: string;
  el: string;
  article?: string;
  /** el вместе с артиклем — то, что показываем и ждём в ответе */
  display: string;
  ru: string;
  pos: Pos;
  forms?: WordForms;
  declension?: Declension;
  /** Формы не подчиняются регулярным правилам — задавались вручную */
  irregular?: boolean;
  example?: string;
  exampleRu?: string;
  note?: string;
  topic: string;
  lesson?: string;
  tags: string[];
}

export interface Deck {
  version: number;
  builtFrom: string[];
  topics: string[];
  words: Word[];
}

/** Направления, в которых слово может проверяться. Каждое живёт своим графиком. */
export type CardKind = 'recognize' | 'produce' | 'listen' | 'cloze' | 'case';

export const CARD_KINDS: CardKind[] = ['recognize', 'produce', 'listen', 'cloze', 'case'];

export const KIND_LABEL: Record<CardKind, string> = {
  recognize: 'Узнавание EL→RU',
  produce: 'Ввод RU→EL',
  listen: 'Аудирование',
  cloze: 'Пропуск в предложении',
  case: 'Падежи существительных',
};

export const KIND_SHORT: Record<CardKind, string> = {
  recognize: 'EL→RU',
  produce: 'RU→EL',
  listen: '🔊',
  cloze: '␣',
  case: 'пад.',
};

/** Состояние FSRS-карточки в сериализуемом виде (даты — ISO-строки). */
export interface StoredCard {
  wordId: string;
  kind: CardKind;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  /** 0 New · 1 Learning · 2 Review · 3 Relearning */
  state: number;
  last_review?: string;
}

export interface ReviewEntry {
  /** ISO-время ответа */
  at: string;
  wordId: string;
  kind: CardKind;
  rating: number;
  /** миллисекунды на ответ */
  ms: number;
  /** Первое в жизни предъявление карточки — не участвует в подсчёте удержания */
  first?: boolean;
}

export interface DayStats {
  newWords: number;
  unlocked: number;
  reviewed: number;
  correct: number;
}

export interface Settings {
  newWordsPerDay: number;
  /** 0 — без ограничения */
  maxReviewsPerDay: number;
  enabledKinds: CardKind[];
  /** Падежи, которые спрашивает упражнение на падежи */
  enabledCases: GrammCase[];
  /** true — ошибка в ударении засчитывается как неверный ответ */
  strictAccents: boolean;
  /** требовать артикль при вводе существительных */
  requireArticle: boolean;
  ttsRate: number;
  autoPlayAudio: boolean;
  /** пустой массив — все темы */
  enabledTopics: string[];
  requestRetention: number;
}

export interface Progress {
  version: number;
  cards: Record<string, StoredCard>;
  reviews: ReviewEntry[];
  days: Record<string, DayStats>;
  settings: Settings;
  /** ISO-дата последней сессии — для стрика */
  lastStudied?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  newWordsPerDay: 8,
  maxReviewsPerDay: 0,
  enabledKinds: ['recognize', 'produce', 'listen', 'cloze', 'case'],
  // Родительный выключен: по учебнику он ещё не проходился, а формы его
  // самые непредсказуемые. Включается в настройках, когда дойдёт очередь.
  enabledCases: ['nom', 'acc', 'voc'],
  strictAccents: false,
  requireArticle: true,
  ttsRate: 0.85,
  autoPlayAudio: true,
  enabledTopics: [],
  requestRetention: 0.9,
};

export const cardKey = (wordId: string, kind: CardKind) => `${wordId}|${kind}`;
