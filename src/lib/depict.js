// Skeletal-formula renderer: a laid-out molecule → an SVG string.
//
// Framework-free: runs unchanged in Node and in the browser. It builds a
// string rather than DOM nodes so the same code serves the page, the CLI
// and the tests.
//
// Conventions followed: carbons are unlabelled vertices; heteroatoms carry
// their hydrogens on whichever side is free ("HO–" on the left, "–OH" on the
// right); a ring double bond sits inside its ring; bonds stop short of
// labels.
//
// Colours come from CSS custom properties (--el-O and so on) with built-in
// fallbacks, so the drawing follows the page theme but also stands alone.

const PALETTE = {
  O: '#c0392b',
  N: '#2c5fb8',
  S: '#a67c00',
  P: '#c2611f',
  F: '#2e8b57',
  Cl: '#2e8b57',
  Br: '#8b3a1e',
  I: '#6a3d9a',
  B: '#b5651d',
};

const fmt = (n) => (Math.round(n * 100) / 100).toString();

/**
 * @param {import('./smiles.js').Molecule} mol
 * @param {{coords: {x: number, y: number}[], width: number, height: number}} placement from layout()
 * @param {{bondLength?: number, title?: string}} [options]
 * @returns {string} a complete <svg> element
 */
export function depict(mol, placement, options = {}) {
  const B = options.bondLength ?? 36;
  const font = B * 0.4;
  const pad = B * 0.95;
  const stroke = Math.max(1.2, B * 0.042);
  const gap = B * 0.14; // spacing between the lines of a multiple bond
  const { atoms, bonds, neighbors, rings } = mol;
  const P = placement.coords.map((p) => ({ x: pad + p.x * B, y: pad + p.y * B }));
  const width = placement.width * B + pad * 2;
  const height = placement.height * B + pad * 2;

  const colour = (element) => (PALETTE[element] ? `var(--el-${element}, ${PALETTE[element]})` : 'currentColor');
  const isLabelled = (atom) =>
    atom.element !== 'C' || neighbors[atom.index].length === 0 || atom.charge !== 0 || atom.isotope !== null;
  const symbolWidth = (atom) => font * 0.66 * atom.element.length;

  /** How far a bond leaving `atom` in direction (dx, dy) must stand off its label. */
  const standoff = (atom, dx, dy) => {
    if (!isLabelled(atom)) return 0;
    const rx = symbolWidth(atom) / 2 + font * 0.22;
    const ry = font * 0.62;
    return 1 / Math.hypot(dx / rx, dy / ry);
  };

  const out = [];
  const line = (x1, y1, x2, y2) => out.push(`<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}"/>`);

  out.push(`<g stroke="currentColor" stroke-width="${fmt(stroke)}" stroke-linecap="round" fill="none">`);
  for (const bond of bonds) {
    const a = atoms[bond.a];
    const b = atoms[bond.b];
    const [pa, pb] = [P[bond.a], P[bond.b]];
    const length = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
    const dx = (pb.x - pa.x) / length;
    const dy = (pb.y - pa.y) / length;
    const [nx, ny] = [-dy, dx];
    const trimA = standoff(a, dx, dy);
    const trimB = standoff(b, dx, dy);
    const x1 = pa.x + dx * trimA;
    const y1 = pa.y + dy * trimA;
    const x2 = pb.x - dx * trimB;
    const y2 = pb.y - dy * trimB;
    const shifted = (offset, inset = 0) =>
      line(
        x1 + nx * offset + dx * (trimA > 0 ? 0 : inset),
        y1 + ny * offset + dy * (trimA > 0 ? 0 : inset),
        x2 + nx * offset - dx * (trimB > 0 ? 0 : inset),
        y2 + ny * offset - dy * (trimB > 0 ? 0 : inset),
      );

    if (bond.order === 1) {
      shifted(0);
    } else if (bond.order >= 3) {
      shifted(0);
      shifted(gap);
      shifted(-gap);
    } else {
      const sideOf = (point) => Math.sign((point.x - pa.x) * nx + (point.y - pa.y) * ny);
      const home = rings
        .filter((ring) => ring.includes(bond.a) && ring.includes(bond.b))
        .sort((r, q) => r.length - q.length)[0];
      if (home) {
        // inside the ring it belongs to
        const cx = home.reduce((sum, atom) => sum + P[atom].x, 0) / home.length;
        const cy = home.reduce((sum, atom) => sum + P[atom].y, 0) / home.length;
        shifted(0);
        shifted(gap * (sideOf({ x: cx, y: cy }) || 1), gap * 0.9);
      } else if (neighbors[bond.a].length === 1 || neighbors[bond.b].length === 1) {
        // terminal, as in C=O: two lines straddling the axis
        shifted(gap / 2);
        shifted(-gap / 2);
      } else {
        // otherwise toward the busier side
        let lean = 0;
        for (const end of [bond.a, bond.b]) {
          for (const n of neighbors[end]) if (n.atom !== bond.a && n.atom !== bond.b) lean += sideOf(P[n.atom]);
        }
        shifted(0);
        shifted(gap * (lean < 0 ? -1 : 1), gap * 0.9);
      }
    }
  }
  out.push('</g>');

  out.push(`<g font-family="'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif" font-size="${fmt(font)}" font-weight="500">`);
  for (const atom of atoms) {
    if (!isLabelled(atom)) continue;
    const { x, y } = P[atom.index];
    const w = symbolWidth(atom);
    const fill = colour(atom.element);
    const baseline = y + font * 0.35;
    out.push(`<text x="${fmt(x)}" y="${fmt(baseline)}" text-anchor="middle" fill="${fill}">${atom.element}</text>`);

    if (atom.isotope !== null) {
      out.push(
        `<text x="${fmt(x - w / 2 - 1)}" y="${fmt(baseline - font * 0.42)}" text-anchor="end" font-size="${fmt(font * 0.68)}" fill="${fill}">${atom.isotope}</text>`,
      );
    }

    // Hydrogens go where the bonds are not.
    let side = 'right';
    const h = atom.hydrogens;
    const hText = h === 0 ? '' : h === 1 ? 'H' : `H<tspan dy="${fmt(font * 0.28)}" font-size="${fmt(font * 0.7)}">${h}</tspan>`;
    const hWidth = h === 0 ? 0 : font * (h === 1 ? 0.7 : 1.08);
    if (h > 0) {
      let sx = 0;
      let sy = 0;
      for (const n of neighbors[atom.index]) {
        const d = Math.hypot(P[n.atom].x - x, P[n.atom].y - y) || 1;
        sx += (P[n.atom].x - x) / d;
        sy += (P[n.atom].y - y) / d;
      }
      const degree = neighbors[atom.index].length;
      if (degree <= 1) side = sx > 0.3 ? 'left' : 'right';
      else if (Math.abs(sx) > 0.3) side = sx > 0 ? 'left' : 'right';
      else side = sy > 0 ? 'up' : 'down';

      if (side === 'right') out.push(`<text x="${fmt(x + w / 2 + 0.5)}" y="${fmt(baseline)}" fill="${fill}">${hText}</text>`);
      else if (side === 'left') out.push(`<text x="${fmt(x - w / 2 - 0.5)}" y="${fmt(baseline)}" text-anchor="end" fill="${fill}">${hText}</text>`);
      else out.push(`<text x="${fmt(x)}" y="${fmt(baseline + (side === 'up' ? -1 : 1) * font * 0.98)}" text-anchor="middle" fill="${fill}">${hText}</text>`);
    }

    if (atom.charge !== 0) {
      const magnitude = Math.abs(atom.charge) === 1 ? '' : Math.abs(atom.charge);
      const cx = x + w / 2 + (side === 'right' ? hWidth : 0) + 1;
      out.push(
        `<text x="${fmt(cx)}" y="${fmt(baseline - font * 0.42)}" font-size="${fmt(font * 0.72)}" fill="${fill}">${magnitude}${atom.charge > 0 ? '+' : '−'}</text>`,
      );
    }
  }
  out.push('</g>');

  const title = options.title ? `<title>${options.title.replace(/[<>&]/g, '')}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width)} ${fmt(height)}" width="${fmt(width)}" height="${fmt(height)}" role="img">${title}${out.join('')}</svg>`;
}
