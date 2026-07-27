import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CardKind, Deck, Progress, StoredCard, Word } from '../types.ts';
import { cardKey } from '../types.ts';
import {
  cellLabel, clozeSentence, distractors, expectedAnswer,
  type QueueItem, type SessionPlan,
} from '../lib/session.ts';
import { Rating, State, makeScheduler, newCard, previewIntervals } from '../lib/scheduler.ts';
import { compareAnswer } from '../lib/greek.mjs';
import { canAutoSpeak, speak, stopSpeaking } from '../lib/tts.ts';
import { GreekKeyboard } from './GreekKeyboard.tsx';
import { WordDetails } from './WordDetails.tsx';

interface Props {
  deck: Deck;
  progress: Progress;
  plan: SessionPlan;
  onAnswer: (word: Word, kind: CardKind, rating: Rating, ms: number) => void;
  onExit: () => void;
}

type Phase = 'question' | 'answer';

/** На сколько позиций вперёд возвращаем карточку, отвеченную «Не помню». */
const RELAPSE_GAP = 5;

export function Session({ deck, progress, plan, onAnswer, onExit }: Props) {
  const [queue, setQueue] = useState<QueueItem[]>(plan.items);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('question');
  const [input, setInput] = useState('');
  const [verdict, setVerdict] = useState<'exact' | 'accent' | 'wrong' | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [done, setDone] = useState({ answered: 0, correct: 0 });
  const startedAt = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  const item = queue[index];
  const scheduler = useMemo(
    () => makeScheduler(progress.settings.requestRetention),
    [progress.settings.requestRetention],
  );

  // Состояние карточки фиксируем на момент показа. После ответа progress
  // обновится, но подписи на кнопках должны остаться от старого состояния —
  // поэтому зависимость только от позиции в очереди.
  const card: StoredCard | null = useMemo(() => {
    if (!item || item.type !== 'card') return null;
    return (
      progress.cards[cardKey(item.word.id, item.kind)] ??
      newCard(item.word.id, item.kind, new Date())
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Узнавание и аудирование в начале идут выбором из четырёх: набирать перевод
  // слова, увиденного минуту назад, бессмысленно. Зрелые карточки — самооценка.
  const useChoices =
    !!card && (item?.type === 'card') &&
    (item.kind === 'recognize' || item.kind === 'listen') &&
    card.state !== State.Review;

  const isTyping =
    item?.type === 'card' &&
    (item.kind === 'produce' || item.kind === 'cloze' || item.kind === 'case');

  const choices = useMemo(() => {
    if (!item || item.type !== 'card' || !useChoices) return [];
    const opts = [item.word, ...distractors(item.word, deck, 3)];
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [opts[i], opts[j]] = [opts[j], opts[i]];
    }
    return opts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, useChoices]);

  const expected =
    item?.type === 'card'
      ? expectedAnswer(item.word, item.kind, progress.settings, item.cell)
      : '';
  const cloze = item?.type === 'card' && item.kind === 'cloze' ? clozeSentence(item.word) : null;

  // Сброс — до отрисовки, иначе на новой карточке успевает мелькнуть
  // разбор предыдущей: useEffect сработал бы уже после кадра.
  useLayoutEffect(() => {
    startedAt.current = Date.now();
    setPhase('question');
    setInput('');
    setVerdict(null);
    setPicked(null);
  }, [index]);

  useEffect(() => {
    if (!item || item.type !== 'card') return;
    // Без предшествующего жеста Safari глушит речь и может залипнуть —
    // до первого клика по странице озвучиваем только по кнопке.
    if (item.kind === 'listen' && progress.settings.autoPlayAudio && canAutoSpeak()) {
      speak(item.word.el, progress.settings.ttsRate);
    }
    if (item.kind === 'produce' || item.kind === 'cloze' || item.kind === 'case') {
      inputRef.current?.focus();
    }
    // Уходя с карточки, обрываем речь: догоняющее слово от предыдущей
    // карточки сбивает с толку, а в паре с двойным вызовом эффекта
    // приводило к двойному проигрыванию.
    return stopSpeaking;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  if (!item) {
    return <Summary done={done} onExit={onExit} />;
  }

  const advance = (relapse: boolean) => {
    if (relapse && item.type === 'card') {
      const next = [...queue];
      const target = Math.min(next.length, index + 1 + RELAPSE_GAP);
      next.splice(target, 0, item);
      setQueue(next);
    }
    setIndex(index + 1);
  };

  const submitRating = (rating: Rating) => {
    if (item.type !== 'card') return;
    const ms = Date.now() - startedAt.current;
    onAnswer(item.word, item.kind, rating, ms);
    setDone((d) => ({
      answered: d.answered + 1,
      correct: d.correct + (rating === Rating.Again ? 0 : 1),
    }));
    advance(rating === Rating.Again);
  };

  const checkTyped = () => {
    if (!input.trim()) return;
    const cmp = compareAnswer(input, expected);
    setVerdict(cmp);
    setPhase('answer');
  };

  const pickChoice = (w: Word) => {
    if (phase === 'answer') return;
    setPicked(w.id);
    setVerdict(w.id === item.word.id ? 'exact' : 'wrong');
    setPhase('answer');
  };

  // Автооценка: точный ответ — «помню», перепутанное ударение — «трудно».
  const suggested: Rating =
    verdict === 'exact' ? Rating.Good
      : verdict === 'accent' ? (progress.settings.strictAccents ? Rating.Again : Rating.Hard)
        : verdict === 'wrong' ? Rating.Again
          : Rating.Good;

  const intervals = card ? previewIntervals(scheduler, card, new Date()) : null;
  const remaining = queue.length - index;

  return (
    <div className="session">
      <header className="session-top">
        <button className="icon-btn" onClick={onExit} aria-label="Выйти">✕</button>
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${(done.answered / Math.max(1, done.answered + remaining)) * 100}%` }}
          />
        </div>
        <span className="counter">{remaining}</span>
      </header>

      {item.type === 'intro' ? (
        <Intro word={item.word} rate={progress.settings.ttsRate} onNext={() => setIndex(index + 1)} />
      ) : (
        <div className="card-area">
          <div className="kind-tag">
            {item.kind === 'recognize' && 'Что это значит?'}
            {item.kind === 'listen' && 'Что ты услышал?'}
            {item.kind === 'produce' && 'Как это по-гречески?'}
            {item.kind === 'cloze' && 'Вставь пропущенное слово'}
            {item.kind === 'case' && 'Поставь в нужную форму'}
            {item.isNew && <span className="badge-new">новая</span>}
          </div>

          {/* ── Вопрос ── */}
          <div className="prompt">
            {item.kind === 'recognize' && <span className="greek-big">{item.word.display}</span>}

            {item.kind === 'listen' && (
              <button
                className="speaker-big"
                onClick={() => speak(item.word.el, progress.settings.ttsRate)}
                aria-label="Прослушать"
              >
                🔊
              </button>
            )}

            {item.kind === 'produce' && <span className="ru-big">{item.word.ru}</span>}

            {item.kind === 'case' && item.cell && (
              <div className="case-prompt">
                <span className="greek-mid">{item.word.declension?.nom[0] ?? item.word.display}</span>
                <span className="case-arrow">↓</span>
                <span className="case-target">{cellLabel(item.cell)}</span>
                <span className="hint">{item.word.ru}</span>
              </div>
            )}

            {item.kind === 'cloze' && cloze && (
              <div className="cloze">
                <span className="greek-mid">
                  {cloze.before}
                  <span className="blank">{phase === 'answer' ? cloze.hidden : '_____'}</span>
                  {cloze.after}
                </span>
                {item.word.exampleRu && <div className="hint">{item.word.exampleRu}</div>}
              </div>
            )}
          </div>

          {/* ── Ответ пользователя ── */}
          {useChoices && (
            <div className="choices">
              {choices.map((w) => {
                const isRight = w.id === item.word.id;
                const cls = phase === 'answer'
                  ? isRight ? 'choice right' : picked === w.id ? 'choice wrong' : 'choice dim'
                  : 'choice';
                return (
                  <button key={w.id} className={cls} onClick={() => pickChoice(w)}>
                    {w.ru}
                  </button>
                );
              })}
            </div>
          )}

          {isTyping && (
            <div className="typing">
              <input
                ref={inputRef}
                className={`answer-input ${verdict ?? ''}`}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') phase === 'question' ? checkTyped() : submitRating(suggested);
                }}
                placeholder="…"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                inputMode="none"
                readOnly={phase === 'answer'}
              />
              {phase === 'question' && (
                <GreekKeyboard value={input} onChange={setInput} onSubmit={checkTyped} />
              )}
            </div>
          )}

          {phase === 'question' && !useChoices && !isTyping && (
            <button className="btn primary wide" onClick={() => setPhase('answer')}>
              Показать ответ
            </button>
          )}

          {/* ── Разбор ── */}
          {phase === 'answer' && (
            <div className="reveal">
              {verdict && verdict !== 'exact' && (
                <div className={`verdict ${verdict}`}>
                  {verdict === 'accent' ? 'Верно, но ударение не там' : 'Правильный ответ:'}
                  {' '}
                  <b className="greek-mid">{expected}</b>
                </div>
              )}
              <WordDetails word={item.word} rate={progress.settings.ttsRate} />

              <div className="grades">
                {([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const).map((r) => (
                  <button
                    key={r}
                    className={`grade g${r} ${r === suggested ? 'suggested' : ''}`}
                    onClick={() => submitRating(r)}
                  >
                    <span>{GRADE_LABEL[r]}</span>
                    <small>{intervals ? intervals[r] : ''}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const GRADE_LABEL: Record<number, string> = {
  [Rating.Again]: 'Не помню',
  [Rating.Hard]: 'Трудно',
  [Rating.Good]: 'Помню',
  [Rating.Easy]: 'Легко',
};

function Intro({ word, rate, onNext }: { word: Word; rate: number; onNext: () => void }) {
  useEffect(() => {
    if (canAutoSpeak()) speak(word.el, rate);
    return stopSpeaking;
  }, [word.el, rate]);

  return (
    <div className="card-area intro">
      <div className="kind-tag">Новое слово</div>
      <div className="prompt column">
        <span className="greek-big">{word.display}</span>
        <span className="ru-big muted">{word.ru}</span>
      </div>
      <WordDetails word={word} rate={rate} expanded />
      <button className="btn primary wide" onClick={onNext}>Понятно</button>
    </div>
  );
}

function Summary({ done, onExit }: { done: { answered: number; correct: number }; onExit: () => void }) {
  const pct = done.answered ? Math.round((done.correct / done.answered) * 100) : 0;
  return (
    <div className="summary">
      <h2>Готово</h2>
      {done.answered === 0 ? (
        <p className="muted">На сегодня повторений нет. Возвращайся завтра или добавь новых слов.</p>
      ) : (
        <>
          <div className="big-number">{pct}%</div>
          <p className="muted">{done.answered} ответов · {done.correct} верных</p>
        </>
      )}
      <button className="btn primary wide" onClick={onExit}>На главную</button>
    </div>
  );
}
