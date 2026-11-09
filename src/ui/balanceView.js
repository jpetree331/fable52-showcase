// Instrument I: the equation balancer.

import { balance } from '../lib/balance.js';
import { ELEMENTS } from '../lib/elements.js';
import { h, formulaNode, note, errorNote, mountExamples } from './dom.js';

const EXAMPLES = [
  ['Rusting', 'Fe + O2 -> Fe2O3'],
  ['Octane', 'C8H18 + O2 -> CO2 + H2O'],
  ['Redox with ions', 'MnO4^- + Fe^2+ + H^+ -> Mn^2+ + Fe^3+ + H2O'],
  ['Half-reaction', 'Cr2O7^2- + H+ + e- -> Cr^3+ + H2O'],
  ['Phosphorus furnace', 'Ca3(PO4)2 + SiO2 + C -> CaSiO3 + CO + P4'],
  ['Hydrate', 'CuSO4·5H2O -> CuSO4 + H2O'],
  ['The monster', '[Cr(N2H4CO)6]4[Cr(CN)6]3 + KMnO4 + H2SO4 -> K2Cr2O7 + MnSO4 + CO2 + KNO3 + K2SO4 + H2O'],
  ['Two reactions in one', 'KMnO4 + H2O2 + H2SO4 -> MnSO4 + O2 + K2SO4 + H2O'],
  ['Cannot balance', 'H2 + O2 -> H2O2 + Au'],
  ['Wrong side', 'CO2 + H2O + O2 -> C6H12O6'],
];

const DEFAULT = EXAMPLES[2][1];

function equationNode(result) {
  const split = result.reactants.length;
  const term = (species, j) => {
    const coefficient = result.coefficients?.[j] ?? 1;
    return h(
      'span',
      { class: 'term' },
      coefficient === 1 ? null : h('span', { class: 'coefficient' }, coefficient.toLocaleString('en-US')),
      formulaNode(species.parts),
    );
  };
  const side = (list, offset) => list.flatMap((species, j) => [j > 0 ? h('span', { class: 'operator' }, '+') : null, term(species, j + offset)]);
  return h(
    'div',
    { class: 'equation' },
    side(result.reactants, 0),
    h('span', { class: 'arrow' }, result.reversible ? '⇌' : '→'),
    side(result.products, split),
  );
}

function ledgerNode(result) {
  const rows = result.tally.map((row) => {
    const element = ELEMENTS.get(row.label);
    return h(
      'tr',
      null,
      h('td', null, element ? [h('span', { class: 'formula' }, row.label), h('span', { class: 'name' }, element.name.toLowerCase())] : 'net charge'),
      h('td', null, row.left.toLocaleString('en-US')),
      h('td', null, row.right.toLocaleString('en-US')),
      h('td', { class: 'check', title: 'conserved' }, row.left === row.right ? '✓' : '✗'),
    );
  });
  const grams = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const mass = (value) => `${result.mass.approximate ? '≈ ' : ''}${grams.format(value)} g`;
  return h(
    'div',
    { class: 'ledger-wrap' },
    h(
      'table',
      { class: 'ledger' },
      h('caption', null, 'Atom ledger — what goes in must come out'),
      h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Reactants'), h('th', null, 'Products'), h('th', null, ''))),
      h('tbody', null, rows),
      h(
        'tfoot',
        null,
        h('tr', null, h('td', null, 'mass per mole of reaction'), h('td', null, mass(result.mass.left)), h('td', null, mass(result.mass.right)), h('td', { class: 'check' }, '✓')),
      ),
    ),
  );
}

function resultNodes(result) {
  if (result.status === 'impossible') {
    return [note('bad', 'This equation cannot be balanced', h('p', null, result.reason)), equationNode(result)];
  }
  if (result.status === 'underdetermined') {
    return [
      note(
        'warn',
        `${result.dimension} independent balancings — no unique answer`,
        h(
          'p',
          null,
          `Conserving atoms leaves ${result.dimension} degrees of freedom here, which means this is really ${result.dimension} separate reactions written as one. ` +
            'Infinitely many sets of coefficients balance it. Shown below is the smallest; algebra alone cannot say which one the chemistry follows — ' +
            'that takes electron bookkeeping, so split it into half-reactions to pin it down.',
        ),
      ),
      equationNode(result),
      ledgerNode(result),
    ];
  }
  return [equationNode(result), ledgerNode(result)];
}

export function mountBalance(root, store) {
  const input = root.querySelector('#eq-input');
  const output = root.querySelector('#eq-result');

  const render = () => {
    const text = input.value.trim();
    store.set('eq', text === DEFAULT ? '' : text);
    syncExamples();
    if (text === '') {
      output.replaceChildren(h('p', { class: 'hint' }, 'Type an equation, or pick an example above.'));
      return;
    }
    try {
      output.replaceChildren(...resultNodes(balance(text)));
    } catch (err) {
      output.replaceChildren(errorNote(err, 'That is not quite an equation yet'));
    }
  };

  const syncExamples = mountExamples(root.querySelector('#eq-examples'), EXAMPLES, input, render);
  input.addEventListener('input', render);
  input.value = store.get('eq', DEFAULT);
  render();
}
