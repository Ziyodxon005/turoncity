import * as THREE from 'three';
import { createRng, type Rng } from '../core/rng';
import type { FacadeStyle } from '../world/biome';

/**
 * Builds a tileable facade texture in one of several styles, so the skyline
 * isn't all glass towers: `glass` (dense lit window grid — skyscrapers),
 * `brick` (warm low-rise with sparse windows and mortar courses — houses), and
 * `concrete` (commercial ribbon windows between spandrels). The (0,0) texel is
 * forced dark so roof/floor faces — whose UVs collapse to that corner — read as
 * unlit. Deterministic from `seed`.
 */
export function makeFacadeTexture(seed: number, style: FacadeStyle = 'glass', px = 256): THREE.CanvasTexture {
  const rng = createRng(seed);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d')!;

  if (style === 'brick') drawBrick(ctx, rng, px);
  else if (style === 'concrete') drawConcrete(ctx, rng, px);
  else drawGlass(ctx, rng, px);

  ctx.globalAlpha = 1;
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, 2, 2); // dark corner texel for roof/floor faces

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8; // was 4 — sharper at grazing angles
  return tex;
}

const LIT = ['#ffd9a0', '#ffe9c0', '#ffcf87', '#cfe6ff'];

/** Dense grid of lit/dark windows — a glass tower. */
function drawGlass(ctx: CanvasRenderingContext2D, rng: Rng, px: number): void {
  ctx.fillStyle = '#10131b';
  ctx.fillRect(0, 0, px, px);
  const cells = 8;
  const cell = px / cells;
  const pad = cell * 0.18;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      if (rng.chance(0.42)) {
        ctx.fillStyle = rng.pick(LIT);
        ctx.globalAlpha = rng.range(0.65, 1);
      } else {
        ctx.fillStyle = '#1b2030';
        ctx.globalAlpha = 1;
      }
      ctx.fillRect(x * cell + pad, y * cell + pad, cell - pad * 2, cell - pad * 2);
    }
  }
}

/** Warm masonry with mortar courses and small, sparsely-lit windows — low-rise. */
function drawBrick(ctx: CanvasRenderingContext2D, rng: Rng, px: number): void {
  ctx.fillStyle = '#5a3d30';
  ctx.fillRect(0, 0, px, px);
  const rows = 16;
  const rh = px / rows;
  ctx.globalAlpha = 1;
  for (let r = 0; r < rows; r++) {
    ctx.fillStyle = r % 2 ? '#5f4133' : '#54392d';
    ctx.fillRect(0, r * rh, px, rh - 1);
  }
  const cells = 4;
  const cell = px / cells;
  const w = cell * 0.5;
  const h = cell * 0.62;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      if (!rng.chance(0.78)) continue;
      const ox = x * cell + (cell - w) / 2;
      const oy = y * cell + (cell - h) / 2;
      ctx.fillStyle = '#241a14';
      ctx.globalAlpha = 1;
      ctx.fillRect(ox - 2, oy - 2, w + 4, h + 4);
      if (rng.chance(0.35)) {
        ctx.fillStyle = '#ffdca0';
        ctx.globalAlpha = rng.range(0.55, 0.9);
      } else {
        ctx.fillStyle = '#10141d';
        ctx.globalAlpha = 1;
      }
      ctx.fillRect(ox, oy, w, h);
    }
  }
}

/** Concrete spandrels with horizontal ribbon windows — commercial/office. */
function drawConcrete(ctx: CanvasRenderingContext2D, rng: Rng, px: number): void {
  ctx.fillStyle = '#565a62';
  ctx.fillRect(0, 0, px, px);
  const bands = 7;
  const bh = px / bands;
  for (let b = 0; b < bands; b++) {
    const y = b * bh;
    ctx.globalAlpha = 1;
    ctx.fillStyle = b % 2 ? '#5f636b' : '#52565d';
    ctx.fillRect(0, y, px, bh * 0.42);
    const ribY = y + bh * 0.42;
    const ribH = bh * 0.5;
    ctx.fillStyle = '#161b24';
    ctx.fillRect(0, ribY, px, ribH);
    const segs = 6;
    const sw = px / segs;
    for (let s = 0; s < segs; s++) {
      if (!rng.chance(0.4)) continue;
      ctx.fillStyle = rng.chance(0.7) ? '#ffe7b8' : '#bcd6ff';
      ctx.globalAlpha = rng.range(0.5, 0.85);
      ctx.fillRect(s * sw + sw * 0.12, ribY + ribH * 0.2, sw * 0.76, ribH * 0.6);
    }
  }
}

/**
 * Soft radial gradient (white core → transparent edge). Laid flat under a lamp
 * with additive blending it fakes the pool of light a streetlight casts, far
 * cheaper than a real shadow-casting light per pole.
 */
export function makeGlowTexture(px = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  const r = px / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255,232,196,1)');
  grad.addColorStop(0.4, 'rgba(255,216,150,0.45)');
  grad.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, px, px);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A soft, faintly mottled puff — opaque-ish core fading to nothing at the edge.
 */
export function makeSmokeTexture(px = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  const r = px / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, px, px);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ─── Road textures ─────────────────────────────────────────────────────────────

/**
 * Tileable asphalt road texture:
 *   - Dark grainy asphalt base
/**
 * Tileable asphalt road texture.
 * Only a yellow dashed centre line — no white edge lines (they tile badly
 * across a full city-length road and create a zebra effect).
 */
export function makeRoadTexture(px = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d')!;

  // Dark asphalt base
  ctx.fillStyle = '#1a1d25';
  ctx.fillRect(0, 0, px, px);

  // Asphalt grain noise
  const rng = createRng(42);
  for (let i = 0; i < px * px * 0.04; i++) {
    const gx = rng.range(0, px);
    const gy = rng.range(0, px);
    const br = rng.range(0.03, 0.12);
    ctx.fillStyle = `rgba(255,255,255,${br})`;
    ctx.fillRect(gx, gy, 1, 1);
  }

  // Lines run HORIZONTALLY (constant Y) — for roads whose UV.U = road length.
  // White edge lines: dashed, 20%-80% of tile width so intersection zones stay clean.
  const elw = Math.max(2, px * 0.026);
  const edgeStart = px * 0.20;
  const edgeDash = px * 0.60;
  ctx.fillStyle = 'rgba(255,255,255,0.80)';
  ctx.fillRect(edgeStart, px * 0.10 - elw / 2, edgeDash, elw);
  ctx.fillRect(edgeStart, px * 0.90 - elw / 2, edgeDash, elw);

  // Yellow dashed centre line
  const lw = Math.max(2, px * 0.022);
  ctx.fillStyle = 'rgba(230,185,40,0.88)';
  ctx.fillRect(edgeStart, px / 2 - lw / 2, edgeDash * 0.78, lw);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Same road texture but with lines drawn VERTICALLY (constant X) for roads
 * whose UV.V = road length (vertical roads: PlaneGeometry(roadWidth, extent)).
 * Using a separate texture avoids THREE.js texture-rotation + asymmetric-repeat
 * artifacts that create the many-thin-lines glitch.
 */
export function makeRoadTextureV(px = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d')!;

  // Dark asphalt base
  ctx.fillStyle = '#1a1d25';
  ctx.fillRect(0, 0, px, px);

  // Asphalt grain noise (different seed so it doesn't look identical to H version)
  const rng = createRng(43);
  for (let i = 0; i < px * px * 0.04; i++) {
    const gx = rng.range(0, px);
    const gy = rng.range(0, px);
    const br = rng.range(0.03, 0.12);
    ctx.fillStyle = `rgba(255,255,255,${br})`;
    ctx.fillRect(gx, gy, 1, 1);
  }

  // Lines run VERTICALLY (constant X) — for roads whose UV.V = road length.
  // White edge lines: dashed, 20%-80% of tile HEIGHT so intersection zones stay clean.
  const elw = Math.max(2, px * 0.026);
  const edgeStart = px * 0.20;
  const edgeDash = px * 0.60;
  ctx.fillStyle = 'rgba(255,255,255,0.80)';
  // Left edge line (one road edge)
  ctx.fillRect(px * 0.10 - elw / 2, edgeStart, elw, edgeDash);
  // Right edge line (other road edge)
  ctx.fillRect(px * 0.90 - elw / 2, edgeStart, elw, edgeDash);

  // Yellow dashed centre line (vertical)
  const lw = Math.max(2, px * 0.022);
  ctx.fillStyle = 'rgba(230,185,40,0.88)';
  ctx.fillRect(px / 2 - lw / 2, edgeStart, lw, edgeDash * 0.78);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}


/**
 * Tangent-space normal map for asphalt — micro-bump detail for specular realism.
 */
export function makeRoadNormalMap(px = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(px, px);
  const rng = createRng(99);

  const h = new Float32Array(px * px);
  for (let i = 0; i < h.length; i++) h[i] = rng.range(0, 1);
  for (let pass = 0; pass < 3; pass++) {
    const tmp = new Float32Array(h);
    for (let y = 1; y < px - 1; y++) {
      for (let x = 1; x < px - 1; x++) {
        const i = y * px + x;
        tmp[i] = (h[i] + h[i - 1] + h[i + 1] + h[i - px] + h[i + px]) / 5;
      }
    }
    h.set(tmp);
  }

  const str = 2.5;
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const i = y * px + x;
      const l = h[Math.max(0, x - 1) + y * px];
      const r = h[Math.min(px - 1, x + 1) + y * px];
      const u = h[x + Math.max(0, y - 1) * px];
      const d = h[x + Math.min(px - 1, y + 1) * px];
      let nx = (l - r) * str;
      let ny = (u - d) * str;
      let nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len; ny /= len; nz /= len;
      const b = i * 4;
      img.data[b] = Math.round((nx * 0.5 + 0.5) * 255);
      img.data[b + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      img.data[b + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      img.data[b + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Night sky: deep dark-blue gradient with procedural stars.
 * Used as the scene background texture at night.
 */
export function makeNightSkyTexture(px = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = px * 2;
  canvas.height = px;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, px, 0, 0);
  grad.addColorStop(0, '#1d2240');
  grad.addColorStop(0.3, '#0e1228');
  grad.addColorStop(1, '#04060f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, px * 2, px);

  const rng = createRng(7);
  for (let i = 0; i < 700; i++) {
    const sx = rng.range(0, px * 2);
    const sy = rng.range(0, px * 0.82);
    const sr = rng.range(0.3, 1.4);
    const sa = rng.range(0.35, 1.0);
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,245,220,${sa})`;
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
