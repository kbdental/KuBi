/**
 * The inventory engine.
 *
 * The owner: *"inventory and mandatory should be at the back end and not on
 * front end as they should be a part of patient event and not separate
 * commodities."*
 *
 * So the claim under test is not "the stock report is correct". It is that
 * **a mandatory stock gate is decided by what is on the shelf**, not by
 * somebody ticking that they looked. Before this engine existed, an implant
 * case could satisfy "implant and components available" with a tap.
 */
import { describe, it, expect } from 'vitest';
import {
  ClinicEvent, RoleCode, STOCK_ITEMS, STOCK_BY_SKU, GATE_NEEDS,
  positionFor, inventory, stockWorkFor, StockState, UNRATIFIED_STOCK,
  complianceFor, GateOutcome, mustListFor, CareStage,
  type Lot, type ReadinessEvent, type Booking, type PatientFacts,
} from '@kubi/contracts';

const DAY = 24 * 60;
const days = (n: number) => n * DAY;
const NOW = days(400) + 9 * 60;

const lot = (sku: string, qty: number, expiresInDays: number | null = 365): Lot => ({
  sku, lot: `L-${sku}`, quantity: qty,
  expiresAt: expiresInDays === null ? null : NOW + days(expiresInDays),
});

const consumed = (sku: string, qty: number, at = NOW - 60): ReadinessEvent =>
  ({ type: ClinicEvent.STOCK_CONSUMED, subjectId: `${sku}#${qty}`, at });

const reservedEv = (sku: string, qty: number, at = NOW - 60): ReadinessEvent =>
  ({ type: ClinicEvent.STOCK_RESERVED, subjectId: `${sku}#${qty}`, at });

const ordered = (sku: string, at = NOW - 60): ReadinessEvent =>
  ({ type: ClinicEvent.STOCK_ORDERED, subjectId: sku, at });

const GLOVES = STOCK_BY_SKU.get('GLOVE-EXAM')!;
const FIXTURE = STOCK_BY_SKU.get('IMPLANT-4013')!;

/* ═══════════════════════════════════════════════════════════════════════ */

describe('counted is not the same as known', () => {
  /**
   * The constitution again, applied to a box of gloves. An item nobody has
   * ever counted is not an item the clinic has none of — it is one nobody
   * knows about, and a gate that needs it must fail rather than pass.
   */
  it('reports UNCOUNTED rather than zero', () => {
    const p = positionFor(GLOVES, [], [], NOW);
    expect(p.state).toBe(StockState.UNCOUNTED);
    expect(p.onHand).toBeNull();
    expect(p.available).toBeNull();
  });

  it('says so in the headline, rather than "none left"', () => {
    expect(positionFor(GLOVES, [], [], NOW).headline)
      .toContain('nobody knows');
  });

  it('is a different state from genuinely having none', () => {
    const none = positionFor(GLOVES, [lot('GLOVE-EXAM', 0)], [], NOW);
    expect(none.state).toBe(StockState.OUT);
    expect(none.onHand).toBe(0);
  });

  it('counts them across the register', () => {
    expect(inventory(STOCK_ITEMS, [], [], NOW).uncounted)
      .toHaveLength(STOCK_ITEMS.length);
  });
});

describe('expired stock is not stock', () => {
  it('leaves it out of what is available, and reports it separately', () => {
    const lots = [lot('LA-CART', 40, 30), lot('LA-CART', 60, -1)];
    const p = positionFor(STOCK_BY_SKU.get('LA-CART')!, lots, [], NOW);
    expect(p.expired).toBe(60);
    expect(p.available).toBe(40);
    // And it is still physically on the shelf, which somebody has to deal with.
    expect(p.onHand).toBe(100);
  });

  it('warns about a lot going out of date inside the lead time', () => {
    const p = positionFor(STOCK_BY_SKU.get('LA-CART')!,
      [lot('LA-CART', 80, 10)], [], NOW);
    expect(p.expiringSoon).toBe(80);
    expect(inventory(STOCK_ITEMS, [lot('LA-CART', 80, 10)], [], NOW)
      .expiring.map((x) => x.item.sku)).toContain('LA-CART');
  });

  it('does not invent an expiry for something that has none', () => {
    const p = positionFor(GLOVES, [lot('GLOVE-EXAM', 10, null)], [], NOW);
    expect(p.expired).toBe(0);
    expect(p.expiringSoon).toBe(0);
    expect(p.available).toBe(10);
  });
});

describe('reserved stock is not available stock', () => {
  it('takes a reservation out of what the next case can see', () => {
    // Two implant cases on the same fixture is the failure this exists to
    // prevent, and it only shows up if a reservation removes the item.
    const lots = [lot('IMPLANT-4013', 2)];
    const free = positionFor(FIXTURE, lots, [], NOW);
    const held = positionFor(FIXTURE, lots, [reservedEv('IMPLANT-4013', 2)], NOW);
    expect(free.available).toBe(2);
    expect(held.available).toBe(0);
    expect(held.reserved).toBe(2);
    expect(held.state).toBe(StockState.OUT);
    // Still physically there, which is why on-hand does not move.
    expect(held.onHand).toBe(2);
  });

  it('subtracts what has been used', () => {
    const p = positionFor(GLOVES, [lot('GLOVE-EXAM', 10)], [consumed('GLOVE-EXAM', 3)], NOW);
    expect(p.onHand).toBe(7);
    expect(p.available).toBe(7);
  });
});

describe('reorder fires while there is still cover', () => {
  it('reorders at the minimum plus the lead time’s worth of use', () => {
    const p = positionFor(GLOVES, [lot('GLOVE-EXAM', 100)], [], NOW);
    // minimum 6, lead 3 days, 2 boxes a day → 12
    expect(p.reorderAt).toBe(GLOVES.minimum + Math.ceil(GLOVES.leadDays * GLOVES.dailyUse));
    expect(p.state).toBe(StockState.HELD);
  });

  it('flags REORDER before it is below the minimum, not after', () => {
    const atPoint = positionFor(GLOVES, [lot('GLOVE-EXAM', 10)], [], NOW);
    expect(atPoint.state).toBe(StockState.REORDER);
    expect(atPoint.available! > GLOVES.minimum).toBe(true);
    // By the time it is under the minimum the lead time is already lost.
    const late = positionFor(GLOVES, [lot('GLOVE-EXAM', 4)], [], NOW);
    expect(late.state).toBe(StockState.LOW);
  });

  it('says how many days of cover are left', () => {
    const p = positionFor(GLOVES, [lot('GLOVE-EXAM', 10)], [], NOW);
    expect(p.daysOfCover).toBe(5);          // 10 boxes at 2 a day
  });

  it('knows an order has already been placed', () => {
    const p = positionFor(GLOVES, [lot('GLOVE-EXAM', 2)], [ordered('GLOVE-EXAM')], NOW);
    expect(p.onOrder).toBe(true);
    expect(p.headline).toContain('An order is placed');
  });
});

describe('the mandatory stock gate is decided by the shelf', () => {
  const APPT = days(400) + 11 * 60;
  const KNOWN: PatientFacts = {
    anticoagulated: false, prophylaxisIndicated: false, diabetic: false,
    antiresorptive: false, pregnant: false, penicillinAllergy: false,
    smoker: false, minor: false,
  };
  const booking: Booking = {
    id: 'bk-1', treatmentCode: 'IMPLANT', patientLabel: 'Anita Rao',
    at: APPT, sitting: 1,
  };

  /** Every mandatory BEFORE gate reported met, which is the old way. */
  const ticked = mustListFor('IMPLANT')
    .filter((m) => m.stage === CareStage.BEFORE)
    .map((m) => ({
      type: ClinicEvent.CARE_ITEM_MET, subjectId: `bk-1#${m.id}`, at: APPT - 60,
    } as ReadinessEvent));

  const IMPLANT_LOTS: Lot[] = [
    lot('IMPLANT-4013', 1), lot('IMPLANT-4011', 1),
    lot('IMPLANT-4515', 1), lot('COVER-SCREW', 4),
  ];

  it('will not accept a tick where a lot number is required', () => {
    // The evidence line always said "lot numbers … physically in the clinic".
    // Until inventory existed, a tap satisfied it. It no longer does.
    const c = complianceFor(booking, KNOWN, ticked, APPT, {
      unusableAssets: [],
      stockVouched: { 'bk-1#IMPLANT_STOCK': false },
    })!;
    expect(c.gates.find((x) => x.id === 'IMPLANT_STOCK')!.verdict)
      .toBe(GateOutcome.MISSING);
    expect(c.ready).toBe(false);
  });

  it('passes when the fixtures are actually on the shelf and reserved', () => {
    const v = inventory(STOCK_ITEMS, IMPLANT_LOTS, [], NOW,
      { 'bk-1': GATE_NEEDS.IMPLANT_STOCK! });
    expect(v.gateStock['bk-1#IMPLANT_STOCK']).toBe(true);

    const c = complianceFor(booking, KNOWN, ticked, APPT,
      { unusableAssets: [], stockVouched: v.gateStock })!;
    expect(c.gates.find((x) => x.id === 'IMPLANT_STOCK')!.verdict)
      .toBe(GateOutcome.MET);
  });

  it('refuses when one size either side is missing', () => {
    // A case that opens without the next size up closes without an implant.
    const missingOneSize = IMPLANT_LOTS.filter((l) => l.sku !== 'IMPLANT-4515');
    const v = inventory(STOCK_ITEMS, missingOneSize, [], NOW,
      { 'bk-1': GATE_NEEDS.IMPLANT_STOCK!.filter((s) => s !== 'IMPLANT-4515') });
    expect(v.gateStock['bk-1#IMPLANT_STOCK']).toBe(false);
  });

  it('refuses when the stock exists but is held for another case', () => {
    const v = inventory(STOCK_ITEMS, IMPLANT_LOTS, [], NOW,
      { 'bk-2': GATE_NEEDS.IMPLANT_STOCK! });
    // Nothing is reserved for bk-1, so bk-1's gate cannot be vouched for.
    expect(v.gateStock['bk-1#IMPLANT_STOCK']).toBeUndefined();
    expect(v.gateStock['bk-2#IMPLANT_STOCK']).toBe(true);
  });

  it('is UNKNOWN when nobody asked the stock register at all', () => {
    // A procedure that passed because the software could not reach the stock
    // data would have passed for the worst possible reason.
    const c = complianceFor(booking, KNOWN, ticked, APPT, { unusableAssets: [] })!;
    const gate = c.gates.find((x) => x.id === 'IMPLANT_STOCK')!;
    expect(gate.verdict).toBe(GateOutcome.UNKNOWN);
    expect(gate.because).toContain('Nobody has asked the stock register');
    expect(c.ready).toBe(false);
  });

  it('names every SKU each stock-backed gate depends on', () => {
    for (const [gateId, skus] of Object.entries(GATE_NEEDS)) {
      expect(skus.length, `${gateId} needs nothing`).toBeGreaterThan(0);
      for (const sku of skus) {
        expect(STOCK_BY_SKU.get(sku), `${gateId} needs ${sku}, which is not stocked`)
          .toBeDefined();
      }
    }
  });
});

describe('the register', () => {
  it('carries the owner’s twelve opening lines', () => {
    for (const sku of ['GLOVE-EXAM', 'MASK-3PLY', 'CAP-HEAD', 'FILM-CLING',
      'BIB-PATIENT', 'GAUZE', 'LA-CART', 'NEEDLE-LA', 'TIP-SUCTION',
      'POUCH-STER', 'WATER-DIST', 'BACILOL']) {
      expect(STOCK_BY_SKU.get(sku), `${sku} is not stocked`).toBeDefined();
    }
  });

  it('gives every item an owner role, a minimum and a lead time', () => {
    for (const i of STOCK_ITEMS) {
      expect(Object.values(RoleCode), i.sku).toContain(i.responsible);
      expect(i.minimum, `${i.sku} has no minimum`).toBeGreaterThan(0);
      expect(i.leadDays, `${i.sku} has no lead time`).toBeGreaterThan(0);
      expect(i.unit.length, `${i.sku} has no unit`).toBeGreaterThan(0);
    }
  });

  it('never gives two items the same SKU', () => {
    expect(STOCK_BY_SKU.size).toBe(STOCK_ITEMS.length);
  });

  it('tracks lots on everything that expires or must be traceable', () => {
    // An anaesthetic cartridge and an implant fixture are traceable to a
    // patient; cling film is not.
    for (const sku of ['LA-CART', 'IMPLANT-4013', 'GRAFT-BONE', 'SUTURE']) {
      expect(STOCK_BY_SKU.get(sku)!.lotTracked, `${sku} is not lot tracked`).toBe(true);
    }
    expect(STOCK_BY_SKU.get('FILM-CLING')!.lotTracked).toBe(false);
  });

  it('knows what stops treatment and what merely inconveniences it', () => {
    expect(STOCK_BY_SKU.get('LA-CART')!.stopsTreatment).toBe(true);
    expect(STOCK_BY_SKU.get('CAP-HEAD')!.stopsTreatment).toBe(false);
  });

  it('surfaces the ones whose absence stops the list', () => {
    // Out of anaesthetic cancels the afternoon. Out of head caps does not, and
    // it is uncounted here — so the list is filtered on what the shortage
    // costs, not on how bad the number looks.
    const v = inventory(STOCK_ITEMS, [lot('LA-CART', 0)], [], NOW);
    const stopping = v.stopping.map((p) => p.item.sku);
    expect(stopping).toContain('LA-CART');
    expect(stopping).not.toContain('CAP-HEAD');
    expect(STOCK_BY_SKU.get('CAP-HEAD')!.stopsTreatment).toBe(false);
  });

  it('gives one role its own list, worst first', () => {
    const v = inventory(STOCK_ITEMS, [], [], NOW);
    const mine = stockWorkFor(v, RoleCode.INVENTORY_COORDINATOR);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((p) => p.item.responsible === RoleCode.INVENTORY_COORDINATOR))
      .toBe(true);
    expect(mine[0]!.state).toBe(StockState.UNCOUNTED);
  });

  it('says out loud that it is not the clinic’s real list', () => {
    expect(UNRATIFIED_STOCK).toBe(true);
  });
});
