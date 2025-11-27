/**
 * VR Slideshow — R1.3
 * Date: 2025-11-25
 * Description:
 *   This revision uses flat planes, enforces fixed radius ~3.2m, full 360° yaw with elevation clamp +/-75°,
 *   ensures minimum angular separation between panels, eliminates position/pan animations,
 *   and applies Ken Burns as scale-only on each plane. No UI changes.
 */

(function(){
  // DOM refs
  const filePicker = document.getElementById('filePicker');
  const startBtn = document.getElementById('startBtn');
  const imageListDiv = document.getElementById('imageList');
  const statusEl = document.getElementById('status');
  const debugEl = document.getElementById('debug');
  const aAssets = document.getElementById('aAssets');
  const panelContainer = document.getElementById('panelContainer');
  const scene = document.getElementById('vrScene');

  // Configuration
  const VISIBLE_PANELS = 8;
  const DEFAULT_PANEL_HEIGHTS = { small: 0.45, medium: 0.65, large: 1.0 };
  const FIXED_RADIUS = 3.2;            // comfortable arms-length
  const EXCLUDE_POLAR_DEG = 15;        // exclude top/bottom 15%
  const MIN_ELEVATION_DEG = -(90 - EXCLUDE_POLAR_DEG);
  const MAX_ELEVATION_DEG =  (90 - EXCLUDE_POLAR_DEG);
  const MIN_ANGULAR_SEPARATION_DEG = 28; // degrees between panel yaws to reduce overlap
  const MAX_PANEL_WIDTH = 2.4;         // clamp width to reduce intersections

  const KB_ZOOM_MIN = 1.05;
  const KB_ZOOM_MAX = 1.12;
  const KB_DURATION_MIN = 15000;
  const KB_DURATION_MAX = 20000;

  // State
  let metaList = []; // { id, dataUrl, width, height }
  let nextAssetId = 0;
  let panelEntities = [];
  let unusedPool = [];
  let replaceTimer = null;
  let usedYaws = []; // keep track of chosen yaw angles to enforce separation

  // Helpers
  function log(msg){
    console.log(msg);
    debugEl.textContent = String(msg).slice(0,800);
    try {
      const vrDebugText = document.getElementById('vrDebugText');
      const vrDebug = document.getElementById('vrDebug');
      if(vrDebugText && vrDebug){
        vrDebugText.setAttribute('value', String(msg).slice(0,700));
        vrDebug.setAttribute('visible', true);
      }
    } catch(e){}
  }
  function clearLog(){
    debugEl.textContent = '';
    try { document.getElementById('vrDebug').setAttribute('visible', false); } catch(e){}
  }
  function randRange(a,b){ return a + Math.random() * (b - a); }

  // File -> DataURL
  function fileToDataURL(file){
    return new Promise((resolve,reject)=>{
      const reader = new FileReader();
      reader.onerror = ()=> reject(new Error('FileReader error'));
      reader.onload = ()=> resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }
  function getImageDimensionsFromDataUrl(dataUrl){
    return new Promise((resolve,reject)=>{
      const img = new Image();
      img.onload = ()=> resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = ()=> reject(new Error('Image decode failed'));
      img.src = dataUrl;
    });
  }

  // UI thumbnails
  function addThumb(dataUrl, idx){
    const wrapper = document.createElement('div');
    wrapper.className = 'thumbWrapper';
    wrapper.dataset.idx = idx;
    const img = document.createElement('img');
    img.src = dataUrl;
    wrapper.appendChild(img);
    const rm = document.createElement('button');
    rm.className = 'removeBtn';
    rm.innerText = '×';
    rm.title = 'Remove';
    rm.onclick = ()=> removeImage(idx);
    wrapper.appendChild(rm);
    imageListDiv.appendChild(wrapper);
  }
  function rebuildThumbs(){
    imageListDiv.innerHTML = '';
    metaList.forEach((m,i)=> addThumb(m.dataUrl, i));
  }
  function removeImage(index){
    const meta = metaList[index];
    if(!meta) return;
    const el = document.getElementById(meta.id);
    if(el && el.parentNode) el.parentNode.removeChild(el);
    metaList.splice(index,1);
    rebuildThumbs();
    statusEl.textContent = `${metaList.length} images selected.`;
    startBtn.disabled = metaList.length < 1;
  }

  // File picker (Quest picks one at a time)
  filePicker.addEventListener('change', async (evt)=>{
    const files = Array.from(filePicker.files || []);
    if(!files.length) return;
    const f = files[0];
    statusEl.textContent = `Converting ${f.name}...`;
    try {
      const dataUrl = await fileToDataURL(f);
      const dims = await getImageDimensionsFromDataUrl(dataUrl);
      const id = `img${nextAssetId++}`;
      const imgEl = document.createElement('img');
      imgEl.setAttribute('id', id);
      imgEl.setAttribute('src', dataUrl);
      imgEl.setAttribute('crossorigin','anonymous');
      aAssets.appendChild(imgEl);

      metaList.push({ id, dataUrl, width: dims.width, height: dims.height });
      addThumb(dataUrl, metaList.length-1);
      statusEl.textContent = `${metaList.length} images selected.`;
      startBtn.disabled = metaList.length < 1;
      clearLog();
    } catch(err){
      log('Image conversion error: ' + (err && err.message ? err.message : err));
    } finally {
      filePicker.value = '';
    }
  });

  // Choose a yaw that is at least MIN_ANGULAR_SEPARATION_DEG away from usedYaws
  function chooseSeparatedYaw(){
    const maxAttempts = 30;
    for(let attempt=0; attempt<maxAttempts; attempt++){
      const yawDeg = randRange(0,360);
      let ok = true;
      for(const used of usedYaws){
        const diff = Math.abs(((yawDeg - used + 180 + 360) % 360) - 180); // shortest difference
        if(diff < MIN_ANGULAR_SEPARATION_DEG){ ok = false; break; }
      }
      if(ok){ usedYaws.push(yawDeg); return yawDeg * Math.PI/180; }
    }
    // fallback: just return random yaw after attempts
    const fallback = randRange(0,360);
    usedYaws.push(fallback);
    return fallback * Math.PI/180;
  }

  // spherical to cartesian with elevation clamp
  function positionFromAngles(radius){
    const yaw = chooseSeparatedYaw(); // radians
    const elevationDeg = randRange(MIN_ELEVATION_DEG, MAX_ELEVATION_DEG);
    const pitch = elevationDeg * Math.PI/180;
    const x = radius * Math.cos(pitch) * Math.sin(yaw);
    const y = radius * Math.sin(pitch);
    const z = -radius * Math.cos(pitch) * Math.cos(yaw);
    const theta = Math.atan2(x, -z);
    return { x, y, z, theta, yawDeg: yaw * 180/Math.PI, elevationDeg };
  }

  // create a flat a-plane (no position animation)
  function createPlanePanel(meta, panelHeight){
    const pos = positionFromAngles(FIXED_RADIUS);

    const aspect = meta.width && meta.height ? meta.width / meta.height : 1.5;
    const height = Math.max(0.5, panelHeight);
    let width = Math.max(0.6, height * aspect);
    if(width > MAX_PANEL_WIDTH) width = MAX_PANEL_WIDTH;

    const plane = document.createElement('a-plane');
    plane.setAttribute('width', width);
    plane.setAttribute('height', height);
    plane.setAttribute('position', `${pos.x} ${pos.y} ${pos.z}`);
    plane.setAttribute('rotation', `0 ${-pos.theta * 180/Math.PI} 0`);
    plane.setAttribute('material', `src: #${meta.id}; shader: flat; side:double;`);
    plane.setAttribute('look-at', '#camera');

    // Ken Burns: scale-only (local scale animation)
    const zoomTo = randRange(KB_ZOOM_MIN, KB_ZOOM_MAX);
    const dur = Math.floor(randRange(KB_DURATION_MIN, KB_DURATION_MAX));
    plane.setAttribute('animation__kb_scale', `property: scale; to: ${zoomTo} ${zoomTo} 1; dur: ${dur}; dir: alternate; loop: true; easing: easeInOutSine`);

    return plane;
  }

  // Build initial visible panels
  async function buildPanels(panelHeight){
    // clear old
    panelEntities.forEach(e=>{ try{ e.parentNode.removeChild(e); }catch(e){} });
    panelEntities = [];
    usedYaws = [];

    // prepare pool and shuffle
    unusedPool = metaList.slice();
    shuffleArray(unusedPool);

    // fill visible panels
    for(let i=0;i<Math.min(VISIBLE_PANELS, unusedPool.length); i++){
      const m = unusedPool.shift();
      const ent = createPlanePanel(m, panelHeight);
      panelContainer.appendChild(ent);
      panelEntities.push(ent);
    }
    // if not enough images, duplicate randomly to reach count
    while(panelEntities.length < VISIBLE_PANELS && metaList.length){
      const m = metaList[Math.floor(Math.random()*metaList.length)];
      const ent = createPlanePanel(m, panelHeight);
      panelContainer.appendChild(ent);
      panelEntities.push(ent);
    }
  }

  // Replace one panel (fade only -> no positional changes)
  function replaceOnePanel(panelHeight){
    if(!panelEntities.length || !metaList.length) return;
    if(unusedPool.length === 0){
      unusedPool = metaList.slice();
      shuffleArray(unusedPool);
    }
    // pick random index
    const idx = Math.floor(Math.random()*panelEntities.length);
    const old = panelEntities[idx];
    try { old.setAttribute('animation__fadeout', `property: material.opacity; to: 0; dur: 600;`); } catch(e){}
    setTimeout(()=>{
      try{ old.parentNode.removeChild(old); } catch(e){}
      const next = unusedPool.shift();
      const newEnt = createPlanePanel(next, panelHeight);
      // start invisible then fade in
      try { newEnt.setAttribute('material','opacity:0; shader:flat; side:double;'); } catch(e){}
      panelContainer.appendChild(newEnt);
      setTimeout(()=> {
        try { newEnt.setAttribute('animation__fadein', `property: material.opacity; to:1; dur:600;`); } catch(e){}
      }, 40);
      panelEntities[idx] = newEnt;
    }, 620);
  }

  function shuffleArray(arr){
    for(let i=arr.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  function waitForAssetsLoaded(){
    const imgs = Array.from(aAssets.querySelectorAll('img'));
    return Promise.all(imgs.map(img => new Promise((resolve)=>{
      if(img.complete && img.naturalWidth>0) return resolve();
      img.onload = ()=> resolve();
      img.onerror = ()=> { log('Asset failed: ' + (img.id||'unknown')); resolve(); };
    })));
  }

  // Start button
  startBtn.addEventListener('click', async ()=>{
    startBtn.disabled = true;
    statusEl.textContent = 'Preparing slideshow — building textures...';
    clearLog();

    if(!metaList.length){ statusEl.textContent = 'Select at least 1 image first.'; startBtn.disabled = false; return; }

    const sizeKey = document.getElementById('panelSize').value || 'medium';
    const panelHeight = DEFAULT_PANEL_HEIGHTS[sizeKey] || DEFAULT_PANEL_HEIGHTS.medium;

    try{
      await waitForAssetsLoaded();
      await buildPanels(panelHeight);
    } catch(err){
      log('Build panels error: ' + (err && err.message?err.message:err));
      startBtn.disabled = false;
      return;
    }

    document.getElementById('controls').style.display = 'none';
    scene.style.display = 'block';

    setTimeout(async ()=>{
      try {
        await scene.enterVR();
      } catch(err){
        log('Failed to enter VR: ' + (err && err.message?err.message:err));
        document.getElementById('controls').style.display = '';
        scene.style.display = 'none';
        startBtn.disabled = false;
        return;
      }

      const interval = Math.max(1, parseFloat(document.getElementById('replaceInterval').value) || 5);
      if(replaceTimer) clearInterval(replaceTimer);
      replaceTimer = setInterval(()=> {
        try { replaceOnePanel(panelHeight); } catch(e) { log('Replace error: ' + e); }
      }, interval * 1000);

      statusEl.textContent = 'Slideshow running.';
      clearLog();
    }, 120);
  });

  // cleanup
  window.addEventListener('beforeunload', ()=>{
    if(replaceTimer) clearInterval(replaceTimer);
  });

  // quick debug
  window._vrslideshow = { metaList };

})();
