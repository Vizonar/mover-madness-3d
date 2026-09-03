// ============================================================
// MOVER MADNESS 3D - Client
// Three.js rendering + WebSocket networking
// ============================================================

// ============================================================
// IMPORTS (via CDN importmap defined in index.html)
// ============================================================
import * as THREE from 'https://esm.sh/three@0.160.0';

// ============================================================
// GLOBALS
// ============================================================
let scene, camera, renderer, clock;
let ws = null;
let gameLoopId = null;
let playerId = -1; // Our player index in the room

// UI Elements
const screenStart = document.getElementById('screen-start');
const screenHost = document.getElementById('screen-host');
const screenResult = document.getElementById('screen-result');
const hud = document.getElementById('hud');
const damageBar = document.getElementById('damage-bar');
const damageText = document.getElementById('damage-text');
const timerEl = document.getElementById('timer');
const playerDots = document.getElementById('player-dots');
const connStatus = document.getElementById('conn-status');
const displayCode = document.getElementById('display-code');

// Game state from server
let gameState = null;
let selfPlayerIdx = -1;

// Input
const keys = { w: false, a: false, s: false, d: false };
const keysArrows = { up: false, left: false, down: false, right: false };
let grabPressed = false;
let lastGrabState = false;

// Three.js objects (created on game start)
let sofaMesh, floorMesh;
let furnitureMeshes = {};
let playerMeshes = [];
let zoneMeshes = {};
let walls = [];

// ============================================================
// NETWORKING
// ============================================================
function connectToServer() {
  // Always connect to port 2568 — localtunnel/ngrok forwards it
  const hostname = window.location.hostname;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';

  let url;
  if (isLocal) {
    url = 'ws://localhost:2568';
  } else {
    // Remote (Render): connect to same host
    url = `${proto}://${hostname}`;
  }

  console.log('[Net] Connecting to:', url);
  console.log('[Net] Hostname:', hostname);
  console.log('[Net] Is local:', isLocal);
  console.log('[Net] Protocol:', proto);

  try {
    ws = new WebSocket(url);
    console.log('[Net] WebSocket object created');
  } catch (e) {
    console.error('[Net] Failed to create WebSocket:', e);
    return;
  }

  ws.onopen = () => {
    console.log('[Net] WebSocket OPEN!');
    updateConnStatus('connected', 'Conectado');
  };

  ws.onclose = (event) => {
    console.log('[Net] WebSocket CLOSED:', event.code, event.reason);
    updateConnStatus('disconnected', 'Desconectado');
    // Auto-retry
    setTimeout(connectToServer, 3000);
  };

  ws.onerror = (err) => {
    console.error('[Net] WebSocket ERROR');
    updateConnStatus('disconnected', 'Erro');
  };

  ws.onmessage = (event) => {
    console.log('[Net] Received:', event.data.substring(0, 100));
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'room_created' || data.type === 'room_joined' || data.type === 'error') {
        handleCommand(data);
      } else {
        gameState = data;
      }
    } catch (e) {
      console.error('[Net] Failed to parse message:', e);
    }
  };
}

function handleCommand(data) {
  switch (data.type) {
    case 'room_created':
      selfPlayerIdx = data.playerId;
      displayCode.textContent = data.code;
      showScreen('host');
      break;

    case 'room_joined':
      selfPlayerIdx = data.playerId;
      showGame();
      break;

    case 'error':
      showStartError(data.message);
      break;
  }
}

function sendInput() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (gameState?.gameOver) return;

  // Calculate movement direction
  let x = 0, z = 0;

  // Player 1: WASD
  if (keys.w) z -= 1;
  if (keys.s) z += 1;
  if (keys.a) x -= 1;
  if (keys.d) x += 1;

  // Player 2: Arrows (only if we're player 2)
  if (selfPlayerIdx === 1) {
    if (keysArrows.up) z -= 1;
    if (keysArrows.down) z += 1;
    if (keysArrows.left) x -= 1;
    if (keysArrows.right) x += 1;
  }

  // Normalise
  const mag = Math.sqrt(x * x + z * z);
  if (mag > 0) {
    x /= mag;
    z /= mag;
  }

  // Grab detection (edge-triggered)
  const released = grabPressed && !lastGrabState;
  lastGrabState = grabPressed;

  ws.send(JSON.stringify({
    type: 'input',
    x, z,
    grab: grabPressed,
    released,
  }));
}

function updateConnStatus(state, text) {
  connStatus.className = `status-${state}`;
  connStatus.textContent = text;
}

// ============================================================
// SCREEN MANAGEMENT
// ============================================================
function showScreen(name) {
  screenStart.classList.add('hidden');
  screenHost.classList.add('hidden');
  screenResult.classList.add('hidden');
  hud.style.display = 'none';

  switch (name) {
    case 'start': screenStart.classList.remove('hidden'); break;
    case 'host': screenHost.classList.remove('hidden'); break;
    case 'result': screenResult.classList.remove('hidden'); break;
    case 'game': hud.style.display = 'flex'; break;
  }
}

function showStartError(msg) {
  const el = document.getElementById('start-error');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 3000);
}

function showGame() {
  showScreen('game');
  initScene();
  if (!gameLoopId) {
    clock = new THREE.Clock();
    gameLoop();
  }
}

// ============================================================
// THREE.JS SCENE
// ============================================================
function initScene() {
  // Clean up old scene
  if (scene) {
    renderer.dispose();
    document.getElementById('game-canvas').remove();
  }

  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.id = 'game-canvas';
  document.body.appendChild(canvas);

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);
  scene.fog = new THREE.Fog(0x1a1a2e, 30, 60);

  // Camera (third person)
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);

  // Renderer
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Lighting
  const ambient = new THREE.AmbientLight(0x404060, 0.8);
  scene.add(ambient);

  const dir = new THREE.DirectionalLight(0xffeedd, 1.2);
  dir.position.set(15, 25, 15);
  dir.castShadow = true;
  dir.shadow.camera.left = -30;
  dir.shadow.camera.right = 30;
  dir.shadow.camera.top = 30;
  dir.shadow.camera.bottom = -30;
  dir.shadow.camera.near = 1;
  dir.shadow.camera.far = 80;
  dir.shadow.mapSize.set(2048, 2048);
  scene.add(dir);

  const hemi = new THREE.HemisphereLight(0x6688cc, 0x223344, 0.4);
  scene.add(hemi);

  // Build house
  buildHouse();
  buildZones();
  createFurnitureMeshes();

  // Create player meshes
  createPlayerMeshes();

  // Sofa mesh
  const sofaGeo = new THREE.BoxGeometry(2.4, 0.9, 1.1);
  const sofaMat = new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.8 });
  sofaMesh = new THREE.Mesh(sofaGeo, sofaMat);
  sofaMesh.castShadow = true;
  sofaMesh.receiveShadow = true;
  scene.add(sofaMesh);

  // Floor (rendered below everything)
  const floorGeo = new THREE.PlaneGeometry(60, 60);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3a, roughness: 0.9 });
  floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);

  // Grid helper on floor
  const grid = new THREE.GridHelper(60, 30, 0x333355, 0x222244);
  grid.position.y = 0.01;
  scene.add(grid);

  // Handle resize
  window.addEventListener('resize', onResize);
}

function buildHouse() {
  walls = [];

  function addWall(x, y, z, sx, sy, sz, color = 0x555566) {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    walls.push(mesh);
  }

  const WH = 3.5, WT = 0.3, WS = 25;

  // Outer walls
  addWall(0, WH / 2, -WS, WS * 2, WH, WT);           // front
  addWall(0, WH / 2, WS, WS * 2, WH, WT);             // back
  addWall(-WS, WH / 2, 0, WT, WH, WS * 2);            // left
  addWall(WS, WH / 2, 0, WT, WH, WS * 2);             // right

  // Ceiling
  addWall(0, WH, 0, WS * 2, 0.1, WS * 2, 0x444455);

  // Interior: horizontal divider at z=0 with door gaps
  addWall(-13, WH / 2, 0, 18, WH, WT, 0x444455);     // left section
  addWall(0, WH / 2, 0, 10, WH, WT, 0x444455);       // middle (between doors)
  addWall(13, WH / 2, 0, 18, WH, WT, 0x444455);      // right section

  // Interior: vertical divider bedroom↔hallway at x=-8
  addWall(-8, WH / 2, -8, WT, WH, 16, 0x444455);

  // Interior: vertical divider hallway↔living room at x=8
  addWall(8, WH / 2, -8, WT, WH, 16, 0x444455);

  // Corner pillars
  addWall(WS - 1, WH / 2, WS - 1, 0.4, WH, 0.4, 0x666677);
  addWall(-WS + 1, WH / 2, WS - 1, 0.4, WH, 0.4, 0x666677);
  addWall(WS - 1, WH / 2, -WS + 1, 0.4, WH, 0.4, 0x666677);
  addWall(-WS + 1, WH / 2, -WS + 1, 0.4, WH, 0.4, 0x666677);

  // Room labels (as simple colored planes on walls)
  addRoomLabel(-10, 3, -19, 'QUARTO', 0x4466aa);
  addRoomLabel(0, 3, -19, 'CORREDOR', 0x6666aa);
  addRoomLabel(12, 3, -19, 'SALA', 0x88aa44);
  addRoomLabel(0, 3, 19, 'COZINHA', 0xaa8844);
}

function addRoomLabel(x, y, z, text, color) {
  // Simple colored rectangle on the wall as label
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = `rgba(${(color >> 16) & 0xff},${(color >> 8) & 0xff},${color & 0xff},0.3)`;
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 32);

  const tex = new THREE.CanvasTexture(canvas);
  const geo = new THREE.PlaneGeometry(4, 1);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  scene.add(mesh);
}

function buildZones() {
  // Delivery zone (green, translucent)
  const dz = createZone(12, 0.02, 12, 6, 6, 0x22cc44, 0.15);
  scene.add(dz);
  zoneMeshes.delivery = dz;

  // Start zone (blue, translucent)
  const sz = createZone(-10, 0.02, -8, 8, 8, 0x4488ff, 0.15);
  scene.add(sz);
  zoneMeshes.start = sz;
}

function createZone(x, y, z, sx, sz, color, opacity) {
  const group = new THREE.Group();

  // Filled area
  const fillGeo = new THREE.PlaneGeometry(sx, sz);
  const fillMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, side: THREE.DoubleSide
  });
  const fill = new THREE.Mesh(fillGeo, fillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.set(x, y + 0.02, z);
  group.add(fill);

  // Border lines
  const borderGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(sx, sz));
  const borderMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
  const border = new THREE.LineSegments(borderGeo, borderMat);
  border.rotation.x = -Math.PI / 2;
  border.position.set(x, y + 0.03, z);
  group.add(border);

  return group;
}

function createFurnitureMeshes() {
  // Chair
  const chairGeo = new THREE.BoxGeometry(0.8, 0.9, 0.8);
  const chairMat = new THREE.MeshStandardMaterial({ color: 0xa0522d, roughness: 0.8 });
  furnitureMeshes[1] = new THREE.Mesh(chairGeo, chairMat);
  furnitureMeshes[1].castShadow = true;
  furnitureMeshes[1].receiveShadow = true;
  scene.add(furnitureMeshes[1]);

  // Table
  const tableGeo = new THREE.BoxGeometry(1.6, 0.75, 0.8);
  const tableMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.7 });
  furnitureMeshes[2] = new THREE.Mesh(tableGeo, tableMat);
  furnitureMeshes[2].castShadow = true;
  furnitureMeshes[2].receiveShadow = true;
  scene.add(furnitureMeshes[2]);

  // Stool
  const stoolGeo = new THREE.BoxGeometry(0.45, 0.45, 0.4);
  const stoolMat = new THREE.MeshStandardMaterial({ color: 0xcd853f, roughness: 0.8 });
  furnitureMeshes[3] = new THREE.Mesh(stoolGeo, stoolMat);
  furnitureMeshes[3].castShadow = true;
  furnitureMeshes[3].receiveShadow = true;
  scene.add(furnitureMeshes[3]);
}

function createPlayerMeshes() {
  // Clear old
  playerMeshes.forEach(m => scene.remove(m));
  playerMeshes = [];

  const colors = [0x4fc3f7, 0xef5350, 0x66bb6a, 0xffb74d];
  const sizes = [
    { r: 0.4, h: 1.6 },
    { r: 0.4, h: 1.6 },
    { r: 0.4, h: 1.6 },
    { r: 0.4, h: 1.6 },
  ];

  for (let i = 0; i < 4; i++) {
    // Capsule = cylinder + 2 spheres
    const s = sizes[i];
    const cylinderGeo = new THREE.CylinderGeometry(s.r, s.r, s.h - s.r * 2, 12);
    const topGeo = new THREE.SphereGeometry(s.r, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const botGeo = new THREE.SphereGeometry(s.r, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);

    const mat = new THREE.MeshStandardMaterial({
      color: colors[i],
      roughness: 0.4,
      emissive: colors[i],
      emissiveIntensity: 0.2,
    });

    const group = new THREE.Group();
    const cyl = new THREE.Mesh(cylinderGeo, mat);
    cyl.position.y = s.r;
    cyl.castShadow = true;
    group.add(cyl);

    const top = new THREE.Mesh(topGeo, mat);
    top.position.y = s.h - s.r / 2;
    top.castShadow = true;
    group.add(top);

    const bot = new THREE.Mesh(botGeo, mat);
    bot.position.y = s.r / 2;
    bot.castShadow = true;
    group.add(bot);

    // Direction indicator (small cone on top)
    const indicatorGeo = new THREE.ConeGeometry(0.12, 0.3, 6);
    const indicatorMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.5,
    });
    const indicator = new THREE.Mesh(indicatorGeo, indicatorMat);
    indicator.position.y = s.h + 0.15;
    group.add(indicator);

    // Number label
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 64;
    labelCanvas.height = 64;
    const ctx = labelCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), 32, 32);

    const labelTex = new THREE.CanvasTexture(labelCanvas);
    const labelGeo = new THREE.PlaneGeometry(0.5, 0.5);
    const labelMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true });
    const label = new THREE.Mesh(labelGeo, labelMat);
    label.position.y = s.h + 0.6;
    label.rotation.y = Math.PI; // face outward
    group.add(label);

    scene.add(group);
    playerMeshes.push(group);
  }
}

// ============================================================
// GAME LOOP
// ============================================================
function gameLoop() {
  gameLoopId = requestAnimationFrame(gameLoop);

  const dt = clock.getDelta();

  // Send input
  sendInput();

  // Update from state
  updateScene();

  // Update HUD
  updateHUD();

  // Render
  if (scene && renderer) {
    renderer.render(scene, camera);
  }
}

function updateScene() {
  if (!gameState) return;

  // Update sofa
  if (gameState.sofa) {
    sofaMesh.position.set(gameState.sofa.x, gameState.sofa.y, gameState.sofa.z);
    // Color based on integrity
    const dmgRatio = gameState.sofa.integrity / 100;
    let color;
    if (dmgRatio > 0.6) color = 0x8B6914;
    else if (dmgRatio > 0.3) color = 0xa0522d;
    else if (dmgRatio > 0) color = 0xcd3333;
    else color = 0xff0000;
    sofaMesh.material.color.setHex(color);
    sofaMesh.material.emissive.setHex(dmgRatio > 0.3 ? 0x000000 : 0x440000);
    sofaMesh.material.emissiveIntensity = dmgRatio <= 0.3 ? 0.3 : 0;
  }

  // Update furniture
  for (const [key, mesh] of Object.entries(furnitureMeshes)) {
    const fd = gameState.furniture?.[key];
    if (fd) {
      mesh.position.set(fd.x, fd.y, fd.z);
    }
  }

  // Update players
  if (gameState.players) {
    for (const [idx, ps] of Object.entries(gameState.players)) {
      const mesh = playerMeshes[parseInt(idx)];
      if (mesh) {
        mesh.position.set(ps.x, ps.y, ps.z);

        // Orient mesh to face movement direction
        if (ps.grabbed) {
          // Look toward grab point (on sofa)
          const dx = ps.grabX - ps.x;
          const dz = ps.grabZ - ps.z;
          if (Math.sqrt(dx * dx + dz * dz) > 0.1) {
            mesh.rotation.y = Math.atan2(dx, dz);
          }
        }

        // Highlight self player
        if (parseInt(idx) === selfPlayerIdx) {
          mesh.scale.setScalar(1.1);
          if (ps.grabbed) {
            mesh.children.forEach(c => {
              if (c.material) {
                c.material.emissiveIntensity = 0.5;
              }
            });
          }
        } else {
          mesh.scale.setScalar(1.0);
          mesh.children.forEach(c => {
            if (c.material && c !== mesh.children[3]) { // keep indicator bright
              c.material.emissiveIntensity = 0.2;
            }
          });
        }
      }
    }
  }

  // Update grab lines (visualize grab connections to sofa)
  // Remove old grab lines
  scene.children.filter(c => c.isLine).forEach(l => scene.remove(l));

  if (gameState.players && gameState.sofa) {
    for (const [idx, ps] of Object.entries(gameState.players)) {
      if (ps.grabbed) {
        const mesh = playerMeshes[parseInt(idx)];
        if (mesh) {
          const lineGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(ps.x, ps.y + 0.5, ps.z),
            new THREE.Vector3(gameState.sofa.x, 0.8, gameState.sofa.z),
          ]);
          const lineMat = new THREE.LineBasicMaterial({
            color: parseInt(idx) === selfPlayerIdx ? 0x4fc3f7 : 0xef5350,
            transparent: true,
            opacity: 0.5,
          });
          const line = new THREE.Line(lineGeo, lineMat);
          scene.add(line);
        }
      }
    }
  }

  // Camera follows self player
  const selfPs = gameState.players?.[selfPlayerIdx];
  if (selfPs) {
    const offset = { x: 0, y: 5, z: 8 };
    camera.position.lerp(
      new THREE.Vector3(selfPs.x + offset.x, selfPs.y + offset.y, selfPs.z + offset.z),
      0.08
    );
    camera.lookAt(selfPs.x, selfPs.y + 0.5, selfPs.z);
  }
}

// ============================================================
// HUD UPDATE
// ============================================================
function updateHUD() {
  if (!gameState) return;

  // Damage bar
  const integrity = gameState.sofa?.integrity ?? 100;
  const ratio = integrity / 100;
  damageBar.style.width = `${ratio * 100}%`;
  damageText.textContent = `${Math.round(ratio * 100)}%`;

  if (ratio > 0.6) {
    damageBar.style.background = '#22c55e';
  } else if (ratio > 0.3) {
    damageBar.style.background = '#f59e0b';
  } else {
    damageBar.style.background = '#ef4444';
  }

  // Timer
  const elapsed = gameState.timeElapsed || 0;
  const min = Math.floor(elapsed / 60);
  const sec = Math.floor(elapsed % 60);
  const dec = Math.floor((elapsed * 10) % 10);
  timerEl.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${dec}`;

  // Player dots
  const dots = playerDots.children;
  for (let i = 0; i < dots.length; i++) {
    dots[i].classList.toggle('active', i < gameState.playerCount);
  }

  // Check game over
  if (gameState.gameOver) {
    showResult(gameState.victory, elapsed);
    gameState.gameOver = false; // Only show once
  }
}

function showResult(victory, elapsed) {
  const title = document.getElementById('result-title');
  const sub = document.getElementById('result-sub');

  if (victory) {
    title.textContent = '🎉 Entrega Concluída!';
    title.style.color = '#4ade80';
  } else {
    title.textContent = '💥 Móvel Quebrado!';
    title.style.color = '#f87171';
  }

  const min = Math.floor(elapsed / 60);
  const sec = Math.floor(elapsed % 60);
  sub.textContent = `Tempo: ${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

  showScreen('result');
}

// ============================================================
// INPUT HANDLING
// ============================================================
document.addEventListener('keydown', (e) => {
  switch (e.code) {
    case 'KeyW': keys.w = true; break;
    case 'KeyA': keys.a = true; break;
    case 'KeyS': keys.s = true; break;
    case 'KeyD': keys.d = true; break;
    case 'ArrowUp': keysArrows.up = true; break;
    case 'ArrowLeft': keysArrows.left = true; break;
    case 'ArrowDown': keysArrows.down = true; break;
    case 'ArrowRight': keysArrows.right = true; break;

    case 'KeyG':
    case 'Enter':
      grabPressed = true;
      e.preventDefault();
      break;
  }
});

document.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': keys.w = false; break;
    case 'KeyA': keys.a = false; break;
    case 'KeyS': keys.s = false; break;
    case 'KeyD': keys.d = false; break;
    case 'ArrowUp': keysArrows.up = false; break;
    case 'ArrowLeft': keysArrows.left = false; break;
    case 'ArrowDown': keysArrows.down = false; break;
    case 'ArrowRight': keysArrows.right = false; break;

    case 'KeyG':
    case 'Enter':
      grabPressed = false;
      break;
  }
});

// ============================================================
// EVENT HANDLERS
// ============================================================
function onResize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// Button handlers
document.getElementById('btn-create').addEventListener('click', () => {
  console.log('[Btn] Create room clicked');
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.log('[Btn] Not connected, state:', ws ? ws.readyState : 'null');
    showStartError('Conectando ao servidor...');
    connectToServer();
    // Retry multiple times
    for (let i = 0; i < 10; i++) {
      setTimeout(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          console.log('[Btn] Connected! Sending create_room');
          ws.send(JSON.stringify({ type: 'create_room' }));
        }
      }, 1000 * (i + 1));
    }
  } else {
    console.log('[Btn] Already connected, sending create_room');
    ws.send(JSON.stringify({ type: 'create_room' }));
  }
});

document.getElementById('btn-join').addEventListener('click', joinWithCode);
document.getElementById('input-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinWithCode();
});

document.getElementById('btn-cancel-host').addEventListener('click', () => {
  if (ws) {
    ws.close();
    ws = null;
  }
  showScreen('start');
  gameState = null;
  selfPlayerIdx = -1;
});

document.getElementById('btn-restart').addEventListener('click', () => {
  if (ws) {
    ws.close();
    ws = null;
  }
  gameState = null;
  selfPlayerIdx = -1;
  // Connect and create new room
  connectToServer();
  setTimeout(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'create_room' }));
    }
  }, 500);
});

document.getElementById('btn-lobby').addEventListener('click', () => {
  if (ws) {
    ws.close();
    ws = null;
  }
  gameState = null;
  selfPlayerIdx = -1;
  showScreen('start');
});

document.getElementById('display-code').addEventListener('click', () => {
  navigator.clipboard?.writeText(displayCode.textContent).then(() => {
    displayCode.textContent = '✓ COPIADO!';
    setTimeout(() => {
      displayCode.textContent = displayCode.textContent.replace('✓ COPIADO!', displayCode.textContent);
    }, 1000);
  });
});

function joinWithCode() {
  const code = document.getElementById('input-code').value.trim().toUpperCase();
  if (code.length !== 4) {
    showStartError('Código deve ter 4 caracteres');
    return;
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    connectToServer();
    setTimeout(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'join_room', code }));
      }
    }, 500);
  } else {
    ws.send(JSON.stringify({ type: 'join_room', code }));
  }
}

// ============================================================
// INIT
// ============================================================
window.addEventListener('load', () => {
  // Try to connect to server
  connectToServer();
});
