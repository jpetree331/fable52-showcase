// Instrument II: SMILES in, skeletal formula out.

import { parseSmiles, molecularFormula } from '../lib/smiles.js';
import { layout } from '../lib/layout.js';
import { depict } from '../lib/depict.js';
import { molarMass, massComposition, formatHill } from '../lib/formula.js';
import { h, hillNode, note, errorNote, mountExamples, fixed } from './dom.js';

const EXAMPLES = [
  ['Caffeine', 'Cn1cnc2c1c(=O)n(C)c(=O)n2C'],
  ['Aspirin', 'CC(=O)Oc1ccccc1C(=O)O'],
  ['Ibuprofen', 'CC(C)Cc1ccc(cc1)C(C)C(=O)O'],
  ['Glucose', 'OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O'],
  ['Dopamine', 'NCCc1ccc(O)c(O)c1'],
  ['Serotonin', 'NCCc1c[nH]c2ccc(O)cc12'],
  ['Capsaicin', 'COc1cc(CNC(=O)CCCC/C=C/C(C)C)ccc1O'],
  ['Penicillin G', 'CC1(C)SC2C(NC(=O)Cc3ccccc3)C(=O)N2C1C(=O)O'],
  ['Cholesterol', 'CC(C)CCCC(C)C1CCC2C1(CCC3C2CC=C4C3(CCC(C4)O)C)C'],
  ['Indigo', 'O=C1C(=C2Nc3ccccc3C2=O)Nc2ccccc12'],
  ['Coronene', 'c1cc2ccc3ccc4ccc5ccc6ccc1c1c2c3c4c5c61'],
  ['TNT', 'Cc1c(cc(cc1[N+](=O)[O-])[N+](=O)[O-])[N+](=O)[O-]'],
  ['Cubane', 'C12C3C4C1C5C2C3C45'],
  ['Not aromatic', 'c1cccc1'],
];

const DEFAULT = EXAMPLES[0][1];

function factsNode(mol) {
  const { counts, charge } = molecularFormula(mol);
  const { mass, approximate } = molarMass(counts);
  const hydrogens = counts.get('H') ?? 0;
  const explicitH = mol.atoms.filter((atom) => atom.element === 'H').length;
  const stat = (label, value) => h('div', { class: 'stat' }, h('dt', null, label), h('dd', null, String(value)));

  return h(
    'div',
    { class: 'facts' },
    h(
      'div',
      null,
      h('p', { class: 'section-label' }, 'Molecular formula'),
      h('div', { class: 'fact-formula' }, hillNode(counts, charge)),
      h('div', { class: 'fact-mass' }, `${approximate ? '≈ ' : ''}${fixed(mass, mass < 1000 ? 3 : 2)} g/mol`),
    ),
    h(
      'dl',
      { class: 'stats' },
      stat('Heavy atoms', mol.atoms.length - explicitH),
      stat('Hydrogens', hydrogens),
      stat('Bonds', mol.bonds.length),
      stat('Rings', mol.rings.length),
    ),
    h(
      'div',
      null,
      h('p', { class: 'section-label' }, 'Composition by mass'),
      h(
        'div',
        { class: 'composition' },
        massComposition(counts).flatMap((part) => [
          h('span', { class: 'symbol' }, part.symbol),
          h('span', { class: 'track', title: `${part.symbol}: ${fixed(part.mass, 3)} g/mol` }, h('span', { class: 'fill', style: `width: ${fixed(part.fraction * 100, 2)}%` })),
          h('span', { class: 'share' }, `${fixed(part.fraction * 100, 2)} %`),
        ]),
      ),
    ),
  );
}

export function mountStructure(root, store) {
  const input = root.querySelector('#smiles-input');
  const output = root.querySelector('#smiles-result');

  const render = () => {
    const text = input.value.trim();
    store.set('smiles', text === DEFAULT ? '' : text);
    syncExamples();
    if (text === '') {
      output.replaceChildren(h('p', { class: 'hint' }, 'Type a SMILES string, or pick a molecule above.'));
      return;
    }
    try {
      const mol = parseSmiles(text);
      const placed = layout(mol);
      // Bigger bonds for small molecules, smaller for sprawling ones.
      const bondLength = Math.max(20, Math.min(46, 600 / (placed.width + 1.9)));
      const { counts, charge } = molecularFormula(mol);
      const plate = h('div', { class: 'plate' });
      // depict() emits only numbers and vetted element symbols, so this markup is ours.
      plate.innerHTML = depict(mol, placed, { bondLength, title: `Skeletal formula of ${formatHill(counts, charge)}` });
      const warnings = mol.warnings.length > 0 ? note('warn', 'Drawn, with a caveat', mol.warnings.map((warning) => h('p', null, warning))) : null;
      output.replaceChildren(...[warnings, h('div', { class: 'structure' }, plate, factsNode(mol))].filter(Boolean));
    } catch (err) {
      output.replaceChildren(errorNote(err, 'That is not a valid structure'));
    }
  };

  const syncExamples = mountExamples(root.querySelector('#smiles-examples'), EXAMPLES, input, render);
  input.addEventListener('input', render);
  input.value = store.get('smiles', DEFAULT);
  render();
}
