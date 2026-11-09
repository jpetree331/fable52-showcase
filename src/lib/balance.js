// Chemical equation balancer.
//
// Framework-free: runs unchanged in Node and in the browser.
//
// Balancing is linear algebra. Give every species an unknown coefficient and
// every element (plus net charge, when ions are present) a conservation row;
// the balanced equations are exactly the null space of that matrix. So:
//
//   nullity 0   nothing but all-zeros works: the equation cannot be balanced
//   nullity 1   one answer up to scale: reduce it to smallest whole numbers
//   nullity 2+  infinitely many independent answers: the "equation" is
//               really several reactions added together, and we say so
//               instead of quietly picking one
//
// Elimination runs over exact rationals, so large coefficients stay exact.

import { ChemSyntaxError, parseFormula, partsToText, molarMass } from './formula.js';
import { Rational, ZERO, ONE, toIntegers, gcd } from './rational.js';

const ARROW = /<?-+>|<?=+>|[→⟶⇌⇄⟷]|=/g;

/**
 * @typedef {import('./formula.js').Formula & {text: string, start: number, end: number}} Species
 */

/**
 * Split one side of an equation into term ranges.
 *
 * The only hard part is "+", which is both the separator and a charge sign.
 * A "+" with whitespace before it always separates. One glued to a term is a
 * charge when nothing but another "+" (or the end) follows: "Na+ + Cl-".
 */
function splitTerms(source, from, to) {
  const ranges = [];
  let start = from;
  const nextSolid = (k) => {
    while (k < to && /\s/.test(source[k])) k++;
    return k;
  };
  for (let i = from; i < to; i++) {
    if (source[i] !== '+') continue;
    const glued = i > start && !/\s/.test(source[i - 1]);
    if (glued) {
      const k = nextSolid(i + 1);
      if (k >= to || source[k] === '+') continue; // charge sign
    }
    ranges.push([start, i]);
    start = i + 1;
  }
  ranges.push([start, to]);
  return ranges;
}

/** Parse one term, dropping any coefficient the user already wrote. */
function parseTerm(source, [from, to]) {
  let start = from;
  while (start < to && /\s/.test(source[start])) start++;
  let end = to;
  while (end > start && /\s/.test(source[end - 1])) end--;
  if (start === end) throw new ChemSyntaxError('A species is missing here', Math.min(start, source.length), source);

  const coefficient = /^\d+\s*(?=[A-Za-z([])/.exec(source.slice(start, end));
  if (coefficient) start += coefficient[0].length;

  try {
    const formula = parseFormula(source.slice(start, end));
    return { ...formula, text: partsToText(formula.parts), start, end };
  } catch (err) {
    // Re-anchor the caret from the term to the whole equation.
    if (err instanceof ChemSyntaxError) throw new ChemSyntaxError(err.message, err.pos + start, source);
    throw err;
  }
}

/**
 * @param {string} source e.g. "Fe + O2 -> Fe2O3"
 * @returns {{reactants: Species[], products: Species[], reversible: boolean}}
 * @throws {ChemSyntaxError}
 */
export function parseEquation(source) {
  const arrows = [...source.matchAll(ARROW)];
  if (arrows.length === 0) {
    throw new ChemSyntaxError('No reaction arrow — put "->" or "=" between reactants and products', source.length, source);
  }
  if (arrows.length > 1) throw new ChemSyntaxError('Only one reaction arrow is allowed', arrows[1].index, source);
  const [arrow] = arrows;
  const side = (from, to) => splitTerms(source, from, to).map((range) => parseTerm(source, range));
  return {
    reactants: side(0, arrow.index),
    products: side(arrow.index + arrow[0].length, source.length),
    reversible: /[<⇌⇄⟷]/.test(arrow[0]),
  };
}

/**
 * Basis of the null space of a rational matrix, by reduction to RREF.
 * @param {Rational[][]} matrix
 * @returns {Rational[][]} one vector per free column
 */
export function nullSpace(matrix) {
  const rows = matrix.map((row) => row.slice());
  const width = rows[0]?.length ?? 0;
  const pivots = [];
  let r = 0;
  for (let c = 0; c < width && r < rows.length; c++) {
    let p = r;
    while (p < rows.length && rows[p][c].isZero()) p++;
    if (p === rows.length) continue;
    [rows[r], rows[p]] = [rows[p], rows[r]];
    const lead = rows[r][c];
    rows[r] = rows[r].map((x) => x.div(lead));
    for (let k = 0; k < rows.length; k++) {
      if (k === r || rows[k][c].isZero()) continue;
      const factor = rows[k][c];
      rows[k] = rows[k].map((x, j) => x.sub(factor.mul(rows[r][j])));
    }
    pivots.push(c);
    r++;
  }
  const basis = [];
  for (let free = 0; free < width; free++) {
    if (pivots.includes(free)) continue;
    const vector = new Array(width).fill(ZERO);
    vector[free] = ONE;
    pivots.forEach((pivotColumn, row) => {
      vector[pivotColumn] = rows[row][free].neg();
    });
    basis.push(vector);
  }
  return basis;
}

/**
 * With several independent balancings, look for the smallest all-positive
 * whole-number combination of them, so there is something concrete to show.
 * @param {bigint[][]} basis
 * @returns {bigint[] | null}
 */
function smallestPositiveCombination(basis) {
  const k = basis.length;
  if (k > 5) return null;
  const bound = [0, 0, 12, 6, 3, 3][k];
  const width = basis[0].length;
  let best = null;
  let bestSum = null;
  const weights = new Array(k).fill(-bound);
  for (;;) {
    const combo = new Array(width).fill(0n);
    for (let b = 0; b < k; b++) {
      if (weights[b] === 0) continue;
      const w = BigInt(weights[b]);
      for (let j = 0; j < width; j++) combo[j] += w * basis[b][j];
    }
    if (combo.every((x) => x > 0n)) {
      const common = combo.reduce((acc, x) => gcd(acc, x), 0n);
      const reduced = combo.map((x) => x / common);
      const sum = reduced.reduce((acc, x) => acc + x, 0n);
      if (bestSum === null || sum < bestSum) {
        best = reduced;
        bestSum = sum;
      }
    }
    let d = 0;
    while (d < k && weights[d] === bound) weights[d++] = -bound;
    if (d === k) break;
    weights[d]++;
  }
  return best;
}

/** The plainest reason an equation cannot balance: an element present on one side only. */
function strandedElement(eq, elements) {
  const onLeft = (el) => eq.reactants.some((sp) => sp.counts.has(el));
  const onRight = (el) => eq.products.some((sp) => sp.counts.has(el));
  const el = elements.find((candidate) => onLeft(candidate) !== onRight(candidate));
  if (el === undefined) return null;
  return `${el} appears only among the ${onLeft(el) ? 'reactants' : 'products'}, so it can never be conserved.`;
}

/**
 * @typedef {object} BalanceResult
 * @property {'balanced'|'underdetermined'|'impossible'} status
 * @property {Species[]} reactants
 * @property {Species[]} products
 * @property {boolean} reversible
 * @property {number[]} [coefficients]  reactants then products
 * @property {number} [dimension]       number of independent balancings (underdetermined)
 * @property {string} [reason]          why not (impossible)
 * @property {{label: string, left: number, right: number}[]} [tally]
 * @property {{left: number, right: number, approximate: boolean}} [mass]
 */

/**
 * Balance a chemical equation.
 * @param {string} source
 * @returns {BalanceResult}
 * @throws {ChemSyntaxError} when the text is not an equation at all
 */
export function balance(source) {
  const eq = parseEquation(source);
  const species = [...eq.reactants, ...eq.products];
  const split = eq.reactants.length;
  const signed = (value, column) => Rational.of(column < split ? value : -value);

  const elements = [];
  for (const sp of species) for (const el of sp.counts.keys()) if (!elements.includes(el)) elements.push(el);

  const matrix = elements.map((el) => species.map((sp, j) => signed(sp.counts.get(el) ?? 0, j)));
  const ionic = species.some((sp) => sp.charge !== 0);
  if (ionic) matrix.push(species.map((sp, j) => signed(sp.charge, j)));

  const basis = nullSpace(matrix).map(toIntegers);
  const base = { reactants: eq.reactants, products: eq.products, reversible: eq.reversible };

  const impossible = (reason) => ({ ...base, status: 'impossible', reason: strandedElement(eq, elements) ?? reason });
  if (basis.length === 0) return impossible('No set of coefficients conserves every element at once.');

  let solution;
  if (basis.length === 1) {
    solution = basis[0];
    // The null vector's overall sign is arbitrary; point it the mostly-positive way.
    const negatives = solution.filter((x) => x < 0n).length;
    const positives = solution.filter((x) => x > 0n).length;
    if (negatives > positives) solution = solution.map((x) => -x);
    const zero = solution.findIndex((x) => x === 0n);
    if (zero >= 0) {
      return impossible(`${species[zero].text} cannot take part: the only balancing gives it a coefficient of zero.`);
    }
    const negative = solution.findIndex((x) => x < 0n);
    if (negative >= 0) {
      const from = negative < split ? 'reactant' : 'product';
      const to = negative < split ? 'product' : 'reactant';
      return impossible(`It only balances if ${species[negative].text} is a ${to}, not a ${from}.`);
    }
  } else {
    solution = smallestPositiveCombination(basis);
    if (solution === null) {
      return impossible(
        `There are ${basis.length} independent ways to conserve the atoms here, but none keeps every species on the side it was written.`,
      );
    }
  }

  const coefficients = solution.map(Number);
  const total = (measure, from, to) => {
    let sum = 0;
    for (let j = from; j < to; j++) sum += coefficients[j] * measure(species[j]);
    return sum;
  };
  const row = (label, measure) => ({
    label,
    left: total(measure, 0, split),
    right: total(measure, split, species.length),
  });
  const tally = elements.map((el) => row(el, (sp) => sp.counts.get(el) ?? 0));
  if (ionic) tally.push(row('charge', (sp) => sp.charge));

  const massRow = row('mass', (sp) => molarMass(sp.counts).mass);
  const approximate = species.some((sp) => molarMass(sp.counts).approximate);

  return {
    ...base,
    status: basis.length === 1 ? 'balanced' : 'underdetermined',
    dimension: basis.length,
    coefficients,
    tally,
    mass: { left: massRow.left, right: massRow.right, approximate },
  };
}

/** Plain-text rendering of a balanced result: "4 Fe + 3 O2 -> 2 Fe2O3". */
export function formatEquation(result) {
  const split = result.reactants.length;
  const term = (sp, j) => {
    const c = result.coefficients?.[j] ?? 1;
    return c === 1 ? sp.text : `${c} ${sp.text}`;
  };
  const left = result.reactants.map((sp, j) => term(sp, j)).join(' + ');
  const right = result.products.map((sp, j) => term(sp, j + split)).join(' + ');
  return `${left} ${result.reversible ? '<=>' : '->'} ${right}`;
}
