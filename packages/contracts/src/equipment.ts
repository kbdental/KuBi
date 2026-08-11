/**
 * The equipment engine — every asset carries its own record, and the record
 * generates the work.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The idea, in the owner's words
 * ─────────────────────────────────────────────────────────────────────────
 *
 * *"Every important asset should have its own digital record… If Next Service
 * Date = Today, the app automatically creates the service task."*
 *
 * So `dueFor()` derives the work from the record and the log. Nobody creates a
 * service task, nobody remembers an AMC expiry, and nobody has to notice that
 * the compressor has been down for three days — the record says when it was
 * last serviced and how often it needs to be, and the arithmetic does the
 * rest.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Where "next service = today" is not enough
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A rule that fires *on* the due date fires too late for anything with a
 * vendor in it. An AMC that expires today cannot be renewed today; an
 * autoclave validation booked on the morning it falls due means a day with no
 * sterilisation. So every cycle here carries a **warn ahead** as well as a
 * period, and the task appears at `next − warnAhead` rather than at `next`.
 * The owner's rule is the floor, not the ceiling: what fires on the day is the
 * *overdue* state, which is a different and louder thing.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Where UNKNOWN is never PASS bites again
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The tempting implementation is `nextService = lastService + period`, and
 * when `lastService` is unknown that arithmetic quietly produces nothing — so
 * an asset nobody has ever serviced reports **no service due**, which is the
 * exact opposite of the truth.
 *
 * Here `lastServicedAt` is `number | null`, a null next service is never read
 * as "not due", and an asset with no service history at all is reported as
 * `UNSERVICED` — the loudest state in the file, above overdue, because a
 * machine with no history is a machine nobody can vouch for. Constitution
 * rule 1, applied to a compressor.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Roles, never people
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The owner's list says *"responsible person"*. It is stored here as a
 * **role**, on his own instruction — *"names can change but roles do not
 * change"* — so the record survives the person leaving. The log still shows
 * which employee did the check; that is provenance, not the master.
 */
import { RoleCode } from './enums.js';
import { Objective } from './objectives.js';
import { ClinicEvent } from './operating-model.js';
import type { ReadinessEvent } from './readiness.js';

const DAY = 24 * 60;
/** Days as minutes, because every clock in this system is a minute. */
const days = (n: number) => n * DAY;

/* -------------------------------------------------------------------------
 * The record
 * ---------------------------------------------------------------------- */

export const AssetCategory = {
  /** In an operatory, used on a patient. */
  CHAIRSIDE: 'CHAIRSIDE',
  /** The instrument loop. */
  STERILIZATION: 'STERILIZATION',
  /** Radiography. */
  IMAGING: 'IMAGING',
  /** Plant — compressor, suction, pumps. Nothing works without these. */
  PLANT: 'PLANT',
  /** The building: power, water, air, cold. */
  FACILITY: 'FACILITY',
  /** Emergency and safety equipment. */
  SAFETY: 'SAFETY',
  /** Reception, records, money. */
  FRONT_OFFICE: 'FRONT_OFFICE',
  /** In-house laboratory. */
  LABORATORY: 'LABORATORY',
} as const;
export type AssetCategory = (typeof AssetCategory)[keyof typeof AssetCategory];

/** How badly the clinic needs it, which decides what its failure stops. */
export const Criticality = {
  /** The clinic cannot see patients without it. */
  STOPS_CLINIC: 'STOPS_CLINIC',
  /** One room or one kind of treatment stops. */
  STOPS_WORK: 'STOPS_WORK',
  /** Inconvenient, and the day continues. */
  DEGRADES: 'DEGRADES',
} as const;
export type Criticality = (typeof Criticality)[keyof typeof Criticality];

/** A recurring obligation against an asset. */
export interface Cycle {
  id: string;
  label: string;
  /** How often, in days. */
  everyDays: number;
  /**
   * How many days before it falls due the work should appear.
   *
   * Zero is legitimate — a daily wipe-down needs no warning. Anything with a
   * vendor, a booking or a consumable in it needs one, because a task that
   * appears on the morning it is due is a task that is already late.
   */
  warnAheadDays: number;
  owner: RoleCode;
  /** Said to whoever has to act on it. */
  because: string;
  /** Whether the clinic may keep using the asset once this is overdue. */
  blocks: boolean;
}

export interface Asset {
  /** The owner's "Asset ID". Human, printable, stuck on the machine. */
  tag: string;
  name: string;
  category: AssetCategory;
  /** Where it is. An operatory id, or a named place. */
  location: string;
  /** The owner's "responsible person", held as a role. */
  responsible: RoleCode;
  criticality: Criticality;
  make: string;
  model: string;
  serial: string;
  /** Minute the clinic took delivery. Null when nobody recorded it. */
  commissionedAt: number | null;
  /** Warranty expiry. Null when unknown — which is not the same as expired. */
  warrantyUntil: number | null;
  /** Annual maintenance contract, where one exists. */
  amc: {
    vendor: string;
    /** Null when there is a vendor but nobody recorded the expiry. */
    until: number | null;
    /** What it actually covers, in the vendor's own words. */
    covers: string;
  } | null;
  /** Documents held. An empty list is a finding, not a blank. */
  documents: readonly string[];
  /**
   * The daily check, where the asset has one.
   *
   * Deliberately a sentence rather than a boolean: "switch it on" is not a
   * check, and a daily check with no pass test is a tick somebody learns to
   * do from the corridor.
   */
  dailyCheck: string | null;
  cycles: readonly Cycle[];
}

/* -------------------------------------------------------------------------
 * State, derived
 * ---------------------------------------------------------------------- */

export const AssetState = {
  /** Working, and everything due against it is in date. */
  OPERATIONAL: 'OPERATIONAL',
  /** Working, and something is overdue against it. */
  OVERDUE: 'OVERDUE',
  /** Reported broken and not yet reported back. */
  DOWN: 'DOWN',
  /**
   * Nobody has ever recorded a service against it.
   *
   * Not "not due". The loudest state in the file, because a machine with no
   * history is a machine nobody can vouch for, and the arithmetic that
   * produces a due date cannot run at all.
   */
  UNSERVICED: 'UNSERVICED',
} as const;
export type AssetState = (typeof AssetState)[keyof typeof AssetState];

/** One piece of work the record generated. */
export interface AssetTask {
  assetTag: string;
  assetName: string;
  cycleId: string;
  label: string;
  owner: RoleCode;
  objective: Objective;
  /** The minute it falls due. Null only for an asset with no history. */
  dueAt: number | null;
  /** Past its due date and not done. */
  overdue: boolean;
  /** Days late, or days remaining as a negative. Null when there is no date. */
  daysLate: number | null;
  blocks: boolean;
  because: string;
}

export interface AssetRecord {
  asset: Asset;
  state: AssetState;
  /**
   * Whether this asset has a vendor service interval at all.
   *
   * Some genuinely do not — a curing light has a monthly radiometer reading
   * and no service contract, and a fridge has a temperature log and no
   * engineer. Without this flag both report "never serviced", which reads as
   * neglect rather than as a machine that does not need servicing. Three
   * different things — no interval, an interval nobody has ever met, and an
   * interval that has lapsed — and a screen that shows two of them the same
   * way trains people to ignore all three.
   */
  hasServiceCycle: boolean;
  /** The minute it was last serviced, from the log. */
  lastServicedAt: number | null;
  /** `lastServicedAt` plus the service period. Null when there is no history. */
  nextServiceAt: number | null;
  /** Today's check, where the asset has one and it has not been done. */
  checkDue: boolean;
  /** Work this record generated, worst first. */
  due: readonly AssetTask[];
  /** Times it has failed, from the log. */
  breakdowns: number;
  /** Minutes it has been out of service, all time. Counts an open failure. */
  downtimeMinutes: number;
  /** Down now, and since when. */
  downSince: number | null;
  /** The AMC has expired, or expires within the warning window. */
  amcAction: 'EXPIRED' | 'EXPIRING' | 'NO_EXPIRY_RECORDED' | 'NONE' | 'OK';
  /**
   * Everything about this record that nobody has answered.
   *
   * Named rather than defaulted. A missing serial number is a gap in the
   * register; a missing service history is a gap in the machine's safety.
   */
  unknowns: readonly string[];
  /** The one sentence for whoever is looking at this asset. */
  headline: string;
}

/* -------------------------------------------------------------------------
 * Cycle shorthands
 * ---------------------------------------------------------------------- */

const cycle = (
  id: string, label: string, everyDays: number, warnAheadDays: number,
  owner: RoleCode, because: string, blocks = false,
): Cycle => ({ id, label, everyDays, warnAheadDays, owner, because, blocks });

const SNR = RoleCode.SENIOR_ASSISTANT;
const ASST = RoleCode.DENTAL_ASSISTANT;
const STER = RoleCode.STERILIZATION_TECHNICIAN;
const MGR = RoleCode.CLINIC_MANAGER;
const REC = RoleCode.RECEPTION;
const HK = RoleCode.HOUSEKEEPING;

/** The ordinary vendor service, at whatever interval the asset needs. */
const service = (everyDays: number, owner = MGR, blocks = false) =>
  cycle('SERVICE', 'Service due', everyDays, 14, owner,
    'The service interval for this asset has come round', blocks);

/* -------------------------------------------------------------------------
 * The register
 *
 * A real clinic's asset list for four operatories, a sterilisation room, a
 * front office and the building. Synthetic — the tags, serials and dates are
 * made up — and it is the shape that matters: the clinic's own list replaces
 * it row for row without a line of this file changing.
 * ---------------------------------------------------------------------- */

const asset = (a: Asset): Asset => a;

/** Four rooms, and the kit that lives in each of them. */
function chairsideFor(n: number): Asset[] {
  const where = `Operatory ${n}`;
  const s = (x: string) => `${x}-${String(n).padStart(2, '0')}`;
  return [
    asset({
      tag: s('CHAIR'), name: `Dental chair unit ${n}`, category: AssetCategory.CHAIRSIDE,
      location: where, responsible: ASST, criticality: Criticality.STOPS_WORK,
      make: 'Confident', model: 'Elite', serial: `CE-2200${n}`,
      commissionedAt: null, warrantyUntil: null,
      amc: { vendor: 'Confident Service', until: days(210), covers: 'Chair, light, spittoon, upholstery. Labour and travel; parts extra.' },
      documents: ['Installation certificate', 'User manual'],
      dailyCheck: 'Back, up/down and headrest all move; light comes on; spittoon flushes',
      cycles: [service(180, MGR), cycle('UPHOLSTERY', 'Upholstery inspection', 90, 7, ASST,
        'Torn upholstery cannot be disinfected, and this one has not been looked at')],
    }),
    asset({
      tag: s('XRAY'), name: `Intraoral X-ray ${n}`, category: AssetCategory.IMAGING,
      location: where, responsible: SNR, criticality: Criticality.STOPS_WORK,
      make: 'Genoray', model: 'Port-X', serial: `GX-77${n}0`,
      commissionedAt: null, warrantyUntil: days(120),
      amc: null,
      documents: ['AERB registration', 'Radiation survey report'],
      dailyCheck: 'Powers up, exposure indicator works, cone is undamaged',
      cycles: [
        service(365, MGR),
        cycle('AERB', 'AERB licence renewal', 730, 60, MGR,
          'An X-ray unit operating on a lapsed AERB licence is operating illegally', true),
        cycle('QA', 'Radiation output and leakage check', 365, 30, MGR,
          'The annual radiation quality assurance check is due', true),
      ],
    }),
    asset({
      tag: s('RVG'), name: `RVG sensor ${n}`, category: AssetCategory.IMAGING,
      location: where, responsible: ASST, criticality: Criticality.STOPS_WORK,
      make: 'Carestream', model: 'RVG 5200', serial: `CS-52${n}18`,
      commissionedAt: null, warrantyUntil: null, amc: null,
      documents: ['User manual'],
      dailyCheck: 'Captures a test image; cable has no kinks at the strain relief',
      cycles: [cycle('CABLE', 'Sensor cable inspection', 30, 3, ASST,
        'RVG sensors die at the cable, and this one has not been looked at')],
    }),
    asset({
      tag: s('SCALER'), name: `Ultrasonic scaler ${n}`, category: AssetCategory.CHAIRSIDE,
      location: where, responsible: ASST, criticality: Criticality.DEGRADES,
      make: 'Woodpecker', model: 'UDS-J', serial: `WP-J${n}442`,
      commissionedAt: null, warrantyUntil: null, amc: null,
      documents: [],
      dailyCheck: 'Activates, water flows through the tip, tip is not worn short',
      cycles: [cycle('TIPS', 'Scaler tip wear check', 90, 7, ASST,
        'A scaler tip worn 2 mm short has lost half its power, and nobody has measured these')],
    }),
    asset({
      tag: s('CURE'), name: `Curing light ${n}`, category: AssetCategory.CHAIRSIDE,
      location: where, responsible: ASST, criticality: Criticality.STOPS_WORK,
      make: 'Ivoclar', model: 'Bluephase', serial: `IV-BP${n}09`,
      commissionedAt: null, warrantyUntil: null, amc: null,
      documents: ['User manual'],
      dailyCheck: 'Charged, emits, light guide is clean and uncracked',
      cycles: [cycle('RADIOMETER', 'Output measured on a radiometer', 30, 3, ASST,
        'A curing light losing output cures nothing properly and looks identical, and this one has not been measured', true)],
    }),
  ];
}

export const ASSETS: readonly Asset[] = [
  ...chairsideFor(1), ...chairsideFor(2), ...chairsideFor(3), ...chairsideFor(4),

  /* ── The instrument loop ────────────────────────────────────────────── */
  asset({
    tag: 'AUTOCLAVE-01', name: 'Autoclave', category: AssetCategory.STERILIZATION,
    location: 'Sterilisation room', responsible: STER, criticality: Criticality.STOPS_CLINIC,
    make: 'Runyes', model: 'Class B 23L', serial: 'RY-B23-4471',
    commissionedAt: null, warrantyUntil: null,
    amc: { vendor: 'Runyes India', until: days(96), covers: 'Two preventive visits a year, gasket and filter included, chamber excluded.' },
    documents: ['Installation qualification', 'User manual', 'Validation certificate'],
    dailyCheck: 'Water level, door gasket intact, Bowie-Dick or helix pack passes on the first cycle',
    cycles: [
      service(180, MGR, true),
      cycle('SPORE', 'Biological spore test', 7, 1, STER,
        'A week has passed with no spore test, so nothing since the last one has been proven sterile', true),
      cycle('VALIDATION', 'Annual validation', 365, 45, MGR,
        'The autoclave’s annual validation is due, and it cannot be booked on the day', true),
      cycle('GASKET', 'Door gasket replacement', 365, 21, STER,
        'The door gasket is a consumable and this one is at the end of its year'),
    ],
  }),
  asset({
    tag: 'ULTRASONIC-01', name: 'Ultrasonic cleaner', category: AssetCategory.STERILIZATION,
    location: 'Sterilisation room', responsible: STER, criticality: Criticality.STOPS_WORK,
    make: 'Confident', model: 'CD-4820', serial: 'CD-4820-119',
    commissionedAt: null, warrantyUntil: null, amc: null,
    documents: ['User manual'],
    dailyCheck: 'Solution level and freshness; cavitation confirmed on a foil test weekly',
    cycles: [
      service(365, MGR),
      cycle('FOIL', 'Foil cavitation test', 7, 1, STER,
        'An ultrasonic cleaner that has stopped cavitating looks and sounds exactly the same', true),
      cycle('SOLUTION', 'Solution changed', 1, 0, STER,
        'The solution has not been changed today'),
    ],
  }),
  asset({
    tag: 'SEALER-01', name: 'Pouch sealing machine', category: AssetCategory.STERILIZATION,
    location: 'Sterilisation room', responsible: STER, criticality: Criticality.STOPS_CLINIC,
    make: 'Hawo', model: 'hm 500 DC-V', serial: 'HW-500-882',
    commissionedAt: null, warrantyUntil: null, amc: null,
    documents: [],
    dailyCheck: 'Seal temperature reached; a test pouch peels cleanly with no channels',
    cycles: [
      service(365, MGR),
      cycle('SEAL_TEST', 'Seal integrity test', 30, 3, STER,
        'A failing seal is invisible until a pack is opened contaminated', true),
    ],
  }),
  asset({
    tag: 'DISTILLER-01', name: 'Water distiller', category: AssetCategory.STERILIZATION,
    location: 'Sterilisation room', responsible: STER, criticality: Criticality.STOPS_CLINIC,
    make: 'Megahome', model: 'MH943', serial: 'MH-943-206',
    commissionedAt: null, warrantyUntil: null, amc: null,
    documents: [],
    dailyCheck: 'Output conductivity acceptable; boiling chamber not scaled',
    cycles: [cycle('DESCALE', 'Descale', 30, 3, STER,
      'A scaled distiller feeds the autoclave hard water, which is how chambers are ruined')],
  }),
  asset({
    tag: 'UV-01', name: 'UV cabinet — sterilisation room', category: AssetCategory.STERILIZATION,
    location: 'Sterilisation room', responsible: STER, criticality: Criticality.DEGRADES,
    make: 'Confident', model: 'UV-90', serial: 'CU-90-337',
    commissionedAt: null, warrantyUntil: null, amc: null,
    documents: [],
    dailyCheck: 'UV lamp lights and the interlock stops it with the door open',
    cycles: [cycle('LAMP', 'UV lamp replacement', 365, 21, STER,
      'A UV lamp past its hours still glows and no longer disinfects', true)],
  }),
  asset({
    tag: 'NEEDLE-01', name: 'Needle destroyer', category: AssetCategory.STERILIZATION,
    location: 'Sterilisation room', responsible: STER, criticality: Criticality.DEGRADES,
    make: 'Sharps', model: 'ND-2', serial: 'SH-ND2-054',
    commissionedAt: null, warrantyUntil: null, amc: null,
    documents: [],
    dailyCheck: 'Burns through a test needle; collection chamber below the fill line',
    cycles: [cycle('EMPTY', 'Chamber emptied to the sharps stream', 7, 1, STER,
      'The needle destroyer chamber has not been emptied this week')],
  }),

  /* ── Plant ──────────────────────────────────────────────────────────── */
  asset({
    tag: 'COMPRESSOR-01', name: 'Air compressor', category: AssetCategory.PLANT,
    location: 'Plant room', responsible: MGR, criticality: Criticality.STOPS_CLINIC,
    make: 'Josef Kaeser', model: 'Dental 3', serial: 'JK-D3-7714',
    commissionedAt: null, warrantyUntil: null,
    amc: { vendor: 'Airtech Services', until: days(41), covers: 'Two visits a year, filters included, receiver and motor excluded.' },
    documents: ['Pressure vessel certificate', 'User manual'],
    dailyCheck: 'Switched on with a 5-minute warm-up; pressure gauge reads working range; tank drained',
    cycles: [
      service(180, MGR, true),
      cycle('DRAIN', 'Receiver drained of condensate', 1, 0, ASST,
        'The compressor receiver has not been drained today, and standing water rusts it from the inside'),
      cycle('FILTER', 'Air filter changed', 180, 14, MGR,
        'The compressor air filter is due'),
      cycle('VESSEL', 'Pressure vessel inspection', 730, 60, MGR,
        'A pressure vessel inspection is a statutory certificate, not a service', true),
    ],
  }),
  asset({
    tag: 'SUCTION-01', name: 'Central suction pump', category: AssetCategory.PLANT,
    location: 'Plant room', responsible: MGR, criticality: Criticality.STOPS_CLINIC,
    make: 'Cattani', model: 'Turbo Smart', serial: 'CT-TS-3390',
    commissionedAt: null, warrantyUntil: null,
    amc: { vendor: 'Cattani Care', until: null, covers: 'Annual service and amalgam separator servicing.' },
    documents: ['User manual'],
    dailyCheck: 'Suction strength at the furthest operatory; filters clear',
    cycles: [
      service(180, MGR, true),
      cycle('LINE_CLEAN', 'Suction lines flushed and disinfected', 1, 0, ASST,
        'The suction lines have not been flushed today'),
      cycle('AMALGAM', 'Amalgam separator emptied and disposed to record', 180, 21, MGR,
        'An amalgam separator past capacity discharges mercury to drain', true),
    ],
  }),
  asset({
    tag: 'PUMP-01', name: 'Water pump', category: AssetCategory.FACILITY,
    location: 'Plant room', responsible: HK, criticality: Criticality.STOPS_CLINIC,
    make: 'Crompton', model: 'Mini Champ', serial: 'CR-MC-2210',
    commissionedAt: null, warrantyUntil: null, amc: null,
    documents: [],
    // The morning's OPEN-010, which had no home until this register existed.
    dailyCheck: 'Started at opening; overhead tank filling; no dry running',
    cycles: [service(365, MGR)],
  }),

  /* ── Imaging, central ───────────────────────────────────────────────── */
  asset({
    tag: 'OPG-01', name: 'OPG and cephalometric unit', category: AssetCategory.IMAGING,
    location: 'X-ray room', responsible: SNR, criticality: Criticality.STOPS_WORK,
    make: 'Vatech', model: 'PaX-i', serial: 'VT-PXI-5502',
    commissionedAt: null, warrantyUntil: null,
    amc: { vendor: 'Vatech India', until: days(158), covers: 'One preventive visit, software updates, tube excluded.' },
    documents: ['AERB licence', 'Radiation survey report', 'Installation certificate'],
    dailyCheck: 'Powers up, positioning lasers align, test exposure is clean',
    cycles: [
      service(365, MGR),
      cycle('AERB', 'AERB licence renewal', 730, 60, MGR,
        'An OPG operating on a lapsed AERB licence is operating illegally', true),
      cycle('QA', 'Radiation output and image quality check', 365, 30, MGR,
        'The annual radiation quality assurance check is due', true),
    ],
  }),
  asset({
    tag: 'SCANNER-01', name: 'Intraoral scanner', category: AssetCategory.CHAIRSIDE,
    location: 'Mobile — trolley', responsible: SNR, criticality: Criticality.DEGRADES,
    make: 'Medit', model: 'i700', serial: 'MD-i700-441',
    commissionedAt: null, warrantyUntil: days(280), amc: null,
    documents: ['User manual', 'Calibration record'],
    dailyCheck: 'Boots, tip heater reaches temperature, a test scan stitches',
    cycles: [cycle('CALIBRATE', 'Scanner calibration', 90, 7, SNR,
      'An uncalibrated scanner produces work the laboratory cannot fit', true)],
  }),

  /* ── Laboratory ─────────────────────────────────────────────────────── */
  asset({
    tag: 'LAB-MICRO-01', name: 'Laboratory micromotor', category: AssetCategory.LABORATORY,
    location: 'Laboratory', responsible: SNR, criticality: Criticality.DEGRADES,
    make: 'Marathon', model: 'N7', serial: 'MR-N7-812',
    commissionedAt: null, warrantyUntil: null, amc: null,
    documents: [],
    dailyCheck: 'Runs smoothly through its range with no vibration',
    cycles: [service(365, MGR)],
  }),
  asset({
    tag: 'TRIMMER-01', name: 'Model trimmer', category: AssetCategory.LABORATORY,
    location: 'Laboratory', responsible: SNR, criticality: Criticality.DEGRADES,
    make: 'Confident', model: 'MT-10', serial: 'CM-10-663',
    commissionedAt: null, warrantyUntil: null, amc: null,
    documents: [],
    dailyCheck: 'Water flows over the disc; disc is not glazed',
    cycles: [cycle('DISC', 'Trimmer disc replacement', 365, 21, SNR,
      'A glazed trimmer disc burns models rather than cutting them')],
  }),

  /* ── Facility ───────────────────────────────────────────────────────── */
  asset({
    tag: 'UPS-01', name: 'UPS and inverter', category: AssetCategory.FACILITY,
    location: 'Plant room', responsible: MGR, criticality: Criticality.STOPS_CLINIC,
    make: 'Luminous', model: 'Zelio 1100', serial: 'LM-Z1100-914',
    commissionedAt: null, warrantyUntil: null, amc: null,
    documents: [],
    dailyCheck: 'On mains, battery indicator healthy, no alarm',
    cycles: [
      cycle('LOAD_TEST', 'Battery load test', 90, 7, MGR,
        'A UPS battery that has never been load tested is a UPS nobody has proved', true),
      service(365, MGR),
    ],
  }),
  asset({
    tag: 'AC-RECEPTION', name: 'Air conditioner — reception', category: AssetCategory.FACILITY,
    location: 'Reception', responsible: HK, criticality: Criticality.DEGRADES,
    make: 'Daikin', model: 'FTKF50', serial: 'DK-F50-3301',
    commissionedAt: null, warrantyUntil: null,
    amc: { vendor: 'CoolCare', until: days(63), covers: 'Quarterly cleaning and gas top-up.' },
    documents: [],
    dailyCheck: 'Set to 24 °C and reaching it; no water dripping from the indoor unit',
    cycles: [cycle('CLEAN', 'Filter clean', 90, 7, HK,
      'A dirty AC filter in a clinical space is an air quality problem, not a comfort one')],
  }),
  asset({
    tag: 'PURIFIER-01', name: 'Air purifier and diffuser', category: AssetCategory.FACILITY,
    location: 'Reception', responsible: HK, criticality: Criticality.DEGRADES,
    make: 'Philips', model: 'AC2887', serial: 'PH-2887-771',
    commissionedAt: null, warrantyUntil: null, amc: null,
    documents: [],
    dailyCheck: 'Running; filter indicator not red',
    cycles: [cycle('FILTER', 'HEPA filter replacement', 180, 14, HK,
      'A saturated HEPA filter is a fan')],
  }),
  asset({
    tag: 'RO-01', name: 'RO water purifier', category: AssetCategory.FACILITY,
    location: 'Pantry', responsible: HK, criticality: Criticality.DEGRADES,
    make: 'Kent', model: 'Grand Plus', serial: 'KT-GP-5528',
    commissionedAt: null, warrantyUntil: null, amc: null,
    documents: [],
    dailyCheck: 'Dispenses; no leak at the tap',
    cycles: [cycle('FILTER', 'Filter and membrane service', 180, 14, HK,
      'The RO filters are past their interval, and this is the water that goes into patients’ mouths')],
  }),
  asset({
    tag: 'FRIDGE-01', name: 'Refrigerator — medicaments', category: AssetCategory.FACILITY,
    location: 'Sterilisation room', responsible: ASST, criticality: Criticality.STOPS_WORK,
    make: 'Godrej', model: 'RD Edge', serial: 'GJ-RD-1180',
    commissionedAt: null, warrantyUntil: null, amc: null,
    documents: [],
    dailyCheck: 'Temperature between 2 and 8 °C, read and written down',
    cycles: [cycle('TEMP_LOG', 'Temperature log reviewed', 7, 1, ASST,
      'A week of temperature readings nobody has looked at is a week of readings', true)],
  }),

  /* ── Safety ─────────────────────────────────────────────────────────── */
  asset({
    tag: 'EMERGENCY-01', name: 'Emergency drug kit', category: AssetCategory.SAFETY,
    location: 'Sterilisation room', responsible: SNR, criticality: Criticality.STOPS_CLINIC,
    make: '—', model: 'Clinic kit', serial: '—',
    commissionedAt: null, warrantyUntil: null, amc: null,
    documents: ['Contents list with expiry dates'],
    // The morning's OPEN-012, which had no home until this register existed.
    dailyCheck: 'Kit present, sealed, and nothing expiring inside 30 days',
    cycles: [
      cycle('EXPIRY', 'Expiry check against the contents list', 30, 7, SNR,
        'An emergency drug nobody has checked is an emergency drug that has expired', true),
      cycle('DRILL', 'Medical emergency drill', 180, 21, MGR,
        'A kit nobody has practised with is a box'),
    ],
  }),
  asset({
    tag: 'OXYGEN-01', name: 'Oxygen cylinder and mask', category: AssetCategory.SAFETY,
    location: 'Sterilisation room', responsible: SNR, criticality: Criticality.STOPS_CLINIC,
    make: 'INOX', model: 'D-type', serial: 'IN-D-4409',
    commissionedAt: null, warrantyUntil: null, amc: null,
    documents: ['Cylinder test certificate'],
    dailyCheck: 'Cylinder pressure above the refill line; mask and tubing present and sealed',
    cycles: [
      cycle('PRESSURE', 'Pressure checked and refill arranged', 30, 7, SNR,
        'An oxygen cylinder nobody has read the gauge on is an oxygen cylinder of unknown volume', true),
      cycle('HYDRO', 'Cylinder hydrostatic test', 1825, 90, MGR,
        'A cylinder past its hydrostatic test date may not legally be refilled', true),
    ],
  }),
  asset({
    tag: 'FIRE-01', name: 'Fire extinguisher — CO2', category: AssetCategory.SAFETY,
    location: 'Corridor', responsible: MGR, criticality: Criticality.DEGRADES,
    make: 'Ceasefire', model: 'CO2 4.5kg', serial: 'CF-CO2-2287',
    commissionedAt: null, warrantyUntil: null, amc: null,
    documents: ['Refill certificate'],
    dailyCheck: null,
    cycles: [cycle('REFILL', 'Extinguisher pressure test and refill', 365, 30, MGR,
      'An extinguisher past its refill date is a red cylinder', true)],
  }),

  /* ── Front office ───────────────────────────────────────────────────── */
  asset({
    tag: 'DVR-01', name: 'CCTV recorder', category: AssetCategory.FRONT_OFFICE,
    location: 'Reception', responsible: REC, criticality: Criticality.DEGRADES,
    make: 'Hikvision', model: 'DS-7108', serial: 'HK-7108-661',
    commissionedAt: null, warrantyUntil: null, amc: null,
    documents: [],
    dailyCheck: 'Recording, all cameras live, disk not full',
    cycles: [cycle('RETENTION', 'Recording retention confirmed', 30, 3, REC,
      'A DVR quietly overwriting at seven days is a DVR nobody can produce footage from')],
  }),
  asset({
    tag: 'SERVER-01', name: 'Practice computer and backup', category: AssetCategory.FRONT_OFFICE,
    location: 'Reception', responsible: MGR, criticality: Criticality.STOPS_CLINIC,
    make: 'Dell', model: 'OptiPlex 7010', serial: 'DL-7010-8823',
    commissionedAt: null, warrantyUntil: null, amc: null,
    documents: [],
    dailyCheck: 'Backup ran last night and completed',
    cycles: [
      cycle('RESTORE_TEST', 'Backup restore actually tested', 90, 14, MGR,
        'A backup nobody has restored from is a backup nobody has', true),
      service(365, MGR),
    ],
  }),
  asset({
    tag: 'CARDPOS-01', name: 'Card machine', category: AssetCategory.FRONT_OFFICE,
    location: 'Reception', responsible: REC, criticality: Criticality.DEGRADES,
    make: 'Pine Labs', model: 'A910', serial: 'PL-A910-3390',
    commissionedAt: null, warrantyUntil: null, amc: null,
    documents: [],
    dailyCheck: 'Powers up, connects, roll loaded',
    cycles: [cycle('SETTLE', 'Batch settlement reconciled to the bank', 1, 0, REC,
      'Today’s card batch has not been reconciled')],
  }),
];

export const ASSET_BY_TAG: ReadonlyMap<string, Asset> =
  new Map(ASSETS.map((a) => [a.tag, a]));

/**
 * The register above is synthetic, and the owner has offered the real one.
 *
 * Same reason as the treatment catalogue: this exists so the engine has
 * something to run on, and a screen can say so rather than letting a made-up
 * serial number pass as the clinic's. It becomes false when the clinic's own
 * asset list has been loaded.
 */
export const UNRATIFIED_REGISTER = true;

/* -------------------------------------------------------------------------
 * The calculation
 * ---------------------------------------------------------------------- */

const lastAt = (
  events: readonly ReadinessEvent[], type: ClinicEvent, subject: string,
): number | null => {
  let latest: number | null = null;
  for (const e of events) {
    if (e.type === type && e.subjectId === subject) {
      latest = latest === null ? e.at : Math.max(latest, e.at);
    }
  }
  return latest;
};

const startOfDay = (m: number) => Math.floor(m / DAY) * DAY;

/**
 * Everything one asset's record generates, as of `now`.
 *
 * Pure, like every other engine here: hand it an asset, the log and a minute
 * and it will tell you about that minute.
 */
export function recordFor(
  a: Asset, events: readonly ReadinessEvent[], now: number,
): AssetRecord {
  const unknowns: string[] = [];

  const failedAt = lastAt(events, ClinicEvent.ASSET_FAILED, a.tag);
  const restoredAt = lastAt(events, ClinicEvent.ASSET_RESTORED, a.tag);
  const downSince = failedAt !== null && (restoredAt === null || restoredAt < failedAt)
    ? failedAt : null;

  const breakdowns = events.filter(
    (e) => e.type === ClinicEvent.ASSET_FAILED && e.subjectId === a.tag).length;

  // Closed failures, plus the one that is still open, counted to now.
  let downtime = 0;
  let openedAt: number | null = null;
  for (const e of [...events].sort((x, y) => x.at - y.at)) {
    if (e.subjectId !== a.tag) continue;
    if (e.type === ClinicEvent.ASSET_FAILED && openedAt === null) openedAt = e.at;
    if (e.type === ClinicEvent.ASSET_RESTORED && openedAt !== null) {
      downtime += e.at - openedAt;
      openedAt = null;
    }
  }
  if (openedAt !== null) downtime += now - openedAt;

  /* ── Cycles ──────────────────────────────────────────────────────────
     One rule, applied to every cycle the asset carries. The owner's
     "next service = today" is the overdue case; the task itself appears
     `warnAheadDays` earlier, because anything with a vendor in it cannot be
     arranged on the morning it falls due. */
  const due: AssetTask[] = [];
  let anyOverdue = false;
  let unserviced = false;

  for (const c of a.cycles) {
    const last = lastAt(events, ClinicEvent.ASSET_SERVICED, `${a.tag}#${c.id}`);

    if (last === null) {
      // No history at all. Not "not due" — the arithmetic cannot run, and an
      // asset nobody has ever serviced is the loudest thing on this screen.
      unserviced = true;
      unknowns.push(`${c.label} has never been recorded against this asset`);
      due.push({
        assetTag: a.tag, assetName: a.name, cycleId: c.id, label: c.label,
        owner: c.owner, objective: Objective.PATIENT_SAFE,
        dueAt: null, overdue: true, daysLate: null, blocks: c.blocks,
        because: `${c.because} — and there is no record of it ever having been done`,
      });
      continue;
    }

    const dueAt = last + days(c.everyDays);
    const appearsAt = dueAt - days(c.warnAheadDays);
    if (now < appearsAt) continue;

    const overdue = now >= dueAt;
    if (overdue) anyOverdue = true;
    due.push({
      assetTag: a.tag, assetName: a.name, cycleId: c.id, label: c.label,
      owner: c.owner, objective: Objective.PATIENT_SAFE,
      dueAt,
      overdue,
      daysLate: Math.floor((now - dueAt) / DAY),
      blocks: c.blocks,
      because: c.because,
    });
  }

  /* ── The service cycle, called out by name because the owner's record
        asks for it explicitly ─────────────────────────────────────────── */
  const serviceCycle = a.cycles.find((c) => c.id === 'SERVICE');
  const lastServicedAt = serviceCycle
    ? lastAt(events, ClinicEvent.ASSET_SERVICED, `${a.tag}#SERVICE`)
    : null;
  const nextServiceAt = serviceCycle && lastServicedAt !== null
    ? lastServicedAt + days(serviceCycle.everyDays)
    : null;

  /* ── Today's check ───────────────────────────────────────────────────── */
  const checkedAt = lastAt(events, ClinicEvent.ASSET_CHECKED, a.tag);
  const checkDue = a.dailyCheck !== null
    && (checkedAt === null || checkedAt < startOfDay(now));

  /* ── AMC ─────────────────────────────────────────────────────────────── */
  let amcAction: AssetRecord['amcAction'] = 'NONE';
  if (a.amc !== null) {
    if (a.amc.until === null) {
      amcAction = 'NO_EXPIRY_RECORDED';
      unknowns.push(`An AMC with ${a.amc.vendor} is recorded and its expiry date is not`);
    } else if (now >= a.amc.until) amcAction = 'EXPIRED';
    else if (now >= a.amc.until - days(45)) amcAction = 'EXPIRING';
    else amcAction = 'OK';
  }

  /* ── Gaps in the record itself ───────────────────────────────────────── */
  if (a.commissionedAt === null) unknowns.push('No commissioning date recorded');
  if (a.warrantyUntil === null && a.amc === null) {
    unknowns.push('Neither a warranty date nor an AMC is recorded');
  }
  if (a.documents.length === 0) unknowns.push('No documents held against this asset');
  if (a.serial === '—' || a.serial === '') unknowns.push('No serial number recorded');

  const state: AssetState = downSince !== null
    ? AssetState.DOWN
    : unserviced ? AssetState.UNSERVICED
      : anyOverdue ? AssetState.OVERDUE : AssetState.OPERATIONAL;

  due.sort((x, y) => {
    if (x.blocks !== y.blocks) return x.blocks ? -1 : 1;
    if (x.overdue !== y.overdue) return x.overdue ? -1 : 1;
    return (x.dueAt ?? -Infinity) - (y.dueAt ?? -Infinity);
  });

  return {
    asset: a,
    state,
    hasServiceCycle: serviceCycle !== undefined,
    lastServicedAt,
    nextServiceAt,
    checkDue,
    due,
    breakdowns,
    downtimeMinutes: downtime,
    downSince,
    amcAction,
    unknowns,
    headline: headlineFor(a, state, downSince, due, amcAction, now),
  };
}

function headlineFor(
  a: Asset, state: AssetState, downSince: number | null,
  due: readonly AssetTask[], amc: AssetRecord['amcAction'], now: number,
): string {
  if (state === AssetState.DOWN) {
    const hours = Math.floor((now - (downSince ?? now)) / 60);
    return `Out of service for ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  if (state === AssetState.UNSERVICED) {
    const never = due.find((t) => t.dueAt === null)!;
    return `${never.label} has never been recorded against this asset`;
  }
  const worst = due.find((t) => t.overdue);
  if (worst !== undefined) {
    return `${worst.label} — ${worst.daysLate} day${worst.daysLate === 1 ? '' : 's'} overdue`;
  }
  if (amc === 'EXPIRED') return 'The maintenance contract has expired';
  if (amc === 'EXPIRING') return 'The maintenance contract is close to expiry';
  if (due.length > 0) return `${due[0]!.label} is coming up`;
  return `In service. ${a.criticality === Criticality.STOPS_CLINIC ? 'The clinic stops without it.' : 'Nothing outstanding.'}`;
}

export interface EquipmentView {
  records: readonly AssetRecord[];
  /** Everything down now — the first thing anybody wants to know. */
  down: readonly AssetRecord[];
  /** Assets with an overdue cycle that blocks their use. */
  unusable: readonly AssetRecord[];
  /** Never serviced, which is neither fine nor a service task. */
  unserviced: readonly AssetRecord[];
  /** Every task the register generated today, worst first. */
  tasks: readonly AssetTask[];
  /** Daily checks still owed. */
  checksDue: readonly AssetRecord[];
  /** AMCs expired or expiring. */
  amcAction: readonly AssetRecord[];
  /** Total minutes of downtime across the register, all time. */
  downtimeMinutes: number;
}

/** The whole register, as of a minute. */
export function equipment(
  assets: readonly Asset[], events: readonly ReadinessEvent[], now: number,
): EquipmentView {
  const records = assets.map((a) => recordFor(a, events, now));
  const tasks = records.flatMap((r) => r.due).sort((x, y) => {
    if (x.blocks !== y.blocks) return x.blocks ? -1 : 1;
    if (x.overdue !== y.overdue) return x.overdue ? -1 : 1;
    return (x.dueAt ?? -Infinity) - (y.dueAt ?? -Infinity);
  });

  return {
    records,
    down: records.filter((r) => r.state === AssetState.DOWN),
    unusable: records.filter((r) => r.due.some((t) => t.blocks && t.overdue)),
    unserviced: records.filter((r) => r.state === AssetState.UNSERVICED),
    tasks,
    checksDue: records.filter((r) => r.checkDue),
    amcAction: records.filter(
      (r) => r.amcAction === 'EXPIRED' || r.amcAction === 'EXPIRING'
        || r.amcAction === 'NO_EXPIRY_RECORDED'),
    downtimeMinutes: records.reduce((n, r) => n + r.downtimeMinutes, 0),
  };
}

/** What one role owes across the register, worst first. */
export function assetWorkFor(v: EquipmentView, role: RoleCode): AssetTask[] {
  return v.tasks.filter((t) => t.owner === role);
}
