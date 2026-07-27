import { KEYBOARD_ROWS, isVowel, toggleTonos } from '../lib/greek.mjs';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}

/**
 * Экранная греческая раскладка. Нужна не только на телефоне: переключать
 * системную раскладку ради одного слова — трение, из-за которого упражнение
 * на ввод перестают делать.
 *
 * Клавиша ΄ ставит тонос на последнюю гласную; повторное нажатие снимает его.
 */
export function GreekKeyboard({ value, onChange, onSubmit }: Props) {
  const type = (ch: string) => onChange(value + ch);

  const applyTonos = () => {
    for (let i = value.length - 1; i >= 0; i--) {
      if (isVowel(value[i])) {
        onChange(value.slice(0, i) + toggleTonos(value[i]) + value.slice(i + 1));
        return;
      }
    }
  };

  return (
    <div className="kb">
      {KEYBOARD_ROWS.map((row, i) => (
        <div className="kb-row" key={i}>
          {i === 2 && (
            <button type="button" className="kb-key kb-wide" onClick={applyTonos}>
              ΄
            </button>
          )}
          {row.map((ch) => (
            <button type="button" className="kb-key" key={ch} onClick={() => type(ch)}>
              {ch}
            </button>
          ))}
          {i === 2 && (
            <button
              type="button"
              className="kb-key kb-wide"
              onClick={() => onChange(value.slice(0, -1))}
            >
              ⌫
            </button>
          )}
        </div>
      ))}
      <div className="kb-row">
        <button type="button" className="kb-key kb-space" onClick={() => type(' ')}>
          пробел
        </button>
        <button type="button" className="kb-key kb-enter" onClick={onSubmit}>
          Проверить
        </button>
      </div>
    </div>
  );
}
