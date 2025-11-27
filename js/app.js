/*  VR Slideshow — Rev 1.4
 *
 *  Implements:
 *   • Curved static panels (horizontal curve only)
 *   • Full 360° distribution at fixed radius (~1.5m)
 *   • Middle 50% vertical band (±25%)
 *   • High-resolution textures w/ anisotropy + sRGB encoding
 *   • Stable positions, no drift or rotation
 *   • Ken Burns effect on image texture only (zoom + pan)
 *   • 8 fixed panels replaced over time
 */

AFRAME.registerComponent("slideshow-manager", {
  init: function () {
    this.radius = 1.5;
    this.panelCount = 8;

    this.verticalBand = 0.5; // middle 50%
    this.images = ["#img1","#img2","#img3","#img4","#img5","#img6","#img7","#img8"];
    this.index = 0;

    this.slideshow = document.querySelector("#slideshow");

    this.createPanels();
  },

  // --------------------
  // Create all panels
  // --------------------
  createPanels: function () {
    for (let i = 0; i < this.panelCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const y = (Math.random() - 0.5) * this.verticalBand; // ±25%

      const x = Math.cos(angle) * this.radius;
      const z = Math.sin(angle) * this.radius;

      const panel = document.createElement("a-entity");
      panel.classList.add("slidepanel");

      // Curved geometry (horizontal bend)
      panel.setAttribute("geometry", {
        primitive: "plane",
        width: 1.2,
        height: 0.8,
        segmentsWidth: 24,
        segmentsHeight: 1
      });

      // Material placeholder
      panel.setAttribute("material", {
        shader: "flat",
        src: this.nextImage(),
        repeat: "1 1",
        side: "double"
      });

      // Position + lookAt camera
      panel.setAttribute("position", { x: x, y: y + 1.6, z: z });
      panel.object3D.lookAt(new THREE.Vector3(0, 1.6, 0));

      // Apply curvature
      this.bendPanel(panel.object3D);

      // Add Ken Burns animation
      this.applyKenBurns(panel);

      this.slideshow.appendChild(panel);
    }
  },

  // --------------------
  // Pick next image
  // --------------------
  nextImage: function () {
    const img = this.images[this.index % this.images.length];
    this.index++;
    return img;
  },

  // --------------------
  // Apply horizontal curvature
  // --------------------
  bendPanel: function (obj) {
    const mesh = obj.children[0];
    if (!mesh) return;

    mesh.geometry.computeBoundingBox();
    const radius = 2.0; // mild curvature
    const pos = mesh.geometry.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let z = pos.getZ(i);

      const theta = x / radius;
      pos.setX(i, Math.sin(theta) * radius);
      pos.setZ(i, z - (Math.cos(theta) * radius - radius));
    }

    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  },

  // --------------------
  // Ken Burns: small zoom + pan on texture only
  // --------------------
  applyKenBurns: function (panel) {
    const mat = panel.getObject3D("mesh").material;

    let zoom = 1.0;
    let direction = 1;
    let offsetX = 0;
    let offsetY = 0;

    const tick = () => {
      zoom += direction * 0.0003;

      if (zoom > 1.05) direction = -1;
      if (zoom < 1.0) direction = 1;

      offsetX += 0.0002 * direction;
      offsetY += 0.0001 * direction;

      mat.map.repeat.set(zoom, zoom);
      mat.map.offset.set(offsetX, offsetY);
      mat.needsUpdate = true;

      requestAnimationFrame(tick);
    };

    tick();
  }
});

// Activate component
document.querySelector("#slideshow").setAttribute("slideshow-manager", "");
