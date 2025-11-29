/**
 * VR Slideshow — R1.9
 * Date: 2025-11-28
 * Description:
 *   - Tuned texture sampling to reduce aliasing/static artifacts while preserving sharpness
 *   - Moderate anisotropy and linear mipmapped filtering
 *   - Curved panels (horizontal curvature), radius 1.8m
 *   - Ken Burns removed — static textures on panels
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

  // Texture tuning (Rev 1.9)
  const DESIRED_ANISOTROPY = 6; // moderate — reduces grain/static
  // Curvature
  const PANEL_CURVATURE = 0.6;

  // State
  let metaList = []; // { id, dataUrl, width, height }
  let nextAssetId = 0;
  let panelEntities = [];
  let unusedPool = [];
  let replaceTimer = null;
  let usedYaws = [];

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
  }

  // File picker
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
    const maxAttempts = 60;
    for(let attempt=0; attempt<maxAttempts; attempt++){
      const yawDeg = randRange(0,360);
      let ok = true;
      for(const used of usedYaws){
        const diff = Math.abs(((yawDeg - used + 180 + 360) % 360) - 180); // shortest difference
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
      const arc = bend * Math.PI / 3; // stronger curve than earlier revs
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

  // Create curved panel entity
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

  // Build initial visible panels
  async function buildPanels(panelHeight){
    panelEntities.forEach(e=>{ try{ e.parentNode.removeChild(e); }catch(e){} });
    panelEntities = [];
    usedYaws = [];

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

  // Replace one panel (texture swap + fade)
  function replaceOnePanel(panelHeight){
    if(!panelEntities.length || !metaList.length) return;
    if(unusedPool.length === 0){
      unusedPool = metaList.slice();
      shuffleArray(unusedPool);
    }
    const idx = Math.floor(Math.random()*panelEntities.length);
    const old = panelEntities[idx];

    try {
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
            const next = unusedPool.shift();
            old.setAttribute('curved-panel', `src: #${next.id}`);
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

  function shuffleArray(arr){ for(let i=arr.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } }

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
  window.addEventListener('beforeunload', ()=>{ if(replaceTimer) clearInterval(replaceTimer); });

  // quick debug
  window._vrslideshow = { metaList };

})();
