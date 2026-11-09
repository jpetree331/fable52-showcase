// Instrument III: titration curves and speciation.
//
// Charts are drawn straight into SVG. Marks are thin, axes and grid stay in
// the background, text is always ink-coloured, and identity never rests on
// colour alone: every series is labelled where it peaks as well as in the
// legend, and the numbers are available as a table.

import {
  COMPOUNDS,
  INDICATORS,
  compoundById,
  fractions,
  pHAt,
  titrate,
  suggestIndicator,
  protonsDonated,
  protonsAccepted,
} from '../lib/equilibrium.js';
import { h, s, note, svgFormula, formulaFromText, fixed } from './dom.js';

const TITRANTS = ['naoh', 'hcl'];
const range = (indicator) => `${indicator.low.toFixed(1)}–${indicator.high.toFixed(1)}`;
const PH_MAX = 14;

/** A round tick spacing that gives about `target` ticks across `span`. */
function tickStep(span, target = 6) {
  const raw = span / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * power).find((step) => step >= raw);
}

/** Shared frame: plot area, scales, grid and axes. */
function frame({ width, height, margin, xMax, xStep, yMax, yStep, xTitle, yTitle, yFormat = String }) {
  const plot = { left: margin.left, right: width - margin.right, top: margin.top, bottom: height - margin.bottom };
  const x = (value) => plot.left + (value / xMax) * (plot.right - plot.left);
  const y = (value) => plot.bottom - (value / yMax) * (plot.bottom - plot.top);
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, role: 'img' });

  for (let tick = 0; tick <= yMax + 1e-9; tick += yStep) {
    svg.append(
      s('line', { class: tick === 0 ? 'baseline' : 'gridline', x1: plot.left, x2: plot.right, y1: y(tick), y2: y(tick) }),
      s('text', { x: plot.left - 8, y: y(tick) + 4, 'text-anchor': 'end' }, yFormat(tick)),
    );
  }
  for (let tick = 0; tick <= xMax + 1e-9; tick += xStep) {
    svg.append(
      s('line', { class: 'baseline', x1: x(tick), x2: x(tick), y1: plot.bottom, y2: plot.bottom + 4 }),
      s('text', { x: x(tick), y: plot.bottom + 18, 'text-anchor': 'middle' }, String(Math.round(tick * 100) / 100)),
    );
  }
  svg.append(
    s('text', { class: 'axis-title', x: (plot.left + plot.right) / 2, y: height - 6, 'text-anchor': 'middle' }, xTitle),
    s('text', { class: 'axis-title', x: plot.left - 8, y: plot.top - 13, 'text-anchor': 'end' }, yTitle),
  );
  return { svg, plot, x, y };
}

const pathThrough = (points) => points.map(([px, py], k) => `${k === 0 ? 'M' : 'L'}${px.toFixed(2)} ${py.toFixed(2)}`).join('');

function curveChart(setup, run, indicator, onProbe, width) {
  const height = Math.round(Math.max(280, Math.min(420, width * 0.58)));
  const { svg, plot, x, y } = frame({
    width,
    height,
    margin: { left: 44, right: 18, top: 30, bottom: 44 },
    xMax: run.maxVolume,
    xStep: tickStep(run.maxVolume, width < 520 ? 4 : 6),
    yMax: PH_MAX,
    yStep: 2,
    xTitle: `${setup.titrant.formula} added (mL)`,
    yTitle: 'pH',
  });
  svg.setAttribute('aria-label', `Titration curve: pH against millilitres of ${setup.titrant.name} added`);

  // indicator band: its colour change, from acid colour (low pH) to base colour (high pH)
  const gradient = s(
    'linearGradient',
    { id: 'indicator-band', x1: 0, y1: 1, x2: 0, y2: 0 },
    s('stop', { offset: '0%', 'stop-color': indicator.acid }),
    s('stop', { offset: '100%', 'stop-color': indicator.base }),
  );
  svg.append(
    s('defs', null, gradient),
    s('rect', { x: plot.left, y: y(indicator.high), width: plot.right - plot.left, height: y(indicator.low) - y(indicator.high), fill: 'url(#indicator-band)', opacity: 0.3 }),
    // named at the left edge: the curve only meets the band at the jump, further right
    s('text', { class: 'label muted halo', x: plot.left + 8, y: y(indicator.high) + 14 }, indicator.name),
  );

  svg.append(s('path', { class: 'curve', d: pathThrough(run.points.map((p) => [x(p.volume), y(p.pH)])) }));

  // buffer midpoints: pH = pKa
  for (const mid of run.midpoints) {
    if (mid.volume > run.maxVolume) continue;
    svg.append(
      s('circle', { class: 'midpoint-dot', cx: x(mid.volume), cy: y(mid.pH), r: 4 }),
      s('text', { class: 'label muted halo', x: x(mid.volume), y: y(mid.pH) + (run.basic ? -11 : 20), 'text-anchor': 'middle' }, `pKa ${fixed(mid.pKa)}`),
    );
  }

  // equivalence points: the free corner beside the jump is below-right when rising, above-right when falling
  for (const point of run.equivalence) {
    if (point.volume > run.maxVolume) continue;
    const px = x(point.volume);
    const py = y(point.pH);
    const nearRight = px > plot.right - 150;
    svg.append(
      s('line', { class: 'marker-line', x1: px, x2: px, y1: plot.bottom, y2: py }),
      s('circle', { class: `marker-dot${point.visible ? '' : ' faint'}`, cx: px, cy: py, r: 5 }),
    );
    // A step too gradual to see gets a faint dot and no label; the tile above explains it.
    if (!point.visible) continue;
    svg.append(
      s(
        'text',
        { class: 'label halo', x: px + (nearRight ? -10 : 10), y: py + (run.basic ? 18 : -10), 'text-anchor': nearRight ? 'end' : 'start' },
        `${fixed(point.volume)} mL · pH ${fixed(point.pH)}`,
      ),
    );
  }

  // hover layer: crosshair, dot, and a readout that keeps inside the plot
  const crosshair = s('line', { class: 'crosshair', y1: plot.top, y2: plot.bottom });
  const dot = s('circle', { class: 'marker-dot', r: 5 });
  const tipBox = s('rect', { width: 132, height: 44, rx: 6 });
  const tipVolume = s('text', { x: 10, y: 18 });
  const tipPH = s('text', { x: 10, y: 35 });
  const tooltip = s('g', { class: 'tooltip' }, tipBox, tipVolume, tipPH);
  const hover = s('g', { visibility: 'hidden', 'pointer-events': 'none' }, crosshair, dot, tooltip);
  const target = s('rect', { x: plot.left, y: plot.top, width: plot.right - plot.left, height: plot.bottom - plot.top, fill: 'transparent' });

  const probe = (volume) => {
    const pH = pHAt(setup, volume);
    const px = x(volume);
    const py = y(pH);
    crosshair.setAttribute('x1', px);
    crosshair.setAttribute('x2', px);
    dot.setAttribute('cx', px);
    dot.setAttribute('cy', py);
    const tx = px + 14 + 132 > plot.right ? px - 14 - 132 : px + 14;
    const ty = Math.max(plot.top, Math.min(plot.bottom - 44, py - 56 < plot.top ? py + 12 : py - 56));
    tooltip.setAttribute('transform', `translate(${tx.toFixed(1)} ${ty.toFixed(1)})`);
    tipVolume.replaceChildren(s('tspan', { class: 'tooltip-key' }, 'added  '), `${fixed(volume)} mL`);
    tipPH.replaceChildren(s('tspan', { class: 'tooltip-key' }, 'pH  '), fixed(pH));
    hover.setAttribute('visibility', 'visible');
    onProbe(pH);
  };
  const volumeAt = (event) => {
    const box = svg.getBoundingClientRect();
    const viewX = ((event.clientX - box.left) / box.width) * width;
    return Math.max(0, Math.min(run.maxVolume, ((viewX - plot.left) / (plot.right - plot.left)) * run.maxVolume));
  };
  target.addEventListener('pointermove', (event) => probe(volumeAt(event)));
  target.addEventListener('pointerdown', (event) => probe(volumeAt(event)));
  target.addEventListener('pointerleave', () => {
    hover.setAttribute('visibility', 'hidden');
    onProbe(null);
  });
  svg.append(hover, target);
  return svg;
}

function speciationChart(compound, restingPH, width) {
  const height = 210;
  const { svg, plot, x, y } = frame({
    width,
    height,
    margin: { left: 44, right: 18, top: 30, bottom: 40 },
    xMax: PH_MAX,
    xStep: 2,
    yMax: 1,
    yStep: 0.5,
    xTitle: 'pH',
    yTitle: 'share',
    yFormat: (tick) => `${Math.round(tick * 100)}%`,
  });
  svg.setAttribute('aria-label', `Speciation of ${compound.name}: fraction in each protonation state against pH`);

  const grid = Array.from({ length: 281 }, (_, k) => k * 0.05);
  const table = grid.map((pH) => fractions(compound, pH));
  compound.species.forEach((formula, form) => {
    const colour = `var(--series-${form + 1})`;
    svg.append(s('path', { class: 'series', stroke: colour, d: pathThrough(grid.map((pH, k) => [x(pH), y(table[k][form])])) }));
    // direct label where this form peaks
    let peak = 0;
    table.forEach((row, k) => {
      if (row[form] > table[peak][form]) peak = k;
    });
    const anchor = grid[peak] < 1 ? 'start' : grid[peak] > 13 ? 'end' : 'middle';
    svg.append(svgFormula(formula, { class: 'label halo', x: Math.max(plot.left + 4, Math.min(plot.right - 4, x(grid[peak]))), y: y(table[peak][form]) - 8, 'text-anchor': anchor }));
  });

  const marker = s('line', { class: 'crosshair', y1: plot.top, y2: plot.bottom });
  const markerLabel = s('text', { class: 'label halo', y: (plot.top + plot.bottom) / 2 + 4 });
  svg.append(marker, markerLabel);
  const setMarker = (pH) => {
    const value = pH ?? restingPH;
    const px = x(Math.max(0, Math.min(PH_MAX, value)));
    marker.setAttribute('x1', px);
    marker.setAttribute('x2', px);
    const flip = px > plot.right - 70;
    markerLabel.setAttribute('x', px + (flip ? -6 : 6));
    markerLabel.setAttribute('text-anchor', flip ? 'end' : 'start');
    markerLabel.textContent = `pH ${fixed(value)}`;
  };
  setMarker(null);
  return { svg, setMarker };
}

function dataTable(run, setup) {
  const stride = Math.max(1, Math.floor(run.points.length / 30));
  const rows = run.points.filter((_, k) => k % stride === 0 || k === run.points.length - 1);
  return h(
    'details',
    { class: 'data-table' },
    h('summary', null, 'Show the curve as a table'),
    h(
      'div',
      { class: 'scroll' },
      h(
        'table',
        null,
        h('thead', null, h('tr', null, h('th', null, `${setup.titrant.formula} added (mL)`), h('th', null, 'pH'))),
        h('tbody', null, rows.map((p) => h('tr', null, h('td', null, fixed(p.volume)), h('td', null, fixed(p.pH))))),
      ),
    ),
  );
}

export function mountTitrate(root, store) {
  const field = (id) => root.querySelector(`#${id}`);
  const analyteSelect = field('analyte');
  const titrantSelect = field('titrant');
  const indicatorSelect = field('indicator');
  const inputs = { analyteConc: field('analyte-conc'), analyteVolume: field('analyte-volume'), titrantConc: field('titrant-conc') };
  const output = root.querySelector('#titrate-result');

  const option = (c) => h('option', { value: c.id }, `${c.name} — ${c.formula}`);
  analyteSelect.append(
    h('optgroup', { label: 'Acids' }, COMPOUNDS.filter((c) => c.kind === 'acid').map(option)),
    h('optgroup', { label: 'Bases' }, COMPOUNDS.filter((c) => c.kind === 'base').map(option)),
  );
  titrantSelect.append(...TITRANTS.map((id) => option(compoundById(id))));
  indicatorSelect.append(h('option', { value: 'auto' }, 'Suggest one for me'), ...INDICATORS.map((i) => h('option', { value: i.id }, `${i.name} (pH ${range(i)})`)));

  const matchingTitrant = () => (compoundById(analyteSelect.value).kind === 'acid' ? 'naoh' : 'hcl');

  // Charts are drawn at the width they will be shown, so text stays a
  // readable size on a phone instead of shrinking with the viewBox.
  const availableWidth = () => Math.round(Math.max(320, Math.min(980, output.clientWidth || 760)));
  let drawnWidth = 0;

  const render = () => {
    drawnWidth = availableWidth();
    const setup = {
      analyte: compoundById(analyteSelect.value),
      titrant: compoundById(titrantSelect.value),
      analyteConc: Number(inputs.analyteConc.value),
      analyteVolume: Number(inputs.analyteVolume.value),
      titrantConc: Number(inputs.titrantConc.value),
    };
    store.set('analyte', setup.analyte.id === 'acetic' ? '' : setup.analyte.id);
    store.set('titrant', setup.titrant.id === matchingTitrant() ? '' : setup.titrant.id);

    const numbers = [setup.analyteConc, setup.analyteVolume, setup.titrantConc];
    if (numbers.some((n) => !Number.isFinite(n) || n <= 0) || setup.analyteConc > 10 || setup.titrantConc > 10) {
      output.replaceChildren(note('bad', 'Check the numbers', h('p', null, 'Concentrations and volume need to be positive, and concentrations at most 10 mol/L.')));
      return;
    }

    const basicTitrant = setup.titrant.id === 'naoh';
    const steps = basicTitrant ? protonsDonated(setup.analyte) : protonsAccepted(setup.analyte);
    if (steps === 0) {
      output.replaceChildren(
        note(
          'warn',
          'Nothing to titrate',
          h('p', null, `${setup.analyte.name} has no protons to ${basicTitrant ? 'give to a base' : 'take from an acid'}. Try ${basicTitrant ? 'hydrochloric acid' : 'sodium hydroxide'} in the burette.`),
        ),
      );
      return;
    }

    const run = titrate(setup);
    const sharpest = run.equivalence.filter((e) => e.visible).sort((a, b) => b.jump - a.jump)[0] ?? run.equivalence[0];
    const suggested = suggestIndicator(sharpest.pH);
    const indicator = indicatorSelect.value === 'auto' ? suggested : INDICATORS.find((i) => i.id === indicatorSelect.value);

    const tile = (label, value, detail, kind = '') =>
      h('div', { class: `tile ${kind}` }, h('dt', null, label), h('dd', null, value, detail ? h('small', null, detail) : null));
    const tiles = h(
      'dl',
      { class: 'tiles' },
      tile('Starting pH', fixed(run.points[0].pH)),
      run.equivalence.map((e) =>
        tile(
          run.equivalence.length > 1 ? `Equivalence ${e.step}` : 'Equivalence point',
          `${fixed(e.volume)} mL`,
          e.visible ? `pH ${fixed(e.pH)}` : `pH ${fixed(e.pH)} — too gradual to see`,
        ),
      ),
      tile(
        indicatorSelect.value === 'auto' ? 'Suggested indicator' : 'Indicator',
        [h('span', { class: 'swatch', style: `background: ${indicator.acid}` }), h('span', { class: 'swatch', style: `background: ${indicator.base}` }), indicator.name],
        `changes over pH ${range(indicator)}`,
        'tile-words',
      ),
    );

    const figures = [];
    let setMarker = () => {};
    const hasSpecies = setup.analyte.species.length > 1;
    const curve = curveChart(setup, run, indicator, (pH) => setMarker(pH), drawnWidth);
    figures.push(
      h(
        'figure',
        { class: 'figure' },
        h('figcaption', null, h('strong', null, `${setup.analyte.name} titrated with ${setup.titrant.name.toLowerCase()}`), h('span', null, 'hover or drag to read any point')),
        curve,
      ),
    );
    if (hasSpecies) {
      const speciation = speciationChart(setup.analyte, run.points[0].pH, drawnWidth);
      setMarker = speciation.setMarker;
      figures.push(
        h(
          'figure',
          { class: 'figure' },
          h('figcaption', null, h('strong', null, 'What the flask contains at each pH'), h('span', null, 'the marker follows the curve above')),
          h(
            'ul',
            { class: 'legend' },
            setup.analyte.species.map((formula, form) => h('li', null, h('span', { class: 'key', style: `background: var(--series-${form + 1})` }), formulaFromText(formula))),
          ),
          speciation.svg,
        ),
      );
    }
    output.replaceChildren(tiles, ...figures, dataTable(run, setup));
  };

  analyteSelect.value = compoundById(store.get('analyte')) ? store.get('analyte') : 'acetic';
  titrantSelect.value = TITRANTS.includes(store.get('titrant')) ? store.get('titrant') : matchingTitrant();
  analyteSelect.addEventListener('change', () => {
    titrantSelect.value = matchingTitrant();
    render();
  });
  for (const control of [titrantSelect, indicatorSelect, ...Object.values(inputs)]) control.addEventListener('input', render);
  render();
  new ResizeObserver(() => {
    if (Math.abs(availableWidth() - drawnWidth) > 4) render();
  }).observe(output);
}
