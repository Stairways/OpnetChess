# ♟ OP_NET Chess — Bitcoin L1 Wagered Chess dApp

[![Bitcoin](https://img.shields.io/badge/Bitcoin-L1-orange?logo=bitcoin)](https://bitcoin.org)
[![OP_NET](https://img.shields.io/badge/OP__NET-Smart%20Contracts-purple)](https://opnet.org)
[![AssemblyScript](https://img.shields.io/badge/Contract-AssemblyScript→WASM-blue)](https://www.assemblyscript.org)
[![React](https://img.shields.io/badge/Frontend-React%20+%20Vite-61DAFB?logo=react)](https://react.dev)
[![Vercel](https://img.shields.io/badge/Deploy-Vercel-black?logo=vercel)](https://vercel.com)

A fully on-chain wagered chess game built on **OP_NET** — the smart contract protocol running natively on **Bitcoin Layer 1**. No sidechain. No wrapped BTC. Just Bitcoin.

---

## ✨ Features

- **On-chain wager escrow** — BTC-denominated wagers locked in the ChessContract
- **Move commitment** — Every move is inscribed to Bitcoin L1 for full auditability
- **$MOTO and $PILL token support** — Motoswap ecosystem tokens
- **Live side-betting** — Spectators can bet on ongoing games
- **Creator tip jar** — 10% of every wager auto-routes to the creator
- **LP prize pool** — 90% accumulates; winners claim every Friday
- **vs AI mode** — Random-legal + capture-priority AI engine
- **Full castling + en passant** — Complete, audited chess rules
- **Testnet → Mainnet** — One switch deploys to Bitcoin mainnet (March 17, 2026)

---

## 🗂 Project Structure

```
opnet-chess/
├── contract/                    # AssemblyScript smart contract
│   ├── src/
│   │   ├── index.ts             # Entry point (exports Contract)
│   │   ├── contracts/
│   │   │   └── ChessContract.ts # Main contract logic
│   │   └── events/
│   │       └── ChessEvents.ts   # On-chain events
│   ├── build/                   # Compiled WASM output (git-ignored)
│   ├── asconfig.json
│   └── package.json
│
├── frontend/                    # React + Vite dApp
│   ├── src/
│   │   ├── main.tsx             # React entry point
│   │   ├── App.tsx              # Main UI component
│   │   ├── App.css              # Full stylesheet
│   │   ├── hooks/
│   │   │   ├── useChess.ts      # Audited chess engine hook
│   │   │   └── useOPNet.ts      # OP_NET wallet + contract hook
│   │   └── lib/
│   │       └── opnet.ts         # Provider, ABI, network config
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
│
├── scripts/
│   ├── deploy.js                # Deployment script (testnet/mainnet)
│   └── deployed.json            # Deployment receipt (generated)
│
├── .github/
│   └── workflows/
│       └── ci.yml               # GitHub Actions CI/CD
│
├── vercel.json                  # Vercel deployment config
└── package.json                 # Monorepo root
```

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
npm install          # root (installs all workspaces)
```

### 2. Build the smart contract
```bash
npm run build:contract
# → contract/build/chess.wasm
```

### 3. Run the frontend (dev)
```bash
npm run dev
# → http://localhost:5173
```

The frontend runs in **demo mode** until a contract address is configured. All chess and UI logic is fully functional without a wallet.

---

## 🔗 Wallet Setup

OP_NET requires a Bitcoin wallet that supports **P2TR (Taproot)** inscriptions:

| Wallet | Platform | Install |
|--------|----------|---------|
| **UniSat** (recommended) | Browser | [unisat.io](https://unisat.io) |
| **Wizz Wallet** | Browser | [wizzwallet.io](https://wizzwallet.io) |
| **OKX Wallet** | Browser/Mobile | [okx.com/web3](https://www.okx.com/web3) |

After installing, switch the wallet to **Testnet** for development.

---

## ⛓ Contract Deployment

### Testnet
```bash
# 1. Get testnet BTC from faucet
#    https://testnet.opnet.org/faucet

# 2. Deploy
npm run deploy:testnet
```

### Mainnet (Bitcoin L1 — launches March 17, 2026)
```bash
npm run deploy:mainnet
```

The deployment script will:
1. Read `contract/build/chess.wasm`
2. Broadcast the deployment inscription
3. Wait for Bitcoin confirmation (~10 min)
4. **Automatically update** `frontend/src/lib/opnet.ts` with the contract address
5. Save a receipt to `scripts/deployed.json`

> **Manual deploy alternative:** Use the OP_NET CLI:
> ```bash
> npx @btc-vision/opnet-cli deploy --wasm contract/build/chess.wasm --network testnet
> ```

---

## 📋 Contract API

| Method | Description | Caller |
|--------|-------------|--------|
| `createGame(black, token, wager)` | Create a wagered game | White player |
| `joinGame(gameId)` | Accept and start the game | Black player |
| `commitMove(gameId, notation, index)` | Record a move on-chain | Active player |
| `endGame(gameId, winner, reason)` | Finalize and trigger payout | Either player |
| `placeBet(gameId, side, amount, token)` | Side-bet on a live game | Anyone |
| `claimBet(gameId)` | Claim winning bet | Winning bettor |
| `sendTip(amount, token)` | Send tip to creator | Anyone |
| `getGame(gameId)` | Read game state | View |
| `getMoves(gameId)` | Read all committed moves | View |
| `getStats()` | Global stats | View |

### Fee Structure
- **90%** of every wager → LP Prize Pool (distributed Fridays)
- **10%** of every wager → Creator Tip Jar

---

## 🧪 Audit Notes (Chess Engine)

The chess engine (`useChess.ts`) was audited and corrected from the original HTML version. Fixes applied:

| # | Issue | Fix |
|---|-------|-----|
| 1 | En passant not implemented | Full EP capture logic with board cleanup |
| 2 | Castling not implemented | KS + QS castling with attack-path checks |
| 3 | King legality checked at source, not destination | Fixed: checks attacks at destination square |
| 4 | Stalemate always triggered as checkmate | Fixed: `hasAnyLegal` separate from `inCheck` |
| 5 | Timer interval leaked on game over | Fixed: `clearInterval` in all game-over paths |
| 6 | `undoMove` didn't restore EP/castle state | Fixed: MoveRecord stores full context |
| 7 | Last-move highlight stale closure | Fixed: direct state read in render |
| 8 | Pawn promotion auto-queened silently | Implemented: piece swapped to `Q` with notation |

---

## 🌐 Deploy to Vercel

```bash
# 1. Push to GitHub
git remote add origin https://github.com/YOUR_USERNAME/opnet-chess
git push -u origin main

# 2. Import project in vercel.com
# 3. Set environment variables:
#    VITE_CONTRACT_TESTNET=<your_testnet_address>
#    VITE_CONTRACT_MAINNET=<your_mainnet_address>
```

Or via Vercel CLI:
```bash
npm i -g vercel
vercel --prod
```

---

## 🔐 GitHub Secrets Required

For CI/CD to work, add these to your GitHub repository secrets:

| Secret | Description |
|--------|-------------|
| `VERCEL_TOKEN` | Vercel API token |
| `VERCEL_ORG_ID` | From `vercel.com/account` |
| `VERCEL_PROJECT_ID` | From project settings |
| `CONTRACT_ADDRESS_TESTNET` | After testnet deploy |
| `CONTRACT_ADDRESS_MAINNET` | After mainnet deploy |

---

## 📅 Mainnet Launch

OP_NET Bitcoin mainnet launches **March 17, 2026**. The frontend has a network switcher — just change Testnet → Mainnet and ensure `CONTRACT_ADDRESSES.mainnet` is set after deploying.

---

## 📜 License

MIT — see [LICENSE](LICENSE)

---

## 🙏 Credits

- **OP_NET** — [opnet.org](https://opnet.org) — Smart contracts on Bitcoin L1
- **btc-vision** — [github.com/btc-vision](https://github.com/btc-vision) — Runtime & SDK
- **Motoswap** — $MOTO · $PILL ecosystem
- **Motocats** — OP_NET Army pieces
