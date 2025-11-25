// ---------------------------
// Settings
// ---------------------------
const RADIUS = 10;  // distance from viewer
const MAX_IMAGES = 20;

const PANEL_SIZE_MAP = {
  small: 1.2,
  medium: 2.0,
  large: 3.0
};

// Ken Burns (Option B – medium)
const KB_ZOOM_START = 1.00;
const KB_ZOOM_END   = 1.12;
const KB_DURATION   = 15000;   // 15 seconds


// ---------------------------
// Elements
// ---------------------------
const fileInput = document.getElementById('fileInput');
const startBtn  = document.getElementById('startBtn');
const statusEl  = document.getElementById('status');
const scene     = document.getElementById('vrScene');
const assets    = document.getElementById('imageAssets');

let imageMeta = [];
let panels = [];
let replaceTimer = null;


// ---------------------------
// Load images from input
// ---------------------------
fileInput.addEventListener('change', async () => {
  imageMeta = [];
  assets.innerHTML = '';

  const files = Array.from(fileInput.files).slice(0, MAX_IMAGES);

  for (let i = 0; i < files.length; i++) {
    const url = URL.createObjectURL(files[i]);
    const id = "img_" + i;

    const img = document.createElement('img');
    img.setAttribute('id', id);
    img.setAttribute('src', url);

    assets.appendChild(img);

    imageMeta.push({ id, url });
  }

  statusEl.textContent = `Loaded ${imageMeta.length} images.`;
});


// ---------------------------
// Build VR panels
// ---------------------------
async function buildPanels(panelWidth) {
  panels = [];

  // clear scene of old panels
  const old = scene.querySelectorAll('.photoPanel');
  old.forEach(o => o.remove());

  const count = imageMeta.length;
  const horizontalSpanDeg = 270;  // ±135°
  const verticalSpanDeg = 120;    // ±60°

  for (let i = 0; i < count; i++) {
    const meta = imageMeta[i];

    // Distribute angularly inside allowed ranges
    const hAngle = THREE.MathUtils.degToRad(-135 + Math.random() * horizontalSpanDeg);
    const vAngle = THREE.MathUtils.degToRad(-60 + Math.random() * verticalSpanDeg);

    // Convert spherical to Cartesian
    const x = RADIUS * Math.cos(vAngle) * Math.sin(hAngle);
    const y = RADIUS * Math.sin(vAngle);
    const z = -RADIUS * Math.cos(vAngle) * Math.cos(hAngle);

    const panel = document.createElement('a-entity');
    panel.classList.add('photoPanel');

    panel.setAttribute('geometry', {
      primitive: 'plane',
      width: panelWidth,
      height: panelWidth * 0.66
    });

    panel.setAttribute('material', {
      src: `#${meta.id}`,
      shader: 'flat'
    });

    panel.setAttribute('position', `${x} ${y} ${z}`);
    panel.setAttribute('look-at', '[camera]');

    // Ken Burns animation inside material
    panel.setAttribute('animation__kb', {
      property: 'material.zoom',
      from: KB_ZOOM_START,
      to: KB_ZOOM_END,
      dur: KB_DURATION,
      dir: 'alternate',
      loop: true,
      easing: 'linear'
    });

    scene.appendChild(panel);
    panels.push(panel);
  }
}


// ---------------------------
// Replace one panel’s image
// ---------------------------
function replacePanel(panelWidth) {
  if (panels.length === 0 || imageMeta.length === 0) return;

  const p = panels[Math.floor(Math.random() * panels.length)];
  const img = imageMeta[Math.floor(Math.random() * imageMeta.length)];

  p.setAttribute('material', 'src', `#${img.id}`);
}


// ---------------------------
// Start button → VR scene
// ---------------------------
startBtn.addEventListener('click', async () => {
  if (imageMeta.length === 0) {
    statusEl.textContent = "Select images first.";
    return;
  }

  startBtn.disabled = true;
  statusEl.textContent = "Preparing slideshow…";

  const sizeSetting = document.getElementById('panelSize').value;
  const panelWidth = PANEL_SIZE_MAP[sizeSetting];

  await buildPanels(panelWidth);

  // hide UI / show scene
  document.getElementById('controls').style.display = 'none';
  scene.style.display = 'block';

  // Enter VR
  setTimeout(async () => {
    try {
      await scene.enterVR();
    } catch (err) {
      statusEl.textContent = "VR entry failed.";
      return;
    }

    // start replace interval
    const interval = parseInt(document.getElementById('replaceInterval').value, 10);
    replaceTimer = setInterval(() => replacePanel(panelWidth), interval * 1000);

    statusEl.textContent = "Slideshow running.";

  }, 300);
});
