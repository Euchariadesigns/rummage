/* The bag on the floor: a real-physics pile you look down into.
   Pull a piece up out of the bag, look at it, fling it out onto the floor, dig deeper.
   three.js draws it, Rapier moves it. Pieces are thin cloth-like slabs shaped from their
   photo's cutout, so they stack, slide, tumble and fall. */
import * as THREE from 'three';
import RAPIER from 'rapier';

const GRAVITY = -30;
const THICK = 0.16;          // how thick a piece of cloth is, in world units
const WALL_H = 3.4;          // height of the bag's sides
const WALL_T = 0.22;         // thickness of the bag's sides
const LIFT_H = WALL_H + 1.9; // where a picked-up piece is held: up out of the bag, toward you
const FOV = 38;
const ALPHA_CUT = 115;       // 0–255: below this a pixel is "not cloth"
const HOLD_K = 220;          // spring from your fingertip to the piece
const HOLD_C = 20;           // damping on that spring
const STEP = 1 / 60;
const BAG_W = 4.2;           // bag width; its length follows the screen
const SIDE = 2.0;            // floor showing beside the bag, left and right
const ENDS = 2.6;            // floor showing above and below the bag

let ready = null;
export function prepare() {
  return ready || (ready = RAPIER.init());
}

const rand = (a, b) => a + Math.random() * (b - a);
const gauss = () => {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function weaveCanvas(bag) {
  const bands = bag.weave;
  const period = bands.reduce((s, [, h]) => s + h, 0);
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = period * 2;
  const g = c.getContext('2d');
  let y = 0;
  for (const [color, h] of bands) {
    g.fillStyle = color;
    g.fillRect(0, y * 2, c.width, h * 2);
    y += h;
  }
  g.fillStyle = 'rgba(255,255,255,0.32)';
  for (let yy = 0; yy < c.height; yy += 4) {
    for (let xx = (yy / 4) % 2 ? 2 : 0; xx < c.width; xx += 5) g.fillRect(xx, yy, 2, 1.5);
  }
  return c;
}

function texture(canvas, renderer, repeatX, repeatY) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  t.repeat.set(repeatX, repeatY);
  return t;
}

/** The room floor around the bag: soft plaster with a little grain, tinted to the page. */
function floorCanvas(tint) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = tint;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 30 + Math.random() * 70;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const dark = Math.random() < 0.5;
    grd.addColorStop(0, dark ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.05)');
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
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 80);
    this.camera.up.set(0, 0, -1);
    this.raycaster = new THREE.Raycaster();

    const hemi = new THREE.HemisphereLight(0xffffff, 0x3a3a44, 1.3);
    const sun = new THREE.DirectionalLight(0xfff4e6, 2.2);
    sun.position.set(-6, 24, -9); // a window up and to the left
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    this.sun = sun;
    this.scene.add(hemi, sun, sun.target);

    this.pieces = [];
    this.world = null;
    this.bagMeshes = [];
    this.drag = null;
    this.acc = 0;
    this.last = 0;
    this.raf = 0;
    this.kick = 0;
    this.coverAt = 0;
    this.coverDirty = true;
    this.targetId = null;
    this.counts = '';
    this._loop = this._loop.bind(this);

    this._tmpV = new THREE.Vector3();
    this._tmpQ = new THREE.Quaternion();
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
    await prepare();
    this.close();
    this.bag = bag;
    const w = this.canvas.clientWidth || 360, h = this.canvas.clientHeight || 640;
    const aspect = w / h;
    // the visible floor; the bag sits in the middle of it
    this.VW = BAG_W + SIDE * 2;
    this.VH = this.VW / aspect;
    this.BX = BAG_W;
    this.BZ = clamp(this.VH - ENDS * 2, 4.6, 12);

    this.scene.background = new THREE.Color(floorTint);
    this._buildBag(bag, floorTint);

    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    this.world.timestep = STEP;
    this._buildWalls();
    this.resize();

    looks.forEach((look, i) => {
      const saved = snapshot && snapshot[look.item.id];
      this._addPiece(look, saved || this._spawnSpot(i, looks.length));
    });
    this.kick = 90;
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
    for (const p of this.pieces) this._disposePiece(p);
    this.pieces = [];
    for (const m of this.bagMeshes) {
      this.scene.remove(m);
      m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) { if (mat.map) mat.map.dispose(); mat.dispose(); }
    }
    this.bagMeshes = [];
    if (this.world) { this.world.free(); this.world = null; }
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    if (this.VW) {
      // fit the floor around the bag to the screen; the bag's mouth is closer, so it looks bigger
      const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
      const d = Math.max((this.VH / 2) / t, (this.VW / 2) / (t * this.camera.aspect));
      this.camY = d;
      this.camera.position.set(0, d, 0);
      this.camera.lookAt(0, 0, 0);
      this.camera.far = d + 10;
    }
    this.camera.updateProjectionMatrix();
    this.kick = Math.max(this.kick, 2);
  }

  snapshot() {
    const out = {};
    for (const p of this.pieces) {
      if (p.hidden) continue;
      const t = p.body.translation(), r = p.body.rotation();
      out[p.item.id] = { t: { x: t.x, y: t.y, z: t.z }, r: { x: r.x, y: r.y, z: r.z, w: r.w }, asleep: true };
    }
    return out;
  }

  get count() {
    return this.pieces.filter(p => !p.hidden).length;
  }

  /** Is this piece still in the bag (rather than out on the floor)? */
  inBag(p) {
    const t = p.body.translation();
    return Math.abs(t.x) < this.BX / 2 && Math.abs(t.z) < this.BZ / 2;
  }

  get inBagCount() {
    return this.pieces.filter(p => !p.hidden && this.inBag(p)).length;
  }

  find(id) {
    return this.pieces.find(p => p.item.id === id) || null;
  }

  // ---------- building ----------

  _buildBag(bag, floorTint) {
    const { BX, BZ, VW, VH } = this;
    const add = m => { this.scene.add(m); this.bagMeshes.push(m); return m; };
    const weave = weaveCanvas(bag);

    // room floor
    const floor = add(new THREE.Mesh(
      new THREE.PlaneGeometry(VW + 8, VH + 8).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: texture(floorCanvas(floorTint), this.renderer, (VW + 8) / 6, (VH + 8) / 6), roughness: 1 })
    ));
    floor.receiveShadow = true;

    // bottom of the bag: plain lining with a faint weave
    const fc = document.createElement('canvas');
    fc.width = fc.height = 64;
    const fg = fc.getContext('2d');
    fg.fillStyle = '#' + new THREE.Color(bag.interior).multiplyScalar(1.5).getHexString();
    fg.fillRect(0, 0, 64, 64);
    fg.fillStyle = 'rgba(255,255,255,0.06)';
    for (let yy = 0; yy < 64; yy += 4) for (let xx = (yy / 4) % 2 ? 2 : 0; xx < 64; xx += 5) fg.fillRect(xx, yy, 2, 1.5);
    const lining = add(new THREE.Mesh(
      new THREE.PlaneGeometry(BX, BZ).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: texture(fc, this.renderer, BX / 0.5, BZ / 0.5), roughness: 1 })
    ));
    lining.position.y = 0.02;
    lining.receiveShadow = true;

    // the sides: woven, darker toward the bottom inside
    const side = (len, rotY, x, z) => {
      const geo = new THREE.BoxGeometry(len + WALL_T * 2, WALL_H, WALL_T, 1, 1, 1);
      const pos = geo.attributes.position, colors = [];
      for (let i = 0; i < pos.count; i++) {
        const k = 0.34 + 0.66 * ((pos.getY(i) + WALL_H / 2) / WALL_H);
        colors.push(k, k, k);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const mesh = add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        map: texture(weave, this.renderer, (len + WALL_T * 2) / 1.1, WALL_H / 1.7), vertexColors: true, roughness: 1
      })));
      mesh.rotation.y = rotY;
      mesh.position.set(x, WALL_H / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    };
    side(BZ, Math.PI / 2, -BX / 2 - WALL_T / 2, 0);
    side(BZ, Math.PI / 2, BX / 2 + WALL_T / 2, 0);
    side(BX, 0, 0, -BZ / 2 - WALL_T / 2);
    side(BX, 0, 0, BZ / 2 + WALL_T / 2);

    // the mouth: an open zip running round the top edge
    const zc = document.createElement('canvas');
    zc.width = 64; zc.height = 16;
    const zg = zc.getContext('2d');
    zg.fillStyle = '#1d1d21';
    zg.fillRect(0, 0, 64, 16);
    zg.fillStyle = '#b9b4aa';
    for (let x = 0; x < 64; x += 4) { zg.fillRect(x, 5, 2, 3); zg.fillRect(x + 2, 8, 2, 3); }
    const zipMat = (len, alongX) => new THREE.MeshStandardMaterial({
      map: (() => {
        if (alongX) return texture(zc, this.renderer, len / 0.35, 1);
        const t = texture(zc, this.renderer, 1, len / 0.35);
        t.center.set(0.5, 0.5);
        t.rotation = Math.PI / 2;
        return t;
      })(),
      roughness: 0.6, metalness: 0.2
    });
    const rim = (lx, lz, x, z) => {
      const alongX = lx > lz;
      const m = add(new THREE.Mesh(new THREE.BoxGeometry(lx, 0.08, lz), zipMat(Math.max(lx, lz), alongX)));
      m.position.set(x, WALL_H + 0.04, z);
      m.castShadow = true;
    };
    rim(WALL_T + 0.02, BZ + WALL_T * 2, -BX / 2 - WALL_T / 2, 0);
    rim(WALL_T + 0.02, BZ + WALL_T * 2, BX / 2 + WALL_T / 2, 0);
    rim(BX + WALL_T * 2, WALL_T + 0.02, 0, -BZ / 2 - WALL_T / 2);
    rim(BX + WALL_T * 2, WALL_T + 0.02, 0, BZ / 2 + WALL_T / 2);

    // handles, flopped over the sides onto the floor
    const strapMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(bag.thread), roughness: 0.85 });
    for (const s of [-1, 1]) {
      const strap = add(new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.075, 8, 28, Math.PI), strapMat));
      strap.rotation.set(-Math.PI / 2, 0, s < 0 ? Math.PI / 2 : -Math.PI / 2);
      strap.scale.set(1, 1.35, 1);
      strap.position.set(s * (BX / 2 + WALL_T), 0.08, 0);
      strap.castShadow = true;
    }

    const sc = this.sun.shadow.camera;
    sc.left = -VW / 2 - 2; sc.right = VW / 2 + 2;
    sc.top = VH / 2 + 2; sc.bottom = -VH / 2 - 2;
    sc.near = 5; sc.far = 50;
    sc.updateProjectionMatrix();
  }

  _buildWalls() {
    const { BX, BZ, VW, VH } = this;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const box = (hx, hy, hz, x, y, z, friction = 0.9) => this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(friction), body);
    // floor of the room (the bag's bottom is the same floor)
    box(VW, 0.5, VH, 0, -0.5, 0);
    // the bag's four sides: solid from both faces, open at the top
    box(WALL_T / 2, WALL_H / 2, BZ / 2 + WALL_T, -BX / 2 - WALL_T / 2, WALL_H / 2, 0, 0.6);
    box(WALL_T / 2, WALL_H / 2, BZ / 2 + WALL_T, BX / 2 + WALL_T / 2, WALL_H / 2, 0, 0.6);
    box(BX / 2 + WALL_T, WALL_H / 2, WALL_T / 2, 0, WALL_H / 2, -BZ / 2 - WALL_T / 2, 0.6);
    box(BX / 2 + WALL_T, WALL_H / 2, WALL_T / 2, 0, WALL_H / 2, BZ / 2 + WALL_T / 2, 0.6);
    // the edges of the room, just past the screen, so nothing is lost
    const fx = VW / 2 + 0.2, fz = VH / 2 + 0.2;
    box(0.5, 10, fz + 1, -fx - 0.5, 10, 0);
    box(0.5, 10, fz + 1, fx + 0.5, 10, 0);
    box(fx + 1, 10, 0.5, 0, 10, -fz - 0.5);
    box(fx + 1, 10, 0.5, 0, 10, fz + 0.5);
    box(fx + 1, 0.5, fz + 1, 0, LIFT_H + 5, 0); // nothing flies into your face
  }

  _spawnSpot(i) {
    const yaw = rand(0, Math.PI * 2);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(-0.15, 0.15), yaw, rand(-0.15, 0.15)));
    return {
      t: {
        x: clamp(gauss() * this.BX * 0.14, -this.BX * 0.28, this.BX * 0.28),
        y: 0.8 + i * 0.5,
        z: clamp(gauss() * this.BZ * 0.13, -this.BZ * 0.3, this.BZ * 0.3)
      },
      r: { x: q.x, y: q.y, z: q.z, w: q.w },
      v: { x: 0, y: -2, z: 0 },
      spin: true
    };
  }

  _dropSpot(i = 0) {
    const yaw = rand(0, Math.PI * 2);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(-0.5, 0.5), yaw, rand(-0.5, 0.5)));
    return {
      t: { x: gauss() * this.BX * 0.12, y: WALL_H + 1.4 + i * 0.6, z: gauss() * this.BZ * 0.1 },
      r: { x: q.x, y: q.y, z: q.z, w: q.w },
      v: { x: 0, y: -6, z: 0 },
      spin: true
    };
  }

  _addPiece(look, at) {
    // size: every piece covers about the same amount of cloth, whatever the photo's framing
    const ratio = look.w / look.h;
    const rectArea = 5.4 / look.opaqueFrac;
    let uh = Math.sqrt(rectArea / ratio), uw = uh * ratio;
    const maxSide = Math.min(3.2, this.BX * 0.74);
    const k = Math.min(1, maxSide / Math.max(uw, uh));
    uw *= k; uh *= k;

    if (!look.texture) {
      const tex = new THREE.Texture(look.image);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      tex.needsUpdate = true;
      look.texture = tex;
    }
    const mat = new THREE.MeshStandardMaterial({
      map: look.texture, alphaTest: ALPHA_CUT / 255, alphaToCoverage: true,
      side: THREE.DoubleSide, roughness: 0.9, metalness: 0
    });
    mat.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        '#include <map_fragment>\n  if (!gl_FrontFacing) diffuseColor.rgb *= 0.68;');
    };
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(uw, uh).rotateX(-Math.PI / 2), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking, map: look.texture, alphaTest: ALPHA_CUT / 255, side: THREE.DoubleSide
    });
    this.scene.add(mesh);

    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(at.t.x, at.t.y, at.t.z)
      .setRotation(at.r)
      .setLinearDamping(0.35)
      .setAngularDamping(1.5)
      .setCcdEnabled(true);
    const body = this.world.createRigidBody(desc);

    // collision shape follows the cutout: a 6×6 grid, solid cells merged into strips
    const G = 6, cw = uw / G, ch = uh / G;
    let made = 0;
    for (let row = 0; row < G; row++) {
      let start = -1;
      for (let col = 0; col <= G; col++) {
        const solid = col < G && this._cellSolid(look, col, row, G);
        if (solid && start < 0) start = col;
        if (!solid && start >= 0) {
          const run = col - start;
          this.world.createCollider(
            RAPIER.ColliderDesc.cuboid(run * cw / 2 * 0.95, THICK / 2, ch / 2 * 0.95)
              .setTranslation(-uw / 2 + (start + run / 2) * cw, 0, -uh / 2 + (row + 0.5) * ch)
              .setFriction(0.95).setRestitution(0).setDensity(1),
            body);
          made++;
          start = -1;
        }
      }
    }
    if (!made) {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(uw * 0.35, THICK / 2, uh * 0.35).setFriction(0.95), body);
    }
    if (at.v) body.setLinvel(at.v, true);
    if (at.spin) body.setAngvel({ x: rand(-1.5, 1.5), y: rand(-1, 1), z: rand(-1.5, 1.5) }, true);
    if (at.asleep) body.sleep();

    // points on the cloth used to measure how buried it is
    const samples = [];
    const A = look.A;
    for (let y = 2; y < A; y += 7) {
      for (let x = 2; x < A; x += 7) {
        if (look.alpha[y * A + x] > 160) samples.push(new THREE.Vector3((x / A - 0.5) * uw, 0, (y / A - 0.5) * uh));
      }
    }

    const piece = { look, item: look.item, mesh, mat, body, uw, uh, samples, cover: 0, shade: 1, shadeTarget: 1, hidden: false, tilted: 0 };
    mesh.userData.piece = piece;
    this._sync(piece);
    this.pieces.push(piece);
    return piece;
  }

  _cellSolid(look, col, row, G) {
    const A = look.A, x0 = Math.floor(col * A / G), x1 = Math.floor((col + 1) * A / G);
    const y0 = Math.floor(row * A / G), y1 = Math.floor((row + 1) * A / G);
    let n = 0, on = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { n++; if (look.alpha[y * A + x] > ALPHA_CUT) on++; }
    return on / n > 0.42;
  }

  _disposePiece(p) {
    this.scene.remove(p.mesh);
    p.mesh.geometry.dispose();
    p.mat.dispose();
    p.mesh.customDepthMaterial.dispose();
    if (this.world) this.world.removeRigidBody(p.body);
  }

  _sync(p) {
    const t = p.body.translation(), r = p.body.rotation();
    p.mesh.position.set(t.x, t.y, t.z);
    p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }

  // ---------- the loop ----------

  _loop(now) {
    this.raf = requestAnimationFrame(this._loop);
    if (!this.world) return;
    const dt = Math.min(0.05, (now - this.last) / 1000 || STEP);
    this.last = now;

    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 4) {
      this._hold();
      this._flop();
      this.world.step();
      this.acc -= STEP;
      steps++;
    }
    if (steps === 4) this.acc = 0;

    let moving = false;
    for (const p of this.pieces) {
      if (p.hidden) continue;
      if (!p.body.isSleeping()) { moving = true; this._sync(p); }
      if (Math.abs(p.shade - p.shadeTarget) > 0.004) {
        p.shade += (p.shadeTarget - p.shade) * Math.min(1, dt * 7);
        p.mat.color.setScalar(p.shade);
        moving = true;
      }
    }
    const d = this.drag;
    if (d && d.lifted) {
      const info = this.screenInfo(d.piece);
      this.hooks.onHoldMove?.(d.piece, info.x, info.y - info.longest * 0.42);
    }
    if (moving) this.coverDirty = true;
    if (this.coverDirty && now - this.coverAt > 280) {
      this.coverAt = now;
      this.coverDirty = false;
      this._computeCover();
    }
    if (moving || d || this.kick > 0) {
      this.renderer.render(this.scene, this.camera);
      if (this.kick > 0) this.kick--;
    }
  }

  /** Cloth can't stand on its edge: a slow piece that ends up on its side flops flat. */
  _flop() {
    const held = this.drag && this.drag.lifted ? this.drag.piece : null;
    for (const p of this.pieces) {
      if (p.hidden || p === held) continue;
      const r = p.body.rotation();
      this._tmpQ.set(r.x, r.y, r.z, r.w);
      const up = this._tmpV.set(0, 1, 0).applyQuaternion(this._tmpQ);
      if (Math.abs(up.y) > 0.88) { p.tilted = 0; continue; }
      // a piece that dozed off while leaning on its edge gets woken to flop down,
      // but one wedged for good (about 4 s of trying) is left to rest
      p.tilted++;
      if (p.tilted > 240) continue;
      if (p.body.isSleeping()) p.body.wakeUp();
      const lv = p.body.linvel();
      if (Math.hypot(lv.x, lv.y, lv.z) > 3.5) continue; // still flying: let it tumble
      const s = up.y >= 0 ? 1 : -1; // fall to whichever face is nearer
      const m = p.body.mass() || 0.5;
      const k = 16 * m * STEP;
      p.body.applyTorqueImpulse({ x: -up.z * s * k, y: 0, z: up.x * s * k }, true);
    }
  }

  /** Pull the held piece toward your fingertip from the exact spot you pinched it. */
  _hold() {
    const d = this.drag;
    if (!d || !d.lifted) return;
    d.hand.y += (d.handY - d.hand.y) * 0.16;
    this._aim(d);
    const b = d.piece.body;
    const m = b.mass() || 0.5;
    const t = b.translation(), r = b.rotation();
    this._tmpQ.set(r.x, r.y, r.z, r.w);
    const p = this._tmpV.copy(d.local).applyQuaternion(this._tmpQ).add(t);
    const lv = b.linvel(), av = b.angvel();
    const rx = p.x - t.x, ry = p.y - t.y, rz = p.z - t.z;
    const vpx = lv.x + (av.y * rz - av.z * ry);
    const vpy = lv.y + (av.z * rx - av.x * rz);
    const vpz = lv.z + (av.x * ry - av.y * rx);
    let fx = ((d.hand.x - p.x) * HOLD_K - vpx * HOLD_C) * m;
    let fy = ((d.hand.y - p.y) * HOLD_K - vpy * HOLD_C) * m;
    let fz = ((d.hand.z - p.z) * HOLD_K - vpz * HOLD_C) * m;
    const f = Math.hypot(fx, fy, fz), cap = 420 * m;
    if (f > cap) { fx *= cap / f; fy *= cap / f; fz *= cap / f; }
    b.resetForces(true);
    b.resetTorques(true);
    b.addForceAtPoint({ x: fx, y: fy, z: fz }, { x: p.x, y: p.y, z: p.z }, true);
  }

  // ---------- touch ----------

  _ndc(e) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  _alphaAt(look, uv) {
    const A = look.A;
    const x = clamp(Math.floor(uv.x * A), 0, A - 1), y = clamp(Math.floor((1 - uv.y) * A), 0, A - 1);
    return look.alpha[y * A + x];
  }

  _firstCloth(hits) {
    for (const h of hits) {
      const p = h.object.userData.piece;
      if (p && !p.hidden && this._alphaAt(p.look, h.uv) > ALPHA_CUT) return { piece: p, point: h.point, distance: h.distance };
    }
    return null;
  }

  _meshes() {
    return this.pieces.filter(p => !p.hidden).map(p => p.mesh);
  }

  _down(e) {
    if (this.drag || !this.world || this.hooks.blocked?.()) return;
    this.raycaster.setFromCamera(this._ndc(e), this.camera);
    const hit = this._firstCloth(this.raycaster.intersectObjects(this._meshes(), false));
    if (!hit) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
    const b = hit.piece.body, t = b.translation(), r = b.rotation();
    const local = hit.point.clone().sub(new THREE.Vector3(t.x, t.y, t.z))
      .applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w).invert());
    this.drag = {
      id: e.pointerId, piece: hit.piece, local, rect: this.canvas.getBoundingClientRect(),
      sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, t0: performance.now(),
      lifted: false, hand: hit.point.clone(), handY: hit.point.y, trail: []
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
      d.piece.body.wakeUp();
      d.piece.body.setAngularDamping(3.5);
      d.piece.tilted = 0;
      // pull it up out of the bag, toward you, so you can see what it is
      d.handY = LIFT_H;
      d.piece.shadeTarget = 1;
      this.hooks.onLift?.(d.piece);
    }
    this._aim(d);
    const now = performance.now();
    d.trail.push({ x: d.hand.x, z: d.hand.z, t: now });
    while (d.trail.length > 2 && now - d.trail[0].t > 110) d.trail.shift();
    this.hooks.onTouch?.();
  }

  /** Put the hand under the finger, at the height it's holding the piece. */
  _aim(d) {
    const r = d.rect;
    const ndc = new THREE.Vector2(((d.cx - r.left) / r.width) * 2 - 1, -((d.cy - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    this._plane.constant = -d.hand.y;
    const at = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this._plane, at)) {
      d.hand.x = clamp(at.x, -this.VW / 2 + 0.4, this.VW / 2 - 0.4);
      d.hand.z = clamp(at.z, -this.VH / 2 + 0.4, this.VH / 2 - 0.4);
    }
  }

  _up(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    const b = d.piece.body;
    b.resetForces(true);
    b.resetTorques(true);
    b.setAngularDamping(1.5);
    this.hooks.onTouch?.();

    if (!d.lifted) {
      if (e.type === 'pointerup' && performance.now() - d.t0 < 450) this.hooks.onTap?.(d.piece);
      return;
    }
    // throw: keep the hand's speed, arc up a little, tumble
    let vx = 0, vz = 0;
    if (d.trail.length >= 2) {
      const a = d.trail[0], z = d.trail[d.trail.length - 1];
      const span = Math.max(0.016, (z.t - a.t) / 1000);
      vx = (z.x - a.x) / span;
      vz = (z.z - a.z) / span;
    }
    const speed = Math.hypot(vx, vz);
    if (speed > 2.5) {
      const lv = b.linvel();
      const s = Math.min(1, 20 / speed);
      b.setLinvel({ x: lv.x * 0.25 + vx * s * 0.95, y: lv.y * 0.3 + Math.min(7, 2 + speed * 0.3), z: lv.z * 0.25 + vz * s * 0.95 }, true);
      const spin = Math.min(12, speed * 0.8);
      b.setAngvel({ x: vz / (speed || 1) * spin + rand(-1, 1), y: rand(-2.5, 2.5), z: -vx / (speed || 1) * spin + rand(-1, 1) }, true);
    }
    this.hooks.onRelease?.(d.piece, speed);
    this.kick = Math.max(this.kick, 40);
  }

  // ---------- what the app can do to the pile ----------

  /** Where a piece is on screen, for animating it out of the pile. */
  screenInfo(p) {
    const r = this.canvas.getBoundingClientRect();
    p.mesh.updateMatrixWorld();
    const toScreen = v => {
      const s = v.clone().applyMatrix4(p.mesh.matrixWorld).project(this.camera);
      return { x: r.left + (s.x + 1) / 2 * r.width, y: r.top + (1 - s.y) / 2 * r.height };
    };
    const c = toScreen(new THREE.Vector3(0, 0, 0));
    const a = toScreen(new THREE.Vector3(-p.uw / 2, 0, 0)), b = toScreen(new THREE.Vector3(p.uw / 2, 0, 0));
    const widthPx = Math.hypot(b.x - a.x, b.y - a.y);
    return {
      x: c.x, y: c.y,
      longest: widthPx * Math.max(p.uw, p.uh) / p.uw,
      angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI
    };
  }

  hide(p) {
    p.hidden = true;
    p.mesh.visible = false;
    p.body.setEnabled(false);
    this.kick = Math.max(this.kick, 4);
    this.coverDirty = true;
  }

  /** Toss a piece back in: it drops into the bag from just above the mouth. */
  dropBack(p, i = 0) {
    const at = this._dropSpot(i);
    p.body.setEnabled(true);
    p.body.setTranslation(at.t, true);
    p.body.setRotation(at.r, true);
    p.body.setLinvel(at.v, true);
    p.body.setAngvel({ x: rand(-2, 2), y: rand(-1, 1), z: rand(-2, 2) }, true);
    p.hidden = false;
    p.tilted = 0;
    p.mesh.visible = true;
    this._sync(p);
    this.kick = Math.max(this.kick, 60);
    this.coverDirty = true;
  }

  /** Gather everything off the floor and tip it back into the bag. */
  refill() {
    let i = 0;
    for (const p of this.pieces) {
      if (p.hidden || this.inBag(p)) continue;
      this.dropBack(p, i++);
    }
    this.kick = Math.max(this.kick, 90);
    return i;
  }

  add(look) {
    const p = this._addPiece(look, this._dropSpot());
    this.kick = Math.max(this.kick, 60);
    this.coverDirty = true;
    return p;
  }

  remove(p) {
    this._disposePiece(p);
    this.pieces.splice(this.pieces.indexOf(p), 1);
    this.kick = Math.max(this.kick, 4);
    this.coverDirty = true;
  }

  /** Shake the bag: everything inside jumps and lands in a new order. */
  shake() {
    for (const p of this.pieces) {
      if (p.hidden || !this.inBag(p)) continue;
      const m = p.body.mass() || 0.5;
      p.body.wakeUp();
      p.tilted = 0;
      p.body.applyImpulse({ x: rand(-2.2, 2.2) * m, y: rand(7, 11) * m, z: rand(-3, 3) * m }, true);
      p.body.applyTorqueImpulse({ x: rand(-1, 1) * m * 3, y: rand(-1, 1) * m * 1.5, z: rand(-1, 1) * m * 3 }, true);
    }
    this.kick = Math.max(this.kick, 60);
  }

  /** A little rustle from under the pile. */
  twitch(p) {
    if (!p || p.hidden || !p.samples.length) return;
    const m = p.body.mass() || 0.5;
    const s = p.samples[Math.floor(Math.random() * p.samples.length)];
    p.mesh.updateMatrixWorld();
    const w = s.clone().applyMatrix4(p.mesh.matrixWorld);
    p.body.wakeUp();
    p.body.applyImpulseAtPoint({ x: rand(-0.6, 0.6) * m, y: 3.2 * m, z: rand(-0.6, 0.6) * m }, { x: w.x, y: w.y, z: w.z }, true);
    this.kick = Math.max(this.kick, 30);
  }

  /** How hidden each piece is (0 = in plain sight, 1 = completely under other things). */
  _computeCover() {
    const meshes = this._meshes();
    if (!meshes.length) { this._reportCounts(); return; }
    this.scene.updateMatrixWorld();
    const cam = this.camera.position;
    const dir = new THREE.Vector3();
    for (const p of this.pieces) {
      if (p.hidden) continue;
      let seen = 0, n = 0;
      for (const s of p.samples) {
        const w = s.clone().applyMatrix4(p.mesh.matrixWorld);
        dir.copy(w).sub(cam);
        const dist = dir.length();
        dir.divideScalar(dist);
        this.raycaster.set(cam, dir);
        this.raycaster.far = dist + 0.05;
        const hit = this._firstCloth(this.raycaster.intersectObjects(meshes, false));
        n++;
        if (hit && hit.piece === p) seen++;
      }
      this.raycaster.far = Infinity;
      p.cover = n ? 1 - seen / n : 0;
      const held = this.drag && this.drag.piece === p && this.drag.lifted;
      // deep in the bag is darker; out on the floor is in full light
      const y = p.body.translation().y;
      const depth = this.inBag(p) ? 0.8 + 0.2 * clamp(y / 1.4, 0, 1) : 1;
      p.shadeTarget = held ? 1 : depth * (1 - 0.5 * p.cover);
    }
    const target = this.targetId && this.find(this.targetId);
    if (target && !target.hidden) this.hooks.onCover?.(target.cover, target, this.inBag(target));
    this._reportCounts();
  }

  _reportCounts() {
    const inside = this.inBagCount, out = this.count - inside;
    const key = inside + '/' + out;
    if (key !== this.counts) {
      this.counts = key;
      this.hooks.onCount?.(inside, out);
    }
  }
}
