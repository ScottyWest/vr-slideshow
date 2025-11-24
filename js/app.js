// app.js — Curved panels, depth spacing, tuned Ken Burns
// Updated for Scotty Westside (gentle IMAX curvature + depth + vertical restriction)

const panelsContainer = document.getElementById('panels');
const fileInput = document.getElementById('fileInput');
const startBtn = document.getElementById('startBtn');
const status = document.getElementById('status');
const panelSizeSelect = document.getElementById('panelSize');
const intervalSecInput = document.getElementById('intervalSec');

let filePool = [];
let unusedPool = [];
let activePanels = [];
let replaceTimer = null;

function randRange(a,b){ return a + Math.random()*(b-a); }

// NEW: spherical random position restricted to central vertical 75%
// radius = provided radius; returns x,y,z and theta (radians)
function randomSphericalPositionCentered(radius){
  // choose a y fraction between -0.75 and +0.75
  const yFrac = randRange(-0.75, 0.75);
  // convert yFrac to cos(phi) (assuming sphere radius normalized to 1)
  const cosPhi = yFrac;
  const cp = Math.max(-0.99, Math.min(0.99, cosPhi));
  const phi = Math.acos(cp);
  const theta = Math.random() * Math.PI * 2;
  const x = radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  return {x,y,z,theta,phi};
}

// compute panel size — tuned smaller so curvature reads comfortably
function computePanelSizeFromDimensions(width, height, sizeSetting){
  // smaller base heights to compensate for curvature and larger radius
  const aspect = width && height ? (width/height) : 1.6;
  let baseHeight = 0.85; // medium default reduced
  if(sizeSetting === 'large') baseHeight = 1.4;
  if(sizeSetting === 'small') baseHeight = 0.6;
  let heightVal = baseHeight;
  let widthVal = heightVal * aspect;
  // clamp very wide panoramas
  if(widthVal > 3.0){ widthVal = 3.0; heightVal = widthVal / aspect; }
  return {width: widthVal, height: heightVal};
}

// create a gently curved panel using a thin cylinder segment
function createPanel(item){
  const sizeSetting = panelSizeSelect ? panelSizeSelect.value : 'medium';
  const dims = computePanelSizeFromDimensions(item.width || 1600, item.height || 1000, sizeSetting);

  // choose a base radius (depth layers): near/mid/far
  const rPick = Math.random();
  let baseRadius;
  if (rPick < 0.2) baseRadius = randRange(6.0, 8.0);   // near — still safely away
  else if (rPick < 0.7) baseRadius = randRange(9.0, 12.0); // mid
  else baseRadius = randRange(13.0, 17.0);             // far

  // central vertical position
  const pos = randomSphericalPositionCentered(baseRadius);

  // convert theta to degrees for cylinder rotation
  const thetaDeg = (pos.theta || 0) * 180 / Math.PI;

  // curvature parameters (gentle IMAX)
  const CURVATURE_THETA_DEG = 16; // small theta length produces gentle curve

  // height of the cylinder equals the image height in world units
  const height = Math.max(0.7, dims.height); // ensure not too tiny

  // Create cylinder entity that will act as the curved panel segment
  const cyl = document.createElement('a-entity');
  // geometry: cylinder with small thetaLength (curved slice). openEnded true to avoid caps.
  cyl.setAttribute('geometry', `primitive: cylinder; radius: ${baseRadius}; height: ${height}; openEnded: true; thetaLength: ${CURVATURE_THETA_DEG}`);
  // position and rotation so the curved face roughly faces the center
  cyl.setAttribute('position', `${pos.x} ${pos.y} ${pos.z}`);

  // rotate so the curved face faces the center (approx)
  // We want the cylinder segment's curved face directed towards the origin; rotate y by negative theta degrees
  cyl.setAttribute('rotation', `0 ${-thetaDeg} 0`);

  // material uses the image URL as texture and is double-sided and flat-shaded for crisp look
  cyl.setAttribute('material', `src: ${item.url}; shader: flat; side: double;`);

  // scale slightly to convert "cylinder arc width" to image width proportionally.
  // We can't directly set thetaWidth -> we tune perceived width by scaling along X axis.
  // We'll scale the entity so the visual width approximates dims.width.
  const approxArcLength = (Math.PI * 2 * baseRadius) * (CURVATURE_THETA_DEG/360); // arc length of theta segment
  const scaleX = Math.min(1.2, Math.max(0.5, dims.width / approxArcLength)); // clamp
  cyl.object3D.scale.set(scaleX, 1, 1);

  // subtle Ken Burns: smaller zoom and gentle pan (randomized)
  const zoomTo = randRange(1.02, 1.08); // subtle zoom
  const dur = Math.floor(randRange(22000, 34000)); // relatively long for smoothness
  cyl.setAttribute('animation__scale', `property: scale; to: ${scaleX * zoomTo} ${zoomTo} ${zoomTo}; dur: ${dur}; dir: alternate; loop: true; easing: easeInOutSine`);

  // small pan across world coordinates (gives illusion of panning on the curved panel)
  const panX = randRange(-0.12, 0.12);
  const panY = randRange(-0.08, 0.08);
  const panZ = randRange(-0.12, 0.12);
  // compute to/from positions
  const fromPos = `${pos.x} ${pos.y} ${pos.z}`;
  const toPos = `${pos.x + panX} ${pos.y + panY} ${pos.z + panZ}`;
  cyl.setAttribute('animation__pos', `property: position; from: ${fromPos}; to: ${toPos}; dur: ${dur}; dir: alternate; loop: true; easing: easeInOutSine`);

  // make it face the camera (look-at) for small rotational correction
  cyl.setAttribute('look-at', '#camera');

  // accessibility/class
  cyl.className = 'slideshowPanel';

  return cyl;
}

function clearPanels(){
  activePanels.forEach(p => { try{ p.parentNode.removeChild(p); }catch(e){} });
  activePanels = [];
}

function pickInitialPanels(visibleCount){
  clearPanels();
  unusedPool = filePool.slice();
  shuffleArray(unusedPool);
  for(let i=0;i<Math.min(visibleCount, unusedPool.length); i++){
    const item = unusedPool.shift();
    const panel = createPanel(item);
    panelsContainer.appendChild(panel);
    activePanels.push(panel);
  }
}

function replaceOnePanel(){
  if(unusedPool.length === 0){
    unusedPool = filePool.slice();
    shuffleArray(unusedPool);
  }
  if(activePanels.length === 0) return;
  const idx = Math.floor(Math.random()*activePanels.length);
  const oldEl = activePanels[idx];
  // fade out by reducing opacity, then remove
  try{ oldEl.setAttribute('animation__fadeout', `property: material.opacity; to: 0; dur: 600; easing: linear`); }catch(e){}
  setTimeout(()=>{
    try{ oldEl.parentNode.removeChild(oldEl); }catch(e){}
    const next = unusedPool.shift();
    const newPanel = createPanel(next);
    // start invisible and fade in
    try{ newPanel.setAttribute('material', 'opacity:0; shader:flat; side:double;'); }catch(e){}
    panelsContainer.appendChild(newPanel);
    // ensure slight delay then fade in
    setTimeout(()=> {
      try{ newPanel.setAttribute('animation__fadein', `property: material.opacity; to: 1; dur: 600; easing: linear`); }catch(e){}
    }, 40);
    activePanels[idx] = newPanel;
  }, 640);
}

function shuffleArray(arr){
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// file input handling (we keep the existing object-URL flow here)
fileInput.addEventListener('change', async (evt) => {
  const files = Array.from(evt.target.files).filter(f => f.type && f.type.startsWith('image/'));
  status.textContent = `Loading ${files.length} image(s)...`;
  filePool = [];
  for(const f of files){
    try{
      const url = URL.createObjectURL(f);
      const dims = await getImageDimensions(url);
      filePool.push({name: f.name, url, width: dims.width, height: dims.height});
    }catch(e){
      console.warn('image load failed', e);
    }
  }
  status.textContent = `Loaded ${filePool.length} images. Ready.`;
});

// helper to get natural image dimensions
function getImageDimensions(url){
  return new Promise((resolve,reject)=>{
    const img = new Image();
    img.onload = ()=> { resolve({width: img.naturalWidth, height: img.naturalHeight}); URL.revokeObjectURL(img.src); };
    img.onerror = ()=> reject('image load error');
    img.src = url;
  });
}

startBtn.addEventListener('click', ()=>{
  if(!filePool.length){ status.textContent = 'Please select images first.'; return; }
  const visibleCount = 10; // changed to 10 per your requested setting
  status.textContent = `Starting slideshow with ${filePool.length} images...`;
  pickInitialPanels(visibleCount);
  if(replaceTimer) clearInterval(replaceTimer);
  const interval = Math.max(2000, parseInt(intervalSecInput.value || '5', 10)*1000);
  replaceTimer = setInterval(replaceOnePanel, interval);
  // hide UI
  const ui = document.getElementById('ui') || document.getElementById('controls') || document.getElementById('panelControls');
  if(ui) ui.style.display = 'none';
});

// cleanup when page unloads (revoke object URLs)
window.addEventListener('beforeunload', ()=>{
  filePool.forEach(i => { try{ URL.revokeObjectURL(i.url); } catch(e){} });
  if(replaceTimer) clearInterval(replaceTimer);
});
