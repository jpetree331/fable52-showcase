import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSmiles, molecularFormula } from '../src/lib/smiles.js';
import { formatHill, molarMass, ChemSyntaxError } from '../src/lib/formula.js';
import { perceiveRings } from '../src/lib/rings.js';
import { forAll } from './prop.js';
import { randomMolecule } from './molecules.js';

const formulaOf = (smiles) => {
  const { counts, charge } = molecularFormula(parseSmiles(smiles));
  return formatHill(counts, charge);
};

const KNOWN = [
  ['methane', 'C', 'CH4'],
  ['water', 'O', 'H2O'],
  ['ethanol', 'CCO', 'C2H6O'],
  ['carbon dioxide', 'O=C=O', 'CO2'],
  ['hydrogen cyanide', 'C#N', 'CHN'],
  ['acetonitrile', 'CC#N', 'C2H3N'],
  ['acetic acid', 'CC(=O)O', 'C2H4O2'],
  ['benzene', 'c1ccccc1', 'C6H6'],
  ['benzene, Kekulé form', 'C1=CC=CC=C1', 'C6H6'],
  ['pyridine', 'c1ccncc1', 'C5H5N'],
  ['pyrrole', 'c1cc[nH]c1', 'C4H5N'],
  ['furan', 'c1ccoc1', 'C4H4O'],
  ['thiophene', 'c1ccsc1', 'C4H4S'],
  ['imidazole', 'c1c[nH]cn1', 'C3H4N2'],
  ['naphthalene', 'c1ccc2ccccc2c1', 'C10H8'],
  ['azulene', 'c1ccc2cccc2cc1', 'C10H8'],
  ['indole', 'c1ccc2[nH]ccc2c1', 'C8H7N'],
  ['pyrene', 'c1cc2ccc3cccc4ccc(c1)c2c34', 'C16H10'],
  ['biphenyl', 'c1ccccc1c1ccccc1', 'C12H10'],
  ['adenine', 'Nc1ncnc2[nH]cnc12', 'C5H5N5'],
  ['caffeine', 'Cn1cnc2c1c(=O)n(C)c(=O)n2C', 'C8H10N4O2'],
  ['aspirin', 'CC(=O)Oc1ccccc1C(=O)O', 'C9H8O4'],
  ['ibuprofen', 'CC(C)Cc1ccc(cc1)C(C)C(=O)O', 'C13H18O2'],
  ['paracetamol', 'CC(=O)Nc1ccc(O)cc1', 'C8H9NO2'],
  ['glucose', 'OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O', 'C6H12O6'],
  ['nicotine', 'CN1CCCC1c1cccnc1', 'C10H14N2'],
  ['dopamine', 'NCCc1ccc(O)c(O)c1', 'C8H11NO2'],
  ['serotonin', 'NCCc1c[nH]c2ccc(O)cc12', 'C10H12N2O'],
  ['capsaicin', 'COc1cc(CNC(=O)CCCC/C=C/C(C)C)ccc1O', 'C18H27NO3'],
  ['indigo', 'O=C1C(=C2Nc3ccccc3C2=O)Nc2ccccc12', 'C16H10N2O2'],
  ['camphor', 'CC1(C)C2CCC1(C)C(=O)C2', 'C10H16O'],
  ['cholesterol', 'CC(C)CCCC(C)C1CCC2C1(CCC3C2CC=C4C3(CCC(C4)O)C)C', 'C27H46O'],
  ['penicillin G', 'CC1(C)SC2C(NC(=O)Cc3ccccc3)C(=O)N2C1C(=O)O', 'C16H18N2O4S'],
  ['TNT', 'Cc1c(cc(cc1[N+](=O)[O-])[N+](=O)[O-])[N+](=O)[O-]', 'C7H5N3O6'],
  ['cubane', 'C12C3C4C1C5C2C3C45', 'C8H8'],
  ['chloroform', 'ClC(Cl)Cl', 'CHCl3'],
  ['sulfuric acid', 'OS(=O)(=O)O', 'H2O4S'],
  ['ammonium', '[NH4+]', 'H4N^+'],
  ['sulfate', '[O-]S(=O)(=O)[O-]', 'O4S^2-'],
  ['sodium acetate', 'CC(=O)[O-].[Na+]', 'C2H3NaO2'],
  ['heavy water', '[2H]O[2H]', 'H2O'],
  ['pyridinium', 'c1cc[nH+]cc1', 'C5H6N^+'],
  ['cyclopentadienide', '[cH-]1cccc1', 'C5H5^-'],
  ['ferrocene iron', '[Fe+2]', 'Fe^2+'],
  ['a twelve-ring with %nn closures', 'C%12CCCCCCCCCCC%12', 'C12H24'],
];

for (const [name, smiles, expected] of KNOWN) {
  test(`${name}: ${smiles} is ${expected}`, () => {
    assert.equal(formulaOf(smiles), expected);
  });
}

test('molar masses of drawn molecules match reference values', () => {
  const mass = (smiles) => molarMass(molecularFormula(parseSmiles(smiles)).counts).mass;
  assert.ok(Math.abs(mass('Cn1cnc2c1c(=O)n(C)c(=O)n2C') - 194.19) < 0.01);
  assert.ok(Math.abs(mass('CC(=O)Oc1ccccc1C(=O)O') - 180.16) < 0.01);
  assert.ok(Math.abs(mass('CC(C)CCCC(C)C1CCC2C1(CCC3C2CC=C4C3(CCC(C4)O)C)C') - 386.66) < 0.01);
});

test('kekulization gives every aromatic carbon exactly one double bond', () => {
  for (const smiles of ['c1ccccc1', 'c1ccc2ccccc2c1', 'c1cc2ccc3cccc4ccc(c1)c2c34', 'c1ccc2cccc2cc1']) {
    const mol = parseSmiles(smiles);
    for (const atom of mol.atoms) {
      const doubles = mol.neighbors[atom.index].filter((n) => mol.bonds[n.bond].order === 2).length;
      assert.equal(doubles, 1, `${smiles} atom ${atom.index}`);
    }
  }
});

test('the bond between two aromatic rings is single', () => {
  const mol = parseSmiles('c1ccccc1c1ccccc1');
  const link = mol.bonds.find((bond) => bond.a === 5 && bond.b === 6);
  assert.equal(link.aromatic, false);
  assert.equal(link.order, 1);
});

test('ring perception finds the smallest set of smallest rings', () => {
  const sizes = (smiles) => parseSmiles(smiles).rings.map((ring) => ring.length).sort((a, b) => a - b);
  assert.deepEqual(sizes('CCCC'), []);
  assert.deepEqual(sizes('c1ccccc1'), [6]);
  assert.deepEqual(sizes('c1ccc2ccccc2c1'), [6, 6]);
  assert.deepEqual(sizes('C1CC2CCC1C2'), [5, 5]); // norbornane, not [5, 6]
  assert.deepEqual(sizes('C1C2CC3CC1CC(C2)C3'), [6, 6, 6]); // adamantane
  assert.deepEqual(sizes('C12C3C4C1C5C2C3C45'), [4, 4, 4, 4, 4]); // cubane: five faces span the sixth
  assert.deepEqual(sizes('C1CCC2C(C1)CCC1C2CCC2CCCC12'), [5, 6, 6, 6]); // steroid nucleus
  assert.deepEqual(sizes('C1CC1.C1CCC1'), [3, 4]);
  assert.deepEqual(sizes('c1cc2ccc3cccc4ccc(c1)c2c34'), [6, 6, 6, 6]);
});

test('errors are specific and point at the right character', () => {
  const failure = (smiles) => {
    try {
      parseSmiles(smiles);
    } catch (err) {
      assert.ok(err instanceof ChemSyntaxError, `expected a ChemSyntaxError for ${smiles}, got ${err}`);
      return [err.pos, err.message];
    }
    return assert.fail(`${smiles} should not parse`);
  };
  assert.deepEqual(failure('C1CC'), [1, 'Ring bond 1 is opened here but never closed']);
  assert.deepEqual(failure('C(C'), [1, 'This "(" is never closed']);
  assert.deepEqual(failure('CC)'), [2, 'This ")" has no matching "("']);
  assert.deepEqual(failure('C==C'), [2, 'Two bond symbols in a row']);
  assert.deepEqual(failure('CC='), [2, 'This bond leads nowhere']);
  assert.deepEqual(failure('[Cu'), [0, 'This "[" is never closed']);
  assert.deepEqual(failure('C()C'), [1, 'This branch is empty']);
  assert.deepEqual(failure('C11'), [2, 'An atom cannot be bonded to itself']);
  assert.deepEqual(failure('C12CC12'), [6, 'These two atoms are already bonded']);
  assert.deepEqual(failure('cc'), [0, 'A lowercase (aromatic) atom has to be part of a ring']);
  assert.deepEqual(failure('CNa'), [1, 'Sodium must be written in brackets: [Na]']);
  assert.deepEqual(failure('CZn'), [1, 'Zinc must be written in brackets: [Zn]']);
  assert.deepEqual(failure('CK'), [1, 'Potassium must be written in brackets: [K]']);
  assert.deepEqual(failure('C?'), [1, 'Unexpected "?"']);
  assert.match(failure('c1cccc1')[1], /no valid arrangement of double bonds/);
  assert.match(failure('c1ccnc1')[1], /\[nH\]/);
});

test('warns about impossible valences instead of hiding them', () => {
  const mol = parseSmiles('CC(C)(C)(C)C');
  assert.equal(mol.warnings.length, 1);
  assert.match(mol.warnings[0], /Carbon at position 2 has 5 bonds/);
  assert.equal(parseSmiles('CCO').warnings.length, 0);
});

// ---- properties -----------------------------------------------------------

test('property: hydrogens satisfy the valence sum rule', () => {
  // The generator knows each atom's valence and every bond order, so it can
  // state the hydrogen count outright: H = Σ valence − 2·Σ bond order.
  // The parser has to arrive at the same number through implicit-H rules.
  forAll(
    (g, size) => randomMolecule(g, size),
    (made) => {
      const mol = parseSmiles(made.smiles);
      assert.equal(mol.atoms.length, made.atomCount);
      assert.equal(mol.bonds.length, made.bondCount);
      assert.equal(molecularFormula(mol).counts.get('H') ?? 0, made.hydrogens);
      assert.equal(mol.warnings.length, 0);
    },
    { runs: 500, maxSize: 10, show: (made) => made.smiles },
  );
});

test('property: ring count is E − V + C, and every ring is a real cycle', () => {
  forAll(
    (g, size) => randomMolecule(g, size, { rings: 4 }),
    (made) => {
      const mol = parseSmiles(made.smiles);
      assert.equal(mol.rings.length, mol.bonds.length - mol.atoms.length + 1);
      for (const ring of mol.rings) {
        assert.equal(new Set(ring).size, ring.length, 'no atom repeats');
        ring.forEach((atom, k) => {
          const next = ring[(k + 1) % ring.length];
          assert.ok(mol.neighbors[atom].some((n) => n.atom === next), 'consecutive ring atoms are bonded');
        });
      }
      assert.deepEqual(perceiveRings(mol.atoms.length, mol.bonds).map((r) => r.length), mol.rings.map((r) => r.length));
    },
    { runs: 400, maxSize: 10, show: (made) => made.smiles },
  );
});
