import * as THREE from 'three';
import { CASTLES, CAMPS, dist } from '../shared/world';
import { loadAsset } from './assets';

/** Lush medieval vegetation: realistic grass tufts, dark spruce pines, and gnarled oaks. */
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

  const treePositions: { x: number; z: number; h: number; isPine: boolean; rot: number; scale: number }[] = [];
  for (let i = 0; i < 360; i++) {
    const x = rand() * 152 - 65;
    const z = 35 - rand() * 710;
    if (!clear(x, z)) {
      treePositions.push({
        x,
        z,
        h: 4 + rand() * 4,
        isPine: i % 3 !== 0,
        rot: rand() * Math.PI * 2,
        scale: 0.75 + rand() * 0.5,
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

  const grassMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    side: THREE.DoubleSide,
  });

  const grass = new THREE.InstancedMesh(geom, grassMat, 7000);
  const dummy = new THREE.Object3D();
  let count = 0;

  for (let i = 0; i < 9000 && count < 7000; i++) {
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
  const placeholderTrunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.36, 1, 7), bark, treePositions.length);
  const placeholderCrowns = new THREE.InstancedMesh(new THREE.ConeGeometry(1.6, 3.8, 5), needle, treePositions.length * 2);
  let pti = 0;
  let pci = 0;

  for (const t of treePositions) {
    dummy.position.set(t.x, t.h * 0.4, t.z);
    dummy.rotation.set(0, t.rot, 0);
    dummy.scale.set(1, t.h * 0.8, 1);
    dummy.updateMatrix();
    placeholderTrunks.setMatrixAt(pti++, dummy.matrix);

    dummy.position.set(t.x, t.h * 0.85, t.z);
    dummy.scale.set(t.scale * 1.2, t.h * 0.5, t.scale * 1.2);
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

      const pineInst = new THREE.InstancedMesh(pineMesh.geometry, pineMesh.material, pinesCount);
      const oakInst = new THREE.InstancedMesh(oakMesh.geometry, oakMesh.material, oaksCount);
      let pi = 0;
      let oi = 0;

      for (const t of treePositions) {
        dummy.position.set(t.x, 0, t.z);
        dummy.rotation.set(0, t.rot, 0);
        dummy.scale.setScalar(t.scale * 1.35);
        dummy.updateMatrix();

        if (t.isPine) {
          pineInst.setMatrixAt(pi++, dummy.matrix);
        } else {
          oakInst.setMatrixAt(oi++, dummy.matrix);
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
}
