// Regenerates docs/molecules.svg, the gallery shown in the README.
//
//   node tools/gallery.mjs
//
// Every drawing in it is the library's unedited output, so the picture in
// the README cannot drift from what the code actually does.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSmiles, molecularFormula } from '../src/lib/smiles.js';
import { layout } from '../src/lib/layout.js';
import { depict } from '../src/lib/depict.js';
import { formatHill } from '../src/lib/formula.js';

const MOLECULES = [
  ['Caffeine', 'Cn1cnc2c1c(=O)n(C)c(=O)n2C'],
  ['Aspirin', 'CC(=O)Oc1ccccc1C(=O)O'],
  ['Serotonin', 'NCCc1c[nH]c2ccc(O)cc12'],
  ['Penicillin G', 'CC1(C)SC2C(NC(=O)Cc3ccccc3)C(=O)N2C1C(=O)O'],
  ['Indigo', 'O=C1C(=C2Nc3ccccc3C2=O)Nc2ccccc12'],
  ['Coronene', 'c1cc2ccc3ccc4ccc5ccc6ccc1c1c2c3c4c5c61'],
  ['Capsaicin', 'COc1cc(CNC(=O)CCCC/C=C/C(C)C)ccc1O'],
  ['Cholesterol', 'CC(C)CCCC(C)C1CCC2C1(CCC3C2CC=C4C3(CCC(C4)O)C)C'],
];

const COLUMNS = 3;
const CELL = { width: 360, height: 250 };
const WIDE = new Set(['Capsaicin', 'Cholesterol']); // long molecules take a row and a half
const INK = '#25211b';
const PAPER = '#f4eee1';
const CARD = '#fbf8f0';
const RULE = '#ddd3c0';

const subscripted = (formula) => formula.replace(/\d/g, (digit) => '₀₁₂₃₄₅₆₇₈₉'[digit]);

const cells = [];
let column = 0;
let row = 0;
for (const [name, smiles] of MOLECULES) {
  const span = WIDE.has(name) ? 1.5 : 1;
  if (column + span > COLUMNS) {
    column = 0;
    row++;
  }
  cells.push({ name, smiles, x: column * CELL.width, y: row * CELL.height, width: CELL.width * span });
  column += span;
}

const total = { width: COLUMNS * CELL.width, height: (row + 1) * CELL.height };
const parts = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total.width} ${total.height}" width="${total.width}" height="${total.height}" font-family="Georgia, serif" color="${INK}">`,
  `<rect width="100%" height="100%" fill="${PAPER}"/>`,
];
for (const cell of cells) {
  const mol = parseSmiles(cell.smiles);
  const placed = layout(mol);
  const room = { width: cell.width - 44, height: CELL.height - 84 };
  const bondLength = Math.min(34, room.width / (placed.width + 1.9), room.height / (placed.height + 1.9));
  const drawing = depict(mol, placed, { bondLength });
  const [, , , w, h] = /viewBox="(\S+) (\S+) (\S+) (\S+)"/.exec(drawing);
  const { counts, charge } = molecularFormula(mol);
  const dx = cell.x + (cell.width - Number(w)) / 2;
  const dy = cell.y + 14 + (CELL.height - 64 - Number(h)) / 2;
  parts.push(
    `<rect x="${cell.x + 8}" y="${cell.y + 8}" width="${cell.width - 16}" height="${CELL.height - 16}" rx="10" fill="${CARD}" stroke="${RULE}"/>`,
    `<g transform="translate(${dx.toFixed(1)} ${dy.toFixed(1)})">${drawing}</g>`,
    `<text x="${cell.x + cell.width / 2}" y="${cell.y + CELL.height - 40}" text-anchor="middle" font-size="16" fill="${INK}">${cell.name}</text>`,
    `<text x="${cell.x + cell.width / 2}" y="${cell.y + CELL.height - 22}" text-anchor="middle" font-size="12" font-family="Helvetica, Arial, sans-serif" fill="#8a8170">${subscripted(formatHill(counts, charge))}</text>`,
  );
}
parts.push('</svg>');

const out = fileURLToPath(new URL('../docs/molecules.svg', import.meta.url));
mkdirSync(fileURLToPath(new URL('../docs/', import.meta.url)), { recursive: true });
writeFileSync(out, parts.join('\n'));
console.log(`Wrote ${out}`);
