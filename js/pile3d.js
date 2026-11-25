/* The inside of the bag: a real-physics pile you look down into.
   three.js draws it, Rapier moves it. Pieces are thin cloth-like slabs shaped
   from their photo's cutout, so they stack, slide, tumble and fall. */
import * as THREE from 'three';
import RAPIER from 'rapier';

const GRAVITY = -30;
const THICK = 0.16;          // how thick a piece of cloth is, in world units
const WALL_H = 3.6;          // depth of the bag
const FOV = 38;
const ALPHA_CUT = 115;       // 0–255: below this a pixel is "not cloth"
const HOLD_K = 220;          // spring from your fingertip to the piece
const HOLD_C = 20;           // damping on that spring
const STEP = 1 / 60;

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

function weaveTexture(bag, renderer) {
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
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
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
    this.scene.fog = new THREE.Fog(0x000000, 10, 20);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 60);
    this.camera.up.set(0, 0, -1);
    this.raycaster = new THREE.Raycaster();

    const hemi = new THREE.HemisphereLight(0xffffff, 0x30303a, 1.35);
    const sun = new THREE.DirectionalLight(0xfff6ea, 2.1);
    sun.position.set(-3.5, 22, -6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
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

  async open(bag, looks, snapshot) {
    await prepare();
    this.close();
    this.bag = bag;
    const w = this.canvas.clientWidth || 360, h = this.canvas.clientHeight || 640;
    const aspect = w / h;
    this.BX = 4.8;
    this.BZ = clamp(this.BX / aspect, 4.8, 12);

    const interior = new THREE.Color(bag.interior);
    this.scene.background = interior;
    this.scene.fog.color.copy(interior);
    this._buildBag(bag);

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
      if (m.material.map) m.material.map.dispose();
      m.material.dispose();
    }
    this.bagMeshes = [];
    if (this.world) { this.world.free(); this.world = null; }
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    if (this.BX) {
      // fit the mouth of the bag to the screen; the floor sits deeper, so it looks smaller
      const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
      const d = Math.max((this.BZ / 2) / t, (this.BX / 2) / (t * this.camera.aspect));
      this.camY = WALL_H + d;
      this.camera.position.set(0, this.camY, 0);
      this.camera.lookAt(0, 0, 0);
      this.camera.far = this.camY + 10;
      // deeper in the bag is darker; anything lifted toward you comes out of the dark
      this.scene.fog.near = d + 2.0;
      this.scene.fog.far = d + 9.0;
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

  find(id) {
    return this.pieces.find(p => p.item.id === id) || null;
  }

  // ---------- building ----------

  _buildBag(bag) {
    const { BX, BZ } = this;
    const tex = weaveTexture(bag, this.renderer);

    const wall = (len, rotY, x, z) => {
      const geo = new THREE.PlaneGeometry(len, WALL_H, 1, 1);
      const pos = geo.attributes.position;
      const colors = [];
      for (let i = 0; i < pos.count; i++) {
        const k = 0.32 + 0.68 * ((pos.getY(i) + WALL_H / 2) / WALL_H); // darker toward the bottom
        colors.push(k, k, k);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const map = tex.clone();
      map.repeat.set(len / 1.1, WALL_H / 1.7);
      map.needsUpdate = true;
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 1 }));
      mesh.rotation.y = rotY;
      mesh.position.set(x, WALL_H / 2, z);
      mesh.receiveShadow = true;
      return mesh;
    };

    // the bottom of the bag: plain lining with a faint weave
    const fc = document.createElement('canvas');
    fc.width = fc.height = 64;
    const fg = fc.getContext('2d');
    fg.fillStyle = '#' + new THREE.Color(bag.interior).multiplyScalar(1.5).getHexString();
    fg.fillRect(0, 0, 64, 64);
    fg.fillStyle = 'rgba(255,255,255,0.06)';
    for (let yy = 0; yy < 64; yy += 4) for (let xx = (yy / 4) % 2 ? 2 : 0; xx < 64; xx += 5) fg.fillRect(xx, yy, 2, 1.5);
    const floorMap = new THREE.CanvasTexture(fc);
    floorMap.wrapS = floorMap.wrapT = THREE.RepeatWrapping;
    floorMap.colorSpace = THREE.SRGBColorSpace;
    floorMap.repeat.set(BX / 0.5, BZ / 0.5);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(BX, BZ).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: floorMap, roughness: 1 })
    );
    floor.receiveShadow = true;

    this.bagMeshes = [
      floor,
      wall(BZ, Math.PI / 2, -BX / 2, 0),
      wall(BZ, -Math.PI / 2, BX / 2, 0),
      wall(BX, 0, 0, -BZ / 2),
      wall(BX, Math.PI, 0, BZ / 2)
    ];
    for (const m of this.bagMeshes) this.scene.add(m);

    const sc = this.sun.shadow.camera;
    sc.left = -BX / 2 - 1; sc.right = BX / 2 + 1;
    sc.top = BZ / 2 + 1; sc.bottom = -BZ / 2 - 1;
    sc.near = 5; sc.far = 40;
    sc.updateProjectionMatrix();
    tex.dispose();
  }

  _buildWalls() {
    const { BX, BZ } = this;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const box = (hx, hy, hz, x, y, z) => this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.9), body);
    box(BX / 2 + 1, 0.5, BZ / 2 + 1, 0, -0.5, 0);
    box(0.5, 8, BZ / 2 + 1, -BX / 2 - 0.5, 8, 0);
    box(0.5, 8, BZ / 2 + 1, BX / 2 + 0.5, 8, 0);
    box(BX / 2 + 1, 8, 0.5, 0, 8, -BZ / 2 - 0.5);
    box(BX / 2 + 1, 8, 0.5, 0, 8, BZ / 2 + 0.5);
    box(BX / 2 + 1, 0.5, BZ / 2 + 1, 0, WALL_H + 4.5, 0); // lid, so nothing flies out at you
  }

  _spawnSpot(i, n) {
    const yaw = rand(0, Math.PI * 2);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(-0.15, 0.15), yaw, rand(-0.15, 0.15)));
    return {
      t: {
        x: clamp(gauss() * this.BX * 0.14, -this.BX * 0.3, this.BX * 0.3),
        y: 0.8 + i * 0.5,
        z: clamp(gauss() * this.BZ * 0.12, -this.BZ * 0.3, this.BZ * 0.3)
      },
      r: { x: q.x, y: q.y, z: q.z, w: q.w },
      v: { x: 0, y: -2, z: 0 },
      spin: true
    };
  }

  _dropSpot() {
    const yaw = rand(0, Math.PI * 2);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(-0.5, 0.5), yaw, rand(-0.5, 0.5)));
    return {
      t: { x: gauss() * this.BX * 0.12, y: WALL_H + 1.6, z: gauss() * this.BZ * 0.1 },
      r: { x: q.x, y: q.y, z: q.z, w: q.w },
      v: { x: 0, y: -6, z: 0 },
      spin: true
    };
  }

  _addPiece(look, at) {
    // size: every piece covers about the same amount of cloth, whatever the photo's framing
    const ratio = look.w / look.h;
    const rectArea = 5.6 / look.opaqueFrac;
    let uh = Math.sqrt(rectArea / ratio), uw = uh * ratio;
    const maxSide = Math.min(3.4, this.BX * 0.78);
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
      .setLinearDamping(0.6)
      .setAngularDamping(1.6)
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

    const piece = { look, item: look.item, mesh, mat, body, uw, uh, samples, cover: 0, shade: 1, shadeTarget: 1, hidden: false };
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
    if (moving) this.coverDirty = true;
    if (this.coverDirty && now - this.coverAt > 280) {
      this.coverAt = now;
      this.coverDirty = false;
      this._computeCover();
    }
    if (moving || this.drag || this.kick > 0) {
      this.renderer.render(this.scene, this.camera);
      if (this.kick > 0) this.kick--;
    }
  }

  /** Cloth can't stand on its edge: a slow piece that ends up on its side flops flat. */
  _flop() {
    const held = this.drag && this.drag.lifted ? this.drag.piece : null;
    for (const p of this.pieces) {
      if (p.hidden || p === held || p.body.isSleeping()) continue;
      const lv = p.body.linvel();
      if (Math.hypot(lv.x, lv.y, lv.z) > 3.5) continue; // still flying: let it tumble
      const r = p.body.rotation();
      this._tmpQ.set(r.x, r.y, r.z, r.w);
      const up = this._tmpV.set(0, 1, 0).applyQuaternion(this._tmpQ);
      if (Math.abs(up.y) > 0.88) continue;
      const s = up.y >= 0 ? 1 : -1; // fall to whichever face is nearer
      const m = p.body.mass() || 0.5;
      const k = 10 * m * STEP;
      // torque along up × (0, s, 0)
      p.body.applyTorqueImpulse({ x: -up.z * s * k, y: 0, z: up.x * s * k }, true);
    }
  }

  /** Pull the held piece toward your fingertip from the exact spot you pinched it. */
  _hold() {
    const d = this.drag;
    if (!d || !d.lifted) return;
    d.hand.y += (d.handY - d.hand.y) * 0.2;
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
      id: e.pointerId, piece: hit.piece, local,
      sx: e.clientX, sy: e.clientY, t0: performance.now(),
      lifted: false, hand: hit.point.clone(), handY: hit.point.y, trail: []
    };
    this.hooks.onTouch?.();
  }

  _move(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    if (!d.lifted) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 8) return;
      d.lifted = true;
      d.piece.body.wakeUp();
      d.piece.body.setAngularDamping(3.5);
      // lift it clear of everything else so it drags whatever was on top along with it
      let top = 0;
      for (const p of this.pieces) if (p !== d.piece && !p.hidden) top = Math.max(top, p.body.translation().y);
      d.handY = Math.min(WALL_H + 0.6, Math.max(d.hand.y + 1.3, top + 1.4));
      d.piece.shadeTarget = 1;
      this.hooks.onLift?.(d.piece);
    }
    this.raycaster.setFromCamera(this._ndc(e), this.camera);
    this._plane.constant = -d.hand.y;
    const at = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this._plane, at)) {
      d.hand.x = clamp(at.x, -this.BX / 2 + 0.3, this.BX / 2 - 0.3);
      d.hand.z = clamp(at.z, -this.BZ / 2 + 0.3, this.BZ / 2 - 0.3);
    }
    const now = performance.now();
    d.trail.push({ x: d.hand.x, z: d.hand.z, t: now });
    while (d.trail.length > 2 && now - d.trail[0].t > 110) d.trail.shift();
    this.hooks.onTouch?.();
  }

  _up(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    const b = d.piece.body;
    b.resetForces(true);
    b.resetTorques(true);
    b.setAngularDamping(1.6);
    this.hooks.onTouch?.();

    if (!d.lifted) {
      if (e.type === 'pointerup' && performance.now() - d.t0 < 450) this.hooks.onTap?.(d.piece);
      return;
    }
    // throw: keep the hand's speed, pop up toward you, tumble
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
      const s = Math.min(1, 26 / speed);
      b.setLinvel({ x: lv.x * 0.3 + vx * s * 0.8, y: lv.y * 0.3 + Math.min(9, speed * 0.42), z: lv.z * 0.3 + vz * s * 0.8 }, true);
      const spin = Math.min(11, speed * 0.75);
      b.setAngvel({ x: vz / (speed || 1) * spin + rand(-1, 1), y: rand(-2, 2), z: -vx / (speed || 1) * spin + rand(-1, 1) }, true);
      this.hooks.onThrow?.(speed);
    }
    this.kick = Math.max(this.kick, 30);
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

  /** Toss a piece back in: it drops from just below the mouth of the bag. */
  dropBack(p) {
    const at = this._dropSpot();
    p.body.setEnabled(true);
    p.body.setTranslation(at.t, true);
    p.body.setRotation(at.r, true);
    p.body.setLinvel(at.v, true);
    p.body.setAngvel({ x: rand(-2, 2), y: rand(-1, 1), z: rand(-2, 2) }, true);
    p.hidden = false;
    p.mesh.visible = true;
    this._sync(p);
    this.kick = Math.max(this.kick, 60);
  }

  add(look) {
    const p = this._addPiece(look, this._dropSpot());
    this.kick = Math.max(this.kick, 60);
    return p;
  }

  remove(p) {
    this._disposePiece(p);
    this.pieces.splice(this.pieces.indexOf(p), 1);
    this.kick = Math.max(this.kick, 4);
    this.coverDirty = true;
  }

  shake() {
    for (const p of this.pieces) {
      if (p.hidden) continue;
      const m = p.body.mass() || 0.5;
      p.body.wakeUp();
      p.body.applyImpulse({ x: rand(-3, 3) * m, y: rand(8, 13) * m, z: rand(-4, 4) * m }, true);
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
    if (!meshes.length) return;
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
      p.shadeTarget = held ? 1 : 1 - 0.55 * p.cover;
    }
    const target = this.targetId && this.find(this.targetId);
    if (target && !target.hidden) this.hooks.onCover?.(target.cover, target);
  }
}
