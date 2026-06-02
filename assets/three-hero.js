// Three.js hero animation — оранжевая «планета» с шейдерным noise-distortion и glow.
// Brand-цвета: orange #FF5B0E → yellow #FFA928. Курсор управляет parallax.
// Lazy-init: запускается только когда canvas попадает во viewport.

import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const VERTEX_SHADER = /* glsl */`
  uniform float uTime;
  uniform float uIntensity;
  varying vec3 vNormal;
  varying vec3 vPosition;

  // Classic 3D simplex noise (Ashima)
  vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
  vec4 mod289v4(vec4 x){return x-floor(x*(1./289.))*289.;}
  vec4 permute(vec4 x){return mod289v4(((x*34.)+10.)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1./6.,1./3.); const vec4 D=vec4(0.,.5,1.,2.);
    vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
    float n_=.142857142857; vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.*x_);
    vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.+1.; vec4 s1=floor(b1)*2.+1.; vec4 sh=-step(h,vec4(0.));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
    vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.); m=m*m;
    return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }

  void main() {
    vNormal = normal;
    float n = snoise(position * 1.2 + vec3(uTime * 0.25));
    float displaced = n * uIntensity;
    vec3 pos = position + normal * displaced;
    vPosition = pos;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */`
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    // Direction-based gradient (top → bottom)
    float t = (vPosition.y + 2.0) / 4.0;
    vec3 col = mix(uColorA, uColorB, smoothstep(0.0, 0.7, t));
    col = mix(col, uColorC, smoothstep(0.6, 1.0, t));

    // Fresnel / rim light
    vec3 viewDir = normalize(cameraPosition - vPosition);
    float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 2.5);
    col += vec3(1.0, 0.78, 0.32) * fresnel * 0.6;

    // Subtle pulse
    col *= 0.85 + 0.15 * sin(uTime * 0.8 + vPosition.x * 2.0);

    gl_FragColor = vec4(col, 1.0);
  }
`;

function init(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();

  const w = canvas.clientWidth, h = canvas.clientHeight;
  const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
  camera.position.set(0, 0, 6.2);

  // Sphere with shader-based displacement
  const geom = new THREE.IcosahedronGeometry(2, 32);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0.18 },
      uColorA: { value: new THREE.Color(0xFFD93D) },   // верх — жёлтый
      uColorB: { value: new THREE.Color(0xFF8A1A) },   // середина — оранжевый
      uColorC: { value: new THREE.Color(0xE5350A) },   // низ — глубокий красно-оранж
    },
  });
  const sphere = new THREE.Mesh(geom, mat);
  scene.add(sphere);

  // Glow: large semi-transparent sphere
  const glowGeom = new THREE.SphereGeometry(2.7, 32, 32);
  const glowMat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `varying vec3 vNormal; void main(){ vNormal=normal; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: `varying vec3 vNormal; void main(){ float a = pow(1.0-abs(vNormal.z), 3.0)*0.7; gl_FragColor = vec4(1.0, 0.62, 0.16, a); }`,
  });
  const glow = new THREE.Mesh(glowGeom, glowMat);
  scene.add(glow);

  // Mouse parallax
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  const onMove = (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    mouse.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
  };
  window.addEventListener('pointermove', onMove, { passive: true });

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const clock = new THREE.Clock();
  let running = true;

  // Pause when off-screen
  const visObserver = new IntersectionObserver((entries) => {
    for (const e of entries) running = e.isIntersecting;
  }, { threshold: 0.05 });
  visObserver.observe(canvas);

  function tick() {
    requestAnimationFrame(tick);
    if (!running) return;
    const t = clock.getElapsedTime();
    mat.uniforms.uTime.value = t;
    // Smooth mouse interpolation
    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;
    sphere.rotation.y = t * 0.25 + mouse.x * 0.35;
    sphere.rotation.x = mouse.y * 0.25 + Math.sin(t * 0.3) * 0.08;
    glow.rotation.copy(sphere.rotation);
    renderer.render(scene, camera);
  }
  tick();
}

// Public API
export function initHero3D(selector = '#lc-three-hero') {
  const canvas = document.querySelector(selector);
  if (!canvas) return;
  // Skip on tiny screens — экономим батарею и трафик
  if (window.matchMedia('(max-width: 720px)').matches) {
    canvas.style.display = 'none';
    return;
  }
  // Skip if user prefers reduced motion
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  try { init(canvas); } catch (e) { console.warn('Three.js hero init failed', e); }
}

// Auto-init when imported
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initHero3D());
} else {
  initHero3D();
}
