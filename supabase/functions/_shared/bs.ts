// Verbatim mirror of src/lib/bs.ts, kept in sync manually.
//
// This exists as a separate copy — not a shared import — because the Vite
// frontend (src/lib/) and the Supabase Edge Functions (Deno, supabase/
// functions/) are two different build/runtime environments that don't
// share a module resolver. If you change the math here, change src/lib/bs.ts
// to match (and vice versa), since the same pricing logic is relied on by
// both the interactive analysis charts and the AI-strategy pipeline.

// Standard normal PDF
function npdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// Standard normal CDF (Abramowitz & Stegun approximation)
export function ncdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.31938153 * t + -0.356563782 * t ** 2 + 1.781477937 * t ** 3 + -1.821255978 * t ** 4 + 1.330274429 * t ** 5;
  const prob = 1 - npdf(x) * d;
  return x >= 0 ? prob : 1 - prob;
}

export interface BSInputs {
  spot: number;
  strike: number;
  dte: number;
  vol: number; // decimal, e.g. 0.3
  rate: number; // decimal, e.g. 0.05
  type: "call" | "put";
}

export interface BSGreeks {
  price: number;
  delta: number;
  gamma: number;
  theta: number; // per calendar day
  vega: number; // per 1% vol
}

// Black-Scholes price + Greeks for a single option.
export function blackScholes(i: BSInputs): BSGreeks {
  const { spot: S, strike: K, dte, vol: sigma, rate: r, type } = i;
  const T = Math.max(dte, 0.01) / 365;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;

  const call = S * ncdf(d1) - K * Math.exp(-r * T) * ncdf(d2);
  const put = K * Math.exp(-r * T) * ncdf(-d2) - S * ncdf(-d1);
  const price = type === "call" ? call : put;

  const delta = type === "call" ? ncdf(d1) : ncdf(d1) - 1;
  const gamma = npdf(d1) / (S * sigma * sqrtT);
  const vega = (S * sqrtT * npdf(d1)) / 100;
  const thetaCommon = (-S * npdf(d1) * sigma) / (2 * sqrtT);
  const theta =
    type === "call"
      ? (thetaCommon - r * K * Math.exp(-r * T) * ncdf(d2)) / 365
      : (thetaCommon + r * K * Math.exp(-r * T) * ncdf(-d2)) / 365;

  return { price, delta, gamma, theta, vega };
}