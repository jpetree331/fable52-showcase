import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSmiles } from '../src/lib/smiles.js';
import { layout } from '../src/lib/layout.js';
import { depict } from '../src/lib/depict.js';
import { forAll } from './prop.js';
import { randomMolecule } from './molecules.js';

const place = (smiles) => {
  const mol = parseSmiles(smiles);
  return { mol, ...layout(mol) };
};
const gap = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const bondLengths = ({ mol, coords }) => mol.bonds.map((bond) => gap(coords[bond.a], coords[bond.b]));
const closestPair = ({ mol, coords }) => {
  let closest = Infinity;
  for (let a = 0; a < coords.length; a++) for (let b = a + 1; b < coords.length; b++) closest = Math.min(closest, gap(coords[a], coords[b]));
  return closest;
};

/** Molecules the method should draw perfectly: every bond length 1, nothing overlapping. */
const CLEAN = [
  ['ethanol', 'CCO'],
  ['decane', 'CCCCCCCCCC'],
  ['neopentane', 'CC(C)(C)C'],
  ['isooctane', 'CC(C)CC(C)(C)C'],
  ['benzene', 'c1ccccc1'],
  ['toluene', 'Cc1ccccc1'],
  ['naphthalene', 'c1ccc2ccccc2c1'],
  ['anthracene', 'c1ccc2cc3ccccc3cc2c1'],
  ['phenanthrene', 'c1ccc2c(c1)ccc1ccccc12'],
  ['pyrene (peri-fused)', 'c1cc2ccc3cccc4ccc(c1)c2c34'],
  ['coronene', 'c1cc2ccc3ccc4ccc5ccc6ccc1c1c2c3c4c5c61'],
  ['azulene (5 + 7)', 'c1ccc2cccc2cc1'],
  ['biphenyl', 'c1ccccc1c1ccccc1'],
  ['spiro[4.5]decane', 'C1CCC2(CC1)CCCC2'],
  ['steroid nucleus', 'C1CCC2C(C1)CCC1C2CCC2CCCC12'],
  ['caffeine', 'Cn1cnc2c1c(=O)n(C)c(=O)n2C'],
  ['aspirin', 'CC(=O)Oc1ccccc1C(=O)O'],
  ['ibuprofen', 'CC(C)Cc1ccc(cc1)C(C)C(=O)O'],
  ['dopamine', 'NCCc1ccc(O)c(O)c1'],
  ['nicotine', 'CN1CCCC1c1cccnc1'],
  ['indigo', 'O=C1C(=C2Nc3ccccc3C2=O)Nc2ccccc12'],
  ['capsaicin', 'COc1cc(CNC(=O)CCCC/C=C/C(C)C)ccc1O'],
  ['glucose', 'OCC1OC(O)C(O)C(O)C1O'],
  ['TNT', 'Cc1c(cc(cc1[N+](=O)[O-])[N+](=O)[O-])[N+](=O)[O-]'],
  ['cholesterol', 'CC(C)CCCC(C)C1CCC2C1(CCC3C2CC=C4C3(CCC(C4)O)C)C'],
  ['penicillin G', 'CC1(C)SC2C(NC(=O)Cc3ccccc3)C(=O)N2C1C(=O)O'],
];

for (const [name, smiles] of CLEAN) {
  test(`draws ${name} with unit bonds and no overlaps`, () => {
    const drawn = place(smiles);
    for (const length of bondLengths(drawn)) assert.ok(Math.abs(length - 1) < 1e-6, `bond length ${length}`);
    assert.ok(closestPair(drawn) > 0.45, `two atoms only ${closestPair(drawn).toFixed(3)} apart`);
  });
}

test('rings come out as regular polygons', () => {
  const { mol, coords } = place('c1ccccc1');
  const cx = coords.reduce((sum, p) => sum + p.x, 0) / 6;
  const cy = coords.reduce((sum, p) => sum + p.y, 0) / 6;
  for (const p of coords) assert.ok(Math.abs(gap(p, { x: cx, y: cy }) - 1) < 1e-9, 'hexagon vertices sit one bond from the centre');
  assert.equal(mol.rings.length, 1);
});

test('chains zig-zag at 120° and alkynes run straight', () => {
  const angleAt = (coords, a, b, c) => {
    const v1 = { x: coords[a].x - coords[b].x, y: coords[a].y - coords[b].y };
    const v2 = { x: coords[c].x - coords[b].x, y: coords[c].y - coords[b].y };
    return (Math.acos((v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y))) * 180) / Math.PI;
  };
  const butane = place('CCCC').coords;
  assert.ok(Math.abs(angleAt(butane, 0, 1, 2) - 120) < 1e-6);
  assert.ok(Math.abs(gap(butane[0], butane[3]) - Math.sqrt(7)) < 1e-6, 'anti, not eclipsed');
  const butyne = place('CC#CC').coords;
  assert.ok(Math.abs(angleAt(butyne, 0, 1, 2) - 180) < 1e-6);
  const allene = place('C=C=C').coords;
  assert.ok(Math.abs(angleAt(allene, 0, 1, 2) - 180) < 1e-6);
});

test('drawings are laid out wide rather than tall', () => {
  for (const smiles of ['CCCCCCCC', 'c1ccc2cc3ccccc3cc2c1', 'CC(C)Cc1ccc(cc1)C(C)C(=O)O']) {
    const { width, height } = place(smiles);
    assert.ok(width >= height, `${smiles}: ${width.toFixed(2)} × ${height.toFixed(2)}`);
  }
});

test('disconnected pieces are set side by side without touching', () => {
  const drawn = place('CC(=O)[O-].[Na+]');
  const sodium = drawn.coords[4];
  for (const p of drawn.coords.slice(0, 4)) assert.ok(gap(p, sodium) >= 1.5 - 1e-9, 'the ion stands clear of the acetate');
  assert.ok(drawn.coords.every((p) => p.x >= -1e-9 && p.y >= -1e-9));
});

test('bridged polycycles degrade gracefully', () => {
  // Stated limit: cage molecules cannot be drawn flat with unit bonds. The
  // promise is only that the result is finite, connected-looking and legible.
  for (const smiles of ['C1CC2CCC1C2', 'CC1(C)C2CCC1(C)C(=O)C2', 'C1C2CC3CC1CC(C2)C3', 'C12C3C4C1C5C2C3C45']) {
    const drawn = place(smiles);
    for (const length of bondLengths(drawn)) assert.ok(length > 0.3 && length < 2.6, `${smiles}: bond length ${length}`);
    assert.ok(closestPair(drawn) > 0.1, `${smiles}: atoms coincide`);
  }
});

test('depict produces well-formed SVG with the right labels', () => {
  const mol = parseSmiles('CC(=O)Oc1ccccc1C(=O)O');
  const svg = depict(mol, layout(mol), { title: 'aspirin' });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 [\d.]+ [\d.]+"/);
  assert.match(svg, /<title>aspirin<\/title>/);
  assert.equal(svg.match(/>O<\/text>/g).length, 4, 'four oxygens labelled');
  assert.equal(svg.match(/>H<\/text>/g).length, 1, 'one OH hydrogen');
  assert.ok(!/>C<\/text>/.test(svg), 'carbons are bare vertices');
  assert.ok(!/NaN|undefined|Infinity/.test(svg));
  // 13 bonds: 8 single + 5 double (two lines each) = 18 lines
  assert.equal(svg.match(/<line /g).length, 18);
});

test('depict labels lone carbons, charges and isotopes', () => {
  const draw = (smiles) => {
    const mol = parseSmiles(smiles);
    return depict(mol, layout(mol));
  };
  assert.match(draw('C'), />C<\/text>.*>H<tspan[^>]*>4<\/tspan>/);
  assert.match(draw('[NH4+]'), />N<\/text>.*>\+<\/text>/);
  assert.match(draw('[O-]S(=O)(=O)[O-]'), />−<\/text>/);
  assert.match(draw('[13CH4]'), />13<\/text>/);
});

// ---- properties -----------------------------------------------------------

test('property: every acyclic molecule gets exact unit bonds', () => {
  forAll(
    (g, size) => randomMolecule(g, size, { rings: 0 }),
    (made) => {
      const drawn = place(made.smiles);
      for (const length of bondLengths(drawn)) assert.ok(Math.abs(length - 1) < 1e-6, `bond length ${length}`);
    },
    { runs: 400, maxSize: 12, show: (made) => made.smiles },
  );
});

test('property: any molecule at all gets finite, drawable coordinates', () => {
  forAll(
    (g, size) => randomMolecule(g, size, { rings: 5 }),
    (made) => {
      const drawn = place(made.smiles);
      assert.equal(drawn.coords.length, made.atomCount);
      for (const p of drawn.coords) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), 'coordinates are finite');
      assert.ok(Number.isFinite(drawn.width) && Number.isFinite(drawn.height));
      for (const length of bondLengths(drawn)) assert.ok(length > 1e-3, 'no bond collapses to a point');
      assert.ok(!/NaN|undefined|Infinity/.test(depict(drawn.mol, drawn)));
    },
    { runs: 500, maxSize: 12, show: (made) => made.smiles },
  );
});
