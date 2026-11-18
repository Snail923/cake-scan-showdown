// Moving liquid for a splat of a filled glass (the juice card, ?liquid=1). A splat is a still capture, so the
// motion is simulated: the juice splats are found once by colour, and every frame a small GPU modifier lifts or
// lowers them so the liquid surface tilts and ripples. The tilt is a damped spring (about 2 Hz, like a real
// glass of this size) driven by how the glass moves relative to the viewer: turning it (orbiting, or the AR
// twist), moving it, or walking around it in AR. A short slosh plays on load so the liquid reads as liquid.
// Splats only move up and down, so the juice stays inside the glass, and only below the rim.
// With { glint: true } the glass also gets live reflections: wall splats pick up a sharp white highlight from
// two lights placed relative to the viewer (on a cylinder that is a vertical streak that slides as you orbit,
// like a window reflected in a real glass) and a soft bright rim where the wall is seen edge-on (Fresnel).
// Both are full strength on the empty glass above the juice and only a faint trace over the juice.
//   const slosh = makeSlosh(THREE, dyno, splatMesh);   // after splatMesh.initialized; null if no liquid found
//   slosh.update(camera);                              // every frame, before rendering
export function makeSlosh(THREE, dyno, splat, { color = isJuice, gain = 1, startNudge = true, glint = false,
  spec = 0.85, rim = 0.28, taper = 0.0926 } = {}) {
  // 1. Find the liquid: solid, dark, strongly red splats (local space of the splat mesh), and the glass top.
  const xs = [], ys = [], zs = [], all = [];
  splat.forEachSplat((i, c, s, q, opacity, rgb) => {
    if (opacity > 0.15 && color(rgb)) { xs.push(c.x); ys.push(c.y); zs.push(c.z); }
    if (opacity > 0.05 && (i & 3) === 0) all.push(c.y);
  });
  if (xs.length < 200) return null;
  const pct = (arr, p) => { const a = Float32Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
  const ax = pct(xs, 0.5), az = pct(zs, 0.5);
  const bottom = pct(ys, 0.02), top = pct(ys, 0.985), depth = top - bottom;
  const rTop = pct(xs.map((x, i) => (ys[i] > top - depth * 0.2 ? Math.hypot(x - ax, zs[i] - az) : 0)).filter((r) => r > 0), 0.95);
  if (!(depth > 0) || !(rTop > 0)) return null;
  const glassTop = pct(all, 0.995);

  // 2. GPU modifier: centre.y += w * (surface slope . (x, z) + ripple), w rises from the bottom, the upper
  //    part of the juice moves as one (no seams), and w fades out just above the surface, so the glass rim
  //    and the empty glass never move.
  const geo = dyno.dynoVec4(new THREE.Vector4(ax, az, bottom, top));
  const geo2 = dyno.dynoVec4(new THREE.Vector4(rTop, (2 * Math.PI) / (rTop * 0.9), 0, 0));
  const wave = dyno.dynoVec4(new THREE.Vector4(0, 0, 0, 0));  // slope x, slope z, ripple amplitude, ripple phase
  // glass: wall taper (radius per height), glass top, rim (Fresnel) and highlight strength (0 = off)
  const glass = dyno.dynoVec4(new THREE.Vector4(taper, glassTop, glint ? rim : 0, glint ? spec : 0));
  const cam = dyno.dynoVec4(new THREE.Vector4(0, 1, 1, 0));  // viewer position, local space
  const l1 = dyno.dynoVec4(new THREE.Vector4(0, 0, 1, 0)), l2 = dyno.dynoVec4(new THREE.Vector4(0, 0, 1, 0));
  splat.objectModifier = dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    const d = dyno.dyno({
      inTypes: { gsplat: dyno.Gsplat, geo: "vec4", geo2: "vec4", wave: "vec4", glass: "vec4", cam: "vec4", l1: "vec4", l2: "vec4" },
      outTypes: { gsplat: dyno.Gsplat },
      inputs: { gsplat, geo, geo2, wave, glass, cam, l1, l2 },
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
          // juice-coloured splats just above the surface (the meniscus on the wall) move with the liquid too;
          // left behind, they show as red specks on the glass when the surface tilts away
          `  float juicy = step(0.03, ${g}.rgba.r - 1.5 * ${g}.rgba.g) * step(${g}.rgba.r, 0.7);`,
          `  fade = max(fade, juicy * (1.0 - smoothstep(${i.geo}.w + 0.14 * H, ${i.geo}.w + 0.2 * H, ${g}.center.y)));`,
          `  float r = length(q);`,
          // splats inside the glass (by centre; the glass tapers) move; big juice splats whose edge pokes
          // through the wall fade out while lifted, so a sloshing juice never paints red specks on the wall
          `  float rwl = ${i.geo2}.x + (${g}.center.y - ${i.geo}.w) * ${i.glass}.x;`,
          `  float inside = 1.0 - smoothstep(1.0 * rwl, 1.06 * rwl, r);`,
          `  float reach = r + 1.5 * max(${g}.scales.x, max(${g}.scales.y, ${g}.scales.z));`,
          `  float poke = smoothstep(0.98 * rwl, 1.06 * rwl, reach);`,
          `  float ripple = ${i.wave}.z * sin(r * ${i.geo2}.y - ${i.wave}.w) * smoothstep(0.7, 1.0, f);`,
          `  if (${i.glass}.z + ${i.glass}.w > 0.0) {`,
          `    float rw = ${i.geo2}.x + (${g}.center.y - ${i.geo}.w) * ${i.glass}.x;`,
          `    float wall = smoothstep(0.82 * rw, 0.96 * rw, r) * (1.0 - smoothstep(1.1 * rw, 1.3 * rw, r))`,
          `      * (1.0 - smoothstep(${i.glass}.y, ${i.glass}.y + 0.004, ${g}.center.y));`,
          `    if (wall > 0.001) {`,
          `      vec3 N = vec3(q.x, 0.0, q.y) / max(r, 1e-5);`,
          `      vec3 V = normalize(${i.cam}.xyz - ${g}.center);`,
          // lights are tall (like windows): only the horizontal angles count, so each makes a full-height streak
          `      vec2 vh = normalize(V.xz), nh = N.xz;`,
          `      vec2 r1 = reflect(-normalize(${i.l1}.xz), nh), r2 = reflect(-normalize(${i.l2}.xz), nh);`,
          `      float sp = pow(max(dot(r1, vh), 0.0), 220.0) + 0.6 * pow(max(dot(r2, vh), 0.0), 320.0);`,
          // edge glow; half as strong along the top centimetre, where the rim is seen edge-on from above
          `      float fr = pow(1.0 - abs(dot(N, V)), 4.0) * (1.0 - 0.5 * smoothstep(${i.glass}.y - 0.01, ${i.glass}.y - 0.003, ${g}.center.y));`,
          // long thin splats would light up as star-shaped sparkles: keep them out of the highlight
          `      vec3 sc = ${g}.scales;`,
          `      float smax = max(sc.x, max(sc.y, sc.z)), smin = min(sc.x, min(sc.y, sc.z));`,
          `      float elong = smax / max(sc.x + sc.y + sc.z - smax - smin, 1e-7);`,
          // reflections belong to the empty glass above the juice; over the juice only a faint trace
          `      float upper = mix(0.12, 1.7, smoothstep(${i.geo}.w - 0.004, ${i.geo}.w + 0.012, ${g}.center.y));`,
          `      float add = wall * (1.0 - smoothstep(2.5, 6.0, elong)) * (${i.glass}.w * sp * upper + ${i.glass}.z * fr * mix(0.5, 1.0, min(upper, 1.0)));`,
          `      ${g}.rgba.rgb += vec3(add);`,
          `      ${g}.rgba.a = clamp(${g}.rgba.a + add * 0.3, 0.0, 0.95);`,
          `    }`,
          `  }`,
          `  float lift = smoothstep(0.15, 0.8, f) * fade * inside * (dot(q, ${i.wave}.xy) + ripple);`,
          `  ${g}.center.y += lift;`,
          `  ${g}.rgba.a *= 1.0 - 0.9 * poke * smoothstep(0.0005, 0.004, abs(lift));`,
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
  const camLocal = new THREE.Vector3(), lastCam = new THREE.Vector3(Infinity, 0, 0), toCam = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
  const lightAround = (out, yaw, up) => {  // the direction to the viewer, turned by yaw and raised by up (radians)
    dir.copy(toCam).applyAxisAngle(UP, yaw).setY(0).normalize().multiplyScalar(Math.cos(up)).setY(Math.sin(up));
    out.set(dir.x, dir.y, dir.z, 0);
  };

  return {
    geometry: { axis: [ax, az], bottom, top, radius: rTop, glassTop, splats: xs.length },
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
      // reflections: viewer position in the glass's space, two lights to the viewer's upper left and right
      let viewMoved = false;
      if (glint) {
        camLocal.setFromMatrixPosition(camera.matrixWorld);
        splat.worldToLocal(camLocal);
        viewMoved = camLocal.distanceToSquared(lastCam) > 1e-10;
        if (viewMoved) {
          lastCam.copy(camLocal);
          cam.value.set(camLocal.x, camLocal.y, camLocal.z, 0);
          toCam.set(camLocal.x - ax, 0, camLocal.z - az);
          if (toCam.lengthSq() < 1e-10) toCam.set(0, 0, 1);
          lightAround(l1.value, 0.42, 0.35); lightAround(l2.value, -0.75, 0.5);
        }
      }
      if (active || moving || viewMoved) {
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
