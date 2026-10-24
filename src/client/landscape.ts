import * as THREE from 'three';
import { CASTLES, CAMPS, dist } from '../shared/world';
import { loadAsset } from './assets';

/**
 * Lush medieval vegetation: realistic grass tufts, dark spruce pines, gnarled oaks,
 * mossy boulders and — batch 2026-10 — baked `grass_tuft` / `rock_cluster` scatter.
 * Custom props are always instanced: +2 draw calls total for hundreds of props.
 */
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

  // Denser, more varied tree line than the original 360-slot pass.
  const treePositions: { x: number; z: number; h: number; isPine: boolean; rot: number; scale: number; tint: number }[] = [];
  for (let i = 0; i < 540; i++) {
    const x = rand() * 152 - 65;
    const z = 35 - rand() * 710;
    if (!clear(x, z)) {
      treePositions.push({
        x,
        z,
        h: 3.5 + rand() * 5.5,
        isPine: rand() < 0.58,
        rot: rand() * Math.PI * 2,
        scale: 0.68 + rand() * 0.82,
        tint: 0.78 + rand() * 0.34,
      });
    }
  }

  // 1. Lush multi-blade wild grass tuft geometry (fanned curved blades with dark-to-light gradient)
  const grassPos: number[] = [];
  const grassCol: number[] = [];
  const bladeAngles = [0, 1.1, 2.2, 3.4, 4.6];

  for (const angle of bladeAngles) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const w = 0.08;
    const h = 0.52 + rand() * 0.15;
    const lean = 0.14;

    // Triangle blade: bottom-left, bottom-right, curved tip
    const bx1 = -sin * w;
    const bz1 = cos * w;
    const bx2 = sin * w;
    const bz2 = -cos * w;
    const tx = cos * lean;
    const tz = sin * lean;

    // Quad/Triangle: v0, v1, v2
    grassPos.push(bx1, 0, bz1, bx2, 0, bz2, tx, h, tz);
    // Dark root -> lush vibrant tip
    grassCol.push(0.12, 0.18, 0.08, 0.12, 0.18, 0.08, 0.42, 0.58, 0.24);

    // Double-sided back triangle
    grassPos.push(bx2, 0, bz2, bx1, 0, bz1, tx, h, tz);
    grassCol.push(0.12, 0.18, 0.08, 0.12, 0.18, 0.08, 0.42, 0.58, 0.24);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(grassPos, 3));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(grassCol, 3));
  geom.computeVertexNormals();

  const windUniform = { value: 0 };
  const addWind = (mat: THREE.Material, scale = 0.38, power = 1.3, minY = 0.0) => {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = windUniform;
      shader.vertexShader = `uniform float uWindTime;
` + shader.vertexShader;
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

  const grassMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    side: THREE.DoubleSide,
  });
  addWind(grassMat, 0.42, 1.3, 0.0);

  const grass = new THREE.InstancedMesh(geom, grassMat, 7600);
  const dummy = new THREE.Object3D();
  const tintColor = new THREE.Color();
  let count = 0;

  for (let i = 0; i < 9800 && count < 7600; i++) {
    const x = rand() * 152 - 65;
    const z = 35 - rand() * 710;
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
  grass.computeBoundingSphere();
  scene.add(grass);

  // 2. Scatter mossy boulders
  const rocks = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: 0x5a6058, roughness: 0.95 }),
    80
  );
  let ri = 0;
  for (let i = 0; i < 110 && ri < 80; i++) {
    const x = rand() * 150 - 65;
    const z = 35 - rand() * 710;
    if (clear(x, z)) continue;
    dummy.position.set(x, 0.25, z);
    dummy.rotation.set(rand(), rand() * 6, rand());
    dummy.scale.set(0.6 + rand(), 0.35 + rand() * 0.4, 0.6 + rand());
    dummy.updateMatrix();
    rocks.setMatrixAt(ri++, dummy.matrix);
  }
  rocks.count = ri;
  rocks.castShadow = rocks.receiveShadow = true;
  rocks.computeBoundingSphere();
  scene.add(rocks);

  // 3. Fast placeholder trees while 3D GLTF models stream in
  const bark = new THREE.MeshStandardMaterial({ color: 0x3d352e, roughness: 0.95 });
  const needle = new THREE.MeshStandardMaterial({ color: 0x273b32, roughness: 0.9 });
  addWind(needle, 0.14, 1.2, 0.6);
  const placeholderTrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.36, 1, 7), bark, treePositions.length);
  const placeholderCrowns = new THREE.InstancedMesh(new THREE.ConeGeometry(1.6, 3.8, 5), needle, treePositions.length);
  let pti = 0;
  let pci = 0;

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
  placeholderTrunks.castShadow = placeholderTrunks.receiveShadow = true;
  placeholderCrowns.castShadow = placeholderCrowns.receiveShadow = true;
  placeholderTrunks.computeBoundingSphere();
  placeholderCrowns.computeBoundingSphere();
  const placeholderGroup = new THREE.Group();
  placeholderGroup.add(placeholderTrunks, placeholderCrowns);
  scene.add(placeholderGroup);

  // 4. Asynchronously load authentic 3D Dark Pine & Dead Oak models
  Promise.all([loadAsset('custom/pine'), loadAsset('custom/oak')])
    .then(([pineGltf, oakGltf]) => {
      // Find mesh primitives in loaded GLTFs
      let pineMesh: THREE.Mesh | undefined;
      let oakMesh: THREE.Mesh | undefined;

      pineGltf.scene.traverse((o) => {
        if (!pineMesh && o instanceof THREE.Mesh) pineMesh = o;
      });
      oakGltf.scene.traverse((o) => {
        if (!oakMesh && o instanceof THREE.Mesh) oakMesh = o;
      });

      if (!pineMesh || !oakMesh) return;

      const pinesCount = treePositions.filter((t) => t.isPine).length;
      const oaksCount = treePositions.length - pinesCount;

      const pineMat = (pineMesh.material as THREE.Material).clone();
      const oakMat = (oakMesh.material as THREE.Material).clone();
      addWind(pineMat, 0.12, 1.2, 1.0);
      addWind(oakMat, 0.12, 1.2, 1.0);
      const pineInst = new THREE.InstancedMesh(pineMesh.geometry, pineMat, pinesCount);
      const oakInst = new THREE.InstancedMesh(oakMesh.geometry, oakMat, oaksCount);
      let pi = 0;
      let oi = 0;

      for (const t of treePositions) {
        dummy.position.set(t.x, 0, t.z);
        dummy.rotation.set(0, t.rot, 0);
        dummy.scale.setScalar(t.scale * 1.35);
        dummy.updateMatrix();

        if (t.isPine) {
          pineInst.setMatrixAt(pi, dummy.matrix);
          pineInst.setColorAt(pi, tintColor.setRGB(t.tint, t.tint * 1.02, t.tint * 0.96));
          pi++;
        } else {
          oakInst.setMatrixAt(oi, dummy.matrix);
          oakInst.setColorAt(oi, tintColor.setRGB(t.tint * 1.02, t.tint, t.tint * 0.94));
          oi++;
        }
      }

      pineInst.castShadow = pineInst.receiveShadow = true;
      oakInst.castShadow = oakInst.receiveShadow = true;
      pineInst.computeBoundingSphere();
      oakInst.computeBoundingSphere();

      // Seamlessly swap out placeholders
      scene.remove(placeholderGroup);
      scene.add(pineInst, oakInst);
    })
    .catch((err) => {
      console.warn('3D trees load error, keeping placeholders', err);
    });

  // 5. Batch 2026-10: baked grass tufts + rock clusters, two InstancedMeshes.
  const nearTree = (x: number, z: number, radius: number) =>
    treePositions.some((t) => (t.x - x) * (t.x - x) + (t.z - z) * (t.z - z) < radius * radius);
  const firstMesh = (root: THREE.Object3D): THREE.Mesh | undefined => {
    let found: THREE.Mesh | undefined;
    root.traverse((o) => {
      if (!found && o instanceof THREE.Mesh) found = o;
    });
    return found;
  };
  const firstMaterial = (mesh: THREE.Mesh): THREE.Material =>
    (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;

  Promise.all([loadAsset('custom/grass_tuft'), loadAsset('custom/rock_cluster')])
    .then(([grassGltf, rockGltf]) => {
      const tuftMesh = firstMesh(grassGltf.scene);
      const rockMesh = firstMesh(rockGltf.scene);
      // Baked tufts cluster around survivor camps and along the forest edge.
      if (tuftMesh) {
        const tuftMat = firstMaterial(tuftMesh).clone() as THREE.MeshStandardMaterial;
        addWind(tuftMat, 0.16, 1.1, 0.04);
        const tuftCount = 440;
        const tufts = new THREE.InstancedMesh(tuftMesh.geometry, tuftMat, tuftCount);
        let ti = 0;
        for (const camp of CAMPS) {
          for (let i = 0; i < 22 && ti < tuftCount; i++) {
            const angle = rand() * Math.PI * 2;
            const radius = 5 + rand() * 13;
            const x = camp.x + Math.cos(angle) * radius;
            const z = camp.z + Math.sin(angle) * radius;
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
          const x = rand() * 152 - 65;
          const z = 35 - rand() * 710;
          if (clear(x, z) || !nearTree(x, z, 22) || castleFootprint(x, z)) continue;
          dummy.position.set(x, 0.01, z);
          dummy.rotation.set(0, rand() * Math.PI * 2, 0);
          const s = 0.75 + rand() * 0.95;
          dummy.scale.set(s, s * (0.85 + rand() * 0.45), s);
          dummy.updateMatrix();
          tufts.setMatrixAt(ti++, dummy.matrix);
        }
        tufts.count = ti;
        tufts.receiveShadow = true;
        tufts.computeBoundingSphere();
        scene.add(tufts);
      }
      if (rockMesh) {
        const rockMat = firstMaterial(rockMesh).clone() as THREE.MeshStandardMaterial;
        const clusterCount = 96;
        const clusters = new THREE.InstancedMesh(rockMesh.geometry, rockMat, clusterCount);
        let ci = 0;
        for (let i = 0; i < clusterCount * 6 && ci < clusterCount; i++) {
          const nearCamp = i % 2 === 0 && CAMPS.length > 0;
          let x: number;
          let z: number;
          if (nearCamp) {
            const camp = CAMPS[Math.floor(rand() * CAMPS.length)];
            const angle = rand() * Math.PI * 2;
            const radius = 6 + rand() * 15;
            x = camp.x + Math.cos(angle) * radius;
            z = camp.z + Math.sin(angle) * radius;
          } else {
            x = rand() * 152 - 65;
            z = 35 - rand() * 710;
            if (!nearTree(x, z, 26)) continue;
          }
          if (clear(x, z) || castleFootprint(x, z)) continue;
          dummy.position.set(x, 0, z);
          dummy.rotation.set(rand() * 0.3, rand() * Math.PI * 2, rand() * 0.2);
          const s = 0.45 + rand() * 0.85;
          dummy.scale.set(s, s * (0.7 + rand() * 0.5), s);
          dummy.updateMatrix();
          clusters.setMatrixAt(ci++, dummy.matrix);
        }
        clusters.count = ci;
        clusters.castShadow = clusters.receiveShadow = true;
        clusters.computeBoundingSphere();
        scene.add(clusters);
      }
    })
    .catch((err) => {
      console.warn('Scatter assets unavailable, keeping procedural grass/rocks', err);
    });

  return {
    update: (time: number) => {
      windUniform.value = time;
    }
  };
}
