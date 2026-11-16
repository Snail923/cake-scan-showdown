// Soft contact shadow for a Gaussian splat standing on y = 0, shaped like the object seen from above.
// Spark can't cast real shadows, so this projects every solid splat straight down onto a grid, turns the
// coverage into a silhouette and blurs it twice: a tight, dark contact shadow plus a wide, faint ambient
// one. The result is a flat, transparent plane just above the table; add it next to the splat (same
// parent, same local space). Used by splat.html (3D view and Android AR) and splat-ar.html (iPhone AR).
//   const shadow = makeSplatShadow(THREE, splatMesh, { strength: 0.8 });
export function makeSplatShadow(THREE, splat, { strength = 0.8, grid = 256 } = {}) {
  // 1. Splat centres and footprints (opacity > 0.08 only, so faint haze doesn't darken the table).
  const xs = [], zs = [], ws = [], rs = [];
  splat.forEachSplat((i, center, scales, quaternion, opacity) => {
    if (opacity < 0.08) return;
    xs.push(center.x); zs.push(center.z); ws.push(opacity);
    rs.push(Math.max(scales.x, scales.y, scales.z));
  });
  if (xs.length < 50) return null;
  // Extent from the 0.5th to 99.5th percentile, so stray splats don't stretch the shadow.
  const pct = (arr, p) => { const s = Float32Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const x0 = pct(xs, 0.005), x1 = pct(xs, 0.995), z0 = pct(zs, 0.005), z1 = pct(zs, 0.995);
  const size = Math.max(x1 - x0, z1 - z0, 0.02);
  const pad = size * 0.3, span = size + 2 * pad;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, cell = span / grid;

  // 2. Coverage grid: each splat stamps its opacity over the cells its radius covers (capped at 2 cells).
  const dens = new Float32Array(grid * grid);
  for (let i = 0; i < xs.length; i++) {
    const gx = (xs[i] - cx + span / 2) / cell, gz = (zs[i] - cz + span / 2) / cell;
    const r = Math.min(2, Math.floor(rs[i] / cell));
    const ix = Math.floor(gx), iz = Math.floor(gz);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const x = ix + dx, z = iz + dz;
      if (x >= 0 && z >= 0 && x < grid && z < grid) dens[z * grid + x] += ws[i];
    }
  }
  const cover = new Float32Array(grid * grid);
  for (let i = 0; i < cover.length; i++) cover[i] = 1 - Math.exp(-dens[i] * 0.6);

  // 3. Two blurs of the silhouette (three box passes approximate a Gaussian).
  function blur(src, radius) {
    let a = Float32Array.from(src), b = new Float32Array(src.length);
    const r = Math.max(1, Math.round(radius)), n = 2 * r + 1;
    for (let pass = 0; pass < 3; pass++) {
      for (let z = 0; z < grid; z++) {          // horizontal
        let acc = 0;
        for (let x = -r; x <= r; x++) acc += a[z * grid + Math.min(grid - 1, Math.max(0, x))];
        for (let x = 0; x < grid; x++) {
          b[z * grid + x] = acc / n;
          acc += a[z * grid + Math.min(grid - 1, x + r + 1)] - a[z * grid + Math.max(0, x - r)];
        }
      }
      for (let x = 0; x < grid; x++) {          // vertical
        let acc = 0;
        for (let z = -r; z <= r; z++) acc += b[Math.min(grid - 1, Math.max(0, z)) * grid + x];
        for (let z = 0; z < grid; z++) {
          a[z * grid + x] = acc / n;
          acc += b[Math.min(grid - 1, z + r + 1) * grid + x] - b[Math.max(0, z - r) * grid + x];
        }
      }
    }
    return a;
  }
  const contact = blur(cover, grid * 0.012);
  const ambient = blur(cover, grid * 0.06);

  // 4. Black texture with the shadow in alpha; the edges of the grid fade to zero.
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = grid;
  const ctx = canvas.getContext("2d"), img = ctx.createImageData(grid, grid);
  for (let z = 0; z < grid; z++) for (let x = 0; x < grid; x++) {
    const i = z * grid + x;
    const edge = Math.min(1, Math.min(x, z, grid - 1 - x, grid - 1 - z) / (grid * 0.04));
    const a = Math.min(1, 0.62 * contact[i] + 0.38 * ambient[i]) * strength * edge;
    img.data[i * 4 + 3] = Math.round(a * 255);
  }
  ctx.putImageData(img, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  // Laid flat (rotated -90° about x), the plane's top edge points to -z, and the canvas's first row (lowest
  // z) lands there with the default texture flip, so grid cells and world positions line up.
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(span, span),
    new THREE.MeshBasicMaterial({ map: texture, color: 0x000000, transparent: true, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(cx, 0.0008, cz);
  mesh.renderOrder = -2;  // under the splats
  mesh.name = "splat-shadow";
  return mesh;
}
