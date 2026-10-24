import * as THREE from 'three';
import { CASTLES, CAMPS, dist } from '../shared/world';
import { loadAsset } from './assets';

/**
 * Medieval vegetation + scatter.
 *
 * Batch 2026-10C performance pass:
 *  - baked pine/oak/rock-cluster/grass-tuft meshes stay instanced (a handful of draws),
 *  - only instances within a radius of the player are drawn each frame (the rest are fogged out
 *    at night anyway), so triangle counts collapse without visible pop,
 *  - tree/foliage shadow casting is disabled (tiny fronds do not read in shadow at night),
 *  - the procedural grass wind shader is kept for both procedural and baked foliage.
 */
type TreeInstance = { x: number; z: number; h: number; isPine: boolean; rot: number; scale: number };

export function addLandscape(scene: THREE.Scene) {
  let seed = 9821;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  const clear = (x: number, z: number) =>
    CASTLES.some((c) => Math.abs(x - c.x) < 16 && Math.abs(z - c.z) < 18) ||
    CAMPS.some((c) => dist(c, { x, z }) < 8) ||
    Math.abs(x) < 5;
  const castleFootprint = (x: number, z: number) =>
    CASTLES.some((c) => Math.abs(x - c.x) < 13 && Math.abs(z - c.z) < 13);
  const nearTree = (x: number, z: number, radius: number, trees: TreeInstance[]) =>
    trees.some((t) => (t.x - x) * (t.x - x) + (t.z - z) * (t.z - z) < radius * radius);

  // Denser, more varied tree line.
  const treePositions: TreeInstance[] = [];
  for (let i = 0; i < 780; i++) {
    const x = rand() * 152 - 65;
    const z = 35 - rand() * 710;
    if (!clear(x, z)) treePositions.push({ x, z, h: 3.5 + rand() * 5.5, isPine: rand() < 0.58, rot: rand() * Math.PI * 2, scale: 0.68 + rand() * 0.82 });
  }

  const windUniform = { value: 0 };
  const addWind = (mat: THREE.Material, scale = 0.38, power = 1.3, minY = 0) => {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = windUniform;
      shader.vertexShader = 'uniform float uWindTime;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        float sway = pow(max(0.0, position.y - ${minY.toFixed(2)}), ${power.toFixed(2)}) * ${scale.toFixed(2)};
        float windPhase = uWindTime * 2.6 + (transformed.x + position.x) * 0.35 + (transformed.z + position.z) * 0.35;
        transformed.x += sin(windPhase) * sway + cos(windPhase * 0.6) * sway * 0.3;
        transformed.z += cos(windPhase * 0.85) * sway * 0.65;
        `
      );
    };
  };

  // 1. Procedural wild-grass tufts (cheap: 5 double-sided blades x 10 tris).
  const grassPos: number[] = [];
  const grassCol: number[] = [];
  for (const angle of [0, 1.1, 2.2, 3.4, 4.6]) {
    const cos = Math.cos(angle), sin = Math.sin(angle), w = 0.08, h = 0.52 + rand() * 0.15, lean = 0.14;
    const bx1 = -sin * w, bz1 = cos * w, bx2 = sin * w, bz2 = -cos * w, tx = cos * lean, tz = sin * lean;
    grassPos.push(bx1, 0, bz1, bx2, 0, bz2, tx, h, tz);
    grassCol.push(0.06, 0.09, 0.04, 0.06, 0.09, 0.04, 0.2, 0.3, 0.12);
    grassPos.push(bx2, 0, bz2, bx1, 0, bz1, tx, h, tz);
    grassCol.push(0.06, 0.09, 0.04, 0.06, 0.09, 0.04, 0.2, 0.3, 0.12);
  }
  const grassGeo = new THREE.BufferGeometry();
  grassGeo.setAttribute('position', new THREE.Float32BufferAttribute(grassPos, 3));
  grassGeo.setAttribute('color', new THREE.Float32BufferAttribute(grassCol, 3));
  grassGeo.computeVertexNormals();
  const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, side: THREE.DoubleSide });
  addWind(grassMat, 0.42, 1.3, 0);
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, 5600);
  const dummy = new THREE.Object3D();
  const tmpTintColor = new THREE.Color();
  // Per-region ground-cover tint: Green March keeps its green, Ashen Moor dries to brown-grey,
  // Frozen Crown fades under snow. Applied as instance colours so it costs no extra draws.
  const regionTint = (z: number): [number, number, number] => z < -405 ? [0.72, 0.84, 1.02] : z < -245 ? [0.92, 0.78, 0.58] : [1, 1, 1];
  let count = 0;
  for (let i = 0; i < 7200 && count < 5600; i++) {
    const x = rand() * 152 - 65, z = 35 - rand() * 710;
    if (clear(x, z)) continue;
    dummy.position.set(x, 0.01, z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    const s = 0.65 + rand() * 0.7;
    dummy.scale.set(s, s * (0.8 + rand() * 0.4), s);
    dummy.updateMatrix();
    grass.setMatrixAt(count, dummy.matrix);
    const tint = regionTint(z);
    grass.setColorAt(count, tmpTintColor.setRGB(tint[0], tint[1], tint[2]));
    count++;
  }
  grass.count = count;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  grass.receiveShadow = true;
  grass.castShadow = false;
  grass.computeBoundingSphere();
  scene.add(grass);

  // 2. Procedural mossy boulders.
  const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x5a6058, roughness: 0.95 }), 64);
  let ri = 0;
  for (let i = 0; i < 90 && ri < 64; i++) {
    const x = rand() * 150 - 65, z = 35 - rand() * 710;
    if (clear(x, z)) continue;
    dummy.position.set(x, 0.25, z);
    dummy.rotation.set(rand(), rand() * 6, rand());
    dummy.scale.set(0.6 + rand(), 0.35 + rand() * 0.4, 0.6 + rand());
    dummy.updateMatrix();
    rocks.setMatrixAt(ri++, dummy.matrix);
  }
  rocks.count = ri;
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  rocks.computeBoundingSphere();
  scene.add(rocks);

  // 3. Cheap placeholder trees while the real GLBs stream in.
  const bark = new THREE.MeshStandardMaterial({ color: 0x3d352e, roughness: 0.95 });
  const needle = new THREE.MeshStandardMaterial({ color: 0x273b32, roughness: 0.9 });
  addWind(needle, 0.14, 1.2, 0.6);
  const placeholderTrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.36, 1, 5), bark, treePositions.length);
  const placeholderCrowns = new THREE.InstancedMesh(new THREE.ConeGeometry(1.6, 3.8, 5), needle, treePositions.length);
  let pti = 0, pci = 0;
  for (const t of treePositions) {
    dummy.position.set(t.x, t.h * 0.4, t.z);
    dummy.rotation.set(0, t.rot, 0);
    dummy.scale.set(1, t.h * 0.8, 1);
    dummy.updateMatrix();
    placeholderTrunks.setMatrixAt(pti++, dummy.matrix);
    dummy.position.set(t.x, t.h * 0.85, t.z);
    dummy.rotation.set(0, t.rot * 1.7, 0);
    dummy.scale.set(t.scale * 1.2, t.h * (t.isPine ? 0.62 : 0.42), t.scale * 1.2);
    dummy.updateMatrix();
    placeholderCrowns.setMatrixAt(pci++, dummy.matrix);
  }
  placeholderTrunks.castShadow = true;
  placeholderCrowns.castShadow = true;
  placeholderTrunks.receiveShadow = placeholderCrowns.receiveShadow = true;
  placeholderTrunks.computeBoundingSphere();
  placeholderCrowns.computeBoundingSphere();
  const placeholderGroup = new THREE.Group();
  placeholderGroup.add(placeholderTrunks, placeholderCrowns);
  scene.add(placeholderGroup);

  // Some tree assets are flattened into several primitives (pine = 4, oak = 2). Instantiate
  // EVERY primitive with the same per-instance matrices so the whole tree renders. Trees inside
  // ~70 m use the full assets; trees out to ~112 m swap to the baked LOD assets (<=2.5 k tris).
  const collectMeshes = (root: THREE.Object3D) => {
    const list: THREE.Mesh[] = [];
    root.traverse((o) => { if (o instanceof THREE.Mesh) list.push(o as THREE.Mesh); });
    return list;
  };
  const tuneTreeMaterial = (mesh: THREE.Mesh, isLod: boolean, card = false): THREE.Material => {
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).clone() as THREE.MeshStandardMaterial;
    const name = (mat.name || '').toLowerCase();
    const foliage = /leaf|grass|groundcover|branch|foliage|needle|frond/.test(name);
    if (card) {
      // Card atlases are authored for the night palette: keep canopies readable (no 0.32 crush).
      const leafMap = mat.map;
      if (leafMap) { leafMap.anisotropy = 4; leafMap.needsUpdate = true; }
      if (foliage) { mat.color.multiplyScalar(1.28); mat.envMapIntensity = 1.35; mat.metalness = 0; mat.alphaTest = Math.max(mat.alphaTest, 0.42); mat.side = THREE.DoubleSide; if (mat.emissive) mat.emissive.copy(mat.color).multiplyScalar(0.05); addWind(mat, 0.12, 1.2, 0.8); }
      else { mat.color.multiplyScalar(0.9); mat.envMapIntensity = 0.7; }
    } else if (foliage) { mat.color.multiplyScalar(0.32); mat.envMapIntensity = 0.22; mat.roughness = 1; mat.metalness = 0; mat.alphaTest = Math.max(mat.alphaTest, 0.42); const leafMap = mat.map; if (leafMap) { leafMap.anisotropy = 4; leafMap.needsUpdate = true; } addWind(mat, 0.12, 1.2, 0.8); }
    else { mat.color.multiplyScalar(0.72); mat.envMapIntensity = 0.45; mat.metalness = 0; }
    if (isLod) mat.envMapIntensity = Math.min(0.4, mat.envMapIntensity + 0.05);
    return mat;
  };
  const treeOnly = (parts: THREE.Mesh[]) => {
    const filtered = parts.filter((part) => {
      const m = (Array.isArray(part.material) ? part.material[0] : part.material) as THREE.MeshStandardMaterial;
      return /leaf|needle|branch|bark|trunk|foliage/i.test(m.name || '');
    });
    return filtered.length ? filtered : parts;
  };
  let pineInsts: THREE.InstancedMesh[] = [];
  let oakInsts: THREE.InstancedMesh[] = [];
  let pineLodInsts: THREE.InstancedMesh[] = [];
  let oakLodInsts: THREE.InstancedMesh[] = [];
  let pineMatrices: Float32Array | null = null;
  let oakMatrices: Float32Array | null = null;
  let pineCount = 0, oakCount = 0;
  // Cycle-3 region foliage variants: maple in the Green March, snow-tipped pines in the Frozen
  // Crown. These use a single draw band (0..54 m) so there is no LOD swap seam inside the fog.
  let mapleInsts: THREE.InstancedMesh[] = [];
  let snowInsts: THREE.InstancedMesh[] = [];
  let mapleMatrices: Float32Array | null = null;
  let snowMatrices: Float32Array | null = null;
  let mapleCount = 0, snowCount = 0;
  const tmpMatrix = new THREE.Matrix4();

  const cullIntoBand = (mesh: THREE.InstancedMesh, matrices: Float32Array, total: number, focusX: number, focusZ: number, minDist: number, maxDist: number) => {
    let n = 0;
    const min2 = minDist * minDist, max2 = maxDist * maxDist;
    for (let i = 0; i < total; i++) {
      const base = i * 16;
      const dx = matrices[base + 12] - focusX;
      const dz = matrices[base + 14] - focusZ;
      const d2 = dx * dx + dz * dz;
      if (d2 < min2 || d2 > max2) continue;
      mesh.setMatrixAt(n++, tmpMatrix.fromArray(matrices, base));
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  };

  const buildTreeInsts = (parts: THREE.Mesh[], total: number, isLod: boolean, card = false) => {
    const insts: THREE.InstancedMesh[] = [];
    for (const part of parts) {
      const inst = new THREE.InstancedMesh(part.geometry, tuneTreeMaterial(part, isLod, card), total);
      inst.castShadow = false; // foliage shadows are invisible at night and were a big shadow cost
      inst.receiveShadow = false;
      inst.frustumCulled = false;
      inst.count = 0;
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(inst);
      insts.push(inst);
    }
    return insts;
  };

  // Region variant per tree: Frozen Crown = snow pine, Ashen Moor = dark pine/oak, Green March =
  // pine/oak/maple mix. Driven by world Z so the regions read differently at a glance.
  const variantOf = (t: { x: number; z: number; isPine: boolean }): 'pine' | 'oak' | 'maple' | 'snow' => {
    if (t.z < -405) return 'snow';
    if (t.z < -245) return t.isPine ? 'pine' : 'oak';
    if (!t.isPine && (Math.floor(Math.abs(t.x) * 7 + Math.abs(t.z) * 13) % 100) < 55) return 'maple';
    return t.isPine ? 'pine' : 'oak';
  };

  const loadOpt = (name: string) => loadAsset('custom/' + name).catch(() => null);
  Promise.all([
    loadOpt('pine_v2'), loadOpt('oak_v2'), loadOpt('maple'), loadOpt('snow_pine'),
    loadOpt('pine'), loadOpt('oak'), loadOpt('pine_lod'), loadOpt('oak_lod')
  ]).then(([pineV2, oakV2, mapleGltf, snowGltf, legacyPine, legacyOak, pineLodGltf, oakLodGltf]) => {
    // Cycle-3 canonical card trees (104/88 tris) replaced the heavy legacy pine/oak. One band on
    // the card assets means no near/far swap seam at all; the legacy pair + LODs remain a fallback.
    const pineGltf = pineV2 ?? legacyPine;
    const oakGltf = oakV2 ?? legacyOak;
    if (!pineGltf || !oakGltf) return;
    // Card assets are already split into exactly bark + *_leaves prims, so keep every mesh: the
    // name filter was silently dropping the leaf prims (leafless card trees).
    const pineParts = pineV2 ? collectMeshes(pineV2.scene) : treeOnly(collectMeshes(pineGltf.scene));
    const oakParts = oakV2 ? collectMeshes(oakV2.scene) : treeOnly(collectMeshes(oakGltf.scene));
    const mapleParts = mapleGltf ? collectMeshes(mapleGltf.scene) : [];
    const snowParts = snowGltf ? collectMeshes(snowGltf.scene) : [];
    if (!pineParts.length || !oakParts.length) return;
    const cardScale = pineV2 ? 1.0 : 1.35;
    let mCount = 0, sCount = 0, pCount = 0, oCount = 0;
    for (const t of treePositions) {
      const v = variantOf(t);
      if (v === 'maple') mCount++;
      else if (v === 'snow') sCount++;
      else if (t.isPine) pCount++;
      else oCount++;
    }
    pineMatrices = new Float32Array(pCount * 16);
    oakMatrices = new Float32Array(oCount * 16);
    mapleMatrices = new Float32Array(mCount * 16);
    snowMatrices = new Float32Array(sCount * 16);
    let pi = 0, oi = 0, mi = 0, si = 0;
    for (const t of treePositions) {
      dummy.position.set(t.x, 0, t.z);
      dummy.rotation.set(0, t.rot, 0);
      dummy.scale.setScalar(t.scale * cardScale);
      dummy.updateMatrix();
      let v = variantOf(t);
      if (v === 'maple' && !mapleParts.length) v = 'oak';
      if (v === 'snow' && !snowParts.length) v = 'pine';
      if (v === 'maple') dummy.matrix.toArray(mapleMatrices!, mi++ * 16);
      else if (v === 'snow') dummy.matrix.toArray(snowMatrices!, si++ * 16);
      else if (t.isPine) dummy.matrix.toArray(pineMatrices!, pi++ * 16);
      else dummy.matrix.toArray(oakMatrices!, oi++ * 16);
    }
    pineCount = pi; oakCount = oi; mapleCount = mi; snowCount = si;
    pineInsts = pineCount ? buildTreeInsts(pineParts, pineCount, false, !!pineV2) : [];
    oakInsts = oakCount ? buildTreeInsts(oakParts, oakCount, false, !!oakV2) : [];
    mapleInsts = mapleCount ? buildTreeInsts(mapleParts, mapleCount, false, true) : [];
    snowInsts = snowCount ? buildTreeInsts(snowParts, snowCount, false, true) : [];
    // Legacy fallback keeps the old near/far LOD bands working if the card assets ever go missing.
    if (!pineV2 && pineLodGltf && pineCount) {
      const lodParts = treeOnly(collectMeshes(pineLodGltf.scene));
      if (lodParts.length) pineLodInsts = buildTreeInsts(lodParts, pineCount, true);
    }
    if (!oakV2 && oakLodGltf && oakCount) {
      const lodParts = treeOnly(collectMeshes(oakLodGltf.scene));
      if (lodParts.length) oakLodInsts = buildTreeInsts(lodParts, oakCount, true);
    }
    scene.userData.treeDebug={pineCard:!!pineV2,oakCard:!!oakV2,parts:pineParts.map(p=>{const m=(Array.isArray(p.material)?p.material[0]:p.material) as THREE.MeshStandardMaterial;const g=p.geometry;return {mat:m.name,tris:Math.round((g.index?g.index.count:g.attributes.position.count)/3),transparent:m.transparent,alphaTest:m.alphaTest,side:m.side,map:!!m.map,color:m.color?m.color.getHexString():null};}),snowParts:snowParts.map(p=>{const m=(Array.isArray(p.material)?p.material[0]:p.material) as THREE.MeshStandardMaterial;return m.name;})};
    scene.remove(placeholderGroup);
  })
    .catch((err) => console.warn('3D trees load error, keeping placeholders', err));

  // 5. Baked grass tufts + rock clusters (rock clusters are distance-culled; they are dense geometry).
  let rockInst: THREE.InstancedMesh | null = null;
  let rockMatrices: Float32Array | null = null;
  let rockTotal = 0;
  const firstMesh = (root: THREE.Object3D): THREE.Mesh | undefined => {
    let found: THREE.Mesh | undefined;
    root.traverse((o) => { if (!found && o instanceof THREE.Mesh) found = o as THREE.Mesh; });
    return found;
  };
  const firstMaterial = (mesh: THREE.Mesh): THREE.Material =>
    (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;

  Promise.all([loadAsset('custom/grass_tuft'), loadAsset('custom/rock_cluster')])
    .then(([grassGltf, rockGltf]) => {
      const tuftMesh = firstMesh(grassGltf.scene);
      const rockMesh = firstMesh(rockGltf.scene);
      if (tuftMesh) {
        const tuftMat = firstMaterial(tuftMesh).clone() as THREE.MeshStandardMaterial;
        tuftMat.color.multiplyScalar(0.42);tuftMat.envMapIntensity = 0.28;
        addWind(tuftMat, 0.16, 1.1, 0.04);
        const tuftCount = 440;
        const tufts = new THREE.InstancedMesh(tuftMesh.geometry, tuftMat, tuftCount);
        let ti = 0;
        for (const camp of CAMPS) {
          for (let i = 0; i < 22 && ti < tuftCount; i++) {
            const angle = rand() * Math.PI * 2, radius = 5 + rand() * 13;
            const x = camp.x + Math.cos(angle) * radius, z = camp.z + Math.sin(angle) * radius;
            if (Math.abs(x) < 4.2 || castleFootprint(x, z)) continue;
            dummy.position.set(x, 0.01, z);
            dummy.rotation.set(0, rand() * Math.PI * 2, 0);
            const s = 0.7 + rand() * 0.8;
            dummy.scale.set(s, s * (0.85 + rand() * 0.4), s);
            dummy.updateMatrix();
            tufts.setMatrixAt(ti, dummy.matrix);
            const tint = regionTint(z);
            tufts.setColorAt(ti, tmpTintColor.setRGB(tint[0], tint[1], tint[2]));
            ti++;
          }
        }
        for (let i = 0; i < tuftCount * 5 && ti < tuftCount; i++) {
          const x = rand() * 152 - 65, z = 35 - rand() * 710;
          if (clear(x, z) || !nearTree(x, z, 22, treePositions) || castleFootprint(x, z)) continue;
          dummy.position.set(x, 0.01, z);
          dummy.rotation.set(0, rand() * Math.PI * 2, 0);
          const s = 0.75 + rand() * 0.95;
          dummy.scale.set(s, s * (0.85 + rand() * 0.45), s);
          dummy.updateMatrix();
          tufts.setMatrixAt(ti, dummy.matrix);
          const tint = regionTint(z);
          tufts.setColorAt(ti, tmpTintColor.setRGB(tint[0], tint[1], tint[2]));
          ti++;
        }
        tufts.count = ti;
        if (tufts.instanceColor) tufts.instanceColor.needsUpdate = true;
        tufts.castShadow = false;
        tufts.receiveShadow = true;
        tufts.frustumCulled = false;
        scene.add(tufts);
      }
      if (rockMesh) {
        const rockMat = firstMaterial(rockMesh).clone() as THREE.MeshStandardMaterial;
        rockTotal = 96;
        const matrices = new Float32Array(rockTotal * 16);
        let ci = 0;
        for (let i = 0; i < rockTotal * 6 && ci < rockTotal; i++) {
          const nearCamp = i % 2 === 0 && CAMPS.length > 0;
          let x: number, z: number;
          if (nearCamp) {
            const camp = CAMPS[Math.floor(rand() * CAMPS.length)];
            const angle = rand() * Math.PI * 2, radius = 6 + rand() * 15;
            x = camp.x + Math.cos(angle) * radius; z = camp.z + Math.sin(angle) * radius;
          } else {
            x = rand() * 152 - 65; z = 35 - rand() * 710;
            if (!nearTree(x, z, 26, treePositions)) continue;
          }
          if (clear(x, z) || castleFootprint(x, z)) continue;
          dummy.position.set(x, 0, z);
          dummy.rotation.set(rand() * 0.3, rand() * Math.PI * 2, rand() * 0.2);
          const s = 0.45 + rand() * 0.85;
          dummy.scale.set(s, s * (0.7 + rand() * 0.5), s);
          dummy.updateMatrix();
          dummy.matrix.toArray(matrices, ci++ * 16);
        }
        rockTotal = ci;
        const clusters = new THREE.InstancedMesh(rockMesh.geometry, rockMat, rockTotal);
        clusters.castShadow = false;
        clusters.receiveShadow = true;
        clusters.frustumCulled = false;
        clusters.count = 0;
        clusters.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        rockInst = clusters;
        rockMatrices = matrices;
        scene.add(clusters);
      }
    })
    .catch((err) => console.warn('Scatter assets unavailable, keeping procedural grass/rocks', err));

  // 6. Region ground decals (cycle 3): alpha-feathered snow/ash/grass patches that follow the
  // terrain just above the ground plane, distance-culled with the same movement gate as trees.
  const decalSets: {mesh: THREE.InstancedMesh; matrices: Float32Array; total: number}[] = [];
  const decalTex = (file: string) => new Promise<THREE.Texture | null>((resolve) => {
    new THREE.TextureLoader().load(import.meta.env.BASE_URL + 'assets/textures/' + file, (t) => { t.colorSpace = THREE.SRGBColorSpace; resolve(t); }, undefined, () => resolve(null));
  });
  Promise.all([decalTex('snow_patch.png'), decalTex('ash_patch.png'), decalTex('grass_patch.png')]).then(([snowTex, ashTex, grassTex]) => {
    const specs = [
      {tex: snowTex, z0: -710, z1: -440, count: 110, tint: 0xdce9f4, opacity: 0.55},
      {tex: ashTex, z0: -440, z1: -205, count: 100, tint: 0x8f887c, opacity: 0.45},
      {tex: grassTex, z0: -205, z1: 35, count: 90, tint: 0xa9c785, opacity: 0.35}
    ];
    let sv = 9001;
    const rv = () => { sv = (sv * 16807) % 2147483647; return sv / 2147483647; };
    const d = new THREE.Object3D();
    for (const spec of specs) {
      if (!spec.tex) continue;
      const matrices = new Float32Array(spec.count * 16);
      let n = 0;
      for (let i = 0; i < spec.count * 4 && n < spec.count; i++) {
        const x = rv() * 150 - 68, z = spec.z0 + rv() * (spec.z1 - spec.z0);
        if (Math.abs(x) < 4.5 || clear(x, z) || castleFootprint(x, z)) continue;
        d.position.set(x, 0.025, z);
        d.rotation.set(-Math.PI / 2, 0, rv() * Math.PI * 2);
        const sc = 5 + rv() * 7;
        d.scale.set(sc, sc, 1);
        d.updateMatrix();
        d.matrix.toArray(matrices, n++ * 16);
      }
      if (!n) continue;
      const geo = new THREE.PlaneGeometry(1, 1);
      const mat = new THREE.MeshStandardMaterial({map: spec.tex, transparent: true, opacity: spec.opacity, depthWrite: false, roughness: 1, metalness: 0, color: spec.tint, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2});
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.count = 0;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
      decalSets.push({mesh, matrices, total: n});
    }
  }).catch(() => undefined);

  let lastCullX = Infinity, lastCullZ = Infinity, lastCullTime = -Infinity;
  // QA treeline vantage: pick the best tree as a near-band camera anchor (maximising full-res
  // trees within ~22 m), then look toward the local cluster centroid so both the full-res (<20 m)
  // and LOD (<54 m) bands are in one frame.
  let bestTree = treePositions[0], bestScore = -1;
  for (const t of treePositions) {
    let near = 0, mid = 0;
    for (const o of treePositions) {
      const dx = o.x - t.x, dz = o.z - t.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 484) near++;
      if (d2 < 2916) mid++;
    }
    const score = near * 3 + mid;
    if (score > bestScore) { bestScore = score; bestTree = t; }
  }
  let cx = 0, cz = 0, cn = 0;
  for (const o of treePositions) {
    const dx = o.x - bestTree.x, dz = o.z - bestTree.z;
    if (dx * dx + dz * dz < 2916) { cx += o.x; cz += o.z; cn++; }
  }
  if (cn) { cx /= cn; cz /= cn; } else { cx = bestTree.x; cz = bestTree.z; }
  let ax = bestTree.x - cx, az = bestTree.z - cz;
  const alen = Math.hypot(ax, az) || 1;
  ax /= alen; az /= alen;
  const treelineVantage = {x: bestTree.x + ax * 7, z: bestTree.z + az * 7, lookX: cx, lookZ: cz};
  return {
    treeline: treelineVantage,
    update: (time: number, focusX = 0, focusZ = 0) => {
      windUniform.value = time;
      // Reassign instance matrices only when the camera has moved a few metres (or every 2.5 s as a
      // safety net): frame N costs one matrix copy per visible tree, most frames are free.
      const moved = (focusX - lastCullX) * (focusX - lastCullX) + (focusZ - lastCullZ) * (focusZ - lastCullZ) > 4;
      if (!moved && time - lastCullTime < 2.5) return;
      lastCullX = focusX; lastCullZ = focusZ; lastCullTime = time;
      // Full-res pines/oaks within 20 m (2 m overlap so there is no visible gap), LOD instances from
      // 20 m out to the fog-limited 54 m band.
      const NEAR = 20, OVERLAP = 22, FAR = 54;
      // Card trees: a single 0..FAR band (no LOD swap). Legacy fallback keeps the near/far split.
      if (pineMatrices) {
        if (pineLodInsts.length) {
          for (const inst of pineInsts) cullIntoBand(inst, pineMatrices, pineCount, focusX, focusZ, 0, OVERLAP);
          for (const inst of pineLodInsts) cullIntoBand(inst, pineMatrices, pineCount, focusX, focusZ, NEAR, FAR);
        } else {
          for (const inst of pineInsts) cullIntoBand(inst, pineMatrices, pineCount, focusX, focusZ, 0, FAR);
        }
      }
      if (oakMatrices) {
        if (oakLodInsts.length) {
          for (const inst of oakInsts) cullIntoBand(inst, oakMatrices, oakCount, focusX, focusZ, 0, OVERLAP);
          for (const inst of oakLodInsts) cullIntoBand(inst, oakMatrices, oakCount, focusX, focusZ, NEAR, FAR);
        } else {
          for (const inst of oakInsts) cullIntoBand(inst, oakMatrices, oakCount, focusX, focusZ, 0, FAR);
        }
      }
      if (mapleMatrices) for (const inst of mapleInsts) cullIntoBand(inst, mapleMatrices, mapleCount, focusX, focusZ, 0, FAR);
      if (snowMatrices) for (const inst of snowInsts) cullIntoBand(inst, snowMatrices, snowCount, focusX, focusZ, 0, FAR);
      if (rockInst && rockMatrices) cullIntoBand(rockInst, rockMatrices, rockTotal, focusX, focusZ, 0, 30);
      for (const set of decalSets) cullIntoBand(set.mesh, set.matrices, set.total, focusX, focusZ, 0, 72);
      scene.userData.landscapeDebug={pine:pineInsts.map(i=>i.count),pineLod:pineLodInsts.map(i=>i.count),oak:oakInsts.map(i=>i.count),oakLod:oakLodInsts.map(i=>i.count),maple:mapleInsts.map(i=>i.count),snow:snowInsts.map(i=>i.count),pineCount,oakCount,mapleCount,snowCount,hasMatrices:!!pineMatrices,treeDebug:scene.userData.treeDebug??null,treeline:treelineVantage};
    }
  };
}
