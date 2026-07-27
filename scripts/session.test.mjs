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

const { spokenForm, expectedAnswer, clozeSentence, drillableCells, cellForm } =
  await import('../src/lib/session.ts');

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

console.log(`\n${passed} проверок пройдено, ${failed} провалено`);
process.exit(failed ? 1 : 0);
