import type { Word } from '../types.ts';
import { CASES, CASE_SHORT } from '../types.ts';
import { speak, ttsAvailable } from '../lib/tts.ts';
import { spokenForm } from '../lib/session.ts';

/**
 * Падежная таблица. В свёрнутом виде показывает только те падежи, форма
 * которых отличается от исходной: у среднего рода винительный равен
 * именительному, и печатать его второй раз — лишний шум.
 */
function DeclensionTable({ word, compact }: { word: Word; compact: boolean }) {
  const d = word.declension!;
  const base = d.nom[0];
  const rows = CASES.filter((c) => {
    if (!compact) return d[c][0] || d[c][1];
    if (c === 'nom') return true;
    return (d[c][0] && d[c][0] !== base) || (d[c][1] && d[c][1] !== d.nom[1]);
  });
  if (!rows.length) return null;

  return (
    <table className="decl">
      <thead>
        <tr>
          <th />
          <th>ед. ч.</th>
          <th>мн. ч.</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c}>
            <td className="form-label">{CASE_SHORT[c]}</td>
            <td className="greek-sm">{d[c][0] ?? <span className="muted">—</span>}</td>
            <td className="greek-sm">{d[c][1] ?? <span className="muted">—</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const PERSONS = ['εγώ', 'εσύ', 'αυτός', 'εμείς', 'εσείς', 'αυτοί'];
const GENDERS = ['м. р.', 'ж. р.', 'ср. р.'];

const POS_LABEL: Record<string, string> = {
  noun: 'сущ.', verb: 'глаг.', adj: 'прил.', adv: 'нареч.',
  phrase: 'фраза', prep: 'предлог', pron: 'мест.', num: 'числ.', other: '',
};

/** Оборот карточки: всё, что стоит увидеть после ответа. */
export function WordDetails({
  word, rate, expanded = false,
}: { word: Word; rate: number; expanded?: boolean }) {
  const forms = word.forms;
  return (
    <div className="details">
      <div className="details-head">
        <span className="pos">{POS_LABEL[word.pos]}</span>
        {word.irregular && <span className="irregular-chip">неправильное</span>}
        <span className="topic-chip">{word.topic}</span>
        {ttsAvailable() && (
          <button className="icon-btn" onClick={() => speak(spokenForm(word), rate)} aria-label="Прослушать">
            🔊
          </button>
        )}
      </div>

      {word.note && <p className="note">{word.note}</p>}

      {word.declension ? (
        <DeclensionTable word={word} compact={!expanded} />
      ) : forms?.plural && (
        <p className="form-line">
          <span className="form-label">мн. ч.</span>
          <span className="greek-sm">{forms.plural}</span>
        </p>
      )}

      {forms?.gender && (
        <p className="form-line">
          <span className="form-label">по родам</span>
          <span className="greek-sm">
            {forms.gender.map((f, i) => (
              <span key={i} className="form-chip" title={GENDERS[i]}>{f}</span>
            ))}
          </span>
        </p>
      )}

      {forms?.present && (expanded ? (
        <table className="conj">
          <tbody>
            {forms.present.map((f, i) => (
              <tr key={i}>
                <td className="form-label">{PERSONS[i]}</td>
                <td className="greek-sm">{f}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="form-line">
          <span className="form-label">спряжение</span>
          <span className="greek-sm">{forms.present.join(' · ')}</span>
        </p>
      ))}

      {word.example && (
        <blockquote className="example">
          <span className="greek-sm">{word.example}</span>
          {word.exampleRu && <em>{word.exampleRu}</em>}
        </blockquote>
      )}
    </div>
  );
}
