import { get, set } from 'idb-keyval';
import { DEFAULT_SETTINGS, type Progress } from '../types.ts';

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

export function exportProgress(p: Progress): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), progress: p }, null, 2);
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
