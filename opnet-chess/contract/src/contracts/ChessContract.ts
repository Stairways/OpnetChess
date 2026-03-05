/**
 * OP_NET Chess Contract — AssemblyScript
 * ═══════════════════════════════════════════════════════════════════════
 * Written against the REAL @btc-vision/btc-runtime API as verified from:
 *   https://github.com/btc-vision/btc-runtime
 *   https://github.com/btc-vision/example-contracts
 *
 * CORRECTIONS from previous version:
 *  ✅ callMethod(method, calldata) instead of execute(calldata)
 *  ✅ NetEvent takes BytesWriter in super(), not get data(): u8[]
 *  ✅ Blockchain.getStorageAt / setStorageAt with u16 pointer + Uint8Array sub-pointer
 *  ✅ No StorageSlot.at() — that does not exist in the real API
 *  ✅ Blockchain.tx.sender for caller address
 *  ✅ BytesWriter.writeStringWithLength, writeBoolean, writeU256, writeU32, writeU8
 *  ✅ Calldata.readString, readU256, readU32, readAddress
 *  ✅ u256.fromU32(), u256.fromU64(), u256.fromUint8ArrayLE()
 *  ✅ encodeSelector('methodName(paramTypes)') — real selector encoding
 *
 * Storage layout (u16 pointer → Uint8Array sub-pointer from u256.toUint8Array()):
 *   0x01  gameCounter          [zero sub-pointer]
 *   0x10  game.white           [gameId]
 *   0x11  game.black           [gameId]
 *   0x12  game.wager           [gameId]
 *   0x13  game.token           [gameId]
 *   0x14  game.status          [gameId]  0=pending 1=active 2=ended
 *   0x15  game.winner          [gameId]  'w'|'b'|'d'|''
 *   0x16  game.moveCount       [gameId]
 *   0x20  move notation        [gameId XOR u256.fromU32(moveIndex)]
 *   0x30  bet amount           [betKey(gameId, addr)]
 *   0x31  bet side             [betKey(gameId, addr)]
 *   0x40  tipJarTotal          [zero]
 *   0x50  lpPoolTotal          [zero]
 */

import {
    Address,
    Blockchain,
    BytesWriter,
    Calldata,
    NetEvent,
    OP_NET,
    Selector,
    encodeSelector,
    U256_BYTE_LENGTH,
    BOOLEAN_BYTE_LENGTH,
} from '@btc-vision/btc-runtime/runtime';
import { u256 } from 'as-bignum/assembly';

// ── Fee constants ─────────────────────────────────────────────────────────────
const CREATOR_FEE_BPS: u32 = 1000;  // 10% to tip jar
const LP_SHARE_BPS:    u32 = 9000;  // 90% to prize pool
const BPS_DENOM:       u32 = 10000;

// ── Storage pointer roots (u16) ───────────────────────────────────────────────
const PTR_GAME_COUNTER: u16 = 0x01;
const PTR_GAME_WHITE:   u16 = 0x10;
const PTR_GAME_BLACK:   u16 = 0x11;
const PTR_GAME_WAGER:   u16 = 0x12;
const PTR_GAME_TOKEN:   u16 = 0x13;
const PTR_GAME_STATUS:  u16 = 0x14;
const PTR_GAME_WINNER:  u16 = 0x15;
const PTR_GAME_MOVES:   u16 = 0x16;
const PTR_MOVE_DATA:    u16 = 0x20;
const PTR_BET_AMOUNT:   u16 = 0x30;
const PTR_BET_SIDE:     u16 = 0x31;
const PTR_TIP_JAR:      u16 = 0x40;
const PTR_LP_POOL:      u16 = 0x50;

// ── Game status values ────────────────────────────────────────────────────────
const STATUS_PENDING: u8 = 0;
const STATUS_ACTIVE:  u8 = 1;
const STATUS_ENDED:   u8 = 2;

// ── Events ────────────────────────────────────────────────────────────────────
// Pattern from real btc-runtime: pass BytesWriter to super('EventName', writer)

class GameCreatedEvent extends NetEvent {
    constructor(gameId: u256, white: string, black: string, wager: u256, token: string) {
        const writer = new BytesWriter(U256_BYTE_LENGTH + 4 + white.length + 4 + black.length + U256_BYTE_LENGTH + 4 + token.length);
        writer.writeU256(gameId);
        writer.writeStringWithLength(white);
        writer.writeStringWithLength(black);
        writer.writeU256(wager);
        writer.writeStringWithLength(token);
        super('GameCreated', writer);
    }
}

class MoveCommittedEvent extends NetEvent {
    constructor(gameId: u256, player: string, notation: string, moveIndex: u32) {
        const writer = new BytesWriter(U256_BYTE_LENGTH + 4 + player.length + 4 + notation.length + 4);
        writer.writeU256(gameId);
        writer.writeStringWithLength(player);
        writer.writeStringWithLength(notation);
        writer.writeU32(moveIndex);
        super('MoveCommitted', writer);
    }
}

class GameEndedEvent extends NetEvent {
    constructor(gameId: u256, winner: string, reason: string, payout: u256) {
        const writer = new BytesWriter(U256_BYTE_LENGTH + 4 + winner.length + 4 + reason.length + U256_BYTE_LENGTH);
        writer.writeU256(gameId);
        writer.writeStringWithLength(winner);
        writer.writeStringWithLength(reason);
        writer.writeU256(payout);
        super('GameEnded', writer);
    }
}

class BetPlacedEvent extends NetEvent {
    constructor(gameId: u256, bettor: string, side: string, amount: u256, token: string) {
        const writer = new BytesWriter(U256_BYTE_LENGTH + 4 + bettor.length + 4 + side.length + U256_BYTE_LENGTH + 4 + token.length);
        writer.writeU256(gameId);
        writer.writeStringWithLength(bettor);
        writer.writeStringWithLength(side);
        writer.writeU256(amount);
        writer.writeStringWithLength(token);
        super('BetPlaced', writer);
    }
}

class TipSentEvent extends NetEvent {
    constructor(from: string, amount: u256, token: string) {
        const writer = new BytesWriter(4 + from.length + U256_BYTE_LENGTH + 4 + token.length);
        writer.writeStringWithLength(from);
        writer.writeU256(amount);
        writer.writeStringWithLength(token);
        super('TipSent', writer);
    }
}

// ── Contract ──────────────────────────────────────────────────────────────────

@final
export class ChessContract extends OP_NET {

    // Selectors — must match exactly how callers encode them
    private readonly SEL_CREATE_GAME: Selector = encodeSelector('createGame(string,string,uint256)');
    private readonly SEL_JOIN_GAME:   Selector = encodeSelector('joinGame(uint256)');
    private readonly SEL_COMMIT_MOVE: Selector = encodeSelector('commitMove(uint256,string,uint32)');
    private readonly SEL_END_GAME:    Selector = encodeSelector('endGame(uint256,string,string)');
    private readonly SEL_PLACE_BET:   Selector = encodeSelector('placeBet(uint256,string,uint256,string)');
    private readonly SEL_CLAIM_BET:   Selector = encodeSelector('claimBet(uint256)');
    private readonly SEL_SEND_TIP:    Selector = encodeSelector('sendTip(uint256,string)');
    private readonly SEL_GET_GAME:    Selector = encodeSelector('getGame(uint256)');
    private readonly SEL_GET_MOVES:   Selector = encodeSelector('getMoves(uint256)');
    private readonly SEL_GET_STATS:   Selector = encodeSelector('getStats()');

    public constructor() {
        super();
        // ⚠️ Runs on EVERY interaction — do NOT initialize state here
    }

    // ── One-time initialization (solidity-like constructor) ──────────────────
    public override onDeployment(_calldata: Calldata): void {
        this._setU256Global(PTR_GAME_COUNTER, u256.Zero);
        this._setU256Global(PTR_TIP_JAR,      u256.Zero);
        this._setU256Global(PTR_LP_POOL,       u256.Zero);
    }

    // ── Method dispatcher (real API uses callMethod, not execute) ────────────
    public override callMethod(method: Selector, calldata: Calldata): BytesWriter {
        switch (method) {
            case this.SEL_CREATE_GAME: return this._createGame(calldata);
            case this.SEL_JOIN_GAME:   return this._joinGame(calldata);
            case this.SEL_COMMIT_MOVE: return this._commitMove(calldata);
            case this.SEL_END_GAME:    return this._endGame(calldata);
            case this.SEL_PLACE_BET:   return this._placeBet(calldata);
            case this.SEL_CLAIM_BET:   return this._claimBet(calldata);
            case this.SEL_SEND_TIP:    return this._sendTip(calldata);
            case this.SEL_GET_GAME:    return this._getGame(calldata);
            case this.SEL_GET_MOVES:   return this._getMoves(calldata);
            case this.SEL_GET_STATS:   return this._getStats();
            default:                   return super.callMethod(method, calldata);
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  createGame(black: string, token: string, wager: u256) → gameId: u256
    // ════════════════════════════════════════════════════════════════════════
    private _createGame(calldata: Calldata): BytesWriter {
        const caller: Address = Blockchain.tx.sender;
        const black:  string  = calldata.readString();
        const token:  string  = calldata.readString();
        const wager:  u256    = calldata.readU256();

        assert(wager > u256.Zero, 'Wager must be positive');

        const gameId:      u256 = this._incrementCounter();
        const creatorFee:  u256 = this._bpsMul(wager, CREATOR_FEE_BPS);
        const lpAmount:    u256 = wager - creatorFee;

        this._setStr(PTR_GAME_WHITE,  gameId, caller.toString());
        this._setStr(PTR_GAME_BLACK,  gameId, black);
        this._setStr(PTR_GAME_TOKEN,  gameId, token);
        this._setStr(PTR_GAME_WINNER, gameId, '');
        this._setU256(PTR_GAME_WAGER, gameId, wager);
        this._setU8(PTR_GAME_STATUS,  gameId, STATUS_PENDING);
        this._setU32(PTR_GAME_MOVES,  gameId, 0);

        this._addU256Global(PTR_TIP_JAR, creatorFee);
        this._addU256Global(PTR_LP_POOL, lpAmount);

        this.emitEvent(new GameCreatedEvent(gameId, caller.toString(), black, wager, token));

        const w = new BytesWriter(U256_BYTE_LENGTH);
        w.writeU256(gameId);
        return w;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  joinGame(gameId: u256) → ok: bool
    // ════════════════════════════════════════════════════════════════════════
    private _joinGame(calldata: Calldata): BytesWriter {
        const caller: Address = Blockchain.tx.sender;
        const gameId: u256    = calldata.readU256();

        assert(this._getU8(PTR_GAME_STATUS, gameId) == STATUS_PENDING, 'Game not pending');

        const savedBlack = this._getStr(PTR_GAME_BLACK, gameId);
        if (savedBlack.length > 0) {
            assert(savedBlack == caller.toString(), 'Not invited player');
        }

        this._setStr(PTR_GAME_BLACK, gameId, caller.toString());
        this._setU8(PTR_GAME_STATUS, gameId, STATUS_ACTIVE);

        const w = new BytesWriter(BOOLEAN_BYTE_LENGTH);
        w.writeBoolean(true);
        return w;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  commitMove(gameId, notation, moveIndex) → ok: bool
    // ════════════════════════════════════════════════════════════════════════
    private _commitMove(calldata: Calldata): BytesWriter {
        const caller:    Address = Blockchain.tx.sender;
        const gameId:    u256    = calldata.readU256();
        const notation:  string  = calldata.readString();
        const moveIndex: u32     = calldata.readU32();

        assert(notation.length >= 4 && notation.length <= 10, 'Invalid notation length');
        assert(this._getU8(PTR_GAME_STATUS, gameId) == STATUS_ACTIVE, 'Game not active');

        const white = this._getStr(PTR_GAME_WHITE, gameId);
        const black = this._getStr(PTR_GAME_BLACK, gameId);
        const addr  = caller.toString();
        assert(addr == white || addr == black, 'Not a player in this game');

        // White = even move indices, Black = odd
        if (addr == white) {
            assert(moveIndex % 2 == 0, 'Not whites turn');
        } else {
            assert(moveIndex % 2 == 1, 'Not blacks turn');
        }

        // Store move at sub-pointer = gameId XOR moveIndex
        const moveSub = gameId ^ u256.fromU32(moveIndex);
        this._setStrRaw(PTR_MOVE_DATA, moveSub, notation);

        const prev = this._getU32(PTR_GAME_MOVES, gameId);
        if (moveIndex + 1 > prev) {
            this._setU32(PTR_GAME_MOVES, gameId, moveIndex + 1);
        }

        this.emitEvent(new MoveCommittedEvent(gameId, addr, notation, moveIndex));

        const w = new BytesWriter(BOOLEAN_BYTE_LENGTH);
        w.writeBoolean(true);
        return w;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  endGame(gameId, winner, reason) → ok: bool
    // ════════════════════════════════════════════════════════════════════════
    private _endGame(calldata: Calldata): BytesWriter {
        const caller: Address = Blockchain.tx.sender;
        const gameId: u256    = calldata.readU256();
        const winner: string  = calldata.readString();
        const reason: string  = calldata.readString();

        assert(winner == 'w' || winner == 'b' || winner == 'd', 'Invalid winner');
        assert(this._getU8(PTR_GAME_STATUS, gameId) == STATUS_ACTIVE, 'Game not active');

        const white = this._getStr(PTR_GAME_WHITE, gameId);
        const black = this._getStr(PTR_GAME_BLACK, gameId);
        const addr  = caller.toString();
        assert(addr == white || addr == black, 'Not a player');

        this._setU8(PTR_GAME_STATUS,  gameId, STATUS_ENDED);
        this._setStr(PTR_GAME_WINNER, gameId, winner);

        const wager  = this._getU256(PTR_GAME_WAGER, gameId);
        const payout = this._bpsMul(wager, LP_SHARE_BPS);

        this.emitEvent(new GameEndedEvent(gameId, winner, reason, payout));

        const w = new BytesWriter(BOOLEAN_BYTE_LENGTH);
        w.writeBoolean(true);
        return w;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  placeBet(gameId, side, amount, token) → ok: bool
    // ════════════════════════════════════════════════════════════════════════
    private _placeBet(calldata: Calldata): BytesWriter {
        const caller: Address = Blockchain.tx.sender;
        const gameId: u256    = calldata.readU256();
        const side:   string  = calldata.readString();
        const amount: u256    = calldata.readU256();
        const token:  string  = calldata.readString();

        assert(side == 'w' || side == 'b', 'Invalid side');
        assert(amount > u256.Zero, 'Amount must be positive');
        assert(this._getU8(PTR_GAME_STATUS, gameId) == STATUS_ACTIVE, 'Game not active');

        const betKey = this._betKey(gameId, caller.toString());
        this._setU256Raw(PTR_BET_AMOUNT, betKey, amount);
        this._setStrRaw(PTR_BET_SIDE, betKey, side);

        this.emitEvent(new BetPlacedEvent(gameId, caller.toString(), side, amount, token));

        const w = new BytesWriter(BOOLEAN_BYTE_LENGTH);
        w.writeBoolean(true);
        return w;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  claimBet(gameId) → payout: u256
    // ════════════════════════════════════════════════════════════════════════
    private _claimBet(calldata: Calldata): BytesWriter {
        const caller: Address = Blockchain.tx.sender;
        const gameId: u256    = calldata.readU256();

        assert(this._getU8(PTR_GAME_STATUS, gameId) == STATUS_ENDED, 'Game not ended');

        const winner  = this._getStr(PTR_GAME_WINNER, gameId);
        const betKey  = this._betKey(gameId, caller.toString());
        const betSide = this._getStrRaw(PTR_BET_SIDE, betKey);
        const betAmt  = this._getU256Raw(PTR_BET_AMOUNT, betKey);

        assert(betAmt > u256.Zero, 'No bet found');
        assert(betSide == winner || winner == 'd', 'Losing side');

        // Zero out to prevent double-claim
        this._setU256Raw(PTR_BET_AMOUNT, betKey, u256.Zero);

        const w = new BytesWriter(U256_BYTE_LENGTH);
        w.writeU256(betAmt);
        return w;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  sendTip(amount, token) → ok: bool
    // ════════════════════════════════════════════════════════════════════════
    private _sendTip(calldata: Calldata): BytesWriter {
        const caller: Address = Blockchain.tx.sender;
        const amount: u256    = calldata.readU256();
        const token:  string  = calldata.readString();

        assert(amount > u256.Zero, 'Tip must be positive');

        this._addU256Global(PTR_TIP_JAR, amount);
        this.emitEvent(new TipSentEvent(caller.toString(), amount, token));

        const w = new BytesWriter(BOOLEAN_BYTE_LENGTH);
        w.writeBoolean(true);
        return w;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  getGame(gameId) → white, black, wager, token, status, winner, moveCount
    // ════════════════════════════════════════════════════════════════════════
    private _getGame(calldata: Calldata): BytesWriter {
        const gameId = calldata.readU256();

        const white  = this._getStr(PTR_GAME_WHITE,  gameId);
        const black  = this._getStr(PTR_GAME_BLACK,  gameId);
        const wager  = this._getU256(PTR_GAME_WAGER, gameId);
        const token  = this._getStr(PTR_GAME_TOKEN,  gameId);
        const status = this._getU8(PTR_GAME_STATUS,  gameId);
        const winner = this._getStr(PTR_GAME_WINNER, gameId);
        const moves  = this._getU32(PTR_GAME_MOVES,  gameId);

        const w = new BytesWriter(
            4 + white.length + 4 + black.length + U256_BYTE_LENGTH +
            4 + token.length + 1 + 4 + winner.length + 4
        );
        w.writeStringWithLength(white);
        w.writeStringWithLength(black);
        w.writeU256(wager);
        w.writeStringWithLength(token);
        w.writeU8(status);
        w.writeStringWithLength(winner);
        w.writeU32(moves);
        return w;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  getMoves(gameId) → count: u32, [notation: string, …]
    // ════════════════════════════════════════════════════════════════════════
    private _getMoves(calldata: Calldata): BytesWriter {
        const gameId    = calldata.readU256();
        const moveCount = this._getU32(PTR_GAME_MOVES, gameId);

        const w = new BytesWriter(4 + i32(moveCount) * 12);
        w.writeU32(moveCount);
        for (let i: u32 = 0; i < moveCount; i++) {
            const sub      = gameId ^ u256.fromU32(i);
            const notation = this._getStrRaw(PTR_MOVE_DATA, sub);
            w.writeStringWithLength(notation);
        }
        return w;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  getStats() → totalGames, tipJarTotal, lpPoolTotal
    // ════════════════════════════════════════════════════════════════════════
    private _getStats(): BytesWriter {
        const w = new BytesWriter(U256_BYTE_LENGTH * 3);
        w.writeU256(this._getU256Global(PTR_GAME_COUNTER));
        w.writeU256(this._getU256Global(PTR_TIP_JAR));
        w.writeU256(this._getU256Global(PTR_LP_POOL));
        return w;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Storage helpers
    //  Wrapping Blockchain.getStorageAt(ptr: u16, sub: Uint8Array, default)
    //               and Blockchain.setStorageAt(ptr: u16, sub: Uint8Array, val)
    // ════════════════════════════════════════════════════════════════════════

    private _sub(val: u256): Uint8Array {
        return val.toUint8Array(true); // little-endian, 32 bytes
    }

    private _zeroSub(): Uint8Array {
        return new Uint8Array(32); // all zeros
    }

    private _incrementCounter(): u256 {
        const cur  = this._getU256Global(PTR_GAME_COUNTER);
        const next = cur + u256.One;
        this._setU256Global(PTR_GAME_COUNTER, next);
        return next;
    }

    // Per-game keyed (sub-pointer = gameId)
    private _setStr(ptr: u16, gameId: u256, val: string): void {
        Blockchain.setStorageAt(ptr, this._sub(gameId), Uint8Array.wrap(String.UTF8.encode(val)));
    }
    private _getStr(ptr: u16, gameId: u256): string {
        const raw = Blockchain.getStorageAt(ptr, this._sub(gameId), new Uint8Array(0));
        return String.UTF8.decode(raw.buffer);
    }
    private _setU256(ptr: u16, gameId: u256, val: u256): void {
        Blockchain.setStorageAt(ptr, this._sub(gameId), val.toUint8Array(true));
    }
    private _getU256(ptr: u16, gameId: u256): u256 {
        const raw = Blockchain.getStorageAt(ptr, this._sub(gameId), u256.Zero.toUint8Array(true));
        return u256.fromUint8ArrayLE(raw);
    }
    private _setU8(ptr: u16, gameId: u256, val: u8): void {
        const buf = new Uint8Array(32);
        buf[0] = val;
        Blockchain.setStorageAt(ptr, this._sub(gameId), buf);
    }
    private _getU8(ptr: u16, gameId: u256): u8 {
        const raw = Blockchain.getStorageAt(ptr, this._sub(gameId), new Uint8Array(32));
        return raw[0];
    }
    private _setU32(ptr: u16, gameId: u256, val: u32): void {
        const buf = new Uint8Array(32);
        buf[0] = u8((val >> 24) & 0xff);
        buf[1] = u8((val >> 16) & 0xff);
        buf[2] = u8((val >>  8) & 0xff);
        buf[3] = u8(val & 0xff);
        Blockchain.setStorageAt(ptr, this._sub(gameId), buf);
    }
    private _getU32(ptr: u16, gameId: u256): u32 {
        const raw = Blockchain.getStorageAt(ptr, this._sub(gameId), new Uint8Array(32));
        return (u32(raw[0]) << 24) | (u32(raw[1]) << 16) | (u32(raw[2]) << 8) | u32(raw[3]);
    }

    // Raw sub-pointer storage (for moves and bets keyed by derived hash)
    private _setStrRaw(ptr: u16, sub: u256, val: string): void {
        Blockchain.setStorageAt(ptr, this._sub(sub), Uint8Array.wrap(String.UTF8.encode(val)));
    }
    private _getStrRaw(ptr: u16, sub: u256): string {
        const raw = Blockchain.getStorageAt(ptr, this._sub(sub), new Uint8Array(0));
        return String.UTF8.decode(raw.buffer);
    }
    private _setU256Raw(ptr: u16, sub: u256, val: u256): void {
        Blockchain.setStorageAt(ptr, this._sub(sub), val.toUint8Array(true));
    }
    private _getU256Raw(ptr: u16, sub: u256): u256 {
        const raw = Blockchain.getStorageAt(ptr, this._sub(sub), u256.Zero.toUint8Array(true));
        return u256.fromUint8ArrayLE(raw);
    }

    // Global storage (sub-pointer = all zeros)
    private _setU256Global(ptr: u16, val: u256): void {
        Blockchain.setStorageAt(ptr, this._zeroSub(), val.toUint8Array(true));
    }
    private _getU256Global(ptr: u16): u256 {
        const raw = Blockchain.getStorageAt(ptr, this._zeroSub(), u256.Zero.toUint8Array(true));
        return u256.fromUint8ArrayLE(raw);
    }
    private _addU256Global(ptr: u16, delta: u256): void {
        this._setU256Global(ptr, this._getU256Global(ptr) + delta);
    }

    // Bet key: spread address bytes across u256 via XOR with gameId
    private _betKey(gameId: u256, addr: string): u256 {
        const bytes = Uint8Array.wrap(String.UTF8.encode(addr));
        let hash    = gameId;
        for (let i = 0; i < bytes.length; i++) {
            hash = hash ^ u256.fromU64(u64(bytes[i]) << (u64(i % 56)));
        }
        return hash;
    }

    // Basis-points multiply: (val * bps) / 10000
    private _bpsMul(val: u256, bps: u32): u256 {
        return (val * u256.fromU32(bps)) / u256.fromU32(BPS_DENOM);
    }
}
