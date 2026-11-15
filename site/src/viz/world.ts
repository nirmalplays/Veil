// The 3D world of the live page: every party in one Veil request, as a place a message travels through.
// Your device (left) → the site's relay (a gate) → NEAR AI's gateway (a hex tunnel) → the enclave (a sealed core in rings of light).
// Above them: the NEAR blockchain (a chain of blocks) and the two seal authorities, Intel and NVIDIA.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { gsap } from "gsap";

export type Station = "you" | "relay" | "gateway" | "enclave" | "near" | "intel" | "nvidia";
export type PacketKind = "plain" | "cipher" | "nonce" | "proof" | "answer" | "ping" | "warn";
export type View = "overview" | "you" | "near" | "relay" | "enclave" | "sky" | "path";

const C = {
  ink: 0x060608, white: 0xf2f2f5, lav: 0xc9bbff, violet: 0x9d86ff, cyan: 0x5ee6ff, mint: 0xa6ebcb, amber: 0xf2cf94, rose: 0xff8fa3, dim: 0x2a2a35,
};
const KIND_COLOR: Record<PacketKind, number> = { plain: C.white, cipher: C.violet, nonce: C.cyan, proof: C.mint, answer: C.lav, ping: C.white, warn: C.amber };

export const POS: Record<Station, THREE.Vector3> = {
  you: new THREE.Vector3(-10, 0, 0),
  relay: new THREE.Vector3(-3.4, 0, 0),
  gateway: new THREE.Vector3(2.6, 0, 0),
  enclave: new THREE.Vector3(9.6, 0, 0),
  near: new THREE.Vector3(-2.6, 5.3, -3.4),
  intel: new THREE.Vector3(3.0, 5.6, -3.4),
  nvidia: new THREE.Vector3(7.2, 5.6, -3.4),
};
const VIEWS: Record<Exclude<View, "path">, { pos: [number, number, number]; look: [number, number, number] }> = {
  overview: { pos: [0.6, 4.4, 21.5], look: [0.6, 1.3, 0] },
  you: { pos: [-13.2, 1.3, 9.4], look: [-12.4, 0.7, 0] },
  near: { pos: [-5.4, 5.6, 8.4], look: [-3.6, 4.4, -3] },
  relay: { pos: [-7.6, 1.8, 12.5], look: [-6.4, 0.6, 0] },
  enclave: { pos: [5.2, 2.4, 14.5], look: [7.0, 1.2, 0] },
  sky: { pos: [3.0, 4.6, 11], look: [4.4, 3.8, -2] },
};

/** Soft round glow sprite texture. */
function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d")!, r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,255,255,.55)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** A rim-lit sphere: dark in the middle, glowing at the edge. */
function fresnelMaterial(color: number, power = 2.2, intensity = 1.6) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uPower: { value: power }, uIntensity: { value: intensity }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uPower; uniform float uIntensity; uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ float f = pow(1. - max(dot(vN, vV), 0.), uPower);
        float bands = .5 + .5*sin(vP.y*9. + uTime*1.6);
        vec3 core = vec3(.015,.012,.03) + uColor*.05*bands;
        gl_FragColor = vec4(core + uColor*f*uIntensity, 1.); }`,
  });
}

/** A line that carries light: dashes flow along it from start to end. */
function flowMaterial(color: number, opacity = 0.55) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uOpacity: { value: opacity }, uBoost: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uTime; uniform float uOpacity; uniform float uBoost; varying vec2 vUv;
      void main(){ float d = fract(vUv.x*14. - uTime*.6); float dash = smoothstep(.0,.08,d)*smoothstep(.55,.4,d);
        float a = (.18 + dash*.55) * uOpacity + uBoost*(.5 + .5*dash);
        gl_FragColor = vec4(uColor*(1. + uBoost*2.), a); }`,
  });
}

interface Edge { a: Station; b: Station; curve: THREE.Curve<THREE.Vector3>; mat: THREE.ShaderMaterial }
interface Packet { group: THREE.Group; trail: THREE.Line; trailPts: THREE.Vector3[]; label?: CSS2DObject }

export class World {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private labels: CSS2DRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private look = new THREE.Vector3(0, 1.2, 0);
  private camBase = new THREE.Vector3();
  private pointer = new THREE.Vector2();
  private clock = new THREE.Clock();
  private edges: Edge[] = [];
  private flowMats: THREE.ShaderMaterial[] = [];
  private spinners: { obj: THREE.Object3D; axis: THREE.Vector3; speed: number }[] = [];
  private stationGroups = new Map<Station, THREE.Group>();
  private halos = new Map<Station, THREE.Mesh>();
  private statusDots = new Map<Station, HTMLElement>();
  private glow = glowTexture();
  private enclaveCore!: THREE.ShaderMaterial;
  private enclaveLight!: THREE.PointLight;
  private shell!: THREE.Points;
  private gpus: THREE.Mesh[] = [];
  private screenCanvas = document.createElement("canvas");
  private screenTex!: THREE.CanvasTexture;
  private chainBlocks: THREE.Mesh[] = [];
  private raf = 0;
  private visible = true;
  thinking = 0;

  constructor(private canvas: HTMLCanvasElement, private host: HTMLElement) {
    const w = host.clientWidth, h = host.clientHeight;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    this.renderer.setSize(w, h, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(C.ink);
    this.scene.fog = new THREE.FogExp2(C.ink, 0.028);
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 200);
    this.camBase.set(...VIEWS.overview.pos); this.camera.position.copy(this.camBase);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.95, 0.65, 0.36));
    this.composer.addPass(new OutputPass());
    this.labels = new CSS2DRenderer(); this.labels.setSize(w, h);
    Object.assign(this.labels.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none", zIndex: "2" });
    host.appendChild(this.labels.domElement);

    this.build();
    new ResizeObserver(() => this.resize()).observe(host);
    host.addEventListener("pointermove", (e) => { const r = host.getBoundingClientRect(); this.pointer.set((e.clientX - r.left) / r.width - 0.5, (e.clientY - r.top) / r.height - 0.5); });
    new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; }).observe(host);
    this.loop();
  }

  private resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false); this.composer.setSize(w, h); this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    // keep the whole route in frame on narrow screens
    this.camera.fov = w / h < 1 ? 62 : w / h < 1.4 ? 50 : 44;
    if (w / h >= 1.2) this.camera.setViewOffset(w, h, -w * 0.065, -h * 0.085, w, h); else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ build
  private label(st: Station, name: string, sub: string, y: number) {
    const el = document.createElement("div"); el.className = "w-label";
    el.innerHTML = `<span class="w-dot"></span><b>${name}</b><span>${sub}</span>`;
    const o = new CSS2DObject(el); o.position.set(0, y, 0);
    this.stationGroups.get(st)!.add(o); this.statusDots.set(st, el);
  }
  private station(st: Station) { const g = new THREE.Group(); g.position.copy(POS[st]); this.scene.add(g); this.stationGroups.set(st, g); return g; }
  private halo(st: Station, size: number, color: number) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: this.glow, color, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.stationGroups.get(st)!.add(m); this.halos.set(st, m); return m;
  }
  private edgesOf(geo: THREE.BufferGeometry, color: number, opacity = 0.7) {
    return new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  }

  private build() {
    const s = this.scene;
    s.add(new THREE.AmbientLight(0xffffff, 0.25));
    const key = new THREE.DirectionalLight(0xffffff, 0.6); key.position.set(-6, 10, 8); s.add(key);

    // floor of points and a field of stars
    const floor: number[] = [];
    for (let x = -40; x <= 40; x += 0.7) for (let z = -30; z <= 14; z += 0.7) floor.push(x, -2.6, z);
    const fg = new THREE.BufferGeometry(); fg.setAttribute("position", new THREE.Float32BufferAttribute(floor, 3));
    s.add(new THREE.Points(fg, new THREE.PointsMaterial({ color: 0x3a3650, size: 0.035, transparent: true, opacity: 0.9 })));
    const stars: number[] = [];
    for (let i = 0; i < 1600; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(45 + Math.random() * 40); if (v.y < -4) v.y = -v.y; stars.push(v.x, v.y, v.z - 10); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.Float32BufferAttribute(stars, 3));
    s.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xbfb8ff, size: 0.09, transparent: true, opacity: 0.55, depthWrite: false })));

    // ---- your device: a floating glass screen
    const you = this.station("you");
    const body = new THREE.Mesh(new RoundedBoxGeometry(3.6, 2.3, 0.14, 4, 0.12), new THREE.MeshStandardMaterial({ color: 0x101016, metalness: 0.7, roughness: 0.25 }));
    you.add(body); you.add(this.edgesOf(new THREE.BoxGeometry(3.6, 2.3, 0.14), C.white, 0.35));
    this.screenCanvas.width = 1024; this.screenCanvas.height = 640;
    this.screenTex = new THREE.CanvasTexture(this.screenCanvas); this.screenTex.colorSpace = THREE.SRGBColorSpace; this.screenTex.anisotropy = 4;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.36, 2.1), new THREE.MeshBasicMaterial({ map: this.screenTex, color: new THREE.Color(0.62, 0.62, 0.66) }));
    screen.position.z = 0.08; you.add(screen);
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 12), new THREE.MeshStandardMaterial({ color: 0x22222a, metalness: 0.8, roughness: 0.3 }));
    stand.position.y = -1.8; you.add(stand);
    you.rotation.y = 0.32;
    this.halo("you", 7, C.white).position.z = -0.4;
    this.label("you", "Your device", "your browser tab", -2.75);
    this.setScreen({ eyebrow: "Your question", text: "Waiting to start…", mode: "plain" });

    // ---- the relay: a gate the message passes through
    const relay = this.station("relay");
    const gate = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.07, 24, 120), new THREE.MeshStandardMaterial({ color: 0x1a1a22, metalness: 0.9, roughness: 0.2, emissive: C.amber, emissiveIntensity: 0.25 }));
    gate.rotation.y = Math.PI / 2; relay.add(gate);
    const gateInner = new THREE.Mesh(new THREE.TorusGeometry(1.28, 0.012, 8, 160), new THREE.MeshBasicMaterial({ color: C.amber, transparent: true, opacity: 0.8 }));
    gateInner.rotation.y = Math.PI / 2; relay.add(gateInner);
    for (let i = 0; i < 24; i++) { // ticks around the gate, rotating
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.02), new THREE.MeshBasicMaterial({ color: C.amber, transparent: true, opacity: 0.6 }));
      const a = (i / 24) * Math.PI * 2; t.position.set(0, Math.cos(a) * 1.85, Math.sin(a) * 1.85); t.rotation.x = -a; gateInner.add(t);
    }
    this.spinners.push({ obj: gateInner, axis: new THREE.Vector3(0, 0, 1), speed: 0.25 });
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 0.18, 6), new THREE.MeshStandardMaterial({ color: 0x15151c, metalness: 0.8, roughness: 0.3 }));
    ped.position.y = -2.0; relay.add(ped);
    this.halo("relay", 6, C.amber);
    this.label("relay", "Site relay", "holds the site's API key", -2.6);

    // ---- NEAR AI gateway: a hexagonal tunnel
    const gw = this.station("gateway");
    const hex = new THREE.CylinderGeometry(1.25, 1.25, 1.9, 6, 1, true); hex.rotateZ(Math.PI / 2);
    gw.add(new THREE.Mesh(hex, new THREE.MeshStandardMaterial({ color: 0x0f0f16, metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide, transparent: true, opacity: 0.55 })));
    gw.add(this.edgesOf(hex, C.lav, 0.8));
    const hex2 = new THREE.CylinderGeometry(1.55, 1.55, 0.1, 6, 1, true); hex2.rotateZ(Math.PI / 2);
    const hr = this.edgesOf(hex2, C.violet, 0.6); gw.add(hr); this.spinners.push({ obj: hr, axis: new THREE.Vector3(1, 0, 0), speed: -0.3 });
    this.halo("gateway", 6, C.violet);
    this.label("gateway", "NEAR AI gateway", "routes to the enclave", -2.6);

    // ---- the enclave: a sealed core inside rings of light, with 8 GPUs around it
    const en = this.station("enclave");
    this.enclaveCore = fresnelMaterial(C.violet, 2.1, 1.9);
    en.add(new THREE.Mesh(new THREE.SphereGeometry(1.45, 96, 96), this.enclaveCore));
    this.enclaveLight = new THREE.PointLight(C.violet, 6, 14, 2); en.add(this.enclaveLight);
    [[2.25, 0.018, [0.4, 0, 0.2]], [2.6, 0.012, [-0.6, 0.3, 0]], [2.95, 0.02, [0.1, 0.9, 0.5]]].forEach(([r, t, rot], i) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r as number, t as number, 12, 200), new THREE.MeshBasicMaterial({ color: i === 1 ? C.cyan : C.lav, transparent: true, opacity: 0.85 }));
      ring.rotation.set(...(rot as [number, number, number])); en.add(ring);
      this.spinners.push({ obj: ring, axis: new THREE.Vector3(i - 1, 1, i * 0.5).normalize(), speed: 0.18 + i * 0.08 });
    });
    const shellPts: number[] = [];
    for (let i = 0; i < 1400; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(1.75 + Math.random() * 0.5); shellPts.push(v.x, v.y, v.z); }
    const shg = new THREE.BufferGeometry(); shg.setAttribute("position", new THREE.Float32BufferAttribute(shellPts, 3));
    this.shell = new THREE.Points(shg, new THREE.PointsMaterial({ color: C.lav, size: 0.03, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
    en.add(this.shell); this.spinners.push({ obj: this.shell, axis: new THREE.Vector3(0, 1, 0), speed: 0.12 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, g = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.42), new THREE.MeshStandardMaterial({ color: 0x15151c, metalness: 0.7, roughness: 0.3, emissive: C.dim, emissiveIntensity: 1 }));
      g.position.set(Math.cos(a) * 3.5, -2.05, Math.sin(a) * 3.5); g.rotation.y = -a; en.add(g); this.gpus.push(g);
    }
    this.halo("enclave", 11, C.violet).material.opacity = 0.25;
    this.label("enclave", "The enclave", "Intel TDX + 8 NVIDIA GPUs", -3.1);

    // ---- NEAR blockchain: a chain of blocks
    const near = this.station("near");
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.62), new THREE.MeshStandardMaterial({ color: 0x0f1512, metalness: 0.5, roughness: 0.4, emissive: C.mint, emissiveIntensity: 0.05 }));
      b.position.set((i - 2) * 1.05, Math.sin(i) * 0.12, 0); near.add(b); b.add(this.edgesOf(new THREE.BoxGeometry(0.62, 0.62, 0.62), C.mint, 0.75)); this.chainBlocks.push(b);
      this.spinners.push({ obj: b, axis: new THREE.Vector3(0.3, 1, 0.1).normalize(), speed: 0.2 + i * 0.03 });
    }
    const links = new THREE.BufferGeometry().setFromPoints([-2, -1, 0, 1, 2].map((i) => new THREE.Vector3(i * 1.05, Math.sin(i + 2) * 0.12, 0)));
    near.add(new THREE.Line(links, new THREE.LineBasicMaterial({ color: C.mint, transparent: true, opacity: 0.5 })));
    this.halo("near", 6, C.mint);
    this.label("near", "NEAR blockchain", "stores the rules' fingerprint", -0.95);

    // ---- seal authorities
    for (const [st, name, sub, col] of [["intel", "Intel", "vouches for the processor", C.cyan], ["nvidia", "NVIDIA", "vouches for each GPU", C.mint]] as const) {
      const g = this.station(st);
      const oct = new THREE.OctahedronGeometry(0.5, 0);
      g.add(new THREE.Mesh(oct, new THREE.MeshStandardMaterial({ color: 0x101018, metalness: 0.8, roughness: 0.2, emissive: col, emissiveIntensity: 0.15 })));
      g.add(this.edgesOf(oct, col, 0.9));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.01, 8, 100), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7 }));
      ring.rotation.x = Math.PI / 2.4; g.add(ring);
      this.spinners.push({ obj: g.children[0], axis: new THREE.Vector3(0, 1, 0), speed: 0.6 }, { obj: g.children[1], axis: new THREE.Vector3(0, 1, 0), speed: 0.6 }, { obj: ring, axis: new THREE.Vector3(0, 0, 1), speed: 0.5 });
      this.halo(st, 3.4, col);
      this.label(st, name, sub, -1.05);
    }

    // ---- routes
    const mk = (a: Station, b: Station, lift: number, color: number) => {
      const p0 = POS[a].clone(), p1 = POS[b].clone();
      if (a === "you") p0.x += 1.9;
      if (b === "enclave") p1.x -= 1.5;
      const mid = p0.clone().lerp(p1, 0.5); mid.y += lift;
      const curve = new THREE.QuadraticBezierCurve3(p0, mid, p1);
      const mat = flowMaterial(color, lift === 0 ? 0.6 : 0.4);
      s.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 120, lift === 0 ? 0.022 : 0.014, 8, false), mat));
      this.edges.push({ a, b, curve, mat }); this.flowMats.push(mat);
    };
    mk("you", "relay", 0, C.lav); mk("relay", "gateway", 0, C.lav); mk("gateway", "enclave", 0, C.lav);
    mk("you", "near", 1.2, C.mint); mk("you", "intel", 2.4, C.cyan); mk("relay", "nvidia", 2.6, C.mint);
  }

  // ------------------------------------------------------------------ device screen
  setScreen(o: { eyebrow: string; text: string; mode: "plain" | "cipher" | "answer" | "busy"; foot?: string }) {
    const c = this.screenCanvas, g = c.getContext("2d")!;
    const W = c.width, H = c.height;
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, "#0c0b14"); bg.addColorStop(1, "#141026");
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.strokeStyle = "rgba(255,255,255,.07)"; g.lineWidth = 2; g.strokeRect(24, 24, W - 48, H - 48);
    g.fillStyle = "rgba(242,242,245,.55)"; g.font = '500 26px "Geist Mono", monospace'; g.fillText(o.eyebrow.toUpperCase(), 60, 96);
    const wrap = (text: string, font: string, color: string, lh: number, maxLines: number, y0: number) => {
      g.font = font; g.fillStyle = color; const words = text.split(/(\s+)/); let line = "", y = y0, n = 0;
      const lines: string[] = [];
      for (const w of text.includes(" ") ? words : text.match(/.{1,30}/g) ?? []) {
        const test = line + w; if (g.measureText(test).width > W - 120 && line) { lines.push(line); line = w.trimStart(); } else line = test;
      }
      if (line) lines.push(line);
      for (const l of lines.slice(0, maxLines)) { g.fillText(n === maxLines - 1 && lines.length > maxLines ? l.trimEnd() + "…" : l, 60, y); y += lh; n++; }
    };
    if (o.mode === "cipher") wrap(o.text, '400 34px "Geist Mono", monospace', "#b9a6ff", 46, 9, 170);
    else if (o.mode === "answer") wrap(o.text, '500 40px Satoshi, system-ui, sans-serif', "#f2f2f5", 54, 8, 175);
    else if (o.mode === "busy") wrap(o.text, '500 46px Satoshi, system-ui, sans-serif', "rgba(242,242,245,.75)", 60, 6, 190);
    else wrap(o.text, '500 58px Satoshi, system-ui, sans-serif', "#ffffff", 72, 6, 200);
    if (o.foot) { g.fillStyle = "rgba(242,242,245,.45)"; g.font = '400 24px "Geist Mono", monospace'; g.fillText(o.foot, 60, H - 60); }
    this.screenTex.needsUpdate = true;
  }

  // ------------------------------------------------------------------ actions
  focus(view: View, dur = 1.6, target?: Station) {
    let pos: THREE.Vector3, look: THREE.Vector3;
    if (view === "path" && target) { const p = POS[target]; pos = new THREE.Vector3(p.x + 1.5, p.y + 1.6, p.z + 8.5); look = p.clone(); }
    else { const v = VIEWS[view as Exclude<View, "path">]; pos = new THREE.Vector3(...v.pos); look = new THREE.Vector3(...v.look); }
    // narrow screens: step well back so the whole route stays in frame
    if (this.camera.aspect < 0.75) { pos.z += 15; pos.y += 1.5; } else if (this.camera.aspect < 1.2) pos.z += 6;
    gsap.to(this.camBase, { x: pos.x, y: pos.y, z: pos.z, duration: dur, ease: "power3.inOut" });
    gsap.to(this.look, { x: look.x, y: look.y, z: look.z, duration: dur, ease: "power3.inOut" });
  }
  pulse(st: Station, color?: number, strength = 0.9) {
    const h = this.halos.get(st); if (!h) return;
    const m = h.material as THREE.MeshBasicMaterial; if (color) m.color.setHex(color);
    const base = st === "enclave" ? 0.25 : 0;
    gsap.fromTo(m, { opacity: strength }, { opacity: base, duration: 1.6, ease: "power2.out" });
    gsap.fromTo(h.scale, { x: 0.7, y: 0.7 }, { x: 1.2, y: 1.2, duration: 1.6, ease: "power2.out" });
  }
  status(st: Station, s: "ok" | "warn" | "fail" | "busy" | "idle") { const el = this.statusDots.get(st); if (el) el.dataset.s = s; }
  /** Light up a route for a moment. */
  flash(a: Station, b: Station, color?: number) {
    const e = this.edges.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a)); if (!e) return;
    if (color) e.mat.uniforms.uColor.value.setHex(color);
    gsap.fromTo(e.mat.uniforms.uBoost, { value: 1 }, { value: 0, duration: 1.4, ease: "power2.out" });
  }
  /** Light the NEAR chain block by block. */
  chainCheck(ok: boolean) {
    this.chainBlocks.forEach((b, i) => gsap.to((b.material as THREE.MeshStandardMaterial), { emissiveIntensity: ok ? 0.9 : 0.5, duration: 0.3, delay: i * 0.08, yoyo: true, repeat: 1 }));
    this.chainBlocks.forEach((b) => (b.material as THREE.MeshStandardMaterial).emissive.setHex(ok ? C.mint : C.rose));
  }
  gpu(i: number, color = C.mint) { const g = this.gpus[i]; if (!g) return; const m = g.material as THREE.MeshStandardMaterial; m.emissive.setHex(color); gsap.fromTo(m, { emissiveIntensity: 3 }, { emissiveIntensity: 1.2, duration: 0.8 }); }
  resetGpus() { this.gpus.forEach((g) => { const m = g.material as THREE.MeshStandardMaterial; m.emissive.setHex(C.dim); m.emissiveIntensity = 1; }); }
  setThinking(on: boolean) {
    gsap.to(this, { thinking: on ? 1 : 0, duration: 0.8 });
    gsap.to(this.enclaveLight, { intensity: on ? 18 : 6, duration: 0.8 });
    gsap.to(this.enclaveCore.uniforms.uIntensity, { value: on ? 3.2 : 1.9, duration: 0.8 });
  }

  /** Send a glowing packet along a route of stations. Resolves when it arrives. */
  fly(path: Station[], kind: PacketKind, label: string | null, secondsPerHop = 1.1): Promise<void> {
    return new Promise((done) => {
      const color = KIND_COLOR[kind];
      const group = new THREE.Group();
      const coreGeo = kind === "cipher" || kind === "answer" ? new THREE.OctahedronGeometry(0.2, 0) : kind === "proof" ? new THREE.BoxGeometry(0.36, 0.24, 0.04) : new THREE.SphereGeometry(kind === "nonce" ? 0.1 : 0.14, 24, 24);
      const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color, toneMapped: false }));
      group.add(core);
      if (kind === "cipher" || kind === "answer") core.add(new THREE.LineSegments(new THREE.EdgesGeometry(coreGeo), new THREE.LineBasicMaterial({ color: 0xffffff })));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.95 }));
      glow.scale.setScalar(kind === "nonce" ? 0.8 : 1.3); group.add(glow);
      const N = 36, pts = Array.from({ length: N }, () => POS[path[0]].clone());
      const tg = new THREE.BufferGeometry().setFromPoints(pts);
      const cols = new Float32Array(N * 3); const cc = new THREE.Color(color);
      for (let i = 0; i < N; i++) { const k = 1 - i / N; cols[i * 3] = cc.r * k; cols[i * 3 + 1] = cc.g * k; cols[i * 3 + 2] = cc.b * k; }
      tg.setAttribute("color", new THREE.BufferAttribute(cols, 3));
      const trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.scene.add(trail); this.scene.add(group);
      let tag: CSS2DObject | undefined;
      if (label) { const el = document.createElement("div"); el.className = `w-tag k-${kind}`; el.textContent = label; tag = new CSS2DObject(el); tag.position.set(0, 0.55, 0); group.add(tag); }
      const hops: THREE.Curve<THREE.Vector3>[] = [];
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1];
        const e = this.edges.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
        if (e) { const fwd = e.a === a; hops.push(fwd ? e.curve : new ReverseCurve(e.curve)); this.flash(a, b, color); }
        else hops.push(new THREE.LineCurve3(POS[a].clone(), POS[b].clone()));
      }
      const pkt: Packet = { group, trail, trailPts: pts, label: tag };
      const state = { t: 0 };
      gsap.to(state, {
        t: hops.length, duration: secondsPerHop * hops.length, ease: "power1.inOut",
        onUpdate: () => {
          const i = Math.min(Math.floor(state.t), hops.length - 1), f = Math.min(state.t - i, 1);
          const p = hops[i].getPointAt(Math.max(0, Math.min(1, f)));
          group.position.copy(p); core.rotation.x += 0.05; core.rotation.y += 0.07;
          pkt.trailPts.pop(); pkt.trailPts.unshift(p.clone()); tg.setFromPoints(pkt.trailPts);
        },
        onComplete: () => {
          this.pulse(path[path.length - 1], color, 0.7);
          gsap.to(glow.material, { opacity: 0, duration: 0.5 });
          gsap.to(group.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.5, onComplete: () => { tag?.element.remove(); this.scene.remove(group); this.scene.remove(trail); } });
          done();
        },
      });
    });
  }

  /** A DOM anchor that follows a station on screen, for cards. */
  anchor(st: Station, offset: [number, number, number], el: HTMLElement): CSS2DObject {
    const o = new CSS2DObject(el); o.position.set(...offset); this.stationGroups.get(st)!.add(o); return o;
  }
  remove(o: CSS2DObject) { o.element.remove(); o.parent?.remove(o); }

  // ------------------------------------------------------------------ loop
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.visible || document.hidden) return;
    const dt = Math.min(this.clock.getDelta(), 0.05), t = this.clock.elapsedTime;
    for (const sp of this.spinners) sp.obj.rotateOnAxis(sp.axis, sp.speed * dt * (1 + this.thinking * 3));
    for (const m of this.flowMats) m.uniforms.uTime.value = t;
    this.enclaveCore.uniforms.uTime.value = t * (1 + this.thinking * 2);
    this.shell.scale.setScalar(1 + Math.sin(t * 3) * 0.02 * (1 + this.thinking * 4));
    // gentle parallax on top of the director's camera
    this.camera.position.set(this.camBase.x + this.pointer.x * 0.9, this.camBase.y - this.pointer.y * 0.5, this.camBase.z);
    this.camera.lookAt(this.look);
    this.halos.forEach((h) => h.quaternion.copy(this.camera.quaternion));
    this.composer.render();
    this.labels.render(this.scene, this.camera);
  };
  dispose() { cancelAnimationFrame(this.raf); this.renderer.dispose(); }
}

class ReverseCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private c: THREE.Curve<THREE.Vector3>) { super(); }
  getPoint(t: number, target = new THREE.Vector3()) { return this.c.getPoint(1 - t, target); }
}
