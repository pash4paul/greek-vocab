import { get, set } from 'idb-keyval';
import { DEFAULT_SETTINGS, KIND_SHORT, type Deck, type Progress, type StoredCard } from '../types.ts';
import { humanInterval } from './scheduler.ts';

const KEY = 'greek-vocab:progress';
const BACKUP_KEY = 'greek-vocab:progress:backup';
const PROGRESS_VERSION = 1;

export function emptyProgress(): Progress {
  return {
    version: PROGRESS_VERSION,
    cards: {},
    reviews: [],
    days: {},
    settings: { ...DEFAULT_SETTINGS },
  };
}

function migrate(raw: unknown): Progress {
  const base = emptyProgress();
  if (!raw || typeof raw !== 'object') return base;
  const p = raw as Partial<Progress>;
  return {
    ...base,
    ...p,
    version: PROGRESS_VERSION,
    cards: p.cards ?? {},
    reviews: p.reviews ?? [],
    days: p.days ?? {},
    // Новые настройки, добавленные после того как пользователь сохранил свои,
    // подмешиваем из дефолтов, а не сбрасываем весь объект.
    settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) },
  };
}

export async function loadProgress(): Promise<Progress> {
  try {
    const raw = await get(KEY);
    if (raw) return migrate(raw);
  } catch (e) {
    console.error('IndexedDB недоступна, пробую localStorage', e);
  }
  // Запасной путь: приватный режим Safari блокирует IndexedDB.
  try {
    const ls = localStorage.getItem(BACKUP_KEY);
    if (ls) return migrate(JSON.parse(ls));
  } catch { /* пусто */ }
  return emptyProgress();
}

let pending: Progress | null = null;
let timer: number | undefined;

/** Сохранение с дебаунсом: сессия пишет после каждого ответа. */
export function saveProgress(p: Progress) {
  pending = p;
  if (timer !== undefined) return;
  timer = window.setTimeout(() => {
    timer = undefined;
    const snapshot = pending;
    pending = null;
    if (snapshot) void flush(snapshot);
  }, 400);
}

async function flush(p: Progress) {
  try {
    await set(KEY, p);
  } catch (e) {
    console.error('Не удалось записать в IndexedDB', e);
  }
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(p));
  } catch { /* квота — не критично, основное хранилище IndexedDB */ }
}

/** Немедленная запись — перед закрытием вкладки и перед экспортом. */
export async function flushNow(p: Progress) {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  pending = null;
  await flush(p);
}

/**
 * Бэкап прогресса.
 *
 * Кроме машинной части кладём человекочитаемую сводку и список слов с их
 * состоянием: без неё в файле видны только идентификаторы вида
 * «spiti:noun|recognize» и числа FSRS, и проверить глазами, что бэкап не пустой,
 * невозможно. При импорте эти разделы игнорируются — источник правды один,
 * поле `progress`.
 */
export function exportProgress(p: Progress, deck?: Deck): string {
  const cards = Object.values(p.cards);
  const byWord = new Map<string, StoredCard[]>();
  for (const c of cards) {
    const list = byWord.get(c.wordId) ?? [];
    list.push(c);
    byWord.set(c.wordId, list);
  }

  const titles = new Map((deck?.words ?? []).map((w) => [w.id, w]));
  const words = [...byWord.entries()]
    .map(([id, list]) => {
      const w = titles.get(id);
      const карточки: Record<string, string> = {};
      for (const c of list) {
        const ms = new Date(c.due).getTime() - Date.now();
        карточки[KIND_SHORT[c.kind]] = ms <= 0 ? 'к повторению' : `через ${humanInterval(ms)}`;
      }
      return {
        слово: w?.display ?? id,
        перевод: w?.ru ?? '—',
        карточки,
        ответов: list.reduce((n, c) => n + c.reps, 0),
        ошибок: list.reduce((n, c) => n + c.lapses, 0),
      };
    })
    .sort((a, b) => b.ответов - a.ответов);

  return JSON.stringify({
    app: 'greek-vocab',
    формат: PROGRESS_VERSION,
    сохранено: new Date().toISOString(),
    сводка: {
      'слов начато': byWord.size,
      'карточек': cards.length,
      'в долгой памяти': cards.filter((c) => c.state === 2).length,
      'ответов всего': p.reviews.length,
      'дней занятий': Object.keys(p.days).length,
    },
    слова: words,
    progress: p,
  }, null, 2);
}

export function importProgress(json: string): Progress {
  const parsed = JSON.parse(json);
  const raw = parsed?.progress ?? parsed;
  const p = migrate(raw);
  if (!p.cards || typeof p.cards !== 'object') {
    throw new Error('В файле нет поля cards — это не бэкап прогресса');
  }
  return p;
}
