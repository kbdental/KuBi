"""
The KuBi database structure, as a workbook that can be opened in Google Sheets.

The owner asked for the thirty core modules as tables, "till I form my own
cloud", and said the thing that actually shapes the design:

    "These tables will interact; they should not operate as isolated modules."

So the deliverable is not thirty lists of columns. It is thirty tables plus the
edges between them, and the edges are on their own sheet where they can be
argued with.

    python3 scripts/build-schema-xlsx.py docs/clinic/kubi-database.xlsx
"""
import sys
from collections import Counter, defaultdict

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

OUT = sys.argv[1] if len(sys.argv) > 1 else 'docs/clinic/kubi-database.xlsx'

F = 'Arial'
INK = Font(name=F, size=10)
BOLD = Font(name=F, size=10, bold=True)
MONO = Font(name='Consolas', size=9)
H1 = Font(name=F, size=16, bold=True)
H2 = Font(name=F, size=12, bold=True)
MUTED = Font(name=F, size=9, color='666666')
HEADF = Font(name=F, size=10, bold=True, color='FFFFFF')

HEAD = PatternFill('solid', fgColor='0C5F4E')
PK = PatternFill('solid', fgColor='DCEDE6')
FK = PatternFill('solid', fgColor='E4E8F5')
STD = PatternFill('solid', fgColor='F2F4F2')
YOU = PatternFill('solid', fgColor='FFFF00')
ADDED = PatternFill('solid', fgColor='FDF0D5')
NOTE = PatternFill('solid', fgColor='F2F4F2')

THIN = Side(style='thin', color='D5DBD7')
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
WRAP = Alignment(vertical='top', wrap_text=True)
TOP = Alignment(vertical='top')
CTR = Alignment(horizontal='center', vertical='top')

wb = Workbook()


def head(ws, row, cols):
    for i, c in enumerate(cols, start=1):
        cell = ws.cell(row=row, column=i, value=c)
        cell.font, cell.fill, cell.border = HEADF, HEAD, BOX
        cell.alignment = Alignment(vertical='center', wrap_text=True)
    ws.row_dimensions[row].height = 30


def widths(ws, spec):
    for col, w in spec.items():
        ws.column_dimensions[col].width = w


def put(ws, row, values, fills=None, wrap_cols=(), mono_cols=()):
    for i, v in enumerate(values, start=1):
        L = get_column_letter(i)
        cell = ws.cell(row=row, column=i, value=v)
        cell.font = MONO if L in mono_cols else INK
        cell.border = BOX
        cell.alignment = WRAP if L in wrap_cols else TOP
        if fills and L in fills:
            cell.fill = fills[L]


# ═══════════════════════════════════════════════════════════════════════════
# The schema
#
# Column tuples are (name, type, key, required, note).
#   key:  'PK' | 'FK→table.column' | ''
# ═══════════════════════════════════════════════════════════════════════════

def c(name, type_, key='', required='yes', note=''):
    return (name, type_, key, required, note)


# Every table carries these. Written out once here and stamped onto each sheet,
# so a reviewer sees them where they will actually live.
STANDARD = [
    c('clinic_id', 'text(id)', 'FK→locations.id', 'yes',
      'The tenant. Every query filters on it; a row without one is invisible, by design.'),
    c('created_at', 'timestamp', '', 'yes', 'ISO 8601 with offset, e.g. 2026-08-11T09:15:00+05:30.'),
    c('created_by', 'text(id)', 'FK→users.id', 'yes', 'Who, not which role — the role is on the row that needs it.'),
    c('updated_at', 'timestamp', '', 'no', 'Blank until something changes it.'),
    c('updated_by', 'text(id)', 'FK→users.id', 'no', ''),
    c('archived_at', 'timestamp', '', 'no',
      'Nothing is ever deleted. Archiving hides a row; the history that points at it survives.'),
    c('archived_by', 'text(id)', 'FK→users.id', 'no', ''),
]

APPEND_ONLY_STANDARD = [
    c('clinic_id', 'text(id)', 'FK→locations.id', 'yes', 'The tenant.'),
    c('at', 'timestamp', '', 'yes', 'When it happened. Not when it was typed in.'),
    c('recorded_by', 'text(id)', 'FK→users.id', 'yes', 'Provenance. A correction is a new row, never an edit.'),
]

T = []


def table(n, name, purpose, engine, columns, append_only=False, added=False, interacts=''):
    T.append({
        'n': n, 'name': name, 'purpose': purpose, 'engine': engine,
        'columns': columns, 'append_only': append_only, 'added': added,
        'interacts': interacts,
    })


# ── 1–5 · Who, where, and who is coming ──────────────────────────────────
table(1, 'users', 'Every person who can sign in, and what they are allowed to do.',
      'Authority', [
          c('id', 'text(id)', 'PK', 'yes', 'usr_… — prefixed so a stray cell says what it is.'),
          c('employee_code', 'text', '', 'yes', 'The clinic’s own staff number.'),
          c('full_name', 'text', '', 'yes', ''),
          c('phone', 'text', '', 'yes', ''),
          c('email', 'text', '', 'no', ''),
          c('status', 'enum', '', 'yes', 'ACTIVE · SUSPENDED · LEFT'),
          c('joined_on', 'date', '', 'yes', ''),
          c('left_on', 'date', '', 'no', 'Set on leaving. The rows they created stay.'),
      ],
      interacts='Almost everything points here for created_by. Roles are a separate table because one person can hold two.')

table(2, 'user_roles', 'Which roles a person holds, and until when.',
      'Authority', [
          c('id', 'text(id)', 'PK'),
          c('user_id', 'text(id)', 'FK→users.id'),
          c('role_code', 'enum', '', 'yes',
            'TREATING_DOCTOR · CLINIC_MANAGER · RECEPTION · SENIOR_ASSISTANT · DENTAL_ASSISTANT · '
            'STERILIZATION_TECHNICIAN · HOUSEKEEPING · LAB_COORDINATOR · INVENTORY_COORDINATOR · '
            'QUALITY_COMPLIANCE · CLINIC_HEAD · OWNER_DIRECTOR · SYSTEM_ADMINISTRATOR'),
          c('clinical_authority', 'bool', '', 'yes',
            'Separate from the role. A system administrator never gains it — that is a hard rule, not a setting.'),
          c('from_date', 'date'),
          c('to_date', 'date', '', 'no', 'Blank means current.'),
      ],
      interacts='Every ownership rule in the engines is written against role_code, never against a person.')

table(3, 'locations', 'Clinic, floor, room and operatory, as one hierarchy.',
      'Readiness · Closing · Equipment', [
          c('id', 'text(id)', 'PK', 'yes', 'loc_…'),
          c('parent_id', 'text(id)', 'FK→locations.id', 'no', 'Null for the clinic itself.'),
          c('kind', 'enum', '', 'yes', 'CLINIC · FLOOR · ROOM · OPERATORY · STORE · PLANT'),
          c('label', 'text', '', 'yes', 'How a person says it: "Operatory 2".'),
          c('position', 'int', '', 'no', 'Left to right, so a list reads like the corridor.'),
          c('opens_minute', 'int', '', 'no', 'Minutes from midnight. CLINIC rows only.'),
          c('shut_minute', 'int', '', 'no', 'The normal shut time — 1110 for 18:30.'),
      ],
      interacts='Readiness generates one block per OPERATORY row. A fifth operatory is a row here, not a release.')

table(4, 'location_overrides', 'The days a clinic does not shut at its normal time.',
      'Closing', [
          c('id', 'text(id)', 'PK'),
          c('location_id', 'text(id)', 'FK→locations.id'),
          c('on_date', 'date'),
          c('shut_minute', 'int', '', 'yes', '1140 for 19:00.'),
          c('reason', 'text', '', 'yes', 'Why. A blank reason becomes a habit.'),
      ],
      interacts='Today’s override wins over the normal time. Without this table every late Thursday reads as an overrun.')

table(5, 'patients', 'The person, and the small set of facts that change what a treatment requires.',
      'Patient events · Mandatory', [
          c('id', 'text(id)', 'PK', 'yes', 'pat_…'),
          c('code', 'text', '', 'yes', 'The clinic’s own file number.'),
          c('full_name', 'text'),
          c('phone', 'text'),
          c('date_of_birth', 'date', '', 'no', 'Drives the minor question rather than a separate flag.'),
          c('anticoagulated', 'tri-state', '', 'no', 'YES · NO · blank. BLANK IS NOT NO — see the Conventions sheet.'),
          c('prophylaxis_indicated', 'tri-state', '', 'no', 'YES · NO · blank'),
          c('diabetic', 'tri-state', '', 'no', 'YES · NO · blank'),
          c('antiresorptive', 'tri-state', '', 'no', 'YES · NO · blank'),
          c('pregnant', 'tri-state', '', 'no', 'YES · NO · blank'),
          c('penicillin_allergy', 'tri-state', '', 'no', 'YES · NO · blank'),
          c('smoker', 'tri-state', '', 'no', 'YES · NO · blank'),
          c('history_verified_on', 'date', '', 'no', 'A history verified last year does not satisfy today’s gate.'),
      ],
      interacts='The seven tri-state columns are read by the mandatory engine. A blank fails a conditional gate rather than skipping it.')

# ── 6–8 · The diary and what is being done ───────────────────────────────
table(6, 'appointments', 'A booked slot: who, when, where, with whom.',
      'Patient events', [
          c('id', 'text(id)', 'PK', 'yes', 'apt_…'),
          c('patient_id', 'text(id)', 'FK→patients.id'),
          c('location_id', 'text(id)', 'FK→locations.id', 'yes', 'The operatory.'),
          c('doctor_id', 'text(id)', 'FK→users.id'),
          c('starts_at', 'timestamp'),
          c('minutes', 'int'),
          c('status', 'enum', '', 'yes', 'BOOKED · ARRIVED · SEATED · COMPLETED · NO_SHOW · CANCELLED'),
          c('arrived_at', 'timestamp', '', 'no', ''),
      ],
      interacts='One appointment can carry several procedures. That is why the mandatory list hangs off the procedure, not off this row.')

table(7, 'procedures', 'One treatment being delivered — the row that generates the work.',
      'Patient events · Mandatory · Inventory', [
          c('id', 'text(id)', 'PK', 'yes', 'prc_…'),
          c('appointment_id', 'text(id)', 'FK→appointments.id'),
          c('patient_id', 'text(id)', 'FK→patients.id', 'yes', 'Denormalised on purpose — a procedure outlives its appointment.'),
          c('treatment_code', 'text', 'FK→treatment_master.code'),
          c('tooth', 'text', '', 'no', 'FDI notation.'),
          c('sitting', 'int', '', 'yes', '1 of however many the treatment takes.'),
          c('status', 'enum', '', 'yes', 'PLANNED · READY · IN_PROGRESS · DELIVERED · ABANDONED'),
          c('delivered_at', 'timestamp', '', 'no',
            'THE most important timestamp in the schema. A breach is judged strictly on what existed at this minute.'),
      ],
      interacts='Creating this row is what makes ~14 requirements exist. Nobody types them; they are derived from treatment_code.')

table(8, 'treatment_master', 'The catalogue: every treatment the clinic books.',
      'Patient events', [
          c('code', 'text', 'PK', 'yes', 'IMPLANT, RCT_POST, SCALE…'),
          c('name', 'text'),
          c('category', 'enum', '', 'yes',
            'DIAGNOSTIC · PREVENTIVE · RESTORATIVE · ENDODONTIC · PERIODONTAL · SURGICAL · '
            'IMPLANT · PROSTHETIC · ORTHODONTIC · PAEDIATRIC · COSMETIC · EMERGENCY'),
          c('chair_minutes', 'int'),
          c('sittings', 'int'),
          c('active', 'bool'),
      ], added=True,
      interacts='39 rows today. Adding one adds its whole requirement set through task_master.')

# ── 9–12 · Standards, tasks and what was actually done ───────────────────
table(9, 'sop_master', 'The written standard behind a task. What "done properly" means.',
      'Readiness · Closing · Mandatory', [
          c('id', 'text(id)', 'PK', 'yes', 'sop_…'),
          c('code', 'text', '', 'yes', 'OPEN-2.1, CLOSE-BMW, STER-5STEP…'),
          c('title', 'text'),
          c('version', 'int', '', 'yes', 'Never edit in place. A change is a new version.'),
          c('effective_from', 'date'),
          c('supersedes_id', 'text(id)', 'FK→sop_master.id', 'no', ''),
          c('body', 'long text', '', 'yes', 'The steps, in the clinic’s own words.'),
          c('ratified_by', 'text(id)', 'FK→users.id', 'no',
            'Blank means nobody has signed it off, and the system says so rather than implying approval.'),
      ],
      interacts='Versioned because a task done in March was done to March’s standard, and an audit has to be able to see which.')

table(10, 'task_master', 'Every piece of work the system can generate, and what triggers it.',
      'All engines', [
          c('id', 'text(id)', 'PK', 'yes', 'tsk_…'),
          c('code', 'text', '', 'yes', 'CONSENT, IMPLANT_STOCK, SPORE, OPERATORY_READY…'),
          c('label', 'text'),
          c('trigger_kind', 'enum', '', 'yes',
            'DAILY_OPENING · DAILY_CLOSING · PROCEDURE_BOOKED · PROCEDURE_DELIVERED · '
            'ASSET_CYCLE · STOCK_LEVEL · SCHEDULE'),
          c('trigger_ref', 'text', '', 'no', 'The treatment code, asset cycle id or SKU it hangs off.'),
          c('owner_role', 'enum', '', 'yes', 'A role, never a person.'),
          c('attested_by_role', 'enum', '', 'no',
            'Where only one role’s word will do. A consent attested by reception is not a consent.'),
          c('gate', 'enum', '', 'yes', 'BLOCK · ADVISE — whether it holds the procedure or sits on a list.'),
          c('basis', 'enum', '', 'no', 'STATUTORY · CONSENT · SAFETY · CLINICAL · RECORD. Decides who may argue.'),
          c('evidence', 'text', '', 'yes',
            'What actually proves it. "Somebody ticked it" is not an answer — this column is why the gate is auditable.'),
          c('offset_minutes', 'int', '', 'yes', 'Before the trigger for pre-work, after it for follow-up.'),
          c('depends_on_fact', 'text', '', 'no', 'A patients column. Blank means it always applies.'),
          c('sop_id', 'text(id)', 'FK→sop_master.id', 'no', ''),
      ],
      interacts='THE JOIN TABLE OF THE WHOLE SYSTEM. 538 rows today across 39 treatments, plus the opening, closing and asset cycles.')

table(11, 'task_instances', 'One task, for one thing, on one day — and whether it was done.',
      'All engines', [
          c('id', 'text(id)', 'PK', 'yes', 'tin_…'),
          c('task_code', 'text', 'FK→task_master.code'),
          c('subject_kind', 'enum', '', 'yes', 'PROCEDURE · LOCATION · ASSET · STOCK_ITEM · CLINIC_DAY'),
          c('subject_id', 'text(id)', '', 'yes', 'Points into whichever table subject_kind names.'),
          c('due_at', 'timestamp', '', 'no', 'Derived from the trigger and the offset. Blank where no date can be computed.'),
          c('state', 'enum', '', 'yes',
            'OUTSTANDING · MET · NOT_APPLICABLE · UNKNOWN. Four values, not two — see Conventions.'),
          c('met_at', 'timestamp', '', 'no', ''),
          c('met_by', 'text(id)', 'FK→users.id', 'no', ''),
          c('checklist_response_id', 'text(id)', 'FK→checklist_responses.id', 'no', ''),
      ],
      interacts='Generated, not typed. Deleting a procedure row leaves no orphans because nothing was copied out of a template.')

table(12, 'checklist_master', 'The sub-steps inside a task. The 24 actions inside "prepare operatory".',
      'Readiness · Closing', [
          c('id', 'text(id)', 'PK'),
          c('task_code', 'text', 'FK→task_master.code'),
          c('seq', 'int'),
          c('item', 'text', '', 'yes', 'One action.'),
          c('pass_test', 'text', '', 'yes',
            'How you know it passed. "Switch it on" is not a check; "pressure gauge reads working range" is.'),
          c('measured_value', 'text', '', 'no', 'pH 5–9, below 35 °C, 121–131 °C, 5–10 min.'),
          c('requires_value', 'bool', '', 'yes', 'Whether a number must be entered, not just a tick.'),
      ],
      interacts='"Prepare Operatory 1" is 24 rows here, not one. That distinction is what the owner asked for after the first report hid it.')

table(13, 'checklist_responses', 'What was actually recorded against a checklist item.',
      'All engines', [
          c('id', 'text(id)', 'PK'),
          c('task_instance_id', 'text(id)', 'FK→task_instances.id'),
          c('checklist_id', 'text(id)', 'FK→checklist_master.id'),
          c('checked', 'bool'),
          c('value', 'text', '', 'no', 'The reading, where one was required.'),
          c('out_of_range', 'bool', '', 'no', 'Computed against measured_value at the time.'),
          c('note', 'text', '', 'no', ''),
          c('photo_ref', 'text', '', 'no', 'Where the evidence lives.'),
      ], append_only=True,
      interacts='Append-only. A corrected reading is a new row, so the original is still visible to an auditor.')

# ── 14–17 · The patient's own record ─────────────────────────────────────
table(14, 'patient_protocols', 'A protocol assigned to one patient — perio maintenance, ortho retention.',
      'Patient events', [
          c('id', 'text(id)', 'PK'),
          c('patient_id', 'text(id)', 'FK→patients.id'),
          c('sop_id', 'text(id)', 'FK→sop_master.id'),
          c('started_on', 'date'),
          c('interval_days', 'int', '', 'yes', 'What makes the next recall exist.'),
          c('next_due_on', 'date'),
          c('status', 'enum', '', 'yes', 'ACTIVE · COMPLETED · LAPSED'),
      ],
      interacts='Generates follow_ups automatically, the same way an asset cycle generates a service task.')

table(15, 'consent_records', 'What the patient agreed to, in writing, for this procedure.',
      'Mandatory', [
          c('id', 'text(id)', 'PK'),
          c('procedure_id', 'text(id)', 'FK→procedures.id'),
          c('patient_id', 'text(id)', 'FK→patients.id'),
          c('consent_type', 'enum', '', 'yes', 'GENERAL · SURGICAL · NERVE_RISK · SINUS_RISK · SEDATION · GUARDIAN · PHOTOGRAPHY'),
          c('risks_named', 'text', '', 'yes', 'The specific risks discussed. A general consent does not cover nerve injury.'),
          c('signed_at', 'timestamp'),
          c('signed_by', 'text', '', 'yes', 'The patient, or the guardian and their relationship.'),
          c('taken_by', 'text(id)', 'FK→users.id', 'yes', 'Must hold clinical authority.'),
          c('document_ref', 'text', '', 'yes', 'Where the signed form is.'),
      ], append_only=True,
      interacts='signed_at against procedures.delivered_at is what decides a consent breach. A consent signed after delivery does not clear one.')

table(16, 'follow_ups', 'Something that must happen after a treatment, on a date.',
      'Patient events', [
          c('id', 'text(id)', 'PK'),
          c('patient_id', 'text(id)', 'FK→patients.id'),
          c('procedure_id', 'text(id)', 'FK→procedures.id', 'no', ''),
          c('kind', 'enum', '', 'yes', 'NEXT_DAY_CALL · SUTURE_REMOVAL · REVIEW · RECALL · TRAUMA_SERIES · BIOPSY_RESULT'),
          c('due_on', 'date'),
          c('owner_role', 'enum'),
          c('status', 'enum', '', 'yes', 'OPEN · DONE · UNREACHABLE · CANCELLED'),
          c('closed_at', 'timestamp', '', 'no', ''),
          c('outcome', 'text', '', 'no', 'What the patient said. "Called, no answer" is an outcome.'),
      ],
      interacts='Created by task_master rows with trigger PROCEDURE_DELIVERED. Nobody remembers to make one.')

table(17, 'lab_cases', 'Work sent out and expected back, with the date the fit depends on.',
      'Patient events', [
          c('id', 'text(id)', 'PK'),
          c('procedure_id', 'text(id)', 'FK→procedures.id'),
          c('patient_id', 'text(id)', 'FK→patients.id'),
          c('lab_name', 'text'),
          c('what', 'text', '', 'yes', 'Crown, bridge, denture, retainer, surgical guide.'),
          c('shade', 'text', '', 'no', ''),
          c('dispatched_at', 'timestamp', '', 'no', ''),
          c('due_back_on', 'date'),
          c('returned_at', 'timestamp', '', 'no', ''),
          c('qc_passed', 'bool', '', 'no', 'Back is not the same as acceptable.'),
          c('fit_appointment_id', 'text(id)', 'FK→appointments.id', 'no',
            'A fit booked before due_back_on is a wasted appointment, and the engine says so.'),
      ],
      interacts='Blocks the debond gate: a retainer not physically back means the appointment cannot proceed.')

# ── 18–21 · Things ───────────────────────────────────────────────────────
table(18, 'stock_items', 'What the clinic keeps, and how much of it it must never go below.',
      'Inventory', [
          c('sku', 'text', 'PK', 'yes', 'GLOVE-EXAM, LA-CART, IMPLANT-4013…'),
          c('name', 'text'),
          c('category', 'enum', '', 'yes', 'PPE · CONSUMABLE · ANAESTHETIC · RESTORATIVE · ENDODONTIC · SURGICAL · IMPLANT · ORTHODONTIC · STERILIZATION · DISINFECTANT'),
          c('unit', 'text', '', 'yes', 'What the clinic actually counts in.'),
          c('minimum', 'decimal'),
          c('daily_use', 'decimal', '', 'yes', 'Drives the reorder point, which fires while there is still cover.'),
          c('lead_days', 'int'),
          c('owner_role', 'enum'),
          c('lot_tracked', 'bool', '', 'yes', 'True for anything that expires or must be traceable to a patient.'),
          c('stops_treatment', 'bool', '', 'yes', 'The difference between "order more" and "cancel the list".'),
          c('store_location_id', 'text(id)', 'FK→locations.id', 'no', ''),
      ],
      interacts='Reorder point is minimum + lead_days × daily_use. It is computed, never a stored column.')

table(19, 'stock_lots', 'One delivery, still on the shelf — with its lot number and expiry.',
      'Inventory · Mandatory', [
          c('id', 'text(id)', 'PK'),
          c('sku', 'text', 'FK→stock_items.sku'),
          c('lot_number', 'text', '', 'yes', 'The traceable one. Two boxes of anaesthetic are not interchangeable.'),
          c('expires_on', 'date', '', 'no', 'Blank where the item does not expire.'),
          c('quantity', 'decimal'),
          c('received_on', 'date'),
          c('reserved_for_procedure_id', 'text(id)', 'FK→procedures.id', 'no',
            'THE column that stops two implant cases being booked on one fixture.'),
      ], added=True,
      interacts='ADDED. "Inventory" as one table cannot express expiry or reservation, and both decide whether a procedure may start.')

table(20, 'assets', 'Every important asset, with its own record.',
      'Equipment', [
          c('tag', 'text', 'PK', 'yes', 'AUTOCLAVE-01, CHAIR-03, PUMP-01 — printable, stuck on the machine.'),
          c('name', 'text'),
          c('category', 'enum', '', 'yes', 'CHAIRSIDE · STERILIZATION · IMAGING · PLANT · FACILITY · SAFETY · FRONT_OFFICE · LABORATORY'),
          c('location_id', 'text(id)', 'FK→locations.id'),
          c('responsible_role', 'enum', '', 'yes', 'A role. The record has to survive the person leaving.'),
          c('criticality', 'enum', '', 'yes', 'STOPS_CLINIC · STOPS_WORK · DEGRADES'),
          c('make', 'text'), c('model', 'text'), c('serial', 'text'),
          c('commissioned_on', 'date', '', 'no', ''),
          c('warranty_until', 'date', '', 'no', ''),
          c('amc_vendor', 'text', '', 'no', ''),
          c('amc_until', 'date', '', 'no', 'Blank with a vendor present is a gap, not "no contract".'),
          c('amc_covers', 'text', '', 'no', ''),
          c('daily_check', 'text', '', 'no', 'With its pass test, or it becomes a tick done from the corridor.'),
      ],
      interacts='An asset that may not be used blocks every procedure depending on it. That is the equipment→mandatory edge.')

table(21, 'asset_cycles', 'The several clocks running on one asset at once.',
      'Equipment', [
          c('id', 'text(id)', 'PK'),
          c('asset_tag', 'text', 'FK→assets.tag'),
          c('cycle_code', 'text', '', 'yes', 'SERVICE, SPORE, VALIDATION, AERB, GASKET…'),
          c('every_days', 'int'),
          c('warn_ahead_days', 'int', '', 'yes', 'A task appearing the morning it falls due is already late.'),
          c('owner_role', 'enum'),
          c('blocks_use', 'bool', '', 'yes', 'Whether an overdue cycle stops the asset being used.'),
          c('because', 'text', '', 'yes', 'Said to whoever must act.'),
      ], added=True,
      interacts='ADDED. An autoclave has four clocks — service, weekly spore test, annual validation, gasket. One "next service date" cannot hold them.')

table(22, 'maintenance', 'What was done to an asset, and when.',
      'Equipment', [
          c('id', 'text(id)', 'PK'),
          c('asset_tag', 'text', 'FK→assets.tag'),
          c('cycle_code', 'text', 'FK→asset_cycles.cycle_code', 'no', 'Blank for an unplanned repair.'),
          c('kind', 'enum', '', 'yes', 'PLANNED · BREAKDOWN · RESTORED · CHECK'),
          c('done_at', 'timestamp'),
          c('vendor', 'text', '', 'no', ''),
          c('cost', 'decimal', '', 'no', ''),
          c('note', 'text', '', 'no', ''),
          c('document_ref', 'text', '', 'no', 'Service report, certificate.'),
      ], append_only=True,
      interacts='BREAKDOWN with no matching RESTORED is what "down right now" means. Downtime is the gap between them, not a status field.')

table(23, 'sterilization_cycles', 'One autoclave run, and who released it.',
      'Readiness · Mandatory', [
          c('id', 'text(id)', 'PK'),
          c('asset_tag', 'text', 'FK→assets.tag'),
          c('batch_number', 'text', '', 'yes', 'What a pack is labelled with, and what a procedure cites.'),
          c('loaded_at', 'timestamp'), c('finished_at', 'timestamp', '', 'no', ''),
          c('peak_temp_c', 'decimal', '', 'no', '121–131 °C.'),
          c('operator_id', 'text(id)', 'FK→users.id'),
          c('released_by', 'text(id)', 'FK→users.id', 'no',
            'MUST DIFFER FROM operator_id. Nobody releases their own batch — that is the separation of duties.'),
          c('released_at', 'timestamp', '', 'no', 'A cycle that ran and was never released is the one thing closing refuses on.'),
          c('spore_test_id', 'text(id)', '', 'no', ''),
      ], append_only=True,
      interacts='A surgical procedure’s sterile-pack gate cites a batch_number from here. A tick will not do.')

# ── 24–26 · When it goes wrong ───────────────────────────────────────────
table(24, 'incidents', 'Something that happened that should not have.',
      'Quality', [
          c('id', 'text(id)', 'PK'),
          c('kind', 'enum', '', 'yes', 'CLINICAL · SAFETY · SHARPS · INFECTION_CONTROL · EQUIPMENT · DATA · OTHER'),
          c('severity', 'enum', '', 'yes', 'PATIENT_SAFETY · SERIOUS · MINOR · NEAR_MISS'),
          c('happened_at', 'timestamp'),
          c('patient_id', 'text(id)', 'FK→patients.id', 'no', ''),
          c('procedure_id', 'text(id)', 'FK→procedures.id', 'no', ''),
          c('asset_tag', 'text', 'FK→assets.tag', 'no', ''),
          c('what_happened', 'text'),
          c('immediate_action', 'text'),
          c('reported_by', 'text(id)', 'FK→users.id'),
          c('status', 'enum', '', 'yes', 'OPEN · INVESTIGATING · CLOSED'),
      ],
      interacts='A near miss with no CAPA is an incident that will recur. The link is enforced, not suggested.')

table(25, 'capa', 'What was changed so it does not happen again.',
      'Quality', [
          c('id', 'text(id)', 'PK'),
          c('incident_id', 'text(id)', 'FK→incidents.id', 'no', ''),
          c('complaint_id', 'text(id)', 'FK→complaints.id', 'no', ''),
          c('root_cause', 'text', '', 'yes', '"Staff carelessness" is not a root cause.'),
          c('action', 'text'),
          c('changes_sop_id', 'text(id)', 'FK→sop_master.id', 'no',
            'A CAPA that changes nothing written down changes nothing.'),
          c('owner_id', 'text(id)', 'FK→users.id'),
          c('due_on', 'date'),
          c('verified_at', 'timestamp', '', 'no', 'Did it work? An unverified CAPA is a promise.'),
          c('status', 'enum', '', 'yes', 'OPEN · ACTIONED · VERIFIED · INEFFECTIVE'),
      ],
      interacts='Closing the loop: incident → CAPA → new SOP version → the tasks generated from it change for everyone.')

table(26, 'complaints', 'What the patient said was wrong.',
      'Quality', [
          c('id', 'text(id)', 'PK'),
          c('patient_id', 'text(id)', 'FK→patients.id'),
          c('received_at', 'timestamp'),
          c('channel', 'enum', '', 'yes', 'IN_PERSON · PHONE · EMAIL · REVIEW · WHATSAPP'),
          c('about', 'text'),
          c('acknowledged_at', 'timestamp', '', 'no', 'The clock the patient actually feels.'),
          c('resolved_at', 'timestamp', '', 'no', ''),
          c('resolution', 'text', '', 'no', ''),
          c('owner_id', 'text(id)', 'FK→users.id'),
      ],
      interacts='Feeds CAPA where it is systemic rather than personal.')

# ── 27–29 · People at work ───────────────────────────────────────────────
table(27, 'attendance', 'Who was in the building, and when.',
      'Readiness · Closing', [
          c('id', 'text(id)', 'PK'),
          c('user_id', 'text(id)', 'FK→users.id'),
          c('on_date', 'date'),
          c('in_at', 'timestamp', '', 'no', ''),
          c('out_at', 'timestamp', '', 'no', ''),
          c('hygiene_protocol_at', 'timestamp', '', 'no',
            'Staff entry. Counted today rather than enforced, because the log carries a role and the protocol gates a person.'),
          c('status', 'enum', '', 'yes', 'PRESENT · LATE · ABSENT · LEAVE · HOLIDAY'),
      ],
      interacts='The morning cannot be staffed by people who are not here. This is what makes "nobody is rostered for the equipment round" visible.')

table(28, 'leave', 'Planned absence, so the roster can be checked before the day.',
      'Operations', [
          c('id', 'text(id)', 'PK'),
          c('user_id', 'text(id)', 'FK→users.id'),
          c('kind', 'enum', '', 'yes', 'ANNUAL · SICK · UNPAID · MATERNITY · COMPENSATORY'),
          c('from_date', 'date'), c('to_date', 'date'),
          c('status', 'enum', '', 'yes', 'REQUESTED · APPROVED · REFUSED · CANCELLED'),
          c('approved_by', 'text(id)', 'FK→users.id', 'no', ''),
      ],
      interacts='A day where the only sterilization technician is on leave is a day the morning run has no owner. Worth knowing on Friday, not Monday.')

table(29, 'training_competency', 'Who is signed off to do what, and until when.',
      'Authority · Mandatory', [
          c('id', 'text(id)', 'PK'),
          c('user_id', 'text(id)', 'FK→users.id'),
          c('competency_code', 'text', '', 'yes', 'IMPLANT_SURGERY, AUTOCLAVE_RELEASE, RADIOGRAPHY, BLS…'),
          c('level', 'enum', '', 'yes', 'TRAINEE · COMPETENT · ASSESSOR'),
          c('assessed_on', 'date'),
          c('assessed_by', 'text(id)', 'FK→users.id'),
          c('expires_on', 'date', '', 'no', 'BLS expires. So does radiography certification.'),
          c('evidence_ref', 'text', '', 'no', ''),
      ],
      interacts='The seventh axis of authority. A role is not competence — this is where "may this person actually do this" is answered.')

# ── 30–33 · Watching the whole thing ─────────────────────────────────────
table(30, 'notifications', 'Something a person was told, and whether they saw it.',
      'Operations', [
          c('id', 'text(id)', 'PK'),
          c('to_user_id', 'text(id)', 'FK→users.id', 'no', ''),
          c('to_role', 'enum', '', 'no', 'One or the other. A notification to nobody is a log line.'),
          c('subject_kind', 'enum', '', 'yes', 'TASK · PROCEDURE · ASSET · STOCK_ITEM · INCIDENT'),
          c('subject_id', 'text(id)'),
          c('message', 'text'),
          c('sent_at', 'timestamp'),
          c('seen_at', 'timestamp', '', 'no', 'Unseen is a fact worth acting on.'),
          c('channel', 'enum', '', 'yes', 'IN_APP · WHATSAPP · SMS · EMAIL'),
      ],
      interacts='Escalation is not a louder notification — it is a different row, to a different person. See the next table.')

table(31, 'escalations', 'Work that has been late long enough to become somebody else’s problem.',
      'All engines', [
          c('id', 'text(id)', 'PK'),
          c('task_instance_id', 'text(id)', 'FK→task_instances.id', 'no', ''),
          c('incident_id', 'text(id)', 'FK→incidents.id', 'no', ''),
          c('rung', 'int', '', 'yes', '1 = owner, 2 = senior, 3 = manager, 4 = clinic head.'),
          c('to_role', 'enum'),
          c('raised_at', 'timestamp'),
          c('because', 'text', '', 'yes', 'The reason, in words. "SLA breach" tells nobody anything.'),
          c('cleared_at', 'timestamp', '', 'no', ''),
      ],
      interacts='Rungs are timed off task_master.offset_minutes, so nobody decides when to escalate — the clock does.')

table(32, 'kpi_definitions', 'What a number means, before anybody reports it.',
      'Quality', [
          c('code', 'text', 'PK', 'yes', 'READY_ON_TIME, SAME_DAY_STERILIZATION, CLOSING_COMPLIANCE…'),
          c('name', 'text'),
          c('formula', 'text', '', 'yes', 'Stated in words — numerator and denominator, both named.'),
          c('unit', 'enum', '', 'yes', 'PERCENT · MINUTES · COUNT · CURRENCY'),
          c('target', 'decimal'),
          c('direction', 'enum', '', 'yes', 'HIGHER_BETTER · LOWER_BETTER'),
          c('owner_role', 'enum'),
          c('source_tables', 'text', '', 'yes', 'Which tables it is computed from. A KPI with no source is an opinion.'),
      ],
      interacts='Separating definition from result is what lets a target change without rewriting history.')

table(33, 'kpi_results', 'The number, for a period, computed rather than typed.',
      'Quality', [
          c('id', 'text(id)', 'PK'),
          c('kpi_code', 'text', 'FK→kpi_definitions.code'),
          c('period_start', 'date'), c('period_end', 'date'),
          c('numerator', 'decimal'), c('denominator', 'decimal'),
          c('value', 'decimal'),
          c('computed_at', 'timestamp'),
      ], append_only=True,
      interacts='Never edited. A restated figure is a new row, so an improving trend cannot be produced by editing last month.')

table(34, 'audit_logs', 'Who read or changed what.',
      'Platform', [
          c('id', 'text(id)', 'PK'),
          c('actor_id', 'text(id)', 'FK→users.id'),
          c('action', 'enum', '', 'yes', 'CREATE · UPDATE · ARCHIVE · READ_PHI · EXPORT · SIGN_IN · PERMISSION_CHANGE'),
          c('table_name', 'text'), c('row_id', 'text(id)'),
          c('before', 'json', '', 'no', 'Redacted of clinical content.'),
          c('after', 'json', '', 'no', ''),
          c('ip', 'text', '', 'no', ''),
      ], append_only=True,
      interacts='Separate from the event log. This records what the SOFTWARE did; events record what the CLINIC did.')

table(35, 'events', 'What happened in the clinic. The spine everything else derives from.',
      'All engines', [
          c('id', 'text(id)', 'PK', 'yes', 'evt_… — monotonic, so order is never in doubt.'),
          c('type', 'enum', '', 'yes',
            'Past tense, always. CONSENT_SIGNED, BATCH_RELEASED, OPERATORY_READY, ASSET_FAILED, '
            'STOCK_RESERVED, TREATMENT_DELIVERED, TREATMENT_START_REFUSED…'),
          c('subject_id', 'text', '', 'yes', 'What it is about. Compound where it needs to be: procedure#gate.'),
          c('subject_label', 'text', '', 'no', 'How a person says it, frozen at the time.'),
          c('by_role', 'enum', '', 'yes', 'The role that recorded it. Ownership is enforced on the write.'),
          c('by_user_id', 'text(id)', 'FK→users.id'),
          c('idempotency_key', 'text', '', 'yes', 'A double tap is one event.'),
      ], append_only=True, added=True,
      interacts='ADDED, and the most important addition. Readiness, closing, the mandatory verdict, downtime and stock are all COMPUTED from this table — none of them is stored.')

# ═══════════════════════════════════════════════════════════════════════════
# 1 · Read me
# ═══════════════════════════════════════════════════════════════════════════
ws = wb.active
ws.title = 'Read me'
widths(ws, {'A': 3, 'B': 30, 'C': 78, 'D': 12})
ws['B2'] = 'KuBi — the database structure'
ws['B2'].font = H1
ws['B3'] = 'The thirty core modules as tables, plus the edges between them.'
ws['B3'].font = MUTED
ws['B4'] = 'For Google Sheets now; the same shape moves to Postgres unchanged.'
ws['B4'].font = MUTED

ws['B6'] = 'The line that shaped this'
ws['B6'].font = H2
ws['B7'] = '"These tables will interact; they should not operate as isolated modules."'
ws['B7'].font = Font(name=F, size=11, bold=True)
ws['B8'] = ('So the Relationships sheet is not an appendix — it is the design. Every edge on it is a '
            'decision that stops a module being an island: a consent whose timestamp is compared against '
            'a delivery time, a lot number that decides whether a procedure may start, a CAPA that '
            'changes an SOP version and therefore changes every task generated from it.')
ws['B8'].font, ws['B8'].alignment = INK, WRAP
ws.merge_cells('B8:C8')
ws.row_dimensions[8].height = 58

ws['B10'] = 'The sheets'
ws['B10'].font = H2
sheets = [
    ('Tables', 'All 35, what each is for, which engine uses it, and whether it is append-only.'),
    ('Columns', 'Every column of every table. Filter column A for one table. This is the spec.'),
    ('Relationships', 'Every foreign key, and — in plain words — what breaks without it.'),
    ('Conventions', 'IDs, timestamps, tri-state, archiving, append-only. Read this before entering data.'),
    ('Enums', 'The controlled vocabularies, so two people do not type ACTIVE and Active.'),
    ('Your 30', 'Your original list, and which table each module became. Nothing is unaccounted for.'),
    ('Sheet per table', '35 blank tabs with the right headers and one example row. Paste your data in.'),
]
r = 11
for name, meaning in sheets:
    ws.cell(row=r, column=2, value=f"'{name}'").font = BOLD
    cc = ws.cell(row=r, column=3, value=meaning)
    cc.font, cc.alignment = INK, WRAP
    ws.row_dimensions[r].height = 26
    r += 1

ws['B18'] = 'Six tables were added to your thirty'
ws['B18'].font = H2
added_note = [
    ('events',
     'THE IMPORTANT ONE. Everything KuBi computes — whether the clinic is ready, whether a procedure '
     'may start, how long an asset has been down, what stock is available — is derived from an '
     'append-only event log, not stored. Without this table the other thirty hold answers that can '
     'drift from the truth. With it, they cannot.'),
    ('user_roles',
     'One person can hold two roles, and a role can end. Putting role on the users row makes both '
     'impossible and quietly collapses two of the seven axes of authority.'),
    ('stock_lots',
     '"Inventory" as one table cannot express an expiry date or a reservation, and both decide whether '
     'a procedure may start. Two implant cases booked on one fixture is the failure this prevents.'),
    ('asset_cycles',
     'An autoclave has four clocks running at once — service, weekly spore test, annual validation, '
     'gasket. One "next service date" column cannot hold them.'),
    ('location_overrides',
     'The clinic shuts at 18:30 except when it shuts at 19:00. Without this every late Thursday reads '
     'as the team overrunning.'),
    ('treatment_master',
     '"Procedures" in your list is the thing being done to a patient. The catalogue of what CAN be done '
     'is a different table — 39 rows that change once a year, against procedures that change hourly.'),
]
r = 19
for name, why in added_note:
    ws.cell(row=r, column=2, value=name).font = Font(name='Consolas', size=10, bold=True)
    ws.cell(row=r, column=2).fill = ADDED
    cc = ws.cell(row=r, column=3, value=why)
    cc.font, cc.alignment = INK, WRAP
    ws.row_dimensions[r].height = 52
    r += 1

ws.cell(row=26, column=2, value='One of your thirty was merged, and several were split').font = BOLD
ws.cell(row=27, column=2, value=(
    'MERGED: "Implant Inventory" is not its own table. An implant fixture is a stock item that happens '
    'to be lot-tracked and expiry-dated, and every rule it needs — reserve a lot, check the expiry, hold '
    'one size either side — is a rule ordinary inventory needs too. A separate table would mean writing '
    'the reservation logic twice and having it disagree. Say the word if you would rather keep them '
    'apart. SPLIT: "Users & Roles" became users + user_roles, because one person holds two roles and a '
    'role can end; "Locations/Floors/Rooms" became one self-referencing table with a kind column, so a '
    'clinic with two floors and six operatories needs no new table. See the sheet "Your 30".')).font = INK
ws.cell(row=27, column=2).alignment = WRAP
ws.merge_cells('B27:C27')
ws.row_dimensions[27].height = 82

ws['B30'] = 'Totals'
ws['B30'].font = H2
for i, (label, formula) in enumerate([
    ('Tables', '=COUNTA(Tables!A5:A100)'),
    ('Columns defined', '=COUNTA(Columns!A5:A2000)'),
    ('Foreign keys', '=COUNTA(Relationships!A5:A500)'),
    ('Append-only tables', '=COUNTIF(Tables!F5:F100,"YES")'),
]):
    ws.cell(row=31 + i, column=2, value=label).font = BOLD
    cell = ws.cell(row=31 + i, column=4, value=formula)
    cell.font, cell.alignment, cell.border, cell.fill = BOLD, CTR, BOX, NOTE

# ═══════════════════════════════════════════════════════════════════════════
# 2 · Tables
# ═══════════════════════════════════════════════════════════════════════════
ws = wb.create_sheet('Tables')
widths(ws, {'A': 5, 'B': 24, 'C': 54, 'D': 26, 'E': 8, 'F': 12, 'G': 9, 'H': 74})
ws['A1'] = 'The tables'
ws['A2'] = 'Append-only means rows are never edited or deleted — a correction is a new row.'
ws['A1'].font, ws['A2'].font = H1, MUTED
head(ws, 4, ['#', 'Table', 'What it is for', 'Engines that use it', 'Cols',
             'Append-only', 'Added', 'How it interacts — the reason it is not an island'])
r = 5
for t in T:
    fills = {'B': ADDED} if t['added'] else {}
    put(ws, r, [t['n'], t['name'], t['purpose'], t['engine'],
                len(t['columns']) + len(APPEND_ONLY_STANDARD if t['append_only'] else STANDARD),
                'YES' if t['append_only'] else '', 'YES' if t['added'] else '',
                t['interacts']],
        fills=fills, wrap_cols=('C', 'D', 'H'), mono_cols=('B',))
    ws.cell(row=r, column=1).alignment = CTR
    ws.cell(row=r, column=5).alignment = CTR
    ws.cell(row=r, column=6).alignment = CTR
    ws.cell(row=r, column=7).alignment = CTR
    ws.row_dimensions[r].height = 42
    r += 1
ws.freeze_panes = 'C5'
ws.auto_filter.ref = f'A4:H{r-1}'

# ═══════════════════════════════════════════════════════════════════════════
# 3 · Columns
# ═══════════════════════════════════════════════════════════════════════════
ws = wb.create_sheet('Columns')
widths(ws, {'A': 24, 'B': 28, 'C': 13, 'D': 26, 'E': 10, 'F': 10, 'G': 82})
ws['A1'] = 'Every column'
ws['A2'] = ('Filter column A for one table. Green is a primary key, blue a foreign key, grey a '
            'standard column every table carries.')
ws['A1'].font, ws['A2'].font = H1, MUTED
head(ws, 4, ['Table', 'Column', 'Type', 'Key', 'Required', 'Standard', 'Notes'])
r = 5
for t in T:
    std = APPEND_ONLY_STANDARD if t['append_only'] else STANDARD
    for (name, type_, key, required, note) in list(t['columns']) + list(std):
        is_std = (name, type_, key, required, note) in std
        fills = {}
        if key == 'PK':
            fills['D'] = PK
        elif key.startswith('FK'):
            fills['D'] = FK
        if is_std:
            fills['B'] = STD
        put(ws, r, [t['name'], name, type_, key, required, 'yes' if is_std else '', note],
            fills=fills, wrap_cols=('G',), mono_cols=('A', 'B', 'D'))
        ws.cell(row=r, column=5).alignment = CTR
        ws.cell(row=r, column=6).alignment = CTR
        r += 1
ws.freeze_panes = 'C5'
ws.auto_filter.ref = f'A4:G{r-1}'

# ═══════════════════════════════════════════════════════════════════════════
# 4 · Relationships
# ═══════════════════════════════════════════════════════════════════════════
EDGE_MEANING = {
    ('procedures', 'appointments'): 'One appointment, several procedures. Collapsing them makes it impossible to say which post-op instruction belongs to which piece of work.',
    ('procedures', 'treatment_master'): 'This is the edge that generates work. Setting treatment_code makes ~14 requirements exist without anybody typing one.',
    ('task_instances', 'task_master'): 'The requirement is the clinic’s opinion; the instance is what happened. Changing the protocol changes every future instance at once.',
    ('checklist_responses', 'task_instances'): 'What was actually recorded, against what was asked. Append-only, so a corrected reading does not erase the first.',
    ('consent_records', 'procedures'): 'signed_at vs delivered_at decides a breach. A consent signed at four o’clock does not make an eleven o’clock start compliant.',
    ('stock_lots', 'procedures'): 'A reservation. Without it, stock that exists but belongs to tomorrow’s case looks available to today’s.',
    ('stock_lots', 'stock_items'): 'Lots are the unit of truth for anything that expires. Two boxes of anaesthetic are not interchangeable.',
    ('asset_cycles', 'assets'): 'Several clocks on one asset. An autoclave has four.',
    ('maintenance', 'assets'): 'BREAKDOWN with no matching RESTORED is what "down now" means. Downtime is the gap, not a field.',
    ('sterilization_cycles', 'assets'): 'A pack cites a batch number from here. The gate is satisfied by a released cycle, never by a tick.',
    ('capa', 'sop_master'): 'The loop closes here: a CAPA that changes no written standard changes nothing, and this edge is what makes the change reach every task.',
    ('capa', 'incidents'): 'A near miss with no CAPA is an incident that will recur.',
    ('escalations', 'task_instances'): 'Escalation is timed off the task’s own clock. Nobody decides when — the clock does.',
    ('training_competency', 'users'): 'The seventh axis of authority. A role is not competence.',
    ('lab_cases', 'appointments'): 'A fit booked before the work can be back is a wasted appointment, and the engine says so.',
    ('kpi_results', 'kpi_definitions'): 'Definition apart from result, so a target can change without rewriting history.',
    ('user_roles', 'users'): 'One person, several roles, each with an end date.',
    ('locations', 'locations'): 'Self-referencing: clinic → floor → room → operatory, in one table.',
    ('follow_ups', 'procedures'): 'Created by delivery, not by memory.',
    ('patient_protocols', 'sop_master'): 'A patient on a protocol generates their own recalls.',
}

ws = wb.create_sheet('Relationships')
widths(ws, {'A': 24, 'B': 28, 'C': 24, 'D': 22, 'E': 10, 'F': 86})
ws['A1'] = 'The edges'
ws['A2'] = ('Every foreign key in the schema. The last column is why it exists — what would go wrong '
            'if the two tables were kept apart.')
ws['A1'].font, ws['A2'].font = H1, MUTED
head(ws, 4, ['From table', 'From column', 'To table', 'To column', 'Required', 'What it is for'])
r = 5
edges = []
for t in T:
    std = APPEND_ONLY_STANDARD if t['append_only'] else STANDARD
    for (name, type_, key, required, note) in list(t['columns']) + list(std):
        if not key.startswith('FK'):
            continue
        target = key.split('→', 1)[1]
        to_table, to_col = target.split('.')
        edges.append((t['name'], name, to_table, to_col, required,
                      EDGE_MEANING.get((t['name'], to_table), note or 'Ordinary reference.')))
for e in edges:
    put(ws, r, list(e), wrap_cols=('F',), mono_cols=('A', 'B', 'C', 'D'))
    ws.cell(row=r, column=5).alignment = CTR
    ws.row_dimensions[r].height = 30
    r += 1
ws.freeze_panes = 'C5'
ws.auto_filter.ref = f'A4:F{r-1}'

# A tally of how connected each table is.
deg = Counter()
for (ft, _fc, tt, _tc, _req, _why) in edges:
    deg[ft] += 1
    deg[tt] += 1
r += 2
ws.cell(row=r, column=1, value='Most connected tables').font = H2
r += 1
for name, n in deg.most_common(8):
    ws.cell(row=r, column=1, value=name).font = MONO
    cell = ws.cell(row=r, column=2, value=n)
    cell.font, cell.alignment = BOLD, CTR
    r += 1

# ═══════════════════════════════════════════════════════════════════════════
# 5 · Conventions
# ═══════════════════════════════════════════════════════════════════════════
ws = wb.create_sheet('Conventions')
widths(ws, {'A': 22, 'B': 96})
ws['A1'] = 'Conventions — read before entering data'
ws['A1'].font = H1
head(ws, 3, ['Convention', 'What it means, and why'])
CONV = [
    ('IDs', 'Text, prefixed with three letters: usr_, pat_, apt_, prc_, evt_. In a spreadsheet you cannot '
            'see which column a value came from, so the value has to say. Never use row numbers — they '
            'change when somebody sorts.'),
    ('Timestamps', 'ISO 8601 with the offset: 2026-08-11T09:15:00+05:30. Not "11/08/2026 9:15 am", which '
                   'is ambiguous between two countries and loses the timezone.'),
    ('Tri-state', 'YES · NO · blank, on every patient medical column. BLANK IS NOT NO. A clinic that has '
                  'never asked whether a patient takes a blood thinner is not a clinic where they do not. '
                  'A blank fails a conditional gate rather than skipping it, and the refusal names the '
                  'question rather than the task.'),
    ('Four-valued state', 'task_instances.state is OUTSTANDING · MET · NOT_APPLICABLE · UNKNOWN. Four, not '
                          'two. NOT_APPLICABLE requires a positive reason; UNKNOWN is the absence of '
                          'information and never counts as done.'),
    ('Nothing is deleted', 'Set archived_at instead. A deleted row takes its history with it, and the '
                           'rows that pointed at it become lies.'),
    ('Append-only tables', 'events, audit_logs, consent_records, checklist_responses, maintenance, '
                           'sterilization_cycles, kpi_results. Never edit a row. A correction is a new '
                           'row that supersedes it, so the original stays visible to an auditor.'),
    ('Roles, not names', 'Every ownership and permission column holds a role code. Names change; roles do '
                         'not. The event log still records which user did it — that is provenance, not '
                         'the master.'),
    ('One tenant column', 'clinic_id on every table. In Postgres this becomes row-level security; in '
                          'Sheets it is what lets a second clinic share the file without seeing the first.'),
    ('Computed, never stored', 'Do not add columns for "is_ready", "next_service_date", "stock_available" '
                               'or "compliance_rate". Every one is derived, and a stored copy is a copy '
                               'that will be wrong on a Tuesday.'),
    ('Codes are stable', 'treatment_master.code, task_master.code, stock_items.sku, assets.tag, '
                         'kpi_definitions.code. These are joined on. Renaming one breaks history; add a '
                         'new row and archive the old.'),
]
r = 4
for name, meaning in CONV:
    put(ws, r, [name, meaning], wrap_cols=('B',))
    ws.cell(row=r, column=1).font = BOLD
    ws.row_dimensions[r].height = 54
    r += 1

r += 1
ws.cell(row=r, column=1, value='Where the Sheets version will hurt, and what to do about it').font = H2
r += 1
for line in [
    'No foreign key enforcement. Use Data → Data validation → List from a range against the parent tab, '
    'on every FK column. It is not enforcement, but it stops the commonest error.',
    'No transactions. Two people editing the same row lose one edit silently. Keep write access narrow '
    'and prefer adding rows to editing them — which the append-only rule already does.',
    'Row limits. events grows fastest: roughly 400 rows a day at four operatories, so about 100,000 a '
    'year. That is fine in Sheets for a year and is the first table to move when you build the cloud.',
    'No row-level security. Anyone with the link sees every clinic. Acceptable for one clinic; the day '
    'there are two, that is the trigger to move.',
]:
    cell = ws.cell(row=r, column=1, value=line)
    cell.font, cell.alignment = INK, WRAP
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=2)
    ws.row_dimensions[r].height = 34
    r += 1

# ═══════════════════════════════════════════════════════════════════════════
# 6 · Enums
# ═══════════════════════════════════════════════════════════════════════════
ws = wb.create_sheet('Enums')
widths(ws, {'A': 24, 'B': 26, 'C': 96})
ws['A1'] = 'Controlled vocabularies'
ws['A2'] = 'So that two people do not type ACTIVE and Active. Use these as Data validation lists.'
ws['A1'].font, ws['A2'].font = H1, MUTED
head(ws, 4, ['Table', 'Column', 'Allowed values'])
r = 5
for t in T:
    for (name, type_, key, required, note) in t['columns']:
        if type_ not in ('enum', 'tri-state'):
            continue
        put(ws, r, [t['name'], name, note or '(values to be agreed)'],
            wrap_cols=('C',), mono_cols=('A', 'B'))
        ws.row_dimensions[r].height = 26
        r += 1
ws.freeze_panes = 'C5'
ws.auto_filter.ref = f'A4:C{r-1}'

# ═══════════════════════════════════════════════════════════════════════════
# 7 · Your 30, mapped
# ═══════════════════════════════════════════════════════════════════════════
YOUR_30 = [
    (1, 'Users & Roles', 'users + user_roles', 'SPLIT',
     'One person can hold two roles, and a role can end. On one row both are impossible.'),
    (2, 'Locations/Floors/Rooms', 'locations + location_overrides', 'SPLIT',
     'One self-referencing table by kind, plus the days the clinic does not shut at its normal time.'),
    (3, 'Patients', 'patients', 'AS ASKED',
     'With seven tri-state medical columns, because blank must not read as no.'),
    (4, 'Appointments', 'appointments', 'AS ASKED', ''),
    (5, 'Procedures', 'procedures + treatment_master', 'SPLIT',
     'What is being done, and the catalogue of what can be done. One changes hourly, the other yearly.'),
    (6, 'SOP Master', 'sop_master', 'AS ASKED',
     'Versioned — a task done in March was done to March’s standard.'),
    (7, 'Task Master', 'task_master', 'AS ASKED',
     'The join table of the whole system: trigger, owner role, gate, basis, evidence, offset.'),
    (8, 'Task Instances', 'task_instances', 'AS ASKED',
     'Generated from task_master, never copied at booking time.'),
    (9, 'Checklist Master', 'checklist_master', 'AS ASKED',
     'With a pass test on every item, not just a label.'),
    (10, 'Checklist Responses', 'checklist_responses', 'AS ASKED', 'Append-only.'),
    (11, 'Patient Protocols', 'patient_protocols', 'AS ASKED', ''),
    (12, 'Consent Records', 'consent_records', 'AS ASKED',
     'Append-only; signed_at is compared against delivered_at.'),
    (13, 'Follow-ups', 'follow_ups', 'AS ASKED', ''),
    (14, 'Lab Cases', 'lab_cases', 'AS ASKED', ''),
    (15, 'Inventory', 'stock_items + stock_lots', 'SPLIT',
     'The item and the delivery. Expiry and reservation live on the lot, and both decide whether a procedure may start.'),
    (16, 'Implant Inventory', 'stock_items (category=IMPLANT)', 'MERGED',
     'An implant is a lot-tracked stock item. A separate table would duplicate the reservation and expiry logic and let the two disagree. Say if you would rather keep them apart.'),
    (17, 'Equipment/Assets', 'assets', 'AS ASKED', ''),
    (18, 'Maintenance', 'maintenance + asset_cycles', 'SPLIT',
     'What was done, and the several clocks that say when it is due. An autoclave has four.'),
    (19, 'Sterilization Cycles', 'sterilization_cycles', 'AS ASKED',
     'operator_id and released_by must differ. Nobody releases their own batch.'),
    (20, 'Incidents', 'incidents', 'AS ASKED', ''),
    (21, 'CAPA', 'capa', 'AS ASKED',
     'Points at an SOP version, so a fix reaches every task generated from it.'),
    (22, 'Complaints', 'complaints', 'AS ASKED', ''),
    (23, 'Attendance', 'attendance', 'AS ASKED', 'Carries the staff-entry hygiene timestamp.'),
    (24, 'Leave', 'leave', 'AS ASKED',
     'Note: LEAVE is a reserved word in some SQL dialects — quote it, or rename to leave_requests when you move.'),
    (25, 'Training & Competency', 'training_competency', 'AS ASKED', 'The seventh axis of authority.'),
    (26, 'Notifications', 'notifications', 'AS ASKED', ''),
    (27, 'Escalations', 'escalations', 'AS ASKED',
     'Timed off the task’s own clock, so nobody decides when.'),
    (28, 'KPI Definitions', 'kpi_definitions', 'AS ASKED', ''),
    (29, 'KPI Results', 'kpi_results', 'AS ASKED',
     'Append-only, so a trend cannot be improved by editing last month.'),
    (30, 'Audit Logs', 'audit_logs', 'AS ASKED',
     'What the software did. What the CLINIC did is the events table — added, and the spine of everything.'),
]

ws = wb.create_sheet('Your 30')
widths(ws, {'A': 5, 'B': 30, 'C': 34, 'D': 12, 'E': 88})
ws['A1'] = 'Your thirty modules, and what each became'
ws['A2'] = 'Nothing is unaccounted for. One merge, six splits, each with its reason.'
ws['A1'].font, ws['A2'].font = H1, MUTED
head(ws, 4, ['#', 'Your module', 'Table(s)', 'Treatment', 'Why'])
r = 5
FILL_BY = {'AS ASKED': PK, 'SPLIT': FK, 'MERGED': ADDED}
for (n, module, tables, how, why) in YOUR_30:
    put(ws, r, [n, module, tables, how, why],
        fills={'D': FILL_BY.get(how, NOTE)}, wrap_cols=('E',), mono_cols=('C',))
    ws.cell(row=r, column=1).alignment = CTR
    ws.cell(row=r, column=4).alignment = CTR
    ws.cell(row=r, column=2).font = BOLD
    ws.row_dimensions[r].height = 30
    r += 1
ws.freeze_panes = 'B5'
ws.auto_filter.ref = f'A4:E{r-1}'

r += 1
ws.cell(row=r, column=2, value='And one table that was not on your list').font = H2
r += 1
ws.cell(row=r, column=2, value=(
    'events — the append-only log of what happened in the clinic. Everything KuBi computes is derived '
    'from it: whether the clinic is ready, whether a procedure may start, how long an asset has been '
    'down, what stock is available, whether a mandatory requirement was met at the minute of delivery. '
    'None of those is stored anywhere. Without this table the other thirty hold answers that drift from '
    'the truth the first time somebody edits a row; with it, they cannot.')).font = INK
ws.cell(row=r, column=2).alignment = WRAP
ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=5)
ws.row_dimensions[r].height = 76

# ═══════════════════════════════════════════════════════════════════════════
# 8 · One tab per table, ready to paste into
# ═══════════════════════════════════════════════════════════════════════════
EXAMPLES = {
    'users': ['usr_0001', 'KB-014', 'A. Sharma', '+91 98200 00000', 'a@example.test', 'ACTIVE', '2024-03-01', ''],
    'locations': ['loc_op2', 'loc_clinic', 'OPERATORY', 'Operatory 2', '2', '', ''],
    'patients': ['pat_0001', 'KB-2291', 'Anita Rao', '+91 98200 11111', '1986-04-02',
                 'NO', 'NO', 'NO', 'NO', 'NO', 'NO', 'YES', '2026-08-11'],
    'procedures': ['prc_0001', 'apt_0001', 'pat_0001', 'IMPLANT', '36', '1', 'READY', ''],
    'events': ['evt_000001', 'CONSENT_SIGNED', 'prc_0001#CONSENT', 'Anita Rao',
               'TREATING_DOCTOR', 'usr_0001', 'prc_0001:CONSENT:1'],
}

for t in T:
    # Sheet names are capped at 31 characters and must be unique.
    ws = wb.create_sheet(t['name'][:31])
    std = APPEND_ONLY_STANDARD if t['append_only'] else STANDARD
    cols = list(t['columns']) + list(std)
    ws['A1'] = f"{t['n']}. {t['name']}" + ('  ·  APPEND-ONLY: never edit a row' if t['append_only'] else '')
    ws['A1'].font = H2
    ws['A2'] = t['purpose']
    ws['A2'].font = MUTED

    head(ws, 4, [c0[0] for c0 in cols])
    for i, (name, type_, key, required, note) in enumerate(cols, start=1):
        L = get_column_letter(i)
        ws.column_dimensions[L].width = max(14, min(30, len(name) + 8))
        comment = f'{type_}'
        if key:
            comment += f'  ·  {key}'
        comment += f'  ·  {"required" if required == "yes" else "optional"}'
        if note:
            comment += f'\n\n{note}'
        ws.cell(row=4, column=i).comment = Comment(comment, 'KuBi', width=320, height=140)

    example = EXAMPLES.get(t['name'])
    if example:
        for i, v in enumerate(example, start=1):
            cell = ws.cell(row=5, column=i, value=v)
            cell.font = Font(name=F, size=10, italic=True, color='777777')
            cell.border = BOX
        ws.cell(row=5, column=1).comment = Comment(
            'An example row, showing the formats. Overwrite or delete it.', 'KuBi',
            width=260, height=70)
        start = 6
    else:
        start = 5

    for row in range(start, start + 60):
        for i in range(1, len(cols) + 1):
            cell = ws.cell(row=row, column=i)
            cell.border, cell.font = BOX, INK
    ws.freeze_panes = 'A5'
    ws.auto_filter.ref = f'A4:{get_column_letter(len(cols))}{start + 59}'

for sheet in wb.worksheets:
    sheet.sheet_view.showGridLines = False

wb.calculation.fullCalcOnLoad = True
wb.save(OUT)

print(f'{OUT} — {len(T)} tables, '
      f'{sum(len(t["columns"]) + len(APPEND_ONLY_STANDARD if t["append_only"] else STANDARD) for t in T)} columns, '
      f'{len(edges)} foreign keys, {len(wb.worksheets)} sheets')
