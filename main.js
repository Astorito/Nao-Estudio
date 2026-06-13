import * as THREE from './vendor/three.module.js';

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const COLS        = 7;
const ROWS        = 5;
const CARD_COUNT  = COLS * ROWS;
const CARD_W      = 17;
const CARD_H      = 26;
const GAP_X       = 3.5;
const GAP_Y       = 3.5;
const CAM_START_Z = 60;
const CAM_END_Z   = -18;
const Z_NEAR      = 40;
const Z_FAR       = -12;
const DAMP        = 0.065;
const FOV         = 66;
const COL_STAGGER = [-6, 9, -4, 7, -9, 5, -6];

const STIFFNESS = 0.045;
const DAMPING   = 0.90;
const MAX_TILT  = 0.07;

// Intro fly-in
const INTRO_Z_OFFSET = 65;   // units each card starts behind its final Z
const INTRO_CARD_DUR = 1400; // ms per card fly-in animation
const INTRO_STAGGER  = 48;   // ms between each card (far-to-near order)

const SEEDS = [
  'amsterdam','berlin','shanghai','oslo','lisbon','seoul','rotterdam',
  'vienna','mumbai','helsinki','zurich','lagos','montreal','nairobi',
  'singapore','bogota','stockholm','dubai','athens','mexico',
  'copenhagen','tokyo','lyon','sydney','kyoto','milan','brisbane',
  'prague','reykjavik','accra','toronto','lima','cairo','baku','riga'
];

// ─── RENDERER ─────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
document.body.appendChild(renderer.domElement);

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.z = CAM_START_Z;

// ─── CARDS ────────────────────────────────────────────────────────────────────
const texLoader = new THREE.TextureLoader();
texLoader.crossOrigin = 'anonymous';

const sharedGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);

// Rounded corner mask via canvas alphaMap
function createRoundedMask(radiusFraction = 0.055) {
  const W = 256;
  const H = Math.round(W * CARD_H / CARD_W);
  const r = Math.round(W * radiusFraction);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(W - r, 0); ctx.arcTo(W, 0, W, r, r);
  ctx.lineTo(W, H - r); ctx.arcTo(W, H, W - r, H, r);
  ctx.lineTo(r, H);     ctx.arcTo(0, H, 0, H - r, r);
  ctx.lineTo(0, r);     ctx.arcTo(0, 0, r, 0, r);
  ctx.closePath();
  ctx.fill();
  return new THREE.CanvasTexture(canvas);
}
const roundedMask = createRoundedMask();

const cards = [];

// Indices de cards eliminadas (col=fila*COLS+col)
const SKIP_CARDS = new Set([15, 16, 17, 18, 19]);

function sr(s) { const x = Math.sin(s + 1) * 10000; return x - Math.floor(x); }

for (let i = 0; i < CARD_COUNT; i++) {
  if (SKIP_CARDS.has(i)) continue;
  const col = i % COLS;
  const row = Math.floor(i / COLS);

  const zFrac = (i + sr(i * 17) * 0.4) / (CARD_COUNT - 1);
  const z     = Z_NEAR - zFrac * (Z_NEAR - Z_FAR);
  const dist  = CAM_START_Z - z;
  const scale = dist / CAM_START_Z;

  const xBase = (col - (COLS - 1) / 2) * (CARD_W + GAP_X);
  const yBase = ((ROWS - 1) / 2 - row) * (CARD_H + GAP_Y) + COL_STAGGER[col];

  const mat = new THREE.MeshBasicMaterial({
    color:       0xcccac4,
    transparent: true,
    opacity:     0,
    alphaMap:    roundedMask,
  });

  const mesh = new THREE.Mesh(sharedGeo, mat);

  // Start at final x/y but offset behind on Z (scale stays at finalScale)
  mesh.scale.set(scale, scale, 1);
  mesh.position.set(xBase * scale, yBase * scale, z - INTRO_Z_OFFSET);

  mesh.userData = {
    xBase,
    yBase,
    finalZ:     z,
    introZ:     z - INTRO_Z_OFFSET,
    finalScale: scale,
    hasPassed:  false,
    opacity:    0,
    fadeIn:     false,
    introDelay: 0,   // assigned below after sort
    rotX: 0, rotY: 0,
    velX: 0, velY: 0,
    targetRotX: 0, targetRotY: 0,
    baseRotX: (sr(i * 17) - 0.5) * 0.02,
    baseRotY: (sr(i * 23) - 0.5) * 0.03,
    hovered:  false,
  };
  mesh.rotation.x = mesh.userData.baseRotX;
  mesh.rotation.y = mesh.userData.baseRotY;

  scene.add(mesh);
  cards.push(mesh);

  const seed = SEEDS[i % SEEDS.length];
  texLoader.load(
    `https://picsum.photos/seed/${seed}/400/610`,
    tex => {
      mat.map   = tex;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
    }
  );
}

// Stagger order: farthest from camera first (ascending finalZ = most negative first)
[...cards]
  .sort((a, b) => a.userData.finalZ - b.userData.finalZ)
  .forEach((card, idx) => { card.userData.introDelay = idx * INTRO_STAGGER; });

let introPhase     = true;
let scrollEnabled  = false;
let introBeginTime = null;

// ─── MOUSE / RAYCASTER ────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2(-9999, -9999);

window.addEventListener('mousemove', e => {
  mouse.x =  (e.clientX / window.innerWidth)  * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
});

// ─── SCROLL + HEADER + CANVAS FADE ───────────────────────────────────────────
let targetZ    = CAM_START_Z;
let currentZ   = CAM_START_Z;
const header   = document.getElementById('site-header');
const heroEl   = document.getElementById('hero-content');
const heroBg   = document.getElementById('hero-bg');
const scrollEl = document.getElementById('scroll-container');
const canvas   = renderer.domElement;
canvas.style.transition = 'opacity 0.7s ease';

let headerShown = false;

window.addEventListener('scroll', () => {
  if (!scrollEnabled) return;

  const heroHeight = scrollEl.offsetHeight;
  const heroMax    = heroHeight - window.innerHeight;
  const scrollY    = window.scrollY;

  const t = heroMax > 0 ? Math.min(Math.max(scrollY / heroMax, 0), 1) : 0;
  targetZ = CAM_START_Z + t * (CAM_END_Z - CAM_START_Z);

  if (t > 0.88 && !headerShown) { header.classList.add('visible'); headerShown = true; }

  const fadeStart = heroMax;
  const fadeEnd   = heroMax + window.innerHeight * 0.6;
  if (scrollY > fadeStart) {
    const p = Math.min((scrollY - fadeStart) / (fadeEnd - fadeStart), 1);
    canvas.style.opacity = String(1 - p);
    heroEl.style.opacity = String(1 - p);
    heroBg.style.opacity = String(1 - p);
    canvas.style.pointerEvents = p > 0.5 ? 'none' : 'auto';
  } else {
    canvas.style.opacity = '1';
    heroEl.style.opacity = '1';
    heroBg.style.opacity = '1';
    canvas.style.pointerEvents = 'auto';
  }
}, { passive: true });

// ─── RESIZE ───────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── EASING ───────────────────────────────────────────────────────────────────
function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }

// ─── RENDER LOOP ──────────────────────────────────────────────────────────────
function animate(now) {
  requestAnimationFrame(animate);

  if (introBeginTime === null) introBeginTime = now;
  const elapsed = now - introBeginTime;

  if (introPhase) {
    // ── Intro: cards fly in automatically, far → near ─────────────────────
    let allDone = true;

    for (const card of cards) {
      const d = card.userData;

      if (elapsed < d.introDelay) {
        card.visible = false;
        allDone = false;
        continue;
      }

      const cardElapsed = elapsed - d.introDelay;
      const t = Math.min(cardElapsed / INTRO_CARD_DUR, 1);
      const e = easeOutQuart(t);

      // Animate only Z — perspective projection creates the "growing" effect
      card.position.z = d.introZ + (d.finalZ - d.introZ) * e;

      // Fade in quickly at start of each card's animation
      d.opacity = Math.min(t * 3, 1);
      card.material.opacity = d.opacity;
      card.visible = true;

      if (t < 1) allDone = false;
    }

    if (allDone) {
      introPhase    = false;
      scrollEnabled = true;
      // Snap all cards to final position
      for (const card of cards) {
        const d = card.userData;
        card.position.z       = d.finalZ;
        card.material.opacity = 1;
        d.opacity = 1;
        d.fadeIn  = true;
        card.visible = true;
      }
    }

  } else {
    // ── Scroll-driven: camera dollies through the grid ────────────────────
    currentZ += (targetZ - currentZ) * DAMP;
    camera.position.z = currentZ;

    raycaster.setFromCamera(mouse, camera);
    const hits    = raycaster.intersectObjects(cards);
    const hitCard = hits.length > 0 ? hits[0].object : null;

    if (hitCard && hits[0].uv) {
      hitCard.userData.hovered    = true;
      hitCard.userData.targetRotY =  (hits[0].uv.x - 0.5) * 2 * MAX_TILT;
      hitCard.userData.targetRotX = -(hits[0].uv.y - 0.5) * 2 * MAX_TILT;
    }

    for (const card of cards) {
      const d = card.userData;

      // Fade out when camera passes the card
      const behind = d.finalZ > currentZ + 1.5;
      if (behind && !d.hasPassed) d.hasPassed = true;

      if (d.hasPassed) {
        d.opacity = Math.max(0, d.opacity - 0.045);
      }

      card.material.opacity = d.opacity;
      card.visible          = d.opacity > 0.005;

      // Tilt spring — super damped oscillation
      if (!d.hovered) { d.targetRotX = 0; d.targetRotY = 0; }

      d.velX = d.velX * DAMPING + (d.targetRotX - d.rotX) * STIFFNESS;
      d.velY = d.velY * DAMPING + (d.targetRotY - d.rotY) * STIFFNESS;
      d.rotX += d.velX;
      d.rotY += d.velY;

      card.rotation.x = d.baseRotX + d.rotX;
      card.rotation.y = d.baseRotY + d.rotY;

      d.hovered = false;
    }
  }

  renderer.render(scene, camera);
}

requestAnimationFrame(animate);

