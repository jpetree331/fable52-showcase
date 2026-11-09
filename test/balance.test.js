import test from 'node:test';
import assert from 'node:assert/strict';
import { balance, parseEquation, formatEquation, nullSpace } from '../src/lib/balance.js';
import { ChemSyntaxError } from '../src/lib/formula.js';
import { Rational } from '../src/lib/rational.js';
import { forAll } from './prop.js';

/**
 * An independent referee. It shares no code with the balancer's linear
 * algebra: it just multiplies and adds with plain integers.
 */
function assertConserved(result) {
  const species = [...result.reactants, ...result.products];
  const split = result.reactants.length;
  const net = new Map();
  let charge = 0;
  species.forEach((sp, j) => {
    const signed = (j < split ? 1 : -1) * result.coefficients[j];
    for (const [element, n] of sp.counts) net.set(element, (net.get(element) ?? 0) + signed * n);
    charge += signed * sp.charge;
  });
  for (const [element, leftover] of net) assert.equal(leftover, 0, `${element} is not conserved`);
  assert.equal(charge, 0, 'charge is not conserved');
  assert.ok(result.coefficients.every((c) => Number.isInteger(c) && c > 0), 'coefficients are positive integers');
}

const gcd2 = (a, b) => (b === 0 ? a : gcd2(b, a % b));
const gcdAll = (numbers) => numbers.reduce(gcd2, 0);

const KNOWN = [
  ['H2 + O2 -> H2O', [2, 1, 2]],
  ['Fe + O2 -> Fe2O3', [4, 3, 2]],
  ['C8H18 + O2 -> CO2 + H2O', [2, 25, 16, 18]],
  ['C6H12O6 + O2 -> CO2 + H2O', [1, 6, 6, 6]],
  ['Al + HCl -> AlCl3 + H2', [2, 6, 2, 3]],
  ['H2O2 -> H2O + O2', [2, 2, 1]],
  ['S8 + F2 -> SF6', [1, 24, 8]],
  ['P4O10 + H2O -> H3PO4', [1, 6, 4]],
  ['NH3 + O2 -> NO + H2O', [4, 5, 4, 6]],
  ['Na2CO3 + HCl -> NaCl + H2O + CO2', [1, 2, 2, 1, 1]],
  ['Fe2(SO4)3 + KOH -> K2SO4 + Fe(OH)3', [1, 6, 3, 2]],
  ['Cu + HNO3 -> Cu(NO3)2 + NO + H2O', [3, 8, 3, 2, 4]],
  ['KMnO4 + HCl -> KCl + MnCl2 + H2O + Cl2', [2, 16, 2, 2, 8, 5]],
  ['Ca3(PO4)2 + SiO2 + C -> CaSiO3 + CO + P4', [2, 6, 10, 6, 10, 1]],
  ['CuSO4·5H2O -> CuSO4 + H2O', [1, 1, 5]],
  // ionic and redox: charge is conserved alongside the atoms
  ['Zn + Ag+ -> Zn^2+ + Ag', [1, 2, 1, 2]],
  ['MnO4^- + Fe^2+ + H^+ -> Mn^2+ + Fe^3+ + H2O', [1, 5, 8, 1, 5, 4]],
  ['Cr2O7^2- + H+ + e- -> Cr^3+ + H2O', [1, 14, 6, 2, 7]],
  ['MnO₄⁻ + Fe²⁺ + H⁺ → Mn²⁺ + Fe³⁺ + H₂O', [1, 5, 8, 1, 5, 4]],
  // the classic stress tests
  [
    'K4Fe(CN)6 + KMnO4 + H2SO4 -> KHSO4 + Fe2(SO4)3 + MnSO4 + HNO3 + CO2 + H2O',
    [10, 122, 299, 162, 5, 122, 60, 60, 188],
  ],
  [
    '[Cr(N2H4CO)6]4[Cr(CN)6]3 + KMnO4 + H2SO4 -> K2Cr2O7 + MnSO4 + CO2 + KNO3 + K2SO4 + H2O',
    [10, 1176, 1399, 35, 1176, 420, 660, 223, 1879],
  ],
];

for (const [equation, expected] of KNOWN) {
  test(`balances ${equation}`, () => {
    const result = balance(equation);
    assert.equal(result.status, 'balanced');
    assert.deepEqual(result.coefficients, expected);
    assertConserved(result);
    assert.ok(Math.abs(result.mass.left - result.mass.right) < 1e-6 * result.mass.left, 'mass is conserved');
  });
}

test('ignores coefficients the user already wrote, and odd spacing', () => {
  assert.deepEqual(balance('2 H2 + O2 -> 2 H2O').coefficients, [2, 1, 2]);
  assert.deepEqual(balance('7H2+3O2=H2O').coefficients, [2, 1, 2]);
  assert.deepEqual(balance('  H2   +O2  =>  H2O ').coefficients, [2, 1, 2]);
  assert.deepEqual(balance('Na+ + Cl- -> NaCl').coefficients, [1, 1, 1]);
  assert.deepEqual(balance('Ca++ + F- -> CaF2').coefficients, [1, 2, 1]);
});

test('tells "+" the separator from "+" the charge', () => {
  const eq = parseEquation('H+ + OH- <=> H2O');
  assert.deepEqual(eq.reactants.map((sp) => [sp.text, sp.charge]), [['H^+', 1], ['OH^-', -1]]);
  assert.equal(eq.reversible, true);
});

test('formats a balanced equation as text', () => {
  assert.equal(formatEquation(balance('Fe + O2 -> Fe2O3')), '4 Fe + 3 O2 -> 2 Fe2O3');
  assert.equal(formatEquation(balance('H2 + N2 <=> NH3')), '3 H2 + N2 <=> 2 NH3');
});

test('reports equations that cannot be balanced, and why', () => {
  const stranded = balance('H2 + O2 -> H2O2 + Au');
  assert.equal(stranded.status, 'impossible');
  assert.match(stranded.reason, /Au appears only among the products/);

  const wrongMetal = balance('Na + Cl2 -> KCl');
  assert.equal(wrongMetal.status, 'impossible');
  assert.match(wrongMetal.reason, /Na appears only among the reactants/);

  assert.equal(balance('H2O -> H2O2').status, 'impossible');

  const wrongSide = balance('CO2 + H2O + O2 -> C6H12O6');
  assert.equal(wrongSide.status, 'impossible');
  assert.match(wrongSide.reason, /O2 is a product, not a reactant/);
});

test('recognises several reactions written as one', () => {
  const permanganate = balance('KMnO4 + H2O2 + H2SO4 -> MnSO4 + O2 + K2SO4 + H2O');
  assert.equal(permanganate.status, 'underdetermined');
  assert.equal(permanganate.dimension, 2);
  assertConserved(permanganate); // the one it shows is still a true balancing

  const carbon = balance('C + O2 -> CO + CO2');
  assert.equal(carbon.status, 'underdetermined');
  assert.equal(carbon.dimension, 2);
  assertConserved(carbon);
});

test('syntax errors carry a position in the whole equation', () => {
  const failure = (text) => {
    try {
      balance(text);
    } catch (err) {
      assert.ok(err instanceof ChemSyntaxError);
      return err;
    }
    return assert.fail(`${text} should not parse`);
  };
  assert.equal(failure('H2 + O2').message.startsWith('No reaction arrow'), true);
  assert.equal(failure('H2 + Qq -> H2O').pos, 5);
  assert.equal(failure('H2 + -> H2O').message, 'A species is missing here');
  assert.equal(failure('H2 -> O2 -> H2O').message, 'Only one reaction arrow is allowed');
});

test('nullSpace returns vectors the matrix really annihilates', () => {
  const m = [
    [1, 2, 3, 4],
    [2, 4, 6, 8],
    [0, 1, 1, 0],
  ].map((row) => row.map((x) => Rational.of(x)));
  const basis = nullSpace(m);
  assert.equal(basis.length, 2); // rank 2, four columns
  for (const v of basis) {
    for (const row of m) {
      const dot = row.reduce((sum, x, j) => sum.add(x.mul(v[j])), Rational.of(0));
      assert.ok(dot.isZero());
    }
  }
});

// ---- properties -----------------------------------------------------------

const METALS = ['Na', 'K', 'Ca', 'Fe', 'Cu', 'Al', 'Mg', 'Zn'];
const NONMETALS = ['O', 'Cl', 'S', 'N', 'F', 'Br'];
const DIATOMIC = new Set(['O', 'Cl', 'N', 'F', 'Br', 'H']);

test('property: formation from the elements has one answer, and we find it', () => {
  // Elements -> one compound always has a unique balancing, which can be
  // written down directly without any linear algebra.
  forAll(
    (g, size) => {
      const picks = [g.pick(METALS), ...g.shuffle(NONMETALS).slice(0, g.int(1, 1 + Math.min(size, 2)))];
      return g.shuffle(picks.map((symbol) => [symbol, g.int(1, 3 + size)]));
    },
    (compound) => {
      const product = compound.map(([symbol, n]) => (n === 1 ? symbol : symbol + n)).join('');
      const reactants = compound.map(([symbol]) => (DIATOMIC.has(symbol) ? `${symbol}2` : symbol));
      const result = balance(`${reactants.join(' + ')} -> ${product}`);
      assert.equal(result.status, 'balanced');
      assertConserved(result);

      // expected: per one product, n (or n/2 for diatomics) of each element; clear the halves; reduce
      const halves = compound.map(([symbol, n]) => (DIATOMIC.has(symbol) ? n : 2 * n));
      const raw = [...halves, 2];
      const common = gcdAll(raw);
      assert.deepEqual(result.coefficients, raw.map((x) => x / common));
    },
    { runs: 300 },
  );
});

test('property: combustion of any CxHyOz matches its closed form', () => {
  // CxHyOz + (x + y/4 − z/2) O2 -> x CO2 + (y/2) H2O, cleared of fractions.
  forAll(
    (g, size) => ({ x: g.int(1, 2 + size * 3), y: g.int(1, 4 + size * 6), z: g.int(0, size) }),
    ({ x, y, z }) => {
      const oxygen = 4 * x + y - 2 * z; // four times the O2 coefficient
      if (oxygen <= 0) return; // already oxidised past CO2 + H2O: not a combustion
      const fuel = `C${x}H${y}${z === 0 ? '' : `O${z}`}`;
      const result = balance(`${fuel} + O2 -> CO2 + H2O`);
      const raw = [4, oxygen, 4 * x, 2 * y];
      const common = gcdAll(raw);
      assert.equal(result.status, 'balanced');
      assert.deepEqual(result.coefficients, raw.map((n) => n / common));
      assertConserved(result);
    },
    { runs: 400 },
  );
});

test('property: the answer does not depend on the order species are written', () => {
  forAll(
    (g) => {
      const [equation] = g.pick(KNOWN.slice(0, 18));
      const [left, right] = equation.split(/\s*(?:->|→)\s*/);
      return { equation, left: g.shuffle(left.split(' + ')), right: g.shuffle(right.split(' + ')), flip: g.bool() };
    },
    ({ equation, left, right, flip }) => {
      const original = balance(equation);
      const byText = new Map([...original.reactants, ...original.products].map((sp, j) => [sp.text, original.coefficients[j]]));
      const sides = flip ? [right, left] : [left, right];
      const shuffled = balance(`${sides[0].join(' + ')} -> ${sides[1].join(' + ')}`);
      assert.equal(shuffled.status, 'balanced');
      [...shuffled.reactants, ...shuffled.products].forEach((sp, j) => {
        assert.equal(shuffled.coefficients[j], byText.get(sp.text), `coefficient of ${sp.text}`);
      });
    },
    { runs: 200 },
  );
});

test('property: on arbitrary equations, any answer given is a true one', () => {
  // Two pools: a wide one that mostly cannot balance, and a C/H/O one that
  // mostly can — so both the refusals and the answers get exercised.
  const wide = ['H2', 'O2', 'H2O', 'CO2', 'CO', 'CH4', 'C2H6', 'NH3', 'N2', 'NO2', 'HNO3', 'HCl', 'Cl2', 'NaCl', 'NaOH', 'Na', 'Fe', 'Fe2O3', 'FeCl3', 'H2SO4', 'SO2', 'S'];
  const narrow = ['H2', 'O2', 'H2O', 'CO2', 'CO', 'CH4', 'C2H6', 'C2H4', 'C2H2', 'C', 'H2O2', 'CH3OH', 'C2H5OH', 'HCOOH', 'C6H12O6'];
  let answered = 0;
  forAll(
    (g, size) => {
      const picks = g.shuffle(g.bool() ? wide : narrow).slice(0, g.int(2, 3 + Math.min(size, 3)));
      const cut = g.int(1, picks.length - 1);
      return `${picks.slice(0, cut).join(' + ')} -> ${picks.slice(cut).join(' + ')}`;
    },
    (equation) => {
      const result = balance(equation);
      if (result.status === 'impossible') return assert.ok(result.reason.length > 0);
      answered++;
      assertConserved(result);
      assert.equal(gcdAll(result.coefficients), 1, 'coefficients share no common factor');
    },
    { runs: 600, show: (equation) => equation },
  );
  assert.ok(answered > 15, `the generator should reach equations that do balance (got ${answered})`);
});
