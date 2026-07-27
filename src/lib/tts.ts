/**
 * Обёртка над Web Speech API. Почти весь объём здесь — обход багов движков,
 * а не логика: синтез речи в браузерах отказывает молча, без исключений и
 * без событий, поэтому каждый обход подписан причиной.
 */

/** Имя выбранного голоса. Сам объект SpeechSynthesisVoice не кэшируем:
 *  после 'voiceschanged' старые объекты Chrome молча отвергает. */
let chosenVoiceKey: string | null = null;

/** Chrome освобождает utterance сборщиком мусора до начала речи, если на него
 *  никто не ссылается. Короткие слова из-за этого молчат чаще длинных фраз. */
const pendingUtterances = new Set<SpeechSynthesisUtterance>();

/** Safari проигрывает речь, только если до этого был жест пользователя. */
let gestureSeen = false;

/** Сколько ждём onstart, прежде чем считать, что фразу молча выбросили. */
const START_TIMEOUT_MS = 500;

export function supported(): boolean {
  return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function allVoices(): SpeechSynthesisVoice[] {
  return supported() ? speechSynthesis.getVoices() : [];
}

export function greekVoices(): SpeechSynthesisVoice[] {
  return allVoices().filter((v) => v.lang?.toLowerCase().startsWith('el'));
}

const voiceKey = (v: SpeechSynthesisVoice) => `${v.name}|${v.lang}`;

/** Разрешаем голос заново на каждом вызове — по имени, а не по ссылке. */
export function getGreekVoice(): SpeechSynthesisVoice | null {
  const greek = greekVoices();
  if (!greek.length) return null;
  if (chosenVoiceKey) {
    const same = greek.find((v) => voiceKey(v) === chosenVoiceKey);
    if (same) return same;
  }
  // Локальные голоса не требуют сети — важно для офлайн-режима.
  const pick = greek.find((v) => v.localService) ?? greek[0];
  chosenVoiceKey = voiceKey(pick);
  return pick;
}

export function ttsAvailable(): boolean {
  return getGreekVoice() !== null;
}

/**
 * Список голосов в Chrome заполняется асинхронно, поэтому первый вызов
 * getVoices() часто возвращает пустоту. Ждём событие, но не бесконечно.
 */
export function waitForVoices(timeoutMs = 3000): Promise<SpeechSynthesisVoice | null> {
  if (!supported()) return Promise.resolve(null);
  const immediate = getGreekVoice();
  if (immediate) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      speechSynthesis.removeEventListener('voiceschanged', finish);
      resolve(getGreekVoice());
    };
    speechSynthesis.addEventListener('voiceschanged', finish);
    setTimeout(finish, timeoutMs);
  });
}

/**
 * Отмечаем факт жеста, но НИЧЕГО не произносим. Раньше здесь стояла беззвучная
 * фраза из пустой строки — она никогда не завершается и заклинивает очередь:
 * все последующие фразы висят за ней и не звучат.
 */
export function installUnlockHandler() {
  if (!supported()) return;
  // Очередь синтеза живёт в объекте вкладки и переживает перерисовку приложения.
  // Сбрасываем на старте, чтобы застрявшая с прошлого раза фраза не глушила всё.
  try { speechSynthesis.cancel(); } catch { /* неважно */ }
  const mark = () => { gestureSeen = true; };
  document.addEventListener('pointerdown', mark, { once: true });
  document.addEventListener('keydown', mark, { once: true });
}

/** Была ли уже возможность разблокировать синтез — для автопроигрывания. */
export function canAutoSpeak(): boolean {
  return gestureSeen;
}

export interface SpeakHandlers {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (code: string) => void;
  /** Пошаговый след для панели диагностики. */
  onLog?: (line: string) => void;
}

/**
 * Кольцевой журнал последних событий озвучки.
 *
 * Кнопки динамика вызывают speak() без обработчиков, поэтому их след иначе
 * нигде не виден — а именно в реальной работе и всплывают баги вроде двойного
 * проигрывания. Журнал показывается в Настройках → Озвучка → Детали.
 */
const LOG_LIMIT = 60;
const eventLog: { at: number; line: string }[] = [];
let logStart = 0;

export function getRecentEvents(): { ms: number; line: string }[] {
  return eventLog.map((e) => ({ ms: e.at - logStart, line: e.line }));
}

export function clearRecentEvents() {
  eventLog.length = 0;
  logStart = 0;
}

function record(line: string, handlers: SpeakHandlers) {
  const at = Date.now();
  if (!eventLog.length) logStart = at;
  eventLog.push({ at, line });
  if (eventLog.length > LOG_LIMIT) eventLog.shift();
  handlers.onLog?.(line);
}

function synthState(): string {
  if (!supported()) return 'нет API';
  const s = speechSynthesis;
  return `speaking=${s.speaking} pending=${s.pending} paused=${s.paused}`;
}

/** Отложенная попытка произнести и сторожевой таймер текущей фразы. */
let scheduledAttempt = 0;
let activeWatchdog = 0;

function clearOwnTimers() {
  clearTimeout(scheduledAttempt);
  clearTimeout(activeWatchdog);
  scheduledAttempt = 0;
  activeWatchdog = 0;
}

/**
 * Сброс озвучки: свои таймеры — всегда, движок — только если он занят.
 *
 * Двойное проигрывание лечится именно сбросом таймеров: отмена звучащей фразы
 * оставляла запланированный setTimeout живым, и он ставил в очередь вторую.
 * `<StrictMode>` вызывает эффекты по два раза, поэтому дубль был виден всегда.
 *
 * А вот cancel() на простаивающем движке звать НЕЛЬЗЯ: в WebKit он сбрасывает
 * разрешение, выданное жестом пользователя, и следующая автоматическая озвучка
 * молчит, хотя по нажатию кнопки всё работает. Для устранения дублей cancel()
 * и не нужен — достаточно таймеров.
 */
export function stopSpeaking() {
  if (!supported()) return;
  clearOwnTimers();
  const synth = speechSynthesis;
  if (synth.speaking || synth.pending) {
    pendingUtterances.clear();
    try { synth.cancel(); } catch { /* неважно */ }
  }
}

export function speak(text: string, rate = 0.85, handlers: SpeakHandlers = {}) {
  if (!supported()) {
    handlers.onError?.('synthesis-unsupported');
    return;
  }
  const voice = getGreekVoice();
  if (!voice) {
    handlers.onError?.('no-greek-voice');
    return;
  }

  const synth = speechSynthesis;
  record(`старт · ${synthState()} · голос ${voice.name} (${voice.lang})`, handlers);

  // Вызов speak() всегда отменяет всё предыдущее — своё в том числе.
  // Без этого два быстрых вызова (двойное нажатие, повторный эффект)
  // дают две фразы в очереди вместо одной.
  const wasBusy = synth.speaking || synth.pending || scheduledAttempt !== 0;
  if (wasBusy) record('очередь занята — отменяю предыдущее', handlers);
  stopSpeaking();

  if (synth.paused) {
    record('синтез был на паузе — снимаю', handlers);
    synth.resume();
  }

  // cancel() внутри асинхронный: speak() сразу за ним Chrome нередко
  // отменяет вместе с предыдущей фразой. Даём очереди опустеть.
  scheduledAttempt = window.setTimeout(() => {
    scheduledAttempt = 0;
    attempt(text, rate, handlers, 0);
  }, 60);
}

function attempt(text: string, rate: number, handlers: SpeakHandlers, tries: number) {
  const synth = speechSynthesis;
  const voice = getGreekVoice();
  if (!voice) {
    handlers.onError?.('no-greek-voice');
    return;
  }

  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = rate;

  let started = false;
  let myWatchdog = 0;

  // Снимаем только свой таймер: фраза, начавшаяся позже, имеет собственный,
  // и чужой onend не должен его гасить.
  const clearWatchdog = () => {
    clearTimeout(myWatchdog);
    if (activeWatchdog === myWatchdog) activeWatchdog = 0;
  };

  u.onstart = () => {
    started = true;
    clearWatchdog();
    record(`onstart (попытка ${tries + 1})`, handlers);
    handlers.onStart?.();
  };
  u.onend = () => {
    clearWatchdog();
    pendingUtterances.delete(u);
    record('onend', handlers);
    handlers.onEnd?.();
  };
  u.onerror = (e) => {
    clearWatchdog();
    pendingUtterances.delete(u);
    record(`onerror: ${e.error}`, handlers);
    // Прерывание своей же предыдущей фразой — это не ошибка.
    if (e.error === 'canceled' || e.error === 'interrupted') return;
    handlers.onError?.(e.error);
  };

  pendingUtterances.add(u);
  synth.speak(u);
  record(`speak() вызван · ${synthState()}`, handlers);

  // Chrome умеет молча выбросить фразу из очереди, и заметить это можно только
  // по отсутствию onstart. Таймер держим в общей переменной, чтобы
  // stopSpeaking() его снял.
  myWatchdog = window.setTimeout(() => {
    if (activeWatchdog === myWatchdog) activeWatchdog = 0;
    if (started) return;

    // onstart в WebKit приходит не всегда, поэтому одного своего флага мало:
    // спрашиваем сам движок. Если он занят, фраза уже звучит, и повтор дал бы
    // второе проигрывание — ровно тот баг, который эта проверка лечит.
    if (synth.speaking || synth.pending) {
      record('onstart не пришёл, но движок занят — фраза звучит, повтор не нужен', handlers);
      return;
    }

    pendingUtterances.delete(u);
    record(`нет onstart за ${START_TIMEOUT_MS} мс · ${synthState()}`, handlers);
    if (tries === 0) {
      record('повторяю попытку', handlers);
      scheduledAttempt = window.setTimeout(() => {
        scheduledAttempt = 0;
        attempt(text, rate, handlers, tries + 1);
      }, 120);
    } else {
      handlers.onError?.('silent-drop');
    }
  }, START_TIMEOUT_MS);
  activeWatchdog = myWatchdog;
}
