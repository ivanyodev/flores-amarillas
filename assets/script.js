(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouch = matchMedia('(pointer: coarse)').matches;
  const isMobile = isTouch || innerWidth < 720;

  /* ---------- utilidades ---------- */
  const C = (h) => new THREE.Color(h).convertSRGBToLinear();
  const lerp = (a, b, t) => a + (b - a) * t;
  const deg = (d) => (d * Math.PI) / 180;
  let seed = 11;
  const rnd = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rr = (a, b) => a + rnd() * (b - a);

  /* ---------- renderer ---------- */
  const canvas = $('#scene');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
  } catch (e) {
    $('#nogl').style.display = 'flex';
    $('#welcome').style.display = 'none';
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

  /* ---------- luces: cálidas al frente, frías por detrás ---------- */
  scene.add(new THREE.HemisphereLight(0xfff0c8, 0x0a2a33, 0.62));
  const key = new THREE.DirectionalLight(0xffd68a, 1.35);
  key.position.set(3, 6, 7);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x4fd1c5, 0.95);
  rim.position.set(-6, 2, -5);
  scene.add(rim);
  const heart = new THREE.PointLight(0xffb830, 0, 9, 2);

  /* ---------- texturas generadas por código ---------- */
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }

  const petalTex = canvasTex(128, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#fff3b0');
    gr.addColorStop(0.32, '#ffd521');
    gr.addColorStop(0.78, '#ffb300');
    gr.addColorStop(1, '#d97800');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,250,200,.22)';
    g.fillRect(w / 2 - 3, 0, 6, h);
    for (let i = -7; i <= 7; i++) {
      g.strokeStyle = `rgba(150,70,0,${0.06 + (1 - Math.abs(i) / 8) * 0.1})`;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(w / 2 + i * (w / 16), h);
      g.lineTo(w / 2 + i * (w / 16), 0);
      g.stroke();
    }
  });

  const leafTex = canvasTex(128, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#63c47a');
    gr.addColorStop(0.5, '#2fa06a');
    gr.addColorStop(1, '#14603f');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(210,255,200,.55)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(w / 2, h);
    g.lineTo(w / 2, 0);
    g.stroke();
    g.lineWidth = 1.4;
    g.strokeStyle = 'rgba(200,255,200,.25)';
    for (let k = 1; k < 10; k++) {
      const y = h - k * 24;
      g.beginPath();
      g.moveTo(w / 2, y);
      g.lineTo(6, y - 34);
      g.moveTo(w / 2, y);
      g.lineTo(w - 6, y - 34);
      g.stroke();
    }
  });

  const glowTex = canvasTex(256, 256, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,214,110,1)');
    gr.addColorStop(0.35, 'rgba(255,170,40,.42)');
    gr.addColorStop(1, 'rgba(255,150,20,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });

  /* ---------- geometría de pétalo / hoja ---------- */
  // Se extiende a lo largo de +X, el ancho va en Z y la curvatura en Y.
  function bladeGeo(L, W, curl, a, b) {
    const g = new THREE.PlaneGeometry(1, 1, 6, 16);
    const p = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      let prof = Math.pow(Math.max(Math.sin(Math.PI * Math.pow(v, a)), 0), b);
      prof += 0.1 * Math.pow(1 - v, 3);
      const side = (u - 0.5) * 2;
      p.setXYZ(i, v * L, curl * L * v * v + side * side * 0.16 * W * prof, (u - 0.5) * W * prof);
    }
    g.computeVertexNormals();
    return g;
  }

  const mat = (map, emissive, ei) =>
    new THREE.MeshStandardMaterial({
      map,
      roughness: 0.55,
      metalness: 0,
      side: THREE.DoubleSide,
      emissive: C(emissive),
      emissiveIntensity: ei,
    });

  const petalMat = mat(petalTex, 0x4a2a00, 0.38);
  const leafMat = mat(leafTex, 0x0a3a20, 0.3);

  /* ---------- la flor ---------- */
  const root = new THREE.Group();
  scene.add(root);
  root.visible = false;

  const stemCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -4.8, 0),
    new THREE.Vector3(0.16, -3.2, 0.05),
    new THREE.Vector3(-0.14, -1.7, 0.12),
    new THREE.Vector3(0.06, -0.5, 0.06),
    new THREE.Vector3(0, 0.6, 0),
  ]);

  const TUB = 120;
  const RAD = 8;
  const stem = new THREE.Mesh(new THREE.TubeGeometry(stemCurve, TUB, 0.075, RAD, false), leafMat);
  root.add(stem);

  // hojas
  const leaves = [
    { t: 0.3, ang: -0.5, L: 2.3 },
    { t: 0.46, ang: Math.PI + 0.55, L: 2.1 },
    { t: 0.62, ang: -0.3, L: 1.7 },
    { t: 0.76, ang: Math.PI + 0.3, L: 1.3 },
  ].map((d) => {
    const pivot = new THREE.Group();
    pivot.position.copy(stemCurve.getPointAt(d.t));
    pivot.rotation.y = d.ang;
    const mesh = new THREE.Mesh(bladeGeo(d.L, d.L * 0.44, -0.3, 0.6, 0.8), leafMat);
    mesh.position.x = 0.05;
    mesh.rotation.order = 'ZYX';
    pivot.add(mesh);
    root.add(pivot);
    return { ...d, pivot, mesh, open: deg(30 + rr(-4, 6)) };
  });

  // cabeza: head (posición y escala) > tilt (cabeceo) > spin (giro propio)
  const head = new THREE.Group();
  root.add(head);
  const tilt = new THREE.Group();
  head.add(tilt);
  const spin = new THREE.Group();
  tilt.add(spin);
  tilt.add(heart);
  heart.position.set(0, 1.1, 0);

  const GOLD = 2.39996323;
  const NP = 34;
  const geos = [
    bladeGeo(2.4, 0.78, 0.1, 0.8, 0.62),
    bladeGeo(2.0, 0.68, 0.12, 0.8, 0.62),
    bladeGeo(1.5, 0.55, 0.14, 0.8, 0.62),
  ];
  const petals = [];
  for (let i = 0; i < NP; i++) {
    const r = i / (NP - 1);
    const pivot = new THREE.Group();
    pivot.rotation.y = i * GOLD;
    const mesh = new THREE.Mesh(geos[r < 0.38 ? 0 : r < 0.72 ? 1 : 2], petalMat);
    mesh.rotation.order = 'ZYX';
    mesh.position.set(lerp(0.9, 0.78, r), lerp(-0.02, 0.05, r), 0);
    mesh.scale.setScalar(rr(0.94, 1.06));
    const closed = deg(lerp(86, 80, r));
    const open = deg(lerp(8, 58, Math.pow(r, 1.2)) + rr(-4, 4));
    mesh.rotation.z = closed;
    pivot.add(mesh);
    spin.add(pivot);
    petals.push({ mesh, closed, open, tw: rr(-0.28, 0.28) });
  }

  // sépalos y receptáculo verde
  const sepalGeo = bladeGeo(1.15, 0.42, 0.08, 0.7, 0.7);
  const sepals = [];
  for (let i = 0; i < 9; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.y = (i / 9) * Math.PI * 2 + 0.2;
    const mesh = new THREE.Mesh(sepalGeo, leafMat);
    mesh.position.set(0.42, -0.12, 0);
    mesh.rotation.z = deg(80);
    pivot.add(mesh);
    spin.add(pivot);
    sepals.push(mesh);
  }

  const cup = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 14), leafMat);
  cup.scale.y = 0.55;
  cup.position.y = -0.14;
  spin.add(cup);

  // disco de semillas en espiral de Fibonacci
  const disc = new THREE.Group();
  disc.position.y = -0.02;
  spin.add(disc);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.84, 0.8, 0.16, 40),
    new THREE.MeshStandardMaterial({ color: C(0x4a2a0a), roughness: 0.9 })
  );
  disc.add(base);

  const NS = isMobile ? 380 : 560;
  const R = 0.82;
  const seeds = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 7, 6),
    new THREE.MeshStandardMaterial({
      roughness: 0.75,
      metalness: 0.05,
      emissive: C(0x2a1200),
      emissiveIntensity: 0.35,
    }),
    NS
  );
  const dummy = new THREE.Object3D();
  const c1 = C(0x2b1406);
  const c2 = C(0xb8790f);
  const c3 = C(0xf0b030);
  const col = new THREE.Color();

  for (let k = 0; k < NS; k++) {
    const rad = R * Math.sqrt((k + 0.5) / NS);
    const th = k * GOLD;
    const t = rad / R;
    const s = 0.03 + t * 0.014;
    dummy.position.set(Math.cos(th) * rad, 0.07 + 0.17 * (1 - t * t), Math.sin(th) * rad);
    dummy.scale.set(s, s * 0.7, s);
    dummy.updateMatrix();
    seeds.setMatrixAt(k, dummy.matrix);
    col.copy(c1).lerp(c2, Math.min(1, t * 1.25 + rr(-0.08, 0.1)));
    if (t > 0.82 && rnd() < 0.5) col.lerp(c3, 0.6);
    seeds.setColorAt(k, col);
  }
  disc.add(seeds);

  // halo cálido detrás de la flor
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  glow.scale.set(9, 9, 1);
  scene.add(glow);

  /* ---------- partículas de fondo (polvo dorado) ---------- */
  const AN = isMobile ? 150 : 340;
  const aPos = new Float32Array(AN * 3);
  const aData = new Float32Array(AN * 3);
  for (let i = 0; i < AN; i++) {
    aPos.set([rr(-9, 9), rr(-7, 7), rr(-6, 5)], i * 3);
    aData.set([rr(0.12, 0.42), rnd(), rnd() < 0.1 ? rr(2.4, 3.6) : rr(0.5, 1.9)], i * 3);
  }
  const ambGeo = new THREE.BufferGeometry();
  ambGeo.setAttribute('position', new THREE.BufferAttribute(aPos, 3));
  ambGeo.setAttribute('aData', new THREE.BufferAttribute(aData, 3));

  const ambMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPx: { value: renderer.getPixelRatio() },
      uAlpha: { value: 0.6 },
      uSpread: { value: 1 },
    },
    vertexShader: `
      uniform float uTime, uPx, uSpread; attribute vec3 aData; varying float vA;
      void main(){
        float H = 14.0;
        float y = mod(position.y + uTime * aData.x + H * .5, H) - H * .5;
        float x = (position.x + sin(uTime * .4 + aData.y * 6.283) * .35) * uSpread;
        float z = position.z + cos(uTime * .3 + aData.y * 6.283) * .3;
        vec4 mv = modelViewMatrix * vec4(x, y, z, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aData.z * uPx * 80.0 / -mv.z;
        float tw = .55 + .45 * sin(uTime * (1.2 + aData.y * 2.0) + aData.y * 40.0);
        vA = tw * (1.0 - smoothstep(4.5, 7.0, abs(y)));
      }`,
    fragmentShader: `
      uniform float uAlpha; varying float vA;
      void main(){
        float d = length(gl_PointCoord - .5);
        float a = pow(smoothstep(.5, .0, d), 2.0);
        vec3 c = mix(vec3(1.0, .68, .16), vec3(1.0, .93, .6), a);
        gl_FragColor = vec4(c, a * vA * uAlpha);
      }`,
  });

  const ambient = new THREE.Points(ambGeo, ambMat);
  ambient.frustumCulled = false;
  scene.add(ambient);

  /* ---------- polen (explosión de partículas) ---------- */
  const BN = 700;
  const bPos = new Float32Array(BN * 3);
  const bVel = new Float32Array(BN * 3);
  const bLife = new Float32Array(BN);
  const bSize = new Float32Array(BN);
  const burstGeo = new THREE.BufferGeometry();
  burstGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3).setUsage(THREE.DynamicDrawUsage));
  burstGeo.setAttribute('aLife', new THREE.BufferAttribute(bLife, 1).setUsage(THREE.DynamicDrawUsage));
  burstGeo.setAttribute('aSize', new THREE.BufferAttribute(bSize, 1));

  const burstMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uPx: { value: renderer.getPixelRatio() } },
    vertexShader: `
      uniform float uPx; attribute float aLife, aSize; varying float vL;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPx * 80.0 / -mv.z * (.5 + .5 * aLife);
        vL = aLife;
      }`,
    fragmentShader: `
      varying float vL;
      void main(){
        float d = length(gl_PointCoord - .5);
        float a = pow(smoothstep(.5, .0, d), 1.6);
        gl_FragColor = vec4(mix(vec3(1.0, .6, .1), vec3(1.0, .95, .7), a), a * pow(vL, 1.3));
      }`,
  });

  const burstPts = new THREE.Points(burstGeo, burstMat);
  burstPts.frustumCulled = false;
  scene.add(burstPts);

  let bi = 0;
  function burst(origin, n, speed) {
    for (let k = 0; k < n; k++) {
      const i = bi++ % BN;
      const th = rnd() * Math.PI * 2;
      const ph = Math.acos(2 * rnd() - 1);
      const sp = rr(0.3, 1) * speed;
      bPos.set([origin.x, origin.y, origin.z], i * 3);
      bVel.set(
        [Math.sin(ph) * Math.cos(th) * sp, Math.sin(ph) * Math.sin(th) * sp + 0.3, Math.cos(ph) * sp],
        i * 3
      );
      bLife[i] = 1;
      bSize[i] = rr(0.5, 1.5);
    }
    burstGeo.attributes.aSize.needsUpdate = true;
  }

  function updateBurst(dt) {
    let any = false;
    const drag = Math.pow(0.35, dt);
    for (let i = 0; i < BN; i++) {
      if (bLife[i] <= 0) continue;
      any = true;
      bPos[i * 3] += bVel[i * 3] * dt;
      bPos[i * 3 + 1] += bVel[i * 3 + 1] * dt;
      bPos[i * 3 + 2] += bVel[i * 3 + 2] * dt;
      bVel[i * 3] *= drag;
      bVel[i * 3 + 1] = bVel[i * 3 + 1] * drag + 0.06 * dt;
      bVel[i * 3 + 2] *= drag;
      bLife[i] = Math.max(0, bLife[i] - dt * 0.42);
    }
    if (any) {
      burstGeo.attributes.position.needsUpdate = true;
      burstGeo.attributes.aLife.needsUpdate = true;
    }
  }

  /* ---------- estado de la escena ---------- */
  let started = false;
  let bloomed = false;
  let tl = null;

  function setStem(p) {
    stem.geometry.setDrawRange(0, Math.max(3, Math.floor(p * TUB) * RAD * 6));
    head.position.copy(stemCurve.getPointAt(Math.max(p, 0.001)));
  }

  function resetFlower() {
    bloomed = false;
    setStem(0);
    head.scale.setScalar(0.28);
    tilt.rotation.x = 0.08;
    spin.rotation.y = 0;
    petals.forEach((p) => {
      p.mesh.rotation.z = p.closed;
      p.mesh.rotation.x = 0;
    });
    sepals.forEach((s) => {
      s.rotation.z = deg(80);
    });
    disc.scale.setScalar(0.001);
    heart.intensity = 0;
    glow.material.opacity = 0;
    leaves.forEach((l) => {
      l.pivot.scale.setScalar(0.001);
      l.mesh.rotation.z = deg(88);
    });
    gsap.set('#name .outro__char', { opacity: 0, yPercent: 60, filter: 'blur(10px)' });
    gsap.set('#line', { scaleX: 0 });
    gsap.set('#hint', { opacity: 0 });
    gsap.set('#fade', { opacity: 0 });
    $('#cap-text').textContent = '';
  }

  const tmp = new THREE.Vector3();
  function bloomBurst(n, speed) {
    head.getWorldPosition(tmp);
    tmp.y += 0.6;
    tmp.z += 1;
    burst(tmp, n, speed);
  }

  function buildName(name) {
    const el = $('#name');
    el.innerHTML = '';
    el.setAttribute('aria-label', name);
    name
      .split(/\s+/)
      .filter(Boolean)
      .forEach((word) => {
        const w = document.createElement('span');
        w.className = 'outro__word';
        w.setAttribute('aria-hidden', 'true');
        [...word].forEach((ch) => {
          const s = document.createElement('span');
          s.className = 'outro__char';
          s.textContent = ch;
          w.appendChild(s);
        });
        el.appendChild(w);
      });
    const len = Math.max(name.length, 6);
    el.style.setProperty('--fs', Math.round(Math.min(96, Math.max(38, (innerWidth * 0.9) / (len * 0.5)))) + 'px');
  }

  function play() {
    if (tl) tl.kill();
    resetFlower();
    root.visible = true;
    started = true;
    $('#outro').style.display = 'flex';
    const S = { p: 0 };
    tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    if (reduceMotion) tl.timeScale(2);

    // 1) brota el tallo con un capullo en la punta
    const stemDur = 3.4;
    tl.to(S, { p: 1, duration: stemDur, ease: 'power2.out', onUpdate: () => setStem(S.p) }, 0.3);
    tl.to('#fade', { opacity: 1, duration: 1.6 }, 0.3);
    leaves.forEach((l) => {
      const at = 0.3 + stemDur * (1 - Math.sqrt(1 - l.t)); // cuando el tallo pasa por su altura
      tl.to(l.pivot.scale, { x: 1, y: 1, z: 1, duration: 1.4, ease: 'power2.out' }, at);
      tl.to(l.mesh.rotation, { z: l.open, duration: 2.0, ease: 'back.out(1.3)' }, at);
    });

    // 2) el capullo crece y cabecea hacia ti
    tl.to(head.scale, { x: 0.5, y: 0.5, z: 0.5, duration: 0.9, ease: 'power2.inOut' }, 3.5);
    tl.to(tilt.rotation, { x: 0.95, duration: 2.6, ease: 'power3.inOut' }, 4.1);
    tl.to(sepals.map((s) => s.rotation), { z: deg(-14), duration: 1.6, ease: 'back.out(1.5)', stagger: 0.04 }, 4.3);

    // 3) florece pétalo por pétalo, de afuera hacia adentro
    tl.to(head.scale, { x: 1, y: 1, z: 1, duration: 4.4, ease: 'power2.inOut' }, 4.6);
    petals.forEach((p, i) => {
      tl.to(p.mesh.rotation, { z: p.open, x: p.tw, duration: 2.0, ease: 'back.out(1.25)' }, 4.6 + i * 0.085);
    });
    tl.to(disc.scale, { x: 1, y: 1, z: 1, duration: 1.8, ease: 'power2.out' }, 5.7);
    tl.to(heart, { intensity: 1.7, duration: 3.2, ease: 'sine.inOut' }, 5.2);
    tl.to(glow.material, { opacity: 0.5, duration: 3.5, ease: 'sine.inOut' }, 5.2);
    tl.call(() => bloomBurst(isMobile ? 130 : 230, 2.6), null, 7.0);
    tl.call(() => bloomBurst(isMobile ? 60 : 110, 1.6), null, 8.4);

    // 4) aparece el nombre
    tl.to('#name .outro__char', { opacity: 1, yPercent: 0, filter: 'blur(0px)', duration: 1.2, ease: 'power3.out', stagger: 0.08 }, 6.4);
    tl.to('#line', { scaleX: 1, duration: 1.4, ease: 'power2.inOut' }, 7.6);
    const cap = 'flor.florecer();  // listo';
    const o = { n: 0 };
    tl.to(
      o,
      {
        n: cap.length,
        duration: 1.5,
        ease: 'none',
        onUpdate: () => {
          $('#cap-text').textContent = cap.slice(0, Math.round(o.n));
        },
      },
      8.0
    );
    tl.call(() => {
      bloomed = true;
    }, null, 9.0);
    tl.to('#hint', { opacity: 1, duration: 1 }, 9.6);
    tl.to('#hint', { opacity: 0, duration: 1.2 }, 16);
  }

  /* ---------- encuadre responsivo ---------- */
  let distMul = 1;
  const TAN = Math.tan(deg(camera.fov / 2));
  const vis = { cx: 0, cy: 0, dist: 11 };

  function resize() {
    const w = innerWidth;
    const h = innerHeight;
    const aspect = w / h;
    renderer.setSize(w, h);
    camera.aspect = aspect;
    const needH = 4.9 / 0.6;
    const needW = 5.8;
    vis.dist = Math.max(needH / (2 * TAN), needW / (2 * TAN * aspect));
    ambMat.uniforms.uSpread.value = Math.min(1.2, Math.max(0.45, aspect / 1.6));
    ambMat.uniforms.uPx.value = burstMat.uniforms.uPx.value = renderer.getPixelRatio();
    camera.updateProjectionMatrix();
  }

  addEventListener('resize', () => {
    resize();
    if (started) buildName($('#name').getAttribute('aria-label') || '');
  });
  resize();

  /* ---------- interacción: arrastrar, tocar, parallax, rueda ---------- */
  let dragging = false;
  let lastX = 0;
  let moved = 0;
  let target = 0;
  let rotY = 0;
  const ptr = { x: 0, y: 0, sx: 0, sy: 0 };
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hit = new THREE.Vector3();

  canvas.addEventListener('pointerdown', (e) => {
    if (!started) return;
    dragging = true;
    moved = 0;
    lastX = e.clientX;
    canvas.classList.add('scene--dragging');
    canvas.setPointerCapture(e.pointerId);
    gsap.to('#hint', { opacity: 0, duration: 0.5 });
  });

  canvas.addEventListener('pointermove', (e) => {
    ptr.x = (e.clientX / innerWidth) * 2 - 1;
    ptr.y = (e.clientY / innerHeight) * 2 - 1;
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    moved += Math.abs(dx);
    target += dx * 0.009;
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove('scene--dragging');
    if (moved < 6 && bloomed) {
      // toque: suelta polen donde tocaste
      const v = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 - 1);
      ray.setFromCamera(v, camera);
      if (ray.ray.intersectPlane(plane, hit)) burst(hit, 46, 1.4);
    }
    target = ((((target + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  };

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener(
    'wheel',
    (e) => {
      distMul = Math.min(1.25, Math.max(0.75, distMul + e.deltaY * 0.0006));
    },
    { passive: true }
  );

  /* ---------- bucle de render ---------- */
  const clock = new THREE.Clock();
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    ambMat.uniforms.uTime.value = reduceMotion ? t * 0.2 : t;

    if (!dragging) target += (0 - target) * (1 - Math.exp(-dt * 0.7));
    const sway = bloomed ? Math.sin(t * 0.35) * 0.22 : 0;
    rotY += (target + sway - rotY) * (1 - Math.exp(-dt * 6));
    root.rotation.y = rotY;

    if (started) {
      head.rotation.z = Math.sin(t * 0.6) * 0.03;
      if (bloomed) {
        spin.rotation.y += dt * 0.05;
        petals.forEach((p, i) => {
          p.mesh.rotation.z = p.open + Math.sin(t * 0.9 + i * 0.35) * 0.022;
        });
        heart.intensity = 1.7 + Math.sin(t * 1.4) * 0.18;
      }
      head.getWorldPosition(tmp);
      glow.position.set(tmp.x, tmp.y + 0.5, tmp.z - 1.8);
    }

    // cámara: encuadre + parallax suave
    ptr.sx += (ptr.x - ptr.sx) * (1 - Math.exp(-dt * 3));
    ptr.sy += (ptr.y - ptr.sy) * (1 - Math.exp(-dt * 3));
    const dist = vis.dist * distMul;
    const halfH = dist * TAN;
    vis.cy = 0.6 - 0.24 * halfH;
    camera.position.set(ptr.sx * 0.7, vis.cy + 1.1 - ptr.sy * 0.35, dist);
    camera.lookAt(0, vis.cy, 0);

    updateBurst(dt);
    renderer.render(scene, camera);
  }
  frame();

  /* ---------- pantalla de bienvenida ---------- */
  const input = $('#nombre');
  const errEl = $('#err');
  const field = $('#field');
  const wrap = $('#ctaWrap');
  const go = $('#go');

  input.addEventListener('input', () => {
    const v = input.value.trim().replace(/"/g, '');
    $('#live').textContent = '"' + (v || '…') + '"';
    errEl.textContent = '';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  go.addEventListener('click', submit);

  function spark(x, y, spread) {
    const s = document.createElement('span');
    s.className = 'spark';
    const a = Math.random() * Math.PI * 2;
    const d = (spread || 30) * (0.4 + Math.random());
    s.style.cssText = `--x:${x}px;--y:${y}px;--s:${3 + Math.random() * 7}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 8}px`;
    s.addEventListener('animationend', () => s.remove());
    wrap.appendChild(s);
  }

  let lastSpark = 0;
  go.addEventListener('pointermove', (e) => {
    if (reduceMotion || performance.now() - lastSpark < 55) return;
    lastSpark = performance.now();
    const r = wrap.getBoundingClientRect();
    spark(e.clientX - r.left, e.clientY - r.top, 34);
  });

  /* ---------- música: 01.mp3 al abrir el regalo, 02.mp3 al ver la sorpresa ---------- */
  const music1 = new Audio('assets/01.mp3');
  const music2 = new Audio('assets/02.mp3');
  const MAXV = 0.8;
  [music1, music2].forEach((a) => {
    a.loop = true;
    a.preload = 'auto';
    a.volume = 0;
  });
  const playSafe = (a) => {
    const p = a.play();
    if (p && p.catch) p.catch(() => { });
  };

  $('#enter').addEventListener('click', () => {
    playSafe(music1);
    gsap.to(music1, { volume: MAXV, duration: 2 });
    $('#welcome').inert = false;
    gsap.to('#gate', {
      opacity: 0,
      duration: 0.9,
      onComplete: () => {
        $('#gate').style.display = 'none';
        if (!isTouch) input.focus();
      },
    });
  });

  // Lista de nombres invitados (sin tildes ni mayúsculas para comparar)
  const norm = (t) =>
    t
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

  const INVITADAS = { edita: 'Edita', gabriela: 'Gabriela', invitada: 'Invitada' };
  const BURLAS = [
    'Mmm... si fueras mi amiga de verdad, esta flor ya estaría floreciendo para ti.',
    'Qué lástima: esta sorpresa es exclusiva y tu nombre no está en la lista. Ni con cara de pena.',
    'Si fueras mi amiga de verdad, no tendrías que estar adivinando el nombre. Sigue intentando.',
    'Acceso denegado. Las flores amarillas solo florecen para gente con muy buen gusto y nombre autorizado.',
    'Esa flor no es para ti. Ya sabes quién sí es mi amiga, y no eres tú.',
    'Uy, casi. Pero "casi mi amiga" no cuenta como invitación.',
  ];
  let burlaIdx = Math.floor(Math.random() * BURLAS.length);

  function submit() {
    const typed = input.value.trim().replace(/\s+/g, ' ');
    if (!typed) {
      errEl.textContent = 'Escribe tu nombre para que la flor sepa si te reconoce.';
      field.classList.remove('field--shake');
      void field.offsetWidth;
      field.classList.add('field--shake');
      input.focus();
      return;
    }
    const name = INVITADAS[norm(typed)];
    if (!name) {
      burlaIdx = (burlaIdx + 1) % BURLAS.length;
      errEl.textContent = BURLAS[burlaIdx] + ' Si solo vienes de visita, escribe "invitada".';
      field.classList.remove('field--shake');
      void field.offsetWidth;
      field.classList.add('field--shake');
      input.select();
      return;
    }
    go.disabled = true;
    gsap.to(music1, {
      volume: 0,
      duration: 1.2,
      onComplete: () => music1.pause(),
    });
    music2.currentTime = 0;
    playSafe(music2);
    gsap.to(music2, { volume: MAXV, duration: 2.5 });
    if (!reduceMotion) for (let i = 0; i < 30; i++) spark(wrap.offsetWidth / 2, wrap.offsetHeight / 2, 90);
    buildName(name);
    gsap
      .timeline()
      .to('#stack', { opacity: 0, y: -24, scale: 1.03, filter: 'blur(8px)', duration: 0.8, ease: 'power2.in' })
      .to(ambMat.uniforms.uAlpha, { value: 1, duration: 1.5 }, 0)
      .call(() => {
        $('#welcome').style.display = 'none';
        play();
      });
  }
})();
