import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KW,
  COMPOUNDS,
  INDICATORS,
  compoundById,
  fractions,
  chargeImbalance,
  solvePH,
  pHAt,
  titrate,
  suggestIndicator,
  spectatorCharge,
} from '../src/lib/equilibrium.js';
import { parseFormula } from '../src/lib/formula.js';
import { forAll } from './prop.js';

const pHOf = (id, conc) => solvePH([{ compound: compoundById(id), conc }]);
const near = (actual, expected, tolerance, label = '') => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected} ± ${tolerance}, got ${actual}`);
};

test('pure water is neutral', () => {
  near(solvePH([]), 7, 1e-9);
});

test('strong acids and bases', () => {
  near(pHOf('hcl', 0.1), 1, 1e-6);
  near(pHOf('hcl', 0.001), 3, 1e-6);
  near(pHOf('naoh', 0.1), 13, 1e-6);
});

test('very dilute strong acid: water still matters', () => {
  // The trap question. 1e-8 M HCl is not pH 8; water's own H+ dominates.
  const h = (1e-8 + Math.sqrt(1e-16 + 4 * KW)) / 2;
  near(pHOf('hcl', 1e-8), -Math.log10(h), 1e-9);
  assert.ok(pHOf('hcl', 1e-8) < 7);
});

test('weak acid matches the exact quadratic', () => {
  for (const conc of [1, 0.1, 0.01, 0.001]) {
    const ka = 10 ** -4.756;
    const h = (-ka + Math.sqrt(ka * ka + 4 * ka * conc)) / 2; // ignores water: fine above 1e-3 M
    near(pHOf('acetic', conc), -Math.log10(h), 1e-4, `${conc} M acetic acid`);
  }
});

test('weak base matches the exact quadratic', () => {
  const kb = KW / 10 ** -9.245;
  const oh = (-kb + Math.sqrt(kb * kb + 4 * kb * 0.1)) / 2;
  near(pHOf('ammonia', 0.1), 14 + Math.log10(oh), 1e-4);
});

test('textbook approximations hold where they should', () => {
  // amphoteric salt: pH ≈ ½(pKa1 + pKa2)
  near(pHOf('bicarbonate', 0.1), (6.352 + 10.329) / 2, 0.02, 'NaHCO3');
  // sulfuric acid at 0.1 M: second proton only partly off, so pH sits between 0.70 and 1.00
  const sulfuric = pHOf('sulfuric', 0.1);
  assert.ok(sulfuric > 0.7 && sulfuric < 1.0, `0.1 M H2SO4 gave ${sulfuric}`);
  near(sulfuric, 0.963, 0.005);
});

test('Henderson–Hasselbalch: an equimolar buffer sits at its pKa', () => {
  const buffer = [
    { compound: compoundById('acetic'), conc: 0.1 },
    { compound: { ...compoundById('acetic'), form: 1 }, conc: 0.1 }, // sodium acetate
  ];
  near(solvePH(buffer), 4.756, 0.001);
});

test('species fractions sum to one and cross at each pKa', () => {
  const phosphoric = compoundById('phosphoric');
  for (let pH = 0; pH <= 14; pH += 0.5) {
    near(fractions(phosphoric, pH).reduce((a, b) => a + b, 0), 1, 1e-12);
  }
  phosphoric.pKas.forEach((pKa, i) => {
    const alphas = fractions(phosphoric, pKa);
    near(alphas[i], alphas[i + 1], 1e-12, `forms ${i} and ${i + 1} at pH ${pKa}`);
  });
});

test('titrating acetic acid with NaOH', () => {
  const setup = { analyte: compoundById('acetic'), analyteConc: 0.1, analyteVolume: 25, titrant: compoundById('naoh'), titrantConc: 0.1 };
  const run = titrate(setup);
  assert.equal(run.equivalence.length, 1);
  near(run.equivalence[0].volume, 25, 1e-9);
  // at equivalence it is 0.05 M acetate: pH = 7 + ½(pKa + log C)
  near(run.equivalence[0].pH, 7 + 0.5 * (4.756 + Math.log10(0.05)), 0.01);
  assert.equal(run.equivalence[0].visible, true);
  near(run.midpoints[0].pH, 4.756, 0.01, 'half-equivalence');
  near(run.points[0].pH, pHOf('acetic', 0.1), 1e-9);
  assert.equal(suggestIndicator(run.equivalence[0].pH).id, 'phenolphthalein');
});

test('titrating a strong acid with a strong base meets at pH 7', () => {
  const setup = { analyte: compoundById('hcl'), analyteConc: 0.1, analyteVolume: 25, titrant: compoundById('naoh'), titrantConc: 0.1 };
  const run = titrate(setup);
  near(run.equivalence[0].pH, 7, 1e-6);
  assert.equal(suggestIndicator(7).id, 'bromothymol-blue');
});

test('phosphoric acid shows two usable equivalence points, not three', () => {
  const setup = { analyte: compoundById('phosphoric'), analyteConc: 0.1, analyteVolume: 25, titrant: compoundById('naoh'), titrantConc: 0.1 };
  const run = titrate(setup);
  assert.deepEqual(run.equivalence.map((e) => Math.round(e.volume)), [25, 50, 75]);
  assert.deepEqual(run.equivalence.map((e) => e.visible), [true, true, false]);
  near(run.equivalence[0].pH, (2.148 + 7.198) / 2, 0.1);
  near(run.equivalence[1].pH, (7.198 + 12.375) / 2, 0.15);
  near(run.midpoints[1].pH, 7.198, 0.02);
});

test('titrating a base with acid runs downhill', () => {
  const setup = { analyte: compoundById('carbonate'), analyteConc: 0.1, analyteVolume: 25, titrant: compoundById('hcl'), titrantConc: 0.1 };
  const run = titrate(setup);
  assert.equal(run.basic, false);
  assert.equal(run.equivalence.length, 2);
  near(run.equivalence[0].pH, (6.352 + 10.329) / 2, 0.05);
  assert.ok(run.points[0].pH > 11 && run.points[run.points.length - 1].pH < 2);
});

test('the compound table is self-consistent', () => {
  assert.equal(new Set(COMPOUNDS.map((c) => c.id)).size, COMPOUNDS.length);
  for (const c of COMPOUNDS) {
    assert.doesNotThrow(() => parseFormula(c.formula), `${c.name} has a parseable formula`);
    assert.deepEqual([...c.pKas].sort((a, b) => a - b), c.pKas, `${c.name} pKas ascend`);
    assert.ok(c.form >= 0 && c.form <= c.pKas.length);
    // dissolved alone, an acid must come out acidic and a base basic
    const pH = pHOf(c.id, 0.1);
    assert.ok(c.kind === 'acid' ? pH < 7 : pH > 7, `${c.name} at 0.1 M gave pH ${pH}`);
  }
  for (const ind of INDICATORS) assert.ok(ind.low < ind.high);
});

test('each compound lists its protonation states, one proton and one charge apart', () => {
  for (const c of COMPOUNDS) {
    if (c.pKas.length === 0) {
      assert.deepEqual(c.species, []);
      continue;
    }
    assert.equal(c.species.length, c.pKas.length + 1, `${c.name} has one species per state`);
    const states = c.species.map((formula) => parseFormula(formula));
    states.forEach((state, i) => {
      assert.equal(state.charge, c.z0 - i, `${c.species[i]} carries charge ${c.z0 - i}`);
      if (i > 0) assert.equal(state.counts.get('H') ?? 0, (states[i - 1].counts.get('H') ?? 0) - 1, `${c.species[i]} has one H fewer`);
    });
  }
});

test('a soft endpoint still counts; a vanishing one does not', () => {
  const withAcid = (id) => titrate({ analyte: compoundById(id), analyteConc: 0.1, analyteVolume: 25, titrant: compoundById('hcl'), titrantConc: 0.1 });
  const withBase = (id) => titrate({ analyte: compoundById(id), analyteConc: 0.1, analyteVolume: 25, titrant: compoundById('naoh'), titrantConc: 0.1 });
  // carbonate's first endpoint is the classic soft one (phenolphthalein); its second is sharp
  assert.deepEqual(withAcid('carbonate').equivalence.map((e) => e.visible), [true, true]);
  // citric acid's three pKas sit so close that only the last step shows
  assert.deepEqual(withBase('citric').equivalence.map((e) => e.visible), [false, false, true]);
  // sulfuric acid's first proton is gone before the titration starts
  assert.deepEqual(withBase('sulfuric').equivalence.map((e) => e.visible), [false, true]);
});

// ---- properties -----------------------------------------------------------

const anyMixture = (g, size) =>
  Array.from({ length: g.int(1, 1 + Math.min(size, 4)) }, () => ({
    compound: g.pick(COMPOUNDS),
    conc: 10 ** -(g.int(0, 60) / 10), // 1 M down to 1e-6 M
  }));
const showMixture = (mixture) => mixture.map((m) => `${m.conc.toExponential(2)} M ${m.compound.id}`).join(' + ');

test('property: the solved pH really balances the charges', () => {
  forAll(
    anyMixture,
    (mixture) => {
      const pH = solvePH(mixture);
      assert.ok(pH > -2 && pH < 16, 'root lies inside the bracket');
      // The residual must be negligible next to the largest term in the sum.
      const scale = Math.max(10 ** -pH, KW / 10 ** -pH, ...mixture.map((m) => m.conc * Math.max(1, Math.abs(spectatorCharge(m.compound)))));
      assert.ok(Math.abs(chargeImbalance(mixture, pH)) < 1e-9 * scale, `residual ${chargeImbalance(mixture, pH)}`);
    },
    { runs: 500, show: showMixture },
  );
});

test('property: charge imbalance falls monotonically with pH, so the root is unique', () => {
  forAll(
    anyMixture,
    (mixture) => {
      let previous = Infinity;
      for (let pH = -2; pH <= 16; pH += 0.25) {
        const now = chargeImbalance(mixture, pH);
        assert.ok(now < previous, `not decreasing at pH ${pH}`);
        previous = now;
      }
    },
    { runs: 200, show: showMixture },
  );
});

test('property: adding base never lowers the pH; adding acid never raises it', () => {
  const acids = COMPOUNDS.filter((c) => c.kind === 'acid');
  const bases = COMPOUNDS.filter((c) => c.kind === 'base');
  forAll(
    (g) => {
      const withBase = g.bool();
      return {
        analyte: g.pick(withBase ? acids : bases),
        titrant: compoundById(withBase ? 'naoh' : 'hcl'),
        analyteConc: 10 ** -(g.int(0, 30) / 10),
        titrantConc: 10 ** -(g.int(0, 30) / 10),
        analyteVolume: g.int(5, 100),
      };
    },
    (setup) => {
      const direction = setup.titrant.id === 'naoh' ? 1 : -1;
      let previous = pHAt(setup, 0);
      for (let step = 1; step <= 60; step++) {
        const now = pHAt(setup, step * 2);
        assert.ok((now - previous) * direction >= -1e-9, `pH moved the wrong way at ${step * 2} mL`);
        previous = now;
      }
    },
    { runs: 150, show: (s) => `${s.analyteConc.toExponential(1)} M ${s.analyte.id} + ${s.titrantConc.toExponential(1)} M ${s.titrant.id}` },
  );
});
