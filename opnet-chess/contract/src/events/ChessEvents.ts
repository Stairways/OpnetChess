import { NetEvent } from '@btc-vision/btc-runtime/runtime';
import { u256 } from 'as-bignum/assembly';

/**
 * Emitted when a new chess game is created on-chain.
 * Logs both players, the wager amount, and the token used.
 */
export class GameCreatedEvent extends NetEvent {
    constructor(
        public readonly gameId: u256,
        public readonly playerWhite: string,
        public readonly playerBlack: string,
        public readonly wager: u256,
        public readonly token: string,
    ) {
        super('GameCreated');
    }

    public override get data(): u8[] {
        const writer = new BytesWriter();
        writer.writeU256(this.gameId);
        writer.writeStringWithLength(this.playerWhite);
        writer.writeStringWithLength(this.playerBlack);
        writer.writeU256(this.wager);
        writer.writeStringWithLength(this.token);
        return writer.getBuffer();
    }
}

/**
 * Emitted when a move is committed to the chain.
 * move is in algebraic notation e.g. "e2e4"
 */
export class MoveCommittedEvent extends NetEvent {
    constructor(
        public readonly gameId: u256,
        public readonly player: string,
        public readonly moveNotation: string,
        public readonly moveIndex: u32,
    ) {
        super('MoveCommitted');
    }

    public override get data(): u8[] {
        const writer = new BytesWriter();
        writer.writeU256(this.gameId);
        writer.writeStringWithLength(this.player);
        writer.writeStringWithLength(this.moveNotation);
        writer.writeU32(this.moveIndex);
        return writer.getBuffer();
    }
}

/**
 * Emitted when a game concludes. winner = 'w', 'b', or 'd' (draw).
 */
export class GameEndedEvent extends NetEvent {
    constructor(
        public readonly gameId: u256,
        public readonly winner: string,
        public readonly reason: string,
        public readonly payout: u256,
    ) {
        super('GameEnded');
    }

    public override get data(): u8[] {
        const writer = new BytesWriter();
        writer.writeU256(this.gameId);
        writer.writeStringWithLength(this.winner);
        writer.writeStringWithLength(this.reason);
        writer.writeU256(this.payout);
        return writer.getBuffer();
    }
}

/**
 * Emitted when someone places a side bet on an ongoing game.
 */
export class BetPlacedEvent extends NetEvent {
    constructor(
        public readonly gameId: u256,
        public readonly bettor: string,
        public readonly side: string,   // 'w' or 'b'
        public readonly amount: u256,
        public readonly token: string,
    ) {
        super('BetPlaced');
    }

    public override get data(): u8[] {
        const writer = new BytesWriter();
        writer.writeU256(this.gameId);
        writer.writeStringWithLength(this.bettor);
        writer.writeStringWithLength(this.side);
        writer.writeU256(this.amount);
        writer.writeStringWithLength(this.token);
        return writer.getBuffer();
    }
}

/**
 * Emitted when a tip is sent to the creator address.
 */
export class TipSentEvent extends NetEvent {
    constructor(
        public readonly from: string,
        public readonly amount: u256,
        public readonly token: string,
    ) {
        super('TipSent');
    }

    public override get data(): u8[] {
        const writer = new BytesWriter();
        writer.writeStringWithLength(this.from);
        writer.writeU256(this.amount);
        writer.writeStringWithLength(this.token);
        return writer.getBuffer();
    }
}

// ── BytesWriter shim (inline for self-contained compilation) ──────────────────
// In production the real BytesWriter comes from @btc-vision/btc-runtime/runtime
class BytesWriter {
    private buf: u8[] = [];

    writeU256(val: u256): void {
        const bytes = val.toBytes();
        for (let i = 0; i < bytes.length; i++) this.buf.push(bytes[i]);
    }

    writeU32(val: u32): void {
        this.buf.push(u8((val >> 24) & 0xff));
        this.buf.push(u8((val >> 16) & 0xff));
        this.buf.push(u8((val >> 8) & 0xff));
        this.buf.push(u8(val & 0xff));
    }

    writeStringWithLength(val: string): void {
        const enc = String.UTF8.encode(val);
        const view = new Uint8Array(enc);
        this.writeU32(view.length);
        for (let i = 0; i < view.length; i++) this.buf.push(view[i]);
    }

    getBuffer(): u8[] { return this.buf; }
}
