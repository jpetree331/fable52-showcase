// Chemical formula parser: "Ca3(PO4)2", "CuSO4·5H2O", "Fe^3+", "[Fe(CN)6]^4-".
//
// Framework-free: runs unchanged in Node and in the browser.
//
// Grammar (recursive descent, one character of lookahead):
//
//   formula := group ( dot [count] group )* [charge] [state]
//   group   := ( element [count] | "(" group ")" [count] | "[" group "]" [count] )+
//   dot     := "·" | "." | "*"                      hydrate separator
//   charge  := "^" [n] sign | "^" sign [n] | sign+   "^2-", "^+", "+", "--", "²⁻"
//   state   := "(s)" | "(l)" | "(g)" | "(aq)"
//
// Unicode sub- and superscripts are read where they stand, so every error
// position is an index into the string the user actually typed.

import { ELEMENTS } from './elements.js';

export class ChemSyntaxError extends Error {
  /**
   * @param {string} message
   * @param {number} pos    index into `source` where the problem is
   * @param {string} source the text being parsed
   */
  constructor(message, pos, source) {
    super(message);
    this.name = 'ChemSyntaxError';
    this.pos = pos;
    this.source = source;
  }

  /** The source with a caret under the offending character. */
  get pointer() {
    return `${this.source}\n${' '.repeat(this.pos)}^`;
  }
}

const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉';
const SUPERSCRIPTS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const STATE = /^\((s|l|g|aq)\)/;
const MAX_COUNT = 1e6;

const countDigit = (ch) => {
  if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
  return ch === undefined ? -1 : SUBSCRIPTS.indexOf(ch);
};

const signOf = (ch) => {
  if (ch === '+' || ch === '⁺') return 1;
  if (ch === '-' || ch === '−' || ch === '⁻') return -1;
  return 0;
};

/**
 * @typedef {{type: 'element'|'count'|'open'|'close'|'dot'|'coefficient'|'charge', text: string}} Part
 * @typedef {{counts: Map<string, number>, charge: number, state: string|null, parts: Part[], electron: boolean}} Formula
 */

/**
 * Parse one chemical formula.
 * @param {string} source
 * @returns {Formula}
 * @throws {ChemSyntaxError}
 */
export function parseFormula(source) {
  const s = source;
  let i = 0;
  /** @type {Part[]} */
  const parts = [];

  const fail = (message, pos = i) => {
    throw new ChemSyntaxError(message, pos, s);
  };
  const skipSpace = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };
  const merge = (target, from, times) => {
    for (const [element, n] of from) target.set(element, (target.get(element) ?? 0) + n * times);
  };

  const readCount = () => {
    const start = i;
    let n = 0;
    while (countDigit(s[i]) >= 0) {
      n = n * 10 + countDigit(s[i]);
      if (n > MAX_COUNT) fail('That count is unreasonably large', start);
      i++;
    }
    if (i === start) return null;
    if (n === 0) fail('A count must be at least 1', start);
    return n;
  };

  const readGroup = () => {
    const counts = new Map();
    const start = i;
    for (;;) {
      const ch = s[i];
      if (ch >= 'A' && ch <= 'Z') {
        const next = s[i + 1];
        const symbol = next >= 'a' && next <= 'z' ? ch + next : ch;
        if (!ELEMENTS.has(symbol)) fail(`Unknown element "${symbol}"`);
        i += symbol.length;
        parts.push({ type: 'element', text: symbol });
        const n = readCount();
        if (n !== null) parts.push({ type: 'count', text: String(n) });
        counts.set(symbol, (counts.get(symbol) ?? 0) + (n ?? 1));
      } else if (ch === '(' || ch === '[') {
        if (STATE.test(s.slice(i))) break; // "(aq)" and friends belong to the caller
        const open = i;
        const closer = ch === '(' ? ')' : ']';
        i++;
        parts.push({ type: 'open', text: ch });
        const inner = readGroup();
        if (i >= s.length) fail(`This "${ch}" is never closed`, open);
        if (s[i] !== closer) fail(`Expected "${closer}" here`);
        i++;
        parts.push({ type: 'close', text: closer });
        const n = readCount();
        if (n !== null) parts.push({ type: 'count', text: String(n) });
        merge(counts, inner, n ?? 1);
      } else {
        break;
      }
    }
    if (i === start) fail(i >= s.length ? 'Expected a formula here' : `Unexpected "${s[i]}"`);
    return counts;
  };

  const readCharge = () => {
    const caret = s[i] === '^';
    if (caret) i++;
    const readMagnitude = () => {
      let n = null;
      for (;;) {
        const ch = s[i];
        if (ch === undefined) break;
        let d = SUPERSCRIPTS.indexOf(ch);
        // After "^" plain digits are a charge; without it they were a count.
        if (d < 0 && caret && ch >= '0' && ch <= '9') d = ch.charCodeAt(0) - 48;
        if (d < 0) break;
        n = (n ?? 0) * 10 + d;
        i++;
      }
      return n;
    };
    let magnitude = readMagnitude();
    let sign = 0;
    let run = 0;
    while (signOf(s[i]) !== 0) {
      if (sign !== 0 && signOf(s[i]) !== sign) fail('A charge cannot mix + and −');
      sign = signOf(s[i]);
      run++;
      i++;
    }
    if (run === 0) {
      if (caret || magnitude !== null) fail('Expected a charge sign (+ or −) here');
      return 0;
    }
    magnitude ??= readMagnitude();
    const value = magnitude ?? run;
    parts.push({ type: 'charge', text: `${value === 1 ? '' : value}${sign > 0 ? '+' : '−'}` });
    return sign * value;
  };

  skipSpace();

  // The electron is the one species with a charge and no elements.
  if (/^e(\^?[-−]|⁻)\s*$/.test(s.slice(i))) {
    return {
      counts: new Map(),
      charge: -1,
      state: null,
      electron: true,
      parts: [
        { type: 'element', text: 'e' },
        { type: 'charge', text: '−' },
      ],
    };
  }

  const counts = readGroup();
  while (s[i] === '·' || s[i] === '.' || s[i] === '*') {
    i++;
    parts.push({ type: 'dot', text: '·' });
    const multiplier = readCount();
    if (multiplier !== null) parts.push({ type: 'coefficient', text: String(multiplier) });
    merge(counts, readGroup(), multiplier ?? 1);
  }
  const charge = readCharge();
  let state = null;
  const stateMatch = STATE.exec(s.slice(i));
  if (stateMatch) {
    state = stateMatch[1];
    i += stateMatch[0].length;
  }
  skipSpace();
  if (i < s.length) fail(`Unexpected "${s[i]}"`);

  return { counts, charge, state, parts, electron: false };
}

/** Canonical plain-text spelling of parsed parts: "Fe2(SO4)3", "MnO4^-", "CuSO4·5H2O". */
export function partsToText(parts) {
  return parts
    .map((p) => (p.type === 'charge' ? `^${p.text.replace('−', '-')}` : p.text))
    .join('');
}

/**
 * Molar mass in g/mol.
 * @param {Map<string, number>} counts
 * @returns {{mass: number, approximate: boolean}} approximate when an element has no stable isotope
 */
export function molarMass(counts) {
  let mass = 0;
  let approximate = false;
  for (const [symbol, n] of counts) {
    const element = ELEMENTS.get(symbol);
    mass += element.weight * n;
    if (!element.stable) approximate = true;
  }
  return { mass, approximate };
}

/**
 * Element counts in Hill order: carbon, then hydrogen, then alphabetical —
 * or purely alphabetical when there is no carbon.
 * @param {Map<string, number>} counts
 * @returns {[string, number][]}
 */
export function hillOrder(counts) {
  const entries = [...counts].filter(([, n]) => n > 0);
  const hasCarbon = counts.get('C') > 0;
  const rank = (symbol) => (hasCarbon && symbol === 'C' ? 0 : hasCarbon && symbol === 'H' ? 1 : 2);
  return entries.sort(([a], [b]) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/** Hill-order formula as plain text, e.g. "C8H10N4O2" or "H4N^+". */
export function formatHill(counts, charge = 0) {
  const body = hillOrder(counts)
    .map(([symbol, n]) => (n === 1 ? symbol : `${symbol}${n}`))
    .join('');
  if (charge === 0) return body;
  const magnitude = Math.abs(charge) === 1 ? '' : Math.abs(charge);
  return `${body}^${magnitude}${charge > 0 ? '+' : '-'}`;
}

/**
 * Per-element share of the molar mass, in Hill order.
 * @param {Map<string, number>} counts
 * @returns {{symbol: string, count: number, mass: number, fraction: number}[]}
 */
export function massComposition(counts) {
  const { mass: total } = molarMass(counts);
  return hillOrder(counts).map(([symbol, count]) => {
    const mass = ELEMENTS.get(symbol).weight * count;
    return { symbol, count, mass, fraction: total === 0 ? 0 : mass / total };
  });
}
