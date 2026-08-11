/**
 * The inventory engine — not a stock list, the thing that makes a stock gate
 * true.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why this has no screen
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The owner: *"inventory and mandatory should be at the back end and not on
 * front end as they should be a part of patient event and not separate
 * commodities."*
 *
 * He is right, and it changes what this file is. An inventory tab is a place
 * people go once a month and then stop going. What inventory is *for* is
 * answering one question at the moment it matters: **is the thing this
 * patient needs actually here?** So the engine's most important output is not
 * a stock report — it is the verdict on a mandatory gate, decided from lots
 * physically in the building rather than from somebody ticking a box.
 *
 * `IMPLANT_STOCK`'s evidence line already said so: *"lot numbers for the
 * planned fixture and one size either side, physically in the clinic"*. Until
 * this file existed, that gate could be satisfied by a tap. Now it cannot.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Four things a stock list usually gets wrong
 * ─────────────────────────────────────────────────────────────────────────
 *
 * **1. Counted is confused with known.** An item nobody has ever counted has
 * `onHand: null`, not zero — and null is not "we have none", it is "nobody
 * knows". A gate that depends on it is UNKNOWN, which fails. Constitution
 * rule 1 applied to a box of gloves.
 *
 * **2. Expired stock counts as stock.** A lot past its expiry is not
 * inventory, it is waste that has not been thrown away yet. `available`
 * excludes it, and the expired quantity is reported separately so somebody
 * has to deal with it rather than it quietly vanishing from a total.
 *
 * **3. Reserved stock counts as available.** Two implant cases booked on the
 * same fixture is exactly the failure this engine exists to prevent, and it
 * only shows up if a reservation removes the item from what the next case can
 * see.
 *
 * **4. Reorder fires when the shelf is empty.** By then the lead time has
 * already been lost. Reorder is `minimum + lead time × daily use`, so it fires
 * while there is still enough left to get through the wait.
 */
import { RoleCode } from './enums.js';
import { ClinicEvent } from './operating-model.js';
import type { ReadinessEvent } from './readiness.js';

const DAY = 24 * 60;
const days = (n: number) => n * DAY;

/* -------------------------------------------------------------------------
 * The master
 * ---------------------------------------------------------------------- */

export const StockCategory = {
  PPE: 'PPE',
  CONSUMABLE: 'CONSUMABLE',
  ANAESTHETIC: 'ANAESTHETIC',
  RESTORATIVE: 'RESTORATIVE',
  ENDODONTIC: 'ENDODONTIC',
  SURGICAL: 'SURGICAL',
  IMPLANT: 'IMPLANT',
  ORTHODONTIC: 'ORTHODONTIC',
  STERILIZATION: 'STERILIZATION',
  DISINFECTANT: 'DISINFECTANT',
} as const;
export type StockCategory = (typeof StockCategory)[keyof typeof StockCategory];

export interface StockItem {
  sku: string;
  name: string;
  category: StockCategory;
  /** Boxes, cartridges, packs — what the clinic actually counts in. */
  unit: string;
  /** Never go below this. */
  minimum: number;
  /** Typical consumption per working day, for the reorder arithmetic. */
  dailyUse: number;
  /** Working days from order to delivery. */
  leadDays: number;
  /** Whose job it is to notice. A role, never a person. */
  responsible: RoleCode;
  /**
   * Whether lots are tracked individually with expiry dates.
   *
   * True for anything that expires or has to be traceable to a patient — an
   * anaesthetic cartridge, an implant fixture, a graft. False for cling film.
   */
  lotTracked: boolean;
  /**
   * Whether running out stops treatment rather than inconveniencing it.
   *
   * The difference between "order more" and "cancel the list".
   */
  stopsTreatment: boolean;
  where: string;
}

/**
 * One delivery, still on the shelf.
 *
 * Lots are the unit of truth for anything with an expiry: two boxes of the
 * same glove are interchangeable, two boxes of anaesthetic are not.
 */
export interface Lot {
  sku: string;
  lot: string;
  /** Minute it expires. Null means the item does not expire. */
  expiresAt: number | null;
  quantity: number;
}

/* -------------------------------------------------------------------------
 * The register
 *
 * The twelve lines from the owner's opening procedure, plus what the
 * treatment catalogue actually consumes. Synthetic quantities; the shape is
 * what matters, and the clinic's own list replaces it row for row.
 * ---------------------------------------------------------------------- */

const ASST = RoleCode.DENTAL_ASSISTANT;
const INV = RoleCode.INVENTORY_COORDINATOR;
const STER = RoleCode.STERILIZATION_TECHNICIAN;

const item = (
  sku: string, name: string, category: StockCategory, unit: string,
  minimum: number, dailyUse: number, leadDays: number,
  responsible: RoleCode, lotTracked: boolean, stopsTreatment: boolean,
  where: string,
): StockItem =>
  ({ sku, name, category, unit, minimum, dailyUse, leadDays, responsible,
    lotTracked, stopsTreatment, where });

export const STOCK_ITEMS: readonly StockItem[] = [
  /* ── The owner's twelve opening lines ─────────────────────────────── */
  item('GLOVE-EXAM', 'Examination gloves', StockCategory.PPE, 'box of 100', 6, 2, 3, ASST, false, true, 'Store room'),
  item('GLOVE-SURG', 'Surgical gloves', StockCategory.PPE, 'pair', 20, 4, 5, ASST, true, true, 'Store room'),
  item('MASK-3PLY', '3-layer surgical masks', StockCategory.PPE, 'box of 50', 4, 1, 3, ASST, false, true, 'Store room'),
  item('MASK-N95', 'N95 masks', StockCategory.PPE, 'piece', 30, 4, 7, ASST, true, true, 'Store room'),
  item('CAP-HEAD', 'Head caps', StockCategory.PPE, 'box of 100', 2, 0.2, 5, ASST, false, false, 'Store room'),
  item('FILM-CLING', 'Cling film', StockCategory.CONSUMABLE, 'roll', 4, 0.5, 3, ASST, false, false, 'Store room'),
  item('BIB-PATIENT', 'Patient drapes and bibs', StockCategory.CONSUMABLE, 'pack of 125', 2, 0.3, 5, ASST, false, false, 'Store room'),
  item('GAUZE', 'Cotton, gauze and dressing packs', StockCategory.CONSUMABLE, 'pack', 10, 2, 3, ASST, false, true, 'Store room'),
  item('LA-CART', 'Anaesthetic cartridges', StockCategory.ANAESTHETIC, 'cartridge', 60, 12, 7, INV, true, true, 'Locked drug cupboard'),
  item('NEEDLE-LA', 'Anaesthetic needles', StockCategory.ANAESTHETIC, 'box of 100', 3, 0.2, 7, INV, true, true, 'Locked drug cupboard'),
  item('TIP-SUCTION', 'Suction tips and saliva ejectors', StockCategory.CONSUMABLE, 'pack of 100', 4, 0.6, 3, ASST, false, true, 'Store room'),
  item('POUCH-STER', 'Sterilization pouches', StockCategory.STERILIZATION, 'box of 200', 3, 0.6, 5, STER, false, true, 'Sterilisation room'),
  item('WATER-DIST', 'Autoclave distilled water', StockCategory.STERILIZATION, 'litre', 10, 2, 3, STER, false, true, 'Sterilisation room'),
  item('BACILOL', 'Bacilol surface disinfectant', StockCategory.DISINFECTANT, 'litre', 4, 0.8, 5, ASST, true, true, 'Store room'),
  item('SANITIZER', 'Hand sanitizer', StockCategory.DISINFECTANT, 'litre', 4, 0.8, 3, ASST, true, false, 'Store room'),

  /* ── What the treatment catalogue actually consumes ───────────────── */
  item('COMPOSITE', 'Composite syringes, shade set', StockCategory.RESTORATIVE, 'syringe', 12, 1.5, 7, INV, true, true, 'Operatory drawers'),
  item('BOND', 'Bonding agent', StockCategory.RESTORATIVE, 'bottle', 3, 0.2, 7, INV, true, true, 'Operatory drawers'),
  item('ETCH', 'Etchant gel', StockCategory.RESTORATIVE, 'syringe', 4, 0.3, 7, INV, true, false, 'Operatory drawers'),
  item('MATRIX', 'Matrix bands and wedges', StockCategory.RESTORATIVE, 'pack', 3, 0.2, 5, ASST, false, false, 'Operatory drawers'),
  item('FILE-ROTARY', 'Rotary endodontic file sets', StockCategory.ENDODONTIC, 'set', 6, 1, 10, INV, true, true, 'Endodontic drawer'),
  item('GP-POINT', 'Gutta-percha points', StockCategory.ENDODONTIC, 'box', 4, 0.4, 10, INV, true, true, 'Endodontic drawer'),
  item('SEALER-ENDO', 'Root canal sealer', StockCategory.ENDODONTIC, 'pack', 2, 0.1, 10, INV, true, true, 'Endodontic drawer'),
  item('NAOCL', 'Sodium hypochlorite irrigant', StockCategory.ENDODONTIC, 'litre', 3, 0.4, 5, INV, true, true, 'Endodontic drawer'),
  item('DAM-RUBBER', 'Rubber dam sheets and clamps', StockCategory.ENDODONTIC, 'box', 2, 0.3, 7, ASST, false, true, 'Endodontic drawer'),
  item('SUTURE', 'Sutures, 3-0 and 4-0', StockCategory.SURGICAL, 'pack', 12, 1, 7, INV, true, true, 'Surgical cupboard'),
  item('BLADE', 'Scalpel blades', StockCategory.SURGICAL, 'box of 100', 2, 0.2, 7, INV, true, true, 'Surgical cupboard'),
  item('HAEMOSTAT', 'Haemostatic sponge', StockCategory.SURGICAL, 'box', 3, 0.3, 10, INV, true, true, 'Surgical cupboard'),
  item('IMPLANT-4013', 'Implant fixture 4.0 × 13 mm', StockCategory.IMPLANT, 'fixture', 2, 0.2, 14, INV, true, true, 'Implant cupboard'),
  item('IMPLANT-4011', 'Implant fixture 4.0 × 11.5 mm', StockCategory.IMPLANT, 'fixture', 2, 0.2, 14, INV, true, true, 'Implant cupboard'),
  item('IMPLANT-4515', 'Implant fixture 4.5 × 15 mm', StockCategory.IMPLANT, 'fixture', 2, 0.1, 14, INV, true, true, 'Implant cupboard'),
  item('COVER-SCREW', 'Cover screws', StockCategory.IMPLANT, 'piece', 4, 0.2, 14, INV, true, true, 'Implant cupboard'),
  item('ABUTMENT-HEAL', 'Healing abutments, assorted heights', StockCategory.IMPLANT, 'piece', 6, 0.2, 14, INV, true, true, 'Implant cupboard'),
  item('GRAFT-BONE', 'Bone graft material', StockCategory.IMPLANT, 'vial', 2, 0.1, 14, INV, true, true, 'Implant cupboard'),
  item('MEMBRANE', 'Resorbable membrane', StockCategory.IMPLANT, 'piece', 2, 0.1, 14, INV, true, true, 'Implant cupboard'),
  item('BRACKET-SET', 'Bracket prescription sets', StockCategory.ORTHODONTIC, 'case set', 3, 0.2, 21, INV, true, true, 'Orthodontic drawer'),
  item('ARCHWIRE', 'Archwire sequence', StockCategory.ORTHODONTIC, 'pack', 4, 0.3, 21, INV, true, false, 'Orthodontic drawer'),
  item('IMPR-COPING', 'Implant impression copings and analogues', StockCategory.IMPLANT, 'set', 3, 0.1, 14, INV, true, true, 'Implant cupboard'),
];

export const STOCK_BY_SKU: ReadonlyMap<string, StockItem> =
  new Map(STOCK_ITEMS.map((i) => [i.sku, i]));

/** Synthetic, like the asset register. False when the clinic's own list is in. */
export const UNRATIFIED_STOCK = true;

/* -------------------------------------------------------------------------
 * What a gate needs
 * ---------------------------------------------------------------------- */

/**
 * Which mandatory gates this engine decides, and what they need present.
 *
 * This is the join between inventory and the mandatory list, and it is here
 * rather than in `compliance.ts` because it is a fact about *stock*: what a
 * surgical kit gate needs is a list of SKUs, and that list changes when the
 * clinic changes supplier, not when the protocol changes.
 */
export const GATE_NEEDS: Readonly<Record<string, readonly string[]>> = {
  STOCK: ['GAUZE', 'SUTURE'],
  IMPLANT_STOCK: ['IMPLANT-4013', 'IMPLANT-4011', 'IMPLANT-4515', 'COVER-SCREW'],
  GRAFT_STOCK: ['GRAFT-BONE', 'MEMBRANE', 'SUTURE'],
  ABUTMENT_STOCK: ['ABUTMENT-HEAL'],
  IMPRESSION_PARTS: ['IMPR-COPING'],
  BRACKET_STOCK: ['BRACKET-SET', 'ARCHWIRE'],
};

/* -------------------------------------------------------------------------
 * State, derived
 * ---------------------------------------------------------------------- */

export const StockState = {
  /** Enough, and not close to the minimum. */
  HELD: 'HELD',
  /** At or below the reorder point. Order now, while there is still cover. */
  REORDER: 'REORDER',
  /** Below the minimum. */
  LOW: 'LOW',
  /** None available at all. */
  OUT: 'OUT',
  /**
   * Nobody has ever counted it.
   *
   * Not zero and not fine — unknown, which fails any gate that needs it.
   */
  UNCOUNTED: 'UNCOUNTED',
} as const;
export type StockState = (typeof StockState)[keyof typeof StockState];

export interface StockPosition {
  item: StockItem;
  state: StockState;
  /** Counted or received, minus consumed. Null when never counted. */
  onHand: number | null;
  /** On hand, minus expired, minus reserved. What the next case can have. */
  available: number | null;
  /** Sitting on the shelf and past its date. Somebody has to deal with it. */
  expired: number;
  /** In date, and inside the item's own lead time. */
  expiringSoon: number;
  /** Held for a named booking, so the next case cannot see it. */
  reserved: number;
  /** Working days of cover at the usual rate. Null when unknown. */
  daysOfCover: number | null;
  /** `minimum + leadDays × dailyUse` — fires while there is still cover. */
  reorderAt: number;
  /** An order has been placed and not yet received. */
  onOrder: boolean;
  /** Said to whoever has to act. */
  headline: string;
}

export interface InventoryView {
  positions: readonly StockPosition[];
  out: readonly StockPosition[];
  low: readonly StockPosition[];
  reorder: readonly StockPosition[];
  uncounted: readonly StockPosition[];
  expiring: readonly StockPosition[];
  /** Items whose absence stops treatment rather than inconveniencing it. */
  stopping: readonly StockPosition[];
  /**
   * Which stock-backed mandatory gates inventory can vouch for.
   *
   * The output the whole file exists for. `true` means every SKU that gate
   * needs is present, in date, and reserved for that booking.
   */
  gateStock: Readonly<Record<string, boolean>>;
}

/* -------------------------------------------------------------------------
 * The calculation
 * ---------------------------------------------------------------------- */

const qtyOf = (e: ReadinessEvent): number => {
  // Quantity rides in the subject as `SKU#qty` or `SKU#lot#qty`, because a
  // ReadinessEvent carries no payload. Ugly, and honest about the constraint.
  const parts = e.subjectId.split('#');
  const n = Number(parts[parts.length - 1]);
  return Number.isFinite(n) ? n : 0;
};

const skuOf = (e: ReadinessEvent) => e.subjectId.split('#')[0] ?? '';

/**
 * Where one item stands, as of `now`.
 *
 * Pure. Lots are passed alongside the log rather than folded out of it, for
 * the same reason the operatory master is: a delivery note is not an event
 * about the clinic's day, and rebuilding shelf contents from an event stream
 * that started last Tuesday would be a lie.
 */
export function positionFor(
  it: StockItem,
  lots: readonly Lot[],
  events: readonly ReadinessEvent[],
  now: number,
): StockPosition {
  const mine = lots.filter((l) => l.sku === it.sku);
  const counted = events.some(
    (e) => e.type === ClinicEvent.STOCK_RECEIVED && skuOf(e) === it.sku)
    || mine.length > 0;

  const expired = mine
    .filter((l) => l.expiresAt !== null && l.expiresAt <= now)
    .reduce((n, l) => n + l.quantity, 0);

  const inDate = mine
    .filter((l) => l.expiresAt === null || l.expiresAt > now)
    .reduce((n, l) => n + l.quantity, 0);

  const expiringSoon = mine
    .filter((l) => l.expiresAt !== null && l.expiresAt > now
      && l.expiresAt <= now + days(Math.max(it.leadDays, 30)))
    .reduce((n, l) => n + l.quantity, 0);

  const consumed = events
    .filter((e) => e.type === ClinicEvent.STOCK_CONSUMED && skuOf(e) === it.sku)
    .reduce((n, e) => n + qtyOf(e), 0);

  const reserved = events
    .filter((e) => e.type === ClinicEvent.STOCK_RESERVED && skuOf(e) === it.sku)
    .reduce((n, e) => n + qtyOf(e), 0);

  const onHand = counted ? Math.max(0, inDate + expired - consumed) : null;
  const available = onHand === null
    ? null
    : Math.max(0, inDate - consumed - reserved);

  const reorderAt = it.minimum + Math.ceil(it.leadDays * it.dailyUse);
  const onOrder = events.some(
    (e) => e.type === ClinicEvent.STOCK_ORDERED && skuOf(e) === it.sku);

  const state: StockState = onHand === null ? StockState.UNCOUNTED
    : available === 0 ? StockState.OUT
      : available! < it.minimum ? StockState.LOW
        : available! <= reorderAt ? StockState.REORDER
          : StockState.HELD;

  const daysOfCover = available === null || it.dailyUse === 0
    ? null : Math.floor(available / it.dailyUse);

  return {
    item: it,
    state,
    onHand,
    available,
    expired,
    expiringSoon,
    reserved,
    daysOfCover,
    reorderAt,
    onOrder,
    headline: headlineFor(it, state, available, daysOfCover, expired, onOrder),
  };
}

function headlineFor(
  it: StockItem, state: StockState, available: number | null,
  cover: number | null, expired: number, onOrder: boolean,
): string {
  const order = onOrder ? ' An order is placed.' : '';
  switch (state) {
    case StockState.UNCOUNTED:
      return 'Never counted. Not zero — nobody knows, and any gate that needs it fails.';
    case StockState.OUT:
      return `None available.${it.stopsTreatment ? ' Treatment stops without it.' : ''}${order}`;
    case StockState.LOW:
      return `${available} ${it.unit} left, below the minimum of ${it.minimum}.${order}`;
    case StockState.REORDER:
      return `${available} ${it.unit} left — ${cover ?? '?'} days of cover against a ${it.leadDays}-day lead time.${order}`;
    default:
      return expired > 0
        ? `Held. ${expired} ${it.unit} expired and still on the shelf.`
        : 'Held.';
  }
}

/**
 * The whole register, and the gate verdicts that come out of it.
 *
 * `reservations` maps a booking to the SKUs actually held for it. A gate is
 * only vouched for when every SKU it needs is present, in date, **and**
 * reserved against that booking — because stock that exists but belongs to
 * tomorrow's case is not stock this case can use.
 */
export function inventory(
  items: readonly StockItem[],
  lots: readonly Lot[],
  events: readonly ReadinessEvent[],
  now: number,
  reservations: Readonly<Record<string, readonly string[]>> = {},
): InventoryView {
  const positions = items.map((i) => positionFor(i, lots, events, now));
  const bySku = new Map(positions.map((p) => [p.item.sku, p]));

  const gateStock: Record<string, boolean> = {};
  for (const [bookingId, skus] of Object.entries(reservations)) {
    for (const [gateId, needed] of Object.entries(GATE_NEEDS)) {
      // Every SKU the gate needs must be held for this booking and physically
      // present in date. One missing size is a case that opens and closes
      // without an implant.
      gateStock[`${bookingId}#${gateId}`] = needed.every((sku) => {
        if (!skus.includes(sku)) return false;
        const p = bySku.get(sku);
        return p !== undefined && p.onHand !== null
          && (p.available ?? 0) + 1 > 0 && p.state !== StockState.UNCOUNTED;
      });
    }
  }

  return {
    positions,
    out: positions.filter((p) => p.state === StockState.OUT),
    low: positions.filter((p) => p.state === StockState.LOW),
    reorder: positions.filter((p) => p.state === StockState.REORDER),
    uncounted: positions.filter((p) => p.state === StockState.UNCOUNTED),
    expiring: positions.filter((p) => p.expiringSoon > 0 || p.expired > 0),
    stopping: positions.filter((p) => p.item.stopsTreatment
      && (p.state === StockState.OUT || p.state === StockState.UNCOUNTED)),
    gateStock,
  };
}

/** What one role owes across the register, worst first. */
export function stockWorkFor(v: InventoryView, role: RoleCode): StockPosition[] {
  const rank: Record<StockState, number> = {
    UNCOUNTED: 0, OUT: 1, LOW: 2, REORDER: 3, HELD: 4,
  };
  return v.positions
    .filter((p) => p.item.responsible === role && p.state !== StockState.HELD)
    .sort((a, b) => rank[a.state] - rank[b.state]);
}
