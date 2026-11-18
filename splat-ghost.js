// Light-blue highlight for the AR placement ghost: blends every splat's colour towards light blue by `amount`
// (0 = real colours). Spark's recolor only multiplies, which turns dark objects murky instead of blue, so this
// is a small GPU modifier added after any others (call it after splat-slosh.js, which sets objectModifier).
//   const tint = makeGhostTint(THREE, dyno, splatMesh);   // after splatMesh.initialized
//   tint.set(0.75);                                       // regenerates only when the amount changes
export function makeGhostTint(THREE, dyno, splat, color = new THREE.Color(0.62, 0.86, 1.0)) {
  const amount = dyno.dynoFloat(0), tint = dyno.dynoVec3(new THREE.Vector3(color.r, color.g, color.b));
  const mod = dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    const d = dyno.dyno({
      inTypes: { gsplat: dyno.Gsplat, amount: "float", tint: "vec3" },
      outTypes: { gsplat: dyno.Gsplat },
      inputs: { gsplat, amount, tint },
      globals: () => [dyno.defineGsplat],
      statements: ({ inputs, outputs }) => [
        `${outputs.gsplat} = ${inputs.gsplat};`,
        `${outputs.gsplat}.rgba.rgb = mix(${outputs.gsplat}.rgba.rgb, ${inputs.tint}, ${inputs.amount});`,
      ],
    });
    return { gsplat: d.outputs.gsplat };
  });
  splat.objectModifiers = [...(splat.objectModifiers || []), mod];
  splat.updateGenerator();
  return {
    set(v) {
      if (Math.abs(amount.value - v) < 0.002) return;
      amount.value = v;
      splat.updateVersion();
    },
  };
}
