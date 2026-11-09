import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFormula, molarMass, formatHill, hillOrder, massComposition, partsToText, ChemSyntaxError } from '../src/lib/formula.js';
import { ELEMENTS } from '../src/lib/elements.js';
import { forAll } from './prop.js';

const counts = (text) => Object.fromEntries(parseFormula(text).counts);

test('the periodic table is complete and in order', () => {
  assert.equal(ELEMENTS.size, 118);
  assert.equal(ELEMENTS.get('H').number, 1);
  assert.equal(ELEMENTS.get('Fe').number, 26);
  assert.equal(ELEMENTS.get('Au').number, 79);
  assert.equal(ELEMENTS.get('U').number, 92);
  assert.equal(ELEMENTS.get('Og').number, 118);
  assert.equal(ELEMENTS.get('Tc').stable, false);
  assert.equal(ELEMENTS.get('Bi').stable, true);
});

test('parses simple and nested formulas', () => {
  assert.deepEqual(counts('H2O'), { H: 2, O: 1 });
  assert.deepEqual(counts('Ca(OH)2'), { Ca: 1, O: 2, H: 2 });
  assert.deepEqual(counts('Ca3(PO4)2'), { Ca: 3, P: 2, O: 8 });
  assert.deepEqual(counts('K4[Fe(CN)6]'), { K: 4, Fe: 1, C: 6, N: 6 });
  assert.deepEqual(counts('CH3COOH'), { C: 2, H: 4, O: 2 });
  assert.deepEqual(counts('[Cr(N2H4CO)6]4[Cr(CN)6]3'), { Cr: 7, N: 66, H: 96, C: 42, O: 24 });
});

test('distinguishes Co from CO by case', () => {
  assert.deepEqual(counts('Co'), { Co: 1 });
  assert.deepEqual(counts('CO'), { C: 1, O: 1 });
});

test('parses hydrates', () => {
  assert.deepEqual(counts('CuSO4·5H2O'), { Cu: 1, S: 1, O: 9, H: 10 });
  assert.deepEqual(counts('CuSO4.5H2O'), { Cu: 1, S: 1, O: 9, H: 10 });
  assert.deepEqual(counts('Na2CO3*10H2O'), { Na: 2, C: 1, O: 13, H: 20 });
});

test('parses charges in every common spelling', () => {
  assert.equal(parseFormula('Na+').charge, 1);
  assert.equal(parseFormula('Cl-').charge, -1);
  assert.equal(parseFormula('Fe^3+').charge, 3);
  assert.equal(parseFormula('SO4^2-').charge, -2);
  assert.equal(parseFormula('Ca++').charge, 2);
  assert.equal(parseFormula('O^-2').charge, -2);
  assert.equal(parseFormula('Fe³⁺').charge, 3);
  assert.equal(parseFormula('SO₄²⁻').charge, -2);
  assert.deepEqual(counts('SO₄²⁻'), { S: 1, O: 4 });
  assert.equal(parseFormula('MnO4^-').charge, -1);
  assert.equal(parseFormula('[Fe(CN)6]^4-').charge, -4);
});

test('parses the electron and physical states', () => {
  const electron = parseFormula('e-');
  assert.equal(electron.charge, -1);
  assert.equal(electron.counts.size, 0);
  assert.equal(parseFormula('e^-').electron, true);
  assert.equal(parseFormula('NaCl(aq)').state, 'aq');
  assert.equal(parseFormula('H2O(l)').state, 'l');
  assert.equal(parseFormula('Cu^2+(aq)').charge, 2);
});

test('molar masses match reference values', () => {
  const mass = (text) => molarMass(parseFormula(text).counts).mass;
  const close = (text, expected) => assert.ok(Math.abs(mass(text) - expected) < 0.01, `${text}: ${mass(text)} vs ${expected}`);
  close('H2O', 18.015);
  close('NaCl', 58.44);
  close('C6H12O6', 180.156);
  close('Ca(OH)2', 74.092);
  close('(NH4)2SO4', 132.134);
  close('CuSO4·5H2O', 249.677);
  close('K4[Fe(CN)6]', 368.345);
  close('C8H10N4O2', 194.194);
});

test('flags molar masses built on elements with no stable isotope', () => {
  assert.equal(molarMass(parseFormula('UO2').counts).approximate, false);
  assert.equal(molarMass(parseFormula('PuO2').counts).approximate, true);
});

test('Hill order: carbon, hydrogen, then alphabetical', () => {
  assert.equal(formatHill(parseFormula('OHCH2CH3').counts), 'C2H6O');
  assert.equal(formatHill(parseFormula('SO4H2').counts), 'H2O4S');
  assert.equal(formatHill(parseFormula('NaCl').counts), 'ClNa');
  assert.equal(formatHill(parseFormula('NH4+').counts, 1), 'H4N^+');
  assert.deepEqual(hillOrder(parseFormula('BrCH3').counts).map(([s]) => s), ['C', 'H', 'Br']);
});

test('mass composition sums to one', () => {
  const parts = massComposition(parseFormula('C6H12O6').counts);
  assert.ok(Math.abs(parts.reduce((sum, p) => sum + p.fraction, 0) - 1) < 1e-12);
  assert.ok(Math.abs(parts.find((p) => p.symbol === 'C').fraction - 0.4) < 0.001);
});

test('errors point at the offending character', () => {
  const at = (text) => {
    try {
      parseFormula(text);
    } catch (err) {
      assert.ok(err instanceof ChemSyntaxError, `expected a ChemSyntaxError for ${text}`);
      return [err.pos, err.message];
    }
    return assert.fail(`${text} should not parse`);
  };
  assert.deepEqual(at('H2Xx'), [2, 'Unknown element "Xx"']);
  assert.deepEqual(at('Ca(OH2'), [2, 'This "(" is never closed']);
  assert.deepEqual(at('H0'), [1, 'A count must be at least 1']);
  assert.deepEqual(at(''), [0, 'Expected a formula here']);
  assert.deepEqual(at('H2O)'), [3, 'Unexpected ")"']);
  assert.deepEqual(at('Fe^3'), [4, 'Expected a charge sign (+ or −) here']);
  assert.deepEqual(at('h2o'), [0, 'Unexpected "h"']);
  assert.equal(new ChemSyntaxError('x', 2, 'H2Xx').pointer, 'H2Xx\n  ^');
});

test('property: printing counts and parsing them back is the identity', () => {
  const symbols = ['H', 'C', 'N', 'O', 'Na', 'Cl', 'Fe', 'Cu', 'S', 'K', 'Mn', 'U'];
  forAll(
    (g, size) => g.shuffle(symbols).slice(0, g.int(1, 1 + size)).map((symbol) => [symbol, g.int(1, 40)]),
    (entries) => {
      const text = entries.map(([symbol, n]) => (n === 1 ? symbol : symbol + n)).join('');
      assert.deepEqual([...parseFormula(text).counts], entries);
      assert.equal(partsToText(parseFormula(text).parts), text);
    },
    { runs: 300 },
  );
});

test('property: a multiplied group equals its contents written out', () => {
  const symbols = ['H', 'C', 'N', 'O', 'S', 'P'];
  forAll(
    (g) => ({
      inner: g.shuffle(symbols).slice(0, g.int(1, 3)).map((symbol) => [symbol, g.int(1, 9)]),
      times: g.int(1, 12),
      bracket: g.pick(['()', '[]']),
    }),
    ({ inner, times, bracket }) => {
      const body = inner.map(([symbol, n]) => (n === 1 ? symbol : symbol + n)).join('');
      const grouped = parseFormula(`Na${bracket[0]}${body}${bracket[1]}${times === 1 ? '' : times}`).counts;
      const flat = parseFormula(`Na${inner.map(([symbol, n]) => symbol + n * times).join('')}`).counts;
      assert.deepEqual([...grouped].sort(), [...flat].sort());
    },
    { runs: 300 },
  );
});
