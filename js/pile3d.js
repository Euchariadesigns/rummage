/* The bag on the floor and the clothes in it.
   Every piece is real cloth: a mesh of particles held together by springs (position-based
   dynamics), so it hangs from where you pinch it, flaps when you fling it, and crumples and
   drapes over whatever it lands on. Pieces lie in a stack; each one rests on the ones below it.
   three.js draws it all. */
import * as THREE from 'three';

const GRAVITY = -22;
const WALL_H = 2.9;          // height of the bag's sides
const WALL_T = 0.18;         // thickness of the sides
const LIFT_H = WALL_H + 3.6; // where your hand holds a piece: up out of the bag, toward you
const R = 0.045;             // half the thickness of cloth
const CS = 0.1;              // height-map cell size
const SUB = 8;               // physics substeps per frame
const RES = 16;              // cloth cells along a piece's longest side
const TILT = 0.42;           // camera tilt from straight down, radians
const FOV = 34;
const BAG_W = 4.2;           // bag width; its length follows the screen
const SIDE = 0.95;           // floor beside the bag, left and right
const ENDS = 1.05;           // floor beyond the bag, top and bottom
const ALPHA_CUT = 115;

export function prepare() { return Promise.resolve(); }

const rand = (a, b) => a + Math.random() * (b - a);
const gauss = () => {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- textures ----------

function weaveCanvas(bag, ticks = true) {
  const period = bag.weave.reduce((s, [, h]) => s + h, 0);
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = period * 4;
  const g = c.getContext('2d');
  let y = 0;
  for (const [color, h] of bag.weave) {
    g.fillStyle = color;
    g.fillRect(0, y * 4, c.width, h * 4);
    y += h;
  }
  if (ticks) {
    g.fillStyle = 'rgba(255,255,255,0.34)';
    for (let yy = 0; yy < c.height; yy += 6) for (let xx = (yy / 6) % 2 ? 3 : 0; xx < c.width; xx += 6) g.fillRect(xx, yy, 3, 3);
  }
  return c;
}

/** Raised threads of the weave, for the bump map. */
function weaveBumpCanvas(bag) {
  const period = bag.weave.reduce((s, [, h]) => s + h, 0);
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = period * 4;
  const g = c.getContext('2d');
  g.fillStyle = '#5a5a5a';
  g.fillRect(0, 0, c.width, c.height);
  for (let yy = 0; yy < c.height; yy += 6) {
    for (let xx = (yy / 6) % 2 ? 3 : 0; xx < c.width; xx += 6) {
      g.fillStyle = '#d8d8d8'; g.fillRect(xx, yy, 3, 3);
      g.fillStyle = '#9a9a9a'; g.fillRect(xx + 3, yy, 3, 3);
    }
  }
  return c;
}

function tex(canvas, renderer, rx, ry, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  t.repeat.set(rx, ry);
  return t;
}

function floorCanvas(tint) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = tint;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 30 + Math.random() * 70;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, Math.random() < 0.5 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.05)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
  }
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)';
    g.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
  }
  return c;
}

// ---------- cloth ----------

const STIFF_WORDS = /boot|sneaker|shoe/i;

class Cloth {
  constructor(look, uw, uh) {
    this.look = look;
    this.item = look.item;
    this.uw = uw; this.uh = uh;
    const A = look.A;
    const nx = Math.max(4, Math.round(RES * uw / Math.max(uw, uh)));
    const nz = Math.max(4, Math.round(RES * uh / Math.max(uw, uh)));
    this.nx = nx; this.nz = nz;
    this.spacing = Math.max(uw / nx, uh / nz);

    // which cells have cloth in them
    const solid = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x0 = Math.floor(i * A / nx), x1 = Math.max(x0 + 1, Math.floor((i + 1) * A / nx));
        const y0 = Math.floor(j * A / nz), y1 = Math.max(y0 + 1, Math.floor((j + 1) * A / nz));
        let on = 0, n = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { n++; if (look.alpha[y * A + x] > ALPHA_CUT) on++; }
        solid[j * nx + i] = on / n > 0.08 ? 1 : 0;
      }
    }
    // particles at the corners of solid cells
    const vid = new Int32Array((nx + 1) * (nz + 1)).fill(-1);
    const V = (i, j) => j * (nx + 1) + i;
    let n = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      if (!solid[j * nx + i]) continue;
      for (const [a, b] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) if (vid[V(a, b)] < 0) vid[V(a, b)] = n++;
    }
    if (!n) { // nothing opaque: fall back to the whole rectangle
      solid.fill(1);
      for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) vid[V(i, j)] = n++;
    }
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.inv = new Float32Array(n).fill(1);
    this.lx = new Float32Array(n);
    this.lz = new Float32Array(n);
    const uv = new Float32Array(n * 2);
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const k = vid[V(i, j)];
      if (k < 0) continue;
      this.lx[k] = (i / nx - 0.5) * uw;
      this.lz[k] = (j / nz - 0.5) * uh;
      uv[k * 2] = i / nx;
      uv[k * 2 + 1] = 1 - j / nz;
    }

    // triangles and springs
    const index = [];
    const seen = new Set();
    const ci = [], cj = [], cr = [], cc = [];
    const stiff = STIFF_WORDS.test(look.item.name || '');
    const SHEAR = stiff ? 1e-8 : 4e-7, BEND = stiff ? 2e-8 : 2.5e-5;
    const spring = (a, b, comp) => {
      if (a < 0 || b < 0) return;
      const key = a < b ? a * n + b : b * n + a;
      if (seen.has(key)) return;
      seen.add(key);
      ci.push(a); cj.push(b);
      cr.push(Math.hypot(this.lx[a] - this.lx[b], this.lz[a] - this.lz[b]));
      cc.push(comp);
    };
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      if (!solid[j * nx + i]) continue;
      const a = vid[V(i, j)], b = vid[V(i + 1, j)], c = vid[V(i, j + 1)], d = vid[V(i + 1, j + 1)];
      index.push(a, c, b, b, c, d);
      spring(a, b, 0); spring(a, c, 0); spring(b, d, 0); spring(c, d, 0);
      spring(a, d, SHEAR); spring(b, c, SHEAR);
    }
    // bending: every second particle along each row and column
    for (let j = 0; j <= nz; j++) for (let i = 0; i + 2 <= nx; i++) {
      const a = vid[V(i, j)], m = vid[V(i + 1, j)], b = vid[V(i + 2, j)];
      if (a >= 0 && m >= 0 && b >= 0) spring(a, b, BEND);
    }
    for (let i = 0; i <= nx; i++) for (let j = 0; j + 2 <= nz; j++) {
      const a = vid[V(i, j)], m = vid[V(i, j + 1)], b = vid[V(i, j + 2)];
      if (a >= 0 && m >= 0 && b >= 0) spring(a, b, BEND);
    }
    this.ci = Int32Array.from(ci); this.cj = Int32Array.from(cj);
    this.cr = Float32Array.from(cr); this.cc = Float32Array.from(cc);

    // a dozen points spread over the cloth, for "how buried is it"
    const step = Math.max(1, Math.floor(n / 14));
    this.samples = [];
    for (let k = 0; k < n; k += step) this.samples.push(k);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(index);
    this.geo = geo;

    this.order = 0;
    this.awake = true;
    this.calm = 0;
    this.held = false;
    this.pin = -1;
    this.hidden = false;
    this.below = [];
    this.hm = new Float32Array(0);
    this.gx0 = 0; this.gz0 = 0; this.gw = 0; this.gh = 0;
    this.bb = [0, 0, 0, 0];
    this.cover = 0;
    this.shade = 1;
    this.shadeTarget = 1;
  }

  /** Lay the cloth out at (x, y, z), turned by yaw, loosely crumpled. */
  place(x, y, z, yaw, crumple = 1) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const p1 = rand(0, 6.3), p2 = rand(0, 6.3), p3 = rand(0, 6.3);
    const f1 = rand(1.2, 2.2), f2 = rand(2.4, 3.6);
    const squeeze = 1 - 0.12 * crumple;
    for (let k = 0; k < this.n; k++) {
      const lx = this.lx[k] * squeeze, lz = this.lz[k] * squeeze;
      const h = crumple * (0.22 * Math.sin(lx * f1 + p1) * Math.cos(lz * f1 * 0.8 + p2) + 0.09 * Math.sin((lx + lz) * f2 + p3));
      this.pos[k * 3] = x + lx * c - lz * s;
      this.pos[k * 3 + 1] = y + h;
      this.pos[k * 3 + 2] = z + lx * s + lz * c;
    }
    this.prev.set(this.pos);
    this.vel.fill(0);
    this.wake();
  }

  wake() { this.awake = true; this.calm = 0; }

  centroid(out) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < this.n; k++) { x += this.pos[k * 3]; y += this.pos[k * 3 + 1]; z += this.pos[k * 3 + 2]; }
    return out.set(x / this.n, y / this.n, z / this.n);
  }

  addVelocity(vx, vy, vz) {
    for (let k = 0; k < this.n; k++) { this.vel[k * 3] += vx; this.vel[k * 3 + 1] += vy; this.vel[k * 3 + 2] += vz; }
    this.wake();
  }
}

// ---------- the pile ----------

export class Pile {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.hooks = hooks;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 120);
    this.raycaster = new THREE.Raycaster();

    const hemi = new THREE.HemisphereLight(0xffffff, 0x45403a, 1.25);
    const sun = new THREE.DirectionalLight(0xfff2e2, 2.3);
    sun.position.set(-7, 22, -10); // a window up and to the left, behind the bag
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 3;
    this.sun = sun;
    this.scene.add(hemi, sun, sun.target);

    this.cloths = [];
    this.bagMeshes = [];
    this.drag = null;
    this.raf = 0;
    this.last = 0;
    this.kick = 0;
    this.coverAt = 0;
    this.coverDirty = true;
    this.targetId = null;
    this.counts = '';
    this.topOrder = 0;
    this.open_ = false;
    this._loop = this._loop.bind(this);
    this._v = new THREE.Vector3();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    canvas.addEventListener('pointerdown', e => this._down(e));
    canvas.addEventListener('pointermove', e => this._move(e));
    canvas.addEventListener('pointerup', e => this._up(e));
    canvas.addEventListener('pointercancel', e => this._up(e));
    canvas.addEventListener('lostpointercapture', e => this._up(e));
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  // ---------- lifecycle ----------

  async open(bag, looks, snapshot, floorTint = '#e4e1da') {
    this.close();
    this.bag = bag;
    const w = this.canvas.clientWidth || 360, h = this.canvas.clientHeight || 640;
    const aspect = w / h;
    this.VW = BAG_W + SIDE * 2;
    this.VH = this.VW / aspect / Math.cos(TILT) * 1.08;
    this.BX = BAG_W;
    this.BZ = clamp(this.VH - ENDS * 2, 4.2, 11);
    this.iX = this.BX / 2; this.iZ = this.BZ / 2;
    this.oX = this.iX + WALL_T; this.oZ = this.iZ + WALL_T;
    this.gx0 = -this.VW / 2 - 1; this.gz0 = -this.VH / 2 - 1; // height-map origin

    this.scene.background = new THREE.Color(floorTint);
    this._buildBag(bag, floorTint);
    this.resize();

    this.topOrder = 0;
    looks.forEach((look, i) => {
      const c = this._makeCloth(look);
      const saved = snapshot && snapshot[look.item.id];
      if (saved && saved.pos && saved.pos.length === c.n * 3) {
        c.pos.set(saved.pos);
        c.prev.set(saved.pos);
        c.order = saved.order;
        c.awake = false;
        this._updateHeightmap(c);
        this._updateGeometry(c);
      } else {
        // drop it in well clear of the sides, so nothing spills out before you start
        const half = Math.hypot(c.uw, c.uh) * 0.44;
        const mx = Math.max(0, this.iX - half - 0.15), mz = Math.max(0, this.iZ - half - 0.15);
        const sx = clamp(gauss() * this.BX * 0.12, -mx, mx);
        const sz = clamp(gauss() * this.BZ * 0.12, -mz, mz);
        c.place(sx, 0.5 + i * 0.42, sz, rand(0, Math.PI * 2), 1);
        c.order = i + 1;
      }
      this.topOrder = Math.max(this.topOrder, c.order);
    });
    for (const c of this.cloths) this._updateHeightmap(c);
    this.open_ = true;
    this.kick = 120;
    this.coverDirty = true;
    this.counts = '';
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this._loop);
    }
  }

  close() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.drag = null;
    this.open_ = false;
    for (const c of this.cloths) this._disposeCloth(c);
    this.cloths = [];
    for (const m of this.bagMeshes) {
      this.scene.remove(m);
      m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        for (const key of ['map', 'bumpMap']) if (mat[key]) mat[key].dispose();
        mat.dispose();
      }
    }
    this.bagMeshes = [];
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    if (this.VW) this._fitCamera();
    this.camera.updateProjectionMatrix();
    this.kick = Math.max(this.kick, 2);
  }

  /** Tilt the camera like someone standing over the bag, and back off until floor and bag fit. */
  _fitCamera() {
    const pts = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      // the floor nearest you looks biggest under the tilt, so frame it tighter on that side
      const fz = sz > 0 ? this.oZ + 0.55 : this.VH / 2;
      pts.push(new THREE.Vector3(sx * this.VW / 2, 0, sz * fz));
      pts.push(new THREE.Vector3(sx * (this.oX + 0.15), WALL_H + 0.1, sz * (this.oZ + 0.15)));
    }
    const dir = new THREE.Vector3(0, Math.cos(TILT), Math.sin(TILT));
    let center = 0;
    const place = d => {
      this.camera.position.set(0, 0, center).addScaledVector(dir, d);
      this.camera.up.set(0, 0, -1);
      this.camera.lookAt(0, 0, center);
      this.camera.updateMatrixWorld();
      this.camera.updateProjectionMatrix();
    };
    const extent = () => {
      let mx = 0, minY = 1, maxY = -1;
      for (const p of pts) {
        const s = p.clone().project(this.camera);
        mx = Math.max(mx, Math.abs(s.x));
        minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
      }
      return { mx, minY, maxY };
    };
    let d = 20;
    for (let pass = 0; pass < 3; pass++) {
      let lo = 5, hi = 80;
      for (let it = 0; it < 28; it++) {
        d = (lo + hi) / 2;
        place(d);
        const e = extent();
        if (e.mx <= 0.99 && e.minY >= -0.99 && e.maxY <= 0.99) hi = d; else lo = d;
      }
      d = hi;
      place(d);
      // re-centre so the margins top and bottom match
      const e = extent();
      center += (e.maxY + e.minY) / 2 * this.VH * -0.25;
    }
    place(d);
    this.camera.far = d + 30;
    // a piece you're holding hangs toward the bottom of the screen, facing you,
    // the way you'd hold a garment up in front of you to see what it is
    this.hang = new THREE.Vector3(0, -1, 0).applyQuaternion(this.camera.quaternion).normalize();
  }

  snapshot() {
    const out = {};
    for (const c of this.cloths) {
      if (c.hidden) continue;
      out[c.item.id] = { pos: Array.from(c.pos), order: c.order };
    }
    return out;
  }

  get pieces() { return this.cloths; }

  get count() { return this.cloths.filter(c => !c.hidden).length; }

  /** Is most of this piece still inside the bag? */
  inBag(c) {
    let inside = 0;
    for (let k = 0; k < c.n; k++) if (Math.abs(c.pos[k * 3]) < this.iX && Math.abs(c.pos[k * 3 + 2]) < this.iZ) inside++;
    return inside > c.n / 2;
  }

  get inBagCount() { return this.cloths.filter(c => !c.hidden && this.inBag(c)).length; }

  find(id) { return this.cloths.find(c => c.item.id === id) || null; }

  // ---------- building the bag ----------

  _buildBag(bag, floorTint) {
    const { BX, BZ, VW, VH, iX, iZ, oX, oZ } = this;
    const add = m => { this.scene.add(m); this.bagMeshes.push(m); return m; };
    const r = this.renderer;

    // the room floor
    const floor = add(new THREE.Mesh(
      new THREE.PlaneGeometry(VW + 14, VH + 14).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: tex(floorCanvas(floorTint), r, (VW + 14) / 6, (VH + 14) / 6), roughness: 1 })
    ));
    floor.receiveShadow = true;

    // the bag's bottom, inside
    const fc = document.createElement('canvas');
    fc.width = fc.height = 64;
    const fg = fc.getContext('2d');
    fg.fillStyle = '#' + new THREE.Color(bag.interior).multiplyScalar(1.5).getHexString();
    fg.fillRect(0, 0, 64, 64);
    fg.fillStyle = 'rgba(255,255,255,0.06)';
    for (let yy = 0; yy < 64; yy += 4) for (let xx = (yy / 4) % 2 ? 2 : 0; xx < 64; xx += 5) fg.fillRect(xx, yy, 2, 1.5);
    const lining = add(new THREE.Mesh(new THREE.PlaneGeometry(BX, BZ).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: tex(fc, r, BX / 0.5, BZ / 0.5), roughness: 1 })));
    lining.position.y = 0.01;
    lining.receiveShadow = true;

    // sides: a soft woven sack, rounded at the corners, puffed out in the middle
    const weave = weaveCanvas(bag), bump = weaveBumpCanvas(bag);
    const period = bag.weave.reduce((s, [, h]) => s + h, 0) / 40; // world units per stripe repeat
    const outer = this._sackWall(oX, oZ, 0.34, +1);
    const outerLen = outer.userData.perimeter;
    outer.material = new THREE.MeshStandardMaterial({
      map: tex(weave, r, outerLen / 0.9, WALL_H / period),
      bumpMap: tex(bump, r, outerLen / 0.9, WALL_H / period, false), bumpScale: 2.2,
      roughness: 0.92
    });
    outer.castShadow = true;
    outer.receiveShadow = true;
    add(outer);
    const inner = this._sackWall(iX, iZ, 0.2, -1);
    const innerMap = tex(weave, r, inner.userData.perimeter / 0.9, WALL_H / period);
    inner.material = new THREE.MeshStandardMaterial({
      map: innerMap, color: 0x8a8a8a, vertexColors: true,
      bumpMap: tex(bump, r, inner.userData.perimeter / 0.9, WALL_H / period, false), bumpScale: 1.6,
      roughness: 1
    });
    inner.receiveShadow = true;
    add(inner);

    // the top edge: binding tape with an open zip along it
    const zc = document.createElement('canvas');
    zc.width = 64; zc.height = 32;
    const zg = zc.getContext('2d');
    zg.fillStyle = bag.thread; zg.fillRect(0, 0, 64, 32);
    zg.fillStyle = '#1d1d21'; zg.fillRect(0, 10, 64, 12);
    zg.fillStyle = '#c9c4ba';
    for (let x = 0; x < 64; x += 4) { zg.fillRect(x, 12, 2, 4); zg.fillRect(x + 2, 16, 2, 4); }
    const top = add(this._rimBand(zc));
    top.castShadow = true;
    top.receiveShadow = true;

    // piping down each corner and round the top
    const pipe = new THREE.MeshStandardMaterial({ color: new THREE.Color(bag.thread).multiplyScalar(0.95), roughness: 0.7 });
    const rc = 0.34;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const cx = sx * (oX - rc + rc * Math.SQRT1_2), cz = sz * (oZ - rc + rc * Math.SQRT1_2);
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(cx, 0.02, cz),
        new THREE.Vector3(cx + sx * 0.08, WALL_H * 0.5, cz + sz * 0.08),
        new THREE.Vector3(cx, WALL_H, cz)
      ]);
      const m = add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.055, 8, false), pipe));
      m.castShadow = true;
    }

    // handles: two woven straps, flopped over the long sides onto the floor
    const strap = new THREE.MeshStandardMaterial({ color: new THREE.Color(bag.thread), roughness: 0.85 });
    for (const sx of [-1, 1]) {
      const x0 = sx * oX;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(x0, WALL_H - 0.05, -0.75),
        new THREE.Vector3(x0 + sx * 0.35, WALL_H + 0.25, -0.55),
        new THREE.Vector3(x0 + sx * 0.75, WALL_H * 0.45, -0.35),
        new THREE.Vector3(x0 + sx * 1.0, 0.06, 0),
        new THREE.Vector3(x0 + sx * 0.75, WALL_H * 0.45, 0.35),
        new THREE.Vector3(x0 + sx * 0.35, WALL_H + 0.25, 0.55),
        new THREE.Vector3(x0, WALL_H - 0.05, 0.75)
      ]);
      const geo = new THREE.TubeGeometry(curve, 48, 0.075, 8, false);
      const m = add(new THREE.Mesh(geo, strap));
      m.castShadow = true;
    }

    const sc = this.sun.shadow.camera;
    sc.left = -VW / 2 - 3; sc.right = VW / 2 + 3;
    sc.top = VH / 2 + 3; sc.bottom = -VH / 2 - 3;
    sc.near = 5; sc.far = 60;
    sc.updateProjectionMatrix();
  }

  /** A rounded-rectangle wall of the sack. dir +1 faces out, -1 faces in. */
  _sackWall(hx, hz, rc, dir) {
    const path = [];
    const corner = (cx, cz, a0) => {
      for (let s = 0; s <= 8; s++) {
        const a = a0 + (s / 8) * Math.PI / 2;
        path.push([cx + rc * Math.cos(a), cz + rc * Math.sin(a), Math.cos(a), Math.sin(a)]);
      }
    };
    corner(hx - rc, hz - rc, 0);
    corner(-hx + rc, hz - rc, Math.PI / 2);
    corner(-hx + rc, -hz + rc, Math.PI);
    corner(hx - rc, -hz + rc, Math.PI * 1.5);
    path.push(path[0]);
    // straight runs get extra points so the bulge can bend them
    const pts = [];
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.round(len / 0.25));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        let nx = a[2] + (b[2] - a[2]) * t, nz = a[3] + (b[3] - a[3]) * t;
        const nl = Math.hypot(nx, nz) || 1;
        pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, nx / nl, nz / nl]);
      }
    }
    pts.push(pts[0]);
    const rows = 10;
    const positions = [], uvs = [], colors = [], index = [];
    let u = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) u += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      for (let j = 0; j <= rows; j++) {
        const t = j / rows, y = t * WALL_H;
        // puffed out in the middle of each side, pinched at the corners, curling in at the top
        const sideMid = Math.min(1, Math.min(hx - Math.abs(pts[i][0]), hz - Math.abs(pts[i][1])) / 0.8 + 0.25);
        const bulge = 0.16 * Math.sin(Math.PI * t) * sideMid - (t > 0.9 ? (t - 0.9) * 0.6 : 0);
        positions.push(pts[i][0] + pts[i][2] * bulge, y, pts[i][1] + pts[i][3] * bulge);
        uvs.push(u, t);
        const k = dir > 0 ? 1 : 0.3 + 0.7 * t; // inside gets darker toward the bottom
        colors.push(k, k, k);
      }
    }
    for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j, b = a + 1, c = a + rows + 1, d = c + 1;
      if (dir > 0) index.push(a, b, c, b, d, c); else index.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    // uvs were in world units; the texture repeat expects 0..1 over the perimeter
    const uvAttr = geo.attributes.uv;
    for (let i = 0; i < uvAttr.count; i++) uvAttr.setX(i, uvAttr.getX(i) / u);
    const mesh = new THREE.Mesh(geo);
    mesh.userData.perimeter = u;
    return mesh;
  }

  /** The band across the top of the sides, with the zip running round it. */
  _rimBand(canvas) {
    const og = this._sackWall(this.oX, this.oZ, 0.34, +1).geometry;
    const ig = this._sackWall(this.iX, this.iZ, 0.2, -1).geometry;
    const outer = og.attributes.position, inner = ig.attributes.position;
    const rows = 11; // per column in _sackWall
    const cols = Math.min(outer.count, inner.count) / rows;
    const positions = [], uvs = [], index = [];
    for (let i = 0; i < cols; i++) {
      const o = i * rows + (rows - 1), n = Math.round(i * (inner.count / rows - 1) / (cols - 1)) * rows + (rows - 1);
      positions.push(outer.getX(o), WALL_H + 0.06, outer.getZ(o));
      positions.push(inner.getX(n), WALL_H + 0.06, inner.getZ(n));
      uvs.push(i / (cols - 1) * 60, 0, i / (cols - 1) * 60, 1);
    }
    for (let i = 0; i < cols - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      index.push(a, b, c, b, d, c);
    }
    og.dispose();
    ig.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: t, roughness: 0.7, side: THREE.DoubleSide }));
  }

  // ---------- cloth bookkeeping ----------

  _makeCloth(look) {
    const ratio = look.w / look.h;
    const rectArea = 5.8 / look.opaqueFrac;
    let uh = Math.sqrt(rectArea / ratio), uw = uh * ratio;
    const k = Math.min(1, Math.min(3.1, this.BX * 0.74) / Math.max(uw, uh));
    uw *= k; uh *= k;

    if (!look.texture) {
      const t = new THREE.Texture(look.image);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      t.needsUpdate = true;
      look.texture = t;
    }
    const c = new Cloth(look, uw, uh);
    const mat = new THREE.MeshStandardMaterial({
      map: look.texture, bumpMap: look.texture, bumpScale: 1.4,
      alphaTest: ALPHA_CUT / 255, alphaToCoverage: true,
      side: THREE.DoubleSide, roughness: 0.92, metalness: 0
    });
    mat.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        '#include <map_fragment>\n  if (!gl_FrontFacing) diffuseColor.rgb *= 0.62;');
    };
    const mesh = new THREE.Mesh(c.geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking, map: look.texture, alphaTest: ALPHA_CUT / 255, side: THREE.DoubleSide
    });
    mesh.frustumCulled = false;
    mesh.userData.cloth = c;
    c.mesh = mesh;
    c.mat = mat;
    this.scene.add(mesh);
    this.cloths.push(c);
    return c;
  }

  _disposeCloth(c) {
    this.scene.remove(c.mesh);
    c.geo.dispose();
    c.mat.dispose();
    c.mesh.customDepthMaterial.dispose();
  }

  _updateGeometry(c) {
    c.geo.attributes.position.needsUpdate = true;
    c.geo.computeVertexNormals();
    c.geo.computeBoundingSphere();
  }

  /** Each piece keeps a little height map of its own top surface, for others to rest on. */
  _updateHeightmap(c) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let k = 0; k < c.n; k++) {
      const x = c.pos[k * 3], z = c.pos[k * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const rad = c.spacing * 0.75;
    const gx0 = Math.floor((minX - rad - this.gx0) / CS), gz0 = Math.floor((minZ - rad - this.gz0) / CS);
    const gx1 = Math.ceil((maxX + rad - this.gx0) / CS), gz1 = Math.ceil((maxZ + rad - this.gz0) / CS);
    const gw = gx1 - gx0 + 1, gh = gz1 - gz0 + 1;
    if (c.hm.length < gw * gh) c.hm = new Float32Array(gw * gh * 2);
    c.hm.fill(-1e9, 0, gw * gh);
    c.gx0 = gx0; c.gz0 = gz0; c.gw = gw; c.gh = gh;
    c.bb[0] = minX - rad; c.bb[1] = maxX + rad; c.bb[2] = minZ - rad; c.bb[3] = maxZ + rad;
    const rc = Math.ceil(rad / CS);
    for (let k = 0; k < c.n; k++) {
      const x = c.pos[k * 3], y = c.pos[k * 3 + 1] + R, z = c.pos[k * 3 + 2];
      const cx = Math.floor((x - this.gx0) / CS) - gx0, cz = Math.floor((z - this.gz0) / CS) - gz0;
      for (let dz = -rc; dz <= rc; dz++) {
        const zz = cz + dz;
        if (zz < 0 || zz >= gh) continue;
        for (let dx = -rc; dx <= rc; dx++) {
          const xx = cx + dx;
          if (xx < 0 || xx >= gw) continue;
          const i = zz * gw + xx;
          if (y > c.hm[i]) c.hm[i] = y;
        }
      }
    }
  }

  _overlap(a, b) {
    return a.bb[0] < b.bb[1] && a.bb[1] > b.bb[0] && a.bb[2] < b.bb[3] && a.bb[3] > b.bb[2];
  }

  /** Whatever was lying on top of c has lost its support: wake it so it settles. */
  _wakeAbove(c, order) {
    for (const q of this.cloths) {
      if (q === c || q.hidden || q.held || q.order <= order || !this._overlap(q, c)) continue;
      if (!q.awake) { q.wake(); this._wakeAbove(q, q.order); }
    }
  }

  /** The surface under a point of cloth at height y: the floor, the top of the bag's side,
      or another piece. A piece only rests on cloth it meets from above; where some other
      piece is clearly over it already, it stays underneath there (piles layer locally). */
  _ground(c, x, z, y) {
    let g = 0;
    const ax = Math.abs(x), az = Math.abs(z);
    if (y > WALL_H - 0.3 && ax < this.oX && az < this.oZ && !(ax < this.iX && az < this.iZ)) g = WALL_H + 0.08;
    const gx = Math.floor((x - this.gx0) / CS), gz = Math.floor((z - this.gz0) / CS);
    const reach = y + 0.22;
    const below = c.below;
    for (let i = 0; i < below.length; i++) {
      const q = below[i];
      const lx = gx - q.gx0, lz = gz - q.gz0;
      if (lx < 0 || lz < 0 || lx >= q.gw || lz >= q.gh) continue;
      const h = q.hm[lz * q.gw + lx];
      if (h > g && h < reach) g = h;
    }
    return g;
  }

  // ---------- simulation ----------

  _step(c) {
    const h = 1 / 60 / SUB;
    const { pos, prev, vel, inv, ci, cj, cr, cc } = c;
    const n = c.n, m = ci.length;
    const drag = 1 - 0.9 * h;
    const d = this.drag;
    const holding = d && d.lifted && d.cloth === c;
    // who is this piece lying on? everything lower in the stack that overlaps it
    c.below = [];
    for (const q of this.cloths) {
      if (q === c || q.hidden || q.held || q.order >= c.order) continue;
      if (q.bb[0] < c.bb[1] + 1 && q.bb[1] > c.bb[0] - 1 && q.bb[2] < c.bb[3] + 1 && q.bb[3] > c.bb[2] - 1) c.below.push(q);
    }
    // the room's edges sit just past the screen: thrown clothes land at the edge, partly in view
    const fx = this.VW / 2 + 0.3, fz = this.VH / 2 + 0.3, ceil = LIFT_H + 3;
    const hang = this.hang || this._v.set(0, -1, 0);
    const gx = holding ? hang.x * 17 : 0, gy = holding ? hang.y * 17 : GRAVITY, gz = holding ? hang.z * 17 : 0;
    let maxV = 0;
    for (let s = 0; s < SUB; s++) {
      if (holding) {
        const t = (s + 1) / SUB;
        const k = c.pin;
        pos[k * 3] = d.from.x + (d.hand.x - d.from.x) * t;
        pos[k * 3 + 1] = d.from.y + (d.hand.y - d.from.y) * t;
        pos[k * 3 + 2] = d.from.z + (d.hand.z - d.from.z) * t;
      }
      for (let k = 0; k < n; k++) {
        const i = k * 3;
        prev[i] = pos[i]; prev[i + 1] = pos[i + 1]; prev[i + 2] = pos[i + 2];
        if (!inv[k]) continue;
        vel[i] = (vel[i] + gx * h) * drag; vel[i + 1] = (vel[i + 1] + gy * h) * drag; vel[i + 2] = (vel[i + 2] + gz * h) * drag;
        pos[i] += vel[i] * h; pos[i + 1] += vel[i + 1] * h; pos[i + 2] += vel[i + 2] * h;
      }
      if (holding) { // the pinned point moved before prev was stored; keep its velocity honest
        const k = c.pin * 3;
        prev[k] = pos[k] - d.hv.x * h; prev[k + 1] = pos[k + 1] - d.hv.y * h; prev[k + 2] = pos[k + 2] - d.hv.z * h;
      }
      // springs (XPBD, one pass per substep)
      const h2 = h * h;
      for (let e = 0; e < m; e++) {
        const a = ci[e], b = cj[e];
        const wa = inv[a], wb = inv[b], w = wa + wb;
        if (!w) continue;
        const ia = a * 3, ib = b * 3;
        const dx = pos[ib] - pos[ia], dy = pos[ib + 1] - pos[ia + 1], dz = pos[ib + 2] - pos[ia + 2];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len < 1e-6) continue;
        const C = len - cr[e];
        const lambda = -C / (w + cc[e] / h2);
        const nx = dx / len, ny = dy / len, nz = dz / len;
        pos[ia] -= wa * lambda * nx; pos[ia + 1] -= wa * lambda * ny; pos[ia + 2] -= wa * lambda * nz;
        pos[ib] += wb * lambda * nx; pos[ib + 1] += wb * lambda * ny; pos[ib + 2] += wb * lambda * nz;
      }
      // collisions: the floor, the pieces below, the bag's sides, the edges of the room
      for (let k = 0; k < n; k++) {
        if (!inv[k]) continue;
        const i = k * 3;
        let x = pos[i], y = pos[i + 1], z = pos[i + 2];
        const ax = Math.abs(x), az = Math.abs(z);
        const inBand = ax < this.oX && az < this.oZ && !(ax < this.iX && az < this.iZ);
        if (inBand && y < WALL_H) {
          // hit the side of the bag: push back to whichever side it came from
          const px = Math.abs(prev[i]), pz = Math.abs(prev[i + 2]);
          if (px < this.iX && pz < this.iZ) {
            if (ax >= this.iX) { x = Math.sign(x) * (this.iX - 1e-3); prev[i] = x; }
            if (az >= this.iZ) { z = Math.sign(z) * (this.iZ - 1e-3); prev[i + 2] = z; }
          } else if (prev[i + 1] < WALL_H) {
            if (this.oX - ax < this.oZ - az) { x = Math.sign(x) * (this.oX + 1e-3); prev[i] = x; }
            else { z = Math.sign(z) * (this.oZ + 1e-3); prev[i + 2] = z; }
          } else {
            y = WALL_H + 0.08 + R; // landed on the top edge
          }
          pos[i] = x; pos[i + 2] = z;
        }
        const g = this._ground(c, x, z, y - R) + R;
        if (y < g) {
          // land on it: a collision stops cloth, it never springs it upward
          y = g;
          prev[i + 1] = g;
          // and cloth grips what it lands on
          pos[i] = prev[i] + (pos[i] - prev[i]) * 0.45;
          pos[i + 2] = prev[i + 2] + (pos[i + 2] - prev[i + 2]) * 0.45;
        }
        if (y > ceil) y = ceil;
        pos[i + 1] = y;
        if (pos[i] < -fx) pos[i] = -fx; else if (pos[i] > fx) pos[i] = fx;
        if (pos[i + 2] < -fz) pos[i + 2] = -fz; else if (pos[i + 2] > fz) pos[i + 2] = fz;
      }
      // new velocities (capped, so nothing is ever flung by a correction)
      const ih = 1 / h, vmax = 26, vmax2 = vmax * vmax;
      for (let k = 0; k < n; k++) {
        const i = k * 3;
        let vx = (pos[i] - prev[i]) * ih, vy = (pos[i + 1] - prev[i + 1]) * ih, vz = (pos[i + 2] - prev[i + 2]) * ih;
        const v2 = vx * vx + vy * vy + vz * vz;
        if (v2 > vmax2) { const s = vmax / Math.sqrt(v2); vx *= s; vy *= s; vz *= s; }
        if (!holding && vy > 9) vy = 9;
        vel[i] = vx; vel[i + 1] = vy; vel[i + 2] = vz;
      }
    }
    for (let k = 0; k < n; k++) {
      const i = k * 3;
      const v2 = vel[i] * vel[i] + vel[i + 1] * vel[i + 1] + vel[i + 2] * vel[i + 2];
      if (v2 > maxV) maxV = v2;
    }
    // asleep once it has been still for a moment
    if (!holding && maxV < 0.04) {
      if (++c.calm > 40) { c.awake = false; vel.fill(0); }
    } else c.calm = 0;
  }

  // ---------- the loop ----------

  _loop(now) {
    this.raf = requestAnimationFrame(this._loop);
    if (!this.open_) return;
    const frames = Math.min(2, Math.max(1, Math.round((now - this.last) / 16.7)));
    this.last = now;
    const d = this.drag;
    let moving = false;
    for (let f = 0; f < frames; f++) {
      if (d && d.lifted) {
        d.from.copy(d.hand);
        d.hand.y += (d.handY - d.hand.y) * 0.18;
        this._aim(d);
        d.hv.copy(d.hand).sub(d.from).multiplyScalar(60);
      }
      for (const c of this.cloths) {
        if (c.hidden || !c.awake) continue;
        this._step(c);
        this._updateHeightmap(c);
        c._dirty = true;
        moving = true;
      }
    }
    for (const c of this.cloths) {
      if (c.hidden) continue;
      if (c.awake || c._dirty) { this._updateGeometry(c); c._dirty = false; }
      if (Math.abs(c.shade - c.shadeTarget) > 0.004) {
        c.shade += (c.shadeTarget - c.shade) * 0.12;
        c.mat.color.setScalar(c.shade);
        moving = true;
      }
    }
    if (d && d.lifted) {
      const k = d.cloth.pin * 3;
      const s = this._v.set(d.cloth.pos[k], d.cloth.pos[k + 1], d.cloth.pos[k + 2]).project(this.camera);
      const rect = d.rect;
      this.hooks.onHoldMove?.(d.cloth, rect.left + (s.x + 1) / 2 * rect.width, rect.top + (1 - s.y) / 2 * rect.height - 14);
    }
    if (moving) this.coverDirty = true;
    if (this.coverDirty && now - this.coverAt > 250) {
      this.coverAt = now;
      this.coverDirty = false;
      this._computeCover();
    }
    if (moving || d || this.kick > 0) {
      this.renderer.render(this.scene, this.camera);
      if (this.kick > 0) this.kick--;
    }
  }

  // ---------- touch ----------

  _ndcAt(x, y, rect) {
    return new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
  }

  _alphaAt(look, uv) {
    const A = look.A;
    const x = clamp(Math.floor(uv.x * A), 0, A - 1), y = clamp(Math.floor((1 - uv.y) * A), 0, A - 1);
    return look.alpha[y * A + x];
  }

  _pick(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(this._ndcAt(e.clientX, e.clientY, rect), this.camera);
    const meshes = this.cloths.filter(c => !c.hidden).map(c => c.mesh);
    for (const h of this.raycaster.intersectObjects(meshes, false)) {
      const c = h.object.userData.cloth;
      if (h.uv && this._alphaAt(c.look, h.uv) > ALPHA_CUT) return { cloth: c, point: h.point, rect };
    }
    return null;
  }

  _down(e) {
    if (this.drag || !this.open_ || this.hooks.blocked?.()) return;
    const hit = this._pick(e);
    if (!hit) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
    const c = hit.cloth;
    let best = 0, bd = Infinity;
    for (let k = 0; k < c.n; k++) {
      const dx = c.pos[k * 3] - hit.point.x, dy = c.pos[k * 3 + 1] - hit.point.y, dz = c.pos[k * 3 + 2] - hit.point.z;
      const dd = dx * dx + dy * dy + dz * dz;
      if (dd < bd) { bd = dd; best = k; }
    }
    this.drag = {
      id: e.pointerId, cloth: c, k: best, rect: hit.rect,
      sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, t0: performance.now(),
      lifted: false,
      hand: new THREE.Vector3(c.pos[best * 3], c.pos[best * 3 + 1], c.pos[best * 3 + 2]),
      from: new THREE.Vector3(), hv: new THREE.Vector3(), handY: 0, trail: []
    };
    this.hooks.onTouch?.();
  }

  _move(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    d.cx = e.clientX;
    d.cy = e.clientY;
    if (!d.lifted) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 8) return;
      d.lifted = true;
      const c = d.cloth;
      const was = c.order;
      c.held = true;
      c.order = Infinity;
      c.pin = d.k;
      c.inv[d.k] = 0;
      c.wake();
      c.shadeTarget = 1;
      this._wakeAbove(c, was);
      d.handY = LIFT_H;
      d.from.copy(d.hand);
      this.hooks.onLift?.(c);
    }
    const now = performance.now();
    d.trail.push({ x: d.hand.x, y: d.hand.y, z: d.hand.z, t: now });
    while (d.trail.length > 2 && now - d.trail[0].t > 110) d.trail.shift();
    this.hooks.onTouch?.();
  }

  /** Put the hand under the finger, at the height it's holding the piece. */
  _aim(d) {
    this.raycaster.setFromCamera(this._ndcAt(d.cx, d.cy, d.rect), this.camera);
    this._plane.constant = -d.hand.y;
    const at = this._v;
    if (this.raycaster.ray.intersectPlane(this._plane, at)) {
      d.hand.x = clamp(at.x, -this.VW / 2 + 0.3, this.VW / 2 - 0.3);
      d.hand.z = clamp(at.z, -this.VH / 2 + 0.3, this.VH / 2 - 0.3);
    }
  }

  _up(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    this.hooks.onTouch?.();
    const c = d.cloth;
    if (!d.lifted) {
      if (e.type === 'pointerup' && performance.now() - d.t0 < 450) this.hooks.onTap?.(c);
      return;
    }
    c.held = false;
    c.inv[c.pin] = 1;
    c.pin = -1;
    c.order = ++this.topOrder;
    // fling: the whole garment goes with your hand, arcing up a little
    let vx = 0, vz = 0;
    if (d.trail.length >= 2) {
      const a = d.trail[0], b = d.trail[d.trail.length - 1];
      const span = Math.max(0.016, (b.t - a.t) / 1000);
      vx = (b.x - a.x) / span;
      vz = (b.z - a.z) / span;
    }
    let speed = Math.hypot(vx, vz);
    if (speed > 22) { vx *= 22 / speed; vz *= 22 / speed; speed = 22; }
    if (speed > 2.5) {
      for (let k = 0; k < c.n; k++) {
        const i = k * 3;
        c.vel[i] = c.vel[i] * 0.4 + vx * 0.75;
        c.vel[i + 1] = c.vel[i + 1] * 0.4 + Math.min(6, 1.5 + speed * 0.22);
        c.vel[i + 2] = c.vel[i + 2] * 0.4 + vz * 0.75;
      }
    }
    c.wake();
    this.hooks.onRelease?.(c, speed);
    this.kick = Math.max(this.kick, 40);
  }

  // ---------- what the app can do to the pile ----------

  /** Where a piece is on screen, for animating it out of the pile. */
  screenInfo(c) {
    const r = this.canvas.getBoundingClientRect();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let k = 0; k < c.n; k += 2) {
      const s = this._v.set(c.pos[k * 3], c.pos[k * 3 + 1], c.pos[k * 3 + 2]).project(this.camera);
      const x = r.left + (s.x + 1) / 2 * r.width, y = r.top + (1 - s.y) / 2 * r.height;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, longest: Math.max(maxX - minX, maxY - minY), angle: 0 };
  }

  hide(c) {
    c.hidden = true;
    c.mesh.visible = false;
    this._wakeAbove(c, c.order);
    this.kick = Math.max(this.kick, 4);
    this.coverDirty = true;
  }

  /** Toss a piece back in: it drops into the bag from above the mouth. */
  dropBack(c, i = 0) {
    c.hidden = false;
    c.held = false;
    c.mesh.visible = true;
    c.inv.fill(1);
    c.pin = -1;
    c.place(gauss() * this.BX * 0.12, WALL_H + 1.2 + i * 0.5, gauss() * this.BZ * 0.1, rand(0, Math.PI * 2), 1);
    c.addVelocity(0, -3, 0);
    c.order = ++this.topOrder;
    this._updateHeightmap(c);
    this.kick = Math.max(this.kick, 60);
    this.coverDirty = true;
  }

  /** Gather everything off the floor and tip it back into the bag. */
  refill() {
    let i = 0;
    for (const c of this.cloths) {
      if (c.hidden || this.inBag(c)) continue;
      this.dropBack(c, i++);
    }
    this.kick = Math.max(this.kick, 90);
    return i;
  }

  add(look) {
    const c = this._makeCloth(look);
    c.place(gauss() * this.BX * 0.12, WALL_H + 1.2, gauss() * this.BZ * 0.1, rand(0, Math.PI * 2), 1);
    c.order = ++this.topOrder;
    this.kick = Math.max(this.kick, 60);
    this.coverDirty = true;
    return c;
  }

  remove(c) {
    this._wakeAbove(c, c.order);
    this._disposeCloth(c);
    this.cloths.splice(this.cloths.indexOf(c), 1);
    this.kick = Math.max(this.kick, 4);
    this.coverDirty = true;
  }

  /** Shake the bag: everything inside jumps and lands in a new order. */
  shake() {
    const inside = this.cloths.filter(c => !c.hidden && !c.held && this.inBag(c));
    const orders = inside.map(c => c.order).sort((a, b) => a - b);
    for (let i = orders.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [orders[i], orders[j]] = [orders[j], orders[i]]; }
    inside.forEach((c, i) => {
      c.order = orders[i];
      for (let k = 0; k < c.n; k++) {
        const t = k * 3;
        c.vel[t] += rand(-0.6, 0.6);
        c.vel[t + 2] += rand(-0.6, 0.6);
      }
      c.addVelocity(rand(-1.5, 1.5), rand(6, 9), rand(-2, 2));
    });
    this.kick = Math.max(this.kick, 60);
  }

  /** A little rustle from under the pile. */
  twitch(c) {
    if (!c || c.hidden) return;
    const k0 = Math.floor(Math.random() * c.n);
    const x0 = c.pos[k0 * 3], z0 = c.pos[k0 * 3 + 2];
    for (let k = 0; k < c.n; k++) {
      const dd = Math.hypot(c.pos[k * 3] - x0, c.pos[k * 3 + 2] - z0);
      if (dd < 0.8) c.vel[k * 3 + 1] += 3.2 * (1 - dd / 0.8);
    }
    c.wake();
    this._wakeAbove(c, c.order);
    this.kick = Math.max(this.kick, 30);
  }

  /** How hidden each piece is (0 = in plain sight, 1 = under other things). */
  _computeCover() {
    const gx0 = this.gx0, gz0 = this.gz0;
    for (const c of this.cloths) {
      if (c.hidden) continue;
      let covered = 0;
      for (const k of c.samples) {
        const x = c.pos[k * 3], y = c.pos[k * 3 + 1] + R * 2.5, z = c.pos[k * 3 + 2];
        const gx = Math.floor((x - gx0) / CS), gz = Math.floor((z - gz0) / CS);
        for (const q of this.cloths) {
          if (q === c || q.hidden || q.held || q.order <= c.order) continue;
          const lx = gx - q.gx0, lz = gz - q.gz0;
          if (lx < 0 || lz < 0 || lx >= q.gw || lz >= q.gh) continue;
          if (q.hm[lz * q.gw + lx] > y) { covered++; break; }
        }
      }
      c.cover = c.samples.length ? covered / c.samples.length : 0;
      // deep in the bag is darker; out on the floor is in full light
      let avgY = 0;
      for (const k of c.samples) avgY += c.pos[k * 3 + 1];
      avgY /= Math.max(1, c.samples.length);
      const depth = this.inBag(c) ? 0.8 + 0.2 * clamp(avgY / 1.0, 0, 1) : 1;
      c.shadeTarget = c.held ? 1 : depth * (1 - 0.45 * c.cover);
    }
    const target = this.targetId && this.find(this.targetId);
    if (target && !target.hidden) this.hooks.onCover?.(target.cover, target, this.inBag(target));
    const inside = this.inBagCount, out = this.count - inside;
    const key = inside + '/' + out;
    if (key !== this.counts) {
      this.counts = key;
      this.hooks.onCount?.(inside, out);
    }
  }
}
