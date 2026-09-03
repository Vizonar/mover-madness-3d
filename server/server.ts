// ============================================================
// MOVER MADNESS 3D - SERVER
// Authoritative physics server using Rapier3D
// ============================================================
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import * as path from "path";
import * as fs from "fs";
import * as RAPIER from "@dimforge/rapier3d-compat";
import { fileURLToPath } from "url";

// ============================================================
// SETUP EXPRESS + STATIC FILES
// ============================================================
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve client folder (parent directory) as static files
const clientPath = path.join(__dirname, "..", "client");
app.use(express.static(clientPath));

// HTML fallback
app.get("/", (req, res) => {
  res.sendFile(path.join(clientPath, "index.html"));
});

// ============================================================
// PHYSICS CONFIG — AJUSTE AQUI PARA CALIBRAR O JOGO
// ============================================================
const CFG = {
  port: parseInt(process.env.PORT || "2568"),

  // Time
  fixedDt: 1 / 60,
  substeps: 2,
  broadcastInterval: 1000 / 60,

  // Player
  playerMass: 70,
  playerRadius: 0.4,
  playerHeight: 1.6,
  playerSpeed: 5.0,
  playerFriction: 0.5,

  // Grab
  grabDistance: 3.0,
  grabStrength: 500,

  // Sofa (móvel principal)
  sofaMass: 60,
  sofaFriction: 0.7,
  sofaRestitution: 0.05,

  // Furniture
  furniture: {
    chair:  { mass: 15, friction: 0.6, restitution: 0.1,  dims: [0.8, 0.9, 0.8] },
    table:  { mass: 30, friction: 0.5, restitution: 0.05, dims: [1.6, 0.75, 0.8] },
    stool:  { mass: 5,  friction: 0.4, restitution: 0.15, dims: [0.45, 0.45, 0.4] },
  },

  // Damage
  damageThreshold: 2.5,
  damagePerImpact: 30,
  maxDamage: 100,

  // World
  wallH: 3.5,
  wallT: 0.3,
  worldSize: 25,
};

// ============================================================
// GLOBALS
// ============================================================
let rapierReady = false;
let rapierResolve: (() => void) | null = null;
let rapierPromise = new Promise<void>((resolve) => { rapierResolve = resolve; });

async function waitForRapier() {
  if (rapierReady) return;
  console.log("[Server] Loading Rapier3D WASM module...");
  await RAPIER.init();
  rapierReady = true;
  if (rapierResolve) rapierResolve();
  console.log("[Server] Rapier3D ready");
}

async function ensureRapierReady() {
  if (!rapierReady) {
    console.log("[Server] Waiting for Rapier3D init...");
    await rapierPromise;
    console.log("[Server] Rapier3D is ready now");
  }
}
const rooms = new Map<string, Room>();

// ============================================================
// TYPES
// ============================================================
interface PlayerState {
  x: number; y: number; z: number;
  rx: number; ry: number; rz: number;
  grabbed: boolean;
  grabX: number; grabY: number; grabZ: number;
}

interface FurnitureState {
  integrity: number;
  x: number; y: number; z: number;
}

interface GameState {
  roomCode: string;
  integrity: number;
  timeElapsed: number;
  playerCount: number;
  gameOver: boolean;
  victory: boolean;
  players: Record<number, PlayerState>;
  sofa: { integrity: number; x: number; y: number; z: number };
  furniture: { [key: string]: FurnitureState };
  zones: {
    delivery: { x: number; z: number; sx: number; sz: number };
    start:    { x: number; z: number; sx: number; sz: number };
  };
}

interface PlayerInput {
  x: number; z: number;
  grab: boolean;
  released: boolean;
}

// ============================================================
// PHYSICS WORLD
// ============================================================
class PhysicsWorld {
  world: RAPIER.World;
  sofa: RAPIER.RigidBody;
  sofaCollider: RAPIER.Collider | null = null;
  furnitureMap: Map<number, { body: RAPIER.RigidBody; integrity: number }>;
  playerMap: Map<number, RAPIER.RigidBody>;
  grabs: Map<number, { active: boolean; gx: number; gy: number; gz: number }>;

  deliveryZone = { cx: 12, cz: 12, hw: 3, hd: 3 };
  startZone = { cx: -10, cz: -8, hw: 4, hd: 4 };

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.furnitureMap = new Map();
    this.playerMap = new Map();
    this.grabs = new Map();

    this.buildWorld();
  }

  private buildWorld() {
    const R = RAPIER;

    // Floor
    const floor = this.world.createRigidBodyStatic({ x: 0, y: 0, z: 0 });
    this.world.createCollider(new R.CuboidDescriptor(50, 0.05, 50).setFriction(0.8).setRestitution(0.05)).setParent(floor);

    // Ceiling
    const ceil = this.world.createRigidBodyStatic({ x: 0, y: CFG.wallH, z: 0 });
    this.world.createCollider(new R.CuboidDescriptor(50, 0.1, 50)).setParent(ceil);

    // Helper
    function wall(x: number, y: number, z: number, sx: number, sy: number, sz: number) {
      const b = this.world.createRigidBodyStatic({ x, y, z });
      this.world.createCollider(
        new R.CuboidDescriptor(sx / 2, sy / 2, sz / 2)
          .setFriction(1.0).setRestitution(0.0)
      ).setParent(b);
    }

    // Outer walls
    wall(0, CFG.wallH / 2, -25, 50, CFG.wallH, CFG.wallT);
    wall(0, CFG.wallH / 2, 25, 50, CFG.wallH, CFG.wallT);
    wall(-25, CFG.wallH / 2, 0, CFG.wallT, CFG.wallH, 50);
    wall(25, CFG.wallH / 2, 0, CFG.wallT, CFG.wallH, 50);

    // Interior: horizontal divider with door gaps (along x-axis at z=0)
    wall(-13, CFG.wallH / 2, 0, 18, CFG.wallH, CFG.wallT);
    wall(0, CFG.wallH / 2, 0, 10, CFG.wallH, CFG.wallT);
    wall(13, CFG.wallH / 2, 0, 18, CFG.wallH, CFG.wallT);

    // Interior: vertical divider bedroom↔hallway with door gap (at x=-8)
    wall(-8, CFG.wallH / 2, -8, CFG.wallT, CFG.wallH, 16);

    // Interior: vertical divider hallway↔living room with door gap (at x=8)
    wall(8, CFG.wallH / 2, -8, CFG.wallT, CFG.wallH, 16);

    // Sofa (in bedroom area)
    this.sofa = this.world.createRigidBodyDynamic({ x: -10, y: 0.7, z: -8 });
    this.world.createCollider(
      new R.CuboidDescriptor(1.2, 0.45, 0.55)
        .setDensity(CFG.sofaMass / (2.4 * 0.9 * 1.1))
        .setFriction(CFG.sofaFriction)
        .setRestitution(CFG.sofaRestitution)
    ).setParent(this.sofa);

    // Furniture: chair
    const chair = this.world.createRigidBodyDynamic({ x: 15, y: 0.45, z: 10 });
    this.world.createCollider(
      new R.CuboidDescriptor(0.4, 0.45, 0.4).setDensity(15 / 0.32).setFriction(0.6).setRestitution(0.1)
    ).setParent(chair);
    this.furnitureMap.set(1, { body: chair, integrity: 100 });

    // Furniture: table
    const table = this.world.createRigidBodyDynamic({ x: 0, y: 0.375, z: 12 });
    this.world.createCollider(
      new R.CuboidDescriptor(0.8, 0.375, 0.4).setDensity(30 / (1.6 * 0.75 * 0.8)).setFriction(0.5).setRestitution(0.05)
    ).setParent(table);
    this.furnitureMap.set(2, { body: table, integrity: 100 });

    // Furniture: stool
    const stool = this.world.createRigidBodyDynamic({ x: 0, y: 0.225, z: 3 });
    this.world.createCollider(
      new R.CuboidDescriptor(0.225, 0.225, 0.2).setDensity(5 / (0.45 * 0.45 * 0.4)).setFriction(0.4).setRestitution(0.15)
    ).setParent(stool);
    this.furnitureMap.set(3, { body: stool, integrity: 100 });
  }

  spawnPlayer(id: number, x: number, z: number): RAPIER.RigidBody {
    const R = RAPIER;
    const body = this.world.createRigidBodyDynamic({ x, y: CFG.playerHeight / 2, z });

    const capsuleH = CFG.playerHeight / 2 - CFG.playerRadius;
    this.world.createCollider(
      new R.CapsuleDescriptor(capsuleH, CFG.playerRadius)
        .setMass(CFG.playerMass)
        .setFriction(CFG.playerFriction)
        .setRestitution(0.0)
    ).setParent(body);

    body.setAngDamping(8);
    body.setExtraBodyForces({ x: 0, y: CFG.playerMass * 9.81, z: 0 });

    this.playerMap.set(id, body);
    this.grabs.set(id, { active: false, gx: x, gy: CFG.playerHeight / 2, gz: z });
    return body;
  }

  applyInput(input: PlayerInput, id: number) {
    const body = this.playerMap.get(id);
    if (!body) return;

    const pos = body.translation();
    const grab = this.grabs.get(id)!;

    // Handle release
    if (input.released) grab.active = false;

    if (input.grab && !grab.active) {
      // Check distance to sofa
      const sofaPos = this.sofa.translation();
      const dx = pos.x - sofaPos.x;
      const dz = pos.z - sofaPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= CFG.grabDistance) {
        grab.active = true;
        grab.gx = pos.x;
        grab.gy = pos.y;
        grab.gz = pos.z;
      }
    }

    if (grab.active) {
      grab.gx = pos.x;
      grab.gy = pos.y;
      grab.gz = pos.z;

      // Spring force toward sofa
      const sofaPos = this.sofa.translation();
      const dx = sofaPos.x - pos.x;
      const dy = 0.8 - pos.y; // grab at sofa surface height
      const dz = sofaPos.z - pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist > 0.01) {
        const strength = CFG.grabStrength * Math.min(dist / CFG.grabDistance, 1.5);
        body.applyImpulse({
          x: (dx / dist) * strength * CFG.fixedDt,
          y: dy * strength * 0.3 * CFG.fixedDt,
          z: (dz / dist) * strength * CFG.fixedDt,
        }, true);
      }
    } else {
      // Normal WASD movement
      const mag = Math.sqrt(input.x * input.x + input.z * input.z);
      if (mag > 0.1) {
        const speed = CFG.playerSpeed;
        body.setLinvel({
          x: (input.x / mag) * speed,
          y: 0,
          z: (input.z / mag) * speed,
        }, true);
      } else {
        const vel = body.linvel();
        body.setLinvel({ x: vel.x * 0.8, y: 0, z: vel.z * 0.8 }, true);
      }
    }
  }

  applySofaPush(inputs: Map<number, PlayerInput>) {
    let totalFx = 0, totalFz = 0;
    let pushCount = 0;

    for (const [id, input] of inputs) {
      if (!input.grab) continue;
      const grab = this.grabs.get(id);
      if (!grab || !grab.active) continue;

      const sofaPos = this.sofa.translation();
      const gx = grab.gx, gz = grab.gz;
      const dx = gx - sofaPos.x;
      const dz = gz - sofaPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist > 0.01) {
        totalFx += (dx / dist) * CFG.grabStrength;
        totalFz += (dz / dist) * CFG.grabStrength;
        pushCount++;
      }
    }

    if (pushCount > 0) {
      this.sofa.applyImpulse({
        x: totalFx * CFG.fixedDt / Math.min(pushCount, 3),
        y: 0,
        z: totalFz * CFG.fixedDt / Math.min(pushCount, 3),
      }, true);
    }
  }

  step() {
    for (let i = 0; i < CFG.substeps; i++) {
      this.world.step();
    }
  }

  getState(): GameState {
    const R = RAPIER;
    const now = performance.now() / 1000;

    // Update sofa
    const sofaPos = this.sofa.translation();
    const sofaVel = this.sofa.linvel();
    const sofaSpeed = Math.sqrt(sofaVel.x * sofaVel.x + sofaVel.z * sofaVel.z);

    const sofaState = {
      integrity: 0,
      x: sofaPos.x,
      y: sofaPos.y,
      z: sofaPos.z,
    };

    // Damage check
    let dmg = CFG.maxDamage;
    if (sofaSpeed > CFG.damageThreshold) {
      dmg -= CFG.damagePerImpact * Math.min(sofaSpeed / 5, 3);
    }
    dmg = Math.max(0, dmg);
    sofaState.integrity = dmg;

    // Win check
    const inDelivery = (
      Math.abs(sofaPos.x - this.deliveryZone.cx) < this.deliveryZone.hw &&
      Math.abs(sofaPos.z - this.deliveryZone.cz) < this.deliveryZone.hd &&
      sofaSpeed < 0.3
    );

    return {
      roomCode: "", // set by room
      integrity: dmg,
      timeElapsed: now,
      playerCount: this.playerMap.size,
      gameOver: dmg <= 0,
      victory: inDelivery && dmg > 0,
      players: Object.fromEntries(
        Array.from(this.playerMap.entries()).map(([id, body]) => {
          const pos = body.translation();
          const rot = body.rotation();
          const grab = this.grabs.get(id);
          return [id, {
            x: pos.x, y: pos.y, z: pos.z,
            rx: rot.x, ry: rot.y, rz: rot.z,
            grabbed: grab?.active ?? false,
            grabX: grab?.gx ?? pos.x,
            grabY: grab?.gy ?? pos.y,
            grabZ: grab?.gz ?? pos.z,
          }];
        })
      ),
      sofa: sofaState,
      furniture: Object.fromEntries(
        Array.from(this.furnitureMap.entries()).map(([id, { body, integrity }]) => {
          const pos = body.translation();
          return [`furniture${id}`, {
            integrity,
            x: pos.x, y: pos.y, z: pos.z,
          }];
        })
      ),
      zones: {
        delivery: { x: this.deliveryZone.cx, z: this.deliveryZone.cz, sx: this.deliveryZone.hw * 2, sz: this.deliveryZone.hd * 2 },
        start: { x: this.startZone.cx, z: this.startZone.cz, sx: this.startZone.hw * 2, sz: this.startZone.hd * 2 },
      },
    };
  }
}

// ============================================================
// ROOM
// ============================================================
class Room {
  code: string;
  players: Map<number, { ws: WebSocket; state: PlayerState; input: PlayerInput }>;
  physics: PhysicsWorld;
  simInterval: ReturnType<typeof setInterval> | null = null;
  nextId: number = 0;

  constructor(code: string) {
    this.code = code;
    this.players = new Map();
    this.physics = new PhysicsWorld();
    this.simInterval = setInterval(() => this.simTick(), CFG.broadcastInterval);
    console.log(`[Room] Created: ${code}`);
  }

  join(ws: WebSocket): number {
    const id = this.nextId++;
    this.players.set(id, {
      ws,
      state: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, grabbed: false, grabX: 0, grabY: 0, grabZ: 0 },
      input: { x: 0, z: 0, grab: false, released: false },
    });
    this.physics.spawnPlayer(id, -14 + (id * 4), -12);
    return id;
  }

  leave(id: number) {
    const player = this.players.get(id);
    if (player) {
      const body = this.physics.playerMap.get(id);
      if (body) this.physics.world.removeRigidBody(body);
      this.players.delete(id);
      this.physics.playerMap.delete(id);
      this.physics.grabs.delete(id);
    }
    if (this.players.size === 0 && this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
      rooms.delete(this.code);
    }
  }

  setInput(id: number, input: PlayerInput) {
    const player = this.players.get(id);
    if (player) player.input = input;
  }

  private simTick() {
    // Apply inputs
    const inputMap = new Map<number, PlayerInput>();
    for (const [id, player] of this.players) {
      inputMap.set(id, player.input);
      this.physics.applyInput(player.input, id);
    }

    // Apply sofa push
    this.physics.applySofaPush(inputMap);

    // Step physics
    this.physics.step();

    // Get state
    const state = this.physics.getState();
    state.roomCode = this.code;
    state.playerCount = this.players.size;
    state.timeElapsed = (performance.now() / 1000);

    // Broadcast
    const json = JSON.stringify(state);
    for (const [, player] of this.players) {
      if (player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(json);
      }
    }

    // Reset inputs after broadcast
    for (const [, player] of this.players) {
      player.input = { x: 0, z: 0, grab: false, released: false };
    }
  }
}

// ============================================================
// WEBSOCKET SERVER
// ============================================================
const server = http.createServer(app);

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("[WS] New connection");

  ws.on("message", async (raw) => {
    let msg: { type: string; [key: string]: any };
    try {
      msg = JSON.parse(raw.toString());
    } catch { return; }

    switch (msg.type) {
      case "create_room": {
        // Wait for Rapier to be fully ready before creating rooms
        await ensureRapierReady();
        const code = generateCode();
        const room = new Room(code);
        rooms.set(code, room);
        const playerId = room.join(ws);
        ws.send(JSON.stringify({
          type: "room_created",
          code,
          playerId,
          maxPlayers: 2,
        }));
        break;
      }

      case "join_room": {
        const room = rooms.get(msg.code);
        if (!room) {
          ws.send(JSON.stringify({ type: "error", message: "Sala não encontrada" }));
          return;
        }
        if (room.players.size >= 2) {
          ws.send(JSON.stringify({ type: "error", message: "Sala cheia" }));
          return;
        }
        const playerId = room.join(ws);
        ws.send(JSON.stringify({
          type: "room_joined",
          code: room.code,
          playerId,
          playerCount: room.players.size,
        }));
        break;
      }

      case "input": {
        // Find player in any room
        for (const room of rooms.values()) {
          for (const [id, player] of room.players) {
            if (player.ws === ws) {
              room.setInput(id, {
                x: msg.x || 0,
                z: msg.z || 0,
                grab: !!msg.grab,
                released: !!msg.released,
              });
              return;
            }
          }
        }
        break;
      }

      case "ping": {
        ws.send(JSON.stringify({ type: "pong", time: performance.now() }));
        break;
      }
    }
  });

  ws.on("close", () => {
    console.log("[WS] Connection closed");
    for (const room of rooms.values()) {
      for (const [id, player] of room.players) {
        if (player.ws === ws) {
          room.leave(id);
          break;
        }
      }
    }
  });
});

// ============================================================
// START — initialize physics FIRST, then start server
// ============================================================
async function main() {
  console.log("[Server] Initializing Rapier3D...");
  await waitForRapier();

  server.listen(CFG.port, "0.0.0.0", () => {
    console.log(`
╔══════════════════════════════════════╗
║   MOVER MADNESS 3D - Server          ║
║   Port: ${CFG.port}
║   Open browser: http://localhost:${CFG.port}
╚══════════════════════════════════════╝
`);
  });
}

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

main().catch(console.error);
