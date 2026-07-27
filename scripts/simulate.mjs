#!/usr/bin/env node
// Прогон 60 учебных дней по реальной колоде: проверяет, что лестница карточек
// открывается, дневная нагрузка не взрывается и планировщик не зацикливается.
// Запуск: npm run simulate [-- --days=60 --accuracy=0.85]

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSession, dayKey, emptyDay } from '../src/lib/session.ts';
import { grade, makeScheduler, newCard, Rating, State } from '../src/lib/scheduler.ts';
import { CARD_KINDS, DEFAULT_SETTINGS, cardKey } from '../src/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const deck = JSON.parse(readFileSync(join(ROOT, 'src/generated/deck.json'), 'utf8'));

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : fallback;
};

const DAYS = arg('days', 60);
const ACCURACY = arg('accuracy', 0.85);

const progress = {
  version: 1,
  cards: {},
  reviews: [],
  days: {},
  settings: { ...DEFAULT_SETTINGS },
};

const scheduler = makeScheduler(progress.settings.requestRetention);
let clock = new Date('2026-01-05T09:00:00');
const log = [];
let maxSession = 0;

for (let day = 0; day < DAYS; day++) {
  const plan = buildSession(deck, progress, clock, true);
  const cards = plan.items.filter((i) => i.type === 'card');
  maxSession = Math.max(maxSession, cards.length);

  let guard = 0;
  const queue = [...cards];
  while (queue.length) {
    if (++guard > 5000) throw new Error(`День ${day}: очередь не сходится`);
    const item = queue.shift();
    const key = cardKey(item.word.id, item.kind);
    const existing = progress.cards[key];
    const base = existing ?? newCard(item.word.id, item.kind, clock);

    // Новое и «трудное» вспоминается хуже — грубо, но достаточно, чтобы
    // проверить, что повторные провалы не ломают расписание.
    const penalty = base.state === State.New ? 0.25 : 0;
    const ok = Math.random() < ACCURACY - penalty;
    const rating = ok
      ? (Math.random() < 0.2 ? Rating.Easy : Rating.Good)
      : Rating.Again;

    progress.cards[key] = grade(scheduler, base, rating, clock);

    const dk = dayKey(clock);
    const d = progress.days[dk] ?? emptyDay();
    d.reviewed++;
    if (rating !== Rating.Again) d.correct++;
    if (!existing) {
      const hadOthers = CARD_KINDS.some((k) => progress.cards[cardKey(item.word.id, k)] && k !== item.kind);
      if (hadOthers) d.unlocked++; else d.newWords++;
    }
    progress.days[dk] = d;

    if (rating === Rating.Again) queue.push(item);
    clock = new Date(clock.getTime() + 8000);
  }

  log.push({ day: day + 1, ...countStates(), session: cards.length, due: plan.dueCount, neu: plan.newWordCount });
  clock = new Date(clock);
  clock.setDate(clock.getDate() + 1);
  clock.setHours(9, 0, 0, 0);
}

function countStates() {
  const all = Object.values(progress.cards);
  return {
    cards: all.length,
    review: all.filter((c) => c.state === State.Review).length,
    words: new Set(all.map((c) => c.wordId)).size,
  };
}

console.log('день  сессия   due   новых | карточек  в Review  слов затронуто');
for (const r of log) {
  if (r.day % 5 !== 0 && r.day !== 1 && r.day !== DAYS) continue;
  console.log(
    String(r.day).padStart(4),
    String(r.session).padStart(7),
    String(r.due).padStart(5),
    String(r.neu).padStart(6),
    '|',
    String(r.cards).padStart(8),
    String(r.review).padStart(9),
    String(r.words).padStart(14),
  );
}

const kinds = {};
for (const c of Object.values(progress.cards)) kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;

console.log('\nКарточек по типам:', kinds);
console.log('Пик сессии:', maxSession, 'карточек');
console.log('Слов затронуто:', countStates().words, 'из', deck.words.length);

const problems = [];
if (maxSession > 200) problems.push(`сессия разрослась до ${maxSession} карточек`);
if (!kinds.produce) problems.push('ступень «ввод» так и не открылась');
if (!kinds.cloze) problems.push('ступень «пропуск» так и не открылась');
if (!kinds.case) problems.push('ступень «падежи» так и не открылась');

if (problems.length) {
  console.error('\n✗ ' + problems.join('\n✗ '));
  process.exit(1);
}
console.log('\n✓ Лестница разворачивается, нагрузка в норме');
