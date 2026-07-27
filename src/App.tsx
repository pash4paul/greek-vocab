import { useCallback, useEffect, useMemo, useState } from 'react';
import deckJson from './generated/deck.json';
import type { CardKind, Deck, Progress, Word } from './types.ts';
import { CARD_KINDS, cardKey } from './types.ts';
import { flushNow, loadProgress, saveProgress } from './lib/storage.ts';
import { Rating, grade, makeScheduler, newCard } from './lib/scheduler.ts';
import { buildSession, dayKey, emptyDay, type SessionPlan } from './lib/session.ts';
import { installUnlockHandler, waitForVoices } from './lib/tts.ts';
import { Home } from './components/Home.tsx';
import { Session } from './components/Session.tsx';
import { WordList } from './components/WordList.tsx';
import { Stats } from './components/Stats.tsx';
import { SettingsView } from './components/SettingsView.tsx';

const deck = deckJson as Deck;

export type View = 'home' | 'session' | 'words' | 'stats' | 'settings';

export default function App() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [view, setView] = useState<View>('home');
  const [plan, setPlan] = useState<SessionPlan | null>(null);
  const [tts, setTts] = useState(false);

  useEffect(() => {
    void loadProgress().then(setProgress);
    installUnlockHandler();
    void waitForVoices().then((v) => setTts(!!v));
  }, []);

  // Закрытие вкладки посреди сессии не должно съедать последние ответы.
  useEffect(() => {
    const onHide = () => { if (progress) void flushNow(progress); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, [progress]);

  const update = useCallback((fn: (p: Progress) => Progress) => {
    setProgress((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      saveProgress(next);
      return next;
    });
  }, []);

  const handleAnswer = useCallback(
    (word: Word, kind: CardKind, rating: Rating, ms: number) => {
      const now = new Date();
      update((prev) => {
        const key = cardKey(word.id, kind);
        const existing = prev.cards[key];
        const scheduler = makeScheduler(prev.settings.requestRetention);
        const base = existing ?? newCard(word.id, kind, now);
        const updated = grade(scheduler, base, rating, now);

        const dk = dayKey(now);
        const day = { ...(prev.days[dk] ?? emptyDay()) };
        day.reviewed += 1;
        if (rating !== Rating.Again) day.correct += 1;
        // Считаем «новым» только первое появление карточки: возврат внутри
        // сессии после «Не помню» не должен съедать дневной лимит.
        if (!existing) {
          const hadOthers = CARD_KINDS.some((k) => prev.cards[cardKey(word.id, k)]);
          if (hadOthers) day.unlocked += 1;
          else day.newWords += 1;
        }

        return {
          ...prev,
          cards: { ...prev.cards, [key]: updated },
          reviews: [
            ...prev.reviews.slice(-19999),
            { at: now.toISOString(), wordId: word.id, kind, rating, ms, first: !existing },
          ],
          days: { ...prev.days, [dk]: day },
          lastStudied: now.toISOString(),
        };
      });
    },
    [update],
  );

  const counts = useMemo(() => {
    if (!progress) return null;
    const p = buildSession(deck, progress, new Date(), tts);
    return {
      due: p.dueCount,
      newWords: p.newWordCount,
      unlocked: p.unlockedCount,
      total: p.items.filter((i) => i.type === 'card').length,
      deferred: p.deferred,
    };
  }, [progress, tts]);

  const startSession = () => {
    if (!progress) return;
    const p = buildSession(deck, progress, new Date(), tts);
    setPlan(p);
    setView('session');
  };

  if (!progress) {
    return <div className="loading">Загрузка…</div>;
  }

  if (view === 'session' && plan) {
    return (
      <Session
        deck={deck}
        progress={progress}
        plan={plan}
        onAnswer={handleAnswer}
        onExit={() => { setPlan(null); setView('home'); }}
      />
    );
  }

  return (
    <div className="app">
      <main className="content">
        {view === 'home' && (
          <Home deck={deck} progress={progress} counts={counts!} tts={tts} onStart={startSession} />
        )}
        {view === 'words' && <WordList deck={deck} progress={progress} />}
        {view === 'stats' && <Stats deck={deck} progress={progress} />}
        {view === 'settings' && (
          <SettingsView
            deck={deck}
            progress={progress}
            tts={tts}
            onChange={(settings) => update((p) => ({ ...p, settings }))}
            onReplace={(p) => { setProgress(p); void flushNow(p); }}
          />
        )}
      </main>

      <nav className="tabs">
        {([
          ['home', 'Учить', '◎'],
          ['words', 'Слова', '☰'],
          ['stats', 'Прогресс', '▲'],
          ['settings', 'Настройки', '⚙'],
        ] as const).map(([v, label, icon]) => (
          <button
            key={v}
            className={`tab ${view === v ? 'active' : ''}`}
            onClick={() => setView(v)}
          >
            <span className="tab-icon">{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
