// 2D coordinate generation: turn a molecular graph into a drawable diagram.
//
// Framework-free: runs unchanged in Node and in the browser.
//
// All bonds aim for length 1. The method, in the order it happens:
//
//   1. Ring systems first, each in its own frame. The first ring is a regular
//      polygon. Every further ring finds its already-placed atoms and lays
//      the rest on a circular arc between them, bulging away from what is
//      there. One rule covers fused rings (the arc completes a regular
//      polygon), peri-fusion as in pyrene (the arc takes the long way round)
//      and bridged rings (a shorter, flatter arc); spiro rings get a polygon
//      hung off the shared atom.
//   2. Walk outward from the biggest ring system (or a chain end), placing
//      each new neighbour in the widest free angle around its atom. A lone
//      continuation zig-zags at 120°; triple bonds and allenes run straight.
//      A whole ring system reached through a bond is rotated — and mirrored,
//      if that is roomier — to point back along that bond.
//   3. Where atoms still collide, mirror a branch across the bond it hangs
//      from whenever that relieves the collision.
//   4. Turn the result, in 30° steps so bonds keep their conventional
//      angles, to make the drawing wide rather than tall.

const TAU = Math.PI * 2;
const distance = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const rotate = (p, angle) => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};
const rotateAbout = (p, center, angle) => {
  const r = rotate({ x: p.x - center.x, y: p.y - center.y }, angle);
  return { x: r.x + center.x, y: r.y + center.y };
};
const centroid = (points) => ({
  x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
  y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
});

/**
 * `count` points between pa and pb, on the circular arc that makes all
 * count + 1 steps exactly one bond long, bulging to the given side.
 */
function arcBetween(pa, pb, count, side) {
  const segments = count + 1;
  const chord = distance(pa, pb);
  if (chord >= segments - 1e-9) {
    // Too far apart for unit bonds: stretch evenly along the straight line.
    return Array.from({ length: count }, (_, k) => {
      const t = (k + 1) / segments;
      return { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t };
    });
  }
  // Each bond turns through θ at the centre. The chord then satisfies
  // sin(segments·θ/2) / sin(θ/2) = chord, and the left side falls
  // monotonically from `segments` to 0 on (0, 2π/segments): bisect.
  let lo = 1e-9;
  let hi = TAU / segments;
  for (let step = 0; step < 60; step++) {
    const mid = (lo + hi) / 2;
    if (Math.sin((segments * mid) / 2) / Math.sin(mid / 2) > chord) lo = mid;
    else hi = mid;
  }
  const theta = (lo + hi) / 2;
  const radius = 0.5 / Math.sin(theta / 2);
  const sweep = segments * theta;
  const normal = { x: (-(pb.y - pa.y) / chord) * side, y: ((pb.x - pa.x) / chord) * side };
  const reach = radius * Math.cos(sweep / 2); // negative once the arc passes a semicircle
  const center = { x: (pa.x + pb.x) / 2 - normal.x * reach, y: (pa.y + pb.y) / 2 - normal.y * reach };
  const sense = distance(rotateAbout(pa, center, sweep), pb) <= distance(rotateAbout(pa, center, -sweep), pb) ? 1 : -1;
  return Array.from({ length: count }, (_, k) => rotateAbout(pa, center, sense * (k + 1) * theta));
}

/** Lay out one ring system in its own frame. @returns {Map<number, {x: number, y: number}>} */
function placeRingSystem(rings, neighbors) {
  const placed = new Map();
  const shares = (r, q) => r.some((atom) => q.includes(atom));
  const linkCount = (r) => rings.filter((q) => q !== r && shares(r, q)).length;

  // Start from the most connected ring so the rest grow outward from it.
  const first = rings.reduce((best, r) => {
    const delta = linkCount(r) - linkCount(best) || r.length - best.length;
    return delta > 0 ? r : best;
  });
  const firstRadius = 0.5 / Math.sin(Math.PI / first.length);
  first.forEach((atom, k) => {
    const angle = Math.PI / 2 + (k * TAU) / first.length;
    placed.set(atom, { x: firstRadius * Math.cos(angle), y: firstRadius * Math.sin(angle) });
  });

  const remaining = rings.filter((r) => r !== first);
  const placedCount = (r) => r.filter((atom) => placed.has(atom)).length;
  while (remaining.length > 0) {
    let pick = 0;
    for (let k = 1; k < remaining.length; k++) {
      const delta = placedCount(remaining[k]) - placedCount(remaining[pick]) || remaining[pick].length - remaining[k].length;
      if (delta > 0) pick = k;
    }
    attachRing(remaining.splice(pick, 1)[0], placed, neighbors);
  }
  if (isStrained(placed, neighbors)) relax(placed, neighbors);
  return placed;
}

/** True when arcs alone left atoms piled up or bonds badly stretched — cages, mostly. */
function isStrained(placed, neighbors) {
  const atoms = [...placed.keys()];
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const gap = distance(placed.get(atoms[i]), placed.get(atoms[j]));
      const bonded = neighbors[atoms[i]].some((n) => n.atom === atoms[j]);
      if (bonded ? Math.abs(gap - 1) > 0.25 : gap < 0.55) return true;
    }
  }
  return false;
}

/**
 * Last resort for ring systems no flat construction fits (cubane, for one):
 * treat bonds as springs and let non-bonded atoms push apart. The result is
 * a legible projection rather than a faithful one. Deterministic — the
 * nudge that separates coincident atoms depends only on atom order.
 */
function relax(placed, neighbors) {
  const atoms = [...placed.keys()];
  const P = atoms.map((atom, k) => {
    const p = placed.get(atom);
    return { x: p.x + 0.08 * Math.cos(k * 2.4), y: p.y + 0.08 * Math.sin(k * 2.4) };
  });
  const bonded = atoms.map((a) => atoms.map((b) => neighbors[a].some((n) => n.atom === b)));
  const rounds = 500;
  for (let round = 0; round < rounds; round++) {
    const push = P.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < P.length; i++) {
      for (let j = i + 1; j < P.length; j++) {
        const dx = P[j].x - P[i].x;
        const dy = P[j].y - P[i].y;
        const gap = Math.hypot(dx, dy) || 1e-6;
        // springs pull bonded atoms to length 1; others repel inside 1.5
        const force = bonded[i][j] ? gap - 1 : gap < 1.5 ? (gap - 1.5) * 0.6 : 0;
        push[i].x += (dx / gap) * force;
        push[i].y += (dy / gap) * force;
        push[j].x -= (dx / gap) * force;
        push[j].y -= (dy / gap) * force;
      }
    }
    const step = 0.02 + 0.1 * (1 - round / rounds);
    P.forEach((p, k) => {
      p.x += push[k].x * step;
      p.y += push[k].y * step;
    });
  }
  atoms.forEach((atom, k) => placed.set(atom, P[k]));
}

function attachRing(ring, placed, neighbors) {
  const size = ring.length;
  const anchor = ring.findIndex((atom) => placed.has(atom));
  const at = (k) => ring[(anchor + k) % size];
  let k = 0;
  while (k < size) {
    let j = k + 1;
    while (!placed.has(at(j))) j++;
    const run = [];
    for (let t = k + 1; t < j; t++) run.push(at(t));
    if (run.length > 0) {
      const pa = placed.get(at(k));
      const points = at(k) === at(j) ? spiroPoints(at(k), size, placed, neighbors) : roomierArc(pa, placed.get(at(j)), run.length, placed);
      run.forEach((atom, t) => placed.set(atom, points[t]));
    }
    k = j;
  }
}

/** A ring sharing a single atom: a regular polygon pointing away from that atom's other bonds. */
function spiroPoints(shared, size, placed, neighbors) {
  const here = placed.get(shared);
  const around = neighbors[shared].filter((n) => placed.has(n.atom)).map((n) => placed.get(n.atom));
  const from = around.length > 0 ? centroid(around) : { x: here.x - 1, y: here.y };
  const away = Math.atan2(here.y - from.y, here.x - from.x);
  const radius = 0.5 / Math.sin(Math.PI / size);
  const center = { x: here.x + radius * Math.cos(away), y: here.y + radius * Math.sin(away) };
  return Array.from({ length: size - 1 }, (_, t) => rotateAbout(here, center, ((t + 1) * TAU) / size));
}

/** Of the two mirror-image arcs, the one that keeps clear of atoms already placed. */
function roomierArc(pa, pb, count, placed) {
  const others = [...placed.values()].filter((p) => p !== pa && p !== pb);
  const clearance = (points) => Math.min(...points.flatMap((p) => others.map((q) => distance(p, q))), Infinity);
  const left = arcBetween(pa, pb, count, 1);
  const right = arcBetween(pa, pb, count, -1);
  return clearance(right) > clearance(left) + 1e-9 ? right : left;
}

/**
 * @param {import('./smiles.js').Molecule} mol
 * @returns {{coords: {x: number, y: number}[], width: number, height: number}}
 */
export function layout(mol) {
  const count = mol.atoms.length;
  const { neighbors, bonds, rings } = mol;
  if (count === 0) return { coords: [], width: 0, height: 0 };

  // ---- ring systems: rings that share atoms, laid out as one rigid unit
  const owner = rings.map((_, r) => r);
  const find = (r) => (owner[r] === r ? r : (owner[r] = find(owner[r])));
  const firstRingOf = new Map();
  rings.forEach((ring, r) => {
    for (const atom of ring) {
      if (firstRingOf.has(atom)) owner[find(r)] = find(firstRingOf.get(atom));
      else firstRingOf.set(atom, r);
    }
  });
  const systems = [];
  const systemAt = new Map();
  const systemOf = new Array(count).fill(-1);
  rings.forEach((ring, r) => {
    const root = find(r);
    if (!systemAt.has(root)) {
      systemAt.set(root, systems.length);
      systems.push({ rings: [], atoms: [] });
    }
    const index = systemAt.get(root);
    systems[index].rings.push(ring);
    for (const atom of ring) {
      if (systemOf[atom] < 0) {
        systemOf[atom] = index;
        systems[index].atoms.push(atom);
      }
    }
  });
  for (const system of systems) system.local = placeRingSystem(system.rings, neighbors);

  const ringBonds = new Set();
  for (const ring of rings) {
    ring.forEach((atom, k) => ringBonds.add(neighbors[atom].find((n) => n.atom === ring[(k + 1) % ring.length]).bond));
  }

  const pos = new Array(count).fill(null);
  const isLinear = (atom) => {
    const orders = neighbors[atom].map((n) => bonds[n.bond].order);
    return orders.length === 2 && (orders.includes(3) || orders.every((o) => o === 2));
  };

  /** Lay out one connected piece around the origin; returns its atoms. */
  const placeComponent = (seed) => {
    const members = [];
    const seen = new Set([seed]);
    for (const stack = [seed]; stack.length > 0; ) {
      const atom = stack.pop();
      members.push(atom);
      for (const n of neighbors[atom]) {
        if (!seen.has(n.atom)) {
          seen.add(n.atom);
          stack.push(n.atom);
        }
      }
    }

    const drawn = []; // points placed so far, for crowding scores
    const put = (atom, point) => {
      pos[atom] = point;
      drawn.push(point);
    };
    const crowding = (points) => {
      let energy = 0;
      for (const p of points) for (const q of drawn) energy += 1 / ((p.x - q.x) ** 2 + (p.y - q.y) ** 2 + 0.01);
      return energy;
    };
    const angleTo = (from, to) => Math.atan2(to.y - from.y, to.x - from.x);

    /** The widest gap between an atom's placed bonds, as [start angle, width]. */
    const widestGap = (taken) => {
      const sorted = [...taken].sort((a, b) => a - b);
      let start = sorted[0];
      let width = -1;
      sorted.forEach((angle, k) => {
        const next = k + 1 < sorted.length ? sorted[k + 1] : sorted[0] + TAU;
        if (next - angle > width) {
          width = next - angle;
          start = angle;
        }
      });
      return [start, width];
    };

    /** Directions for `n` new bonds leaving a placed atom. */
    const freeAngles = (atom, n) => {
      const here = pos[atom];
      const taken = neighbors[atom].filter((nb) => pos[nb.atom]).map((nb) => angleTo(here, pos[nb.atom]));
      if (taken.length === 0) return Array.from({ length: n }, (_, k) => (k * TAU) / n);
      if (taken.length === 1 && n === 1) {
        if (isLinear(atom)) return [taken[0] + Math.PI];
        const [zig, zag] = [taken[0] + TAU / 3, taken[0] - TAU / 3];
        const score = (angle) => crowding([{ x: here.x + Math.cos(angle), y: here.y + Math.sin(angle) }]);
        return [score(zag) < score(zig) - 1e-9 ? zag : zig];
      }
      const [start, width] = widestGap(taken);
      return Array.from({ length: n }, (_, k) => start + (width * (k + 1)) / (n + 1));
    };

    /** Drop a ring system in so that `entry` lands on `target`, facing back toward `from`. */
    const placeSystem = (system, entry, target, from) => {
      const local = system.local;
      const origin = local.get(entry);
      const inside = neighbors[entry].filter((nb) => local.has(nb.atom));
      const [start, width] = widestGap(inside.map((nb) => angleTo(origin, local.get(nb.atom))));
      const outsideBonds = neighbors[entry].length - inside.length;
      const exit = start + width / (outsideBonds + 1);
      const want = angleTo(target, from);
      let best = null;
      for (const mirror of [1, -1]) {
        const turn = want - exit * mirror;
        const points = system.atoms.map((atom) => {
          const p = local.get(atom);
          const r = rotate({ x: p.x - origin.x, y: (p.y - origin.y) * mirror }, turn);
          return { x: r.x + target.x, y: r.y + target.y };
        });
        const score = crowding(points);
        if (best === null || score < best.score - 1e-9) best = { points, score };
      }
      system.atoms.forEach((atom, k) => put(atom, best.points[k]));
    };

    // ---- where to begin: the largest ring system, else one end of the longest chain
    const memberSystems = [...new Set(members.map((atom) => systemOf[atom]).filter((index) => index >= 0))];
    let queue;
    if (memberSystems.length > 0) {
      const biggest = memberSystems.reduce((a, b) => (systems[b].atoms.length > systems[a].atoms.length ? b : a));
      for (const [atom, point] of systems[biggest].local) put(atom, point);
      queue = [...systems[biggest].atoms];
    } else {
      const farthestFrom = (start) => {
        const order = [start];
        const reached = new Set(order);
        for (let head = 0; head < order.length; head++) {
          for (const n of neighbors[order[head]]) {
            if (!reached.has(n.atom)) {
              reached.add(n.atom);
              order.push(n.atom);
            }
          }
        }
        return order[order.length - 1];
      };
      const start = farthestFrom(farthestFrom(seed));
      put(start, { x: 0, y: 0 });
      queue = [start];
    }

    for (let head = 0; head < queue.length; head++) {
      const atom = queue[head];
      const fresh = neighbors[atom].filter((nb) => !pos[nb.atom]).map((nb) => nb.atom);
      if (fresh.length === 0) continue;
      const angles = freeAngles(atom, fresh.length);
      fresh.forEach((next, k) => {
        const target = { x: pos[atom].x + Math.cos(angles[k]), y: pos[atom].y + Math.sin(angles[k]) };
        if (systemOf[next] < 0) {
          put(next, target);
          queue.push(next);
        } else {
          const system = systems[systemOf[next]];
          placeSystem(system, next, target, pos[atom]);
          queue.push(...system.atoms);
        }
      });
    }
    return members;
  };

  /** Mirror branches across their attaching bond wherever that relieves a collision. */
  const relieveClashes = (members) => {
    const bonded = (a, b) => neighbors[a].some((n) => n.atom === b);
    const strain = () => {
      let total = 0;
      for (let p = 0; p < members.length; p++) {
        for (let q = p + 1; q < members.length; q++) {
          const [a, b] = [members[p], members[q]];
          const gap = distance(pos[a], pos[b]);
          if (gap < 0.8 && !bonded(a, b)) total += (0.8 - gap) ** 2;
        }
      }
      return total;
    };
    let current = strain();
    for (let pass = 0; pass < 3 && current > 1e-9; pass++) {
      let improved = false;
      for (const bond of bonds) {
        if (ringBonds.has(bond.index) || pos[bond.a] === null || !members.includes(bond.a)) continue;
        if (neighbors[bond.a].length < 2 || neighbors[bond.b].length < 2) continue;
        // everything on b's side of the bond
        const branch = [bond.b];
        const seen = new Set([bond.a, bond.b]);
        for (let head = 0; head < branch.length; head++) {
          for (const n of neighbors[branch[head]]) {
            if (!seen.has(n.atom)) {
              seen.add(n.atom);
              branch.push(n.atom);
            }
          }
        }
        const a = pos[bond.a];
        const b = pos[bond.b];
        const span = distance(a, b);
        const ux = (b.x - a.x) / span;
        const uy = (b.y - a.y) / span;
        const before = branch.map((atom) => pos[atom]);
        for (const atom of branch) {
          const vx = pos[atom].x - a.x;
          const vy = pos[atom].y - a.y;
          const along = vx * ux + vy * uy;
          pos[atom] = { x: a.x + 2 * along * ux - vx, y: a.y + 2 * along * uy - vy };
        }
        const after = strain();
        if (after < current - 1e-9) {
          current = after;
          improved = true;
        } else {
          branch.forEach((atom, k) => (pos[atom] = before[k]));
        }
      }
      if (!improved) break;
    }
  };

  /** Rotate (in 30° steps) to the widest, flattest pose and move to the origin. */
  const settle = (members) => {
    let best = null;
    for (let step = 0; step < 12; step++) {
      const turned = members.map((atom) => rotate(pos[atom], (step * TAU) / 12));
      const xs = turned.map((p) => p.x);
      const ys = turned.map((p) => p.y);
      const box = { minX: Math.min(...xs), minY: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
      const score = box.width - box.height;
      if (best === null || score > best.score + 1e-6) best = { turned, box, score };
    }
    members.forEach((atom, k) => {
      pos[atom] = { x: best.turned[k].x - best.box.minX, y: best.turned[k].y - best.box.minY };
    });
    return best.box;
  };

  // ---- each connected piece, set side by side
  const pieces = [];
  for (let seed = 0; seed < count; seed++) {
    if (pos[seed] !== null) continue;
    const members = placeComponent(seed);
    relieveClashes(members);
    pieces.push({ members, box: settle(members) });
  }
  const height = Math.max(...pieces.map((piece) => piece.box.height));
  let cursor = 0;
  for (const piece of pieces) {
    const lift = (height - piece.box.height) / 2;
    for (const atom of piece.members) pos[atom] = { x: pos[atom].x + cursor, y: pos[atom].y + lift };
    cursor += piece.box.width + 1.5;
  }
  return { coords: pos, width: cursor - 1.5, height };
}
