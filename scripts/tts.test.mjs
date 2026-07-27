#!/usr/bin/env node
/**
 * Проверка озвучки на подделке Web Speech API.
 *
 * Смысл теста: в браузере эта логика ведёт себя по-разному в Safari и Chrome,
 * руками её не проверить, а баги здесь случались уже трижды — фраза не звучала
 * совсем, потом звучала дважды, потом перестала звучать автоматически.
 * Подделка считает, сколько фраз реально дошло до движка, и это ровно то,
 * что слышит человек.
 *
 * Запуск: npm run test:tts
 */

let spoken = [];
let cancelled = 0;

/** Как ведёт себя поддельный движок. Меняется под каждый сценарий. */
let behaviour = 'normal';

const synth = {
  speaking: false,
  pending: false,
  paused: false,
  getVoices: () => [{ name: 'Melina', lang: 'el-GR', localService: true }],
  cancel() { cancelled++; this.speaking = false; this.pending = false; },
  resume() {},
  speak(u) {
    spoken.push(u.text);
    if (behaviour === 'silent-drop') return; // фразу молча выбросили
    this.speaking = true;
    if (behaviour !== 'no-onstart') setTimeout(() => u.onstart?.(), 5);
    setTimeout(() => { this.speaking = false; u.onend?.(); }, 900);
  },
  addEventListener() {},
  removeEventListener() {},
};

globalThis.speechSynthesis = synth;
globalThis.SpeechSynthesisUtterance = class {
  constructor(text) { this.text = text; }
};
globalThis.window = globalThis;
globalThis.document = { addEventListener() {}, removeEventListener() {} };

const { speak, stopSpeaking, getRecentEvents, clearRecentEvents } = await import('../src/lib/tts.ts');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
let passed = 0;

function eq(actual, expected, what) {
  if (actual === expected) { passed++; return; }
  failed++;
  console.error(`  ✗ ${what}: получено ${actual}, ожидалось ${expected}`);
  const trace = getRecentEvents().map((e) => `      ${e.ms}мс ${e.line}`).join('\n');
  if (trace) console.error(trace);
}

function scenario(mode) {
  behaviour = mode;
  spoken = [];
  cancelled = 0;
  synth.speaking = false;
  synth.pending = false;
  stopSpeaking();
  clearRecentEvents();
}

// ─── Дубли ────────────────────────────────────────────────────────────────
// Ровно это делает <StrictMode> в разработке: вызывает эффект дважды.
scenario('normal');
speak('καλημέρα');
speak('καλημέρα');
await wait(1200);
eq(spoken.length, 1, 'двойной вызов подряд произносит фразу один раз');

// Настоящее последовательное произнесение подавляться не должно.
scenario('normal');
speak('πρώτο');
await wait(1100);
speak('δεύτερο');
await wait(1100);
eq(spoken.length, 2, 'две фразы с паузой произносятся обе');
eq(spoken[1], 'δεύτερο', 'вторая фраза — та, что просили');

// ─── Сторожевой таймер ────────────────────────────────────────────────────
// Главная причина третьего бага: WebKit не всегда присылает onstart. Если
// судить только по своему флагу, сторож решит, что фразу выбросили, и повторит
// её — человек услышит слово дважды. Спасает опрос самого движка.
scenario('no-onstart');
speak('χωρίς onstart');
await wait(1400);
eq(spoken.length, 1, 'движок говорит без onstart — повтора нет');

// Но если фразу действительно выбросили, повтор обязан случиться.
scenario('silent-drop');
speak('выброшенное');
await wait(1400);
eq(spoken.length, 2, 'выброшенная фраза повторяется один раз');

// ─── Отмена ───────────────────────────────────────────────────────────────
scenario('normal');
speak('παλιό');
stopSpeaking();
speak('νέο');
await wait(1200);
eq(spoken.length, 1, 'после stopSpeaking звучит только новая фраза');
eq(spoken[0], 'νέο', 'звучит именно новая фраза');

scenario('normal');
speak('отменённое');
stopSpeaking();
await wait(300);
eq(spoken.length, 0, 'сброс сразу после вызова не оставляет фразу в очереди');

// В WebKit cancel() на простаивающем движке сбрасывает разрешение, выданное
// жестом пользователя, и автоматическая озвучка замолкает — по кнопке при этом
// всё работает. Поэтому простаивающий движок трогать нельзя.
scenario('normal');
stopSpeaking();
eq(cancelled, 0, 'stopSpeaking не зовёт cancel() на простаивающем движке');

scenario('normal');
speak('первое');
await wait(300);
eq(cancelled, 0, 'одиночный speak() не зовёт cancel() на простаивающем движке');

scenario('normal');
synth.speaking = true;
stopSpeaking();
eq(cancelled, 1, 'занятый движок отменяется');

// ─── Журнал ───────────────────────────────────────────────────────────────
scenario('normal');
speak('для журнала');
await wait(300);
eq(getRecentEvents().length > 0, true, 'события пишутся в журнал без обработчиков');

console.log(`\n${passed} проверок пройдено, ${failed} провалено`);
process.exit(failed ? 1 : 0);
