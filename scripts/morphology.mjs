/**
 * Правила словоизменения новогреческого — для сверки форм, написанных вручную.
 *
 * Задача модуля не в том, чтобы заменить человека: неправильные слова он не
 * знает и знать не может. Задача — механически ловить то, в чём человек
 * ошибается чаще всего, и прежде всего сдвиг ударения. Всё, что не выводится
 * однозначно, честно помечается как «не берусь», а не угадывается.
 */

import { stripAccents } from '../src/lib/greek.mjs';

const PLAIN_VOWELS = new Set('αεηιουω');
const TONOS_CHARS = 'άέήίόύώΐΰ';
const DIALYTIKA_ONLY = 'ϊϋ';
const ADD_TONOS = { α: 'ά', ε: 'έ', η: 'ή', ι: 'ί', ο: 'ό', υ: 'ύ', ω: 'ώ', ϊ: 'ΐ', ϋ: 'ΰ' };

/** Пары, которые читаются как один слог. */
const DIGRAPHS = new Set(['αι', 'ει', 'οι', 'υι', 'ου', 'αυ', 'ευ', 'ηυ']);

const isVowel = (ch) => !!ch && (PLAIN_VOWELS.has(stripAccents(ch)) || DIALYTIKA_ONLY.includes(ch));
const hasTonos = (ch) => !!ch && TONOS_CHARS.includes(ch);

function addTonos(ch) {
  if (hasTonos(ch)) return ch;
  return ADD_TONOS[ch] ?? ch;
}

function dropTonos(ch) {
  if (ch === 'ΐ') return 'ϊ';
  if (ch === 'ΰ') return 'ϋ';
  return hasTonos(ch) ? stripAccents(ch) : ch;
}

/**
 * Разбивает слово на слоговые ядра. Диграф считается одним слогом, кроме
 * случаев, когда его разбивает ударение на первой букве (γάιδαρος)
 * или диалитика на второй (πρωτεΐνη).
 */
function nuclei(word) {
  const out = [];
  for (let i = 0; i < word.length; ) {
    if (!isVowel(word[i])) { i++; continue; }
    const next = word[i + 1];
    const bare = stripAccents(word[i]);
    const pair = bare + (next ? stripAccents(next) : '');
    const splitByDialytika = !!next && (DIALYTIKA_ONLY.includes(next) || next === 'ΐ' || next === 'ΰ');

    if (DIGRAPHS.has(pair) && !hasTonos(word[i]) && !splitByDialytika) {
      out.push({ start: i, end: i + 1 });
      i += 2;
      continue;
    }
    // Синизиса: безударная ι или υ перед гласной становится полугласной и
    // слога не образует — πιά-το, а не πι-ά-το. Без этого правила ударение
    // в падежных формах считается неверно: πιάτου превратилось бы в πιατού.
    if ((bare === 'ι' || bare === 'υ') && !hasTonos(word[i]) && isVowel(next) && !splitByDialytika) {
      out.push({ start: i, end: i + 1 });
      i += 2;
      continue;
    }
    out.push({ start: i, end: i });
    i += 1;
  }
  return out;
}

export function countSyllables(word) {
  return nuclei(word).length;
}

function accentedNucleus(word, n) {
  return n.findIndex((nu) => {
    for (let k = nu.start; k <= nu.end; k++) if (hasTonos(word[k])) return true;
    return false;
  });
}

/** Позиция ударения в слогах от конца: 1 — последний слог, 3 — третий от конца. */
export function accentFromEnd(word) {
  const n = nuclei(word);
  const idx = accentedNucleus(word, n);
  return idx === -1 ? 0 : n.length - idx;
}

/**
 * Переносит ударение на один слог к концу слова.
 * Нужно для падежей: ο άνθρωπος → του ανθρώπου, το πρόσωπο → του προσώπου.
 * Это не то же самое, что fixAccentPosition: там ударение вынужденно уходит
 * из недопустимой позиции, здесь — по требованию конкретного окончания.
 */
export function shiftAccentForward(word) {
  const n = nuclei(word);
  const idx = accentedNucleus(word, n);
  if (idx === -1 || idx === n.length - 1) return word;
  const chars = [...word];
  for (let k = n[idx].start; k <= n[idx].end; k++) chars[k] = dropTonos(chars[k]);
  chars[n[idx + 1].end] = addTonos(chars[n[idx + 1].end]);
  return chars.join('');
}

/**
 * Главное правило греческого ударения: тонос не может стоять дальше третьего
 * слога от конца. Когда окончание добавляет слог, ударение сдвигается вперёд:
 * το μάθημα → τα μαθήματα, а не «μάθηματα». Именно здесь ручная правка ошибается.
 */
export function fixAccentPosition(word) {
  const n = nuclei(word);
  if (n.length < 4) return word;

  const idx = n.findIndex((nu) => {
    for (let k = nu.start; k <= nu.end; k++) if (hasTonos(word[k])) return true;
    return false;
  });
  if (idx === -1) return word;

  const fromEnd = n.length - idx;
  if (fromEnd <= 3) return word;

  const chars = [...word];
  for (let k = n[idx].start; k <= n[idx].end; k++) chars[k] = dropTonos(chars[k]);
  const target = n[n.length - 3];
  chars[target.end] = addTonos(chars[target.end]);
  return chars.join('');
}

const endsWith = (w, s) => w.endsWith(s);

// ─── Глаголы ──────────────────────────────────────────────────────────────

const GROUP_A = ['ω', 'εις', 'ει', 'ουμε', 'ετε', 'ουν'];
const GROUP_B1 = ['άω', 'άς', 'άει', 'άμε', 'άτε', 'άνε'];
const GROUP_B2 = ['ώ', 'είς', 'εί', 'ούμε', 'είτε', 'ούν'];

/**
 * Настоящее время действительного залога.
 * Возвращает { forms, group } либо { skip } с причиной, по которой правило
 * неприменимо — молча угадывать в спорных случаях хуже, чем промолчать.
 */
export function conjugatePresent(el) {
  const w = el.trim();

  if (/(?:ομαι|άμαι|ούμαι|ιέμαι)$/.test(w)) {
    return { skip: 'глагол среднепассивного залога — отдельная парадигма' };
  }
  if (endsWith(w, 'άω')) {
    const stem = w.slice(0, -2);
    return { group: 'Б1', forms: GROUP_B1.map((e) => fixAccentPosition(stem + e)) };
  }
  if (endsWith(w, 'ώ')) {
    // αγαπώ спрягается как -άω, μπορώ — как -είς/-ούμε. По форме на -ώ
    // группу не определить, поэтому формы должны быть заданы явно.
    return { skip: 'форма на -ώ бывает двух спряжений (αγαπώ / μπορώ) — задай forms.present вручную' };
  }
  if (endsWith(w, 'ω')) {
    const stem = w.slice(0, -1);
    return { group: 'А', forms: GROUP_A.map((e) => fixAccentPosition(stem + e)) };
  }
  return { skip: 'не оканчивается на -ω' };
}

export const CONJUGATION_HINT = { 'Б2': GROUP_B2 };

// ─── Прилагательные ───────────────────────────────────────────────────────

/** Три рода: мужской, женский, средний. */
export function adjectiveForms(el) {
  const w = el.trim();

  if (endsWith(w, 'ός')) {
    // Ударение на окончании остаётся на окончании: παλιός → παλιά → παλιό.
    const stem = w.slice(0, -2);
    const fem = isVowel(stem.at(-1)) ? 'ά' : 'ή';
    return { forms: [w, stem + fem, stem + 'ό'] };
  }
  if (endsWith(w, 'ος')) {
    const stem = w.slice(0, -2);
    // После гласной женский род на -α, после согласной на -η:
    // ωραίος → ωραία, но μεγάλος → μεγάλη.
    const fem = isVowel(stem.at(-1)) ? 'α' : 'η';
    return { forms: [w, fixAccentPosition(stem + fem), fixAccentPosition(stem + 'ο')] };
  }
  if (endsWith(w, 'ύς')) {
    const stem = w.slice(0, -2);
    return { forms: [w, stem + 'ιά', stem + 'ύ'] };
  }
  if (endsWith(w, 'ής')) {
    return { skip: 'прилагательные на -ής склоняются по двум разным образцам' };
  }
  return { skip: 'нестандартное окончание прилагательного' };
}

// ─── Существительные ──────────────────────────────────────────────────────

const GENDER = { ο: 'm', η: 'f', το: 'n' };

/** Артикли по роду, падежу и числу. Звательный артикля не имеет. */
export const ARTICLES = {
  m: { nom: ['ο', 'οι'], gen: ['του', 'των'], acc: ['τον', 'τους'], voc: [null, null] },
  f: { nom: ['η', 'οι'], gen: ['της', 'των'], acc: ['την', 'τις'], voc: [null, null] },
  n: { nom: ['το', 'τα'], gen: ['του', 'των'], acc: ['το', 'τα'], voc: [null, null] },
};

/**
 * Конечное -ν артикля «την» сохраняется перед гласной и перед κ, π, τ, ξ, ψ,
 * а также перед сочетаниями μπ, ντ, γκ, τσ, τζ. В остальных случаях отпадает:
 * την πόρτα, но τη μέρα.
 *
 * На мужской род правило не распространяется: «τον» удерживает -ν всегда,
 * иначе он сливался бы со средним «το». Это подтверждается словарными
 * статьями — τον δρόμο, τον φίλο, хотя δ и φ «мягкие».
 */
const KEEPS_FINAL_NU = ['κ', 'π', 'τ', 'ξ', 'ψ'];
const KEEPS_FINAL_NU_PAIRS = ['μπ', 'ντ', 'γκ', 'τσ', 'τζ'];

export function feminineAccusativeArticle(word) {
  const w = stripAccents(word.trim().toLowerCase());
  if (!w) return 'την';
  if (isVowel(w[0])) return 'την';
  if (KEEPS_FINAL_NU_PAIRS.includes(w.slice(0, 2))) return 'την';
  if (KEEPS_FINAL_NU.includes(w[0])) return 'την';
  return 'τη';
}

export const CASE_LABEL = {
  nom: 'именительный',
  gen: 'родительный',
  acc: 'винительный',
  voc: 'звательный',
};

export const CASE_SHORT = { nom: 'им.', gen: 'род.', acc: 'вин.', voc: 'зв.' };

const isOxytone = (w) => accentFromEnd(w) === 1;

/** Ударение на третьем слоге от конца — именно оно сдвигается в родительном. */
const isAntepenult = (w) => accentFromEnd(w) === 3;

const shiftIfAntepenult = (built, nomSg) => (isAntepenult(nomSg) ? shiftAccentForward(built) : built);

/**
 * Приклеивает ударное окончание, сняв ударение с основы. В греческом слове
 * тонос ровно один: «άντρ» + «ών» должно дать αντρών, а не άντρών.
 */
const withStressedEnding = (stem, ending) => stripAccents(stem) + ending;

/**
 * Полное склонение существительного: четыре падежа в двух числах.
 *
 * Родительный падеж множественного числа выводится НЕ всегда, и это
 * сознательно. У мужского и женского рода с ударением не на окончании он
 * непредсказуем: ο πατέρας → των πατέρων, но ο άντρας → των αντρών;
 * η μητέρα → των μητέρων, но η πόρτα → των πορτών. Правила здесь нет —
 * есть история каждого слова. В таких клетках возвращается null,
 * и форму нужно вписать руками.
 */
export function declineNoun(el, article) {
  const gender = GENDER[article];
  if (!gender) return { skip: 'без артикля род неизвестен' };

  const w = el.trim();
  const t = buildTable(w, gender);
  if (!t) return { skip: `нестандартное окончание для рода «${article}»` };

  return {
    gender,
    table: {
      nom: [w, t.nomPl],
      gen: [t.genSg, t.genPl],
      acc: [t.accSg, t.accPl],
      voc: [t.vocSg, t.nomPl],
    },
  };
}

function buildTable(w, gender) {
  const cut = (n) => w.slice(0, -n);

  if (gender === 'm') {
    if (w.endsWith('ός')) {
      const s = cut(2);
      return {
        genSg: s + 'ού', accSg: s + 'ό', vocSg: s + 'έ',
        nomPl: s + 'οί', genPl: s + 'ών', accPl: s + 'ούς',
      };
    }
    if (w.endsWith('ος')) {
      const s = cut(2);
      return {
        genSg: shiftIfAntepenult(s + 'ου', w),
        accSg: s + 'ο',
        vocSg: s + 'ε',
        nomPl: s + 'οι',
        genPl: shiftIfAntepenult(s + 'ων', w),
        accPl: shiftIfAntepenult(s + 'ους', w),
      };
    }
    if (w.endsWith('ές')) {
      const s = cut(2);
      return {
        genSg: s + 'έ', accSg: s + 'έ', vocSg: s + 'έ',
        nomPl: s + 'έδες', genPl: s + 'έδων', accPl: s + 'έδες',
      };
    }
    if (w.endsWith('άς')) {
      const s = cut(2);
      return {
        genSg: s + 'ά', accSg: s + 'ά', vocSg: s + 'ά',
        nomPl: s + 'άδες', genPl: s + 'άδων', accPl: s + 'άδες',
      };
    }
    if (w.endsWith('ής')) {
      const s = cut(2);
      return {
        genSg: s + 'ή', accSg: s + 'ή', vocSg: s + 'ή',
        nomPl: s + 'ές', genPl: s + 'ών', accPl: s + 'ές',
      };
    }
    if (w.endsWith('ας') || w.endsWith('ης')) {
      const s = cut(2);
      const end = w.slice(-2, -1); // α или η
      return {
        genSg: s + end, accSg: s + end, vocSg: s + end,
        nomPl: fixAccentPosition(s + 'ες'),
        // Двусложные дают -ών (άντρας → αντρών), длиннее — непредсказуемо.
        genPl: countSyllables(w) === 2 ? withStressedEnding(s, 'ών') : null,
        accPl: fixAccentPosition(s + 'ες'),
      };
    }
    return null;
  }

  if (gender === 'f') {
    if (w.endsWith('ά') || w.endsWith('ή')) {
      const s = cut(1);
      const v = w.slice(-1);
      return {
        genSg: s + (v === 'ά' ? 'άς' : 'ής'), accSg: w, vocSg: w,
        nomPl: s + 'ές', genPl: s + 'ών', accPl: s + 'ές',
      };
    }
    if (w.endsWith('α')) {
      const s = cut(1);
      return {
        genSg: s + 'ας', accSg: w, vocSg: w,
        nomPl: fixAccentPosition(s + 'ες'),
        genPl: null, // πόρτα → πορτών, но μητέρα → μητέρων. Правила нет.
        accPl: fixAccentPosition(s + 'ες'),
      };
    }
    if (w.endsWith('η')) {
      const s = cut(1);
      // Тип на -εις (πόλη → πόλεις) от типа на -ες (νίκη → νίκες)
      // по окончанию не отличить, поэтому множественное число не выводим.
      return {
        genSg: s + 'ης', accSg: w, vocSg: w,
        nomPl: null, genPl: null, accPl: null,
      };
    }
    // Женский род на -ος: η οδός, η λεωφόρος, η μέθοδος. Склоняется как
    // мужской, различаются только артикли — они подставляются отдельно.
    if (w.endsWith('ός')) {
      const s = cut(2);
      return {
        genSg: s + 'ού', accSg: s + 'ό', vocSg: w,
        nomPl: s + 'οί', genPl: s + 'ών', accPl: s + 'ούς',
      };
    }
    if (w.endsWith('ος')) {
      const s = cut(2);
      return {
        genSg: shiftIfAntepenult(s + 'ου', w),
        accSg: s + 'ο',
        vocSg: w,
        nomPl: s + 'οι',
        genPl: shiftIfAntepenult(s + 'ων', w),
        accPl: shiftIfAntepenult(s + 'ους', w),
      };
    }
    return null;
  }

  // Средний род
  if (w.endsWith('μα')) {
    const s = cut(2);
    return {
      genSg: fixAccentPosition(s + 'ματος'), accSg: w, vocSg: w,
      nomPl: fixAccentPosition(s + 'ματα'),
      genPl: withStressedEnding(s, 'μάτων'),
      accPl: fixAccentPosition(s + 'ματα'),
    };
  }
  if (w.endsWith('ιο') || w.endsWith('ίο')) {
    // Родительный всегда на -ίου, с переносом ударения на этот слог:
    // δωμάτιο → δωματίου, εστιατόριο → εστιατορίου.
    const s = stripAccents(cut(2));
    return {
      genSg: s + 'ίου', accSg: w, vocSg: w,
      nomPl: fixAccentPosition(cut(1) + 'α'),
      genPl: s + 'ίων',
      accPl: fixAccentPosition(cut(1) + 'α'),
    };
  }
  if (w.endsWith('ό')) {
    const s = cut(1);
    return {
      genSg: s + 'ού', accSg: w, vocSg: w,
      nomPl: s + 'ά', genPl: s + 'ών', accPl: s + 'ά',
    };
  }
  if (w.endsWith('ο')) {
    const s = cut(1);
    return {
      genSg: shiftIfAntepenult(s + 'ου', w), accSg: w, vocSg: w,
      nomPl: fixAccentPosition(s + 'α'),
      genPl: shiftIfAntepenult(s + 'ων', w),
      accPl: fixAccentPosition(s + 'α'),
    };
  }
  if (w.endsWith('ί') || w.endsWith('ι')) {
    const s = stripAccents(cut(1));
    const oxy = isOxytone(w);
    return {
      genSg: s + 'ιού', accSg: w, vocSg: w,
      nomPl: oxy ? s + 'ιά' : fixAccentPosition(cut(1) + 'ια'),
      genPl: s + 'ιών',
      accPl: oxy ? s + 'ιά' : fixAccentPosition(cut(1) + 'ια'),
    };
  }
  if (w.endsWith('ος')) {
    const s = cut(2);
    return {
      genSg: s + 'ους', accSg: w, vocSg: w,
      nomPl: fixAccentPosition(s + 'η'),
      genPl: withStressedEnding(s, 'ών'),
      accPl: fixAccentPosition(s + 'η'),
    };
  }
  return null;
}

/** Множественное число именительного падежа. Род берём из артикля. */
export function pluralForm(el, article) {
  const w = el.trim();
  const gender = GENDER[article];
  if (!gender) return { skip: 'без артикля род неизвестен' };

  // Окончание под ударением остаётся ударным и во множественном числе:
  // το βουνό → τα βουνά, ο γιατρός → οι γιατροί. Поэтому окситонные типы
  // разбираются раньше своих безударных двойников.
  if (gender === 'n') {
    if (endsWith(w, 'μα')) return { plural: fixAccentPosition(w.slice(0, -2) + 'ματα') };
    if (endsWith(w, 'ιμο')) return { skip: 'отглагольные на -ιμο образуют -ίματα нерегулярно' };
    if (endsWith(w, 'ό')) return { plural: w.slice(0, -1) + 'ά' };
    if (endsWith(w, 'ο')) return { plural: fixAccentPosition(w.slice(0, -1) + 'α') };
    if (endsWith(w, 'ος')) return { plural: fixAccentPosition(w.slice(0, -2) + 'η') };
    if (endsWith(w, 'ί')) return { plural: w.slice(0, -1) + 'ιά' };
    if (endsWith(w, 'ι')) return { plural: fixAccentPosition(w.slice(0, -1) + 'ια') };
    return { skip: 'нестандартное окончание среднего рода' };
  }

  if (gender === 'f') {
    if (endsWith(w, 'ά')) return { plural: w.slice(0, -1) + 'ές' };
    if (endsWith(w, 'α')) return { plural: fixAccentPosition(w.slice(0, -1) + 'ες') };
    // Тип на -εις всегда безударный в окончании (πόλη, τάξη), поэтому
    // ударное -ή однозначно даёт -ές: η ζωή → οι ζωές.
    if (endsWith(w, 'ή')) return { plural: w.slice(0, -1) + 'ές' };
    if (endsWith(w, 'η')) {
      // η νίκη → οι νίκες, но η πόλη → οι πόλεις. По окончанию не различить.
      return { skip: 'женский род на безударное -η даёт и -ες, и -εις (νίκες / πόλεις)' };
    }
    if (endsWith(w, 'ος')) return { plural: fixAccentPosition(w.slice(0, -2) + 'οι') };
    return { skip: 'нестандартное окончание женского рода' };
  }

  if (endsWith(w, 'ές')) return { plural: w.slice(0, -2) + 'έδες' };
  if (endsWith(w, 'άς')) return { plural: w.slice(0, -2) + 'άδες' };
  if (endsWith(w, 'ούς')) return { plural: w.slice(0, -3) + 'ούδες' };
  if (endsWith(w, 'ός')) return { plural: w.slice(0, -2) + 'οί' };
  if (endsWith(w, 'ος')) return { plural: fixAccentPosition(w.slice(0, -2) + 'οι') };
  if (endsWith(w, 'ής')) return { plural: w.slice(0, -2) + 'ές' };
  if (endsWith(w, 'ας')) return { plural: fixAccentPosition(w.slice(0, -2) + 'ες') };
  if (endsWith(w, 'ης')) return { plural: fixAccentPosition(w.slice(0, -2) + 'ες') };
  return { skip: 'нестандартное окончание мужского рода' };
}
