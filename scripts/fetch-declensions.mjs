#!/usr/bin/env node
/**
 * Достаёт таблицы склонения из греческого Викисловаря.
 *
 * Нужен для клеток, которые правилами не выводятся, — прежде всего для
 * родительного падежа множественного числа, где правила нет (πόρτα → πορτών,
 * но μητέρα → μητέρων). Заодно сверяет с Викисловарём то, что правила вывели
 * сами: расхождение означает ошибку либо в правиле, либо в разборе страницы,
 * и в обоих случаях об этом надо знать.
 *
 * Запуск:  npm run fetch:cases            — только слова с пустыми клетками
 *          npm run fetch:cases -- --all   — все существительные (полная сверка)
 *          npm run fetch:cases -- --limit=20
 *
 * Результат кладётся в data/declensions.wiktionary.json и подхватывается
 * сборкой колоды. Ответы кэшируются, повторный запуск сеть не трогает.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DECK = join(ROOT, 'src/generated/deck.json');
const OUT = join(ROOT, 'data/declensions.wiktionary.json');
const CACHE_DIR = join(ROOT, '.cache');
const CACHE = join(CACHE_DIR, 'wiktionary.json');

const API = 'https://el.wiktionary.org/w/api.php';
// Заголовки HTTP обязаны быть ASCII — кириллица здесь роняет fetch.
const UA = 'greek-vocab-deck/0.1 (personal language-learning deck; contact via GitHub)';
const DELAY_MS = 700;  // Викисловарь отдаёт 429 при более частых запросах

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const FETCH_ALL = process.argv.includes('--all');
const LIMIT = Number(arg('limit') ?? Infinity);

const CASE_BY_GREEK = {
  ονομαστική: 'nom',
  γενική: 'gen',
  αιτιατική: 'acc',
  κλητική: 'voc',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadCache() {
  if (!existsSync(CACHE)) return {};
  try { return JSON.parse(readFileSync(CACHE, 'utf8')); } catch { return {}; }
}

function saveCache(c) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE, JSON.stringify(c));
}

/**
 * Уже добытые клетки из прошлых запусков. Проверяются только слова с пустыми
 * клетками, а заполненное Викисловарём пустым больше не выглядит — поэтому без
 * слияния каждый запуск выбрасывал всё, что нашёл предыдущий.
 */
function loadPrevious() {
  if (!existsSync(OUT)) return {};
  try { return JSON.parse(readFileSync(OUT, 'utf8')).cells ?? {}; } catch { return {}; }
}

async function fetchPage(word, retry = 0) {
  const url = `${API}?action=parse&page=${encodeURIComponent(word)}&prop=text&format=json&formatversion=2`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (res.status === 429 && retry < 4) {
    // Отступаем по нарастающей, а не бросаем слово: пропуск оставит клетку пустой.
    await sleep(2000 * (retry + 1));
    return fetchPage(word, retry + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) return null; // страницы нет
  return json.parse?.text ?? null;
}

// Внутри клетки основа и окончание лежат в разных тегах (πόρτ<b>α</b>),
// поэтому теги удаляются без вставки пробела — иначе выйдет «πόρτ α».
const stripTags = (s) => s
  .replace(/<[^>]+>/g, '')
  .replace(/&#160;|&nbsp;/g, ' ')
  .replace(/&#8595;/g, '')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Достаёт из клетки одну форму.
 *
 * Викисловарь кладёт в клетку несколько вариантов, разделяя их <br />:
 * у слов общего рода это «του» и «του/της», у слов с книжной формой —
 * «αρχιτέκτονα» и «αρχιτέκτονος». Берём первую строку: она соответствует
 * основному, разговорному варианту. Без этого варианты склеивались
 * в мусор вида «τουτου/της».
 *
 * Кроме того, редкие формы помечаются «&» и звёздочкой — их отбрасываем.
 */
function cellForm(cellHtml) {
  const first = cellHtml.split(/<br\s*\/?>/i)[0];
  let text = stripTags(first);
  text = text.split('&')[0].replace(/\*/g, '').trim();
  // «ο/η» у слов общего рода — берём первый артикль.
  if (text.includes('/')) text = text.split('/')[0].trim();
  return text;
}

const GREEK_ONLY = /^[Ͱ-Ͽἀ-῿\s]+$/;

/** Разбирает таблицу склонения: строки — падежи, колонки — числа. */
function parseTable(html, headword) {
  if (!html) return null;
  const tables = html.match(/<table[\s\S]*?<\/table>/g) ?? [];
  const table = tables.find((t) => t.includes('πτώσεις'));
  if (!table) return null;

  // Формы разных слов в одной таблице не встречаются, но битый разбор даёт
  // склейки длиннее исходного слова — отсекаем их по длине и алфавиту.
  const plausible = (form) => {
    if (!form || !GREEK_ONLY.test(form)) return null;
    const bare = form.split(/\s+/).pop() ?? '';
    if (bare.length > headword.length + 5) return null;
    return form;
  };

  const out = {};
  for (const row of table.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
    const cells = row.match(/<t[dh][\s\S]*?<\/t[dh]>/g) ?? [];
    if (cells.length < 5) continue;
    const key = CASE_BY_GREEK[stripTags(cells[0]).toLowerCase()];
    if (!key) continue;
    const join = (a, b) => `${cellForm(a)} ${cellForm(b)}`.replace(/\s+/g, ' ').trim();
    out[key] = [plausible(join(cells[1], cells[2])), plausible(join(cells[3], cells[4]))];
  }
  return Object.keys(out).length === 4 ? out : null;
}

async function main() {
  const deck = JSON.parse(readFileSync(DECK, 'utf8'));
  const cache = loadCache();

  const nouns = deck.words.filter((w) => w.pos === 'noun' && w.declension && !w.irregular);
  const hasGap = (w) =>
    ['nom', 'gen', 'acc', 'voc'].some((c) => !w.declension[c][0] || !w.declension[c][1]);

  const targets = (FETCH_ALL ? nouns : nouns.filter(hasGap)).slice(0, LIMIT);
  console.log(`Слов к проверке: ${targets.length}${FETCH_ALL ? ' (все существительные)' : ' (только с пустыми клетками)'}`);

  const result = {};
  const disagreements = [];
  let fromCache = 0, fetched = 0, missing = 0, unparsed = 0, filled = 0;

  for (const [i, w] of targets.entries()) {
    let html = cache[w.el];
    if (html === undefined) {
      try {
        html = await fetchPage(w.el);
      } catch (e) {
        console.warn(`  ! ${w.el}: сеть — ${e.message}`);
        continue;
      }
      cache[w.el] = html;
      fetched++;
      await sleep(DELAY_MS);
      if (fetched % 25 === 0) { saveCache(cache); process.stdout.write(`  …${i + 1}/${targets.length}\n`); }
    } else {
      fromCache++;
    }

    if (!html) { missing++; continue; }
    const table = parseTable(html, w.el);
    if (!table) { unparsed++; continue; }

    const entry = {};
    for (const c of ['nom', 'gen', 'acc', 'voc']) {
      for (const num of [0, 1]) {
        const wik = table[c]?.[num];
        if (!wik) continue;
        const mine = w.declension[c][num];
        if (!mine) {
          entry[c] ??= [null, null];
          entry[c][num] = wik;
          filled++;
        } else if (norm(mine) !== norm(wik)) {
          disagreements.push({ word: w.display, cell: `${c}${num ? 'Pl' : 'Sg'}`, mine, wik });
        }
      }
    }
    if (Object.keys(entry).length) result[w.id] = entry;
  }

  saveCache(cache);

  // Слияние с прошлыми запусками: этот запуск видел только слова с пустыми
  // клетками, остальные надо сохранить как есть.
  const merged = { ...loadPrevious() };
  for (const [id, entry] of Object.entries(result)) {
    merged[id] = { ...merged[id] };
    for (const [c, pair] of Object.entries(entry)) {
      const old = merged[id][c] ?? [null, null];
      merged[id][c] = [pair[0] ?? old[0], pair[1] ?? old[1]];
    }
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    source: 'el.wiktionary.org',
    fetchedWords: Object.keys(merged).length,
    cells: merged,
  }, null, 2) + '\n');

  console.log(
    `\nиз кэша ${fromCache} · загружено ${fetched} · нет статьи ${missing} · без таблицы ${unparsed}`,
  );
  console.log(`заполнено пустых клеток: ${filled} у ${Object.keys(result).length} слов`);

  if (disagreements.length) {
    console.log(`\nРАСХОЖДЕНИЯ С ПРАВИЛАМИ: ${disagreements.length}`);
    console.log('Правила проверены тестами, Викисловарь — нет. Разбирать вручную.\n');
    for (const d of disagreements.slice(0, 40)) {
      console.log(`  ${d.word} · ${d.cell}\n     правило:     ${d.mine}\n     Викисловарь: ${d.wik}`);
    }
    if (disagreements.length > 40) console.log(`  …и ещё ${disagreements.length - 40}`);
  } else {
    console.log('\nРасхождений с правилами нет.');
  }
}

// Викисловарь ставит неразрывные пробелы и иногда «ο/η» вариантами.
const norm = (s) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

main();
