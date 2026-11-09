// Small DOM helpers shared by the three views.
//
// Everything user-typed reaches the page through textContent, never
// innerHTML, so there is nothing to escape and nothing to inject.

import { parseFormula, hillOrder, ChemSyntaxError } from '../lib/formula.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function build(node, attrs, children) {
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  node.append(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

/** Create an HTML element: h('p', {class: 'hint'}, 'text', childNode). */
export const h = (tag, attrs, ...children) => build(document.createElement(tag), attrs, children);

/** Create an SVG element. */
export const s = (tag, attrs, ...children) => build(document.createElementNS(SVG_NS, tag), attrs, children);

/** Typeset parsed formula parts with real subscripts and superscripts. */
export function formulaNode(parts) {
  return h(
    'span',
    { class: 'formula' },
    parts.map((part) => {
      if (part.type === 'count') return h('sub', null, part.text);
      if (part.type === 'charge') return h('sup', null, part.text);
      return part.text;
    }),
  );
}

/** Typeset a formula given as text, e.g. "H2PO4^-". */
export const formulaFromText = (text) => formulaNode(parseFormula(text).parts);

/** Typeset element counts in Hill order, with an optional net charge. */
export function hillNode(counts, charge = 0) {
  const parts = [];
  for (const [symbol, n] of hillOrder(counts)) {
    parts.push({ type: 'element', text: symbol });
    if (n > 1) parts.push({ type: 'count', text: String(n) });
  }
  if (charge !== 0) {
    const magnitude = Math.abs(charge) === 1 ? '' : Math.abs(charge);
    parts.push({ type: 'charge', text: `${magnitude}${charge > 0 ? '+' : '−'}` });
  }
  return formulaNode(parts);
}

/** The same typesetting inside an SVG <text>, using shifted <tspan>s. */
export function svgFormula(text, attrs) {
  const node = s('text', attrs);
  let shift = 0; // how far the baseline currently sits from normal
  for (const part of parseFormula(text).parts) {
    const want = part.type === 'count' ? 3 : part.type === 'charge' ? -5 : 0;
    const span = s('tspan', { dy: want - shift, 'font-size': want === 0 ? null : '0.8em' }, part.text);
    shift = want;
    node.append(span);
  }
  return node;
}

/** A coloured callout: note('warn', 'Title', 'Body text or nodes'). */
export function note(kind, title, ...body) {
  return h('div', { class: `note note-${kind}`, role: kind === 'bad' ? 'alert' : null }, h('p', { class: 'note-title' }, title), body);
}

/** Render a syntax error with a caret under the character at fault. */
export function errorNote(err, title) {
  if (!(err instanceof ChemSyntaxError)) throw err;
  const pointer = h('pre', { class: 'pointer' }, `${err.source}\n`, h('span', { class: 'caret' }, `${' '.repeat(err.pos)}^`));
  return note('bad', title, h('p', null, err.message), pointer);
}

/** Fill a row of example buttons that load text into an input. */
export function mountExamples(container, examples, input, onPick) {
  const buttons = examples.map(([label, value]) =>
    h(
      'button',
      {
        class: 'chip',
        type: 'button',
        'aria-pressed': 'false',
        title: value,
        onclick: () => {
          input.value = value;
          onPick();
          input.focus();
        },
      },
      label,
    ),
  );
  container.replaceChildren(...buttons);
  return () => buttons.forEach((button, k) => button.setAttribute('aria-pressed', String(examples[k][1] === input.value.trim())));
}

export const fixed = (value, digits = 2) => value.toFixed(digits);
