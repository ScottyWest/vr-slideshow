/**
 * VR Slideshow — Rev 2.0
 * Date: 2025-11-28
 * Purpose: Add image sequencing — no duplicates until all images used.
 * Keeps the A-Frame curved panel approach, radius 1.8m, tuned texture settings.
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
  const cameraEl = document.getElementById('camera');

  // Configuration
  const VISIBLE_PANELS = 8;
  const DEFAULT_PANEL_HEIGHTS = { small: 0.45, medium: 0.65, large: 1.0 };
  const FIXED_RADIUS = 1.8;
  const BAND_ELEVATION_DEG = 25;       // +/-25deg => middle 50%
  const MIN_ANGULAR_SEPARATION_DEG = 28;
  const MAX_PANEL_WIDTH = 2.4;

  // Texture tuning
  const DESIRED_ANISOTROPY = 6; // moderate
  // Curvature
  const PANEL_CURVATURE = 0.6;

  // State
  let metaList = []; // { id, dataUrl, width, height }
  let nextAssetId = 0;
  let panelEntities = [];
  let unusedPool = [];      // pool used for replacements (Rev 2.0 will manage uniqueness)
  let replaceTimer = null;
  let usedYaws = [];

  // New sequencing lists (Rev 2.0)
  let sequencingUnused = []; // images not yet used in current cycle
  let sequencingUsed = [];   // images already used in this cycle

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
  function clearLog(){ debugEl.textContent = ''; try { document.getElementById('vrDebug').setAttribute('visible', false); } catch(e){} }
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
  function rebuildThumbs(){ imageListDiv.innerHTML = ''; metaList.forEach((m,i)=> addThumb(m.dataUrl, i)); }
  function removeImage(index){
    const meta = metaList[index];
    if(!meta) return;
    const el = document.getElementById(meta.id);
    if(el && el.parentNode) el.parentNode.removeChild(el);
    metaList.splice(index,1);
    rebuildThumbs();
    statusEl.textContent = `${metaList.length} images selected.`;
    startBtn.disabled = metaList.length < 1;
    // Update sequencing pools if running
    sequencingUnused = sequencingUnused.filter(m => m.id !== meta.id);
    sequencingUsed = sequencingUsed.filter(m => m.id !== meta.id);
  }

  // File picker (supports multiple)
  filePicker.addEventListener('change', async (evt)=>{
    const files = Array.from(filePicker.files || []);
    if(!files.length) return;

    statusEl.textContent = `Adding ${files.length} image(s)...`;
    try {
      for (const f of files){
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
      }
      statusEl.textContent = `${metaList.length} images selected.`;
      startBtn.disabled = metaList.length < 1;
      clearLog();
    } catch(err){
      log('Image conversion error: ' + (err && err.message ? err.message : err));
    } finally {
      filePicker.value = '';
    }
  });

  // shuffle helper
  function shuffleArray(arr){
    for(let i=arr.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // sequencing helpers (Rev 2.0)
  function initSequencing(){
    sequencingUnused = metaList.slice(); // shallow copy
    sequencingUsed = [];
    shuffleArray(sequencingUnused);
  }
  function getNextUniqueImage(){
    // If no images at all
    if(!metaList.length) return null;
    // Refill and reshuffle when exhausted
    if(sequencingUnused.length === 0){
      sequencingUnused = metaList.slice();
      sequencingUsed = [];
      shuffleArray(sequencingUnused);
    }
    // Pop one and mark used
    const next = sequencingUnused.shift();
    sequencingUsed.push(next);
    return next;
  }

  // Choose separated yaw
  function chooseSeparatedYaw(){
    const maxAttempts = 60;
    for(let attempt=0; attempt<maxAttempts; attempt++){
      const yawDeg = randRange(0,360);
      let ok = true;
      for(const used of usedYaws){
        const diff = Math.abs(((yawDeg - used + 180 + 360) % 360) - 180);
        if(diff < MIN_ANGULAR_SEPARATION_DEG){ ok = false; break; }
      }
      if(ok){ usedYaws.push(yawDeg); return yawDeg * Math.PI/180; }
    }
    const fallback = randRange(0,360);
    usedYaws.push(fallback);
    return fallback * Math.PI/180;
  }

  // Angle-based spherical placement centered on camera
  function positionFromAngles(radius){
    const yaw = chooseSeparatedYaw();
    const elevationDeg = randRange(-BAND_ELEVATION_DEG, BAND_ELEVATION_DEG);
    const elev = elevationDeg * Math.PI/180;
    const camPos = cameraEl.getAttribute('position') || { x:0, y:1.6, z:0 };

    const x = radius * Math.cos(elev) * Math.sin(yaw);
    const y = camPos.y + radius * Math.sin(elev);
    const z = -radius * Math.cos(elev) * Math.cos(yaw);
    const theta = Math.atan2(x, -z);
    return { x, y, z, theta, yawDeg: yaw * 180/Math.PI, elevationDeg };
  }

  // Curved panel component (static textures — quality tuned)
  AFRAME.registerComponent('curved-panel', {
    schema: {
      width: { type: 'number', default: 1.2 },
      height: { type: 'number', default: 0.8 },
      curvature: { type: 'number', default: PANEL_CURVATURE },
      segmentsW: { type: 'int', default: 48 },
      segmentsH: { type: 'int', default: 12 },
      src: { type: 'string', default: '' }
    },
    init: function(){
      const data = this.data;
      const el = this.el;
      const width = data.width;
      const height = data.height;
      const segW = Math.max(4, data.segmentsW);
      const segH = Math.max(1, data.segmentsH);

      const geom = new THREE.PlaneGeometry(width, height, segW, segH);
      const bend = Math.max(0, Math.min(1, data.curvature));
      const arc = bend * Math.PI / 3; // stronger curve
      const radius = (arc > 0) ? (width / arc) : 1000;
      const posAttr = geom.attributes.position;
      for(let i=0;i<posAttr.count;i++){
        const vx = posAttr.getX(i);
        const vy = posAttr.getY(i);
        if(arc > 0){
          const t = (vx + width/2) / width;
          const angle = (t - 0.5) * arc;
          const newX = Math.sin(angle) * radius;
          const newZ = radius - Math.cos(angle) * radius;
          posAttr.setX(i, newX);
          posAttr.setZ(i, newZ);
          posAttr.setY(i, vy);
        } else {
          posAttr.setX(i, vx);
          posAttr.setZ(i, 0);
          posAttr.setY(i, vy);
        }
      }
      geom.computeVertexNormals();

      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(geom, mat);
      el.setObject3D('mesh', mesh);

      this.mesh = mesh;
      this.texture = null;
    },
    update: function(oldData){
      if(oldData.src !== this.data.src && this.data.src){
        this.loadTexture(this.data.src);
      }
    },
    remove: function(){ if(this.mesh) this.el.removeObject3D('mesh'); },
    loadTexture: function(src){
      const self = this;
      try {
        if(typeof src === 'string' && src.charAt(0) === '#'){
          const imgEl = document.querySelector(src);
          if(imgEl){
            const tex = new THREE.Texture(imgEl);
            try { const renderer = self.el.sceneEl.renderer; const maxAniso = renderer && renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : DESIRED_ANISOTROPY; tex.anisotropy = Math.min(DESIRED_ANISOTROPY, maxAniso || DESIRED_ANISOTROPY); } catch(e){ tex.anisotropy = DESIRED_ANISOTROPY; }
            tex.encoding = THREE.sRGBEncoding;
            tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.generateMipmaps = true;
            tex.needsUpdate = true;

            if(self.mesh && self.mesh.material){ self.mesh.material.map = tex; self.mesh.material.needsUpdate = true; }
            self.texture = tex;
            return;
          }
        }
      } catch(e){ console.warn('DOM texture path failed', e); }

      const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
      loader.load(src, function(tex){
        try { const renderer = self.el.sceneEl.renderer; const maxAniso = renderer && renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : DESIRED_ANISOTROPY; tex.anisotropy = Math.min(DESIRED_ANISOTROPY, maxAniso || DESIRED_ANISOTROPY); } catch(e){ tex.anisotropy = DESIRED_ANISOTROPY; }
        tex.encoding = THREE.sRGBEncoding;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;

        if(self.mesh && self.mesh.material){ self.mesh.material.map = tex; self.mesh.material.needsUpdate = true; }
        self.texture = tex;
      }, undefined, function(err){
        console.warn('Texture load error', err);
        try {
          const placeholder = new THREE.Texture(generatePlaceholderCanvas(512, 512));
          placeholder.needsUpdate = true; placeholder.encoding = THREE.sRGBEncoding; placeholder.wrapS = placeholder.wrapT = THREE.ClampToEdgeWrapping;
          if(self.mesh && self.mesh.material){ self.mesh.material.map = placeholder; self.mesh.material.needsUpdate = true; }
          self.texture = placeholder;
        } catch(e){}
      });
    }
  });

  // helper to generate a simple placeholder checkerboard canvas
  function generatePlaceholderCanvas(w, h){
    const cvs = document.createElement('canvas'); cvs.width = w; cvs.height = h; const ctx = cvs.getContext('2d');
    ctx.fillStyle = '#666'; ctx.fillRect(0,0,w,h);
    ctx.fillStyle = '#999';
    const size = 32; for(let y=0;y<h;y+=size){ for(let x=0;x<w;x+=size){ if(((x+y)/size|0)%2===0){ ctx.fillRect(x,y,size,size); } }}
    return cvs;
  }

  // Create curved panel entity — uses sequencing to ensure uniqueness on initial placement
  function createCurvedPanel(meta, panelHeight){
    const aspect = meta.width && meta.height ? meta.width / meta.height : 1.5;
    const height = Math.max(0.5, panelHeight);
    let width = Math.max(0.6, height * aspect);
    if(width > MAX_PANEL_WIDTH) width = MAX_PANEL_WIDTH;
    const pos = positionFromAngles(FIXED_RADIUS);
    const ent = document.createElement('a-entity');
    ent.setAttribute('position', `${pos.x} ${pos.y} ${pos.z}`);
    ent.setAttribute('rotation', `0 ${-pos.theta * 180/Math.PI} 0`);
    ent.setAttribute('curved-panel', `width: ${width}; height: ${height}; curvature: ${PANEL_CURVATURE}; src: #${meta.id}`);
    ent.setAttribute('look-at', '#camera');
    return ent;
  }

  // Build initial visible panels with uniqueness guarantee
  async function buildPanels(panelHeight){
    // clear old
    panelEntities.forEach(e=>{ try{ e.parentNode.removeChild(e); }catch(e){} });
    panelEntities = [];
    usedYaws = [];

    // init sequencing pools
    initSequencing();

    // we will attempt to fill panels with unique images first
    const available = metaList.slice();
    shuffleArray(available);

    // pick up to VISIBLE_PANELS unique images, if fewer images than panels, we'll reuse fairly
    const takeCount = Math.min(VISIBLE_PANELS, available.length);
    for(let i=0;i<takeCount;i++){
      const m = available[i];
      const ent = createCurvedPanel(m, panelHeight);
      panelContainer.appendChild(ent);
      panelEntities.push(ent);
    }

    // if not enough distinct images to reach VISIBLE_PANELS, fill the rest using sequencing (fair refill)
    while(panelEntities.length < VISIBLE_PANELS && metaList.length){
      const nextMeta = getNextUniqueImage() || metaList[Math.floor(Math.random()*metaList.length)];
      const ent = createCurvedPanel(nextMeta, panelHeight);
      panelContainer.appendChild(ent);
      panelEntities.push(ent);
    }

    // prepare replacement pool for runtime swaps (unusedPool used to avoid immediate duplicates)
    unusedPool = metaList.slice();
    shuffleArray(unusedPool);
  }

  // Replace one panel (texture swap + fade) — uses sequencing to prefer images not currently displayed
  function replaceOnePanel(panelHeight){
    if(!panelEntities.length || !metaList.length) return;

    // replenishment for unusedPool
    if(unusedPool.length === 0){
      unusedPool = metaList.slice();
      shuffleArray(unusedPool);
    }

    // pick a panel index to replace
    const idx = Math.floor(Math.random()*panelEntities.length);
    const old = panelEntities[idx];

    // Determine a candidate image that is not already displayed if possible
    const currentlyDisplayedIds = panelEntities.map(e => {
      try {
        const cp = e.getAttribute('curved-panel') || '';
        const match = String(cp).match(/src:\s*#(img\d+)/);
        return match ? `img${match[1].replace('img','')}` : null;
      } catch(e){ return null; }
    }).filter(Boolean);

    // Helper to find next candidate not in current set
    function findNextCandidate(){
      // Prefer sequencing next unique image
      if(sequencingUnused.length > 0){
        const candidate = sequencingUnused.shift();
        sequencingUsed.push(candidate);
        return candidate;
      }
      // fallback: pick from unusedPool not already displayed
      for(let i=0;i<unusedPool.length;i++){
        const c = unusedPool[i];
        if(!currentlyDisplayedIds.includes(c.id)){
          unusedPool.splice(i,1); // remove from pool
          return c;
        }
      }
      // final fallback: any random metaList item
      return metaList[Math.floor(Math.random()*metaList.length)];
    }

    try {
      // fade out old material opacity over 600ms, then swap src and fade in
      const mesh = old.getObject3D('mesh');
      if(mesh && mesh.material){
        mesh.material.transparent = true;
        const start = performance.now();
        const from = mesh.material.opacity !== undefined ? mesh.material.opacity : 1;
        (function fadeOut(now){
          const t = (now - start) / 600;
          mesh.material.opacity = Math.max(0, from * (1 - t));
          if(t < 1) requestAnimationFrame(fadeOut);
          else {
            const nextMeta = findNextCandidate();
            old.setAttribute('curved-panel', `src: #${nextMeta.id}`);
            // small delay to ensure texture loads then fade in
            const startIn = performance.now();
            (function fadeIn(nowIn){
              const ti = (nowIn - startIn)/600;
              mesh.material.opacity = Math.min(1, ti);
              if(ti < 1) requestAnimationFrame(fadeIn);
            }(startIn));
          }
        }(start));
      }
    } catch(e){ console.warn('Replace panel failed', e); }
  }

  // wait for assets to load
  function waitForAssetsLoaded(){
    const imgs = Array.from(aAssets.querySelectorAll('img'));
    return Promise.all(imgs.map(img => new Promise((resolve)=>{
      if(img.complete && img.naturalWidth>0) return resolve();
      img.onload = ()=> resolve();
      img.onerror = ()=> { log('Asset failed: ' + (img.id||'unknown')); resolve(); };
    })));
  }

  // Start button handler
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

  // quick debug exposure
  window._vrslideshow = { metaList };

  // cleanup
  window.addEventListener('beforeunload', ()=>{ if(replaceTimer) clearInterval(replaceTimer); });

})();
