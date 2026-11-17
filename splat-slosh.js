// Moving liquid for a splat of a filled glass (the juice card, ?liquid=1). A splat is a still capture, so the
// motion is simulated: the juice splats are found once by colour, and every frame a small GPU modifier lifts or
// lowers them so the liquid surface tilts and ripples. The tilt is a damped spring (about 2 Hz, like a real
// glass of this size) driven by how the glass moves relative to the viewer: turning it (orbiting, or the AR
// twist), moving it, or walking around it in AR. A short slosh plays on load so the liquid reads as liquid.
// Splats only move up and down, so the juice stays inside the glass, and only below the rim.
//   const slosh = makeSlosh(THREE, dyno, splatMesh);   // after splatMesh.initialized; null if no liquid found
//   slosh.update(camera);                              // every frame, before rendering
export function makeSlosh(THREE, dyno, splat, { color = isJuice, gain = 1, startNudge = true } = {}) {
  // 1. Find the liquid: solid, dark, strongly red splats (local space of the splat mesh).
  const xs = [], ys = [], zs = [];
  splat.forEachSplat((i, c, s, q, opacity, rgb) => {
    if (opacity > 0.15 && color(rgb)) { xs.push(c.x); ys.push(c.y); zs.push(c.z); }
  });
  if (xs.length < 200) return null;
  const pct = (arr, p) => { const a = Float32Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
  const ax = pct(xs, 0.5), az = pct(zs, 0.5);
  const bottom = pct(ys, 0.02), top = pct(ys, 0.985), depth = top - bottom;
  const rTop = pct(xs.map((x, i) => (ys[i] > top - depth * 0.2 ? Math.hypot(x - ax, zs[i] - az) : 0)).filter((r) => r > 0), 0.95);
  if (!(depth > 0) || !(rTop > 0)) return null;

  // 2. GPU modifier: centre.y += w * (surface slope . (x, z) + ripple), w rises from the bottom, the upper
  //    part of the juice moves as one (no seams), and w fades out just above the surface, so the glass rim
  //    and the empty glass never move.
  const geo = dyno.dynoVec4(new THREE.Vector4(ax, az, bottom, top));
  const geo2 = dyno.dynoVec4(new THREE.Vector4(rTop, (2 * Math.PI) / (rTop * 0.9), 0, 0));
  const wave = dyno.dynoVec4(new THREE.Vector4(0, 0, 0, 0));  // slope x, slope z, ripple amplitude, ripple phase
  splat.objectModifier = dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    const d = dyno.dyno({
      inTypes: { gsplat: dyno.Gsplat, geo: "vec4", geo2: "vec4", wave: "vec4" },
      outTypes: { gsplat: dyno.Gsplat },
      inputs: { gsplat, geo, geo2, wave },
      globals: () => [dyno.defineGsplat],
      statements: ({ inputs, outputs }) => {
        const g = outputs.gsplat, i = inputs;
        return [
          `${g} = ${i.gsplat};`,
          `if (isGsplatActive(${g}.flags)) {`,
          `  vec2 q = ${g}.center.xz - ${i.geo}.xy;`,
          `  float H = ${i.geo}.w - ${i.geo}.z;`,
          `  float f = clamp((${g}.center.y - ${i.geo}.z) / H, 0.0, 1.0);`,
          `  float fade = 1.0 - smoothstep(${i.geo}.w + 0.03 * H, ${i.geo}.w + 0.10 * H, ${g}.center.y);`,
          `  float r = length(q);`,
          `  float inside = 1.0 - smoothstep(${i.geo2}.x * 1.08, ${i.geo2}.x * 1.3, r);`,
          `  float ripple = ${i.wave}.z * sin(r * ${i.geo2}.y - ${i.wave}.w) * smoothstep(0.7, 1.0, f);`,
          `  ${g}.center.y += smoothstep(0.15, 0.8, f) * fade * inside * (dot(q, ${i.wave}.xy) + ripple);`,
          `}`,
        ];
      },
    });
    return { gsplat: d.outputs.gsplat };
  });
  splat.updateGenerator();

  // 3. Spring for the surface slope s (local x, z), driven by the glass's acceleration as the viewer sees it.
  const W0 = 2 * Math.PI * 2.0, ZETA = 0.07, MAX_SLOPE = 0.28, G = 9.81;
  const s = new THREE.Vector2(), v = new THREE.Vector2();
  let last = null, lastW = null, lastP = null, lastV = null, phase = 0, prevT = performance.now(), moving = true;
  if (startNudge) v.set(0.9, 0.35);  // a little slosh as it appears
  const rel = new THREE.Matrix4(), inv = new THREE.Matrix4(), qRel = new THREE.Quaternion(), qLast = new THREE.Quaternion();
  const pRel = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), w = new THREE.Vector3(), alpha = new THREE.Vector3();
  const front = new THREE.Vector3(), acc = new THREE.Vector3(), vel = new THREE.Vector3(), worldScale = new THREE.Vector3();

  return {
    geometry: { axis: [ax, az], bottom, top, radius: rTop, splats: xs.length },
    nudge(x = 0.8, z = 0.3) { v.x += x; v.y += z; moving = true; },
    state: () => ({ slope: [s.x, s.y], speed: [v.x, v.y] }),
    update(camera) {
      const now = performance.now(), dt = Math.min(0.05, (now - prevT) / 1000);
      prevT = now;
      if (dt <= 0) return;
      splat.updateMatrixWorld();
      // glass pose in the camera's frame (what the viewer sees)
      inv.copy(camera.matrixWorld).invert();
      rel.multiplyMatrices(inv, splat.matrixWorld);
      rel.decompose(pRel, qRel, worldScale);
      let fx = 0, fz = 0;
      if (last) {
        // angular velocity of the glass relative to the viewer, in the glass's own frame
        tmpQ.copy(qLast).invert().multiply(qRel);
        const ang = 2 * Math.acos(Math.min(1, Math.abs(tmpQ.w)));
        w.set(tmpQ.x, tmpQ.y, tmpQ.z);
        if (w.lengthSq() > 1e-12) w.normalize().multiplyScalar((tmpQ.w < 0 ? -ang : ang) / dt); else w.set(0, 0, 0);
        // linear velocity in camera frame, turned into the glass frame
        vel.copy(pRel).sub(lastP).divideScalar(dt);
        if (lastW) {
          alpha.copy(w).sub(lastW).divideScalar(dt);
          acc.copy(vel).sub(lastV).divideScalar(dt).applyQuaternion(tmpQ.copy(qRel).invert());
          // the wall facing the viewer is pushed sideways by angular acceleration (alpha x r); the liquid lags
          front.set(0, 0, 1).applyQuaternion(tmpQ).multiplyScalar(rTop * worldScale.x);
          front.y = 0;
          const tan = alpha.clone().cross(front);
          fx = -(acc.x + tan.x) / G; fz = -(acc.z + tan.z) / G;
        }
        lastW = w.clone(); lastV = vel.clone();
      }
      last = true; qLast.copy(qRel); lastP = pRel.clone();
      // spring towards the forced slope
      const tx = THREE.MathUtils.clamp(fx * 2.5 * gain, -MAX_SLOPE, MAX_SLOPE), tz = THREE.MathUtils.clamp(fz * 2.5 * gain, -MAX_SLOPE, MAX_SLOPE);
      v.x += (-W0 * W0 * (s.x - tx) - 2 * ZETA * W0 * v.x) * dt;
      v.y += (-W0 * W0 * (s.y - tz) - 2 * ZETA * W0 * v.y) * dt;
      s.x = THREE.MathUtils.clamp(s.x + v.x * dt, -MAX_SLOPE, MAX_SLOPE);
      s.y = THREE.MathUtils.clamp(s.y + v.y * dt, -MAX_SLOPE, MAX_SLOPE);
      const energy = Math.hypot(s.x, s.y) + Math.hypot(v.x, v.y) / W0;
      phase += dt * 2 * Math.PI * 3.2;
      const active = energy > 0.002;
      if (active || moving) {
        wave.value.set(s.x, s.y, active ? Math.min(0.25, energy) * rTop * 0.18 : 0, phase);
        splat.updateVersion();
      }
      moving = active;
    },
  };
}

// Juice: clearly red, dark, and not a white glass highlight.
function isJuice(c) {
  return c.r > 0.12 && c.r < 0.6 && c.r > c.g * 1.6 && c.r > c.b * 1.4;
}
