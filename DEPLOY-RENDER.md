# 🛋️ Mover Madness 3D - Deploy no Render

## Passo a passo (5 minutos)

### 1. Criar conta no Render
- Ir em https://render.com
- Clica em "Get Started for Free"
- Faz login com GitHub (recomendado)

### 2. Publicar o código no GitHub
- Se já tem repositório: coloca esses arquivos lá
- Se não tem:
  1. Cria repositório novo em https://github.com/new
  2. Nome: `mover-madness`
  3. Clica em "Create repository"
  4. Copia os comandos que ele mostra pra subir o código

### 3. Deploy no Render
1. No painel do Render, clica em **"New +"**
2. Escolhe **"Web Service"**
3. Conecta o repositório `mover-madness`
4. Configura assim:
   - **Name:** `mover-madness`
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npx tsx server.ts`
   - **Instance Type:** `Free`
5. Clica em **"Create Web Service"**

### 4. Pronto!
O Render vai gerar uma URL tipo:
```
https://mover-madness-xyz.onrender.com
```

**Manda essa URL pro seu amigo.**

---

## Testar localmente

```bash
npm install
npx tsx server.ts
# Abre http://localhost:2568
```
