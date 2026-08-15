#!/usr/bin/env node
// Читает data/*.yaml, валидирует, нормализует и собирает src/generated/deck.json.
// Запускается автоматически перед dev и build; `npm run check` — только валидация.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { slugify, normalize } from '../src/lib/greek.mjs';
import {
  ARTICLES as CASE_ARTICLES, adjectiveForms, conjugatePresent, declineNoun,
  feminineAccusativeArticle,
} from './morphology.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data');
const OUT_FILE = join(ROOT, 'src/generated/deck.json');

const CHECK_ONLY = process.argv.includes('--check');

const POS = ['noun', 'verb', 'adj', 'adv', 'phrase', 'prep', 'pron', 'num', 'conj', 'other'];
const ARTICLES = ['ο', 'η', 'το', 'οι', 'τα'];

/**
 * Клетки, вытянутые из Викисловаря скриптом fetch-declensions.mjs.
 * Используются только там, где правило отказалось выводить форму, и уступают
 * ручному ключу `cases` в yaml. Порядок приоритета: руками > Викисловарь > правила.
 */
function loadWiktionary() {
  const path = join(DATA_DIR, 'declensions.wiktionary.json');
  try {
    return JSON.parse(readFileSync(path, 'utf8')).cells ?? {};
  } catch {
    return {};
  }
}
const WIKTIONARY = loadWiktionary();
let fromWiktionary = 0;

const errors = [];
const warnings = [];
const derived = { verb: 0, adj: 0, noun: 0 };
const mismatches = [];
const declensionGaps = new Map();
const gapWords = [];

function err(file, word, msg) {
  errors.push(`${file}${word ? ` [${word}]` : ''}: ${msg}`);
}
function warn(file, word, msg) {
  warnings.push(`${file}${word ? ` [${word}]` : ''}: ${msg}`);
}

function loadFiles() {
  let files;
  try {
    files = readdirSync(DATA_DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
  } catch {
    return [];
  }
  return files.map((f) => {
    const raw = readFileSync(join(DATA_DIR, f), 'utf8');
    let doc;
    try {
      doc = parse(raw);
    } catch (e) {
      err(f, null, `не парсится YAML — ${e.message}`);
      return null;
    }
    return { file: f, doc };
  }).filter(Boolean);
}

function buildWord(file, topic, lesson, raw, index) {
  const where = raw?.el ?? `#${index + 1}`;

  if (!raw || typeof raw !== 'object') {
    err(file, where, 'запись должна быть объектом с полями el/ru');
    return null;
  }
  if (!raw.el || typeof raw.el !== 'string') {
    err(file, where, 'нет обязательного поля el (греческое слово)');
    return null;
  }
  if (!raw.ru || typeof raw.ru !== 'string') {
    err(file, where, 'нет обязательного поля ru (перевод)');
    return null;
  }

  const pos = raw.pos ?? 'other';
  if (!POS.includes(pos)) {
    err(file, where, `неизвестное pos: "${pos}". Допустимо: ${POS.join(', ')}`);
    return null;
  }

  const el = raw.el.trim();
  let article = raw.article?.trim();

  // Артикль часто пишут слитно со словом — вытаскиваем его в отдельное поле.
  const inline = el.match(/^(ο|η|το|οι|τα)\s+(.+)$/);
  let stem = el;
  if (inline && pos === 'noun') {
    article = article ?? inline[1];
    stem = inline[2];
  }

  if (pos === 'noun') {
    if (!article) {
      warn(file, el, 'существительное без артикля — род не выучится, добавь article: ο|η|το');
    } else if (!ARTICLES.includes(article)) {
      err(file, el, `артикль "${article}" не из списка ${ARTICLES.join('/')}`);
      return null;
    }
  } else if (article) {
    warn(file, el, `article задан для pos: ${pos} — игнорирую`);
    article = undefined;
  }

  const display = article ? `${article} ${stem}` : stem;

  const forms = {};
  const f = raw.forms ?? {};
  if (f.plural) forms.plural = String(f.plural).trim();
  if (f.genitive) forms.genitive = String(f.genitive).trim();
  if (f.present) {
    if (!Array.isArray(f.present) || f.present.length !== 6) {
      err(file, el, 'forms.present должен быть списком из 6 форм: εγώ, εσύ, αυτός, εμείς, εσείς, αυτοί');
      return null;
    }
    forms.present = f.present.map((x) => String(x).trim());
  }
  if (f.gender) {
    if (!Array.isArray(f.gender) || f.gender.length !== 3) {
      err(file, el, 'forms.gender должен быть списком из 3 форм: мужской, женский, средний');
      return null;
    }
    forms.gender = f.gender.map((x) => String(x).trim());
  }
  if (f.past) forms.past = String(f.past).trim();

  const irregular = raw.irregular === true;
  const declension = applyMorphology(file, el, stem, display, pos, article, forms, irregular, raw.cases);

  if (raw.example && !raw.example.includes(' ')) {
    warn(file, el, 'example выглядит как одно слово — для cloze нужно предложение');
  }
  if (raw.example && !containsWord(raw.example, stem)) {
    warn(file, el, 'example не содержит само слово — упражнение «пропуск» будет пропущено');
  }

  return {
    id: `${slugify(stem)}:${pos}`,
    el: stem,
    article,
    display,
    ru: raw.ru.trim(),
    pos,
    forms: Object.keys(forms).length ? forms : undefined,
    declension,
    irregular: irregular || undefined,
    example: raw.example?.trim(),
    exampleRu: raw.exampleRu?.trim(),
    note: raw.note?.trim(),
    topic,
    lesson,
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
  };
}

/**
 * Сверяет формы, записанные вручную, с регулярными парадигмами.
 *
 * Правила не заменяют человека: неправильные слова им не по зубам, и для них
 * есть флаг `irregular: true`. Смысл в другом — ни одно расхождение между
 * человеком и правилом не должно пройти незамеченным. Либо это опечатка,
 * либо слово действительно исключение, и это признаётся явно.
 *
 * Где форм нет вовсе, а правило применимо — форма подставляется,
 * чтобы не писать руками предсказуемое.
 */
function applyMorphology(file, el, stem, display, pos, article, forms, irregular, manualCases) {
  const check = (key, expected, actual, kind) => {
    if (!expected) return;
    if (!actual) {
      forms[key] = expected;
      derived[kind]++;
      return;
    }
    const same = Array.isArray(expected)
      ? expected.length === actual.length && expected.every((v, i) => v === actual[i])
      : expected === actual;
    if (same || irregular) return;
    mismatches.push(
      `${file} [${el}]: ${key} — по правилу «${[expected].flat().join(' · ')}», ` +
      `в файле «${[actual].flat().join(' · ')}». Опечатка? Если слово неправильное, добавь irregular: true`,
    );
  };

  if (pos === 'verb') {
    const r = conjugatePresent(el);
    if (r.forms) check('present', r.forms, forms.present, 'verb');
    else if (!forms.present && !irregular) {
      warn(file, el, `спряжение не выведено: ${r.skip}`);
    }
    return;
  }

  if (pos === 'adj') {
    const r = adjectiveForms(el);
    if (r.forms) check('gender', r.forms, forms.gender, 'adj');
    else if (!forms.gender && !irregular) {
      warn(file, el, `формы по родам не выведены: ${r.skip}`);
    }
    return;
  }

  if (pos === 'noun' && article) {
    const r = declineNoun(stem, article);
    const wordId = `${slugify(stem)}:noun`;
    if (!r.table) {
      // Отказ правила не отменяет того, что вписано руками и найдено
      // в Викисловаре: порядок источников — руками, Викисловарь, правила,
      // и первые два работают сами по себе. Раньше здесь терялось всё:
      // у словосочетаний ключ cases: молча ни на что не влиял.
      if (manualCases || WIKTIONARY[wordId]) {
        return buildDeclension(file, el, display, r, article, manualCases, WIKTIONARY[wordId]);
      }
      if (!forms.plural && !irregular) warn(file, el, `склонение не выведено: ${r.skip}`);
      return undefined;
    }
    check('plural', r.table.nom[1], forms.plural, 'noun');
    return buildDeclension(file, el, display, r, article, manualCases, WIKTIONARY[wordId]);
  }
  return undefined;
}

const CASES = ['nom', 'gen', 'acc', 'voc'];

/**
 * Собирает падежную таблицу уже вместе с артиклями. Артикль меняется по
 * падежам не меньше самого слова (ο → τον → του), и учить их порознь
 * бессмысленно — поэтому в данных они склеены.
 *
 * Клетки, которые правилами не выводятся, остаются null. Их можно заполнить
 * вручную через ключ `cases` в yaml — он же перекрывает выведенное.
 */
function buildDeclension(file, el, display, r, article, manualCases, wiktionary) {
  const arts = CASE_ARTICLES[r.gender];
  // Правило могло отказаться целиком — тогда выведенных клеток просто нет,
  // а руками вписанные и найденные в Викисловаре остаются на своих местах.
  const table = r.table ?? { nom: [], gen: [], acc: [], voc: [] };
  const out = {};

  for (const c of CASES) {
    out[c] = [0, 1].map((num) => {
      const manual = manualCases?.[c]?.[num];
      if (manual) return String(manual).trim();

      const form = table[c][num];
      if (form) {
        let art = arts[c][num];
        // «την» теряет -ν перед мягкими согласными: την πόρτα, но τη μέρα.
        if (art === 'την') art = feminineAccusativeArticle(form);
        return art ? `${art} ${form}` : form;
      }

      // Правило отказалось — берём форму из Викисловаря, если она найдена.
      const wik = wiktionary?.[c]?.[num];
      if (wik) { fromWiktionary++; return wik; }
      return null;
    });
  }

  // Именительный единственного — это сама словарная форма, гадать тут не о чем.
  // Нужно там, где правило отказалось, а Викисловарь дал одни косвенные падежи:
  // у «το κρέας» нашлось «του κρέατος», а сам заголовок остался пустым.
  if (!out.nom[0]) out.nom[0] = display;

  // Звательный во множественном числе всегда совпадает с именительным, только
  // без артикля. Выводим его из итоговой формы, а не из правила: иначе слова
  // с руками вписанным множественным (οι πόλεις) остаются без звательного.
  if (!out.voc[1] && out.nom[1]) {
    out.voc[1] = out.nom[1].replace(/^(οι|τα)\s+/, '');
  }

  if (manualCases) {
    const unknown = Object.keys(manualCases).filter((k) => !CASES.includes(k));
    if (unknown.length) {
      warn(file, el, `в cases неизвестные падежи: ${unknown.join(', ')} (нужны nom/gen/acc/voc)`);
    }
  }
  for (const c of CASES) {
    for (const num of [0, 1]) {
      if (out[c][num]) continue;
      const key = `${c}${num}`;
      declensionGaps.set(key, (declensionGaps.get(key) ?? 0) + 1);
      gapWords.push(`${article} ${el}`);
    }
  }

  return out;
}

// Грубая проверка вхождения: греческие слова в примере склоняются,
// поэтому сверяем по общей основе (без последних двух букв окончания).
function containsWord(sentence, word) {
  const stem = normalize(word).slice(0, Math.max(3, normalize(word).length - 2));
  return normalize(sentence).includes(stem);
}

/**
 * Ищет слова, которые невозможно различить по вопросу.
 *
 * На карточке RU→EL и в подсказке к пропуску видно только перевод. Если весь
 * перевод одного слова целиком входит в перевод другого — «разведённый»
 * против «разведённый, расставшийся», — вопрос допускает два ответа,
 * и правильный из них засчитается ошибкой.
 *
 * Уточнение в скобках считается частью варианта: «перец (овощ)» и «перец
 * (специя)» уже разведены, а «магазин» и «магазин, лавка» — ещё нет.
 */
function ambiguousTranslations(words) {
  const variants = (w) => new Set(
    w.ru.split(/[,;]/).map((v) => v.trim().toLowerCase().replace(/ё/g, 'е')).filter(Boolean),
  );
  const sets = words.map((w) => ({ w, v: variants(w) }));
  const pairs = [];
  for (const a of sets) {
    for (const b of sets) {
      if (a.w === b.w) continue;
      if (![...a.v].every((v) => b.v.has(v))) continue;
      // При полном совпадении наборов пара нашлась бы дважды — оставляем одну
      if (a.v.size === b.v.size && a.w.id > b.w.id) continue;
      pairs.push([a.w, b.w]);
    }
  }
  return pairs;
}

function main() {
  const docs = loadFiles();
  if (!docs.length) {
    console.error('✗ В data/ нет ни одного .yaml файла');
    process.exit(1);
  }

  const words = [];
  const seen = new Map();

  for (const { file, doc } of docs) {
    if (!doc || !Array.isArray(doc.words)) {
      err(file, null, 'ожидается ключ words со списком слов');
      continue;
    }
    const topic = doc.topic?.trim() || basename(file, '.yaml');
    const lesson = doc.lesson != null ? String(doc.lesson) : undefined;

    doc.words.forEach((raw, i) => {
      const w = buildWord(file, topic, lesson, raw, i);
      if (!w) return;
      const prev = seen.get(w.id);
      if (prev) {
        warn(file, w.el, `дубль слова из ${prev.file} (тема «${prev.topic}») — оставляю первое`);
        return;
      }
      seen.set(w.id, { file, topic });
      words.push(w);
    });
  }

  for (const [a, b] of ambiguousTranslations(words)) {
    warn(
      seen.get(a.id).file, a.el,
      `перевод «${a.ru}» не отличить от ${b.el} «${b.ru}» — по вопросу подойдут оба. ` +
      'Разведи уточнением в скобках',
    );
  }

  for (const w of warnings) console.warn(`  ! ${w}`);
  if (mismatches.length) {
    console.warn('\n  Расхождения с правилами словоизменения:');
    for (const m of mismatches) console.warn(`  ⚠ ${m}`);
    console.warn('');
  }
  if (errors.length) {
    console.error(`\n✗ Ошибок: ${errors.length}`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }

  const topics = [...new Set(words.map((w) => w.topic))];
  const deck = { version: 1, builtFrom: docs.map((d) => d.file), topics, words };

  if (!CHECK_ONLY) {
    mkdirSync(dirname(OUT_FILE), { recursive: true });
    writeFileSync(OUT_FILE, JSON.stringify(deck, null, 2) + '\n');
  }

  const withExample = words.filter((w) => w.example).length;
  const withForms = words.filter((w) => w.forms).length;
  const autoTotal = derived.verb + derived.adj + derived.noun;
  console.log(
    `✓ ${words.length} слов · ${topics.length} тем · ${withExample} с примером · ${withForms} с формами` +
    (warnings.length ? ` · предупреждений: ${warnings.length}` : ''),
  );
  if (autoTotal) {
    console.log(
      `  формы выведены по правилам: ${autoTotal} ` +
      `(глаголов ${derived.verb}, прилагательных ${derived.adj}, существительных ${derived.noun})`,
    );
  }
  if (mismatches.length) {
    console.log(`  расхождений с правилами: ${mismatches.length} — см. выше`);
  }
  const declined = words.filter((w) => w.declension).length;
  if (declined) console.log(`  склонение построено: ${declined} существительных`);
  if (fromWiktionary) console.log(`  клеток взято из Викисловаря: ${fromWiktionary}`);
  if (declensionGaps.size) {
    const names = { nom: 'им.', gen: 'род.', acc: 'вин.', voc: 'зв.' };
    const total = [...declensionGaps.values()].reduce((a, b) => a + b, 0);
    const unique = new Set(gapWords).size;
    const parts = [...declensionGaps.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${names[k.slice(0, 3)]} ${k.endsWith('1') ? 'мн.' : 'ед.'} — ${n}`);
    console.log(
      `  пустых клеток склонения: ${total} у ${unique} слов (${parts.join(', ')})\n` +
      '    Это места, где правила нет; заполняются вручную ключом cases: в yaml.',
    );
  }
}

main();
