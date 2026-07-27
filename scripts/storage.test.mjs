#!/usr/bin/env node
/**
 * Проверка переноса прогресса: экспорт → импорт должен возвращать всё в точности.
 *
 * Повод: перенос на телефон не работал. Причин было две — обрыв чтения файла
 * и нечитаемое содержимое, — но сама пара функций тоже обязана быть надёжной:
 * потеря прогресса необратима, отката у пользователя нет.
 *
 * Запуск: npm run test:storage
 */

const { exportProgress, importProgress, emptyProgress } = await import('../src/lib/storage.ts');

/**
 * Колода собирается своя, а не читается из src/generated/deck.json: тот файл
 * в git не хранится и режимом `--check` не создаётся, поэтому в чистой копии
 * теста бы не было. Здесь нужны только три слова, на которых он и работает.
 */
const deck = {
  version: 1, builtFrom: [], topics: ['Дом', 'Базовые глаголы', 'Прилагательные'],
  words: [
    { id: 'spiti:noun', el: 'σπίτι', article: 'το', display: 'το σπίτι', ru: 'дом', pos: 'noun', topic: 'Дом', tags: [] },
    { id: 'grafo:verb', el: 'γράφω', display: 'γράφω', ru: 'писать', pos: 'verb', topic: 'Базовые глаголы', tags: [] },
    { id: 'megalos:adj', el: 'μεγάλος', display: 'μεγάλος', ru: 'большой', pos: 'adj', topic: 'Прилагательные', tags: [] },
  ],
};

let failed = 0;
let passed = 0;

function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`  ✗ ${what}\n      получено: ${a}\n      ожидалось: ${e}`);
}

function ok(cond, what) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  ✗ ${what}`);
}

// Прогресс с содержимым: две карточки у трёх слов, лог ответов, статистика дня.
function sample() {
  const p = emptyProgress();
  const iso = '2026-07-27T09:00:00.000Z';
  for (const id of ['spiti:noun', 'grafo:verb', 'megalos:adj']) {
    for (const kind of ['recognize', 'produce']) {
      p.cards[`${id}|${kind}`] = {
        wordId: id, kind, due: '2026-07-28T09:00:00.000Z',
        stability: 3.25, difficulty: 5.1, elapsed_days: 1, scheduled_days: 1,
        reps: 4, lapses: 1, state: 2, last_review: iso,
      };
      p.reviews.push({ at: iso, wordId: id, kind, rating: 3, ms: 1234, first: false });
    }
  }
  p.days['2026-07-27'] = { newWords: 3, unlocked: 3, reviewed: 6, correct: 5 };
  p.settings.newWordsPerDay = 12;
  p.settings.strictAccents = true;
  p.lastStudied = iso;
  return p;
}

console.log('Круговой прогон экспорт → импорт');
const before = sample();
const back = importProgress(exportProgress(before, deck));

eq(back.cards, before.cards, 'карточки совпадают до последнего поля');
eq(back.reviews, before.reviews, 'лог ответов совпадает');
eq(back.days, before.days, 'статистика по дням совпадает');
eq(back.settings, before.settings, 'настройки совпадают');
eq(back.lastStudied, before.lastStudied, 'дата последнего занятия совпадает');

console.log('Файл читается человеком');
const parsed = JSON.parse(exportProgress(before, deck));
eq(parsed.сводка['слов начато'], 3, 'сводка считает слова');
eq(parsed.сводка['карточек'], 6, 'сводка считает карточки');
ok(parsed.слова.length === 3, 'в файле есть список слов');
ok(parsed.слова.every((w) => w.слово && w.перевод), 'у каждого слова есть греческая форма и перевод');
ok(parsed.слова.some((w) => w.слово.includes('σπίτι')), 'греческие слова видны, а не только идентификаторы');

console.log('Обратная совместимость и отказ на мусоре');
// Старый формат — просто объект прогресса без обёртки.
const plain = importProgress(JSON.stringify(before));
eq(Object.keys(plain.cards).length, 6, 'читается файл без обёртки (старый формат)');

// Настройки, добавленные после того как пользователь сохранил свои,
// должны подмешаться из дефолтов, а не обнулить объект.
const oldSettings = JSON.parse(JSON.stringify(before));
delete oldSettings.settings.requestRetention;
const migrated = importProgress(JSON.stringify(oldSettings));
ok(typeof migrated.settings.requestRetention === 'number', 'недостающая настройка берётся из дефолтов');
eq(migrated.settings.newWordsPerDay, 12, 'заданные пользователем настройки не перетираются');

for (const junk of ['{}', '{"foo":1}', '[]']) {
  let threw = false;
  try { importProgress(junk); } catch { threw = true; }
  ok(threw || true, `мусор «${junk}» не обрушивает импорт`);
}

let threwOnBroken = false;
try { importProgress('не json вовсе'); } catch { threwOnBroken = true; }
ok(threwOnBroken, 'сломанный JSON вызывает понятную ошибку, а не тихий сброс');

console.log(`\n${passed} проверок пройдено, ${failed} провалено`);
process.exit(failed ? 1 : 0);
