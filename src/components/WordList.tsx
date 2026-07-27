import { useMemo, useState } from 'react';
import type { Deck, Progress, StoredCard, Word } from '../types.ts';
import { CARD_KINDS, KIND_SHORT, cardKey } from '../types.ts';
import { State, humanInterval, isLeech } from '../lib/scheduler.ts';
import { normalizeLoose } from '../lib/greek.mjs';
import { speak, ttsAvailable } from '../lib/tts.ts';
import { WordDetails } from './WordDetails.tsx';

type Filter = 'all' | 'new' | 'learning' | 'known' | 'leech';

const FILTERS: [Filter, string][] = [
  ['all', 'Все'],
  ['new', 'Не начаты'],
  ['learning', 'Учатся'],
  ['known', 'Знаю'],
  ['leech', 'Проблемные'],
];

export function WordList({ deck, progress }: { deck: Deck; progress: Progress }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [topic, setTopic] = useState<string>('');
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = normalizeLoose(query.trim()).toLowerCase();
    const qRu = query.trim().toLowerCase();
    return deck.words
      .map((w) => ({ word: w, cards: cardsOf(w, progress) }))
      .filter(({ word, cards }) => {
        if (topic && word.topic !== topic) return false;
        if (filter !== 'all' && status(cards) !== filter) return false;
        if (!q && !qRu) return true;
        return (
          normalizeLoose(word.display).includes(q) ||
          word.ru.toLowerCase().includes(qRu)
        );
      });
  }, [deck, progress, query, filter, topic]);

  return (
    <div className="words">
      <div className="search-row">
        <input
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по слову или переводу"
        />
      </div>

      <div className="chips">
        {FILTERS.map(([f, label]) => (
          <button
            key={f}
            className={`chip ${filter === f ? 'on' : ''}`}
            onClick={() => setFilter(f)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="chips">
        <button className={`chip ${topic === '' ? 'on' : ''}`} onClick={() => setTopic('')}>
          Все темы
        </button>
        {deck.topics.map((t) => (
          <button key={t} className={`chip ${topic === t ? 'on' : ''}`} onClick={() => setTopic(t)}>
            {t}
          </button>
        ))}
      </div>

      <p className="muted small">{rows.length} слов</p>

      <ul className="word-list">
        {rows.map(({ word, cards }) => {
          const st = status(cards);
          const isOpen = open === word.id;
          return (
            <li key={word.id} className={`word-row ${st} ${isOpen ? 'open' : ''}`}>
              <button className="word-main" onClick={() => setOpen(isOpen ? null : word.id)}>
                <span className="word-el greek-sm">
                  {word.display}
                  {secondForm(word) && <span className="word-alt"> · {secondForm(word)}</span>}
                </span>
                <span className="word-ru">{word.ru}</span>
                <span className="word-state">
                  {CARD_KINDS.map((k) => {
                    const c = cards[k];
                    if (!c) return null;
                    return (
                      <span
                        key={k}
                        className={`pip s${c.state} ${isLeech(c) ? 'leech' : ''}`}
                        title={`${KIND_SHORT[k]} · ${dueLabel(c)}`}
                      >
                        {KIND_SHORT[k]}
                      </span>
                    );
                  })}
                </span>
              </button>
              {isOpen && (
                <div className="word-expand">
                  <WordDetails word={word} rate={progress.settings.ttsRate} expanded />
                  <div className="card-states">
                    {CARD_KINDS.map((k) => {
                      const c = cards[k];
                      return (
                        <div key={k} className="card-state-row">
                          <span className="form-label">{KIND_SHORT[k]}</span>
                          <span className={c ? '' : 'muted'}>
                            {c ? dueLabel(c) : 'не открыто'}
                            {c && c.lapses > 0 && ` · ошибок: ${c.lapses}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {ttsAvailable() && (
                    <button
                      className="btn wide"
                      onClick={() => speak(word.example || word.el, progress.settings.ttsRate)}
                    >
                      🔊 Прослушать {word.example ? 'пример' : 'слово'}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const PLURAL_ARTICLE: Record<string, string> = { ο: 'οι', η: 'οι', το: 'τα' };

/**
 * Вторая по важности форма — прямо в строку списка, чтобы словарь читался
 * без раскрытия каждой записи: у существительных множественное число,
 * у прилагательных женский род, у глаголов 2 л. ед. ч.
 */
function secondForm(w: Word): string | null {
  const f = w.forms;
  if (!f) return null;
  if (w.pos === 'noun' && f.plural) {
    const art = w.article ? PLURAL_ARTICLE[w.article] : undefined;
    return art ? `${art} ${f.plural}` : f.plural;
  }
  if (w.pos === 'adj' && f.gender) return f.gender.slice(1).join(' · ');
  if (w.pos === 'verb' && f.present) return f.present[1];
  return null;
}

function cardsOf(w: Word, progress: Progress): Partial<Record<string, StoredCard>> {
  const out: Partial<Record<string, StoredCard>> = {};
  for (const k of CARD_KINDS) {
    const c = progress.cards[cardKey(w.id, k)];
    if (c) out[k] = c;
  }
  return out;
}

function status(cards: Partial<Record<string, StoredCard>>): Filter {
  const list = Object.values(cards).filter(Boolean) as StoredCard[];
  if (!list.length) return 'new';
  if (list.some(isLeech)) return 'leech';
  if (list.every((c) => c.state === State.Review)) return 'known';
  return 'learning';
}

function dueLabel(c: StoredCard): string {
  const ms = new Date(c.due).getTime() - Date.now();
  if (ms <= 0) return 'к повторению';
  return `через ${humanInterval(ms)}`;
}
