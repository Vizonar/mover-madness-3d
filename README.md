# 🛋️ Mover Madness 3D

Protótipo de jogo cooperativo de física 3D multiplayer. Dois jogadores carregam um sofá desengonçado por uma casa, coordenando seus movimentos para não estragar o móvel.

## Arquitetura

```
┌─────────────┐        WebSocket        ┌─────────────────┐
│  Player 1    │◄──────────────────────►│                   │
│  (Browser)   │    Input + State       │    Node.js        │
│  Three.js    │◄──────────────────────►│    Rapier3D       │
├─────────────┤                        │    Physics Server  │
│  Player 2    │◄──────────────────────►│    (Authoritative)│
│  (Browser)   │    Input + State       │                   │
└─────────────┘        WebSocket        └─────────────────┘
```

- **Física roda no servidor** (Rapier3D) — autoridade total sobre posição/rotação
- **Clientes só enviam input** (teclas) e recebem estado para renderização
- **Sistema de sala por código** — cria um código 4-char, amigo digita pra entrar

---

## Instalação Rápida

### Pré-requisitos

- Node.js 18+ ([download](https://nodejs.org/))
- Um navegador moderno (Chrome, Firefox, Edge)

### Passos

```bash
# 1. Instalar dependências do servidor
cd server
npm install

# 2. Iniciar servidor (modo desenvolvimento — recarrega automaticamente)
npx tsx server.ts
```

Você verá:
```
[Server] Initializing Rapier3D...
[Server] Rapier3D ready

╔══════════════════════════════════════╗
║   MOVER MADNESS 3D - Server          ║
║   Port: 2567
║   Open browser: http://localhost:2567
╚══════════════════════════════════════════╝
```

```bash
# 3. Abrir no navegador
# http://localhost:2567
```

### Jogando

1. **Jogador 1 (Host):** Abre `http://localhost:2567` → clica em **"🏠 Criar Sala"**
2. Um código de 4 caracteres aparece (ex: `K7BX`)
3. **Jogador 2:** Digita o código no campo → clica **"Entrar"**
4. O jogo começa automaticamente quando ambos estão conectados

### Controles

| Jogador | Mover | Agarrar/Soltar |
|---------|-------|----------------|
| 🔵 1 | `W A S D` | `G` |
| 🔴 2 | `↑ ← ↓ →` | `Enter` |

---

## 🌐 Testar com Amigo à Distância

### Opção 1: Túnel ngrok (Rápido — para hoje)

O ngrok cria um túnel seguro da sua máquina local para a internet.

**Passo a passo:**

1. **Baixar ngrok:** https://ngrok.com/download
   - Ou via npm: `npm install -g ngrok`
   - Ou via Scoop (Windows): `scoop install ngrok`

2. **Criar túnel** (em outro terminal, com o servidor rodando):
   ```bash
   ngrok http 2567
   ```

3. **Copiar a URL pública** que aparece (algo como `https://abc123.ngrok-free.app`)

4. **Enviar a URL para seu amigo**

5. **Seu amigo:**
   - Abre a URL no navegador
   - Cria sala ou entra com código
   - Pronto!

**Dica:** O ngrok gratuito expira após 2 horas. Para sessões mais longas, use `--domain` com um domínio personalizado (configuração paga).

### Opção 2: Deploy Railway (Estável — para testes recorrentes)

Railway hospeda seu servidor com URL fixa e gratuita (até 512MB RAM, 512MB disco).

**Passo a passo:**

1. **Preparar o projeto:**
   ```bash
   # Na raiz do projeto, criar arquivo Railway
   echo "server" > .railwayignore
   # Criar o arquivo de deploy
   ```

2. **Criar `server/Railway.toml`:**
   ```toml
   [build]
   builder = "NIXPACKS"
   buildCommand = "npm install && npx tsx server.ts"

   [deploy]
   startCommand = "npx tsx server.ts"
   healthcheckPath = "/"
   healthcheckTimeout = 100
   restartPolicyType = "ON_FAILURE"
   restartPolicyMaxRetries = 10
   ```

3. **Deploy:**
   ```bash
   # Instalar CLI do Railway
   npm install -g @railway/cli

   # Fazer login
   railway login

   # Criar novo projeto
   railway up -d
   ```

4. **Obter URL:** O Railway gera uma URL como `https://mover-madness-xyz.railway.app`

5. **Compartilhar:** Seu amigo abre essa URL no navegador

**Alternativa: Render.com** (também gratuito)
```yaml
# render.yaml
services:
  - type: web
    name: mover-madness
    env: node
    buildCommand: cd server && npm install
    startCommand: cd server && npx tsx server.ts
    envVars:
      - key: PORT
        value: 2567
```

---

## ⚙️ Parâmetros de Física

Todos na variável `CFG` do [`server/server.ts`](server/server.ts):

### Jogador
```typescript
playerMass: 70,        // kg — massa do personagem
playerSpeed: 5.0,      // m/s — velocidade de movimento
playerRadius: 0.4,     // raio da cápsula
playerHeight: 1.6,     // altura da cápsula
playerFriction: 0.5,   // atrito com o chão
```

### Agarrar
```typescript
grabDistance: 3.0,     // metros — alcance máximo para agarrar
grabStrength: 500,     // Newtons — força do puxão
```
- **Mais forte** → mais controle, menos "balanço cômico"
- **Mais fraco** → mais caos, mais engraçado, mas frustrante

### Sofá (móvel principal)
```typescript
sofaMass: 60,          // kg — quanto mais pesado, mais difícil empurrar
sofaFriction: 0.7,     // atrito com o chão
sofaRestitution: 0.05, // quão "quante" é (0 = sem rebote)
```
- **Massa alta + atrito alto** = sensação de peso real
- **Massa baixa** = fácil de empurrar, menos satisfatório

### Dano
```typescript
damageThreshold: 2.5,  // m/s mínimo pra causar dano
damagePerImpact: 30,   // pontos de dano por impacto
maxDamage: 100,        // vida total do sofá
```
- Com valor atual: **~3-4 impactos fortes** quebram o sofá
- Aumentar `maxDamage` para 150 para ser mais permissivo
- Reduzir `damageThreshold` para 1.5 para ser mais punitivo

### Mundo
```typescript
worldSize: 25,         // meio tamanho da casa (em metros)
wallH: 3.5,            // altura das paredes
wallT: 0.3,            // espessura das paredes
```

---

## 🔍 Pontos de Bug de Sincronização

### O que observar nos testes:

1. **"Jogador fantasma"** — Se um jogador vê o outro em posição diferente da realidade
   - **Causa provável:** O servidor está enviando posição antiga
   - **Verificar:** A função `getState()` no servidor está retornando dados corretos

2. **Móvel "teleportando"** — Sofá pulando posições
   - **Causa provável:** Delay entre envio do input e aplicação na física
   - **Solução futura:** Interpolação no cliente (predição)

3. **Jogador atravessando parede** — Físicas diferentes entre cliente e servidor
   - **Este protótipo:** Impossível (servidor é autoritativo)
   - **Se acontecer:** Verificar se `step()` está sendo chamado corretamente

4. **Gravidade/Y flutuando** — Jogador subindo ou afundando no chão
   - **Causa provável:** `ExtraBodyForces` não compensando a gravidade corretamente
   - **Solução:** Verificar `CFG.playerMass * 9.81`

5. **Input não respondendo** — Jogador não se move
   - **Verificar:** `ws.send()` está sendo chamado? `onmessage` está recebendo?
   - **Debug:** Adicionar `console.log` no handler de input do servidor

6. **Código da sala não funcionando** — Amigo não consegue entrar
   - **Verificar:** O código é gerado com `generateCode()`? O mapa `rooms` está sendo populado?
   - **Debug:** Verificar no terminal do servidor se a sala foi criada

---

## 🚀 Próximo Passo: Resolver Delay

Se a física parecer "grudenta" (input leva 1+ frame para aparecer):

### Problema
No protótipo atual:
1. Cliente envia input → 1 frame de delay
2. Servidor processa → 1 frame de delay
3. Servidor envia estado → 1 frame de delay
4. Cliente recebe → renderiza

Total: **~50ms** de delay (3 frames a 60fps). Com latência de rede, pode chegar a 150-200ms.

### Solução: Interpolação no Cliente

**Implementar buffering de estado:**
```javascript
// Cliente recebe pacotes de estado
const stateBuffer = [];
const bufferInterval = 100; // ms

ws.onmessage = (msg) => {
  stateBuffer.push({ time: Date.now(), state: msg });
  if (stateBuffer.length > 10) stateBuffer.shift();
};

// Renderiza sempre o estado mais recente + interpolação
function render() {
  const target = stateBuffer[stateBuffer.length - 1];
  const prev = stateBuffer[stateBuffer.length - 2];
  const t = (Date.now() - prev.time) / (target.time - prev.time);

  // Interpola posição entre prev e target
  const x = prev.x + (target.x - prev.x) * t;
  // ... mesma coisa para rotação, outros objetos
}
```

**Ou predição de cliente (mais complexo):**
- Cliente simula movimento localmente
- Servidor corrige posição no próximo frame
- Cliente "snaps" para correção gradualmente

---

## 📁 Estrutura do Projeto

```
MoverMadness3D/
├── server/
│   ├── package.json      # Dependências (Rapier3D, Express, WS)
│   ├── tsconfig.json     # Config TypeScript
│   └── server.ts         # Servidor principal (física + WebSocket)
├── client/
│   ├── index.html        # UI (telas, HUD, controles)
│   └── game.js           # Three.js + networking do cliente
└── README.md             # Este arquivo
```

---

## ⚠️ Limitações desta Versão

- ❌ Sem predição de cliente (delay perceptível)
- ❌ Sem reconexão automática
- ❌ Máximo 2 jogadores (fácil de expandir)
- ❌ Sem som (fácil de adicionar Web Audio API)
- ❌ Sem persistência de dados

## ✅ O que Funciona

- ✅ Física 3D server-side (Rapier3D)
- ✅ Multiplayer em tempo real (WebSocket)
- ✅ Sistema de sala por código
- ✅ Agarrar/soltar móveis
- ✅ Dano por impacto
- ✅ Condição de vitória (zona de entrega)
- ✅ Câmera terceira pessoa

---

## 📝 Logs de Debug

Para debug, abra o console do navegador (F12) e observe:

```
[Net] Connected to server     → Conexão estabelecida
[Net] Disconnected            → Conexão perdida
```

No servidor, observe:
```
[Server] Rapier3D ready       → Física inicializada
[Room] Created: K7BX          → Sala criada
[Room] Player 0 joined        → Jogador entrou
```
