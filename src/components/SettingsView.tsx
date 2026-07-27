import { useRef, useState } from 'react';
import type { CardKind, Deck, Progress, Settings } from '../types.ts';
import { CARD_KINDS, KIND_LABEL } from '../types.ts';
import { emptyProgress, exportProgress, importProgress } from '../lib/storage.ts';
import {
  allVoices, getGreekVoice, getRecentEvents, greekVoices, speak, supported,
} from '../lib/tts.ts';

interface Props {
  deck: Deck;
  progress: Progress;
  tts: boolean;
  onChange: (s: Settings) => void;
  onReplace: (p: Progress) => void;
}

export function SettingsView({ deck, progress, tts, onChange, onReplace }: Props) {
  const s = progress.settings;
  const [msg, setMsg] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const patch = (p: Partial<Settings>) => onChange({ ...s, ...p });

  const toggleKind = (k: CardKind) => {
    const has = s.enabledKinds.includes(k);
    const next = has ? s.enabledKinds.filter((x) => x !== k) : [...s.enabledKinds, k];
    if (!next.length) return;
    patch({ enabledKinds: next });
  };

  const toggleTopic = (t: string) => {
    const has = s.enabledTopics.includes(t);
    patch({ enabledTopics: has ? s.enabledTopics.filter((x) => x !== t) : [...s.enabledTopics, t] });
  };

  const doExport = () => {
    const text = exportProgress(progress, deck);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `greek-progress-${new Date().toISOString().slice(0, 10)}.json`;
    // Safari игнорирует click() на якоре, которого нет в документе.
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Браузер читает blob асинхронно. Немедленный revoke обрывает чтение, и файл
    // сохраняется пустым или не сохраняется вовсе — именно из-за этого перенос
    // прогресса не работал. Отпускаем ссылку с запасом.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setMsg(`Файл сохранён · ${Math.round(text.length / 1024)} КБ`);
  };

  /**
   * Перенос между устройствами файлом неудобен: на iPhone его надо сначала
   * куда-то положить, потом найти в выборе файлов. Текстом через общий буфер
   * Apple (Universal Clipboard) это одно нажатие на каждой стороне.
   */
  const doCopy = async () => {
    const text = exportProgress(progress, deck);
    try {
      await navigator.clipboard.writeText(text);
      setMsg(`Прогресс скопирован · ${Math.round(text.length / 1024)} КБ. Вставь на другом устройстве.`);
    } catch {
      setMsg('Буфер обмена недоступен — воспользуйся кнопкой «Файл»');
    }
  };

  const doPaste = () => {
    try {
      const p = importProgress(pasted);
      onReplace(p);
      setPasted('');
      setPasteOpen(false);
      setMsg(`Загружено: ${Object.keys(p.cards).length} карточек`);
    } catch (e) {
      setMsg(`Не удалось прочитать: ${(e as Error).message}`);
    }
  };

  const doImport = async (file: File) => {
    try {
      const p = importProgress(await file.text());
      onReplace(p);
      setMsg(`Загружено: ${Object.keys(p.cards).length} карточек`);
    } catch (e) {
      setMsg(`Не удалось прочитать файл: ${(e as Error).message}`);
    }
  };

  const doReset = () => {
    if (!confirm('Удалить весь прогресс? Это необратимо. Сначала лучше сделать экспорт.')) return;
    onReplace(emptyProgress());
    setMsg('Прогресс сброшен');
  };

  return (
    <div className="settings">
      <h2>Настройки</h2>

      <section>
        <h3>Нагрузка</h3>
        <Slider
          label="Новых слов в день"
          value={s.newWordsPerDay}
          min={0}
          max={30}
          onChange={(v) => patch({ newWordsPerDay: v })}
          hint="Каждое новое слово со временем превращается в 3–4 карточки, поэтому 8 в день — это уже около 30 повторений в сутки на горизонте месяца."
        />
        <Slider
          label="Потолок повторений в день"
          value={s.maxReviewsPerDay}
          min={0}
          max={300}
          step={10}
          format={(v) => (v === 0 ? 'без лимита' : String(v))}
          onChange={(v) => patch({ maxReviewsPerDay: v })}
          hint="Страховка от завала после перерыва. Отложенные повторения не пропадают, а переносятся на следующий день."
        />
        <Slider
          label="Целевое удержание"
          value={Math.round(s.requestRetention * 100)}
          min={80}
          max={97}
          format={(v) => `${v}%`}
          onChange={(v) => patch({ requestRetention: v / 100 })}
          hint="Доля слов, которые ты хочешь помнить на момент повторения. Выше — крепче память, но заметно больше повторений."
        />
      </section>

      <section>
        <h3>Типы упражнений</h3>
        <p className="muted small">
          Карточки открываются по очереди: узнавание → на слух → ввод → пропуск в предложении.
          Следующая ступень появляется, когда предыдущая закрепилась.
        </p>
        {CARD_KINDS.map((k) => (
          <label className="row" key={k}>
            <input
              type="checkbox"
              checked={s.enabledKinds.includes(k)}
              onChange={() => toggleKind(k)}
            />
            <span>{KIND_LABEL[k]}</span>
            {k === 'listen' && !tts && <span className="warn-inline">нет голоса</span>}
          </label>
        ))}
        <p className="muted small">
          Голос: {tts ? getGreekVoice()?.name : 'греческий голос не установлен'}
        </p>
      </section>

      <section>
        <h3>Проверка ответа</h3>
        <label className="row">
          <input
            type="checkbox"
            checked={s.strictAccents}
            onChange={(e) => patch({ strictAccents: e.target.checked })}
          />
          <span>Строго к ударениям</span>
        </label>
        <p className="muted small">
          По умолчанию ответ без тоноса засчитывается как «трудно» и показывается правильная
          форма. Включи строгий режим, когда слова уже сидят уверенно.
        </p>
        <label className="row">
          <input
            type="checkbox"
            checked={s.requireArticle}
            onChange={(e) => patch({ requireArticle: e.target.checked })}
          />
          <span>Требовать артикль у существительных</span>
        </label>
      </section>

      <section>
        <h3>Озвучка</h3>
        <label className="row">
          <input
            type="checkbox"
            checked={s.autoPlayAudio}
            onChange={(e) => patch({ autoPlayAudio: e.target.checked })}
          />
          <span>Проигрывать автоматически</span>
        </label>
        <Slider
          label="Скорость речи"
          value={Math.round(s.ttsRate * 100)}
          min={50}
          max={130}
          step={5}
          format={(v) => `${(v / 100).toFixed(2)}×`}
          onChange={(v) => patch({ ttsRate: v / 100 })}
        />
        <VoiceDiagnostics rate={s.ttsRate} />
      </section>

      <section>
        <h3>Темы</h3>
        <p className="muted small">
          Ничего не отмечено — учатся все темы. Отметь, чтобы сузиться до конкретных уроков.
        </p>
        <div className="chips">
          {deck.topics.map((t) => (
            <button
              key={t}
              className={`chip ${s.enabledTopics.includes(t) ? 'on' : ''}`}
              onClick={() => toggleTopic(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>Данные</h3>
        <p className="muted small">
          Прогресс лежит только в этом браузере — на сервер ничего не уходит.
          Делай копию время от времени, ею же прогресс переносится
          на другое устройство.
        </p>

        <p className="muted small">
          <b>Между iPhone и Mac проще через буфер:</b> «Скопировать» здесь,
          «Вставить» там. Файл нужен для настоящего бэкапа.
        </p>
        <div className="btn-row">
          <button className="btn primary" onClick={doCopy}>Скопировать</button>
          <button className="btn" onClick={() => setPasteOpen(!pasteOpen)}>Вставить</button>
        </div>

        {pasteOpen && (
          <div className="paste-box">
            <textarea
              className="paste-area"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="Вставь сюда скопированный прогресс (⌘V или долгое нажатие → Вставить)"
              rows={4}
            />
            <div className="btn-row">
              <button className="btn primary" onClick={doPaste} disabled={!pasted.trim()}>
                Загрузить
              </button>
              <button className="btn" onClick={() => { setPasted(''); setPasteOpen(false); }}>
                Отмена
              </button>
            </div>
          </div>
        )}

        <div className="btn-row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={doExport}>Файл</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>Из файла</button>
          <button className="btn danger" onClick={doReset}>Сбросить</button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void doImport(f);
            e.target.value = '';
          }}
        />
        {msg && <p className="msg">{msg}</p>}
        <p className="muted small">
          Слов в колоде: {deck.words.length} · источники: {deck.builtFrom.join(', ')}
        </p>
      </section>
    </div>
  );
}

const ERROR_HINT: Record<string, string> = {
  'no-greek-voice': 'греческий голос не найден в системе',
  'synthesis-unsupported': 'браузер не умеет синтез речи',
  'not-allowed': 'браузер заблокировал речь — нажми ещё раз',
  'audio-busy': 'аудиоустройство занято другим приложением',
  'audio-hardware': 'проблема со звуковым устройством',
  'synthesis-failed': 'движок синтеза не смог произнести фразу',
  'language-unavailable': 'для греческого нет голоса',
  'voice-unavailable': 'выбранный голос недоступен',
  network: 'голос требует интернета, а сети нет',
  'silent-drop': 'движок принял фразу и выбросил её, не начав говорить',
};

/**
 * Тихий отказ синтеза речи — самый частый и самый непонятный сбой:
 * кнопка нажимается, ошибок в консоли нет, звука нет. Панель ведёт след
 * вызова, чтобы было видно, на каком именно шаге всё замолчало.
 */
function VoiceDiagnostics({ rate }: { rate: number }) {
  const [status, setStatus] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  const greek = greekVoices();
  const chosen = getGreekVoice();
  // Читаем при каждой отрисовке: журнал наполняется во время занятия,
  // и открытие панели должно показывать уже накопленное.
  const journal = open ? getRecentEvents() : [];

  const test = () => {
    setStatus('запуск…');
    setLog([]);
    setOpen(true);
    const add = (line: string) => setLog((l) => [...l, line]);

    speak('Καλημέρα, τι κάνεις;', rate, {
      onLog: add,
      onStart: () => setStatus('говорит…'),
      onEnd: () => setStatus('✓ прозвучало нормально'),
      onError: (code) =>
        setStatus(`✗ ${code}${ERROR_HINT[code] ? ` — ${ERROR_HINT[code]}` : ''}`),
    });
  };

  const copyReport = () => {
    const report = [
      `UA: ${navigator.userAgent}`,
      `API: ${supported() ? 'есть' : 'нет'} · голосов ${allVoices().length} · греческих ${greek.length}`,
      `выбран: ${chosen ? `${chosen.name} ${chosen.lang} ${chosen.localService ? 'local' : 'remote'}` : '—'}`,
      `статус: ${status ?? '—'}`,
      ...(log.length ? log : getRecentEvents().map((e) => `${e.ms}мс ${e.line}`)).map((l) => `  ${l}`),
    ].join('\n');
    void navigator.clipboard?.writeText(report);
    setStatus('отчёт скопирован в буфер');
  };

  return (
    <div className="diag">
      <div className="btn-row">
        <button className="btn" onClick={test}>Проверить озвучку</button>
        <button className="btn" onClick={() => setOpen(!open)}>
          {open ? 'Скрыть детали' : 'Детали'}
        </button>
        {log.length > 0 && (
          <button className="btn" onClick={copyReport}>Скопировать отчёт</button>
        )}
      </div>

      {status && <p className="msg">{status}</p>}

      {open && (
        <div className="diag-body">
          <Row label="Web Speech API" value={supported() ? 'есть' : 'нет'} />
          <Row label="Голосов всего" value={String(allVoices().length)} />
          <Row label="Греческих" value={String(greek.length)} />
          <Row
            label="Выбран"
            value={chosen ? `${chosen.name} · ${chosen.lang} · ${chosen.localService ? 'локальный' : 'сетевой'}` : '—'}
          />
          <Row label="Браузер" value={shortUA()} />

          {greek.length > 0 && (
            <ul className="voice-list">
              {greek.map((v) => (
                <li key={`${v.name}|${v.lang}`}>
                  {v.name} <span className="muted">{v.lang}{v.localService ? '' : ' · сетевой'}</span>
                </li>
              ))}
            </ul>
          )}

          {log.length > 0 && (
            <ol className="trace">
              {log.map((l, i) => <li key={i}>{l}</li>)}
            </ol>
          )}

          {/* След того, что происходило во время занятия: кнопки динамика
              вызывают speak() без обработчиков, и иначе их не видно. */}
          {log.length === 0 && journal.length > 0 && (
            <>
              <p className="muted small">
                Последние события озвучки, включая нажатия динамика во время занятия:
              </p>
              <ol className="trace">
                {journal.map((e, i) => <li key={i}>{e.ms} мс · {e.line}</li>)}
              </ol>
            </>
          )}

          {allVoices().length === 0 && (
            <p className="muted small">
              Браузер не отдал ни одного голоса. В Chrome список догружается асинхронно —
              перезагрузи страницу. Если пусто и после перезагрузки, синтез отключён
              на уровне браузера или системы.
            </p>
          )}
          {greek.length === 0 && allVoices().length > 0 && (
            <p className="muted small">
              Голоса есть, но греческого среди них нет. macOS: Системные настройки →
              Универсальный доступ → Устная речь → Системный голос → Управление голосами → Greek.
              После установки перезапусти браузер: список голосов кэшируется при старте.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function shortUA(): string {
  const ua = navigator.userAgent;
  const m =
    /(Firefox)\/([\d.]+)/.exec(ua) ??
    /(Edg)\/([\d.]+)/.exec(ua) ??
    /(Chrome)\/([\d.]+)/.exec(ua) ??
    /Version\/([\d.]+).*(Safari)/.exec(ua);
  if (!m) return ua.slice(0, 60);
  return m[1] === 'Safari' || m[2] === 'Safari' ? `Safari ${m[1]}` : `${m[1]} ${m[2]}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="diag-row">
      <span className="form-label">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Slider({
  label, value, min, max, step = 1, format, onChange, hint,
}: {
  label: string; value: number; min: number; max: number; step?: number;
  format?: (v: number) => string; onChange: (v: number) => void; hint?: string;
}) {
  return (
    <div className="slider">
      <div className="slider-head">
        <span>{label}</span>
        <b>{format ? format(value) : value}</b>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <p className="muted small">{hint}</p>}
    </div>
  );
}
