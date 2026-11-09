// A property-based testing harness in under fifty lines.
//
// A property is a claim about every input ("whatever the balancer returns
// conserves every element"), checked against a few hundred random cases.
// Cases come from a seeded generator, so a failure prints the one seed that
// reproduces it; and they grow in size as the run goes on, so the first
// failure to appear is usually close to the smallest one that exists.

/** Small fast seeded PRNG (mulberry32). Returns a function giving floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Gen {
  constructor(random) {
    this.random = random;
  }
  /** Integer in [lo, hi], inclusive. */
  int(lo, hi) {
    return lo + Math.floor(this.random() * (hi - lo + 1));
  }
  bool(probability = 0.5) {
    return this.random() < probability;
  }
  pick(items) {
    return items[this.int(0, items.length - 1)];
  }
  shuffle(items) {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

/**
 * Check `property` against `runs` generated cases.
 * @template T
 * @param {(g: Gen, size: number) => T} generate  size climbs from 1 to maxSize over the run
 * @param {(value: T) => void} property           throws (e.g. via assert) when the claim fails
 * @param {{runs?: number, seed?: number, maxSize?: number, show?: (value: T) => string}} [options]
 */
export function forAll(generate, property, options = {}) {
  const { runs = 200, seed = 0x5eed, maxSize = 8, show = (v) => JSON.stringify(v) } = options;
  for (let run = 0; run < runs; run++) {
    const caseSeed = seed + run;
    const size = 1 + Math.floor((run / runs) * maxSize);
    const value = generate(new Gen(mulberry32(caseSeed)), size);
    try {
      property(value);
    } catch (err) {
      err.message = `Property failed on case ${run} (seed ${caseSeed}, size ${size}):\n  ${show(value)}\n${err.message}`;
      throw err;
    }
  }
}
