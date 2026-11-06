/* Density colormaps as 256-entry RGBA lookup tables. */
(function (FM) {
  'use strict';

  const clamp = v => Math.max(0, Math.min(1, v));

  // Turbo (Google, 2019) — polynomial approximation by A. Mikhailov
  function turbo(x) {
    const r = 0.13572138 + x * (4.61539260 + x * (-42.66032258 + x * (132.13108234 + x * (-152.94239396 + x * 59.28637943))));
    const g = 0.09140261 + x * (2.19418839 + x * (4.84296658 + x * (-14.18503333 + x * (4.27729857 + x * 2.82956604))));
    const b = 0.10667330 + x * (12.64194608 + x * (-60.58204836 + x * (110.36276771 + x * (-89.90310912 + x * 27.34824973))));
    return [clamp(r), clamp(g), clamp(b)];
  }

  // Viridis — 6th-order polynomial fit
  function viridis(t) {
    const c0 = [0.2777273272234177, 0.005407344544966578, 0.3340998053353061];
    const c1 = [0.1050930431085774, 1.404613529898575, 1.384590162594685];
    const c2 = [-0.3308618287255563, 0.214847559468213, 0.09509516302823659];
    const c3 = [-4.634230498983486, -5.799100973351585, -19.33244095627987];
    const c4 = [6.228269936347081, 14.17993336680509, 56.69055260068105];
    const c5 = [4.776384997670288, -13.74514537774601, -65.35303263337234];
    const c6 = [-5.435455855934631, 4.645852612178535, 26.3124352495832];
    return [0, 1, 2].map(i => clamp(c0[i] + t * (c1[i] + t * (c2[i] + t * (c3[i] + t * (c4[i] + t * (c5[i] + t * c6[i])))))));
  }

  // Classic "jet", as in most cytometer software
  function jet(t) {
    const r = clamp(1.5 - Math.abs(4 * t - 3));
    const g = clamp(1.5 - Math.abs(4 * t - 2));
    const b = clamp(1.5 - Math.abs(4 * t - 1));
    return [r, g, b];
  }

  // Ink: single hue, for print and for colour-vision safety
  function ink(t) {
    const a = [0.36, 0.40, 0.62], b = [0.10, 0.06, 0.30];
    const u = 0.25 + 0.75 * t;
    return [0, 1, 2].map(i => clamp(a[i] + (b[i] - a[i]) * u));
  }

  const MAPS = {
    turbo: { label: 'Turbo', fn: t => turbo(0.08 + 0.9 * t) },
    jet: { label: 'Classic (jet)', fn: t => jet(0.1 + 0.9 * t) },
    viridis: { label: 'Viridis', fn: viridis },
    ink: { label: 'Ink (single hue)', fn: ink },
  };

  const cache = {};
  function lut(name) {
    if (!MAPS[name]) name = 'turbo';
    if (cache[name]) return cache[name];
    const out = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i++) {
      const [r, g, b] = MAPS[name].fn(i / 255);
      out[i * 4] = Math.round(r * 255); out[i * 4 + 1] = Math.round(g * 255); out[i * 4 + 2] = Math.round(b * 255); out[i * 4 + 3] = 255;
    }
    cache[name] = out;
    return out;
  }

  /** CSS gradient for legends/menus. */
  function cssGradient(name) {
    const stops = [];
    for (let i = 0; i <= 8; i++) {
      const [r, g, b] = (MAPS[name] || MAPS.turbo).fn(i / 8);
      stops.push('rgb(' + Math.round(r * 255) + ',' + Math.round(g * 255) + ',' + Math.round(b * 255) + ') ' + (i * 12.5) + '%');
    }
    return 'linear-gradient(90deg,' + stops.join(',') + ')';
  }

  FM.colormaps = { MAPS, lut, cssGradient };
})(FM);
