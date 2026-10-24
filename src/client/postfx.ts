import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';

/**
 * Post-processing chain for the night battlefield:
 * RenderPass -> subtle UnrealBloom -> OutputPass (tone mapping + sRGB).
 *
 * Tone mapping deliberately lives in OutputPass: while three renders into a render
 * target the material shaders skip tone mapping, so applying it in the last pass is
 * correct and avoids double exposure. If anything in the addon chain is unavailable
 * (old GPU / lost WebGL2 float targets / non-browser test environment) we fall back
 * to a plain forward render so the game still runs.
 */
export interface PostFX {
  render(): void;
  setSize(width: number, height: number): void;
  dispose(): void;
  readonly enabled: boolean;
}

// Matches the renderer's own cap; keeps the composer from ballooning on 4K/retina.
const MAX_PIXEL_RATIO = 1.75;
const BLOOM_STRENGTH = 0.32;
const BLOOM_RADIUS = 0.4;
const BLOOM_THRESHOLD = 0.8;

export function createPostFX(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): PostFX {
  try {
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    const size = renderer.getSize(new THREE.Vector2());
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(Math.max(1, size.x), Math.max(1, size.y)),
      BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD
    );
    const output = new OutputPass();
    composer.addPass(renderPass);
    composer.addPass(bloom);
    composer.addPass(output);
    const pixelRatio = Math.min(renderer.getPixelRatio(), MAX_PIXEL_RATIO);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(size.x, size.y);

    return {
      enabled: true,
      render: () => composer.render(),
      setSize: (width: number, height: number) => {
        // The scene camera is updated by the caller; just resize the intermediate targets.
        if (width <= 0 || height <= 0) return;
        composer.setPixelRatio(Math.min(renderer.getPixelRatio(), MAX_PIXEL_RATIO));
        composer.setSize(width, height);
      },
      dispose: () => {
        bloom.dispose();
        renderPass.dispose();
        output.dispose();
        composer.dispose();
      }
    };
  } catch (error) {
    console.warn('Post-processing unavailable; falling back to direct rendering', error);
    return {
      enabled: false,
      render: () => renderer.render(scene, camera),
      setSize: () => undefined,
      dispose: () => undefined
    };
  }
}
