import { useMemo } from 'react';
import type { Deck, Progress, StoredCard } from '../types.ts';
import { KIND_SHORT } from '../types.ts';
import { State, isLeech } from '../lib/scheduler.ts';
import { dayKey } from '../lib/session.ts';
import { Rating } from '../lib/scheduler.ts';

const FORECAST_DAYS = 14;
const HISTORY_DAYS = 30;

export function Stats({ deck, progress }: { deck: Deck; progress: Progress }) {
  const byId = useMemo(() => new Map(deck.words.map((w) => [w.id, w])), [deck]);
  const cards = useMemo(() => Object.values(progress.cards), [progress]);

  const dist = useMemo(() => {
    const d = { learning: 0, young: 0, mature: 0 };
    for (const c of cards) {
      if (c.state !== State.Review) d.learning++;
      else if (c.scheduled_days < 21) d.young++;
      else d.mature++;
    }
    return d;
  }, [cards]);

  const forecast = useMemo(() => {
    const buckets = new Array(FORECAST_DAYS).fill(0);
    const now = Date.now();
    for (const c of cards) {
      const days = Math.floor((new Date(c.due).getTime() - now) / 86_400_000);
      if (days < 0) buckets[0]++;
      else if (days < FORECAST_DAYS) buckets[days]++;
    }
    return buckets;
  }, [cards]);

  const history = useMemo(() => {
    const out: { key: string; reviewed: number; correct: number }[] = [];
    const cursor = new Date();
    cursor.setDate(cursor.getDate() - (HISTORY_DAYS - 1));
    for (let i = 0; i < HISTORY_DAYS; i++) {
      const k = dayKey(cursor);
      const d = progress.days[k];
      out.push({ key: k, reviewed: d?.reviewed ?? 0, correct: d?.correct ?? 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }, [progress]);

  const retention = useMemo(() => {
    const cutoff = Date.now() - HISTORY_DAYS * 86_400_000;
    // Первое предъявление карточки не характеризует память: слово тогда
    // видели впервые. Удержание считаем только по настоящим повторениям.
    const repeats = progress.reviews.filter(
      (r) => !r.first && new Date(r.at).getTime() >= cutoff,
    );
    if (!repeats.length) return null;
    const ok = repeats.filter((r) => r.rating !== Rating.Again).length;
    return Math.round((ok / repeats.length) * 100);
  }, [progress]);

  const leeches = useMemo(
    () => cards.filter(isLeech).sort((a, b) => b.lapses - a.lapses).slice(0, 20),
    [cards],
  );

  const maxForecast = Math.max(1, ...forecast);
  const maxHistory = Math.max(1, ...history.map((h) => h.reviewed));

  return (
    <div className="stats">
      <h2>Прогресс</h2>

      <div className="tiles">
        <Tile value={dist.learning} label="учатся" />
        <Tile value={dist.young} label="молодые" hint="интервал < 21 дня" />
        <Tile value={dist.mature} label="зрелые" hint="интервал ≥ 21 дня" />
        <Tile value={retention === null ? '—' : `${retention}%`} label="удержание" hint="за 30 дней" />
      </div>

      <section>
        <h3>Нагрузка на ближайшие две недели</h3>
        <div className="chart">
          {forecast.map((n, i) => (
            <div className="chart-col" key={i} title={`${n} карточек`}>
              <div className="chart-bar" style={{ height: `${(n / maxForecast) * 100}%` }} />
              <small>{i === 0 ? 'сег' : i}</small>
            </div>
          ))}
        </div>
        <p className="muted small">
          Ровный график — признак здорового расписания. Пики означают, что в один день
          было введено слишком много слов сразу.
        </p>
      </section>

      <section>
        <h3>Занятия за 30 дней</h3>
        <div className="chart">
          {history.map((h) => (
            <div className="chart-col" key={h.key} title={`${h.key}: ${h.reviewed}`}>
              <div
                className="chart-bar alt"
                style={{ height: `${(h.reviewed / maxHistory) * 100}%` }}
              />
            </div>
          ))}
        </div>
      </section>

      {leeches.length > 0 && (
        <section>
          <h3>Проблемные слова</h3>
          <p className="muted small">
            Забываются снова и снова. Для таких нужен не ещё один повтор, а зацепка:
            созвучие, картинка, живая фраза. Допиши её в поле <code>note</code> в yaml.
          </p>
          <ul className="leech-list">
            {leeches.map((c: StoredCard) => {
              const w = byId.get(c.wordId);
              if (!w) return null;
              return (
                <li key={`${c.wordId}|${c.kind}`}>
                  <span className="greek-sm">{w.display}</span>
                  <span className="muted">{w.ru}</span>
                  <span className="pip leech">{KIND_SHORT[c.kind]} ×{c.lapses}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function Tile({ value, label, hint }: { value: number | string; label: string; hint?: string }) {
  return (
    <div className="tile" title={hint}>
      <b>{value}</b>
      <small>{label}</small>
    </div>
  );
}
