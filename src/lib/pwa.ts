/**
 * Обновление приложения.
 *
 * Приложение стоит на домашнем экране и по-настоящему не перезапускается:
 * iOS будит его из замороженного состояния, событие `load` при этом не
 * повторяется. Регистрация служебного работника, повешенная на `load`,
 * срабатывает один раз в жизни — и спросить сервер о новой версии больше
 * некому. Так на телефоне неделями крутилась колода недельной давности,
 * причём выглядело это совершенно исправно: слова на месте, ошибок нет,
 * просто примеры старые.
 *
 * Поэтому обновление спрашивается заново каждый раз, когда приложение
 * показывается на экране, и раз в час у тех, кто держит его открытым сутками.
 */
import { registerSW } from 'virtual:pwa-register';

/** Как часто спрашивать сервер, если приложение открыто и о нём не вспоминают. */
const POLL_MS = 60 * 60 * 1000;

let registration: ServiceWorkerRegistration | undefined;

/**
 * Ставит служебного работника и следит за обновлениями.
 * Найденную новую версию `virtual:pwa-register` в режиме `autoUpdate`
 * применяет сам и перезагружает страницу — прогресс это переживает,
 * он сохраняется после каждого ответа, а не в конце занятия.
 */
export function watchForUpdates(): void {
  if (!('serviceWorker' in navigator)) return;

  registerSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      registration = reg;

      // `visibilitychange` вместо `focus`: в standalone-режиме на iOS
      // возвращение к приложению — это именно смена видимости.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void ask();
      });
      setInterval(() => void ask(), POLL_MS);
    },
  });
}

/** Спросить сервер молча. Нет сети — молча же и ничего. */
async function ask(): Promise<void> {
  try {
    await registration?.update();
  } catch {
    // Обновление — не то, ради чего стоит показывать ошибку: в метро
    // сети нет, и это нормально. Следующий раз спросим при возвращении.
  }
}

export type UpdateCheck = 'updating' | 'current' | 'offline' | 'unavailable';

/**
 * Проверка по кнопке из настроек. Отличается от `ask` только тем,
 * что о результате надо доложить: молчаливая проверка неотличима от сломанной.
 */
export async function checkForUpdate(): Promise<UpdateCheck> {
  if (!registration) return 'unavailable';
  try {
    await registration.update();
  } catch {
    return 'offline';
  }
  // Новая версия найдена, если после опроса появился работник, который
  // ставится или ждёт своей очереди. Дальше страница перезагрузится сама.
  return registration.installing || registration.waiting ? 'updating' : 'current';
}

/** Когда собрана эта версия. Подставляется при сборке, см. `vite.config.ts`. */
export function buildTime(): Date {
  return new Date(__BUILD_TIME__);
}
