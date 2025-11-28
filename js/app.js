/**
 * VR Slideshow — R1.4
 * Date: 2025-11-27
 * Description:
 *   - Curved static panels (horizontal curvature only)
 *   - Fixed radius: 1.5 m (arm's length)
 *   - Middle 50% vertical band centered on camera height (ensures panels won't appear below feet)
 *   - Ken Burns applied only to texture UV (offset & repeat), never to panel transform
 *   - High-quality textures: crossOrigin, anisotropy, sRGBEncoding
 *   - 8 fixed panels, replaced over time by fading textures
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
  const FIXED_RADIUS = 1.5;            // comfortable arms-length (meters)
  const BAND_FRACTION = 0.5;          // middle 50% of sphere vertically
  const MIN_ANGULAR_SEPARATION_DEG = 28;
  const MAX_PANEL_WIDTH = 2.4;

  const KB_ZOOM_MIN = 1.03;
  const KB_ZOOM_MAX = 1.12;
  const KB_PAN_VEL_MIN = 0.0008; // texture offset velocity
  const KB_PAN_VEL_MAX = 0.0025;
  const KB_DURATION_MIN = 15000;
  const KB_DURATION_MAX = 22000;

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
      // ensure crossOrigin for texture loading later
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
    // fallback
    const fallback = randRange(0,360);
    usedYaws.push(fallback);
    return fallback * Math.PI/180;
  }

  // position calculation: y constrained to middle 50% around camera height
  function positionFromAngles(radius){
    const yaw = chooseSeparatedYaw(); // radians (theta around Y)
    // Vertical band centered around camera height so panels won't appear below feet
    const bandHeight = radius * (BAND_FRACTION); // band is fraction of diameter; using radius*BAND_FRACTION centers around camera
    // Use camera y as center
    const camPos = cameraEl.getAttribute('position') || { x:0, y:1.6, z:0 };
    const y = camPos.y + randRange(-bandHeight/2, bandHeight/2);

    // compute pitch such that point lies on sphere shell at given radius
    // we compute spherical coordinates from yaw and y -> x,z
    const clampedY = Math.max(-radius + 0.01, Math.min(radius - 0.01, y - 0));
    const horizDist = Math.sqrt(Math.max(0, radius*radius - clampedY*clampedY));
    const x = horizDist * Math.sin(yaw);
    const z = -horizDist * Math.cos(yaw);
    const theta = Math.atan2(x, -z);
    return { x, y: clampedY, z, theta, yawDeg: yaw * 180/Math.PI };
  }

  // Create curved plane geometry and mesh as an A-Frame object
  // We'll create a component 'curved-panel' which sets el.setObject3D('mesh', mesh)
  AFRAME.registerComponent('curved-panel', {
    schema: {
      width: { type: 'number', default: 1.2 },
      height: { type: 'number', default: 0.8 },
      curvature: { type: 'number', default: 0.4 }, // curvature strength 0..1
      segmentsW: { type: 'int', default: 24 },
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

      // Create plane geometry
      const geom = new THREE.PlaneGeometry(width, height, segW, segH);

      // Bend geometry horizontally by mapping X to an arc
      const bend = Math.max(0, Math.min(1, data.curvature));
      const arc = bend * Math.PI / 4; // up to 45 degrees arc
      const radius = (arc > 0) ? (width / arc) : 1000;

      const pos = geom.attributes.position;
      for(let i=0;i<pos.count;i++){
        const vx = pos.getX(i); // -width/2 .. +width/2
        const vy = pos.getY(i);
        if(arc > 0){
          const t = (vx + width/2) / width; // 0..1
          const angle = (t - 0.5) * arc; // centered around 0
          const newX = Math.sin(angle) * radius;
          const newZ = radius - Math.cos(angle) * radius;
          pos.setX(i, newX);
          pos.setZ(i, newZ);
          pos.setY(i, vy);
        } else {
          pos.setX(i, vx);
          pos.setZ(i, 0);
          pos.setY(i, vy);
        }
      }
      geom.computeVertexNormals();

      // Create material now without a texture; we'll attach texture when available
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 1 });

      const mesh = new THREE.Mesh(geom, mat);
      mesh.rotation.x = 0;

      el.setObject3D('mesh', mesh);

      // store references for later
      this.mesh = mesh;
      this.texture = null;
      this.animState = { zoom: 1, panU: 0, panV: 0, panVelU: 0, panVelV: 0 };

      if(data.src) this.loadTexture(data.src);
    },
    update: function(oldData){
      if(oldData.src !== this.data.src && this.data.src){
        this.loadTexture(this.data.src);
      }
    },
    remove: function(){
      if(this.mesh){
        this.el.removeObject3D('mesh');
      }
    },
    loadTexture: function(src){
      const self = this;
      // If src is an asset selector (e.g. "#img0"), use the DOM img element directly to build a THREE.Texture.
      try {
        if(typeof src === 'string' && src.charAt(0) === '#'){
          const imgEl = document.querySelector(src);
          if(imgEl){
            const tex = new THREE.Texture(imgEl);
            tex.needsUpdate = true;
            // high-quality params
            try {
              const renderer = self.el.sceneEl.renderer;
              const maxAniso = renderer && renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 1;
              tex.anisotropy = maxAniso || 1;
            } catch(e){ tex.anisotropy = 1; }
            tex.encoding = THREE.sRGBEncoding;
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;

            // initialize subtle Ken Burns parameters per panel
            const zoomTo = randRange(KB_ZOOM_MIN, KB_ZOOM_MAX);
            const panU = randRange(0, 0.25);
            const panV = randRange(0, 0.25);
            const panVelU = (Math.random() > 0.5 ? 1 : -1) * randRange(KB_PAN_VEL_MIN, KB_PAN_VEL_MAX);
            const panVelV = (Math.random() > 0.5 ? 1 : -1) * randRange(KB_PAN_VEL_MIN, KB_PAN_VEL_MAX);

            tex.repeat.set(1/zoomTo, 1/zoomTo);
            tex.offset.set(panU, panV);

            if(self.mesh && self.mesh.material){
              self.mesh.material.map = tex;
              self.mesh.material.needsUpdate = true;
            }

            self.texture = tex;
            self.animState.zoom = zoomTo;
            self.animState.panVelU = panVelU;
            self.animState.panVelV = panVelV;
            return;
          }
        }
      } catch(e){ console.warn('DOM texture path failed', e); }

      // Fallback: try loading via TextureLoader if src is a URL
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin('anonymous');
      loader.load(src, function(tex){
        try {
          const renderer = self.el.sceneEl.renderer;
          const maxAniso = renderer && renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 1;
          tex.anisotropy = maxAniso || 1;
        } catch(e){ tex.anisotropy = 1; }
        tex.encoding = THREE.sRGBEncoding;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;

        const zoomTo = randRange(KB_ZOOM_MIN, KB_ZOOM_MAX);
        const panU = randRange(0, 0.25);
        const panV = randRange(0, 0.25);
        const panVelU = (Math.random() > 0.5 ? 1 : -1) * randRange(KB_PAN_VEL_MIN, KB_PAN_VEL_MAX);
        const panVelV = (Math.random() > 0.5 ? 1 : -1) * randRange(KB_PAN_VEL_MIN, KB_PAN_VEL_MAX);

        tex.repeat.set(1/zoomTo, 1/zoomTo);
        tex.offset.set(panU, panV);

        if(self.mesh && self.mesh.material){
          self.mesh.material.map = tex;
          self.mesh.material.needsUpdate = true;
        }

        self.texture = tex;
        self.animState.zoom = zoomTo;
        self.animState.panVelU = panVelU;
        self.animState.panVelV = panVelV;

      }, undefined, function(err){
        console.warn('Texture load error', err);
      });
    },
    tick: function(time, dt){
      if(!this.texture) return;
      const s = dt/1000;
      const st = this.animState;
      st.panU = (st.panU + st.panVelU * s) % 1.0;
      st.panV = (st.panV + st.panVelV * s) % 1.0;
      this.texture.offset.set(st.panU, st.panV);
      const zoomOsc = 1 + 0.01 * Math.sin(time / 3000 + (this.el.id ? this.el.id.length : 0));
      const finalZoom = st.zoom * zoomOsc;
      this.texture.repeat.set(1/finalZoom, 1/finalZoom);
    }
  });

      const mesh = new THREE.Mesh(geom, mat);
      // rotate so the plane faces outward along -Z by default; we'll rotate entity later
      mesh.rotation.x = 0;

      el.setObject3D('mesh', mesh);

      // store references for later
      this.mesh = mesh;
      this.texture = null;
      this.animState = { zoom: 1, panU: 0, panV: 0, panVelU: 0, panVelV: 0 };

      // if src already present, load texture
      if(data.src) this.loadTexture(data.src);
    },
    update: function(oldData){
      if(oldData.src !== this.data.src && this.data.src){
        this.loadTexture(this.data.src);
      }
    },
    remove: function(){
      if(this.mesh){
        this.el.removeObject3D('mesh');
      }
    },
    loadTexture: function(src){
      const self = this;
      // Use THREE.TextureLoader and ensure crossOrigin
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin('anonymous');
      loader.load(src, function(tex){
        // set high-quality parameters
        try {
          const renderer = self.el.sceneEl.renderer;
          const maxAniso = renderer && renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 1;
          tex.anisotropy = maxAniso || 1;
        } catch(e){ tex.anisotropy = 1; }
        tex.encoding = THREE.sRGBEncoding;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;

        // initialize subtle Ken Burns parameters per panel
        const zoomTo = randRange(KB_ZOOM_MIN, KB_ZOOM_MAX);
        const panU = randRange(0, 0.25);
        const panV = randRange(0, 0.25);
        const panVelU = (Math.random() > 0.5 ? 1 : -1) * randRange(KB_PAN_VEL_MIN, KB_PAN_VEL_MAX);
        const panVelV = (Math.random() > 0.5 ? 1 : -1) * randRange(KB_PAN_VEL_MIN, KB_PAN_VEL_MAX);

        tex.repeat.set(1/zoomTo, 1/zoomTo);
        tex.offset.set(panU, panV);

        // assign to mesh material
        if(self.mesh && self.mesh.material){
          self.mesh.material.map = tex;
          self.mesh.material.needsUpdate = true;
        }

        // store texture and anim params
        self.texture = tex;
        self.animState.zoom = zoomTo;
        self.animState.panVelU = panVelU;
        self.animState.panVelV = panVelV;

      }, undefined, function(err){
        console.warn('Texture load error', err);
      });
    },
    tick: function(time, dt){
      // animate only texture UV (Ken Burns)
      if(!this.texture) return;
      const s = dt/1000;
      // advance offsets
      const st = this.animState;
      st.panU = (st.panU + st.panVelU * s) % 1.0;
      st.panV = (st.panV + st.panVelV * s) % 1.0;
      this.texture.offset.set(st.panU, st.panV);
      // Optionally, subtle zoom oscillation (small amplitude)
      const zoomOsc = 1 + 0.01 * Math.sin(time / 3000 + (this.el.id ? this.el.id.length : 0));
      const finalZoom = st.zoom * zoomOsc;
      this.texture.repeat.set(1/finalZoom, 1/finalZoom);
    }
  });

  // create a curved panel entity (helper)
  function createCurvedPanel(meta, panelHeight){
    const aspect = meta.width && meta.height ? meta.width / meta.height : 1.5;
    const height = Math.max(0.5, panelHeight);
    let width = Math.max(0.6, height * aspect);
    if(width > MAX_PANEL_WIDTH) width = MAX_PANEL_WIDTH;

    // position
    const pos = positionFromAngles(FIXED_RADIUS);

    const ent = document.createElement('a-entity');
    ent.setAttribute('position', `${pos.x} ${pos.y} ${pos.z}`);
    // rotation so that panel faces the camera: yaw rotation around Y is -theta deg
    ent.setAttribute('rotation', `0 ${-pos.theta * 180/Math.PI} 0`);

    // add curved-panel with src pointing to the asset id
    ent.setAttribute('curved-panel', `width: ${width}; height: ${height}; curvature: 0.45; src: #${meta.id}`);

    // keep it looking at camera for tiny orientation guarantees (no transform animation)
    ent.setAttribute('look-at', '#camera');

    return ent;
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
      const ent = createCurvedPanel(m, panelHeight);
      panelContainer.appendChild(ent);
      panelEntities.push(ent);
    }
    // if not enough images, duplicate randomly to reach count
    while(panelEntities.length < VISIBLE_PANELS && metaList.length){
      const m = metaList[Math.floor(Math.random()*metaList.length)];
      const ent = createCurvedPanel(m, panelHeight);
      panelContainer.appendChild(ent);
      panelEntities.push(ent);
    }
  }

  // Replace one panel (fade only -> texture swap, no position change)
  function replaceOnePanel(panelHeight){
    if(!panelEntities.length || !metaList.length) return;
    if(unusedPool.length === 0){
      unusedPool = metaList.slice();
      shuffleArray(unusedPool);
    }
    // pick random index
    const idx = Math.floor(Math.random()*panelEntities.length);
    const old = panelEntities[idx];

    // Fade out by lowering material opacity (texture/material on mesh)
    try {
      const mesh = old.getObject3D('mesh');
      if(mesh && mesh.material){
        mesh.material.transparent = true;
        // animate opacity over 600ms
        const start = performance.now();
        const from = mesh.material.opacity !== undefined ? mesh.material.opacity : 1;
        (function fadeOut(now){
          const t = (now - start) / 600;
          mesh.material.opacity = Math.max(0, from * (1 - t));
          if(t < 1) requestAnimationFrame(fadeOut);
          else {
            // swap texture
            const next = unusedPool.shift();
            // update component src so it reloads texture
            old.setAttribute('curved-panel', `src: #${next.id}`);

            // fade in
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
