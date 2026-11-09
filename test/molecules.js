// Random-molecule generator shared by the SMILES and layout property tests.
//
// It grows a random tree of C, N and O atoms with single, double and triple
// bonds, never exceeding any atom's valence, then closes a few rings between
// atoms that still have a valence free. Because it built the molecule, it
// knows facts the parser has to work out for itself — above all the hydrogen
// count — which makes it an independent oracle.

const VALENCE = { C: 4, N: 3, O: 2 };
const BOND_SYMBOL = { 1: '', 2: '=', 3: '#' };

/**
 * @param {import('./prop.js').Gen} g
 * @param {number} size
 * @param {{rings?: number}} [options] upper bound on ring closures
 * @returns {{smiles: string, atomCount: number, bondCount: number, hydrogens: number, ringClosures: number}}
 */
export function randomMolecule(g, size, options = {}) {
  const target = g.int(1, 2 + size * 2);
  const atoms = [{ element: g.pick(['C', 'C', 'C', 'N', 'O']), free: 0, children: [], closures: [] }];
  atoms[0].free = VALENCE[atoms[0].element];
  let bondOrderTotal = 0;
  let bondCount = 0;

  while (atoms.length < target) {
    const open = atoms.filter((atom) => atom.free > 0);
    if (open.length === 0) break;
    const parent = g.pick(open);
    const element = g.pick(['C', 'C', 'C', 'C', 'N', 'O']);
    const order = g.int(1, Math.min(parent.free, VALENCE[element], g.bool(0.75) ? 1 : 3));
    const child = { element, free: VALENCE[element] - order, children: [], closures: [], index: atoms.length };
    parent.free -= order;
    parent.children.push({ atom: child, order });
    atoms.push(child);
    bondOrderTotal += order;
    bondCount++;
  }
  atoms[0].index = 0;

  // ring closures: single bonds between non-adjacent atoms that each have a valence to spare
  const bonded = new Set();
  for (const atom of atoms) for (const { atom: child } of atom.children) bonded.add(`${atom.index}-${child.index}`);
  const isBonded = (a, b) => bonded.has(`${a.index}-${b.index}`) || bonded.has(`${b.index}-${a.index}`);
  let ringClosures = 0;
  const wanted = g.int(0, options.rings ?? 2);
  for (let attempt = 0; attempt < wanted * 4 && ringClosures < wanted; attempt++) {
    const a = g.pick(atoms);
    const b = g.pick(atoms);
    if (a === b || a.free === 0 || b.free === 0 || isBonded(a, b)) continue;
    ringClosures++;
    const label = ringClosures < 10 ? String(ringClosures) : `%${ringClosures}`;
    a.closures.push(label);
    b.closures.push(label);
    a.free--;
    b.free--;
    bonded.add(`${a.index}-${b.index}`);
    bondOrderTotal++;
    bondCount++;
  }

  const write = (atom) => {
    let text = atom.element + atom.closures.join('');
    atom.children.forEach(({ atom: child, order }, k) => {
      const branch = BOND_SYMBOL[order] + write(child);
      text += k < atom.children.length - 1 ? `(${branch})` : branch;
    });
    return text;
  };

  const valenceTotal = atoms.reduce((sum, atom) => sum + VALENCE[atom.element], 0);
  return {
    smiles: write(atoms[0]),
    atomCount: atoms.length,
    bondCount,
    hydrogens: valenceTotal - 2 * bondOrderTotal,
    ringClosures,
  };
}
