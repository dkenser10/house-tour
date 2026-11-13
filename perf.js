// Performance warm-up for Meta Quest.
// 1. Uploads every texture and compiles every shader right after the house loads,
//    so the first look in a new direction no longer causes a hitch.
// 2. In VR, asks the headset for a steady 72 Hz (the competition minimum is 60 fps),
//    which gives each frame more time than 90 Hz.
const ready = () => new Promise((r) => { const t = () => (window.questHouseDebug ? r(window.questHouseDebug) : setTimeout(t, 100)); t(); });
const d = await ready();
const renderer = d.renderer, scene = d.iwsdk.scene, camera = d.iwsdk.camera;

function warm() {
  const seen = new Set();
  scene.traverse((o) => {
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      for (const k in m) {
        const t = m[k];
        if (t && t.isTexture && !seen.has(t.source.uuid)) { seen.add(t.source.uuid); try { renderer.initTexture(t); } catch (e) { /* keep going */ } }
      }
    }
  });
  let ok = true; try { renderer.compile(scene, camera); } catch (e) { ok = false; }
  console.log('[perf] warmed', seen.size, 'textures; shaders compiled:', ok);
  return seen.size;
}

warm();

renderer.xr.addEventListener('sessionstart', async () => {
  const s = renderer.xr.getSession();
  try {
    const rates = s && s.supportedFrameRates ? [...s.supportedFrameRates] : [];
    if (rates.includes(72) && s.updateTargetFrameRate) { await s.updateTargetFrameRate(72); console.log('[perf] frame rate 72 Hz'); }
  } catch (e) { console.log('[perf] frame rate unchanged'); }
  setTimeout(warm, 0);
});
window.questHousePerf = { warm };

// ---- Windows are not doorways ---------------------------------------------------------
// The walkable map only saw the low sill under each window, so a teleport arc could fly
// through the glass and land outside. Here every wall column that has wall between
// 0.2 m and 1.6 m (sills and full walls, but not doorways, whose wall starts above the
// door) blocks the arc and the controller sticks. Doorways stay open.
(() => {
  const nav = d.nav, T = d.THREE, walls = d.world.solids && d.world.solids[0];
  if (!nav || !nav.idx || !walls) { console.log('[fix] window guard skipped'); return; }
  const CELL = 0.1, W = nav.W, D = nav.D, mask = new Uint8Array(W * D);
  const o0 = nav.pt(0), x0 = o0.x - CELL / 2, z0 = o0.z - CELL / 2;
  walls.updateWorldMatrix(true, false);
  const g = walls.geometry, p = g.attributes.position, ix = g.index, n = ix ? ix.count : p.count;
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), nrm = new T.Vector3(), tan = new T.Vector3(), e1 = new T.Vector3(), e2 = new T.Vector3();
  const LO = 0.2, HI = 1.6;
  for (let t = 0; t < n; t += 3) {
    a.fromBufferAttribute(p, ix ? ix.getX(t) : t).applyMatrix4(walls.matrixWorld);
    b.fromBufferAttribute(p, ix ? ix.getX(t + 1) : t + 1).applyMatrix4(walls.matrixWorld);
    c.fromBufferAttribute(p, ix ? ix.getX(t + 2) : t + 2).applyMatrix4(walls.matrixWorld);
    nrm.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)); if (nrm.lengthSq() < 1e-10) continue; nrm.normalize();
    if (Math.abs(nrm.y) > 0.7) continue;                       // floors and tops of boxes: the side faces cover them
    tan.set(-nrm.z, 0, nrm.x).normalize();                    // horizontal direction along the face
    const pts = [a, b, c], s = pts.map((v) => v.x * tan.x + v.z * tan.z);
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - x0) / CELL) - 1), i1 = Math.min(W - 1, Math.floor((Math.max(a.x, b.x, c.x) - x0) / CELL) + 1);
    const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) - z0) / CELL) - 1), j1 = Math.min(D - 1, Math.floor((Math.max(a.z, b.z, c.z) - z0) / CELL) + 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = x0 + (i + 0.5) * CELL, z = z0 + (j + 0.5) * CELL;
      if (Math.abs((x - a.x) * nrm.x + (z - a.z) * nrm.z) > CELL * 0.75) continue;   // cell is not on this face
      const sp = x * tan.x + z * tan.z; let lo = Infinity, hi = -Infinity;
      for (let q = 0; q < 3; q++) {                                               // height range of the face at this spot
        const u = pts[q], v = pts[(q + 1) % 3], su = s[q], sv = s[(q + 1) % 3];
        if ((sp < Math.min(su, sv) - 1e-4) || (sp > Math.max(su, sv) + 1e-4)) continue;
        const y = Math.abs(sv - su) < 1e-6 ? null : u.y + (v.y - u.y) * (sp - su) / (sv - su);
        if (y === null) { lo = Math.min(lo, u.y, v.y); hi = Math.max(hi, u.y, v.y); } else { lo = Math.min(lo, y); hi = Math.max(hi, y); }
      }
      if (lo < HI && hi > LO) mask[j * W + i] = 1;
    }
  }
  const inWall = (x, y, z) => { if (y > 2.75 || y < -0.5) return false; const k = nav.idx(x, z); return k >= 0 && mask[k] === 1; };
  // Teleport arc: walk each segment in 5 cm steps; stop at the first wall or window.
  const arc0 = nav.arc.bind(nav);
  nav.arc = (pts, count) => {
    const r = arc0(pts, count), last = Math.min(r.used, count - 1);
    for (let i = 1; i <= last; i++) {
      const A = pts[i - 1], B = pts[i], len = A.distanceTo(B), steps = Math.max(1, Math.ceil(len / 0.05));
      for (let s = 1; s <= steps; s++) { const f = s / steps; if (inWall(A.x + (B.x - A.x) * f, A.y + (B.y - A.y) * f, A.z + (B.z - A.z) * f)) return { hit: null, used: i }; }
    }
    return r;
  };
  // Controller sticks and laptop keys: a ray-castable guard added to the solid list.
  if (Array.isArray(d.world.solids)) {
    const guard = new T.Object3D(); guard.name = 'WindowGuard';
    guard.raycast = (rc, out) => {
      const o = rc.ray.origin, dir = rc.ray.direction, far = Math.min(rc.far, 20);
      for (let t = 0; t <= far; t += 0.05) if (inWall(o.x + dir.x * t, o.y + dir.y * t, o.z + dir.z * t)) { out.push({ distance: t, object: guard, point: new T.Vector3(o.x + dir.x * t, o.y + dir.y * t, o.z + dir.z * t) }); return; }
    };
    d.world.solids.push(guard);
  }
  let cells = 0; for (const v of mask) cells += v;
  window.questHouseWindowGuard = { inWall, cells };
  console.log('[fix] window guard active,', cells, 'wall cells');
})();
