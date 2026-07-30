#!/usr/bin/env node
/**
 * Проверка того, что артикль ведёт себя одинаково во всех упражнениях.
 *
 * Повод: артикль показывался везде, а произносился нигде — все вызовы озвучки
 * передавали `el` вместо `display`. На карточке аудирования это особенно плохо:
 * звук там единственный источник, и род из «σπίτι» не узнать.
 *
 * Колода собирается своя: src/generated/deck.json в git не хранится,
 * и режим `--check` его не создаёт.
 *
 * Запуск: npm run test:session
 */

const { spokenForm, expectedAnswer, clozeSentence, drillableCells, cellForm, buildSession } =
  await import('../src/lib/session.ts');
const { CASES, DEFAULT_SETTINGS } = await import('../src/types.ts');

let failed = 0;
let passed = 0;

function eq(actual, expected, what) {
  if (String(actual) === String(expected)) { passed++; return; }
  failed++;
  console.error(`  ✗ ${what}\n      получено: ${actual}\n      ожидалось: ${expected}`);
}

const settings = { requireArticle: true, strictAccents: false };
const loose = { requireArticle: false, strictAccents: false };

const noun = {
  id: 'spiti:noun', el: 'σπίτι', article: 'το', display: 'το σπίτι', ru: 'дом',
  pos: 'noun', topic: 'Дом', tags: [],
  example: 'Το σπίτι μου είναι μικρό.',
  declension: {
    nom: ['το σπίτι', 'τα σπίτια'],
    gen: ['του σπιτιού', 'των σπιτιών'],
    acc: ['το σπίτι', 'τα σπίτια'],
    voc: ['σπίτι', 'σπίτια'],
  },
};
const feminine = { ...noun, id: 'porta:noun', el: 'πόρτα', article: 'η', display: 'η πόρτα', ru: 'дверь', example: 'Η πόρτα είναι ανοιχτή.', declension: undefined };
const verb = { id: 'grafo:verb', el: 'γράφω', display: 'γράφω', ru: 'писать', pos: 'verb', topic: 'Глаголы', tags: [] };
const adj = { id: 'megalos:adj', el: 'μεγάλος', display: 'μεγάλος', ru: 'большой', pos: 'adj', topic: 'Прил.', tags: [] };
const phrase = { id: 'kalimera:phrase', el: 'καλημέρα', display: 'καλημέρα', ru: 'доброе утро', pos: 'phrase', topic: 'Приветствия', tags: [] };
const noArticle = { ...noun, id: 'x:noun', article: undefined, display: 'σπίτι', declension: undefined };

console.log('Озвучка существительных идёт вместе с артиклем');
eq(spokenForm(noun), 'το σπίτι', 'средний род');
eq(spokenForm(feminine), 'η πόρτα', 'женский род');
eq(spokenForm(noArticle), 'σπίτι', 'существительное без артикля — как есть');

console.log('Остальные части речи артикля не получают');
eq(spokenForm(verb), 'γράφω', 'глагол');
eq(spokenForm(adj), 'μεγάλος', 'прилагательное');
eq(spokenForm(phrase), 'καλημέρα', 'фраза');

console.log('Ввод RU→EL требует артикль');
eq(expectedAnswer(noun, 'produce', settings), 'το σπίτι', 'с включённым требованием артикля');
eq(expectedAnswer(noun, 'produce', loose), 'σπίτι', 'с выключенным — без артикля');
eq(expectedAnswer(verb, 'produce', settings), 'γράφω', 'у глагола артикля нет ни при каких настройках');

console.log('В пропуске артикль остаётся в видимой части предложения');
const c = clozeSentence(noun);
eq(c.hidden, 'σπίτι', 'в пропуск попадает только само слово');
eq(c.before.trim(), 'Το', 'артикль виден перед пропуском');
eq(expectedAnswer(noun, 'cloze', settings), 'σπίτι', 'в ответе артикль не нужен — он уже на экране');

console.log('Падежи спрашиваются вместе с артиклем');
const cells = drillableCells(noun);
eq(cells.length > 0, 'true', 'есть что спрашивать');
for (const cell of cells) {
  const form = cellForm(noun, cell);
  const ждём = expectedAnswer(noun, 'case', settings, cell);
  eq(ждём, form, `${cell.case}${cell.number ? ' мн.' : ' ед.'} — ответ совпадает с клеткой таблицы`);
  // Звательный артикля не имеет, остальные падежи — имеют.
  const сАртиклем = /^(το|τα|του|των)\s/.test(form);
  eq(cell.case === 'voc' ? !сАртиклем : сАртиклем, 'true',
    `${cell.case} — артикль ${cell.case === 'voc' ? 'отсутствует' : 'на месте'}`);
}

console.log('Отключённый падеж не попадает в вопросы');
const withoutGen = CASES.filter((c) => c !== 'gen');
const cellsNoGen = drillableCells(noun, withoutGen);
eq(cellsNoGen.some((cell) => cell.case === 'gen'), 'false', 'родительного среди клеток нет');
eq(cellsNoGen.length > 0, 'true', 'остальные клетки остались на месте');
eq(DEFAULT_SETTINGS.enabledCases.includes('gen'), 'false', 'по умолчанию родительный выключен');

// Слово, у которого от исходной формы отличается только родительный:
// с выключенным родительным спрашивать у него нечего вообще.
const onlyGen = {
  ...noun, id: 'gala:noun', el: 'γάλα', display: 'το γάλα', ru: 'молоко',
  declension: {
    nom: ['το γάλα', null],
    gen: ['του γάλακτος', null],
    acc: ['το γάλα', null],
    voc: [null, null],
  },
};
eq(drillableCells(onlyGen, CASES).length > 0, 'true', 'с родительным клетка есть');
eq(drillableCells(onlyGen, withoutGen).length, 0, 'без родительного клеток не остаётся');

// Карточка могла быть создана, когда падеж был включён. Она не должна всплывать
// в сессии пустым вопросом — её надо просто не показывать.
const stale = (wordId) => ({
  wordId, kind: 'case', due: '2026-01-01T00:00:00.000Z',
  stability: 10, difficulty: 5, elapsed_days: 0, scheduled_days: 10,
  reps: 3, lapses: 0, state: 2,
});
const plan = buildSession(
  { version: 1, builtFrom: [], topics: ['Дом'], words: [noun, onlyGen] },
  {
    version: 1,
    cards: { 'spiti:noun|case': stale('spiti:noun'), 'gala:noun|case': stale('gala:noun') },
    reviews: [], days: {}, settings: { ...DEFAULT_SETTINGS },
  },
  new Date('2026-07-30T10:00:00.000Z'),
  true,
);
const caseItems = plan.items.filter((i) => i.type === 'card' && i.kind === 'case');
eq(caseItems.length, 1, 'в сессию попала только карточка, которой есть что спросить');
eq(caseItems[0].word.id, 'spiti:noun', 'и это не слово с одним родительным');
eq(caseItems.every((i) => i.cell && i.cell.case !== 'gen'), 'true',
  'у каждой падежной карточки есть клетка, и она не родительная');

console.log(`\n${passed} проверок пройдено, ${failed} провалено`);
process.exit(failed ? 1 : 0);
