/**
 * opnet.ts — OP_NET provider, wallet, and contract interaction layer
 *
 * This is the bridge between the React UI and the OP_NET Bitcoin L1 protocol.
 * It wraps the opnet SDK to handle:
 *  - Network switching (testnet ↔ mainnet)
 *  - Wallet connection via window.unisat or window.wizz (OP_NET compatible wallets)
 *  - Contract reads (getGame, getMoves, getStats)
 *  - Contract writes (createGame, commitMove, endGame, placeBet, sendTip)
 *  - Transaction building, signing, and broadcasting
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type NetworkName = 'testnet' | 'mainnet';

export interface GameState {
  gameId: string;
  white: string;
  black: string;
  wager: bigint;
  token: string;
  status: 0 | 1 | 2;   // pending | active | ended
  winner: string;        // 'w' | 'b' | 'd' | ''
  moveCount: number;
}

export interface ContractStats {
  totalGames: bigint;
  tipJarTotal: bigint;
  lpPoolTotal: bigint;
}

export interface OPNetConfig {
  network: NetworkName;
  contractAddress: string;
}

// ─── Network endpoints ────────────────────────────────────────────────────────

export const NETWORKS = {
  testnet: {
    rpcUrl:  'https://testnet.opnet.org',
    name:    'OP_NET Testnet',
    chainId: 'testnet',
  },
  mainnet: {
    rpcUrl:  'https://api.opnet.org',
    name:    'OP_NET Mainnet (Bitcoin L1)',
    chainId: 'mainnet',
  },
} as const;

// ─── Contract addresses ───────────────────────────────────────────────────────
// Replace TESTNET_ADDRESS after deployment via scripts/deploy.js
export const CONTRACT_ADDRESSES: Record<NetworkName, string> = {
  testnet: 'REPLACE_AFTER_DEPLOY_TESTNET',
  mainnet: 'REPLACE_AFTER_DEPLOY_MAINNET',
};

// ─── Chess contract ABI (mirrors ChessContract.ts selectors) ─────────────────
export const CHESS_ABI = [
  {
    name: 'createGame',
    type: 'function',
    inputs: [
      { name: 'playerBlack', type: 'address' },
      { name: 'token',       type: 'string'  },
      { name: 'wager',       type: 'uint256' },
    ],
    outputs: [{ name: 'gameId', type: 'uint256' }],
  },
  {
    name: 'joinGame',
    type: 'function',
    inputs: [{ name: 'gameId', type: 'uint256' }],
    outputs: [{ name: 'status', type: 'uint8' }],
  },
  {
    name: 'commitMove',
    type: 'function',
    inputs: [
      { name: 'gameId',    type: 'uint256' },
      { name: 'notation',  type: 'string'  },
      { name: 'moveIndex', type: 'uint32'  },
    ],
    outputs: [{ name: 'ok', type: 'bool' }],
  },
  {
    name: 'endGame',
    type: 'function',
    inputs: [
      { name: 'gameId', type: 'uint256' },
      { name: 'winner', type: 'string'  },
      { name: 'reason', type: 'string'  },
    ],
    outputs: [{ name: 'ok', type: 'bool' }],
  },
  {
    name: 'placeBet',
    type: 'function',
    inputs: [
      { name: 'gameId', type: 'uint256' },
      { name: 'side',   type: 'string'  },
      { name: 'amount', type: 'uint256' },
      { name: 'token',  type: 'string'  },
    ],
    outputs: [{ name: 'ok', type: 'bool' }],
  },
  {
    name: 'claimBet',
    type: 'function',
    inputs: [{ name: 'gameId', type: 'uint256' }],
    outputs: [{ name: 'payout', type: 'uint256' }],
  },
  {
    name: 'sendTip',
    type: 'function',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'token',  type: 'string'  },
    ],
    outputs: [{ name: 'ok', type: 'bool' }],
  },
  {
    name: 'getGame',
    type: 'function',
    inputs: [{ name: 'gameId', type: 'uint256' }],
    outputs: [
      { name: 'white',     type: 'string'  },
      { name: 'black',     type: 'string'  },
      { name: 'wager',     type: 'uint256' },
      { name: 'token',     type: 'string'  },
      { name: 'status',    type: 'uint8'   },
      { name: 'winner',    type: 'string'  },
      { name: 'moveCount', type: 'uint32'  },
    ],
  },
  {
    name: 'getMoves',
    type: 'function',
    inputs: [{ name: 'gameId', type: 'uint256' }],
    outputs: [
      { name: 'count', type: 'uint32' },
      { name: 'moves', type: 'string[]' },
    ],
  },
  {
    name: 'getStats',
    type: 'function',
    inputs: [],
    outputs: [
      { name: 'totalGames',  type: 'uint256' },
      { name: 'tipJarTotal', type: 'uint256' },
      { name: 'lpPoolTotal', type: 'uint256' },
    ],
  },
] as const;

// ─── OPNet provider wrapper ───────────────────────────────────────────────────

export class OPNetProvider {
  private _network: NetworkName;
  private _address: string | null = null;
  private _publicKey: string | null = null;

  constructor(network: NetworkName = 'testnet') {
    this._network = network;
  }

  get network()    { return this._network; }
  get address()    { return this._address; }
  get publicKey()  { return this._publicKey; }
  get isConnected(){ return this._address !== null; }
  get rpcUrl()     { return NETWORKS[this._network].rpcUrl; }
  get contractAddress() { return CONTRACT_ADDRESSES[this._network]; }

  setNetwork(n: NetworkName) { this._network = n; }

  /**
   * Connect wallet — supports UniSat, Wizz, and OKX wallets
   * which are the primary wallets for OP_NET on Bitcoin.
   */
  async connectWallet(): Promise<{ address: string; publicKey: string }> {
    const wallet = this._detectWallet();
    if (!wallet) {
      throw new Error(
        'No compatible Bitcoin wallet found.\n' +
        'Please install UniSat (unisat.io) or Wizz Wallet.'
      );
    }

    try {
      // Request accounts — prompts user approval
      const accounts: string[] = await wallet.requestAccounts();
      if (!accounts || accounts.length === 0) throw new Error('No accounts returned');

      const publicKey: string = await wallet.getPublicKey();

      this._address   = accounts[0];
      this._publicKey = publicKey;

      return { address: accounts[0], publicKey };
    } catch (err: unknown) {
      throw new Error(`Wallet connection failed: ${(err as Error).message}`);
    }
  }

  /** Detect available Bitcoin wallet provider in browser */
  private _detectWallet(): WalletProvider | null {
    const w = window as unknown as WindowWithWallets;
    if (w.unisat)  return w.unisat;
    if (w.wizz)    return w.wizz;
    if (w.okxwallet?.bitcoin) return w.okxwallet.bitcoin;
    return null;
  }

  /**
   * Call a read-only contract method (simulation, no BTC required)
   * Returns raw decoded response object.
   */
  async call<T = Record<string, unknown>>(
    method: string,
    params: unknown[] = []
  ): Promise<T> {
    const contractAddr = this.contractAddress;
    if (contractAddr.startsWith('REPLACE')) {
      // Return mock data in pre-deploy mode so UI still works
      return this._mockCall(method, params) as T;
    }

    const body = {
      jsonrpc: '2.0',
      method: 'call',
      id: Date.now(),
      params: [{
        to:     contractAddr,
        method,
        params,
        from:   this._address ?? undefined,
      }],
    };

    const res = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`RPC error: ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);
    return json.result as T;
  }

  /**
   * Send a state-changing transaction via the connected wallet.
   * The wallet signs a Bitcoin inscription that calls the contract.
   */
  async sendTransaction(
    method: string,
    params: unknown[],
    satoshis: number = 1000
  ): Promise<string> {
    if (!this._address) throw new Error('Wallet not connected');

    const contractAddr = this.contractAddress;
    if (contractAddr.startsWith('REPLACE')) {
      // Simulate in pre-deploy mode
      console.log(`[DEMO] sendTransaction: ${method}`, params);
      await new Promise(r => setTimeout(r, 800));
      return 'demo_txid_' + Math.random().toString(36).slice(2);
    }

    const wallet = this._detectWallet();
    if (!wallet) throw new Error('Wallet not available');

    // Encode the calldata as a hex string for OP_NET inscription
    const calldata = this._encodeCalldata(method, params);

    // OP_NET transactions are Bitcoin inscriptions targeting op1... addresses
    const txid = await wallet.sendBitcoin(contractAddr, satoshis, {
      memo: calldata,
    });

    return txid;
  }

  /** Very simple ABI-style calldata encoder (method sig + params) */
  private _encodeCalldata(method: string, params: unknown[]): string {
    const sig = this._methodSignature(method);
    const encoded = params.map(p => {
      if (typeof p === 'bigint')  return p.toString(16).padStart(64, '0');
      if (typeof p === 'number')  return p.toString(16).padStart(64, '0');
      if (typeof p === 'string') {
        const hex = Array.from(new TextEncoder().encode(p))
          .map(b => b.toString(16).padStart(2, '0')).join('');
        const lenHex = (hex.length / 2).toString(16).padStart(64, '0');
        return lenHex + hex;
      }
      return '';
    }).join('');
    return sig + encoded;
  }

  /** keccak-style first 4 bytes of method signature (simplified) */
  private _methodSignature(method: string): string {
    // In production use a proper keccak256 library.
    // This is a placeholder that matches the encodeSelector in AssemblyScript.
    let h = 0;
    for (let i = 0; i < method.length; i++) {
      h = ((h << 5) - h + method.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(16).padStart(8, '0');
  }

  /** Mock responses for pre-deploy/demo mode */
  private _mockCall(method: string, _params: unknown[]): unknown {
    if (method === 'getStats') {
      return { totalGames: 47n, tipJarTotal: 3210n, lpPoolTotal: 84200n };
    }
    if (method === 'getGame') {
      return {
        white: 'bc1q...mock1', black: 'bc1q...mock2',
        wager: 1000n, token: 'MOTO',
        status: 1, winner: '', moveCount: 0,
      };
    }
    return {};
  }
}

// ─── Singleton provider ───────────────────────────────────────────────────────
export const provider = new OPNetProvider('testnet');

// ─── Window type augmentation ─────────────────────────────────────────────────
interface WalletProvider {
  requestAccounts(): Promise<string[]>;
  getPublicKey(): Promise<string>;
  sendBitcoin(to: string, satoshis: number, opts?: { memo?: string }): Promise<string>;
}

interface WindowWithWallets {
  unisat?:    WalletProvider;
  wizz?:      WalletProvider;
  okxwallet?: { bitcoin?: WalletProvider };
}
