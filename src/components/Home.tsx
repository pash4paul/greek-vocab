import { useMemo } from 'react';
import type { Deck, Progress } from '../types.ts';
import { CARD_KINDS, cardKey } from '../types.ts';
import { State } from '../lib/scheduler.ts';
import { dayKey } from '../lib/session.ts';

interface Counts {
  due: number;
  newWords: number;
  unlocked: number;
  total: number;
  deferred: number;
}

export function Home({
  deck, progress, counts, tts, onStart,
}: { deck: Deck; progress: Progress; counts: Counts; tts: boolean; onStart: () => void }) {
  const streak = useMemo(() => computeStreak(progress), [progress]);
  const today = progress.days[dayKey(new Date())];

  const known = useMemo(() => {
    let started = 0;
    let review = 0;
    for (const w of deck.words) {
      const cards = CARD_KINDS.map((k) => progress.cards[cardKey(w.id, k)]).filter(Boolean);
      if (!cards.length) continue;
      started++;
      if (cards.some((c) => c!.state === State.Review)) review++;
    }
    return { started, review };
  }, [deck, progress]);

  const nothingToDo = counts.total === 0;

  return (
    <div className="home">
      <header className="home-head">
        <div>
          <h1>Ελληνικά</h1>
          <p className="muted">
            {known.review} из {deck.words.length} слов в долгой памяти
          </p>
        </div>
        {streak > 0 && (
          <div className="streak" title="Дней подряд">
            <b>{streak}</b>
            <small>{plural(streak, 'день', 'дня', 'дней')}</small>
          </div>
        )}
      </header>

      <div className="today-card">
        <div className="today-row">
          <Metric value={counts.due} label="повторить" tone="due" />
          <Metric value={counts.newWords} label="новых слов" tone="new" />
          <Metric value={counts.unlocked} label="новых типов" tone="unlock" />
        </div>

        <button className="btn primary huge" onClick={onStart} disabled={nothingToDo}>
          {nothingToDo ? 'На сегодня всё' : `Заниматься · ${counts.total}`}
        </button>

        {nothingToDo && (
          <p className="muted small">
            Все повторения сделаны, дневной лимит новых слов исчерпан.
            Хочешь больше — подними лимит в настройках.
          </p>
        )}
        {counts.deferred > 0 && (
          <p className="muted small">
            Ещё {counts.deferred} повторений отложено дневным лимитом.
          </p>
        )}
      </div>

      {today && today.reviewed > 0 && (
        <p className="muted small center">
          Сегодня: {today.reviewed} ответов, {Math.round((today.correct / today.reviewed) * 100)}% верных
        </p>
      )}

      <div className="progress-strip">
        <Bar
          label="Начато"
          value={known.started}
          total={deck.words.length}
        />
        <Bar
          label="В долгой памяти"
          value={known.review}
          total={deck.words.length}
        />
      </div>

      {!tts && progress.settings.enabledKinds.includes('listen') && (
        <p className="warn">
          Греческий голос в системе не найден — упражнения на слух пропускаются.
          На macOS: Системные настройки → Универсальный доступ → Устная речь → Системный голос → Добавить → Greek.
        </p>
      )}
    </div>
  );
}

function Metric({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className={`metric ${tone} ${value === 0 ? 'zero' : ''}`}>
      <b>{value}</b>
      <small>{label}</small>
    </div>
  );
}

function Bar({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total ? (value / total) * 100 : 0;
  return (
    <div className="bar-row">
      <div className="bar-label">
        <span>{label}</span>
        <span className="muted">{value} / {total}</span>
      </div>
      <div className="bar"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/** Дней подряд с занятиями. Разрыв допускается только «сегодня ещё не занимался». */
function computeStreak(progress: Progress): number {
  const active = new Set(
    Object.entries(progress.days).filter(([, d]) => d.reviewed > 0).map(([k]) => k),
  );
  if (!active.size) return 0;
  const cursor = new Date();
  if (!active.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let n = 0;
  while (active.has(dayKey(cursor))) {
    n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
