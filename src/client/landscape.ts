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
  for (let i = 0; i < 480; i++) {
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
  let count = 0;
  for (let i = 0; i < 7200 && count < 5600; i++) {
    const x = rand() * 152 - 65, z = 35 - rand() * 710;
    if (clear(x, z)) continue;
    dummy.position.set(x, 0.01, z);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    const s = 0.65 + rand() * 0.7;
    dummy.scale.set(s, s * (0.8 + rand() * 0.4), s);
    dummy.updateMatrix();
    grass.setMatrixAt(count++, dummy.matrix);
  }
  grass.count = count;
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
  const tuneTreeMaterial = (mesh: THREE.Mesh, isLod: boolean): THREE.Material => {
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).clone() as THREE.MeshStandardMaterial;
    const name = (mat.name || '').toLowerCase();
    const foliage = /leaf|grass|groundcover|branch|foliage|needle|frond/.test(name);
    if (foliage) { mat.color.multiplyScalar(0.32); mat.envMapIntensity = 0.22; mat.roughness = 1; mat.metalness = 0; addWind(mat, 0.12, 1.2, 0.8); }
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

  const buildTreeInsts = (parts: THREE.Mesh[], total: number, isLod: boolean) => {
    const insts: THREE.InstancedMesh[] = [];
    for (const part of parts) {
      const inst = new THREE.InstancedMesh(part.geometry, tuneTreeMaterial(part, isLod), total);
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

  const lodLoad = (name: string) => loadAsset('custom/' + name).catch(() => null);
  Promise.all([loadAsset('custom/pine'), loadAsset('custom/oak'), lodLoad('pine_lod'), lodLoad('oak_lod')])
    .then(([pineGltf, oakGltf, pineLodGltf, oakLodGltf]) => {
      const pineParts = treeOnly(collectMeshes(pineGltf.scene));
      const oakParts = treeOnly(collectMeshes(oakGltf.scene));
      if (!pineParts.length || !oakParts.length) return;
      pineCount = treePositions.filter((t) => t.isPine).length;
      oakCount = treePositions.length - pineCount;
      pineMatrices = new Float32Array(pineCount * 16);
      oakMatrices = new Float32Array(oakCount * 16);
      let pi = 0, oi = 0;
      for (const t of treePositions) {
        dummy.position.set(t.x, 0, t.z);
        dummy.rotation.set(0, t.rot, 0);
        dummy.scale.setScalar(t.scale * 1.35);
        dummy.updateMatrix();
        if (t.isPine) dummy.matrix.toArray(pineMatrices!, pi++ * 16);
        else dummy.matrix.toArray(oakMatrices!, oi++ * 16);
      }
      pineInsts = buildTreeInsts(pineParts, pineCount, false);
      oakInsts = buildTreeInsts(oakParts, oakCount, false);
      if (pineLodGltf) {
        const lodParts = treeOnly(collectMeshes(pineLodGltf.scene));
        if (lodParts.length) { pineLodInsts = buildTreeInsts(lodParts, pineCount, true); pineInsts = []; }
      }
      if (oakLodGltf) {
        const lodParts = treeOnly(collectMeshes(oakLodGltf.scene));
        if (lodParts.length) { oakLodInsts = buildTreeInsts(lodParts, oakCount, true); oakInsts = []; }
      }
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
            tufts.setMatrixAt(ti++, dummy.matrix);
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
          tufts.setMatrixAt(ti++, dummy.matrix);
        }
        tufts.count = ti;
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

  return {
    update: (time: number, focusX = 0, focusZ = 0) => {
      windUniform.value = time;
      // Near trees = full assets; ring band 70..112 m = baked LOD assets (no pop-through, both
      // bands are always drawn together so the swap is invisible behind the night fog).
      const NEAR = 0, FAR = 54;
      if (pineMatrices) {
        if (pineLodInsts.length) {
          for (const inst of pineInsts) cullIntoBand(inst, pineMatrices, pineCount, focusX, focusZ, 0, NEAR);
          for (const inst of pineLodInsts) cullIntoBand(inst, pineMatrices, pineCount, focusX, focusZ, NEAR, FAR);
        } else {
          for (const inst of pineInsts) cullIntoBand(inst, pineMatrices, pineCount, focusX, focusZ, 0, 48);
        }
      }
      if (oakMatrices) {
        if (oakLodInsts.length) {
          for (const inst of oakInsts) cullIntoBand(inst, oakMatrices, oakCount, focusX, focusZ, 0, NEAR);
          for (const inst of oakLodInsts) cullIntoBand(inst, oakMatrices, oakCount, focusX, focusZ, NEAR, FAR);
        } else {
          for (const inst of oakInsts) cullIntoBand(inst, oakMatrices, oakCount, focusX, focusZ, 0, 48);
        }
      }
      if (rockInst && rockMatrices) cullIntoBand(rockInst, rockMatrices, rockTotal, focusX, focusZ, 0, 22);
    }
  };
}
