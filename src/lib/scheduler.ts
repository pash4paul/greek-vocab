import { fsrs, generatorParameters, createEmptyCard, Rating, State, type Card } from 'ts-fsrs';
import type { CardKind, StoredCard } from '../types.ts';

export { Rating, State };

/** Порог, после которого слово считается «проблемным» и требует отдельного разбора. */
export const LEECH_THRESHOLD = 4;

export function makeScheduler(requestRetention: number) {
  return fsrs(
    generatorParameters({
      request_retention: requestRetention,
      // Фазз разводит одинаковые интервалы, чтобы слова, выученные в один день,
      // не всплывали одной глыбой через месяц.
      enable_fuzz: true,
      enable_short_term: true,
    }),
  );
}

export function newCard(wordId: string, kind: CardKind, now: Date): StoredCard {
  return toStored(wordId, kind, createEmptyCard(now));
}

export function toStored(wordId: string, kind: CardKind, c: Card): StoredCard {
  return {
    wordId,
    kind,
    due: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review ? c.last_review.toISOString() : undefined,
  };
}

export function toFsrs(s: StoredCard): Card {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsed_days,
    scheduled_days: s.scheduled_days,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
    last_review: s.last_review ? new Date(s.last_review) : undefined,
  };
}

export function grade(
  scheduler: ReturnType<typeof makeScheduler>,
  card: StoredCard,
  rating: Rating,
  now: Date,
): StoredCard {
  const { card: next } = scheduler.next(toFsrs(card), now, rating as never);
  return toStored(card.wordId, card.kind, next);
}

/** Что будет с карточкой при каждой из оценок — для подписей на кнопках. */
export function previewIntervals(
  scheduler: ReturnType<typeof makeScheduler>,
  card: StoredCard,
  now: Date,
): Record<Rating, string> {
  const out = {} as Record<Rating, string>;
  for (const r of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) {
    const { card: next } = scheduler.next(toFsrs(card), now, r as never);
    out[r] = humanInterval(next.due.getTime() - now.getTime());
  }
  return out;
}

export function humanInterval(ms: number): string {
  const min = ms / 60000;
  if (min < 1) return '<1 мин';
  if (min < 60) return `${Math.round(min)} мин`;
  const hours = min / 60;
  if (hours < 24) return `${Math.round(hours)} ч`;
  const days = hours / 24;
  if (days < 31) return `${Math.round(days)} дн`;
  const months = days / 30.44;
  if (months < 12) return `${months.toFixed(months < 3 ? 1 : 0)} мес`;
  return `${(days / 365.25).toFixed(1)} г`;
}

/** Карточка «выпустилась» из обучения — можно открывать следующую ступень. */
export function isGraduated(card: StoredCard | undefined): boolean {
  return !!card && card.state === State.Review;
}

export function isLeech(card: StoredCard): boolean {
  return card.lapses >= LEECH_THRESHOLD;
}
