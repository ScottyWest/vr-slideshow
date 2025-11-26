/**
 * VR Slideshow — R1.1
 * Date: 2025-11-25
 * Description:
 *   R1.1 moves panels farther away (fixed radius = 12m),
 *   distributes panels 360° around user but excludes top/bottom 15% (pitch bounded +/-75°),
 *   strengthens Ken Burns (medium) so it's perceptible,
 *   keeps same UI and replacement behavior.
 */

/* Core slideshow logic (based on your R1.0 code; only behavioral changes described above) */

(function(){
  // DOM refs (same as R1.0)
  const filePicker = document.getElementById('filePicker');
  const startBtn = document.getElementById('startBtn');
  const imageListDiv = document.getElementById('imageList');
  const statusEl = document.getElementById('status');
  const debugEl = document.getElementById('debug');
  const aAssets = document.getElementById('aAssets');
  const panelContainer = document.getElementById('panelContainer');
  const scene = document.getElementById('vrScene');

  // Config changes for R1.1
  const VISIBLE_PANELS = 8;
  const DEFAULT_PANEL_HEIGHTS = { small: 0.45, medium: 0.65, large: 1.0 };
  const CURVATURE_THETA_DEG = 14;
  const FIXED_RADIUS = 12.0;        // <- moved panels further away (fixed radius)
  const EXCLUDE_POLAR_DEG = 15;     // exclude top/bottom 15% -> equivalent to restricting elevation to +/- (90 - 15) = +/-75deg
  const MIN_ELEVATION_DEG = -(90 - EXCLUDE_POLAR_DEG); // -75
  const MAX_ELEVATION_DEG =  (90 - EXCLUDE_POLAR_DEG); // +75

  // Ken Burns (medium, made more perceptible)
  const KB_ZOOM_MIN = 1.05;
  const KB_ZOOM_MAX = 1.15;
  const KB_DURATION_MIN = 15000;
  const KB_DURATION_MAX = 20000;

  // State
  let metaList = [];
  let nextAssetId = 0;
  let panelEntities = [];
  let unusedPool = [];
  let replaceTimer = null;

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

  // Convert File -> Base64 data URL
  function fileToDataURL(file){
    return new Promise((resolve,reject)=>{
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('FileReader error'));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
  }

  // Get image dimensions safely
  function getImageDimensionsFromDataUrl(dataUrl){
    return new Promise((resolve,reject)=>{
      const img = new Image();
      img.onload = ()=> resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = ()=> reject(new Error('Image decode failed'));
      img.src = dataUrl;
    });
  }

  // UI thumbnail helpers (unchanged)
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

  // file picker handler (same)
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

  // Position on sphere (360° yaw, elevation constrained to +/-75°)
  function randomPositionOnSphereFixedRadius(radius){
    const yaw = randRange(0, 360) * Math.PI/180; // full circle
    const elevationDeg = randRange(MIN_ELEVATION_DEG, MAX_ELEVATION_DEG);
    const pitch = elevationDeg * Math.PI/180; // elevation
    const x = radius * Math.cos(pitch) * Math.sin(yaw);
    const y = radius * Math.sin(pitch);
    const z = -radius * Math.cos(pitch) * Math.cos(yaw); // forward is -Z
    const theta = Math.atan2(x, -z);
    return { x, y, z, theta };
  }

  // create a gentle curved panel using a thin cylinder segment approach
  function createCurvedPanel(meta, panelHeight){
    // Use a fixed radius for all panels (no depth randomization) so distance is consistent
    const pos = randomPositionOnSphereFixedRadius(FIXED_RADIUS);

    const aspect = meta.width && meta.height ? meta.width / meta.height : 1.5;
    const height = Math.max(0.5, panelHeight);
    let width = Math.max(0.6, height * aspect);
    if(width > 4.0){ width = 4.0; }

    const thetaDeg = CURVATURE_THETA_DEG;
    const radius = FIXED_RADIUS;
    const arcLength = (Math.PI * 2 * radius) * (thetaDeg / 360);
    const scaleX = Math.max(0.5, Math.min(1.4, width / arcLength));

    // create entity using cylinder geometry slice
    const ent = document.createElement('a-entity');
    ent.setAttribute('geometry', `primitive: cylinder; radius: ${radius}; height: ${height}; openEnded: true; thetaLength: ${thetaDeg}`);
    ent.setAttribute('position', `${pos.x} ${pos.y} ${pos.z}`);
    ent.setAttribute('rotation', `0 ${-pos.theta * 180/Math.PI} 0`);
    ent.setAttribute('material', `src: #${meta.id}; shader: flat; side: double;`);
    ent.object3D.scale.set(scaleX, 1, 1);

    // Stronger (medium) Ken Burns: animate entity scale and position
    const zoomTo = randRange(KB_ZOOM_MIN, KB_ZOOM_MAX);
    const dur = Math.floor(randRange(KB_DURATION_MIN, KB_DURATION_MAX));
    ent.setAttribute('animation__kb_scale', `property: scale; to: ${scaleX * zoomTo} ${zoomTo} ${zoomTo}; dur: ${dur}; dir: alternate; loop: true; easing: easeInOutSine`);

    const panX = randRange(-0.3, 0.3);
    const panY = randRange(-0.18, 0.18);
    const panZ = randRange(-0.25, 0.25);
    ent.setAttribute('animation__kb_pos', `property: position; from: ${pos.x} ${pos.y} ${pos.z}; to: ${pos.x + panX} ${pos.y + panY} ${pos.z + panZ}; dur: ${dur}; dir: alternate; loop: true; easing: easeInOutSine`);

    ent.setAttribute('look-at', '#camera');
    return ent;
  }

  // build panels (same basic flow)
  async function buildPanels(panelHeight){
    panelEntities.forEach(e=>{ try{ e.parentNode.removeChild(e); }catch(e){} });
    panelEntities = [];

    unusedPool = metaList.slice();
    shuffleArray(unusedPool);

    for(let i=0;i<Math.min(VISIBLE_PANELS, unusedPool.length); i++){
      const m = unusedPool.shift();
      const ent = createCurvedPanel(m, panelHeight);
      panelContainer.appendChild(ent);
      panelEntities.push(ent);
    }

    while(panelEntities.length < VISIBLE_PANELS && metaList.length){
      const m = metaList[Math.floor(Math.random()*metaList.length)];
      const ent = createCurvedPanel(m, panelHeight);
      panelContainer.appendChild(ent);
      panelEntities.push(ent);
    }
  }

  function replaceOnePanel(panelHeight){
    if(!panelEntities.length || !metaList.length) return;
    if(unusedPool.length === 0){
      unusedPool = metaList.slice();
      shuffleArray(unusedPool);
    }
    const idx = Math.floor(Math.random()*panelEntities.length);
    const old = panelEntities[idx];
    try { old.setAttribute('animation__fadeout', `property: material.opacity; to: 0; dur: 600;`); } catch(e){}
    setTimeout(()=>{
      try{ old.parentNode.removeChild(old); } catch(e){}
      const next = unusedPool.shift();
      const newEnt = createCurvedPanel(next, panelHeight);
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

  // Start button behavior
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

  // debug exposure
  window._vrslideshow = { metaList };

})();
