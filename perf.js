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
