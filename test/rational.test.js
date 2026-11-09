import test from 'node:test';
import assert from 'node:assert/strict';
import { Rational, ZERO, ONE, toIntegers, gcd, lcm } from '../src/lib/rational.js';
import { forAll } from './prop.js';

const q = (n, d = 1) => new Rational(BigInt(n), BigInt(d));
const anyRational = (g) => q(g.int(-40, 40), g.pick([1, 2, 3, 4, 5, 6, 7, 12, -3, -8]));
const show = (values) => values.map(String).join(', ');

test('normalises sign and lowest terms', () => {
  assert.equal(q(6, -8).toString(), '-3/4');
  assert.equal(q(0, 5).toString(), '0');
  assert.equal(q(10, 5).toString(), '2');
  assert.throws(() => q(1, 0), RangeError);
  assert.throws(() => ONE.div(ZERO), RangeError);
});

test('gcd and lcm', () => {
  assert.equal(gcd(12n, -18n), 6n);
  assert.equal(gcd(0n, 7n), 7n);
  assert.equal(lcm(4n, 6n), 12n);
});

test('property: rationals obey the field axioms', () => {
  forAll(
    (g) => [anyRational(g), anyRational(g), anyRational(g)],
    ([a, b, c]) => {
      assert.ok(a.add(b).equals(b.add(a)), 'addition commutes');
      assert.ok(a.mul(b).equals(b.mul(a)), 'multiplication commutes');
      assert.ok(a.add(b).add(c).equals(a.add(b.add(c))), 'addition associates');
      assert.ok(a.mul(b.add(c)).equals(a.mul(b).add(a.mul(c))), 'multiplication distributes');
      assert.ok(a.sub(a).isZero(), 'a − a = 0');
      if (!b.isZero()) assert.ok(a.div(b).mul(b).equals(a), '(a / b) · b = a');
    },
    { runs: 400, show },
  );
});

test('property: toIntegers gives the smallest parallel integer vector', () => {
  forAll(
    (g, size) => Array.from({ length: 1 + size }, () => anyRational(g)),
    (vector) => {
      if (vector.every((x) => x.isZero())) return;
      const ints = toIntegers(vector);
      assert.equal(ints.reduce((acc, x) => gcd(acc, x), 0n), 1n, 'no common factor left');
      // parallel: every 2×2 cross product vanishes
      for (let i = 0; i < vector.length; i++) {
        for (let j = i + 1; j < vector.length; j++) {
          const cross = vector[i].mul(Rational.of(ints[j])).sub(vector[j].mul(Rational.of(ints[i])));
          assert.ok(cross.isZero(), 'direction is preserved');
        }
      }
    },
    { show },
  );
});
