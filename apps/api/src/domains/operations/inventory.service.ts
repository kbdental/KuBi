/**
 * The Inventory engine.
 *
 *   Current stock ≤ reorder level  →  purchase requirement generated
 *   Stock < minimum                →  shortage, which is worse
 *   Expiry approaching             →  alert
 *   Expired                        →  excluded from usable stock
 *
 * That last rule is the one with teeth. Expired stock is not deleted and not
 * merely flagged: it stops counting as stock. A clinic that believes it holds
 * ten sterile packs, three of which expired last month, is in a worse position
 * than one that knows it holds seven — and deleting the batch would destroy
 * the record of what was held and when it lapsed.
 *
 * ---
 *
 * Implants are counted separately and to the component, because the
 * requirement is explicit that quantity alone is clinically insufficient:
 * "merely knowing 10 implants available" says nothing about whether the right
 * platform, diameter and length are present, let alone the healing abutment
 * and prosthetic components without which the case cannot finish.
 *
 * `implantReadiness` is what the Compliance engine calls before a surgery. It
 * answers per component, so the exception can say WHICH part is missing —
 * "healing abutment 4.5×5 not in stock" rather than "implant not ready".
 */
import { Priority, ExceptionStatus, EvaluationResult } from '@kubi/contracts';
import type { TenantPrisma } from '../../platform/tenancy/rls-context.js';
import type { Clock } from '../../shared/clock.js';

export class InventoryError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'InventoryError';
  }
}

/** Batches that have not expired as at `now`. Undated batches count. */
const usable = <T extends { expiryAt: Date | null; quantity: number }>(batches: T[], now: Date) =>
  batches.filter((b) => !b.expiryAt || b.expiryAt > now);

export interface StockLevel {
  itemId: string;
  code: string;
  name: string;
  /** Excludes expired batches. This is the number that matters. */
  available: number;
  /** Including expired, so the gap between the two is visible. */
  onHand: number;
  reorderLevel: number;
  minimumQty: number;
  state: 'OK' | 'REORDER' | 'SHORTAGE';
  expiringSoon: number;
  expired: number;
}

export async function stockLevels(
  client: TenantPrisma,
  clock: Clock,
  clinicId: string,
  expiryHorizonDays = 30,
): Promise<StockLevel[]> {
  const now = clock.now();
  const horizon = new Date(now.getTime() + expiryHorizonDays * 86_400_000);

  const items = await client.item.findMany({
    where: { clinicId },
    include: { batches: true },
    orderBy: { code: 'asc' },
  });

  return items.map((item) => {
    const live = usable(item.batches, now);
    const available = live.reduce((n, b) => n + b.quantity, 0);
    const onHand = item.batches.reduce((n, b) => n + b.quantity, 0);
    return {
      itemId: item.id,
      code: item.code,
      name: item.name,
      available,
      onHand,
      reorderLevel: item.reorderLevel,
      minimumQty: item.minimumQty,
      // Below minimum is a shortage even if it is also below reorder — the
      // worse of the two states is the one to report.
      state: available < item.minimumQty ? 'SHORTAGE'
        : available <= item.reorderLevel ? 'REORDER' : 'OK',
      expiringSoon: live.filter((b) => b.expiryAt && b.expiryAt <= horizon).length,
      expired: item.batches.length - live.length,
    };
  });
}

/**
 * Raise what stock levels demand (automation A13 and A14).
 *
 * Idempotent by headline while an item stays below its level: a threshold that
 * is crossed once should not produce an alert every five minutes for a week.
 */
export async function runInventoryChecks(
  client: TenantPrisma,
  clock: Clock,
  organizationId: string,
  clinicId: string,
): Promise<{ shortages: number; reorders: number; expiring: number }> {
  const levels = await stockLevels(client, clock, clinicId);
  const now = clock.now();
  let shortages = 0, reorders = 0, expiring = 0;

  const raiseOnce = async (code: string, severity: string, headline: string, detail: string) => {
    const already = await client.attentionItem.findFirst({
      where: {
        organizationId, clinicId, code, headline,
        status: {
          in: [ExceptionStatus.OPEN, ExceptionStatus.ACKNOWLEDGED, ExceptionStatus.ACTION_IN_PROGRESS],
        },
      },
    });
    if (already) return false;
    await client.attentionItem.create({
      data: {
        organizationId, clinicId, code, severity, headline, detail,
        status: ExceptionStatus.OPEN, dueAt: now,
      },
    });
    return true;
  };

  for (const l of levels) {
    if (l.state === 'SHORTAGE') {
      if (await raiseOnce(
        'INV.THRESHOLD.SHORTAGE', Priority.CRITICAL,
        `${l.name} is below minimum stock`,
        `${l.available} ${l.available === 1 ? 'unit' : 'units'} usable against a minimum of ${l.minimumQty}.`,
      )) shortages += 1;
    } else if (l.state === 'REORDER') {
      if (await raiseOnce(
        'INV.THRESHOLD.REORDER', Priority.IMPORTANT,
        `${l.name} has reached its reorder level`,
        `${l.available} usable, reorder at ${l.reorderLevel}.`,
      )) reorders += 1;
    }

    if (l.expiringSoon > 0) {
      if (await raiseOnce(
        'INV.EXPIRY.APPROACHING', Priority.CRITICAL,
        `${l.name} has stock expiring soon`,
        `${l.expiringSoon} ${l.expiringSoon === 1 ? 'batch' : 'batches'} within the expiry horizon.`,
      )) expiring += 1;
    }
  }
  return { shortages, reorders, expiring };
}

export interface ComponentRequirement {
  componentType: string;
  brand: string;
  line: string;
  platform: string;
  diameterMm?: number;
  lengthMm?: number;
}

export interface ComponentAnswer {
  requirement: ComponentRequirement;
  result: EvaluationResult;
  detail: string;
}

/**
 * Whether every component a surgery needs is actually on the shelf, in date.
 *
 * Answers per component rather than overall, so the exception names the part.
 * "Implant not ready" sends somebody to look; "healing abutment 4.5×5 not in
 * stock" tells them what to order.
 */
export async function implantReadiness(
  client: TenantPrisma,
  clock: Clock,
  clinicId: string,
  requirements: ComponentRequirement[],
): Promise<{ ready: boolean; answers: ComponentAnswer[] }> {
  const now = clock.now();
  const answers: ComponentAnswer[] = [];

  for (const req of requirements) {
    const matches = await client.implantSku.findMany({
      where: {
        clinicId,
        componentType: req.componentType,
        brand: req.brand,
        line: req.line,
        platform: req.platform,
        ...(req.diameterMm !== undefined ? { diameterMm: req.diameterMm } : {}),
        ...(req.lengthMm !== undefined ? { lengthMm: req.lengthMm } : {}),
      },
    });

    const size = [req.diameterMm, req.lengthMm].filter((v) => v !== undefined).join('×');
    const label = `${req.componentType.toLowerCase().replace(/_/g, ' ')}${size ? ` ${size}` : ''}`;

    if (matches.length === 0) {
      // Nothing on file is not the same as nothing in stock, but neither is a
      // reason to proceed — and under AP-1 both must block.
      answers.push({
        requirement: req,
        result: EvaluationResult.UNKNOWN,
        detail: `No ${label} of this specification is on file for this clinic.`,
      });
      continue;
    }

    const inDate = matches.filter((m) => (!m.expiryAt || m.expiryAt > now) && m.quantity > 0);
    if (inDate.length === 0) {
      const expiredOnly = matches.some((m) => m.expiryAt && m.expiryAt <= now && m.quantity > 0);
      answers.push({
        requirement: req,
        result: EvaluationResult.FAIL,
        detail: expiredOnly
          ? `${label} is in stock but expired.`
          : `${label} not in stock.`,
      });
      continue;
    }

    answers.push({
      requirement: req,
      result: EvaluationResult.PASS,
      detail: `${inDate.reduce((n, m) => n + m.quantity, 0)} in stock, in date.`,
    });
  }

  return { ready: answers.every((a) => a.result === EvaluationResult.PASS), answers };
}

/**
 * Consume an implant component at placement (IMP-005).
 *
 * Refuses to go negative rather than recording an impossible number: a stock
 * count that can drift below zero stops being evidence of anything.
 */
export async function consumeImplant(
  client: TenantPrisma,
  skuId: string,
  quantity = 1,
): Promise<{ remaining: number }> {
  const sku = await client.implantSku.findUnique({ where: { id: skuId } });
  if (!sku) throw new InventoryError('No such implant component.', 'NO_SKU');
  if (sku.quantity < quantity) {
    throw new InventoryError(
      `Only ${sku.quantity} in stock; cannot consume ${quantity}.`,
      'INSUFFICIENT_STOCK',
    );
  }
  const updated = await client.implantSku.update({
    where: { id: skuId },
    data: { quantity: { decrement: quantity } },
  });
  return { remaining: updated.quantity };
}
