#!/usr/bin/env node
// Command-line front end for the same library the web page uses.
//
//   alembic balance "Fe + O2 -> Fe2O3"
//   alembic mass "CuSO4·5H2O"
//   alembic smiles "CC(=O)Oc1ccccc1C(=O)O" [--svg aspirin.svg]
//   alembic ph acetic 0.1
//
// It exists to make one point: src/lib has no idea a browser exists.

import { writeFileSync } from 'node:fs';
import { balance, formatEquation } from '../src/lib/balance.js';
import { parseFormula, molarMass, formatHill, massComposition, ChemSyntaxError } from '../src/lib/formula.js';
import { parseSmiles, molecularFormula } from '../src/lib/smiles.js';
import { layout } from '../src/lib/layout.js';
import { depict } from '../src/lib/depict.js';
import { COMPOUNDS, compoundById, solvePH } from '../src/lib/equilibrium.js';

const USAGE = `Usage:
  alembic balance "<equation>"          balance a chemical equation
  alembic mass "<formula>"              molar mass and composition
  alembic smiles "<SMILES>" [--svg f]   formula and mass; optionally write a drawing
  alembic ph <compound> <mol/L>         pH of a solution (${COMPOUNDS.map((c) => c.id).join(', ')})`;

const massLine = (counts) => {
  const { mass, approximate } = molarMass(counts);
  return `${approximate ? '≈ ' : ''}${mass.toFixed(3)} g/mol`;
};

const commands = {
  balance([equation]) {
    const result = balance(equation);
    if (result.status === 'impossible') return `Cannot be balanced: ${result.reason}`;
    const lines = [formatEquation(result)];
    if (result.status === 'underdetermined') {
      lines.push(`Note: ${result.dimension} independent balancings exist; this is the smallest. The equation is several reactions written as one.`);
    }
    return lines.join('\n');
  },

  mass([formula]) {
    const { counts, charge } = parseFormula(formula);
    const rows = massComposition(counts).map((p) => `  ${p.symbol.padEnd(3)} ${String(p.count).padStart(4)}  ${(p.fraction * 100).toFixed(2).padStart(6)} %`);
    return [`${formatHill(counts, charge)}  ${massLine(counts)}`, ...rows].join('\n');
  },

  smiles([smiles, flag, file]) {
    const mol = parseSmiles(smiles);
    const { counts, charge } = molecularFormula(mol);
    const lines = [`${formatHill(counts, charge)}  ${massLine(counts)}`, `${mol.atoms.length} atoms, ${mol.bonds.length} bonds, ${mol.rings.length} rings`];
    lines.push(...mol.warnings.map((warning) => `Warning: ${warning}`));
    if (flag === '--svg') {
      if (!file) throw new Error('--svg needs a file name');
      // A fixed ink colour: a standalone file has no page to inherit one from.
      writeFileSync(file, depict(mol, layout(mol), { title: formatHill(counts, charge) }).replaceAll('currentColor', '#25211b'));
      lines.push(`Drawing written to ${file}`);
    }
    return lines.join('\n');
  },

  ph([id, concentration]) {
    const compound = compoundById(id);
    const conc = Number(concentration);
    if (!compound) throw new Error(`Unknown compound "${id}". Known: ${COMPOUNDS.map((c) => c.id).join(', ')}`);
    if (!(conc > 0)) throw new Error('Give a positive concentration in mol/L');
    return `${conc} M ${compound.name}: pH ${solvePH([{ compound, conc }]).toFixed(2)}`;
  },
};

const [command, ...args] = process.argv.slice(2);
if (!commands[command] || args.length === 0) {
  console.log(USAGE);
  process.exit(command ? 1 : 0);
}
try {
  console.log(commands[command](args));
} catch (err) {
  console.error(err instanceof ChemSyntaxError ? `${err.message}\n\n  ${err.source}\n  ${' '.repeat(err.pos)}^` : err.message);
  process.exit(1);
}
