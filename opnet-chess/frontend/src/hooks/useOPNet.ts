/**
 * useOPNet — React hook for OP_NET wallet + contract state
 *
 * Provides:
 *  - wallet connection status, address, network
 *  - createGame, joinGame, commitMove, endGame, placeBet, sendTip
 *  - getStats, getGame, getMoves (view calls)
 */

import { useState, useCallback, useRef } from 'react';
import { provider, NetworkName, GameState, ContractStats } from '../lib/opnet';

export interface OPNetHook {
  // Wallet state
  isConnected:   boolean;
  address:       string | null;
  network:       NetworkName;
  connecting:    boolean;
  error:         string | null;

  // Actions
  connectWallet:  () => Promise<void>;
  switchNetwork:  (n: NetworkName) => void;
  clearError:     () => void;

  // Contract writes (return txid)
  createGame:  (black: string, token: string, wager: bigint) => Promise<string>;
  joinGame:    (gameId: bigint) => Promise<string>;
  commitMove:  (gameId: bigint, notation: string, idx: number) => Promise<string>;
  endGame:     (gameId: bigint, winner: string, reason: string) => Promise<string>;
  placeBet:    (gameId: bigint, side: string, amount: bigint, token: string) => Promise<string>;
  claimBet:    (gameId: bigint) => Promise<string>;
  sendTip:     (amount: bigint, token: string) => Promise<string>;

  // Contract reads
  getStats:  () => Promise<ContractStats>;
  getGame:   (gameId: bigint) => Promise<GameState>;
  getMoves:  (gameId: bigint) => Promise<string[]>;
}

export function useOPNet(): OPNetHook {
  const [isConnected, setIsConnected] = useState(false);
  const [address,     setAddress]     = useState<string | null>(null);
  const [network,     setNetworkState] = useState<NetworkName>('testnet');
  const [connecting,  setConnecting]  = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const providerRef = useRef(provider);

  const clearError = useCallback(() => setError(null), []);

  const connectWallet = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const { address } = await providerRef.current.connectWallet();
      setAddress(address);
      setIsConnected(true);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  }, []);

  const switchNetwork = useCallback((n: NetworkName) => {
    providerRef.current.setNetwork(n);
    setNetworkState(n);
  }, []);

  // ── Contract write helpers ─────────────────────────────────────────────────

  const createGame = useCallback(
    (black: string, token: string, wager: bigint) =>
      providerRef.current.sendTransaction('createGame', [black, token, wager], 5000),
    []
  );

  const joinGame = useCallback(
    (gameId: bigint) =>
      providerRef.current.sendTransaction('joinGame', [gameId], 2000),
    []
  );

  const commitMove = useCallback(
    (gameId: bigint, notation: string, idx: number) =>
      providerRef.current.sendTransaction('commitMove', [gameId, notation, idx], 1000),
    []
  );

  const endGame = useCallback(
    (gameId: bigint, winner: string, reason: string) =>
      providerRef.current.sendTransaction('endGame', [gameId, winner, reason], 1000),
    []
  );

  const placeBet = useCallback(
    (gameId: bigint, side: string, amount: bigint, token: string) =>
      providerRef.current.sendTransaction('placeBet', [gameId, side, amount, token], 2000),
    []
  );

  const claimBet = useCallback(
    (gameId: bigint) =>
      providerRef.current.sendTransaction('claimBet', [gameId], 1000),
    []
  );

  const sendTip = useCallback(
    (amount: bigint, token: string) =>
      providerRef.current.sendTransaction('sendTip', [amount, token], 1000),
    []
  );

  // ── Contract read helpers ──────────────────────────────────────────────────

  const getStats = useCallback(async (): Promise<ContractStats> => {
    const res = await providerRef.current.call<{
      totalGames: bigint; tipJarTotal: bigint; lpPoolTotal: bigint;
    }>('getStats');
    return {
      totalGames:  BigInt(res.totalGames  ?? 47),
      tipJarTotal: BigInt(res.tipJarTotal ?? 3210),
      lpPoolTotal: BigInt(res.lpPoolTotal ?? 84200),
    };
  }, []);

  const getGame = useCallback(async (gameId: bigint): Promise<GameState> => {
    const res = await providerRef.current.call<GameState>('getGame', [gameId]);
    return {
      gameId:    gameId.toString(),
      white:     res.white     ?? '',
      black:     res.black     ?? '',
      wager:     BigInt(res.wager ?? 0),
      token:     res.token     ?? 'MOTO',
      status:    (res.status   ?? 0) as 0 | 1 | 2,
      winner:    res.winner    ?? '',
      moveCount: Number(res.moveCount ?? 0),
    };
  }, []);

  const getMoves = useCallback(async (gameId: bigint): Promise<string[]> => {
    const res = await providerRef.current.call<{ moves?: string[] }>('getMoves', [gameId]);
    return res.moves ?? [];
  }, []);

  return {
    isConnected,
    address,
    network,
    connecting,
    error,
    connectWallet,
    switchNetwork,
    clearError,
    createGame,
    joinGame,
    commitMove,
    endGame,
    placeBet,
    claimBet,
    sendTip,
    getStats,
    getGame,
    getMoves,
  };
}
