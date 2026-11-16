// Real-size check for the splat AR views (splat.html on Android, splat-ar.html on iPhone).
// The splats are converted to real size in metres: tools/splat_web.py scales the 0.3-99.7 percentile box
// of the solid splats to the measured width (mean of X and Z), length (longer of X and Z) or height, and
// the card passes that size as w / h. measureSplat() measures the same box in the browser; realSize()
// says how much to scale the model so it matches the card (only for 4-25% gaps; a bigger gap means the
// card's numbers are wrong, so the file is left alone and a warning logged) and gives a label.

export function measureSplat(splat) {
  const X = [], Y = [], Z = [];
  splat.forEachSplat((i, c, scales, quat, opacity) => { if (opacity > 0.05) { X.push(c.x); Y.push(c.y); Z.push(c.z); } });
  const ext = (a) => { const b = Float32Array.from(a).sort(); return b[Math.floor(0.997 * (b.length - 1))] - b[Math.floor(0.003 * (b.length - 1))]; };
  const x = ext(X), z = ext(Z);
  return { mean: (x + z) / 2, max: Math.max(x, z), h: ext(Y) };
}

const cm = (v) => (v < 0.1 ? (v * 100).toFixed(1).replace(/\.0$/, "") : Math.round(v * 100)) + " cm";

// w, h: the card's size in metres (0 when not given). Returns { fix, text }, e.g. { fix: 1, text: "30 cm across" }.
export function realSize(m, w, h) {
  const dims = w ? [m.mean, m.max] : h ? [m.h] : [m.max];
  const want = w || h;
  const dim = want ? dims.reduce((a, b) => (Math.abs(Math.log(want / b)) < Math.abs(Math.log(want / a)) ? b : a)) : dims[0];
  let fix = want && isFinite(want / dim) ? want / dim : 1;
  if (Math.abs(fix - 1) <= 0.04) fix = 1;
  else if (Math.abs(fix - 1) >= 0.25) { console.warn("[splat] size on the card doesn't match the splat; left unscaled", m, w, h); fix = 1; }
  return { fix, text: cm(dim * fix) + (h && !w ? " tall" : " across") };
}
