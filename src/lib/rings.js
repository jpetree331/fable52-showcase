// Ring perception: the smallest set of smallest rings (a minimum cycle basis).
//
// Framework-free: runs unchanged in Node and in the browser.
//
// Horton's algorithm. Every ring in some minimum cycle basis has the form
// "shortest path v→x, the bond x–y, shortest path y→v", so we enumerate those
// candidates from a breadth-first tree at every atom, sort them by size, and
// keep each one that is linearly independent of the rings already kept.
// Independence is Gaussian elimination over GF(2), with a ring stored as a
// BigInt bitmask of its bonds: XOR is addition.
//
// A molecule with V atoms, E bonds and C connected pieces has exactly
// E − V + C independent rings, which tells us when to stop.

const highestBit = (mask) => 1n << BigInt(mask.toString(2).length - 1);

/**
 * @param {number} atomCount
 * @param {{a: number, b: number}[]} bonds
 * @returns {number[][]} rings, smallest first; each lists its atoms in walking order
 */
export function perceiveRings(atomCount, bonds) {
  const adjacency = Array.from({ length: atomCount }, () => []);
  bonds.forEach((bond, index) => {
    adjacency[bond.a].push({ atom: bond.b, bond: index });
    adjacency[bond.b].push({ atom: bond.a, bond: index });
  });

  let components = 0;
  const visited = new Array(atomCount).fill(false);
  for (let seed = 0; seed < atomCount; seed++) {
    if (visited[seed]) continue;
    components++;
    const stack = [seed];
    visited[seed] = true;
    while (stack.length > 0) {
      for (const { atom } of adjacency[stack.pop()]) {
        if (!visited[atom]) {
          visited[atom] = true;
          stack.push(atom);
        }
      }
    }
  }
  const wanted = bonds.length - atomCount + components;
  if (wanted === 0) return [];

  /** @type {Map<bigint, number[]>} bond mask → atoms in order */
  const candidates = new Map();
  for (let root = 0; root < atomCount; root++) {
    const parent = new Array(atomCount).fill(-1);
    const parentBond = new Array(atomCount).fill(-1);
    const depth = new Array(atomCount).fill(-1);
    depth[root] = 0;
    const queue = [root];
    for (let head = 0; head < queue.length; head++) {
      const at = queue[head];
      for (const { atom, bond } of adjacency[at]) {
        if (depth[atom] >= 0) continue;
        depth[atom] = depth[at] + 1;
        parent[atom] = at;
        parentBond[atom] = bond;
        queue.push(atom);
      }
    }
    const pathFromRoot = (atom) => {
      const path = [];
      for (let at = atom; at !== -1; at = parent[at]) path.push(at);
      return path.reverse();
    };

    bonds.forEach((bond, index) => {
      const { a: x, b: y } = bond;
      if (depth[x] < 0 || depth[y] < 0) return;
      if (parentBond[x] === index || parentBond[y] === index) return;
      const px = pathFromRoot(x);
      const py = pathFromRoot(y);
      const onPx = new Set(px);
      if (py.some((atom, k) => k > 0 && onPx.has(atom))) return; // paths must meet only at the root
      let mask = 1n << BigInt(index);
      for (const path of [px, py]) for (const atom of path.slice(1)) mask |= 1n << BigInt(parentBond[atom]);
      if (!candidates.has(mask)) candidates.set(mask, [...px, ...py.slice(1).reverse()]);
    });
  }

  const bySize = [...candidates].sort(([, a], [, b]) => a.length - b.length);
  const basis = []; // kept in descending pivot order so one pass fully reduces a vector
  const rings = [];
  for (const [mask, atoms] of bySize) {
    let reduced = mask;
    for (const vector of basis) if (reduced & vector.pivot) reduced ^= vector.mask;
    if (reduced === 0n) continue;
    basis.push({ mask: reduced, pivot: highestBit(reduced) });
    basis.sort((p, q) => (p.pivot < q.pivot ? 1 : -1));
    rings.push(atoms);
    if (rings.length === wanted) break;
  }
  return rings;
}
