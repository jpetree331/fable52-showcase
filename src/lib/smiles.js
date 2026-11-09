// SMILES parser: "Cn1cnc2c1c(=O)n(C)c(=O)n2C" → a molecular graph.
//
// Framework-free: runs unchanged in Node and in the browser.
//
// Handles the organic subset, bracket atoms (isotope, hydrogens, charge),
// every bond symbol, branches, ring closures (including %nn) and "." for
// disconnected pieces. After parsing it
//
//   1. perceives rings,
//   2. fills in implicit hydrogens from normal valences, and
//   3. kekulizes aromatic systems — assigns the alternating double bonds —
//      which doubles as validation: "c1cccc1" has no such assignment and is
//      rejected instead of being drawn as something that cannot exist.
//
// Stereo marks (@, @@, /, \) are read and dropped: the output is the
// constitution, not the configuration.

import { ChemSyntaxError } from './formula.js';
import { ELEMENTS } from './elements.js';
import { perceiveRings } from './rings.js';

/** Normal valences for atoms written without brackets. */
const ORGANIC = { B: [3], C: [4], N: [3, 5], O: [2], P: [3, 5], S: [2, 4, 6], F: [1], Cl: [1], Br: [1], I: [1] };
const AROMATIC = new Set(['b', 'c', 'n', 'o', 'p', 's']);
/** Neutral bonding capacity of atoms that may be aromatic. */
const AROMATIC_VALENCE = { B: 3, C: 4, N: 3, O: 2, P: 3, S: 2, Se: 2, As: 3 };
const BOND_ORDER = { '-': 1, '=': 2, '#': 3, $: 4, ':': 1, '/': 1, '\\': 1 };

const isDigit = (ch) => ch >= '0' && ch <= '9';

/**
 * @typedef {object} Atom
 * @property {number} index
 * @property {string} element      element symbol, always capitalised
 * @property {boolean} aromatic    written lowercase
 * @property {boolean} bracket     written in [brackets]
 * @property {number} charge
 * @property {number|null} isotope
 * @property {number} hydrogens    attached hydrogens not drawn as atoms
 * @property {number} pos          index into the source string
 *
 * @typedef {{index: number, a: number, b: number, order: number, aromatic: boolean}} Bond
 *
 * @typedef {object} Molecule
 * @property {Atom[]} atoms
 * @property {Bond[]} bonds
 * @property {{atom: number, bond: number}[][]} neighbors
 * @property {number[][]} rings    smallest set of smallest rings
 * @property {string[]} warnings
 * @property {string} source
 */

/**
 * @param {string} source
 * @returns {Molecule}
 * @throws {ChemSyntaxError}
 */
export function parseSmiles(source) {
  const s = source;
  let end = s.length;
  while (end > 0 && /\s/.test(s[end - 1])) end--;
  let i = 0;
  while (i < end && /\s/.test(s[i])) i++;

  /** @type {Atom[]} */
  const atoms = [];
  /** @type {Bond[]} */
  const bonds = [];
  const neighbors = [];
  const fail = (message, pos) => {
    throw new ChemSyntaxError(message, pos, s);
  };
  if (i === end) fail('Expected a SMILES string', 0);

  const addAtom = (props) => {
    atoms.push({ index: atoms.length, aromatic: false, bracket: false, charge: 0, isotope: null, hydrogens: 0, ...props });
    neighbors.push([]);
    return atoms.length - 1;
  };
  const addBond = (a, b, symbol, pos) => {
    if (a === b) fail('An atom cannot be bonded to itself', pos);
    if (neighbors[a].some((n) => n.atom === b)) fail('These two atoms are already bonded', pos);
    const aromatic = symbol === ':' || (symbol === null && atoms[a].aromatic && atoms[b].aromatic);
    const index = bonds.length;
    bonds.push({ index, a, b, order: symbol === null ? 1 : BOND_ORDER[symbol], aromatic });
    neighbors[a].push({ atom: b, bond: index });
    neighbors[b].push({ atom: a, bond: index });
  };

  const readBracketAtom = () => {
    const open = i++;
    const unclosed = () => fail('This "[" is never closed', open);
    const isotopeStart = i;
    while (isDigit(s[i])) i++;
    const isotope = i > isotopeStart ? Number(s.slice(isotopeStart, i)) : null;

    let element;
    let aromatic = false;
    const one = s[i] ?? '';
    const two = s.slice(i, i + 2);
    if (i >= end) unclosed();
    if (/^[A-Z][a-z]$/.test(two) && ELEMENTS.has(two)) {
      element = two;
      i += 2;
    } else if (/^[A-Z]$/.test(one) && ELEMENTS.has(one)) {
      element = one;
      i += 1;
    } else if (two === 'se' || two === 'as') {
      element = two[0].toUpperCase() + two[1];
      aromatic = true;
      i += 2;
    } else if (AROMATIC.has(one)) {
      element = one.toUpperCase();
      aromatic = true;
      i += 1;
    } else {
      fail(`"${one}" does not start an element symbol`, i);
    }

    while (s[i] === '@') i++; // chirality: read, not kept

    let hydrogens = 0;
    if (s[i] === 'H') {
      i++;
      const start = i;
      while (isDigit(s[i])) i++;
      hydrogens = i > start ? Number(s.slice(start, i)) : 1;
    }

    let charge = 0;
    if (s[i] === '+' || s[i] === '-') {
      const signChar = s[i];
      let run = 0;
      while (s[i] === signChar) {
        run++;
        i++;
      }
      const start = i;
      while (isDigit(s[i])) i++;
      charge = (signChar === '+' ? 1 : -1) * (i > start ? Number(s.slice(start, i)) : run);
    }

    if (s[i] === ':') {
      i++;
      while (isDigit(s[i])) i++; // atom class: read, not kept
    }
    if (i >= end) unclosed();
    if (s[i] !== ']') fail(`Unexpected "${s[i]}" inside a bracket atom`, i);
    i++;
    return addAtom({ element, aromatic, bracket: true, isotope, hydrogens, charge, pos: open });
  };

  const readOrganicAtom = () => {
    const pos = i;
    const two = s.slice(i, i + 2);
    if (two === 'Cl' || two === 'Br') {
      i += 2;
      return addAtom({ element: two, pos });
    }
    const ch = s[i];
    if (ORGANIC[ch]) {
      i++;
      return addAtom({ element: ch, pos });
    }
    if (AROMATIC.has(ch)) {
      i++;
      return addAtom({ element: ch.toUpperCase(), aromatic: true, pos });
    }
    // "Na" reads as N then a stray "a"; "Zn" as a stray "Z". Say what was meant.
    const withPrevious = pos > 0 ? s[pos - 1] + ch : '';
    if (/^[A-Z][a-z]$/.test(withPrevious) && ELEMENTS.has(withPrevious)) {
      return fail(`${ELEMENTS.get(withPrevious).name} must be written in brackets: [${withPrevious}]`, pos - 1);
    }
    const symbol = /^[A-Z][a-z]$/.test(two) && ELEMENTS.has(two) ? two : ch;
    if (ELEMENTS.has(symbol)) return fail(`${ELEMENTS.get(symbol).name} must be written in brackets: [${symbol}]`, pos);
    return fail(`Unexpected "${ch}"`, pos);
  };

  let previous = null; // atom the next atom will bond to
  let pending = null; // bond symbol waiting for its second atom
  let pendingPos = 0;
  const branches = []; // {atom, pos} for each open "("
  const openRings = new Map(); // ring number → {atom, symbol, pos}

  while (i < end) {
    const ch = s[i];
    if (ch === '(') {
      if (previous === null) fail('A branch needs an atom before it', i);
      if (s[i + 1] === ')') fail('This branch is empty', i);
      branches.push({ atom: previous, pos: i });
      i++;
    } else if (ch === ')') {
      if (branches.length === 0) fail('This ")" has no matching "("', i);
      if (pending !== null) fail('This bond leads nowhere', pendingPos);
      previous = branches.pop().atom;
      i++;
    } else if (ch in BOND_ORDER) {
      if (pending !== null) fail('Two bond symbols in a row', i);
      if (previous === null) fail('A bond needs an atom before it', i);
      pending = ch;
      pendingPos = i;
      i++;
    } else if (ch === '.') {
      if (pending !== null) fail('This bond leads nowhere', pendingPos);
      if (previous === null) fail('Unexpected "."', i);
      previous = null;
      i++;
    } else if (isDigit(ch) || ch === '%') {
      const pos = i;
      let number;
      if (ch === '%') {
        if (!isDigit(s[i + 1]) || !isDigit(s[i + 2])) fail('"%" must be followed by a two-digit ring number', i);
        number = Number(s.slice(i + 1, i + 3));
        i += 3;
      } else {
        number = Number(ch);
        i++;
      }
      if (previous === null) fail('A ring number needs an atom before it', pos);
      const opening = openRings.get(number);
      if (opening === undefined) {
        openRings.set(number, { atom: previous, symbol: pending, pos });
      } else {
        if (opening.symbol !== null && pending !== null && BOND_ORDER[opening.symbol] !== BOND_ORDER[pending]) {
          fail('The two ends of this ring bond disagree about its order', pos);
        }
        addBond(opening.atom, previous, pending ?? opening.symbol, pos);
        openRings.delete(number);
      }
      pending = null;
    } else {
      const atom = ch === '[' ? readBracketAtom() : readOrganicAtom();
      if (previous !== null) addBond(previous, atom, pending, atoms[atom].pos);
      previous = atom;
      pending = null;
    }
  }
  if (pending !== null) fail('This bond leads nowhere', pendingPos);
  if (branches.length > 0) fail('This "(" is never closed', branches[branches.length - 1].pos);
  if (openRings.size > 0) {
    const [number, opening] = [...openRings][0];
    fail(`Ring bond ${number} is opened here but never closed`, opening.pos);
  }

  /** @type {Molecule} */
  const molecule = { atoms, bonds, neighbors, rings: perceiveRings(atoms.length, bonds), warnings: [], source };
  settleAromaticity(molecule);
  assignHydrogens(molecule);
  kekulize(molecule);
  return molecule;
}

/** An aromatic bond only means something inside a ring; biphenyl's link is single. */
function settleAromaticity(mol) {
  const inRing = new Set();
  const ringAtoms = new Set();
  for (const ring of mol.rings) {
    ring.forEach((atom, k) => {
      const next = ring[(k + 1) % ring.length];
      inRing.add(mol.neighbors[atom].find((n) => n.atom === next).bond);
      ringAtoms.add(atom);
    });
  }
  for (const bond of mol.bonds) if (bond.aromatic && !inRing.has(bond.index)) bond.aromatic = false;
  const stray = mol.atoms.find((atom) => atom.aromatic && !ringAtoms.has(atom.index));
  if (stray) {
    throw new ChemSyntaxError('A lowercase (aromatic) atom has to be part of a ring', stray.pos, mol.source);
  }
}

const bondOrderSum = (mol, atom) => mol.neighbors[atom.index].reduce((sum, n) => sum + mol.bonds[n.bond].order, 0);

function assignHydrogens(mol) {
  for (const atom of mol.atoms) {
    if (atom.bracket) continue; // a bracket atom states its hydrogens outright
    const used = bondOrderSum(mol, atom);
    const valences = ORGANIC[atom.element];
    if (atom.aromatic) {
      // one valence is spoken for by the ring's π system
      atom.hydrogens = Math.max(0, valences[0] - used - 1);
      continue;
    }
    const valence = valences.find((v) => v >= used);
    if (valence === undefined) {
      atom.hydrogens = 0;
      const most = valences[valences.length - 1];
      mol.warnings.push(`${ELEMENTS.get(atom.element).name} at position ${atom.pos + 1} has ${used} bonds; ${most} is its usual limit.`);
    } else {
      atom.hydrogens = valence - used;
    }
  }
}

/**
 * Give every aromatic ring its alternating double bonds.
 *
 * Each aromatic atom that still has one unused valence must end up in exactly
 * one double bond, so this is a perfect-matching problem on those atoms.
 * Backtracking, always extending the atom with the fewest options, settles
 * real molecules almost without backing up.
 */
function kekulize(mol) {
  const { atoms, bonds, neighbors } = mol;
  const needs = atoms.map((atom) => {
    if (!atom.aromatic) return false;
    let capacity = AROMATIC_VALENCE[atom.element];
    if (atom.element === 'C') capacity -= Math.abs(atom.charge);
    else if (atom.element === 'B') capacity -= atom.charge;
    else capacity += atom.charge;
    return capacity - bondOrderSum(mol, atom) - atom.hydrogens >= 1;
  });

  const partner = new Array(atoms.length).fill(-1);
  const options = (a) => neighbors[a].filter((n) => bonds[n.bond].aromatic && needs[n.atom] && partner[n.atom] < 0);
  let stuckAt = -1;

  const solve = () => {
    let pick = -1;
    let pickOptions = null;
    for (let a = 0; a < atoms.length; a++) {
      if (!needs[a] || partner[a] >= 0) continue;
      const available = options(a);
      if (available.length === 0) {
        if (stuckAt < 0) stuckAt = a;
        return false;
      }
      if (pickOptions === null || available.length < pickOptions.length) {
        pick = a;
        pickOptions = available;
        if (available.length === 1) break;
      }
    }
    if (pick < 0) return true;
    for (const { atom: other } of pickOptions) {
      partner[pick] = other;
      partner[other] = pick;
      if (solve()) return true;
      partner[pick] = -1;
      partner[other] = -1;
    }
    return false;
  };

  if (!solve()) {
    throw new ChemSyntaxError(
      'This aromatic ring has no valid arrangement of double bonds — a ring nitrogen that carries a hydrogen must be written [nH]',
      atoms[Math.max(stuckAt, 0)].pos,
      mol.source,
    );
  }
  for (const bond of bonds) if (bond.aromatic && partner[bond.a] === bond.b) bond.order = 2;
}

/**
 * Element counts (hydrogens included) and net charge.
 * @param {Molecule} mol
 * @returns {{counts: Map<string, number>, charge: number}}
 */
export function molecularFormula(mol) {
  const counts = new Map();
  const bump = (symbol, n) => counts.set(symbol, (counts.get(symbol) ?? 0) + n);
  let charge = 0;
  for (const atom of mol.atoms) {
    bump(atom.element, 1);
    if (atom.hydrogens > 0) bump('H', atom.hydrogens);
    charge += atom.charge;
  }
  return { counts, charge };
}
