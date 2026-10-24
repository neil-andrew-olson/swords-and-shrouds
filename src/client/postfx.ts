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
 *
 * Adaptive quality: the composer's internal pixel ratio is stepped down toward 1.0
 * when the rolling frame time stays above ~28 ms for ~2 s, and recovered toward the
 * renderer cap when frames are healthy again. This keeps the heavy bloom pass cheap
 * on software renderers / weak laptops without touching the renderer's own DPR.
 */
export interface PostFX {
  render(): void;
  setSize(width: number, height: number): void;
  dispose(): void;
  readonly enabled: boolean;
  /** Current composer pixel ratio (1.0..cap); exposed for QA/perf reporting. */
  readonly pixelRatio: number;
}

// Matches the renderer's own cap; keeps the composer from ballooning on 4K/retina.
const MAX_PIXEL_RATIO = 1.75;
const MIN_PIXEL_RATIO = 1.0;
// Only genuinely emissive things (flames, moon, crystals, sparks) should bloom; a lower
// threshold smears the moonlit grass field into a white shimmer.
const BLOOM_STRENGTH = 0.22;
const BLOOM_RADIUS = 0.45;
const BLOOM_THRESHOLD = 1.05;
const SLOW_FRAME_MS = 28;
const HEALTHY_FRAME_MS = 17;
const SLOW_WINDOW_MS = 2000;
const HEALTHY_WINDOW_MS = 3000;
const STEP_DOWN = 0.15;
const STEP_UP = 0.1;

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

    const cap = Math.min(renderer.getPixelRatio(), MAX_PIXEL_RATIO);
    let pixelRatio = cap;
    let cssWidth = Math.max(1, size.x);
    let cssHeight = Math.max(1, size.y);

    const applySize = () => {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(cssWidth, cssHeight);
    };
    applySize();

    let lastFrame = 0;
    let slowAccum = 0;
    let healthyAccum = 0;
    let sinceChange = 0;

    return {
      enabled: true,
      get pixelRatio() { return pixelRatio; },
      render: () => {
        // Frame pacing from the render call rhythm; allocation-free.
        const now = performance.now();
        if (lastFrame > 0) {
          const frameMs = now - lastFrame;
          sinceChange += frameMs;
          if (frameMs > SLOW_FRAME_MS) {
            slowAccum += frameMs;
            healthyAccum = 0;
          } else if (frameMs < HEALTHY_FRAME_MS) {
            healthyAccum += frameMs;
            slowAccum = 0;
          }
          if (slowAccum > SLOW_WINDOW_MS && pixelRatio > MIN_PIXEL_RATIO) {
            pixelRatio = Math.max(MIN_PIXEL_RATIO, pixelRatio - STEP_DOWN);
            applySize();
            slowAccum = 0;
            sinceChange = 0;
          } else if (healthyAccum > HEALTHY_WINDOW_MS && pixelRatio < cap && sinceChange > HEALTHY_WINDOW_MS) {
            pixelRatio = Math.min(cap, pixelRatio + STEP_UP);
            applySize();
            healthyAccum = 0;
            sinceChange = 0;
          }
        }
        lastFrame = now;
        composer.render();
      },
      setSize: (width: number, height: number) => {
        // The scene camera is updated by the caller; just resize the intermediate targets.
        if (width <= 0 || height <= 0) return;
        cssWidth = width;
        cssHeight = height;
        applySize();
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
      pixelRatio: 1,
      render: () => renderer.render(scene, camera),
      setSize: () => undefined,
      dispose: () => undefined
    };
  }
}
