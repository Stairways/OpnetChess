/**
 * OP_NET Chess — Main App
 *
 * Full Bitcoin L1 wagered chess dApp powered by OP_NET.
 * Connects wallet, commits moves on-chain, pays out winners.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useChess, PieceCode, Color } from './hooks/useChess';
import { useOPNet } from './hooks/useOPNet';
import { NetworkName } from './lib/opnet';
import './App.css';

// ─── Ecosystem pieces ─────────────────────────────────────────────────────────
const PIECES: Record<PieceCode, { emoji: string; label: string }> = {
  wK: { emoji:'🏦', label:'Motoswap AMM (King)'   },
  wQ: { emoji:'🟠', label:'Orange Pill (Queen)'    },
  wR: { emoji:'₿',  label:'Bitcoin Block (Rook)'   },
  wB: { emoji:'🔶', label:'OP Node (Bishop)'        },
  wN: { emoji:'🏍', label:'MOTO Rider (Knight)'    },
  wP: { emoji:'🐾', label:'Motocat Pawn'           },
  bK: { emoji:'🖥', label:'OP_NET Core (King)'     },
  bQ: { emoji:'💜', label:'PILL Node (Queen)'      },
  bR: { emoji:'🟣', label:'Purple Block (Rook)'    },
  bB: { emoji:'🔷', label:'Network Node (Bishop)'  },
  bN: { emoji:'🐱', label:'Motocat Knight'         },
  bP: { emoji:'⬡',  label:'OP_NET Pawn'            },
};

const FILES = ['a','b','c','d','e','f','g','h'];

type GameMode = 'human' | 'ai';
type TokenChoice = 'MOTO' | 'PILL';
type SideChoice  = 'orange' | 'purple';

// ─── Component ────────────────────────────────────────────────────────────────
export default function App() {
  // Chess engine
  const { state, handleSquareClick, reset, undoMove, flipBoard, aiMove, resign, offerDraw } = useChess(600);

  // OP_NET integration
  const opnet = useOPNet();

  // Game setup state
  const [gameMode,    setGameMode]    = useState<GameMode>('human');
  const [playerSide,  setPlayerSide]  = useState<SideChoice>('orange');
  const [token,       setToken]       = useState<TokenChoice>('MOTO');
  const [wager,       setWager]       = useState(1000);
  const [activeGameId, setActiveGameId] = useState<bigint | null>(null);
  const [txToast,     setTxToast]     = useState<string | null>(null);

  // Overlay state
  const [showLobby,   setShowLobby]   = useState(true);
  const [showWinner,  setShowWinner]  = useState(false);

  // Demo bets
  const [bets, setBets] = useState([
    { addr:'bc1q…4f2a', side:'orange', amount:'2,000 $MOTO' },
    { addr:'bc1p…9z3c', side:'purple', amount:'500,000 $PILL' },
    { addr:'bc1q…1b7e', side:'orange', amount:'5,000 $MOTO' },
    { addr:'bc1p…cc4f', side:'purple', amount:'1,500 $MOTO' },
  ]);
  const [betSide,   setBetSide]   = useState<SideChoice>('orange');
  const [betAmount, setBetAmount] = useState(500);
  const [specCount, setSpecCount] = useState(12);

  // Stats
  const [stats, setStats] = useState({ totalGames: 47n, tipJarTotal: 3210n, lpPoolTotal: 84200n });

  // Countdown
  const [nextDistribution, setNextDistribution] = useState('5d 14h');

  // Ripple canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ── Effects ────────────────────────────────────────────────────────────────

  // Show winner modal when game ends
  useEffect(() => {
    if (state.gameOver && state.gameResult) {
      setShowWinner(true);
      // If on-chain game: auto-call endGame
      if (activeGameId !== null && opnet.isConnected) {
        opnet.endGame(activeGameId, state.gameResult.winCode, state.gameResult.reason)
          .then(txid => toast(`✅ Game ended on-chain: ${txid.slice(0,12)}…`))
          .catch(err => toast(`⚠ endGame failed: ${err.message}`));
      }
    }
  }, [state.gameOver, state.gameResult]);

  // AI auto-move
  useEffect(() => {
    if (gameMode !== 'ai' || state.gameOver) return;
    const aiColor: Color = playerSide === 'orange' ? 'b' : 'w';
    if (state.turn === aiColor) {
      const t = setTimeout(aiMove, 600);
      return () => clearTimeout(t);
    }
  }, [state.turn, gameMode, playerSide, state.gameOver, aiMove]);

  // Commit move on-chain when a move is made
  useEffect(() => {
    if (!opnet.isConnected || activeGameId === null || !state.moveHistory.length) return;
    const last = state.moveHistory[state.moveHistory.length - 1];
    const idx  = state.moveHistory.length - 1;
    opnet.commitMove(activeGameId, last.notation, idx)
      .then(txid => toast(`⛓ Move ${last.notation} committed: ${txid.slice(0,10)}…`))
      .catch(() => {}); // silent fail - move is local even if broadcast fails
  }, [state.moveHistory.length]);

  // Countdown timer
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const day = now.getDay();
      const dUntilFri = (5 - day + 7) % 7 || 7;
      const fri = new Date(now);
      fri.setDate(now.getDate() + dUntilFri);
      fri.setHours(20, 0, 0, 0);
      const diff = fri.getTime() - now.getTime();
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      setNextDistribution(`${d}d ${h}h`);
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, []);

  // Spectator count wobble
  useEffect(() => {
    const id = setInterval(() => {
      setSpecCount(n => Math.max(8, n + (Math.random() > 0.6 ? 1 : -1)));
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // Fetch on-chain stats on mount & when network changes
  useEffect(() => {
    opnet.getStats().then(setStats).catch(() => {});
  }, [opnet.network]);

  // Ripple WebGL background
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    initRipple(canvas);
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const toast = useCallback((msg: string) => {
    setTxToast(msg);
    setTimeout(() => setTxToast(null), 4000);
  }, []);

  const fmt = (n: bigint | number) => Number(n).toLocaleString();

  const playerColor: Color = playerSide === 'orange' ? 'w' : 'b';

  // ── Lobby actions ──────────────────────────────────────────────────────────

  const startGame = useCallback(async () => {
    reset(600);
    setShowLobby(false);
    setShowWinner(false);
    setActiveGameId(null);

    if (opnet.isConnected) {
      try {
        const txid = await opnet.createGame('', token, BigInt(wager));
        toast(`🎮 Game created on-chain! TX: ${txid.slice(0,12)}…`);
        // In production: poll for the transaction to confirm and extract gameId from event
        // For now use a demo gameId
        setActiveGameId(1n);
        setStats(s => ({
          ...s,
          totalGames:  s.totalGames + 1n,
          tipJarTotal: s.tipJarTotal + BigInt(Math.floor(wager * 0.1)),
          lpPoolTotal: s.lpPoolTotal + BigInt(Math.floor(wager * 0.9)),
        }));
      } catch (e: unknown) {
        toast(`⚠ createGame: ${(e as Error).message}`);
      }
    }

    if (gameMode === 'ai' && playerSide === 'purple') {
      setTimeout(aiMove, 800);
    }
  }, [opnet, token, wager, gameMode, playerSide, reset, aiMove, toast]);

  // ── Bet ────────────────────────────────────────────────────────────────────

  const placeBet = useCallback(async () => {
    setBets(prev => [
      { addr: opnet.address ?? 'You', side: betSide, amount: `${betAmount.toLocaleString()} $${token}` },
      ...prev.slice(0, 5),
    ]);
    if (opnet.isConnected && activeGameId !== null) {
      try {
        const txid = await opnet.placeBet(activeGameId, betSide === 'orange' ? 'w' : 'b', BigInt(betAmount), token);
        toast(`✅ Bet placed on-chain: ${txid.slice(0,10)}…`);
      } catch (e: unknown) {
        toast(`⚠ placeBet: ${(e as Error).message}`);
      }
    } else {
      toast(`✓ Bet placed (demo): ${betAmount.toLocaleString()} $${token} on ${betSide}`);
    }
  }, [opnet, activeGameId, betSide, betAmount, token, toast]);

  // ── Tip ────────────────────────────────────────────────────────────────────

  const sendTip = useCallback(async () => {
    const amt = parseInt(prompt('Tip amount ($MOTO):', '100') ?? '0');
    if (!amt || isNaN(amt)) return;
    if (opnet.isConnected) {
      try {
        const txid = await opnet.sendTip(BigInt(amt), 'MOTO');
        toast(`💛 Tip sent on-chain: ${txid.slice(0,10)}…`);
      } catch (e: unknown) {
        toast(`⚠ sendTip: ${(e as Error).message}`);
      }
    }
    setStats(s => ({ ...s, tipJarTotal: s.tipJarTotal + BigInt(amt) }));
    toast(`💛 Tip sent: ${amt.toLocaleString()} $MOTO`);
  }, [opnet, toast]);

  // ── Render board ───────────────────────────────────────────────────────────

  const renderBoard = () => {
    const rows = [];
    for (let ri = 0; ri < 8; ri++) {
      const r = state.boardFlipped ? 7 - ri : ri;
      for (let ci = 0; ci < 8; ci++) {
        const c = state.boardFlipped ? 7 - ci : ci;
        const piece = state.board[r][c];
        const isLight = (r + c) % 2 === 0;
        const isSelected = state.selectedSq?.[0] === r && state.selectedSq?.[1] === c;
        const isLegal = state.legalMoves.some(([nr,nc]) => nr===r && nc===c);
        const isLastMove = state.lastMove &&
          ((state.lastMove.from[0]===r && state.lastMove.from[1]===c) ||
           (state.lastMove.to[0]===r   && state.lastMove.to[1]===c));
        const isInCheckSq = state.inCheck && piece === (state.turn + 'K' as PieceCode);

        let cls = `sq ${isLight ? 'light' : 'dark'}`;
        if (isSelected)  cls += ' selected';
        if (isLegal)     cls += ' legal' + (piece ? ' has-piece' : '');
        if (isLastMove)  cls += ' last-move';
        if (isInCheckSq) cls += ' in-check';

        rows.push(
          <div key={`${r}-${c}`} className={cls} onClick={() => handleSquareClick(r, c, gameMode === 'ai' ? playerColor : null)}>
            {piece && (
              <div className={`piece ${piece[0] === 'w' ? 'white' : 'black'}`} title={PIECES[piece]?.label}>
                {PIECES[piece]?.emoji ?? '?'}
              </div>
            )}
          </div>
        );
      }
    }
    return rows;
  };

  const rankLabels = Array.from({length: 8}, (_, i) => {
    const r = state.boardFlipped ? i : 7 - i;
    return <div key={i} className="coord" style={{height:'68px',display:'flex',alignItems:'center',justifyContent:'center',width:'18px'}}>{r+1}</div>;
  });

  const fileLabels = Array.from({length: 8}, (_, i) => {
    const c = state.boardFlipped ? 7 - i : i;
    return <div key={i} className="coord" style={{width:'68px',textAlign:'center'}}>{FILES[c]}</div>;
  });

  const fmtTimer = (secs: number) => `${String(Math.floor(secs/60)).padStart(2,'0')}:${String(secs%60).padStart(2,'0')}`;

  const lpCut    = Math.floor(wager * 0.9);
  const creatorCut = Math.floor(wager * 0.1);

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <>
      <canvas ref={canvasRef} id="rippleCanvas" />

      {/* ── HEADER ── */}
      <header>
        <div>
          <div className="logo-text">♟ OP_NET Chess</div>
          <div className="logo-sub">Bitcoin L1 · Wagered Chess</div>
        </div>
        <div className="header-r">
          {/* Network switcher */}
          <select
            className="net-select"
            value={opnet.network}
            onChange={e => opnet.switchNetwork(e.target.value as NetworkName)}
          >
            <option value="testnet">🔵 Testnet</option>
            <option value="mainnet">🟠 Mainnet</option>
          </select>
          <div className="net-badge">
            <div className="net-dot" />
            {opnet.network === 'mainnet' ? 'Bitcoin Mainnet' : 'OP_NET Testnet'}
          </div>
          <button className="btn" onClick={() => setShowLobby(true)}>👁 Watch</button>
          <button
            className={`btn ${opnet.isConnected ? 'connected' : ''}`}
            onClick={() => {
              if (!opnet.isConnected) opnet.connectWallet().catch(e => toast(e.message));
            }}
            disabled={opnet.connecting}
          >
            {opnet.connecting ? 'Connecting…' : opnet.isConnected ? opnet.address!.slice(0,12)+'…' : 'Connect Wallet'}
          </button>
        </div>
      </header>

      {/* ── MAIN LAYOUT ── */}
      <div className="app">

        {/* ── LEFT PANEL ── */}
        <div className="left-col">

          {/* Prize Pool */}
          <div className="panel">
            <div className="panel-title">Prize Pool</div>
            <div className="panel-desc">Funded by entry fees. Winner claims weekly.</div>
            <div className="lp-stat"><span className="lp-label">Total LP</span><span className="lp-value">{fmt(stats.lpPoolTotal)} $MOTO</span></div>
            <div className="lp-stat"><span className="lp-label">Games This Week</span><span className="lp-value">{fmt(stats.totalGames)}</span></div>
            <div className="lp-stat"><span className="lp-label">Next Distribution</span><span className="lp-value green">{nextDistribution}</span></div>
            <div className="lp-stat"><span className="lp-label">Creator Tip Jar</span><span className="lp-value orange">{fmt(stats.tipJarTotal)} $MOTO</span></div>
          </div>

          {/* Join Game */}
          <div className="panel">
            <div className="panel-title">Join Game</div>
            <div className="panel-desc">Choose token & wager to enter</div>
            <div className="lobby-section-title">Entry Token</div>
            <div className="token-choice">
              <button className={`token-btn ${token === 'MOTO' ? 'active' : ''}`} onClick={() => setToken('MOTO')}>
                <span className="t-icon">🏍</span>$MOTO
              </button>
              <button className={`token-btn ${token === 'PILL' ? 'active' : ''}`} onClick={() => setToken('PILL')}>
                <span className="t-icon">🟠</span>$PILL
              </button>
            </div>
            <div className="lobby-section-title" style={{marginTop:'.6rem'}}>Wager Amount</div>
            <input
              className="entry-input" type="number" value={wager} min={100}
              onChange={e => setWager(parseInt(e.target.value) || 1000)}
            />
            <div className="fee-row"><span>LP (90%)</span><span>{lpCut.toLocaleString()} {token}</span></div>
            <div className="fee-row" style={{paddingTop:0}}><span>Creator (10%)</span><span>{creatorCut.toLocaleString()} {token}</span></div>
            <div className="divider" />
            <div className="lobby-section-title">Mode</div>
            <div className="mode-grid">
              <button className={`mode-btn ${gameMode === 'human' ? 'active' : ''}`} onClick={() => setGameMode('human')}>
                <span className="m-icon">🧑‍🤝‍🧑</span>vs Human
              </button>
              <button className={`mode-btn ${gameMode === 'ai' ? 'active' : ''}`} onClick={() => setGameMode('ai')}>
                <span className="m-icon">🤖</span>vs AI
              </button>
            </div>
            <button className="btn-xl" style={{marginTop:'.8rem',fontSize:'1rem',padding:'10px'}} onClick={() => setShowLobby(true)}>
              <span className="shimmer" />⚔ Enter Match
            </button>
          </div>

          {/* Tip Jar */}
          <div className="panel">
            <div className="tip-jar">
              <div className="tip-jar-icon">🫙</div>
              <div className="tip-jar-total">{fmt(stats.tipJarTotal)}</div>
              <div className="tip-jar-label">Creator Tip Jar ($MOTO)</div>
            </div>
            <button className="btn" style={{width:'100%',marginTop:'.6rem',fontSize:'.62rem'}} onClick={sendTip}>
              + Send Tip
            </button>
          </div>
        </div>

        {/* ── CENTRE: BOARD ── */}
        <div className="game-area">

          {/* Top player bar (black / purple) */}
          <div className="player-bar">
            <div className="player-info">
              <div className={`turn-indicator ${state.turn === 'b' ? 'active' : 'inactive'}`} />
              <div className="player-avatar purple-side">🐱</div>
              <div>
                <div className="player-name" style={{color:'var(--purple-l)'}}>
                  {playerSide === 'purple' ? (opnet.isConnected ? opnet.address!.slice(0,14)+'…' : 'You (OP_NET)') : (gameMode === 'ai' ? '🤖 AI Engine' : 'Opponent (OP_NET)')}
                </div>
                <div className="player-score">Captured: {state.capturedByB.map(p => PIECES[p]?.emoji).join('')}</div>
              </div>
            </div>
            <div className={`timer ${state.timerB < 60 ? 'low' : ''}`}>{fmtTimer(state.timerB)}</div>
          </div>

          {/* Board */}
          <div className="board-wrap">
            <div style={{display:'flex',gap:0}}>
              <div className="coord-col">{rankLabels}</div>
              <div>
                <div className="board-grid">{renderBoard()}</div>
                <div className="coord-row" style={{width:'100%'}}>{fileLabels}</div>
              </div>
            </div>
          </div>

          {/* Bottom player bar (white / orange) */}
          <div className="player-bar">
            <div className="player-info">
              <div className={`turn-indicator ${state.turn === 'w' ? 'active' : 'inactive'}`} />
              <div className="player-avatar orange-side">🏍</div>
              <div>
                <div className="player-name" style={{color:'var(--orange)'}}>
                  {playerSide === 'orange' ? (opnet.isConnected ? opnet.address!.slice(0,14)+'…' : 'You (Orange)') : (gameMode === 'ai' ? '🤖 AI Engine' : 'Opponent (Orange)')}
                </div>
                <div className="player-score">Captured: {state.capturedByW.map(p => PIECES[p]?.emoji).join('')}</div>
              </div>
            </div>
            <div className={`timer ${state.timerW < 60 ? 'low' : ''}`}>{fmtTimer(state.timerW)}</div>
          </div>

          {/* Status bar */}
          <div className="status-bar">
            <span className="status-icon">{state.inCheck ? '⚡' : '⚔'}</span>
            <span className="status-text" dangerouslySetInnerHTML={{__html:
              state.inCheck
                ? `⚡ <strong>${state.turn === 'w' ? 'Orange' : 'Purple'}</strong> is in CHECK!`
                : `<strong>${state.turn === 'w' ? 'Orange (Motoswap)' : 'Purple (OP_NET)'}</strong> to move`
            }} />
            {activeGameId !== null && (
              <span style={{marginLeft:'auto',fontSize:'.6rem',color:'var(--success)'}}>
                ⛓ Game #{activeGameId.toString()} on-chain
              </span>
            )}
          </div>

          {/* Controls */}
          <div style={{display:'flex',gap:'.5rem',flexWrap:'wrap'}}>
            <button className="btn" onClick={undoMove} disabled={state.gameOver || !state.moveHistory.length}>↩ Undo</button>
            <button className="btn purple" onClick={() => { if(window.confirm('Offer a draw?')) offerDraw(); }}>⚖ Draw</button>
            <button className="btn" style={{borderColor:'var(--ember)',color:'var(--ember)'}} onClick={() => resign(playerColor)}>🏳 Resign</button>
            <button className="btn purple" onClick={flipBoard}>↕ Flip</button>
            <button className="btn" style={{marginLeft:'auto'}} onClick={() => setShowLobby(true)}>⚔ New Game</button>
          </div>
        </div>

        {/* ── RIGHT PANEL ── */}
        <div className="right-col">

          {/* Move history */}
          <div className="panel">
            <div className="panel-title">Move History</div>
            <div className="move-list">
              {!state.moveHistory.length
                ? <div style={{fontSize:'.62rem',color:'var(--muted)',padding:'.5rem 0'}}>No moves yet</div>
                : (() => {
                    const rows = [];
                    for (let i = 0; i < state.moveHistory.length; i += 2) {
                      const w = state.moveHistory[i];
                      const b = state.moveHistory[i+1];
                      rows.push(
                        <div key={i} className="move-row">
                          <span className="move-num">{Math.floor(i/2)+1}.</span>
                          <span className="move-w">{w.notation}</span>
                          <span className="move-b">{b?.notation ?? ''}</span>
                        </div>
                      );
                    }
                    return rows;
                  })()
              }
            </div>
          </div>

          {/* Captured pieces */}
          <div className="panel" style={{padding:'.8rem 1.2rem'}}>
            <div className="panel-title" style={{fontSize:'.9rem'}}>Captured</div>
            <div style={{fontSize:'.58rem',color:'var(--muted)',marginBottom:'3px'}}>🟠 Orange took:</div>
            <div className="captured-row">{state.capturedByW.map((p,i) => <span key={i} className="cap-piece">{PIECES[p]?.emoji}</span>)}</div>
            <div style={{fontSize:'.58rem',color:'var(--muted)',marginBottom:'3px'}}>🟣 Purple took:</div>
            <div className="captured-row">{state.capturedByB.map((p,i) => <span key={i} className="cap-piece">{PIECES[p]?.emoji}</span>)}</div>
          </div>

          {/* Live bets */}
          <div className="panel">
            <div className="panel-title">Live Bets</div>
            <div className="spec-count"><div className="spec-dot" /><span>{specCount} watching</span></div>
            {bets.map((b, i) => (
              <div key={i} className="bet-row">
                <span className="bet-addr">{b.addr}</span>
                <span className={`bet-side ${b.side}`}>{b.side === 'orange' ? '🏍' : '🐱'} {b.side}</span>
                <span className="bet-amount">{b.amount}</span>
              </div>
            ))}
            <div className="divider" />
            <div className="lobby-section-title">Place Bet</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'.4rem',marginBottom:'.4rem'}}>
              <button className={`token-btn ${betSide === 'orange' ? 'active' : ''}`} onClick={() => setBetSide('orange')} style={{fontSize:'.6rem',padding:'.5rem'}}>🏍 Orange</button>
              <button className={`token-btn ${betSide === 'purple' ? 'active' : ''}`} onClick={() => setBetSide('purple')} style={{fontSize:'.6rem',padding:'.5rem'}}>🐱 Purple</button>
            </div>
            <input className="entry-input" type="number" value={betAmount} onChange={e => setBetAmount(parseInt(e.target.value)||500)} style={{fontSize:'.72rem',padding:'.4rem .6rem'}}/>
            <button className="btn" style={{width:'100%',marginTop:'.5rem',fontSize:'.6rem'}} onClick={placeBet}>Place Bet</button>
          </div>
        </div>
      </div>

      {/* ── LOBBY OVERLAY ── */}
      {showLobby && (
        <div className="overlay">
          <div className="lobby">
            <div className="lobby-title">♟ Enter the Arena</div>
            <div className="lobby-sub">Bitcoin L1 wagered chess · OP_NET ecosystem pieces</div>

            <div className="lobby-section">
              <div className="lobby-section-title">Choose Your Side</div>
              <div className="side-pick">
                <div className={`side-card ${playerSide === 'orange' ? 'active' : ''}`} onClick={() => setPlayerSide('orange')}>
                  <div className="side-icon">🏍</div>
                  <div className="side-name" style={{color:'var(--orange)'}}>Orange Army</div>
                  <div className="side-desc">Motoswap · $MOTO · $PILL</div>
                </div>
                <div className="vs-badge">VS</div>
                <div className={`side-card purple-card ${playerSide === 'purple' ? 'active' : ''}`} onClick={() => setPlayerSide('purple')}>
                  <div className="side-icon">🐱</div>
                  <div className="side-name" style={{color:'var(--purple-l)'}}>OP_NET Army</div>
                  <div className="side-desc">Motocats · Nodes · Bitcoin</div>
                </div>
              </div>
            </div>

            <div className="lobby-section">
              <div className="lobby-section-title">Game Mode</div>
              <div className="mode-grid">
                <button className={`mode-btn ${gameMode === 'human' ? 'active' : ''}`} onClick={() => setGameMode('human')}>
                  <span className="m-icon">🧑‍🤝‍🧑</span>vs Human<br/><span style={{fontSize:'.55rem',color:'var(--muted)'}}>Wait for opponent</span>
                </button>
                <button className={`mode-btn ${gameMode === 'ai' ? 'active' : ''}`} onClick={() => setGameMode('ai')}>
                  <span className="m-icon">🤖</span>vs AI<br/><span style={{fontSize:'.55rem',color:'var(--muted)'}}>Play instantly</span>
                </button>
              </div>
            </div>

            <div className="lobby-section">
              <div className="lobby-section-title">Entry Wager</div>
              <div className="token-choice">
                <button className={`token-btn ${token === 'MOTO' ? 'active' : ''}`} onClick={() => setToken('MOTO')}><span className="t-icon">🏍</span>$MOTO</button>
                <button className={`token-btn ${token === 'PILL' ? 'active' : ''}`} onClick={() => setToken('PILL')}><span className="t-icon">🟠</span>$PILL</button>
              </div>
              <input className="entry-input" type="number" value={wager} min={100} onChange={e => setWager(parseInt(e.target.value)||1000)} />
            </div>

            <div className="lobby-summary">
              <div className="lobby-summary-row"><span>Your wager</span><span>{wager.toLocaleString()} ${token}</span></div>
              <div className="lobby-summary-row"><span>LP (90%)</span><span>{Math.floor(wager*.9).toLocaleString()} goes to prize pool</span></div>
              <div className="lobby-summary-row"><span>Creator (10%)</span><span>{Math.floor(wager*.1).toLocaleString()} to tip jar</span></div>
              <div className="lobby-summary-row"><span>Potential win</span><span style={{color:'var(--success)'}}>~{Math.floor(wager*1.8).toLocaleString()} ${token}</span></div>
            </div>

            {!opnet.isConnected && (
              <div style={{background:'rgba(249,115,22,.08)',border:'1px solid rgba(249,115,22,.3)',padding:'.7rem',fontSize:'.62rem',color:'var(--orange)',marginTop:'.6rem',textAlign:'center'}}>
                ⚠ Connect your wallet to play on-chain. UniSat or Wizz required.
              </div>
            )}

            <button className="btn-xl" onClick={startGame}>
              <span className="shimmer" />⚔ &nbsp;Enter Match &amp; Lock Wager
            </button>
            <button className="btn" style={{width:'100%',marginTop:'.5rem',fontSize:'.62rem',borderColor:'var(--muted)',color:'var(--muted)'}} onClick={() => setShowLobby(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── WINNER OVERLAY ── */}
      {showWinner && state.gameResult && (
        <div className="overlay">
          <div className="lobby winner-modal">
            <div className="winner-crown">{state.gameResult.winCode === 'd' ? '⚖' : state.gameResult.winCode === 'w' ? '🏍' : '🐱'}</div>
            <div className="winner-title">{state.gameResult.winCode === 'd' ? 'DRAW!' : 'VICTORY!'}</div>
            <div className="winner-sub">
              {state.gameResult.winCode === 'd'
                ? `Match ends in a draw — ${state.gameResult.reason}`
                : `${state.gameResult.winner} wins by ${state.gameResult.reason}!`}
            </div>
            <div className="prize-box">
              <div className="prize-amount">+{Math.floor(wager * 1.8).toLocaleString()} ${token}</div>
              <div className="prize-label">Added to weekly prize pool — claim Friday</div>
            </div>
            <div style={{fontSize:'.62rem',color:'var(--muted)',marginBottom:'1rem'}}>
              Winnings accumulate in the LP and are distributed every Friday based on your win rate.
              {activeGameId !== null && ` Game #${activeGameId} recorded on Bitcoin L1.`}
            </div>
            <button className="btn-xl" onClick={() => { setShowWinner(false); setShowLobby(true); }}>
              <span className="shimmer" />Play Again
            </button>
          </div>
        </div>
      )}

      {/* ── TOAST ── */}
      {txToast && (
        <div className="toast">{txToast}</div>
      )}
    </>
  );
}

// ─── WebGL Ripple background (ported from original) ───────────────────────────
function initRipple(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') as WebGLRenderingContext | null;
  if (!gl) return;

  const VS = `attribute vec2 a_pos;void main(){gl_Position=vec4(a_pos,0.0,1.0);}`;
  const FS = `
    precision highp float;
    uniform vec2 u_res;uniform float u_time;uniform vec3 u_drops[12];
    float ripple(vec2 uv,vec2 center,float born){
      float age=u_time-born;float dist=length(uv-center);
      float wave=sin(dist*18.0-age*4.5)*exp(-dist*2.2)*exp(-age*0.5);
      float mask=smoothstep(age*280.0,0.0,dist);return wave*mask*0.5;
    }
    void main(){
      vec2 uv=gl_FragCoord.xy/u_res;vec2 aspect=vec2(u_res.x/u_res.y,1.0);
      vec2 uvA=uv*aspect;float h=0.0;
      for(int i=0;i<12;i++){if(u_drops[i].z<0.0)continue;
        vec2 c=(u_drops[i].xy/u_res)*aspect;h+=ripple(uvA,c,u_drops[i].z);}
      float swirl=sin(uv.x*3.1+u_time*0.18)*0.5+cos(uv.y*2.7-u_time*0.13)*0.5;
      h+=swirl*0.04;
      vec3 deep=vec3(0.027,0.016,0.075);vec3 mid=vec3(0.12,0.05,0.32);
      vec3 bright=vec3(0.45,0.18,0.85);vec3 sheen=vec3(0.78,0.42,1.00);
      float t=clamp(h+0.5,0.0,1.0);
      vec3 col=mix(deep,mid,smoothstep(0.0,0.45,t));
      col=mix(col,bright,smoothstep(0.45,0.7,t));
      col=mix(col,sheen,smoothstep(0.7,1.0,t)*0.6);
      float fromCentre=1.0-length((uv-vec2(0.5,0.6))*vec2(1.0,0.7));
      col+=vec3(0.18,0.05,0.0)*pow(clamp(fromCentre,0.0,1.0),3.0)*0.4;
      gl_FragColor=vec4(col,1.0);
    }`;

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s); return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog); gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);

  const uRes   = gl.getUniformLocation(prog, 'u_res');
  const uTime  = gl.getUniformLocation(prog, 'u_time');
  const uDrops = gl.getUniformLocation(prog, 'u_drops[0]');

  const drops: [number,number,number][] = Array.from({length:12}, () => [0,0,-99]);
  let dropIdx = 0;
  const spawnDrop = (x: number, y: number) => { drops[dropIdx % 12] = [x, y, performance.now()/1000]; dropIdx++; };

  const ambient = () => {
    spawnDrop(Math.random()*canvas.width, Math.random()*canvas.height);
    setTimeout(ambient, 4000 + Math.random()*3000);
  };
  ambient();

  window.addEventListener('click', e => spawnDrop(e.clientX, e.clientY));
  window.addEventListener('touchstart', e => { const t = e.touches[0]; spawnDrop(t.clientX, t.clientY); }, {passive:true});

  const resize = () => { canvas.width=window.innerWidth; canvas.height=window.innerHeight; gl.viewport(0,0,canvas.width,canvas.height); };
  resize(); window.addEventListener('resize', resize);

  const render = () => {
    const t = performance.now()/1000;
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, t);
    gl.uniform3fv(uDrops, new Float32Array(drops.flat()));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(render);
  };
  render();

  setTimeout(() => spawnDrop(canvas.width*.3, canvas.height*.4), 100);
  setTimeout(() => spawnDrop(canvas.width*.7, canvas.height*.6), 600);
  setTimeout(() => spawnDrop(canvas.width*.5, canvas.height*.3), 1100);
}
