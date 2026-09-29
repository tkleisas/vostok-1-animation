/*
 * Vostok 1 - launch sequence and orbit.
 *
 * One continuous shot: Baikonur pad -> ignition -> ascent with the sky
 * darkening -> booster staging -> fairing separation -> orbital insertion,
 * after which the camera pulls back and the 3KA capsule orbits the Earth.
 *
 * Scale note: the Earth sphere's radius animates 6000 -> 5455. While it is
 * huge the surface reads as a flat steppe and the rocket is 1:1; as it
 * shrinks the same geometry becomes a globe with the capsule in low orbit.
 * The launch site stays pinned to y=0 throughout, so there is no jump at
 * the hand-over.
 *
 * Earth imagery: NASA Blue Marble (public domain) - see
 * assets/textures/earth/SOURCES.md
 */
import * as THREE from 'three';
import { OrbitControls } from './vendor/controls/OrbitControls.js';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { RoomEnvironment } from './vendor/environments/RoomEnvironment.js';

const GLB = './assets/vostok-1.glb';
const TEX = './assets/textures/earth/';

/* ==================================================================== *
 *  mission timeline
 * ==================================================================== */
/* The clock runs a couple of minutes past the 108-minute landing so the
   capsule can settle on the steppe before the playback ends. */
const MISSION_END = 110 * 60 + 20;   // s of mission clock shown
/* the orbit actually flown: a slight Block-E overburn put Vostok 1 into
   181 x 327 km with a period of 89.34 min - higher than the planned
   175 x 302 km, and the figures TASS announced */
const ORBIT_PERIOD = 89.34 * 60;
const T_IGNITE = 0.055, T_LIFT = 0.115;
const DURATION = 95;                          // s of real playback for the whole mission
const T_REVEAL_A = 0.200, T_REVEAL_B = 0.560;

/* Ascent events on the real Vostok 1 clock: launch 09:06:59.7 MSK, the
   four strap-ons burn out and drop at T+119 s (Gerchik via
   russianspaceweb, ESA), the payload shroud is jettisoned at T+154 s
   (Zak's planned figure; ESA lists T+156), the core stage separates at
   T+299 s, and the Block-E cuts off at T+676 s with the spacecraft
   letting go at 09:18:28 MSK - T+688 s. */
const EV_BOOST_SEP = 119, EV_FAIR_SEP = 154, EV_CORE_SEP = 299;
const EV_ORBIT = 676, EV_SPACECRAFT_SEP = 688;
/* Descent events: the TDU-1 retro engine fires at 10:25 MSK (T+78 min)
   for ~40 s, the descent sphere meets the sensible atmosphere around
   T+90 min, decelerating at up to ~8 g, the main parachute opens near
   7 km, and Gagarin's capsule touches down near Smelovka in the Saratov
   region at 10:55 MSK - T+108 min. */
const EV_RETRO = 4680, EV_RETRO_END = 4720, EV_ENTRY = 5300;
const EV_PLASMA_PK = 5750, EV_CHUTE = 6250, EV_TOUCH = 6480;

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

/* readouts, keyed on normalised t */
function keyframe(t, pts) {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const [t0, v0] = pts[i - 1], [t1, v1] = pts[i];
      return lerp(v0, v1, sstep(t0, t1, t));
    }
  }
  return pts[pts.length - 1][1];
}
/* --- readouts ----------------------------------------------------------- *
 * Keyed on the MISSION clock through tAtMission, defined after the T_*
 * anchors below, so the numbers can never drift away from the events.
 * The anchors follow the published record: ~1.65 km/s at ~47 km when the
 * strap-ons drop at T+119 s, the shroud off near 70 km, the core finishing
 * at ~5.4 km / ~145 km (Gerchik cites 5.5 km/s) and the Block-E topping
 * out at 7.84 km/s around 186 km, injecting into the 181 x 327 km orbit
 * TASS announced. Values BETWEEN the anchors are interpolations for
 * display, not telemetry. The tables are built further down, after the
 * T_* anchors exist. */

/* --- mass -------------------------------------------------------------- *
 * Two separate effects, which is why the curve is never smooth:
 *   - propellant burning off continuously, and
 *   - whole stages vanishing INSTANTLY when jettisoned.
 * Component masses are balanced so what remains after the Block-E lets go
 * is the 4.7 t Vostok spacecraft: 287 t liftoff = 158.5 t strap-on
 * propellant + 13.8 t strap-on structure + 94.2 t core propellant + 8.5 t
 * core structure + 0.55 t shroud + 5.5 t Block-E propellant + 1.25 t
 * Block-E structure + 4.7 t spacecraft.
 * -------------------------------------------------------------------- */
const M0 = 287.0;
const M_BO_PROP = 158.5, M_BO_DRY = 13.8;     // 4 x RD-107 strap-ons
const M_CO_PROP = 94.2,  M_CO_DRY = 8.5;      // RD-108 core
const M_3E_PROP = 5.5,   M_3E_DRY = 1.25;     // Block-E
const M_FAIR = 0.55;                          // payload shroud
function massTonnes(sec) {
  let m = M0;
  m -= M_BO_PROP * clamp(sec / 118);
  m -= M_CO_PROP * clamp(sec / 299);
  if (sec >= 301) m -= M_3E_PROP * clamp((sec - 301) / 375);
  if (sec >= EV_FAIR_SEP) m -= M_FAIR;           // step down
  if (sec >= EV_BOOST_SEP) m -= M_BO_DRY;        // step down
  if (sec >= EV_CORE_SEP) m -= M_CO_DRY;         // step down
  if (sec >= EV_SPACECRAFT_SEP) m -= M_3E_DRY;   // step down
  return m;
}

const missionTime = (t) => keyframe(t, [[0, -10], [0.055, -2], [0.115, 0], [0.200, EV_BOOST_SEP],
                                       [0.250, EV_FAIR_SEP], [0.400, EV_CORE_SEP],
                                       [0.560, EV_ORBIT], [0.585, EV_SPACECRAFT_SEP],
                                       [1, MISSION_END]]);

/* Invert the clock so the staging instants and the readout can never drift
   apart: every event is placed by its real mission time, not by hand. */
function tAtMission(sec) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (missionTime(mid) < sec) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
const T_BOOST_SEP = tAtMission(EV_BOOST_SEP);
const T_FAIR_SEP = tAtMission(EV_FAIR_SEP);
const T_CORE_SEP = tAtMission(EV_CORE_SEP);
const T_ORBIT = tAtMission(EV_ORBIT);
const T_SEP = tAtMission(EV_SPACECRAFT_SEP);
/* The Block-E's RD-0109 was hot-staged: it fired at ~T+294 s, through the
   open interstage truss, just before the core burned out and let go. */
const T_BLE_IGN = tAtMission(294);
const T_MAXQ = tAtMission(55);          // max-Q near T+55 s, ~11 km
const T_RETRO = tAtMission(EV_RETRO);
const T_RETRO_END = tAtMission(EV_RETRO_END);
const T_ENTRY = tAtMission(EV_ENTRY);
const T_CHUTE = tAtMission(EV_CHUTE);
const T_TOUCH = tAtMission(EV_TOUCH);

/* --- readouts ----------------------------------------------------------- *
 * Keyed on the MISSION clock through tAtMission so the numbers can never
 * drift away from the events. The anchors follow the published record:
 * ~1.65 km/s at ~47 km when the strap-ons drop at T+119 s, the shroud off
 * near 70 km, the core finishing at ~5.4 km/s / ~145 km (Gerchik cites
 * 5.5 km/s) and the Block-E topping out at 7.84 km/s around 186 km,
 * injecting into the 181 x 327 km orbit TASS announced. Values BETWEEN the
 * anchors are interpolations for display, not telemetry. */
const ALT_KM = [
  [T_LIFT, 0], [tAtMission(10), 0.3], [tAtMission(20), 1.4], [tAtMission(30), 3],
  [tAtMission(40), 5.5], [tAtMission(60), 13], [tAtMission(85), 26],
  [tAtMission(100), 36], [T_BOOST_SEP, 47], [T_FAIR_SEP, 68],
  [tAtMission(200), 95], [tAtMission(250), 122], [T_CORE_SEP, 145],
  [tAtMission(400), 168], [tAtMission(500), 186], [T_ORBIT, 186],
  /* on the real 181 x 327 km orbit the altitude breathes up to apogee half
     a period after insertion (~T+3356 s), then the TDU-1 burn at T+4680 s
     drops the perigee into the atmosphere: entry interface at 120 km around
     T+5300 s, a steep decelerating fall, the parachute near 7 km, and the
     steppe at T+6480 s */
  [tAtMission(3356), 327], [T_RETRO, 252], [T_RETRO_END, 250],
  [T_ENTRY, 120], [tAtMission(5500), 82], [tAtMission(5750), 42],
  [tAtMission(6000), 15], [T_CHUTE, 7], [tAtMission(6400), 1.2], [T_TOUCH, 0], [1, 0],
];
const VEL_MS = [
  [T_LIFT, 0], [tAtMission(10), 60], [tAtMission(20), 140], [tAtMission(30), 240],
  [tAtMission(40), 360], [tAtMission(60), 620], [tAtMission(85), 1050],
  [tAtMission(100), 1350], [T_BOOST_SEP, 1650], [T_FAIR_SEP, 2400],
  [tAtMission(200), 3200], [tAtMission(250), 4300], [T_CORE_SEP, 5400],
  [tAtMission(400), 6300], [tAtMission(500), 6900], [T_ORBIT, 7840],
  /* the TDU-1 shaves off ~150 m/s, the atmosphere does the rest: subsonic
     below ~10 km and ~6 m/s under the canopy */
  [T_RETRO, 7680], [T_RETRO_END, 7530], [T_ENTRY, 7560], [tAtMission(5500), 7100],
  [tAtMission(5750), 1600], [tAtMission(6000), 260], [T_CHUTE, 70],
  [tAtMission(6400), 7], [T_TOUCH, 4], [1, 0],
];
/* Proper acceleration - what the crew feels: ~0.6 g off the pad, the
   3-4 g Gagarin reported by T+60 s, peaking ~4.5 g at strap-on burnout,
   sagging when the boosters let go, climbing to ~3.3 g at core cutoff,
   then the long low-thrust Block-E burn below 1 g until cutoff. After the
   orbital free-fall the retro burn nudges ~0.3 g, then the re-entry
   builds to the ~8 g Gagarin reported, easing through the parachute
   opening shock to 1 g under the canopy. */
const ACC_G = [
  [T_LIFT, 0], [tAtMission(5), 0.60], [tAtMission(30), 0.95], [tAtMission(60), 1.65],
  [tAtMission(90), 2.80], [T_BOOST_SEP - 0.004, 4.50], [T_BOOST_SEP + 0.004, 0.50],
  [tAtMission(160), 0.70], [tAtMission(220), 1.60], [tAtMission(270), 2.70],
  [T_CORE_SEP - 0.004, 3.30], [T_CORE_SEP + 0.004, 0.38],
  [tAtMission(450), 0.62], [T_ORBIT - 0.004, 0.85], [T_ORBIT + 0.004, 0.02],
  [T_RETRO - 0.002, 0], [T_RETRO + 0.002, 0.30], [T_RETRO_END - 0.002, 0.30],
  [T_RETRO_END + 0.002, 0], [tAtMission(5400), 0.15], [tAtMission(5600), 3.5],
  [tAtMission(5750), 8.2], [tAtMission(5900), 4.0], [tAtMission(6100), 1.2],
  [T_CHUTE - 0.002, 1.0], [T_CHUTE + 0.002, 3.0], [tAtMission(6320), 1.0], [1, 1],
];

const PHASES = [
  [0.000, 'T-00:10  pre-launch'],
  [T_IGNITE, 'ignition  -  32 chambers'],
  [T_LIFT, 'lift-off  -  "Poyekhali!"'],
  [T_MAXQ, 'max dynamic pressure'],
  [T_BOOST_SEP, 'strap-on separation  -  Korolev cross'],
  [T_FAIR_SEP, 'payload shroud jettison'],
  [T_BLE_IGN, 'Block-E ignition  -  hot staging'],
  [T_CORE_SEP, 'core separation  -  Block-E burn'],
  [T_ORBIT, 'orbital insertion  -  181 x 327 km'],
  [T_SEP, 'Vostok 1 in orbit'],
  [T_RETRO, 'retrofire  -  TDU-1 burn'],
  [T_ENTRY, 'entry interface  -  120 km'],
  [tAtMission(5750), 'peak heating  -  8 g'],
  [T_CHUTE, 'parachute deployment'],
  [tAtMission(6270), 'Gagarin ejects'],
  [T_TOUCH, 'touchdown  -  Saratov region'],
];
/* --- world altitude ---------------------------------------------------- *
 * The climb is staged in VEHICLE-scale units so the pad visibly falls away:
 * ~1.2 vehicle lengths by max-Q, ~4 by strap-on separation (T+119 s) and
 * ~5.5 by fairing separation, easing off as the trajectory flattens. The
 * table is LINEAR in mission seconds - smoothstep easing stalls the motion
 * at every knot and the climb read as slow pulsing hops. The reveal below
 * then anchors the surface so the capsule still ends exactly ORBIT_ALT
 * above the globe whatever this curve reaches.
 * ---------------------------------------------------------------------- */
const ORBIT_ALT = 150;                                   // capsule altitude, scene units
/* linear-in-mission-seconds interpolation for the climb table */
function worldAltMs(sec) {
  const pts = WA_M;
  if (sec <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (sec <= pts[i][0]) {
      const [s0, v0] = pts[i - 1], [s1, v1] = pts[i];
      return lerp(v0, v1, (sec - s0) / (s1 - s0));
    }
  }
  return pts[pts.length - 1][1];
}
const WA_M = [[0, 0], [8, 3], [16, 12], [24, 26], [32, 42], [45, 62], [60, 85],
              [80, 115], [100, 140], [EV_BOOST_SEP, 145], [EV_FAIR_SEP, 185],
              [220, 232], [EV_CORE_SEP, 270], [450, 295], [EV_ORBIT, 310]];
const worldAlt = (t) => (t <= T_LIFT ? 0 : worldAltMs(missionTime(t)));
/* Earth radius: huge while the "ground" reads flat, then shrinks to a globe.
   The final radius is fixed by ORBIT_ALT so the capsule sits at its true
   low-orbit ratio: ~175 km (the orbit's perigee, where insertion happened)
   on a 6 371 km planet = 0.0275 radii. Picking the radius rather than moving
   the capsule keeps the ascent monotonic, so the vehicle never appears to
   sink back towards the surface: across the reveal the apparent
   altitude/radius ratio only rises. */
const EARTH_R = ORBIT_ALT / 0.0275;                      // 5455
/* The capsule is drawn far larger than life so it stays visible - but it was
   ~2% of the Earth's radius, which read as a beach ball parked on the surface
   rather than a spacecraft in low orbit. Keep the same exaggeration as the
   launch scene (it has to match the pad scale) but cut it hard: the vehicle is
   now a small object just above the limb and the planet dominates. */
const ORBIT_CAP_SCALE = 34;   // ~25 px on screen: a small craft over a vast planet
const earthRadius = (t) => lerp(6000, EARTH_R, sstep(T_REVEAL_A, T_REVEAL_B, t));
/* Above roughly 30 km the vehicle is out of the dense air and the sky starts
   to go black. Keyed to real ALTITUDE, not the timeline parameter, so it stays
   correct no matter how the climb curve is retimed. */
const skyDark = (t) => sstep(30, 130, keyframe(t, ALT_KM));
/* --- gravity turn ------------------------------------------------------ *
 * The R-7 pitches over early and hard: ~20 deg from vertical by T+40 s,
 * ~63 deg at strap-on separation, ~72 when the shroud goes, and by core
 * cutoff (T+299 s) it is flying nearly parallel to the horizon - Gagarin
 * noted the trajectory "levelled out almost parallel to the horizon" by
 * the end of the second-stage burn, then even dipped slightly. The Block-E
 * therefore burns almost level, trading altitude for the final 2.4 km/s.
 * -------------------------------------------------------------------- */
const PITCH_DEG = [
  [0, 0], [tAtMission(20), 6], [tAtMission(40), 20], [tAtMission(60), 33],
  [tAtMission(85), 48], [T_BOOST_SEP, 63], [T_FAIR_SEP, 72], [tAtMission(200), 80],
  [T_CORE_SEP, 88], [tAtMission(400), 89], [T_ORBIT, 89.5], [1, 89.5],
];
const pitchAt = (t) => keyframe(t, PITCH_DEG) * Math.PI / 180;
/* metres per scene unit on the globe scale (ORBIT_ALT spans 175 km) */
const M_PER_UNIT = 175000 / ORBIT_ALT;

/* Downrange angle in radians of orbital arc, integrated from the HORIZONTAL
   component of the speed. The old version advanced at a constant rate from
   the pad, and later revisions flew too shallow a pitch; with the profile
   above the integration lands ~0.48 rad downrange at insertion - about
   3 000 km, matching the ~10-minute ground track over central Russia. */
const DOWN = (() => {
  const N = 900, tab = [0];
  let a = 0, prev = 0;
  for (let i = 1; i <= N; i++) {
    const t = (i / N) * T_SEP;
    const h0 = keyframe(prev, VEL_MS) * Math.sin(pitchAt(prev));
    const h1 = keyframe(t, VEL_MS) * Math.sin(pitchAt(t));
    /* integrate over MISSION seconds, not the 95 s playback timeline */
    a += 0.5 * (h0 + h1) * (missionTime(t) - missionTime(prev)) / M_PER_UNIT / EARTH_R;
    tab.push(a);
    prev = t;
  }
  return { N, tab, at: a };
})();
const downAngle = (t) => {
  if (t <= T_SEP) {
    const x = clamp(t / T_SEP) * DOWN.N;
    const i = Math.min(DOWN.N - 1, Math.floor(x));
    return lerp(DOWN.tab[i], DOWN.tab[i + 1], x - i);
  }
  return DOWN.at + ((missionTime(t) - EV_SPACECRAFT_SEP) / ORBIT_PERIOD) * Math.PI * 2;
};
const orbitAngle = downAngle;
/* downrange in real kilometres, for the range readout */
/* slant range to the pad at the moment of retrofire (great-circle arc of
   the ground track): after the burn the readout converges from here to the
   landing site's real ~800 km */
const RANGE_AT_RETRO = (() => {
  const w = ((downAngle(T_RETRO) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.hypot(keyframe(T_RETRO, ALT_KM),
                    Math.min(w, Math.PI * 2 - w) * EARTH_R * M_PER_UNIT / 1000);
})();
/* Mission seconds per second of wall clock. Reported globally rather than
   sampled locally, because the keyframe easing has zero slope at each
   breakpoint and a local difference reads 0 there. */
const timeCompression = () => (MISSION_END * RATE) / DURATION;
/* Real sidereal-ish rate. This used to be exaggerated 2.5x "for legibility",
   which silently decoupled the ground track from the orbital geometry - the
   capsule sat at one latitude while the texture beneath it showed another. */
const earthSpin = (t) => (missionTime(t) / 3600) * (15 * Math.PI / 180);

/* --- descent path ------------------------------------------------------- *
 * From retrofire on, the capsule's world position blends from the orbital
 * pose into a scripted descent that ends on the steppe. Everything is
 * deterministic in t (seeks land on the right frame): the descent starts
 * where the orbital pose puts the capsule at retrofire, then travels a
 * fixed distance along the flight direction while the world-space height
 * runs down the LAND_ALT table. Heights are scene units above the steppe
 * plane (y = -BLOCK_H), mirroring the ascent's worldAlt mechanism.
 * ---------------------------------------------------------------------- */
const LAND_ALT = [
  [T_RETRO, 150], [T_ENTRY, 120], [tAtMission(5500), 75], [tAtMission(5750), 34],
  [tAtMission(6000), 12], [T_CHUTE, 6.5], [tAtMission(6350), 2.8],
  [tAtMission(6460), 0.4], [T_TOUCH, 0], [1, 0],
];
function landAlt(t) {
  if (t <= LAND_ALT[0][0]) return LAND_ALT[0][1];
  for (let i = 1; i < LAND_ALT.length; i++) {
    if (t <= LAND_ALT[i][0]) {
      const [t0, v0] = LAND_ALT[i - 1], [t1, v1] = LAND_ALT[i];
      return lerp(v0, v1, (t - t0) / (t1 - t0));       // linear, like WA_M
    }
  }
  return 0;
}
/* the capsule's pure orbital world position at time tt (ignores landing) */
function orbitCapPos(tt, out) {
  const RE2 = earthRadius(tt), h2 = worldAlt(tt), a2 = orbitAngle(tt);
  const surfY2 = lerp(-BLOCK_H, h2 - ORBIT_ALT, sstep(T_REVEAL_A, T_REVEAL_B, tt));
  const capR2 = RE2 + (h2 - surfY2);
  out.set(0, capR2 * Math.cos(a2), capR2 * Math.sin(a2)).applyQuaternion(qOrbit);
  out.y += surfY2 - RE2;
  return out;
}
const LAND_DIST = 620;                    // horizontal travel over the steppe
const _lp0 = new THREE.Vector3(), _lp1 = new THREE.Vector3();
function landPose(t, out) {
  const posA = orbitCapPos(T_RETRO, _lp0);
  const fdA = orbitCapPos(T_RETRO + 0.002, _lp1).sub(posA);
  fdA.y *= 0.25;                          // nearly level flight at retrofire
  fdA.normalize();
  const s = sstep(T_RETRO, T_TOUCH, t);
  /* the capsule rests on its aft end: its baked centre sits ~2.35 units
     above the base, so the centre rides that much above the steppe */
  out.set(posA.x + fdA.x * LAND_DIST * s,
          -BLOCK_H + 2.35 + landAlt(t),
          posA.z + fdA.z * LAND_DIST * s);
  return out;
}
/* Gagarin ejected at ~7 km and came down under his personal parachute,
   landing a couple of minutes after the capsule and some 25 m to the side.
   His path tracks the capsule's descent up to the ejection, then drifts
   sideways on a slightly stretched clock. */
const T_GAG_TOUCH = tAtMission(6540);
const _gp0 = new THREE.Vector3(), _gp1 = new THREE.Vector3(), _gp2 = new THREE.Vector3();
function gagPose(t, out) {
  const posA = orbitCapPos(T_RETRO, _gp0);
  const fdA = orbitCapPos(T_RETRO + 0.002, _gp1).sub(posA);
  fdA.y *= 0.25;
  fdA.normalize();
  const side = _gp2.set(-fdA.z, 0, fdA.x);
  const capS = sstep(T_RETRO, T_TOUCH, T_CHUTE);   // path fraction at ejection
  const s = sstep(T_CHUTE, T_GAG_TOUCH, t);
  const along = LAND_DIST * lerp(capS, 1, s);
  /* his descent on a longer clock: sample the altitude profile remapped so
     it reaches zero at his own touchdown */
  const tRemap = T_RETRO + (t - T_RETRO) * (T_TOUCH - T_RETRO) / (T_GAG_TOUCH - T_RETRO);
  out.set(posA.x + fdA.x * along + side.x * 15 * s,
          -BLOCK_H + landAlt(Math.min(1, tRemap)),
          posA.z + fdA.z * along + side.z * 15 * s);
  return out;
}

/* ==================================================================== *
 *  renderer / scene
 * ==================================================================== */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.3;

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.5, 200000);
camera.position.set(95, 22, 78);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enabled = false;            // off while the auto rig drives
controls.minDistance = 20;
controls.maxDistance = 60000;

const sun = new THREE.DirectionalLight(0xfff2dd, 3.1);
sun.position.set(0.62, 0.55, 0.56);
scene.add(sun);
const hemi = new THREE.HemisphereLight(0x9fc4ff, 0x6b5a3c, 0.55);
scene.add(hemi);

/* ==================================================================== *
 *  sky dome + stars
 * ==================================================================== */
const SKY_R = 90000;
const skyUni = {
  uDark:  { value: 0 },
  uDay:   { value: new THREE.Color(0x2f6fc4) },
  uHaze:  { value: new THREE.Color(0xbcd2e8) },
  uSun:   { value: new THREE.Vector3(0.62, 0.55, 0.56).normalize() },
};
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(SKY_R, 48, 32),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: skyUni,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize( position );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */`
      uniform float uDark;
      uniform vec3  uDay, uHaze, uSun;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize( vDir );
        float h = clamp( d.y, -1.0, 1.0 );
        // day gradient: haze at the horizon -> deeper blue overhead
        float k = pow( clamp( h, 0.0, 1.0 ), 0.55 );
        vec3 col = mix( uHaze, uDay, k );
        // below the horizon fades to a dark ground haze
        col = mix( col, uHaze * 0.45, clamp( -h * 4.0, 0.0, 1.0 ) );
        // the atmospheric band thins and vanishes with altitude
        float band = exp( -abs(h) * 9.0 ) * ( 1.0 - uDark );
        col += uHaze * band * 0.35;
        // sun glow, also extinguished by darkness
        float sd = max( dot( d, normalize( uSun ) ), 0.0 );
        col += vec3( 1.0, 0.95, 0.86 ) * pow( sd, 260.0 ) * 3.0 * ( 1.0 - uDark * 0.85 );
        col += vec3( 1.0, 0.9, 0.75 ) * pow( sd, 8.0 ) * 0.10 * ( 1.0 - uDark );
        // -> space
        col *= ( 1.0 - uDark );
        gl_FragColor = vec4( col, 1.0 );
      }`,
  })
);
sky.frustumCulled = false;
scene.add(sky);

/* --- stars --- */
function starTexture() {
  const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.25, 'rgba(255,255,255,.75)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
{
  const N = 2600, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), sz = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    // uniform on the sphere
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    pos[i * 3] = r * Math.cos(th) * SKY_R * 0.92;
    pos[i * 3 + 1] = u * SKY_R * 0.92;
    pos[i * 3 + 2] = r * Math.sin(th) * SKY_R * 0.92;
    // a few blue/amber stars, mostly white
    const w = Math.random();
    const c3 = new THREE.Color().setHSL(w < 0.12 ? 0.08 : w < 0.24 ? 0.6 : 0.14, 0.25, 0.86);
    col[i * 3] = c3.r; col[i * 3 + 1] = c3.g; col[i * 3 + 2] = c3.b;
    sz[i] = 0.5 + Math.pow(Math.random(), 3) * 2.2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    uniforms: { uTex: { value: starTexture() }, uOpacity: { value: 0 } },
    vertexShader: /* glsl */`
      attribute float aSize; varying vec3 vC;
      void main() {
        vC = color;
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
        gl_PointSize = aSize * 3.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uTex; uniform float uOpacity; varying vec3 vC;
      void main() {
        vec4 t = texture2D( uTex, gl_PointCoord );
        gl_FragColor = vec4( vC * t.rgb, t.a * uOpacity );
      }`,
    vertexColors: true,
  });
  const stars = new THREE.Points(g, m);
  stars.frustumCulled = false;
  scene.add(stars);
  var starsMat = m;   // eslint-disable-line
}

/* ==================================================================== *
 *  ground + launch pad
 * ==================================================================== */
function noiseCanvas(size, octaves) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const grids = [];
  for (let o = 0; o < octaves; o++) {
    const n = 4 << o;
    const arr = new Float32Array(n * n);
    for (let i = 0; i < arr.length; i++) arr[i] = Math.random();
    grids.push({ n, arr });
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0, amp = 1, tot = 0;
      for (const { n, arr } of grids) {
        const fx = (x / size) * n, fy = (y / size) * n;
        const x0 = Math.floor(fx) % n, y0 = Math.floor(fy) % n;
        const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
        const tx = smooth(fx - Math.floor(fx)), ty = smooth(fy - Math.floor(fy));
        const a = arr[y0 * n + x0], b = arr[y0 * n + x1];
        const c2 = arr[y1 * n + x0], d = arr[y1 * n + x1];
        v += amp * ((a * (1 - tx) + b * tx) * (1 - ty) + (c2 * (1 - tx) + d * tx) * ty);
        tot += amp; amp *= 0.55;
      }
      v /= tot;
      const i = (y * size + x) * 4;
      const r = 152 + v * 34, g = 133 + v * 30, b = 102 + v * 24;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  /* the value-noise lattice reads as a regular grid once the ground is seen
     from altitude through the transparent plume tail - a light blur turns
     it into featureless dust. Tile 3x3 before blurring and crop the centre:
     blurring the bare canvas bleeds transparent black into its edges,
     which tiles back into a visible grid when the camera gets close to the
     steppe (e.g. at the landing site). */
  const big = document.createElement('canvas'); big.width = big.height = size * 3;
  const gb = big.getContext('2d');
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    gb.drawImage(c, size + dx * size, size + dy * size);
  }
  const c2 = document.createElement('canvas'); c2.width = c2.height = size;
  const g2 = c2.getContext('2d');
  g2.filter = 'blur(1.2px)';
  g2.drawImage(big, -size, -size);
  return c2;
}

const groundTex = new THREE.CanvasTexture(noiseCanvas(256, 5));
groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
groundTex.repeat.set(2600, 2600);
groundTex.colorSpace = THREE.SRGBColorSpace;
groundTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

const BLOCK_H = 16;                              // concrete block height below the deck
const groundMat = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1, metalness: 0 });
/* The steppe is dust, not a mirror: seen from altitude the whole plain sits
   at grazing incidence, where the Fresnel term approaches 1 and a standard
   material turns into a bright studio mirror - the RoomEnvironment IBL and
   the sun's specular sheen painted the ground tan no matter how dark the
   albedo was set. Kill the IBL on it and nearly all of its specular. */
groundMat.envMapIntensity = 0.0;
groundMat.specularIntensity = 0.15;
/* The steppe sits at BLOCK_H below the launch deck, so the concrete block
   and its flame trench stand proud of the ground exactly as at Site 1/5.
   Extent is fixed in local units, then the mesh is scaled to the horizon. */
const gShape = new THREE.Shape();
gShape.moveTo(-1, -1); gShape.lineTo(1, -1); gShape.lineTo(1, 1); gShape.lineTo(-1, 1); gShape.closePath();
const ground = new THREE.Mesh(new THREE.ShapeGeometry(gShape), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -BLOCK_H;
ground.scale.setScalar(30000);
scene.add(ground);
/* Haze so the steppe fades into the horizon instead of ending in a hard
   edge. near/far are pushed out of range once the air thins, and the
   colour darkens with the sky, so nothing is left hanging in orbit. */
scene.fog = new THREE.Fog(0xcfe2f2, 320, 9000);

/* --- Baikonur-style pad: apron, flame trench, lattice service tower --- */
const pad = new THREE.Group();
scene.add(pad);
const concrete = new THREE.MeshStandardMaterial({ color: 0x9a968e, roughness: 0.95 });
const steel = new THREE.MeshStandardMaterial({ color: 0x8c4a3a, roughness: 0.65, metalness: 0.35 });
const steelDark = new THREE.MeshStandardMaterial({ color: 0x5a4038, roughness: 0.7, metalness: 0.3 });

function box(w, h, d, mat, x, y, z, parent = pad) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
/* a lattice run between two points: 2 chords + zig-zag bracing */
function lattice(p0, p1, w, mat, bays, parent = pad) {
  const dir = new THREE.Vector3().subVectors(p1, p0);
  const len = dir.length();
  dir.normalize();
  const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(dir, up).normalize().multiplyScalar(w / 2);
  const quad = [
    new THREE.Vector3().copy(p0).add(side), new THREE.Vector3().copy(p0).sub(side),
    new THREE.Vector3().copy(p1).sub(side), new THREE.Vector3().copy(p1).add(side),
  ];
  for (const p of quad) {
    const g = new THREE.CylinderGeometry(0.24, 0.24, len, 8, 1);
    const m = new THREE.Mesh(g, mat);
    m.position.copy(p).add(p0).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    parent.add(m);
  }
  for (let i = 0; i < bays; i++) {
    const f0 = i / bays, f1 = (i + 1) / bays;
    for (const s of [1, -1]) {
      const A = new THREE.Vector3().lerpVectors(p0, p1, f0).addScaledVector(side, s);
      const B = new THREE.Vector3().lerpVectors(p0, p1, f1).addScaledVector(side, -s);
      const g = new THREE.CylinderGeometry(0.12, 0.12, A.distanceTo(B), 6, 1);
      const m = new THREE.Mesh(g, mat);
      m.position.copy(A).add(B).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(B, A).normalize());
      parent.add(m);
    }
  }
}

/* --- the flame-trench block ------------------------------------------- *
 * Baikonur Site 1/5 did not sit the vehicle on a flat apron: it stood on a
 * raised concrete deck over a deep flame trench, so the first stage could
 * fire below the vehicle and be turned out sideways under the structure.
 * Deck top is y = 0, which is where the rocket's base sits.
 * -------------------------------------------------------------------- */
const DECK_H = 2.4;                       // deck slab thickness
const BOD_H = BLOCK_H - DECK_H;            // 13.6: walls from under the deck to grade
const SHADOW = new THREE.MeshStandardMaterial({ color: 0x14130f, roughness: 1 });
const TR_W = 20, TR_D = 30;              // clear trench opening
const BZ = -BOD_H / 2 - DECK_H;           // wall centre height

box(46, DECK_H, 38, concrete, 0, -DECK_H / 2, 0);                    // launch deck
box(TR_W, BOD_H, TR_D, SHADOW, 0, BZ, -2);                           // trench void
box(12, BOD_H, 38, concrete, -18, BZ, 0);                            // side walls
box(12, BOD_H, 38, concrete,  18, BZ, 0);
box(48, BOD_H, 11, concrete, 0, BZ, -15);                            // back wall
box(12, BOD_H, 10, concrete, -16, BZ, 14);                           // front piers
box(12, BOD_H, 10, concrete,  16, BZ, 14);
box(TR_W + 4, 3, 10, concrete, 0, -DECK_H - 1.5, 14);                // lintel over it
/* sloping deflector cheeks funnelling the exhaust out of the trench */
for (const sgn of [-1, 1]) {
  const cheek = box(1.8, 9, 13, concrete, sgn * (TR_W / 2 - 0.9), -DECK_H - 4.5, 3);
  cheek.rotation.z = sgn * 0.3;
}

/* service tower at x = +17, four legs to 56 m */
const TX = 19, TZ = 0, TW = 8.2, TH = 36;   // ~56 m, just under the 60 m vehicle
for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
  lattice(new THREE.Vector3(TX + sx * TW / 2, 0, TZ + sz * TW / 2),
          new THREE.Vector3(TX + sx * TW / 2, TH, TZ + sz * TW / 2), 0.7, steel, 18);
}
/* horizontal ties every 8 m */
for (let y = 7; y < TH; y += 7) {
  lattice(new THREE.Vector3(TX - TW / 2, y, TZ - TW / 2), new THREE.Vector3(TX + TW / 2, y, TZ - TW / 2), 0.6, steelDark, 4);
  lattice(new THREE.Vector3(TX - TW / 2, y, TZ + TW / 2), new THREE.Vector3(TX + TW / 2, y, TZ + TW / 2), 0.4, steelDark, 4);
  lattice(new THREE.Vector3(TX - TW / 2, y, TZ - TW / 2), new THREE.Vector3(TX - TW / 2, y, TZ + TW / 2), 0.6, steelDark, 4);
  lattice(new THREE.Vector3(TX + TW / 2, y, TZ - TW / 2), new THREE.Vector3(TX + TW / 2, y, TZ + TW / 2), 0.6, steelDark, 4);
}
/* --- hold-down support arms ------------------------------------------- *
 * Four lattice buttresses hinged on the deck clamp the first stage high up
 * on its flanks. They stay hard against the vehicle through the whole
 * ignition sequence, then withdraw OUTWARD in the instant of lift-off:
 * the clamp end swings away from the rocket and comes to rest outboard
 * and above the deck, well clear of both the vehicle and the ground.
 * -------------------------------------------------------------------- */
const holdArms = [];
for (const [ax, az] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
  const HX = 13.2, HZ = 13.2;                   // hinge on the deck
  const arm = new THREE.Group();
  arm.position.set(HX * ax, 0, HZ * az);
  const aim = Math.atan2(-HX * ax, -HZ * az);        // local +Z faces centre
  arm.rotation.order = 'YXZ';   // yaw first, THEN swing about the arm's own
  arm.rotation.y = aim;         // hinge axis - with the default XYZ order
                                // rotation.x would pitch about the WORLD X
                                // axis and the tips would sweep sideways,
                                // breaking the X the four arms should form
  pad.add(arm);
  /* reach the core wall 12 units up: the hinges sit on the diagonals
     between the strap-ons (as on the real R-7 table) and the core narrows
     with height, so the arms must reach 15.9 inboard to make contact */
  lattice(new THREE.Vector3(0, 0.4, 0), new THREE.Vector3(0, 12, 15.9), 1.6, steel, 4, arm);
  box(2.6, 2.0, 1.8, steelDark, 0, 12, 15.9, arm);   // the clamp pad
  holdArms.push({ g: arm, aim });
}

/* --- service-tower swing arms: they pull back before ignition ------------ */
const swingArms = [];
for (const y of [20, 31]) {
  const sw = new THREE.Group();
  sw.position.set(TX - TW / 2, y, 0);
  pad.add(sw);
  lattice(new THREE.Vector3(0, 0, 0), new THREE.Vector3(-11.5, 0, 0), 1.1, steel, 3, sw);
  box(2.4, 1.6, 3.2, steelDark, -10.2, 0, 0, sw);
  swingArms.push(sw);
}
/* umbilical mast / torch */
lattice(new THREE.Vector3(TX + TW / 2 + 1.6, 0, 0), new THREE.Vector3(TX + TW / 2 + 1.6, 15, 0), 1.0, steelDark, 4);
/* floodlight masts */
for (const [fx, fz] of [[-44, -38], [-46, 40], [34, 44], [-6, 52]]) {
  lattice(new THREE.Vector3(fx, 0, fz), new THREE.Vector3(fx, 22, fz), 0.7, steelDark, 5);
  box(3.2, 1.2, 1.0, new THREE.MeshStandardMaterial({ color: 0xfff3d0, emissive: 0xffe9b0, emissiveIntensity: 1.6, roughness: .4 }), fx, 22.6, fz);
}
/* low perimeter walls */
for (const [ax, az, w, d] of [[0, -46, 96, 1.2], [0, 46, 96, 1.2], [-48, 0, 1.2, 92], [48, 0, 1.2, 92]]) {
  box(w, 3.2, d, concrete, ax, 1.6, az);
}

/* ==================================================================== *
 *  Earth
 * ==================================================================== */
const texLoader = new THREE.TextureLoader();
const earthGroup = new THREE.Group();     // sits at the planet's centre
/* --- orbit geometry --------------------------------------------------- *
 * Vostok 1 flew at 64.95 deg inclination from Baikonur (45.92 N). The pivot
 * used to be a bare rotation about X, which put the orbital plane straight
 * through the Earth's spin axis - i.e. a 90 deg POLAR orbit, which is why the
 * capsule kept crossing the poles. Build the frame explicitly instead: the
 * plane's normal is the Earth's axis tilted by (90 - inclination), and the
 * pad sits on the radius the trajectory launches along.
 * -------------------------------------------------------------------- */
const LAT_PAD = 45.92 * Math.PI / 180, ORBIT_INC = 64.95 * Math.PI / 180;
const AXIAL_TILT = 0.41;                   // 23.4 deg, sets the pole's bearing
/* Earth's spin axis. Defined relative to the launch radius so the pad keeps
   the frame it was modelled in: the launch radius is world up, and the axis
   sits (90 - latitude) away from it, which is what puts the pad at 45.92 N. */
const EARTH_AXIS = new THREE.Vector3(0, Math.cos(Math.PI / 2 - LAT_PAD),
                                     -Math.sin(Math.PI / 2 - LAT_PAD))
                     .applyAxisAngle(new THREE.Vector3(0, 1, 0), AXIAL_TILT).normalize();
/* Spin the globe so the TEXTURE's Baikonur (45.92 N, 63.34 E) sits under
   the launch radius. Without this the pad stood over the wrong longitude -
   the Black Sea instead of the Kazakh steppe - and the surface under the
   ascent read as dark ocean. */
const SPIN0 = (() => {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), EARTH_AXIS).invert();
  const padDir = new THREE.Vector3(0, 1, 0).applyQuaternion(q);      // pad dir in globe space
  const phiPad = Math.atan2(padDir.z, padDir.x);
  const lon = 63.34 * Math.PI / 180;
  /* SphereGeometry puts texture longitude L at azimuth atan2(sin, -cos) of L+pi */
  const phiTex = Math.atan2(Math.sin(lon + Math.PI), -Math.cos(lon + Math.PI));
  return phiTex - phiPad;
})();
const qOrbit = (() => {
  const r0 = new THREE.Vector3(0, 1, 0);                    // launch radius
  const axisE = EARTH_AXIS;
  const north = axisE.clone().addScaledVector(r0, -axisE.dot(r0)).normalize();
  const east = new THREE.Vector3().crossVectors(axisE, r0).normalize();
  /* Launch bearing. A vertical launch from latitude L reaches inclination
     |sin(A)| cos(L) - due north gives a 90 deg polar orbit, due east gives
     exactly L - so inverting yields the north-north-east bearing the R-7
     used from Baikonur: 37.5 deg. */
  const azim = Math.asin(clamp(Math.cos(ORBIT_INC) / Math.cos(LAT_PAD), -1, 1));
  const vhat = new THREE.Vector3().copy(north).multiplyScalar(Math.cos(azim))
                .addScaledVector(east, Math.sin(azim)).normalize();
  /* The orbital normal must be perpendicular to BOTH the launch radius and
     the launch direction; that pins it exactly and keeps the basis
     orthonormal. */
  const n = new THREE.Vector3().crossVectors(vhat, r0).normalize();
  if (n.dot(axisE) < 0) n.negate();
  const z = new THREE.Vector3().crossVectors(n, r0).normalize();      // flight azimuth
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(n, r0, z));
})();
const orbitNormal = new THREE.Vector3(1, 0, 0).applyQuaternion(qOrbit);
const orbitPivot = new THREE.Group();     // capsule's orbital frame
scene.add(earthGroup, orbitPivot);

const dayTex = texLoader.load(TEX + 'earth_day.jpg'); dayTex.colorSpace = THREE.SRGBColorSpace;
const nightTex = texLoader.load(TEX + 'earth_night.jpg'); nightTex.colorSpace = THREE.SRGBColorSpace;
const cloudTex = texLoader.load(TEX + 'earth_clouds.png'); cloudTex.colorSpace = THREE.SRGBColorSpace;
const normTex = texLoader.load(TEX + 'earth_normal.jpg'); normTex.colorSpace = THREE.NoColorSpace;
for (const tx of [dayTex, nightTex, cloudTex, normTex]) tx.anisotropy = renderer.capabilities.getMaxAnisotropy();

const SUN_DIR = new THREE.Vector3(0.62, 0.55, 0.56).normalize();
const earthMat = new THREE.MeshStandardMaterial({
  map: dayTex, normalMap: normTex,
  normalScale: new THREE.Vector2(0.9, 0.9),
  roughness: 0.92, metalness: 0.0,
  emissive: 0xffffff, emissiveMap: nightTex, emissiveIntensity: 1.0,
  transparent: true, opacity: 0,
});
/* Only light the city lights on the night side - and give the day side a
   boost: the sun term alone runs through the Lambert 1/pi and ACES, which
   crushed a ~0.2-albedo steppe to murky grey at the intensity the vehicle
   looks right at. A plain three.js light cannot be scoped to one object,
   so the planet's extra daylight lives here instead. */
earthMat.onBeforeCompile = (sh) => {
  sh.uniforms.uSunW = { value: SUN_DIR };
  sh.uniforms.uDayBoost = { value: 0.75 };
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uSunW;\nuniform float uDayBoost;\nvarying vec3 vWPos;')
    .replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n' +
      '  float ndl = dot( normalize( vWPos ), normalize( uSunW ) );\n' +
      '  totalEmissiveRadiance *= smoothstep( 0.10, -0.22, ndl );\n' +
      '  totalEmissiveRadiance += texture2D( map, vMapUv ).rgb * uDayBoost * smoothstep( 0.06, 0.38, ndl );');
};
const earthMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), earthMat);
earthGroup.add(earthMesh);

const cloudMat = new THREE.MeshStandardMaterial({
  map: cloudTex, transparent: true, opacity: 0, depthWrite: false, roughness: 1, metalness: 0,
});
const cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), cloudMat);
cloudMesh.scale.setScalar(1.012);
earthGroup.add(cloudMesh);

/* limb glow */
const atmoMat = new THREE.ShaderMaterial({
  transparent: true, side: THREE.BackSide, depthWrite: false, fog: false,
  blending: THREE.AdditiveBlending,
  uniforms: { uSun: { value: SUN_DIR }, uOpacity: { value: 0 } },
  vertexShader: /* glsl */`
    varying vec3 vN; varying vec3 vV;
    void main() {
      vN = normalize( mat3( modelMatrix ) * normal );
      vec4 wp = modelMatrix * vec4( position, 1.0 );
      vV = normalize( cameraPosition - wp.xyz );
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 uSun; uniform float uOpacity; varying vec3 vN; varying vec3 vV;
    void main() {
      float rim = pow( 1.0 - abs( dot( normalize( vN ), normalize( vV ) ) ), 2.6 );
      float lit = smoothstep( -0.45, 0.35, dot( normalize( vN ), normalize( uSun ) ) );
      vec3 col = mix( vec3( 0.10, 0.22, 0.55 ), vec3( 0.42, 0.66, 1.0 ), rim );
      gl_FragColor = vec4( col * rim * ( 0.35 + lit * 0.9 ), rim * uOpacity );
    }`,
});
const atmoMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), atmoMat);
atmoMesh.scale.setScalar(1.055);
earthGroup.add(atmoMesh);

/* ==================================================================== *
 *  rocket
 * ==================================================================== */
const rocket = new THREE.Group();          // gltf.scene gets added here
orbitPivot.add(rocket);
const parts = {};
let capsule = null;

new GLTFLoader().load(GLB, (gltf) => {
  rocket.add(gltf.scene);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false; o.receiveShadow = false;
    /* the capsule ships as a fairly shiny metal; tone it down so the grey
       dome reads in orbit instead of going black at grazing angles */
    if (o.name === 'Vostok_Capsule' && o.material) {
      o.material.metalness = 0.3; o.material.roughness = 0.5;
    }
    parts[o.name] = o;
  });
  /* the capsule is a multi-primitive mesh, so the loader wraps it in a
     group named after the node - fetch it by node name rather than from
     the mesh-only parts map, and pull its child meshes back OUT of parts:
     the visibility logic below keys on part names and would hide them */
  capsule = gltf.scene.getObjectByName('Vostok_Capsule');
  if (capsule) {
    capsule.traverse((o) => { if (o.isMesh && parts[o.name]) delete parts[o.name]; });
  }
  /* Every jettisoned part drifts along its OWN radial direction, measured
     from its baked geometry. (The old code guessed one shared angle per
     index and yawed each booster by it, which stacked two strap-ons onto
     the same azimuth and left two gaps in the ring.) */
  for (const name in SEP) {
    const o = parts[name];
    if (!o || SEP[name].kind !== 'booster' || !o.geometry) continue;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const c = o.geometry.boundingBox.getCenter(new THREE.Vector3());
    SEP[name].ang = Math.atan2(c.z, c.x);
  }
  rocket.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  ready = true;
  prewarmSmoke(T);
}, undefined, (err) => showErr('rocket: ' + err));

/* staging offsets, in the rocket's own frame */
const SEP = {};
for (let i = 1; i <= 4; i++) {
  SEP['Booster_' + i] = { t0: T_BOOST_SEP, kind: 'booster', ang: 0 };
  SEP['Fin_' + i] = { t0: T_BOOST_SEP, kind: 'booster', ang: 0 };
}
/* The shroud is jettisoned at T+151 s, well BEFORE the core stage lets go at
   T+300 s - previously these were bundled together and the shroud came off
   next to orbital insertion, which is nothing like how the flight ran. */
SEP['Payload_Fairing'] = { t0: T_FAIR_SEP, kind: 'upper' };
/* At T+300 s the core - the rest of stage one after the strap-ons went - shuts
   down and is left behind, taking the interstage truss with it. Neither
   Core_Stage1 nor the truss had an entry here, so both stayed attached for
   the whole flight. */
SEP['Core_Stage1'] = { t0: T_CORE_SEP, kind: 'core' };
SEP['Lattice_Frame'] = { t0: T_CORE_SEP, kind: 'core' };
/* The Block-E is the last stage: it keeps burning to insertion and only lets
   the spacecraft go at T+686 s, handled by the inOrbit cutoff. */

/* ==================================================================== *
 *  exhaust: flame + smoke
 *
 *  The plume is two shader cones - a bright inner core with shock
 *  diamonds and a turbulent outer sheath. Both share one GLSL pair:
 *  the vertex stage wobbles the silhouette and blooms the cone wider
 *  as the air thins; the fragment stage layers FBM noise scrolling
 *  down the plume over a white-hot -> orange -> dull-red ramp, with a
 *  view-angle falloff so the volume reads bright through the middle.
 * ==================================================================== */
const exhaust = new THREE.Group();
scene.add(exhaust);   // re-posed onto the vehicle every frame

function flameMaterial(core, len, freq, slope) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    side: THREE.FrontSide,   // back faces double-add against the front ones
                             // and moire into a fishnet - front only, both
                             // layers
    blending: THREE.AdditiveBlending, fog: false,
    uniforms: {
      uTime: { value: 0 }, uT: { value: 0 },
      uWide: { value: 0 },              // 0 at the pad .. 1 near vacuum
      uCore: { value: core }, uLen: { value: len },
      /* interior-noise frequency, in cells per scene unit, scaled to the
         plume's girth: the fat main cone can carry fine turbulence, but a
         narrow nozzle jet needs a longer wavelength */
      uFreq: { value: freq },
      /* cone slope (base radius / length): lets the shader build the TRUE
         analytic cone normal - the mesh normals interpolate linearly across
         each quad and the two split triangles crease along the diagonal,
         which reads as a visible triangle lattice on the plume */
      uSlope: { value: slope },
    },
    vertexShader: /* glsl */`
      uniform float uTime; uniform float uWide; uniform float uLen; uniform float uSlope;
      varying vec2 vUv; varying vec3 vPos; varying vec3 vN; varying vec3 vMV;
      void main() {
        vUv = uv; vPos = position;
        /* a plain smooth cone: turbulence lives in the fragment stage, and
           the vacuum bloom is a mesh scale (the normalMatrix keeps normals
           correct under non-uniform scaling - displacing vertices here
           without recomputing normals read as a triangle grid) */
        vec3 nModel = normalize( vec3( position.x, uSlope * length( position.xz ), position.z ) );
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
        vMV = mv.xyz;
        vN = normalize( normalMatrix * nModel );
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uT; uniform float uWide; uniform float uCore; uniform float uLen; uniform float uFreq;
      varying vec2 vUv; varying vec3 vPos; varying vec3 vN; varying vec3 vMV;
      float hash( vec3 p ) {
        p = fract( p * 0.3183099 + vec3( 0.1, 0.17, 0.13 ) );
        p *= 17.0;
        return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
      }
      /* gradient (Perlin) noise: quintic interpolation keeps the field
         C2-smooth, so no interpolation creases show under additive blending */
      vec3 hash3( vec3 p ) {
        p = vec3( dot( p, vec3( 127.1, 311.7, 74.7 ) ),
                  dot( p, vec3( 269.5, 183.3, 246.1 ) ),
                  dot( p, vec3( 113.5, 271.9, 124.6 ) ) );
        return fract( sin( p ) * 43758.5453123 ) * 2.0 - 1.0;
      }
      float noise( vec3 p ) {
        vec3 i = floor( p ), f = fract( p );
        vec3 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
        return 1.6 * mix(
          mix( mix( dot( hash3( i ), f ),
                    dot( hash3( i + vec3( 1,0,0 ) ), f - vec3( 1,0,0 ) ), u.x ),
               mix( dot( hash3( i + vec3( 0,1,0 ) ), f - vec3( 0,1,0 ) ),
                    dot( hash3( i + vec3( 1,1,0 ) ), f - vec3( 1,1,0 ) ), u.x ), u.y ),
          mix( mix( dot( hash3( i + vec3( 0,0,1 ) ), f - vec3( 0,0,1 ) ),
                    dot( hash3( i + vec3( 1,0,1 ) ), f - vec3( 1,0,1 ) ), u.x ),
               mix( dot( hash3( i + vec3( 0,1,1 ) ), f - vec3( 0,1,1 ) ),
                    dot( hash3( i + vec3( 1,1,1 ) ), f - vec3( 1,1,1 ) ), u.x ), u.y ), u.z );
      }
      float fbm( vec3 p ) {
        float v = 0.0, a = 0.5;
        /* each octave is rotated AND shifted so the lattices never align:
           a plain summed value/gradient field shows its cell grid as a
           regular diamond pattern at plume brightness */
        mat3 R = mat3( 0.8, 0.6, 0.0, -0.6, 0.8, 0.0, 0.0, 0.0, 1.0 );
        for ( int i = 0; i < 6; i++ ) {
          v += a * noise( p );
          p = R * p * 2.13 + vec3( 1.7, 9.2, 4.3 );
          a *= 0.55;
        }
        return v;
      }
      void main() {
        /* position-based, not vUv - ConeGeometry flips v (1 at the apex) */
        float t = clamp( -vPos.y / uLen, 0.0, 1.0 );      // 0 nozzle .. 1 tail
        vec3 N = normalize( vN );
        vec3 V = normalize( -vMV );
        float limbRaw = max( dot( N, V ), 0.0 );
        float limb = pow( limbRaw, 0.65 );                 // bright through the middle
        /* FBM scrolling down the plume, sampled on the position itself:
           seamless around the axis with no atan singularity at the tip,
           which is what fishnetted the narrow nozzle jets */
        float scroll = uTime * ( 2.2 + uCore * 1.6 );
        float n  = fbm( vec3( vPos.x, vPos.y * 1.4 + scroll * 6.0, vPos.z ) * uFreq );
        /* the FBM stays an interior shimmer AND drives the fringe: the
           silhouette fade below is modulated by the same noise, so the
           plume boundary boils instead of sitting as a hard cone edge */
        float edgeW = mix( 0.22, 0.08, uCore ) * ( 0.75 + 0.5 * n );
        float edge = smoothstep( 0.0, edgeW, limbRaw );    // 0 AT the silhouette
        float body = smoothstep( 0.0, 0.05, t ) * ( 1.0 - 0.3 * t )
                   * edge * ( 0.78 + 0.3 * n );
        /* shock diamonds just downstream of the nozzles */
        float dia = exp( -t * ( 6.0 - uCore * 2.0 ) )
                  * pow( 0.5 + 0.5 * sin( t * ( 30.0 - uCore * 8.0 ) - 1.0 ), 2.0 );
        /* white-hot -> yellow -> orange -> dull red */
        vec3 col = mix( vec3( 1.00, 0.98, 0.92 ), vec3( 1.00, 0.85, 0.52 ), smoothstep( 0.02, 0.20, t ) );
        col = mix( col, vec3( 1.00, 0.55, 0.20 ), smoothstep( 0.18, 0.50, t ) );
        col = mix( col, vec3( 0.60, 0.25, 0.09 ), smoothstep( 0.45, 0.95, t ) );
        col = mix( col, vec3( 1.00, 0.97, 0.88 ), dia * ( 0.30 + 0.55 * uCore ) );
        float a  = body * mix( 0.65, 1.00, uCore ) * ( 1.0 - 0.22 * uWide );
        a += dia * limb * mix( 0.15, 0.40, uCore );
        a += ( 1.0 - smoothstep( 0.0, 0.12, t ) ) * limb * mix( 0.30, 0.60, uCore );
        /* ragged, animated tail: the cutoff threshold wanders with the
           noise, so the plume ends in tongues of flame and the base rim
           never shows as a hard circle */
        a *= 1.0 - smoothstep( 0.55, 1.05, t + 0.15 * n );
        gl_FragColor = vec4( col * ( 1.0 + dia * 0.9 ) * uT, a * uT * 1.5 );
        /* a ShaderMaterial skips the built-in tone mapping and sRGB encode -
           without these the plume renders at a fraction of its brightness */
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
/* A slightly truncated cone instead of ConeGeometry: ConeGeometry's apex
   ring collapses 37 vertices onto one point, and the degenerate ring
   mis-rasterises as an alternating-triangle lattice under additive
   blending. A tiny top radius keeps the silhouette identical and renders
   clean. */
function flameCone(r, len, radSeg, hSeg) {
  return new THREE.CylinderGeometry(Math.max(0.02, r * 0.015), r, len, radSeg, hSeg, true);
}
/* Wide enough to cover the four booster nozzles as well as the core. */
const FLAME_LEN = 28;                       // most of the vehicle's length
const FLAME_R = 3.6;
const flameGeo = flameCone(FLAME_R, FLAME_LEN, 48, 24);
flameGeo.translate(0, -FLAME_LEN / 2, 0);   // apex at y=0, plume hanging down
const flameMat = flameMaterial(0, FLAME_LEN, 0.35, FLAME_R / FLAME_LEN);
const flame = new THREE.Mesh(flameGeo, flameMat);
flame.renderOrder = 21;                     // after the smoke: the plume must
exhaust.add(flame);                         // ADD its light over the cloud
/* the hot inner core - narrower, whiter, diamonds at full strength */
const CORE_LEN = 9.0;
const coreGeo = flameCone(2.0, CORE_LEN, 32, 16);
coreGeo.translate(0, -CORE_LEN / 2, 0);
const coreMat = flameMaterial(1, CORE_LEN, 0.6, 2.0 / CORE_LEN);
const flameCore = new THREE.Mesh(coreGeo, coreMat);
flameCore.renderOrder = 20;
exhaust.add(flameCore);
/* the four strap-on nozzles burn alongside the core until they drop at
   T+119 s - one small plume per booster, on the booster's own axis */
const BOOSTER_LEN = 15;
const boosterGeo = flameCone(1.7, BOOSTER_LEN, 32, 14);
boosterGeo.translate(0, -BOOSTER_LEN / 2, 0);
const boosterMat = flameMaterial(0, BOOSTER_LEN, 0.5, 1.7 / BOOSTER_LEN);
const boosterFlames = [];
for (const [bx, bz] of [[2.45, 0], [0, -2.5], [-2.45, 0], [0, 2.4]]) {
  const m = new THREE.Mesh(boosterGeo, boosterMat);
  m.position.set(bx, 0.35, bz);
  /* each jet flares a few degrees outward, the way the strap-on plumes do */
  const ang = Math.atan2(bz, bx);
  const tip = new THREE.Vector3(-Math.sin(ang), 0, Math.cos(ang));
  m.setRotationFromQuaternion(new THREE.Quaternion().setFromAxisAngle(tip, 0.12));
  m.scale.set(1.15, 1, 1.15);         // a touch wider: the edge fade thins it
  m.renderOrder = 21;
  exhaust.add(m);
  boosterFlames.push(m);
}
/* the RD-108's four vernier chambers: small steering jets angled out from
   the core, burning through the whole core-stage burn */
const VER_LEN = 4.5;
const verGeo = flameCone(0.55, VER_LEN, 24, 8);
verGeo.translate(0, -VER_LEN / 2, 0);
const verMat = flameMaterial(1, VER_LEN, 1.0, 0.55 / VER_LEN);
const vernierFlames = [];
for (const ang of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) {
  const m = new THREE.Mesh(verGeo, verMat);
  m.position.set(Math.cos(ang) * 2.1, 0.5, Math.sin(ang) * 2.1);
  const tip = new THREE.Vector3(-Math.sin(ang), 0, Math.cos(ang));
  m.setRotationFromQuaternion(new THREE.Quaternion().setFromAxisAngle(tip, 0.55));
  m.renderOrder = 21;
  m.visible = false;
  exhaust.add(m);
  vernierFlames.push(m);
}
/* the Block-E's RD-0109, hot-staged through the open truss at ~T+294 s and
   burning to orbital insertion at T+676 s. The nozzle sits up at the
   Block-E's base, but once the core is gone the visible jet issues from
   the bottom of the remaining stack (the Stage2 boat-tail at y ~ 20). */
const BLE_LEN = 14;
const bleGeo = flameCone(1.6, BLE_LEN, 32, 14);
bleGeo.translate(0, -BLE_LEN / 2, 0);
const bleMat = flameMaterial(1, BLE_LEN, 0.55, 1.6 / BLE_LEN);
const bleFlame = new THREE.Mesh(bleGeo, bleMat);
bleFlame.position.set(0, 20.2, 0);
bleFlame.renderOrder = 21;
bleFlame.visible = false;
exhaust.add(bleFlame);

function puffTexture() {
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.45, 'rgba(255,255,255,.55)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const puffTex = puffTexture();

/* Bright exhaust core. depthTest is off on purpose: the plume fires down
   into the pad's flame trench, so without this the whole exhaust is hidden
   behind the deflector. */
const glowMat = new THREE.SpriteMaterial({
  map: puffTex, transparent: true, depthWrite: false, depthTest: false,
  blending: THREE.AdditiveBlending, color: new THREE.Color(1.0, 0.70, 0.32),
  opacity: 0,
});
const glow = new THREE.Sprite(glowMat);
/* the pyrotechnic flash fired when the spacecraft separates at T+688 s,
   plus a real light so the hardware catches it */
const sepFlashMat = new THREE.SpriteMaterial({
  map: puffTex, transparent: true, depthWrite: false, depthTest: false,
  blending: THREE.AdditiveBlending, color: new THREE.Color(1.0, 0.82, 0.5), opacity: 0,
});
const sepFlash = new THREE.Sprite(sepFlashMat);
sepFlash.renderOrder = 24;
exhaust.add(sepFlash);
const sepLight = new THREE.PointLight(0xffd9a0, 0, 2500, 2);
sepLight.position.set(0, -4.5, 0);
exhaust.add(sepLight);
glow.renderOrder = 22;
exhaust.add(glow);
/* staging flashes: one sharp pulse of vapour and pyrotechnic light at each
   separation - the "crown" of the Korolev cross at strap-on release, the
   shroud's jettison charge, and the core letting go. Posed in the vehicle
   frame (a child of exhaust), so they ride the gravity turn. */
const stageFlashes = [];
for (const [sy, sc] of [[17, 10], [34, 6], [22, 8]]) {
  const mat = new THREE.SpriteMaterial({
    map: puffTex, transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending, color: new THREE.Color(1.0, 0.85, 0.55),
    opacity: 0,
  });
  const sp = new THREE.Sprite(mat);
  sp.position.set(0, sy, 0);
  sp.scale.setScalar(sc);
  sp.renderOrder = 23;
  sp.visible = false;
  exhaust.add(sp);
  stageFlashes.push({ sp, mat });
}
/* short flash envelope around a staging instant */
const flareAt = (t0, t) => sstep(t0 - 0.002, t0 + 0.004, t) *
                          (1 - sstep(t0 + 0.015, t0 + 0.055, t));
/* ==================================================================== *
 *  landing: retro plume, re-entry plasma glow, parachute
 *
 *  Unlike the ascent effects these are posed from the capsule's own
 *  blended world position (vehPos after the landing blend), not from the
 *  exhaust group's orbital frame - the descent leaves that frame behind.
 * ==================================================================== */
/* the TDU-1 retro engine: a short, tight kerolox jet firing FORWARD along
   the velocity vector while the capsule flies tail-first */
const RETRO_LEN = 9;
const retroGeo = flameCone(1.0, RETRO_LEN, 24, 12);
retroGeo.translate(0, -RETRO_LEN / 2, 0);
const retroMat = flameMaterial(1, RETRO_LEN, 0.6, 1.0 / RETRO_LEN);
const retroFlame = new THREE.Mesh(retroGeo, retroMat);
retroFlame.renderOrder = 21;
retroFlame.visible = false;
scene.add(retroFlame);
/* re-entry plasma: a flickering additive glow hugging the capsule's
   leading face, plus a particle trail handled by updatePlume's entry mode */
const plasmaMat = new THREE.SpriteMaterial({
  map: puffTex, transparent: true, depthWrite: false, depthTest: false,
  blending: THREE.AdditiveBlending, color: new THREE.Color(1.0, 0.46, 0.14),
  opacity: 0,
});
const plasmaGlow = new THREE.Sprite(plasmaMat);
plasmaGlow.renderOrder = 23;
plasmaGlow.visible = false;
scene.add(plasmaGlow);
const plasmaLight = new THREE.PointLight(0xff8840, 0, 300, 2);
scene.add(plasmaLight);
/* the main canopy: Vostok's dome was ~24 m across, so ~12 units radius at
   pad scale. Radial orange/white gores on a canvas texture. */
function chuteTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 64;
  const g = c.getContext('2d');
  for (let i = 0; i < 16; i++) {
    g.fillStyle = i % 2 ? '#e8662a' : '#f2ede4';
    g.fillRect(i * 32, 0, 32, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
function makeChute(scale) {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(13 * scale, 28, 12, 0, Math.PI * 2, 0, Math.PI * 0.42),
    new THREE.MeshStandardMaterial({
      map: chuteTexture(), side: THREE.DoubleSide, roughness: 0.9, metalness: 0,
      transparent: true,
    })
  );
  dome.position.y = -13 * scale * Math.cos(Math.PI * 0.42);   // rim at group y=0
  g.add(dome);
  const rimR = 13 * scale * Math.sin(Math.PI * 0.42);
  const linePts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    linePts.push(Math.cos(a) * rimR, 0, Math.sin(a) * rimR, 0, -9.5 * scale, 0);
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(linePts), 3));
  const lines = new THREE.LineSegments(lineGeo,
    new THREE.LineBasicMaterial({ color: 0xd8d4cc, transparent: true }));
  g.add(lines);
  g.userData = { dome, lines };
  g.visible = false;
  scene.add(g);
  return g;
}
const chute = makeChute(1);        // the capsule's main canopy
const gagChute = makeChute(0.7);   // Gagarin's personal parachute
/* the cosmonaut himself, built with MakeHuman - loaded once, hidden until
   the ejection at ~7 km */
let cosmonaut = null;
new GLTFLoader().load('./assets/gagarin.glb', (g) => {
  cosmonaut = g.scene;
  cosmonaut.visible = false;
  cosmonaut.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  scene.add(cosmonaut);
}, undefined, (err) => showErr('cosmonaut: ' + err));
const SMOKE_N = 90;
const smoke = [];
for (let i = 0; i < SMOKE_N; i++) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: puffTex, transparent: true, depthWrite: false, opacity: 0,
    color: new THREE.Color(0.90, 0.89, 0.87),
  }));
  sp.visible = false;
  scene.add(sp);
  smoke.push({ sp, age: 1e9, life: 1, vx: 0, vy: 0, vz: 0, s0: 1, s1: 1 });
}
let smokeCursor = 0;
/* ==================================================================== *
 *  plume particles: the turbulent sheath around the shader core
 *
 *  The cone core gives the coherent hypersonic-jet structure (and stays
 *  crisp); the sheath is a spray of additive glow particles that bloom,
 *  shear and break up downstream, so the plume boundary is a living
 *  fringe rather than a cone silhouette. The sim runs in world space,
 *  with the emitter posed from the exhaust group's frame every frame.
 *  Particle life is under a second, so seeks rebuild almost instantly
 *  and no prewarm pass is needed (unlike the long-lived smoke).
 * ==================================================================== */
const PLUME_N = 700;
const plume = {
  pos: new Float32Array(PLUME_N * 3),
  col: new Float32Array(PLUME_N * 3),
  size: new Float32Array(PLUME_N),
  alpha: new Float32Array(PLUME_N),
  vel: new Float32Array(PLUME_N * 3),
  age: new Float32Array(PLUME_N).fill(1e9),
  life: new Float32Array(PLUME_N).fill(1),
  seed: new Float32Array(PLUME_N),
  s0: new Float32Array(PLUME_N),
  s1: new Float32Array(PLUME_N),
  mode: new Uint8Array(PLUME_N),
  cursor: 0, acc: 0,
};
const plumeGeo = new THREE.BufferGeometry();
plumeGeo.setAttribute('position', new THREE.BufferAttribute(plume.pos, 3));
plumeGeo.setAttribute('color', new THREE.BufferAttribute(plume.col, 3));
plumeGeo.setAttribute('aSize', new THREE.BufferAttribute(plume.size, 1));
plumeGeo.setAttribute('aAlpha', new THREE.BufferAttribute(plume.alpha, 1));
const plumeMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  uniforms: { uTex: { value: puffTex } },
  vertexShader: /* glsl */`
    attribute float aSize; attribute float aAlpha;
    varying float vA; varying vec3 vC;
    void main() {
      vC = color; vA = aAlpha;
      vec4 mv = modelViewMatrix * vec4( position, 1.0 );
      gl_PointSize = aSize * ( 300.0 / max( 1.0, -mv.z ) );
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D uTex; varying float vA; varying vec3 vC;
    void main() {
      vec4 t = texture2D( uTex, gl_PointCoord );
      gl_FragColor = vec4( vC * t.rgb, t.a * vA );
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  vertexColors: true,
});
const plumePts = new THREE.Points(plumeGeo, plumeMat);
plumePts.frustumCulled = false;
plumePts.renderOrder = 20;        // the cone core adds its light over the spray
scene.add(plumePts);

const _plumeOff = new THREE.Vector3(), _plumeDir = new THREE.Vector3();
const _plumeSide = new THREE.Vector3();
/* entry = { pow, pos, dir, scale }: the re-entry plasma trail. Emitted
   around the capsule's leading face with almost no jet speed - the capsule
   is moving, so the particles fall behind on their own and the turbulence
   tears the trail apart. */
function updatePlume(dt, thr, boThr, bleThr, wide, entry) {
  /* pick the active emitter: the base cluster while the core/boosters burn
     (the ring widens while the strap-ons are on), the Block-E nozzle at the
     bottom of the remaining stack during the third-stage burn */
  let power = 0, offY = 0.6, emitR = 1.1, jet = 46, mode = 0;
  if (thr > 0.02) {
    power = thr;
    emitR = boThr > 0.02 ? 2.3 : 1.1;
  }
  if (bleThr > 0.02) { power = bleThr; offY = 20.2; emitR = 0.9; jet = 26; }
  if (entry.pow > 0.02) {
    power = entry.pow; mode = 1; jet = 2.5; emitR = 1.2 * entry.scale;
  }
  if (power > 0) {
    if (mode === 0) _plumeDir.set(0, -1, 0).applyQuaternion(exhaust.quaternion);
    else _plumeDir.copy(entry.dir);
    plume.acc += power * (mode === 0 ? 430 : 300) * dt;
    while (plume.acc >= 1) {
      plume.acc -= 1;
      const i = plume.cursor; plume.cursor = (plume.cursor + 1) % PLUME_N;
      const ang = Math.random() * Math.PI * 2;
      const rr = emitR * Math.sqrt(Math.random());
      if (mode === 0) {
        _plumeOff.set(Math.cos(ang) * rr, offY, Math.sin(ang) * rr)
                .applyQuaternion(exhaust.quaternion);
        plume.pos[i * 3]     = exhaust.position.x + _plumeOff.x;
        plume.pos[i * 3 + 1] = exhaust.position.y + _plumeOff.y;
        plume.pos[i * 3 + 2] = exhaust.position.z + _plumeOff.z;
        _plumeSide.set(Math.cos(ang), 0, Math.sin(ang)).applyQuaternion(exhaust.quaternion);
      } else {
        /* a small sphere around the leading face, drift mostly backwards */
        _plumeOff.set((Math.random() - 0.5) * 2 * emitR,
                      (Math.random() - 0.5) * 2 * emitR,
                      (Math.random() - 0.5) * 2 * emitR);
        plume.pos[i * 3]     = entry.pos.x + entry.dir.x * emitR + _plumeOff.x;
        plume.pos[i * 3 + 1] = entry.pos.y + entry.dir.y * emitR + _plumeOff.y;
        plume.pos[i * 3 + 2] = entry.pos.z + entry.dir.z * emitR + _plumeOff.z;
        _plumeSide.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      }
      const spread = (mode === 0 ? (2.0 + wide * 5) : 2.0 * entry.scale) * (0.4 + Math.random());
      const jv = jet * (0.85 + Math.random() * 0.3);
      const jdir = mode === 0 ? 1 : -1;   // the trail streams backwards
      plume.vel[i * 3]     = _plumeDir.x * jv * jdir + _plumeSide.x * spread;
      plume.vel[i * 3 + 1] = _plumeDir.y * jv * jdir + _plumeSide.y * spread;
      plume.vel[i * 3 + 2] = _plumeDir.z * jv * jdir + _plumeSide.z * spread;
      plume.age[i] = 0;
      plume.life[i] = mode === 0 ? 0.35 + Math.random() * 0.5 : 0.5 + Math.random() * 0.8;
      plume.seed[i] = Math.random() * 100;
      plume.mode[i] = mode;
      plume.s0[i] = (mode === 0 ? 1.2 : 1.6 * entry.scale) + Math.random() * 1.4;
      plume.s1[i] = plume.s0[i] * (mode === 0 ? (2.0 + wide * 1.5) : (2.5 + Math.random() * 1.5));
    }
  }
  for (let i = 0; i < PLUME_N; i++) {
    if (plume.age[i] > plume.life[i]) {
      if (plume.alpha[i] !== 0) plume.alpha[i] = 0;
      continue;
    }
    plume.age[i] += dt;
    const k = plume.age[i] / plume.life[i];
    /* drag + turbulence that grows with age: laminar at the nozzle,
       shearing and breaking up downstream */
    const drag = Math.pow(0.90, dt * 60);
    const sd = plume.seed[i];
    const turb = (2 + wide * 8) * k;
    plume.vel[i * 3]     = plume.vel[i * 3] * drag +
        Math.sin(plume.pos[i * 3 + 1] * 0.4 + NOW * 3.3 + sd) * turb * dt * 12;
    plume.vel[i * 3 + 1] = plume.vel[i * 3 + 1] * drag +
        Math.sin(plume.pos[i * 3 + 2] * 0.4 + NOW * 2.7 + sd * 1.7) * turb * dt * 6;
    plume.vel[i * 3 + 2] = plume.vel[i * 3 + 2] * drag +
        Math.cos(plume.pos[i * 3] * 0.4 + NOW * 3.9 + sd * 0.7) * turb * dt * 12;
    plume.pos[i * 3]     += plume.vel[i * 3] * dt;
    plume.pos[i * 3 + 1] += plume.vel[i * 3 + 1] * dt;
    plume.pos[i * 3 + 2] += plume.vel[i * 3 + 2] * dt;
    if (plume.mode[i] === 0) {
      /* white-hot -> orange -> dull red */
      const c1 = sstep(0.05, 0.4, k), c2 = sstep(0.35, 1.0, k);
      plume.col[i * 3]     = 1.0;
      plume.col[i * 3 + 1] = lerp(0.95, lerp(0.50, 0.16, c2), c1);
      plume.col[i * 3 + 2] = lerp(0.82, lerp(0.14, 0.05, c2), c1);
      plume.alpha[i] = Math.sin(Math.PI * Math.min(1, k * 1.12)) * 0.7 * (1 - 0.25 * wide);
    } else {
      /* plasma: orange-white at birth, cooling to dark embers */
      const c2 = sstep(0.15, 1.0, k);
      plume.col[i * 3]     = 1.0;
      plume.col[i * 3 + 1] = lerp(0.62, 0.10, c2);
      plume.col[i * 3 + 2] = lerp(0.30, 0.03, c2);
      plume.alpha[i] = Math.sin(Math.PI * Math.min(1, k * 1.06)) * 0.85;
    }
    plume.size[i] = lerp(plume.s0[i], plume.s1[i], k);
  }
  plumeGeo.attributes.position.needsUpdate = true;
  plumeGeo.attributes.color.needsUpdate = true;
  plumeGeo.attributes.aSize.needsUpdate = true;
  plumeGeo.attributes.aAlpha.needsUpdate = true;
}
/* ==================================================================== *
 *  camera rig
 *
 *  During the ascent the camera is defined RELATIVE to the rocket's base, so
 *  framing cannot drift away from it however the altitude curve behaves.
 *  From t=0.70 it hands over to a slow orbital chase around the Earth.
 * ==================================================================== */
// [t, camOffsetFromRocketBase, targetOffsetFromRocketBase]
const CAM_OFF = [
  [0.000, [-50, 9, 84], [0, 9, 0]],
  [0.055, [-46, 12, 78], [0, 12, 0]],
  [0.115, [-44, 13, 74], [0, 15, 0]],
  [0.200, [-46, 14, 78], [0, 17, 0]],
  [0.320, [-42, 13, 72], [0, 17, 0]],
  [0.420, [-38, 12, 64], [0, 16, 0]],
  [0.510, [-33, 11, 55], [0, 15, 0]],
  [0.560, [-30, 10, 50], [0, 15, 0]],
];
const CAP_LOCAL_Y = 34.35;   // capsule centre in the rocket's own frame (31.65..37.05)
const camPos = new THREE.Vector3(), camTgt = new THREE.Vector3();
const _veh = new THREE.Vector3(), _cwp = new THREE.Vector3(), _qa = new THREE.Quaternion();
const _ax = new THREE.Vector3(), _fw = new THREE.Vector3();
const exhOrigin = new THREE.Vector3();
const AXIS_X = new THREE.Vector3(1, 0, 0), UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _f = new THREE.Vector3(), _g = new THREE.Vector3();
const _sepTip = new THREE.Vector3();   // staging: tangential axis of a jettisoned part
const _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion();
const _qAtt = new THREE.Quaternion();
const _landPos = new THREE.Vector3(), _landNext = new THREE.Vector3();
const _landAxis = new THREE.Vector3(), _lc = new THREE.Vector3();

/* Camera handover to the orbital chase. Starting at insertion (T_ORBIT)
 * rather than at spacecraft separation: the orbit pose is thousands of
 * units from the planet centre, so blending into it while the ascent rig
 * is still running drags the camera off the vehicle. The capsule holds the
 * close framing through the Block-E burn, then the chase begins. */
const orbBlendAt = (t) => sstep(T_ORBIT, T_ORBIT + 0.12, t);
/* the capsule mesh snaps to the vehicle origin exactly at separation */
const capSnapAt = (t) => sstep(T_SEP, T_SEP + 0.02, t);
function cameraRig(t, h, RE, a, surfY, vehPos, capWorld, axis) {
  let idx = 0;
  if (t <= CAM_OFF[0][0]) idx = 0;
  else {
    for (let i = 1; i < CAM_OFF.length; i++) { if (t <= CAM_OFF[i][0]) { idx = i - 1; break; } }
    if (t > CAM_OFF[CAM_OFF.length - 1][0]) idx = CAM_OFF.length - 2;
  }
  const A = CAM_OFF[idx], B = CAM_OFF[Math.min(idx + 1, CAM_OFF.length - 1)];
  const k = B === A ? 0 : sstep(A[0], B[0], t);
  _a.set(...A[1]).lerp(_b.set(...B[1]), k).add(vehPos);   // ride with the vehicle
  camPos.copy(_a);
  _a.set(...A[2]).lerp(_b.set(...B[2]), k).add(vehPos);
  camTgt.copy(_a);

  /* Once the core stage is gone the vehicle is just the Block-E and the
     capsule, so the rig stops tracking the (now meaningless) rocket base and
     follows the capsule itself, tightening onto it. */
  const followCap = sstep(T_CORE_SEP, T_CORE_SEP + 0.05, t);
  if (followCap > 0) {
    /* Frame what is actually left, not the capsule alone: once the core is
       gone the second stage plus Block-E is still ~25 units tall, so a
       15-unit standoff just filled the frame with a blur. */
    const axDir = _ax.set(0, Math.cos(axis), Math.sin(axis)).applyQuaternion(qOrbit);
    const focus = _fw.copy(vehPos).addScaledVector(axDir, 22);
    camPos.lerp(_a.set(-34, 17, 52).add(focus), followCap);
    camTgt.lerp(focus, followCap);
  }

  /* hand over to the orbital chase.
     The camera is placed roughly radially outside the capsule (tilted back a
     little) so the Earth sits BEHIND it - otherwise the globe ends up beside
     the frame instead of behind the subject. */
  const orb = orbBlendAt(t);
  if (orb > 0) {
    const centre = _b.copy(earthGroup.position);
    const capR = RE + (h - surfY);
    /* sit radially outside the capsule, tilted back, so the globe is behind it */
    const capUp = _c.copy(capWorld).sub(centre).normalize();
    const right = _d.crossVectors(capUp, orbitNormal).normalize();
    const wantDir = _e.copy(capUp).applyAxisAngle(right, 0.55).normalize();
    // rotate the capsule's orbit-pivot position, then move to world space
    const cap = _f.copy(capWorld);
    /* Blend RADIUS and DIRECTION, not raw position. The orbit pose sits
       thousands of units away, so lerping the position yanks the camera
       clean off the vehicle as soon as the blend is even 7% non-zero. */
    const curDir = _g.copy(camPos).sub(centre);
    const curR = Math.max(curDir.length(), 1e-3);
    curDir.divideScalar(curR);
    const R = lerp(curR, capR * 1.55, orb);
    const dir = _g.lerp(wantDir, orb).normalize();
    camPos.copy(centre).addScaledVector(dir, R);
    camTgt.lerp(cap, orb);
  }
}

/* ==================================================================== *
 *  UI
 * ==================================================================== */
const seek = document.getElementById('seek');
const phaseEl = document.getElementById('phase');
const clockEl = document.getElementById('clock');
const altEl = document.getElementById('alt');
const velEl = document.getElementById('vel');
const accEl = document.getElementById('acc');
const massEl = document.getElementById('mass');
const rangeEl = document.getElementById('range');
const compEl = document.getElementById('comp');
const tOrbitEl = document.getElementById('tOrbit');
const tIncEl = document.getElementById('tInc');
const tPeApEl = document.getElementById('tPeAp');
const tDarkEl = document.getElementById('tDark');
const playBtn = document.getElementById('play');
let RATE = 1;
for (const b of document.getElementById('rateBtns').querySelectorAll('button')) {
  b.addEventListener('click', () => {
    RATE = +b.dataset.rate;
    for (const o of b.parentNode.children) o.classList.toggle('on', o === b);
  });
}
const autoBtn = document.getElementById('auto');
const freeBtn = document.getElementById('free');
const loadEl = document.getElementById('load');
const camModeEl = document.getElementById('camMode');

(function buildMarks() {
  const box = document.getElementById('marks');
  for (const [t, name] of PHASES) {
    /* bare tick + tooltip: the early events cluster in the first quarter of
       the timeline, and text labels there overlap into an unreadable jumble */
    const i = document.createElement('i');
    i.style.left = (t * 100) + '%';
    i.title = name.replace(/\s{2}-\s{2}/, ' - ');
    box.appendChild(i);
  }
})();

let T = 0, playing = true, freeCam = false, ready = false;

/* deep links: ?t=0.62 jumps to a moment, ?play=0 freezes it there */
const QS = new URLSearchParams(location.search);
if (QS.has('t')) T = clamp(parseFloat(QS.get('t')) || 0);
if (QS.get('play') === '0') playing = false;

playBtn.onclick = () => { playing = !playing; playBtn.innerHTML = playing ? '&#9199; play' : '&#9193; pause'; };
document.getElementById('restart').onclick = () => { T = 0; playing = true; playBtn.innerHTML = '&#9199; play'; };
seek.addEventListener('input', () => { T = +seek.value / 1000; playing = false; prewarmSmoke(T); playBtn.innerHTML = '&#9193; pause'; });
function setCam(free) {
  freeCam = free;
  controls.enabled = free;
  autoBtn.classList.toggle('on', !free);
  freeBtn.classList.toggle('on', free);
  camModeEl.textContent = free ? 'free' : 'auto';
  if (free) { controls.target.copy(camTgt); controls.update(); }
}
autoBtn.onclick = () => setCam(false);
freeBtn.onclick = () => setCam(true);
setCam(false);

addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); playBtn.click(); }
  if (e.key === 'r' || e.key === 'R') document.getElementById('restart').click();
  if (e.key === 'c' || e.key === 'C') setCam(!freeCam);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ==================================================================== *
 *  per-frame update
 * ==================================================================== */
const tmp = new THREE.Vector3();
let smokeAcc = 0;
let dustFired = false;             // one-shot dust burst at touchdown
let NOW = 0;                      // shader clock for the exhaust flow

/* ---- exhaust smoke simulation -------------------------------------- *
 * Kept separate from applyTimeline so it can be stepped independently:
 * the render loop only advances it by real dt, which on a slow GPU would
 * take many seconds of wall clock to build a visible cloud. prewarmSmoke()
 * fast-forwards the same code so seeking to a time shows the cloud that
 * would actually be there.
 * -------------------------------------------------------------------- */
/* The RD-108 core keeps burning after the strap-ons drop, so thrust is only
   cut at core-stage separation (T+300 s), not at booster separation. */
function throttleAt(t) {
  return sstep(T_IGNITE, T_IGNITE + 0.02, t) *
         (1 - sstep(T_CORE_SEP - 0.015, T_CORE_SEP + 0.025, t));
}

function updateSmoke(t, dt, dark) {
  if (ready && throttleAt(t) > 0.03) {
    /* Puffs are born at the vehicle's own base, so on the pad they billow
       across the deck and once it is climbing they trail behind it instead
       of hanging over the launch site. They shrink and tighten with height
       so the plume never swallows the rocket. */
    const base = exhOrigin;
    /* the trail is keyed to the claimed ALTITUDE: it tightens hard as the
       air thins and stops being produced above ~65 km, so it never reads
       as a bright cloud hanging in space */
    const hi = keyframe(t, ALT_KM);
    const thin = lerp(1, 0.10, sstep(12, 55, hi));
    const rate = lerp(70, 0, sstep(30, 65, hi));
    smokeAcc += rate * dt;
    while (smokeAcc >= 1) {
      smokeAcc -= 1;
      const spread = lerp(6, 22, sstep(0.12, 0.3, t)) * thin;
      const ang = Math.random() * Math.PI * 2;
      const rad = spread * (0.35 + Math.random() * 0.75);
      const p = smoke[smokeCursor];
      smokeCursor = (smokeCursor + 1) % SMOKE_N;
      p.age = 0; p.life = lerp(3.2, 7, sstep(0.1, 0.3, t));
      p.sp.position.copy(base);
      p.sp.position.x += Math.cos(ang) * rad;
      p.sp.position.y += 0.5 + Math.random() * 3.5;
      p.sp.position.z += Math.sin(ang) * rad;
      p.vx = Math.cos(ang) * lerp(2, 9, sstep(0.1, 0.3, t)) * thin;
      p.vz = Math.sin(ang) * lerp(2, 9, sstep(0.1, 0.3, t)) * thin;
      p.vy = lerp(2, 7, sstep(0.1, 0.32, t)) * thin;
      p.s0 = lerp(3, 9, sstep(0.1, 0.3, t)) * thin;
      p.s1 = p.s0 * (5 + Math.random() * 4);
      p.sp.material.color.setRGB(0.90, 0.89, 0.87);   // exhaust grey (the
      p.sp.visible = true;                            // touchdown dust reuses
                                                      // the pool in tan)
    }
  }
  for (const p of smoke) {
    if (p.age > p.life) { if (p.sp.visible) p.sp.visible = false; continue; }
    p.age += dt;
    const k = p.age / p.life;
    p.sp.position.x += p.vx * dt;
    p.sp.position.y += p.vy * dt;
    p.sp.position.z += p.vz * dt;
    const damp = Math.pow(0.985, dt * 60);
    p.vy *= damp; p.vx *= damp; p.vz *= damp;
    const s = lerp(p.s0, p.s1, k);
    p.sp.scale.setScalar(s);
    /* the trail fades out fast once the air does, so it does not read as a
       bright cloud hanging around at 90 km */
    p.sp.material.opacity = Math.sin(Math.PI * Math.min(1, k * 1.02)) * 0.75 * (1 - dark * 0.97);
  }
}

/* Rebuild the cloud for time t without waiting in real time.
   The timeline runs 0..1 over DURATION seconds, while the particles
   integrate in real seconds, so each sub-step advances the sim by
   50 ms of wall clock and steps the timeline by the matching amount. */
function prewarmSmoke(t) {
  if (t <= T_IGNITE) return;
  const dtSub = 0.05;                 // same clamp the render loop uses
  const step = dtSub / DURATION;      // timeline units per sub-step
  for (let s = T_IGNITE; s < t; s += step) updateSmoke(s, dtSub, 0);
}

function applyTimeline(t, dt) {
  const RE = earthRadius(t);
  const h = worldAlt(t);
  const dark = skyDark(t);
  const a = orbitAngle(t);
  const altKm = keyframe(t, ALT_KM);

  /* --- sky / light --- */
  skyUni.uDark.value = dark;
  starsMat.uniforms.uOpacity.value = Math.pow(dark, 1.4) * 0.95;
  hemi.intensity = lerp(0.55, 0.02, dark);
  scene.environmentIntensity = lerp(0.30, 0.12, dark);
  sun.intensity = lerp(3.1, 3.6, dark);

  /* --- horizon haze --- */
  const fogAmt = (1 - sstep(10, 55, keyframe(t, ALT_KM))) * (1 - sstep(0.66, 0.74, t));
  scene.fog.near = lerp(320, 2e7, 1 - fogAmt);
  scene.fog.far = lerp(9000, 4e7, 1 - fogAmt);
  scene.fog.color.setRGB(lerp(0.81, 0.02, dark), lerp(0.89, 0.02, dark), lerp(0.95, 0.04, dark));

  /* --- ground + pad --- */
  /* The flat ground plane is replaced by the real Earth at T_REVEAL_A, but
     leaving it opaque until then leaves a razor-straight horizon under a
     black sky, so fade it out between 35 and 70 km - overlapping the
     globe's fade-in so the two cross-fade instead of blinking. */
  const gFade = 1 - sstep(40, 75, keyframe(t, ALT_KM));
  groundMat.opacity = gFade;
  groundMat.transparent = true;
  /* the ground below falls away into darkness as the air thins - by strap-on
     separation (47 km) it must read as a dim, hazy plain, not noon steppe */
  const gDark = 1 - 0.85 * sstep(12, 50, keyframe(t, ALT_KM));
  groundMat.color.setScalar(gDark);
  /* No timer: the pad stays drawn for as long as the geometry can put it on
     screen, so how long you see it is set by how far the vehicle has actually
     climbed rather than by a cut-off. It goes once the steppe it stands on is
     gone. */
  pad.visible = gFade > 0.02;

  /* The vehicle is held down until it actually rises: the four support
     arms clamp through the ignition sequence, then withdraw OUTWARD about
     their hinges in the instant of lift-off - the clamp end swings away
     from the rocket and comes to rest outboard, its pad still a good
     hand's-breadth above the deck - while the tower's umbilical arms pull
     back during engine spool-up, before the vehicle moves. */
  const swRetract = sstep(T_IGNITE - 0.02, T_IGNITE + 0.008, t);
  const retract = sstep(T_LIFT - 0.008, T_LIFT + 0.014, t);
  for (const { g } of holdArms) g.rotation.x = -2.1 * retract;
  for (const sw of swingArms) sw.rotation.y = 2.0 * swRetract;

  /* --- earth --- */
  /* The globe turns solid soon after the reveal starts: it is daylight for
     the whole ascent, and a half-transparent planet read as night at T+4.
     The surface anchor and radius keep their longer window below. */
  const eFade = sstep(T_REVEAL_A - 0.008, T_REVEAL_A + 0.075, t);
  /* reverse of the ascent cross-fade: once the capsule is back below ~75 km
     on the way down, the globe dissolves and the flat steppe returns
     (groundMat's gFade below already reverses on the same altitude band) */
  const eFadeOut = sstep(T_ENTRY, T_CHUTE, t) * (1 - sstep(40, 75, altKm));
  earthMat.opacity = eFade * (1 - eFadeOut);
  earthMat.transparent = true;
  cloudMat.opacity = eFade * (1 - eFadeOut) * 0.92;
  atmoMat.uniforms.uOpacity.value = eFade * (1 - eFadeOut);
  /* The globe's surface starts level with the steppe and eases to the true
     orbital ratio by T_REVEAL_B. Anchoring the surface (rather than the
     centre) keeps the vehicle's world height equal to h at every t, so the
     ascent stays monotonic while the limb ends up the right shape. */
  const surfY = lerp(-BLOCK_H, h - ORBIT_ALT, sstep(T_REVEAL_A, T_REVEAL_B, t));
  const capR = RE + (h - surfY);              // capsule radius from planet centre
  earthGroup.visible = eFade * (1 - eFadeOut) > 0.002;
  earthGroup.position.set(0, surfY - RE, 0);
  orbitPivot.position.set(0, surfY - RE, 0);
  earthGroup.scale.setScalar(RE);
  /* the globe's own +Y must be the polar axis defined above */
  earthGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), EARTH_AXIS);
  earthGroup.children.forEach((c) => { if (c !== atmoMesh) c.rotation.set(0, 0, 0); });
  earthMesh.rotation.y = earthSpin(t) + SPIN0;
  cloudMesh.rotation.y = (earthSpin(t) + SPIN0) * 1.05;
  /* The capsule rides the pivot's +Y axis, so the orbit has to be driven
     about X. (rotation.y just spun the axis it sits on - a no-op, which is
     why the vehicle never actually travelled and the globe did all the
     moving.) The vehicle's own attitude adds the gravity turn, so its axis
     runs along the flight direction instead of pointing straight up. */
  const pitch = pitchAt(t);
  /* base orbital frame, then the downrange rotation about its own normal */
  orbitPivot.quaternion.copy(qOrbit).multiply(_qa.setFromAxisAngle(AXIS_X, a));
  /* fully reset the rocket's pose every frame: the landing blend below
     overwrites position AND quaternion, so only writing .y / .rotation.x
     here would leave the rocket stranded at the landing site after a
     restart or a seek back to the pad */
  rocket.position.set(0, capR, 0);
  rocket.rotation.set(pitch, 0, 0);
  /* in orbit the capsule is alone; bring it onto the orbit point and scale it
     up so it is legible next to the globe (a declared stylisation) */
  const orbBlend = orbBlendAt(t);
  rocket.scale.setScalar(lerp(1, ORBIT_CAP_SCALE, orbBlend));
  const capLocal = -CAP_LOCAL_Y * capSnapAt(t);
  if (capsule) capsule.position.y = capLocal;
  /* world position of the vehicle base, and of the capsule riding on it */
  const vehPos = _veh.set(0, capR * Math.cos(a), capR * Math.sin(a))
                    .applyQuaternion(qOrbit).add(earthGroup.position);
  const axis = a + pitch;                        // vehicle attitude in world
  const capWorld = _cwp.set(0, capLocal * Math.cos(axis), capLocal * Math.sin(axis))
                        .applyQuaternion(qOrbit).add(vehPos);

  /* --- landing: blend the orbital pose into the scripted descent ------- *
   * From retrofire on, the capsule's world position lerps from the orbital
   * arc onto the descent path (landPose), its attitude goes tail-first for
   * the burn, sphere-first through entry, vertical under the canopy, and
   * the exaggerated orbital display scale shrinks back to pad scale. */
  const landBlend = sstep(T_RETRO, T_ENTRY + 0.03, t);
  const attBlend = sstep(T_RETRO - 0.002, T_RETRO + 0.025, t);
  const capScaleNow = lerp(lerp(1, ORBIT_CAP_SCALE, orbBlend), 1,
                           sstep(T_RETRO, tAtMission(5900), t));
  if (landBlend > 0) {
    rocket.scale.setScalar(capScaleNow);
    landPose(t, _landPos);
    vehPos.lerp(_landPos, landBlend);
    /* re-pose the rocket so the capsule renders at the blended position */
    _qa.copy(qOrbit).multiply(_qb.setFromAxisAngle(AXIS_X, a)).invert();
    rocket.position.copy(vehPos).sub(earthGroup.position).applyQuaternion(_qa);
    /* flight direction from the descent path itself (deterministic) */
    landPose(Math.min(1, t + 0.0015), _landNext).sub(_landPos);
    const fd = _landNext.lengthSq() > 1e-9 ? _landNext.normalize() : _landNext.set(0, -1, 0);
    /* tail-first for the burn (engine, at the mesh's bottom, faces the
       direction of flight so the exhaust shoots forward), a 180-degree flip
       to sphere-first for entry, then hanging vertical under the canopy */
    _landAxis.copy(fd).negate();
    _landAxis.lerp(fd, sstep(T_RETRO_END + 0.01, T_ENTRY - 0.02, t)).normalize();
    _landAxis.lerp(UP, sstep(T_CHUTE - 0.004, T_CHUTE + 0.004, t)).normalize();
    _qAtt.setFromUnitVectors(UP, _landAxis);
    _qc.copy(orbitPivot.quaternion).multiply(_qb.setFromAxisAngle(AXIS_X, pitch));
    _qc.slerp(_qAtt, attBlend);
    rocket.quaternion.copy(_qb.copy(orbitPivot.quaternion).invert().multiply(_qc));
    /* the capsule IS the vehicle by now - the camera targets vehPos */
    if (landBlend > 0.5) capWorld.copy(vehPos);
  } else {
    _landAxis.set(0, -1, 0);
  }

  /* --- staging --- */
  for (const name in SEP) {
    const o = parts[name];
    if (!o) continue;
    const s = SEP[name];
    const k = sstep(s.t0, s.t0 + 0.10, t);
    if (s.kind === 'booster') {
      /* Korolev cross: each strap-on (with its fin) keeps its baked pose
         until release, then tips away about its own tangential axis while
         drifting radially outward and falling behind - the four of them
         bloom into the cross Gagarin's Vzor would have seen */
      const ca = Math.cos(s.ang), sa = Math.sin(s.ang);
      o.position.set(ca * 46 * k, -36 * k * k, sa * 46 * k);
      _sepTip.set(-sa, 0, ca);
      o.quaternion.setFromAxisAngle(_sepTip, -0.55 * k);
      o.rotateY(0.3 * k);
    } else if (s.kind === 'core') {
      o.position.set(0, -70 * k, 0);          // falls away behind the vehicle
      o.rotation.set(0.4 * k, 0, -0.22 * k);
    } else {
      /* the shroud's pyrotechnics blow it clear sideways; it peels off and
         tumbles, it does not slide forward past the capsule's nose */
      o.position.set(26 * k, 18 * k, 9 * k);
      o.rotation.set(0.25 * k, 0, 0.8 * k);
    }
  }
  /* Spacecraft separation at T+688 s: the capsule snaps onto the orbit
     point, and the SPENT UPPER STAGE stays in view - it keeps its shape
     relative to the capsule, recedes behind it, slowly tips over and
     leaves the frame as the chase camera pulls away. (It used to vanish
     instantly at separation.) */
  const stageBack = 6.0 * sstep(T_SEP, T_SEP + 0.15, t);
  const stageTip = 0.22 * sstep(T_SEP, T_SEP + 0.15, t);
  for (const name of ['Stage2', 'BlockE_Stage3']) {
    const o = parts[name];
    if (!o) continue;
    o.position.y = capLocal - stageBack;   // rides the capsule's snap shift,
    o.rotation.x = stageTip;               // then falls behind and tumbles
  }
  const stageNames = ['Stage2', 'BlockE_Stage3'];
  const inOrbit = t >= T_SEP;
  for (const name in parts) {
    if (name === 'Vostok_Capsule') { parts[name].visible = true; continue; }
    if (inOrbit) { parts[name].visible = stageNames.indexOf(name) >= 0 && t < T_SEP + 0.15; continue; }
    const s = SEP[name];
    parts[name].visible = !(s && t > s.t0 + 0.075);
  }

  /* --- exhaust --- */
  /* The plume is posed from the vehicle's own transform, so it stays locked to
     the engine bells instead of hanging vertically in world space once the
     rocket lays over into the gravity turn. */
  exhaust.position.copy(vehPos);
  exhaust.quaternion.copy(qOrbit).multiply(_qa.setFromAxisAngle(AXIS_X, axis));
  exhOrigin.copy(vehPos);
  const throttle = throttleAt(t);
  flame.visible = throttle > 0.02;
  flameCore.visible = flame.visible;
  flame.position.set(0, 1.6, 0);
  flameCore.position.set(0, 1.2, 0);
  glow.visible = throttle > 0.02;
  glow.position.set(0, 0.4, 0);
  glow.scale.setScalar(lerp(3, 6, throttle) * lerp(1, 0.8, sstep(T_BOOST_SEP, T_ORBIT, t)));
  glowMat.opacity = throttle * 0.45;
  const fs = lerp(0.6, 1.0, throttle);
  /* in thin air the plume blooms wide and faint; uTime drives the flow.
     The bloom is a mesh scale on x/z so the normals stay truthful. */
  const wide = sstep(15, 70, keyframe(t, ALT_KM));
  const bloom = 1 + wide * 1.1;
  /* while the strap-ons burn the core plume stays slim between them and
     opens to full width the moment they drop */
  const coreSlim = 1 - 0.45 * (1 - sstep(T_BOOST_SEP - 0.01, T_BOOST_SEP + 0.02, t));
  flame.scale.set(fs * bloom * coreSlim * 1.12, fs, fs * bloom * coreSlim * 1.12);
  flameCore.scale.set(fs * (1 + wide * 0.8) * 1.06, fs, fs * (1 + wide * 0.8) * 1.06);
  for (const m of [flameMat, coreMat, boosterMat, verMat, bleMat]) {
    m.uniforms.uWide.value = wide;
    m.uniforms.uTime.value = NOW;
  }
  flameMat.uniforms.uT.value = throttle * 0.8;   // dimmed: the particle
                                                 // sheath carries the detail
  coreMat.uniforms.uT.value = throttle;
  verMat.uniforms.uT.value = throttle;
  /* the strap-on jets die the instant their boosters separate at T+119 s */
  const boThr = throttle * (1 - sstep(T_BOOST_SEP - 0.004, T_BOOST_SEP + 0.006, t));
  boosterMat.uniforms.uT.value = boThr;
  for (const m of boosterFlames) m.visible = boThr > 0.02;
  for (const m of vernierFlames) m.visible = throttle > 0.02;
  /* the Block-E burn: hot-staged from T+294 s to cutoff at insertion,
     blooming hard in the near-vacuum above 145 km */
  const bleThr = sstep(T_BLE_IGN, T_BLE_IGN + 0.018, t) *
                 (1 - sstep(T_ORBIT - 0.012, T_ORBIT + 0.004, t));
  bleMat.uniforms.uT.value = bleThr;
  bleFlame.visible = bleThr > 0.02;
  bleFlame.scale.set(1.08 * (1 + wide * 1.1), 1, 1.08 * (1 + wide * 1.1));
  /* staging flashes at strap-on, shroud and core separation */
  const stagePulse = [flareAt(T_BOOST_SEP, t), flareAt(T_FAIR_SEP, t), flareAt(T_CORE_SEP, t)];
  for (let i = 0; i < 3; i++) {
    stageFlashes[i].sp.visible = stagePulse[i] > 0.01;
    stageFlashes[i].mat.opacity = stagePulse[i] * 0.55;
  }
  /* pyrotechnic separation at T+688 s: one hard flash at the interface,
     a light pop on the hardware, and it settles. The flash must sit ON the
     capsule / Block-E interface: the capsule snaps down to the rocket origin
     over the snap window while the whole rocket group is being scaled up for
     the orbital view, and the exhaust group this sprite rides in is NOT
     scaled - so track the rendered interface explicitly: capsule bottom in
     the rocket frame (baked base 31.9 + the snap shift) x the rocket scale. */
  const flare = sstep(T_SEP - 0.002, T_SEP + 0.004, t) * (1 - sstep(T_SEP + 0.02, T_SEP + 0.065, t));
  const ifY = (31.65 + capLocal) * lerp(1, ORBIT_CAP_SCALE, orbBlend);
  sepFlash.visible = flare > 0.01;
  sepFlash.position.set(0, ifY, 0);
  sepLight.position.set(0, ifY, 0);
  /* the chase camera pulls back fast, so the flash grows with the blend to
     keep its apparent size up while it fades - but stays a compact spark at
     the interface, not a ball that swallows the capsule */
  sepFlash.scale.setScalar((4 + 14 * sstep(T_SEP, T_SEP + 0.012, t)) * (1 + 8 * orbBlendAt(t)));
  sepFlashMat.opacity = flare * 0.85;
  sepLight.intensity = flare * 300;

  /* --- landing effects --- */
  /* the TDU-1 burn: a short, tight jet firing forward while the capsule
     flies tail-first */
  const retroThr = sstep(T_RETRO, T_RETRO + 0.006, t) *
                   (1 - sstep(T_RETRO_END - 0.004, T_RETRO_END + 0.003, t));
  retroFlame.visible = retroThr > 0.02;
  if (retroFlame.visible) {
    retroFlame.position.copy(vehPos).addScaledVector(_landAxis, -2.3 * capScaleNow);
    retroFlame.quaternion.copy(_qAtt);
    retroFlame.scale.setScalar(capScaleNow);
    retroMat.uniforms.uT.value = retroThr;
    retroMat.uniforms.uWide.value = 1;              // it fires in vacuum
    retroMat.uniforms.uTime.value = NOW;
  }
  /* re-entry plasma: a flickering glow on the leading face, a light on the
     hardware, and a particle trail streaming backwards */
  const plasma = sstep(88, 62, altKm) * (1 - sstep(18, 8, altKm)) * attBlend;
  plasmaGlow.visible = plasma > 0.01;
  if (plasmaGlow.visible) {
    const flick = 0.75 + 0.25 * Math.sin(NOW * 31) * Math.sin(NOW * 17.3);
    plasmaGlow.position.copy(vehPos).addScaledVector(_landAxis, 2.0 * capScaleNow);
    plasmaGlow.scale.setScalar((1.8 + 1.2 * flick) * capScaleNow);
    plasmaMat.opacity = plasma * flick * 0.55;
    plasmaLight.position.copy(plasmaGlow.position);
    plasmaLight.intensity = plasma * flick * 40 * capScaleNow;
  } else {
    plasmaLight.intensity = 0;
  }
  /* the main canopy: reefed open over a moment, swaying gently, collapsing
     beside the capsule after touchdown and fading as the mission ends */
  const chuteK = sstep(T_CHUTE, T_CHUTE + 0.008, t);
  const chuteGone = sstep(tAtMission(6500), tAtMission(6530), t);
  chute.visible = chuteK > 0.005 && chuteGone < 1;
  if (chute.visible) {
    const swayA = 1 - sstep(T_TOUCH - 0.006, T_TOUCH, t);
    const collapse = sstep(T_TOUCH, tAtMission(6520), t);
    const sway = Math.sin(NOW * 0.9) * 0.10 * swayA;
    chute.position.set(
      vehPos.x + sway * 8 + collapse * 20,
      lerp(vehPos.y + 10, -BLOCK_H + 0.5, collapse),
      vehPos.z + sway * 4 + collapse * 12);
    chute.scale.set(lerp(0.25, 1, chuteK),
                    lerp(0.5, 1, chuteK) * (1 - collapse * 0.65),
                    lerp(0.25, 1, chuteK));
    chute.rotation.z = sway;
    chute.rotation.x = Math.sin(NOW * 0.7 + 1) * 0.08 * swayA;
    const op = 1 - chuteGone;
    chute.userData.dome.material.opacity = op;
    chute.userData.lines.material.opacity = op;
  }
  /* --- Gagarin's own descent: he ejected at ~7 km, free-fell while the
     capsule's canopy opened, then came down beside it under his personal
     parachute --- */
  const gagK = sstep(T_CHUTE, T_CHUTE + 0.006, t);
  const gagTouchK = sstep(T_GAG_TOUCH, tAtMission(6555), t);
  if (cosmonaut) {
    cosmonaut.visible = gagK > 0.01;
    if (cosmonaut.visible) {
      gagPose(t, _landPos);
      cosmonaut.position.copy(_landPos);
      /* supine under the canopy, then on his feet facing the capsule */
      const yaw = Math.atan2(vehPos.x - _landPos.x, vehPos.z - _landPos.z);
      _qa.setFromAxisAngle(UP, yaw);
      _qb.setFromAxisAngle(AXIS_X, -(1 - gagTouchK) * 0.95);
      cosmonaut.quaternion.copy(_qa).multiply(_qb);
    }
  }
  /* his personal parachute streams a little after the capsule's opens */
  const gagChuteK = sstep(tAtMission(6320), tAtMission(6328), t);
  const gagChuteGone = sstep(tAtMission(6550), tAtMission(6590), t);
  gagChute.visible = gagChuteK > 0.005 && gagChuteGone < 1 && gagK > 0.01;
  if (gagChute.visible && cosmonaut) {
    const swayA = 1 - gagTouchK;
    const collapse = gagTouchK;
    const sway = Math.sin(NOW * 0.85 + 2) * 0.10 * swayA;
    gagChute.position.set(
      cosmonaut.position.x + sway * 6 + collapse * 7,
      lerp(cosmonaut.position.y + 7, -BLOCK_H + 0.4, collapse),
      cosmonaut.position.z + sway * 3 + collapse * 4);
    gagChute.scale.set(lerp(0.25, 1, gagChuteK),
                       lerp(0.5, 1, gagChuteK) * (1 - collapse * 0.65),
                       lerp(0.25, 1, gagChuteK));
    gagChute.rotation.z = sway;
    const op = 1 - gagChuteGone;
    gagChute.userData.dome.material.opacity = op;
    gagChute.userData.lines.material.opacity = op;
  }
  /* touchdown: one burst of steppe dust, reusing the smoke pool */
  if (t < T_TOUCH) dustFired = false;
  else if (!dustFired) {
    dustFired = true;
    for (let n = 0; n < 18; n++) {
      const p = smoke[n];
      const ang = Math.random() * Math.PI * 2;
      p.age = 0; p.life = 2.5 + Math.random() * 2;
      p.sp.position.set(vehPos.x + Math.cos(ang) * 1.5, vehPos.y, vehPos.z + Math.sin(ang) * 1.5);
      p.vx = Math.cos(ang) * (3 + Math.random() * 5);
      p.vz = Math.sin(ang) * (3 + Math.random() * 5);
      p.vy = 1.5 + Math.random() * 2;
      p.s0 = 2; p.s1 = 10 + Math.random() * 8;
      p.sp.material.color.setRGB(0.72, 0.62, 0.48);
      p.sp.visible = true;
    }
  }

  updatePlume(dt, throttle, boThr, bleThr, wide,
              { pow: plasma, pos: vehPos, dir: _landAxis, scale: capScaleNow });
  updateSmoke(t, dt, dark);

  /* --- camera --- */
  if (!freeCam) {
    cameraRig(t, h, RE, a, surfY, vehPos, capWorld, axis);
    /* landing chase: take over from the orbital camera just BEFORE
       retrofire (the burn is short on the compressed clock, so the camera
       must already be there), and tighten in as the capsule descends,
       lifting the target to frame the canopy once it is out */
    const camLand = sstep(T_RETRO - 0.015, T_RETRO + 0.008, t);
    if (camLand > 0) {
      /* when the canopy is out the camera must sit far back and nearly
         level, or the dome fills the frame */
      const chuteVis = sstep(T_CHUTE - 0.004, T_CHUTE + 0.01, t) *
                       (1 - sstep(T_TOUCH, tAtMission(6540), t));
      const dist = (10 + 2.0 * capScaleNow) * lerp(1.6, 1.0, sstep(T_RETRO, T_CHUTE, t)) *
                   lerp(1, 2.4, chuteVis);
      const ang = 0.8 + sstep(T_RETRO, T_TOUCH, t) * 1.2;   // slow arc around it
      _lc.set(Math.sin(ang) * dist, dist * lerp(0.38, 0.18, chuteVis), Math.cos(ang) * dist);
      camPos.lerp(_a.copy(vehPos).add(_lc), camLand);
      const tgtUp = 7 * chuteVis;   // frame the canopy, then relax back down
      camTgt.lerp(_b.copy(vehPos).add(_c.set(0, tgtUp, 0)), camLand);
      /* once Gagarin is down, widen onto the midpoint between him and the
         capsule so the final frame holds both */
      const duoK = sstep(T_GAG_TOUCH - 0.004, T_GAG_TOUCH + 0.010, t);
      if (duoK > 0 && cosmonaut && cosmonaut.visible) {
        _d.copy(vehPos).add(cosmonaut.position).multiplyScalar(0.5);
        camTgt.lerp(_d, duoK);
        const duoDist = Math.max(dist, vehPos.distanceTo(cosmonaut.position) * 1.7);
        _lc.set(Math.sin(ang) * duoDist, duoDist * 0.30, Math.cos(ang) * duoDist);
        camPos.lerp(_e.copy(_d).add(_lc), duoK);
      }
    }
    /* a short jolt as the pyrotechnics fire */
    const shake = sstep(T_SEP - 0.003, T_SEP, t) * (1 - sstep(T_SEP + 0.006, T_SEP + 0.06, t));
    if (shake > 0) {
      const s = shake * 1.4;
      camPos.x += (Math.random() - 0.5) * s;
      camPos.y += (Math.random() - 0.5) * s;
      camPos.z += (Math.random() - 0.5) * s;
    }
    camera.position.copy(camPos);
    camera.lookAt(camTgt);
  } else {
    controls.update();
  }

  /* --- readouts --- */
  const mt = missionTime(t);
  const sign = mt < 0 ? '&minus;' : '+';
  const at = Math.abs(mt);
  clockEl.innerHTML = 'T' + sign + String(Math.floor(at / 60)).padStart(2, '0') + ':' +
                      String(Math.floor(at % 60)).padStart(2, '0');
  let ph = PHASES[0][1];
  for (const [pt, name] of PHASES) if (t >= pt) ph = name;
  phaseEl.innerHTML = ph;
  altEl.textContent = Math.round(keyframe(t, ALT_KM)) + ' km';
  velEl.textContent = Math.round(keyframe(t, VEL_MS) / 10) * 10 + ' m/s';
  accEl.textContent = keyframe(t, ACC_G).toFixed(2) + ' g';
  massEl.textContent = massTonnes(mt).toFixed(1) + ' t';
  /* Slant range back to the pad, in real km: the great-circle arc of the
     ground track (wrapped, so it shrinks again as the capsule laps the
     pad), not the integrated path length. After retrofire converge on the
     real figure: the landing site lay ~800 km from Baikonur. */
  const wrap = ((downAngle(t) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const arcKm = Math.min(wrap, Math.PI * 2 - wrap) * EARTH_R * M_PER_UNIT / 1000;
  let rangeKm = Math.hypot(altKm, arcKm);
  if (t > T_RETRO) rangeKm = lerp(RANGE_AT_RETRO, 800, sstep(T_RETRO, T_TOUCH, t));
  rangeEl.textContent = rangeKm < 10 ? rangeKm.toFixed(1) + ' km' : Math.round(rangeKm) + ' km';
  compEl.textContent = timeCompression().toFixed(0) + '\u00d7';
  tOrbitEl.textContent = (ORBIT_PERIOD / 60).toFixed(2) + ' min';
  tIncEl.textContent = '64.95°';
  tPeApEl.textContent = '181 × 327 km';
  tDarkEl.textContent = Math.round(dark * 100) + '%';
  seek.value = Math.round(t * 1000);
}

/* ==================================================================== *
 *  loop
 * ==================================================================== */
let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  NOW += dt;
  if (playing && ready) T = Math.min(1, T + dt * RATE / DURATION);
  applyTimeline(T, dt);
  renderer.render(scene, camera);
  if (ready && !window.__launchReady) {
    window.__launchReady = true;
    loadEl.classList.add('done');
  }
});
