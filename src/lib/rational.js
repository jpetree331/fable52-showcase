// Exact rational arithmetic over BigInt.
//
// Framework-free: runs unchanged in Node and in the browser.
//
// The equation balancer does Gaussian elimination with these instead of
// floats, so a coefficient of 299 is 299 and never 298.99999999999994.

export const gcd = (a, b) => {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
};

export const lcm = (a, b) => (a === 0n || b === 0n ? 0n : (a / gcd(a, b)) * (b < 0n ? -b : b));

export class Rational {
  /** @param {bigint} n numerator  @param {bigint} d denominator (non-zero) */
  constructor(n, d = 1n) {
    if (d === 0n) throw new RangeError('Rational: zero denominator');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
    Object.freeze(this);
  }

  /** Lift an integer (number or bigint) or pass a Rational through. */
  static of(value) {
    return value instanceof Rational ? value : new Rational(BigInt(value));
  }

  add(o) {
    return new Rational(this.n * o.d + o.n * this.d, this.d * o.d);
  }
  sub(o) {
    return new Rational(this.n * o.d - o.n * this.d, this.d * o.d);
  }
  mul(o) {
    return new Rational(this.n * o.n, this.d * o.d);
  }
  div(o) {
    if (o.n === 0n) throw new RangeError('Rational: division by zero');
    return new Rational(this.n * o.d, this.d * o.n);
  }
  neg() {
    return new Rational(-this.n, this.d);
  }
  isZero() {
    return this.n === 0n;
  }
  sign() {
    return this.n > 0n ? 1 : this.n < 0n ? -1 : 0;
  }
  equals(o) {
    return this.n === o.n && this.d === o.d;
  }
  toString() {
    return this.d === 1n ? `${this.n}` : `${this.n}/${this.d}`;
  }
}

export const ZERO = new Rational(0n);
export const ONE = new Rational(1n);

/**
 * Scale a rational vector to the smallest integer vector pointing the same way.
 * @param {Rational[]} vector
 * @returns {bigint[]}
 */
export function toIntegers(vector) {
  const scale = vector.reduce((acc, x) => lcm(acc, x.d), 1n);
  const ints = vector.map((x) => (x.n * scale) / x.d);
  const common = ints.reduce((acc, x) => gcd(acc, x), 0n) || 1n;
  return ints.map((x) => x / common);
}
