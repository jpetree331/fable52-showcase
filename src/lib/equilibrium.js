// Acid–base equilibrium: the pH of any mixture, and titration curves.
//
// Framework-free: runs unchanged in Node and in the browser.
//
// One method covers every case — strong, weak, polyprotic, amphoteric,
// buffers, the far side of an equivalence point — with no special-case
// formulas: write down the charge balance and solve it.
//
//   [H+] − Kw/[H+] + Σ conc · (mean charge of the solute at this pH) = 0
//
// The left side falls monotonically as pH rises, so bisection cannot fail
// to converge. The textbook shortcuts (Henderson–Hasselbalch, "pH = ½(pKa1 +
// pKa2)", the square-root rule) are all approximations of this one equation,
// and the tests check them against it.
//
// Model limits, stated plainly: 25 °C, ideal solution (activities equal
// concentrations), so results drift from a real pH meter at high ionic
// strength.

export const KW = 1e-14;

/**
 * A solute as weighed out.
 *
 * `pKas` are the successive deprotonations of the fully protonated form,
 * which has charge `z0`. `form` says how many of those protons the weighed
 * compound has already lost; spectator ions (Na+, Cl−) make up the
 * difference so the compound is neutral. Strong bases are pure spectator.
 *
 * @typedef {object} Compound
 * @property {string} id
 * @property {string} name
 * @property {string} formula
 * @property {number[]} pKas
 * @property {number} z0
 * @property {number} form
 * @property {number} [spectator] net charge of spectator ions per formula unit, when not implied
 * @property {number} [accepts]   protons it can take up, when not implied
 * @property {string[]} species    formula of each protonation state, most protonated first
 * @property {'acid'|'base'} kind
 */

/** @type {Compound[]} */
export const COMPOUNDS = [
  { id: 'hcl', name: 'Hydrochloric acid', formula: 'HCl', pKas: [-7], z0: 0, form: 0, species: ['HCl', 'Cl^-'], kind: 'acid' },
  { id: 'acetic', name: 'Acetic acid', formula: 'CH3COOH', pKas: [4.756], z0: 0, form: 0, species: ['CH3COOH', 'CH3COO^-'], kind: 'acid' },
  { id: 'formic', name: 'Formic acid', formula: 'HCOOH', pKas: [3.745], z0: 0, form: 0, species: ['HCOOH', 'HCOO^-'], kind: 'acid' },
  { id: 'sulfuric', name: 'Sulfuric acid', formula: 'H2SO4', pKas: [-3, 1.99], z0: 0, form: 0, species: ['H2SO4', 'HSO4^-', 'SO4^2-'], kind: 'acid' },
  { id: 'carbonic', name: 'Carbonic acid', formula: 'H2CO3', pKas: [6.352, 10.329], z0: 0, form: 0, species: ['H2CO3', 'HCO3^-', 'CO3^2-'], kind: 'acid' },
  { id: 'phosphoric', name: 'Phosphoric acid', formula: 'H3PO4', pKas: [2.148, 7.198, 12.375], z0: 0, form: 0, species: ['H3PO4', 'H2PO4^-', 'HPO4^2-', 'PO4^3-'], kind: 'acid' },
  { id: 'citric', name: 'Citric acid', formula: 'C6H8O7', pKas: [3.128, 4.761, 6.396], z0: 0, form: 0, species: ['C6H8O7', 'C6H7O7^-', 'C6H6O7^2-', 'C6H5O7^3-'], kind: 'acid' },
  { id: 'glycine-hcl', name: 'Glycine hydrochloride', formula: 'C2H6NO2Cl', pKas: [2.35, 9.778], z0: 1, form: 0, species: ['C2H6NO2^+', 'C2H5NO2', 'C2H4NO2^-'], kind: 'acid' },
  { id: 'naoh', name: 'Sodium hydroxide', formula: 'NaOH', pKas: [], z0: 0, form: 0, spectator: 1, accepts: 1, species: [], kind: 'base' },
  { id: 'ammonia', name: 'Ammonia', formula: 'NH3', pKas: [9.245], z0: 1, form: 1, species: ['NH4^+', 'NH3'], kind: 'base' },
  { id: 'tris', name: 'Tris', formula: 'C4H11NO3', pKas: [8.072], z0: 1, form: 1, species: ['C4H12NO3^+', 'C4H11NO3'], kind: 'base' },
  { id: 'carbonate', name: 'Sodium carbonate', formula: 'Na2CO3', pKas: [6.352, 10.329], z0: 0, form: 2, species: ['H2CO3', 'HCO3^-', 'CO3^2-'], kind: 'base' },
  { id: 'bicarbonate', name: 'Sodium bicarbonate', formula: 'NaHCO3', pKas: [6.352, 10.329], z0: 0, form: 1, species: ['H2CO3', 'HCO3^-', 'CO3^2-'], kind: 'base' },
];

export const compoundById = (id) => COMPOUNDS.find((c) => c.id === id);
export const spectatorCharge = (c) => c.spectator ?? -(c.z0 - c.form);
export const protonsDonated = (c) => c.pKas.length - c.form;
export const protonsAccepted = (c) => c.accepts ?? c.form;

/** Colour-change ranges of common indicators. */
export const INDICATORS = [
  { id: 'methyl-orange', name: 'Methyl orange', low: 3.1, high: 4.4, acid: '#e0483a', base: '#f2c230' },
  { id: 'bromocresol-green', name: 'Bromocresol green', low: 3.8, high: 5.4, acid: '#e8cf3a', base: '#2f6fc4' },
  { id: 'methyl-red', name: 'Methyl red', low: 4.4, high: 6.2, acid: '#d9364a', base: '#f0cf3c' },
  { id: 'bromothymol-blue', name: 'Bromothymol blue', low: 6.0, high: 7.6, acid: '#e8cf3a', base: '#2a62c9' },
  { id: 'phenol-red', name: 'Phenol red', low: 6.8, high: 8.4, acid: '#f0cf3c', base: '#d1344b' },
  { id: 'phenolphthalein', name: 'Phenolphthalein', low: 8.2, high: 10.0, acid: '#f3ece8', base: '#d6368f' },
  { id: 'thymolphthalein', name: 'Thymolphthalein', low: 9.3, high: 10.5, acid: '#f1efe9', base: '#2f66c9' },
];

/**
 * Fraction of a compound in each protonation state, most protonated first.
 * Worked in logs so that a factor of 10^±40 between states is harmless.
 * @returns {number[]} sums to 1
 */
export function fractions(compound, pH) {
  const logs = [0];
  for (const pKa of compound.pKas) logs.push(logs[logs.length - 1] + pH - pKa);
  const top = Math.max(...logs);
  const weights = logs.map((l) => 10 ** (l - top));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / total);
}

export function meanCharge(compound, pH) {
  return fractions(compound, pH).reduce((charge, alpha, i) => charge + alpha * (compound.z0 - i), 0);
}

/**
 * Net charge the solution would carry at this pH; the true pH makes it zero.
 * @param {{compound: Compound, conc: number}[]} mixture concentrations in mol/L
 */
export function chargeImbalance(mixture, pH) {
  const h = 10 ** -pH;
  let charge = h - KW / h;
  for (const { compound, conc } of mixture) charge += conc * (meanCharge(compound, pH) + spectatorCharge(compound));
  return charge;
}

/** @param {{compound: Compound, conc: number}[]} mixture */
export function solvePH(mixture) {
  let lo = -2;
  let hi = 16;
  for (let step = 0; step < 60; step++) {
    const mid = (lo + hi) / 2;
    if (chargeImbalance(mixture, mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * @typedef {object} TitrationSetup
 * @property {Compound} analyte
 * @property {number} analyteConc    mol/L
 * @property {number} analyteVolume  mL
 * @property {Compound} titrant      a strong acid or strong base
 * @property {number} titrantConc    mol/L
 */

/** pH after `volume` mL of titrant has gone in. @param {TitrationSetup} setup */
export function pHAt(setup, volume) {
  const total = setup.analyteVolume + volume;
  return solvePH([
    { compound: setup.analyte, conc: (setup.analyteConc * setup.analyteVolume) / total },
    { compound: setup.titrant, conc: (setup.titrantConc * volume) / total },
  ]);
}

/**
 * A full titration: the curve, each equivalence point, and each buffer
 * midpoint (where pH ≈ pKa).
 * @param {TitrationSetup} setup
 * @param {{points?: number, maxVolume?: number}} [options]
 */
export function titrate(setup, options = {}) {
  const basic = spectatorCharge(setup.titrant) > 0; // titrant is a base
  const steps = basic ? protonsDonated(setup.analyte) : protonsAccepted(setup.analyte);
  const strength = basic ? protonsAccepted(setup.titrant) : protonsDonated(setup.titrant);
  const unit = steps > 0 ? (setup.analyteConc * setup.analyteVolume) / (setup.titrantConc * strength) : 0;

  const maxVolume = options.maxVolume ?? (steps > 0 ? unit * (steps + 0.6) : setup.analyteVolume);
  const count = options.points ?? 480;

  const equivalence = [];
  const midpoints = [];
  for (let k = 1; k <= steps; k++) {
    const volume = k * unit;
    // A step only makes a usable endpoint if the pH really jumps across it:
    // here, by more than 0.3 between 1% short of the volume and 1% past it.
    const jump = Math.abs(pHAt(setup, volume * 1.01) - pHAt(setup, volume * 0.99));
    equivalence.push({ step: k, volume, pH: pHAt(setup, volume), jump, visible: jump > 0.3 });

    const pKa = basic ? setup.analyte.pKas[setup.analyte.form + k - 1] : setup.analyte.pKas[setup.analyte.form - k];
    if (pKa !== undefined && pKa > 1 && pKa < 13) {
      const half = (k - 0.5) * unit;
      midpoints.push({ step: k, volume: half, pH: pHAt(setup, half), pKa });
    }
  }

  // Sample evenly, plus the equivalence points themselves so the steepest
  // part of the curve is never stepped over.
  const volumes = Array.from({ length: count + 1 }, (_, i) => (maxVolume * i) / count);
  for (const point of equivalence) if (point.volume < maxVolume) volumes.push(point.volume);
  volumes.sort((a, b) => a - b);
  const points = volumes.map((volume) => ({ volume, pH: pHAt(setup, volume) }));

  return { points, equivalence, midpoints, maxVolume, basic };
}

/** The indicator whose colour change best brackets a given equivalence pH. */
export function suggestIndicator(pH) {
  const distance = (ind) => (pH >= ind.low && pH <= ind.high ? 0 : Math.min(Math.abs(pH - ind.low), Math.abs(pH - ind.high)));
  return INDICATORS.reduce((best, ind) => {
    const delta = distance(ind) - distance(best) || Math.abs(pH - (ind.low + ind.high) / 2) - Math.abs(pH - (best.low + best.high) / 2);
    return delta < 0 ? ind : best;
  });
}
