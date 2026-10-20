import * as THREE from 'three';
import { OrbitControls } from './vendor/controls/OrbitControls.js';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { RoomEnvironment } from './vendor/environments/RoomEnvironment.js';

const GLB = './assets/vostok-1.glb';

// The 8K72K stack is 38.36 m tall, standing along +Y (glTF is Y-up).
const ROCKET_MID = 19.4;

/* ------------------------------------------------------------------ scene */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e14);
// metals (lattice truss, engine bay) need an environment to read correctly
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;

const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.5, 900);
camera.position.set(34, ROCKET_MID + 11, 58);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, ROCKET_MID, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 12;
controls.maxDistance = 240;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.85;

const key = new THREE.DirectionalLight(0xfff4e6, 2.3);
key.position.set(38, 62, 40);
scene.add(key);
const rim = new THREE.DirectionalLight(0xbdd4ff, 1.15);
rim.position.set(-40, 26, -46);
scene.add(rim);
const under = new THREE.DirectionalLight(0xffd9b0, 0.35);
under.position.set(6, -30, 14);
scene.add(under);

/* --------------------------------------------------------- URL options */
// ?sep=0..1   initial separation, ?spin=0 stop auto-rotate,
// ?fair=0 hide the payload fairing, ?still=1 freeze the auto-rotate
const QS = new URLSearchParams(location.search);
const qNum = (k, d) => (QS.has(k) ? parseFloat(QS.get(k)) : d);
const INITIAL_SEP = Math.max(0, Math.min(1, qNum('sep', 0)));

/* --------------------------------------------------------------- loading */
const loader = new GLTFLoader();
let root = null;
const named = new Map();
const loading = document.getElementById('load');

loader.load(GLB, (gltf) => {
  root = gltf.scene;
  scene.add(root);

  let tris = 0;
  root.traverse((o) => {
    if (o.name) named.set(o.name, o);
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    o.userData.tris = o.geometry.index
      ? o.geometry.index.count / 3
      : o.geometry.attributes.position.count / 3;
    tris += o.userData.tris;
    // a per-mesh clone so highlighting one part does not tint the shared material
    o.material = o.material.clone();
    if (o.material.emissive) o.material.emissive.setHex(0x000000);
  });
  document.getElementById('poly').textContent = tris.toLocaleString();

  buildSeparationPlan();

  // apply URL-requested state now that the parts exist
  current = target = INITIAL_SEP;
  sep.value = Math.round(INITIAL_SEP * 100);
  sepV.textContent = sep.value + '%';
  if (QS.get('spin') === '0' || QS.get('still') === '1') {
    controls.autoRotate = false;
    spinBtn.textContent = 'spin: off';
  }
  if (QS.get('fair') === '0') toggleFairing();

  loading.classList.add('done');
  window.__vostokReady = true;   // hook for headless capture / tests
}, undefined, (err) => {
  document.getElementById('err').textContent = 'Failed to load ' + GLB + ' — ' + err;
});

/* ------------------------------------------------- separation plan (m) */
// Each part gets a rest position, a direction and a distance, plus a delay so
// pressing "stage" peels the rocket apart like a real flight sequence.
const plan = [];

function addPart(name, dir, dist, delay) {
  const o = named.get(name);
  if (!o) { console.warn('missing part', name); return; }
  plan.push({
    obj: o,
    rest: o.position.clone(),
    dir: dir.clone().normalize(),
    dist, delay,
  });
}

function buildSeparationPlan() {
  plan.length = 0;

  // 4 boosters + 4 fins fly outward radially, a little staggered.
  // Distances are tuned so the fully separated stack still fits the default view.
  const BOOST_D = 11, FIN_D = BOOST_D;
  for (let i = 1; i <= 4; i++) {
    const b = named.get('Booster_' + i);
    const f = named.get('Fin_' + i);
    if (b) {
      b.geometry.computeBoundingBox();
      const c = b.geometry.boundingBox.getCenter(new THREE.Vector3());
      addPart('Booster_' + i, new THREE.Vector3(c.x, 0, c.z), BOOST_D, 0.06 + (i - 1) * 0.045);
    }
    if (f) {
      f.geometry.computeBoundingBox();
      const c = f.geometry.boundingBox.getCenter(new THREE.Vector3());
      addPart('Fin_' + i, new THREE.Vector3(c.x, 0, c.z), FIN_D, 0.06 + (i - 1) * 0.045);
    }
  }

  const UP = new THREE.Vector3(0, 1, 0);
  const DOWN = new THREE.Vector3(0, -1, 0);
  /* Block A goes first, then its truss; Block E and the spacecraft climb
     away.  The two shroud petals peel sideways, as the pyrotechnics did. */
  addPart('Core_Stage1',      DOWN, 10, 0.36);
  addPart('Lattice_Frame',    DOWN, 10, 0.52);
  addPart('BlockE_Stage3',    UP,   15, 0.66);
  addPart('Vostok_Capsule',   UP,   19, 0.80);
  addPart('Payload_Fairing_L', new THREE.Vector3(1, 0.28, 0.10), 16, 0.56);
  addPart('Payload_Fairing_R', new THREE.Vector3(-1, 0.28, -0.10), 16, 0.56);
}

/* ------------------------------------------------------------- animation */
const sep = document.getElementById('sep');
const sepV = document.getElementById('sepV');
let target = 0, current = 0;
let playing = false, playT = 0;

const smooth = (t) => t * t * (3 - 2 * t);

function applySeparation(t) {
  for (const p of plan) {
    const k = smooth(THREE.MathUtils.clamp((t - p.delay) / (1 - p.delay), 0, 1));
    p.obj.position.copy(p.rest).addScaledVector(p.dir, p.dist * k);
  }
}

sep.addEventListener('input', () => {
  target = +sep.value / 100;
  sepV.textContent = sep.value + '%';
  playing = false;
  playBtn.classList.remove('on');
  playBtn.textContent = '▶ stage';
});

const playBtn = document.getElementById('play');
function togglePlay() {
  playing = !playing;
  playBtn.classList.toggle('on', playing);
  playBtn.textContent = playing ? '❚❚ pause' : '▶ stage';
  if (playing) { playT = current; if (current >= 0.999) { playT = 0; current = 0; } }
}
playBtn.onclick = togglePlay;

const spinBtn = document.getElementById('spin');
spinBtn.onclick = () => {
  controls.autoRotate = !controls.autoRotate;
  spinBtn.textContent = 'spin: ' + (controls.autoRotate ? 'on' : 'off');
};

const fairBtn = document.getElementById('fair');
let fairingOn = true;
function toggleFairing() {
  fairingOn = !fairingOn;
  for (const n of ['Payload_Fairing_L', 'Payload_Fairing_R']) {
    if (named.has(n)) named.get(n).visible = fairingOn;
  }
  fairBtn.classList.toggle('on', !fairingOn);
  fairBtn.textContent = 'shroud: ' + (fairingOn ? 'on' : 'off');
}
fairBtn.onclick = toggleFairing;

document.getElementById('reset').onclick = () => {
  current = target = 0; sep.value = 0; sepV.textContent = '0%';
  playing = false; playBtn.classList.remove('on'); playBtn.textContent = '▶ stage';
  camera.position.set(34, ROCKET_MID + 11, 58);
  controls.target.set(0, ROCKET_MID, 0);
  controls.update();
};

addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.key === 'h' || e.key === 'H') toggleFairing();
});

/* ---------------------------------------------------------------- hover */
const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
const hoverEl = document.getElementById('hover');
let hovered = null;
let pointerInside = false;
renderer.domElement.addEventListener('pointermove', (e) => {
  pointerInside = true;
  ptr.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
});
renderer.domElement.addEventListener('pointerleave', () => { pointerInside = false; });

const LABELS = {
  Core_Stage1: 'Block A — core stage',
  Core_Engines: 'RD-108 — 4 chambers + 4 verniers',
  Core_Details: 'Core panel seams, raceway & hatches',
  Core_Markings: 'ВОСТОК livery',
  Booster_1: 'Block B — strap-on 1', Booster_2: 'Block V — strap-on 2',
  Booster_3: 'Block G — strap-on 3', Booster_4: 'Block D — strap-on 4',
  Fin_1: 'Fin 1', Fin_2: 'Fin 2', Fin_3: 'Fin 3', Fin_4: 'Fin 4',
  Lattice_Frame: 'Open interstage truss',
  BlockE_Stage3: 'Block E — third stage (RD-0109)',
  Payload_Fairing_L: 'Payload shroud — left petal',
  Payload_Fairing_R: 'Payload shroud — right petal',
  Vostok_Capsule: 'Vostok 3KA — Gagarin’s spacecraft',
  Vostok_SA: 'Descent module (SA) — 2.3 m sphere',
  Vostok_PA: 'Instrument module (PA) — TDU-1',
  Vostok_SA_HeatShield: 'Reentry heat shield',
  Vostok_SA_Details: 'Hatch, Vzor window & antennas',
};

function updateHover() {
  if (!root || !pointerInside) {
    if (hovered) { hovered.material.emissive.setHex(0x000000); hovered = null; hoverEl.textContent = '—'; }
    return;
  }
  ray.setFromCamera(ptr, camera);
  const hit = ray.intersectObject(root, true).find((h) => h.object.visible && h.object.isMesh);
  const obj = hit ? hit.object : null;
  if (obj !== hovered) {
    if (hovered && hovered.material.emissive) hovered.material.emissive.setHex(0x000000);
    hovered = obj;
    if (hovered && hovered.material.emissive) hovered.material.emissive.setHex(0x2a0d10);
  }
  const label = obj && (LABELS[obj.name] ||
    (obj.parent && LABELS[obj.parent.name]) || obj.name);
  hoverEl.innerHTML = obj ? '<b>' + label + '</b>' : '—';
}

/* ---------------------------------------------- adaptive framing */
// The separated stack is ~1.6x taller than the assembled rocket, so ease the
// camera back and raise the target as separation grows - but stop the moment
// the user grabs the scene, so manual framing is never fought.
const BASE_TARGET_Y = ROCKET_MID;
const BASE_DIST = camera.position.distanceTo(controls.target);
let autoFrame = true;
renderer.domElement.addEventListener('pointerdown', () => { autoFrame = false; });
renderer.domElement.addEventListener('wheel', () => { autoFrame = false; }, { passive: true });

function updateAutoFrame(t) {
  if (!autoFrame) return;
  const wantY = BASE_TARGET_Y + t * 7.5;
  controls.target.y += (wantY - controls.target.y) * 0.08;

  const off = camera.position.clone().sub(controls.target);
  const want = BASE_DIST * (1 + t * 0.62);
  if (Math.abs(off.length() - want) > 0.05) {
    off.setLength(want);
    camera.position.copy(controls.target).add(off);
  }
}

/* ----------------------------------------------------------------- loop */
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => {
  if (playing) {
    playT = Math.min(1, playT + 0.0032);
    current = playT;
    sep.value = Math.round(current * 100);
    sepV.textContent = sep.value + '%';
    if (playT >= 1) togglePlay();
  } else {
    current += (target - current) * 0.12;
  }
  applySeparation(current);
  updateAutoFrame(current);
  updateHover();
  controls.update();
  renderer.render(scene, camera);
});
