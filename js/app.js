// app.js — A-Frame VR Slideshow (Photos-only, hosted-ready)
// Medium panel default; manual file selection.
// author: assistant (prepared for Scotty Westside)

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

// spherical random position (uniform)
function randomSphericalPosition(radius){
  const u = Math.random();
  const v = Math.random();
  const theta = 2 * Math.PI * u;
  const phi = Math.acos(2*v - 1);
  const x = radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  return {x,y,z};
}

function computePanelSizeFromDimensions(width, height, sizeSetting){
  // Medium default: panel height ~1.2; large: 1.8; small: 0.8
  const aspect = width && height ? (width/height) : 1.6;
  let baseHeight = 1.2;
  if(sizeSetting === 'large') baseHeight = 1.8;
  if(sizeSetting === 'small') baseHeight = 0.8;
  let heightVal = baseHeight;
  let widthVal = heightVal * aspect;
  // clamp very wide panoramas
  if(widthVal > 3.6){ widthVal = 3.6; heightVal = widthVal / aspect; }
  return {width: widthVal, height: heightVal};
}

function createPanel(item){
  const sizeSetting = panelSizeSelect.value || 'medium';
  const dims = computePanelSizeFromDimensions(item.width || 1600, item.height || 1000, sizeSetting);
  const radius = randRange(3.0, 4.0);
  const pos = randomSphericalPosition(radius);
  const el = document.createElement('a-plane');
  el.setAttribute('src', item.url);
  el.setAttribute('position', `${pos.x} ${pos.y} ${pos.z}`);
  el.setAttribute('look-at', '#camera');
  el.setAttribute('width', dims.width);
  el.setAttribute('height', dims.height);
  el.setAttribute('material', 'side:double; shader:flat;');
  // Ken Burns style
  const zoomTo = randRange(0.95, 1.15);
  const dur = Math.floor(randRange(18000, 26000));
  el.setAttribute('animation__zoom', `property: scale; to: ${zoomTo} ${zoomTo} 1; dur: ${dur}; dir: alternate; loop: true; easing: linear`);
  const panX = randRange(-0.25, 0.25);
  const panY = randRange(-0.15, 0.15);
  const toPos = `${pos.x + panX} ${pos.y + panY} ${pos.z}`;
  el.setAttribute('animation__pan', `property: position; from: ${pos.x} ${pos.y} ${pos.z}; to: ${toPos}; dur: ${dur}; dir: alternate; loop: true; easing: easeInOutSine`);
  return el;
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
  // fade out
  oldEl.setAttribute('animation__fadeout', `property: material.opacity; to: 0; dur: 600; easing: linear`);
  setTimeout(()=>{
    try{ oldEl.parentNode.removeChild(oldEl); }catch(e){}
    const next = unusedPool.shift();
    const newPanel = createPanel(next);
    newPanel.setAttribute('material', 'opacity:0; side:double; shader:flat;');
    panelsContainer.appendChild(newPanel);
    setTimeout(()=> newPanel.setAttribute('animation__fadein', `property: material.opacity; to: 1; dur: 600; easing: linear`), 20);
    activePanels[idx] = newPanel;
  }, 620);
}

function shuffleArray(arr){
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

fileInput.addEventListener('change', async (evt)=>{
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
  const visibleCount = 8; // fixed per spec
  status.textContent = `Starting slideshow with ${filePool.length} images...`;
  pickInitialPanels(visibleCount);
  if(replaceTimer) clearInterval(replaceTimer);
  const interval = Math.max(2000, parseInt(intervalSecInput.value || '5', 10)*1000);
  replaceTimer = setInterval(replaceOnePanel, interval);
  document.getElementById('ui').style.display = 'none';
});

// cleanup on unload
window.addEventListener('beforeunload', ()=>{
  filePool.forEach(i=>{ try{ URL.revokeObjectURL(i.url);}catch(e){}});
  if(replaceTimer) clearInterval(replaceTimer);
});
