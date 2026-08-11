"""
The mandatory list as a workbook, generated from the engine.

The owner asked for "a proper must required list". This is it: every gate that
holds a procedure, per treatment, with what would actually prove it and whose
rule it is. Generated rather than typed, so it cannot drift from what the
software enforces.

    node scripts/dump-gates.mjs > gates.json
    python3 scripts/build-mandatory-xlsx.py gates.json docs/clinic/kubi-mandatory.xlsx
"""
import json
import sys
from collections import Counter, defaultdict

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

SRC = sys.argv[1] if len(sys.argv) > 1 else 'gates.json'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'docs/clinic/kubi-mandatory.xlsx'

data = json.load(open(SRC))
TREATMENTS, GATES, ROWS = data['treatments'], data['gates'], data['rows']

F = 'Arial'
INK = Font(name=F, size=10)
BOLD = Font(name=F, size=10, bold=True)
H1 = Font(name=F, size=16, bold=True)
H2 = Font(name=F, size=12, bold=True)
MUTED = Font(name=F, size=9, color='666666')
HEADF = Font(name=F, size=10, bold=True, color='FFFFFF')

HEAD_FILL = PatternFill('solid', fgColor='0C5F4E')
YOU_FILL = PatternFill('solid', fgColor='FFFF00')
NOTE_FILL = PatternFill('solid', fgColor='F2F4F2')

BASIS_FILL = {
    'STATUTORY': PatternFill('solid', fgColor='D6D8E4'),
    'CONSENT': PatternFill('solid', fgColor='E4D6EC'),
    'SAFETY': PatternFill('solid', fgColor='F8D0CC'),
    'CLINICAL': PatternFill('solid', fgColor='DCEDE6'),
    'RECORD': PatternFill('solid', fgColor='E8ECEA'),
}
BASIS_FONT = {
    'STATUTORY': '2B2F45', 'CONSENT': '5B2D6E', 'SAFETY': '9D2F26',
    'CLINICAL': '0C5F4E', 'RECORD': '55655E',
}
BASIS_MEANING = {
    'STATUTORY': 'Law or licence. NOT the clinic’s to waive, at any level.',
    'CONSENT': 'The patient agreed, in writing, to this specific thing.',
    'SAFETY': 'Doing it without this risks harming the patient.',
    'CLINICAL': 'The treatment cannot be done properly without it.',
    'RECORD': 'The record has to exist, or the treatment cannot be defended.',
}

THIN = Side(style='thin', color='D5DBD7')
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
WRAP = Alignment(vertical='top', wrap_text=True)
TOP = Alignment(vertical='top')
CTR = Alignment(horizontal='center', vertical='top')

ROLE_WORDS = {
    'TREATING_DOCTOR': 'Treating doctor', 'RECEPTION': 'Reception',
    'DENTAL_ASSISTANT': 'Dental assistant', 'SENIOR_ASSISTANT': 'Senior assistant',
    'STERILIZATION_TECHNICIAN': 'Sterilization technician',
    'LAB_COORDINATOR': 'Lab coordinator', 'INVENTORY_COORDINATOR': 'Inventory coordinator',
    'HOUSEKEEPING': 'Housekeeping', 'CLINIC_MANAGER': 'Clinic manager',
}
role = lambda r: ROLE_WORDS.get(r, r) if r else ''

FACT_WORDS = {
    'anticoagulated': 'on a blood thinner',
    'prophylaxisIndicated': 'needs antibiotic prophylaxis',
    'diabetic': 'diabetic', 'antiresorptive': 'on a bisphosphonate',
    'pregnant': 'pregnant', 'penicillinAllergy': 'allergic to penicillin',
    'smoker': 'a smoker', 'minor': 'a minor',
}

wb = Workbook()


def head(ws, row, cols):
    for i, c in enumerate(cols, start=1):
        cell = ws.cell(row=row, column=i, value=c)
        cell.font, cell.fill, cell.border = HEADF, HEAD_FILL, BOX
        cell.alignment = Alignment(vertical='center', wrap_text=True)
    ws.row_dimensions[row].height = 32


def widths(ws, spec):
    for col, w in spec.items():
        ws.column_dimensions[col].width = w


def put(ws, row, values, fills=None, wrap_cols=()):
    for i, v in enumerate(values, start=1):
        cell = ws.cell(row=row, column=i, value=v)
        cell.font, cell.border = INK, BOX
        cell.alignment = WRAP if get_column_letter(i) in wrap_cols else TOP
        if fills and get_column_letter(i) in fills:
            cell.fill = fills[get_column_letter(i)]


# ═══════════════════════════════════════════════════════════ 1 · Read me
ws = wb.active
ws.title = 'Read me'
widths(ws, {'A': 3, 'B': 30, 'C': 74, 'D': 14})
ws['B2'] = 'KuBi — the mandatory list'
ws['B2'].font = H1
ws['B3'] = 'What must be true before a procedure may start, and before the day may close on it.'
ws['B3'].font = MUTED
ws['B4'] = 'Generated from the engine that enforces it, so the two cannot drift apart.'
ws['B4'].font = MUTED

ws['B6'] = 'The rule'
ws['B6'].font = H2
ws['B7'] = ('"If mandatory requirements are missing: PROCEDURE NOT READY. The software should '
            'not quietly allow the missing requirement to disappear."')
ws['B7'].font = Font(name=F, size=11, bold=True)
ws['B7'].alignment = WRAP
ws.merge_cells('B7:C7')
ws.row_dimensions[7].height = 32

ws['B9'] = 'Four ways a requirement disappears, and what stops each'
ws['B9'].font = H2
stops = [
    ('Somebody overrides it',
     'There is no override. Not a permission, not a manager PIN, not a reason box. The '
     'function that decides readiness takes no argument that could let anybody past, so there '
     'is nothing to grant, delegate or leak.'),
    ('Nobody asked, so it looks satisfied',
     'A requirement that depends on an unanswered question fails, exactly as an unmet one '
     'does. An unasked question costs what a missing requirement costs.'),
    ('The refusal is silent',
     'Every attempt to start a procedure that is not ready is written to the log, with what '
     'was missing at that minute. A refusal nobody can count is one people learn to route '
     'around.'),
    ('It happened anyway, and the record caught up',
     'A BREACH is judged strictly on what existed at the minute of delivery. A consent signed '
     'at four o’clock does not make an eleven o’clock start compliant. The breach is '
     'permanent, and nothing in the system can remove one.'),
]
r = 10
for n, (title, how) in enumerate(stops, start=1):
    ws.cell(row=r, column=2, value=f'{n}. {title}').font = BOLD
    c = ws.cell(row=r, column=3, value=how)
    c.font, c.alignment = INK, WRAP
    ws.row_dimensions[r].height = 46
    r += 1

ws['B15'] = 'The sheets'
ws['B15'].font = H2
sheets = [
    ('Must list', 'Every requirement, per treatment. Filter column A for one procedure — this '
                  'is the list to print and put on a wall.'),
    ('By treatment', 'How many requirements each treatment carries, before and after.'),
    ('Gate library', 'The 86 distinct requirements, what proves each, and how many treatments '
                     'use it.'),
    ('Basis', 'The five kinds of requirement, and who may argue about each.'),
]
r = 16
for name, meaning in sheets:
    ws.cell(row=r, column=2, value=f"Sheet '{name}'").font = BOLD
    c = ws.cell(row=r, column=3, value=meaning)
    c.font, c.alignment = INK, WRAP
    ws.row_dimensions[r].height = 28
    r += 1

ws['B21'] = 'Totals'
ws['B21'].font = H2
totals = [
    ('Treatments', "=COUNTA('By treatment'!A5:A100)"),
    ('Distinct requirements', "=COUNTA('Gate library'!A5:A200)"),
    ('Requirement rows', "=COUNTA('Must list'!A5:A600)"),
    ('That hold the procedure', "=COUNTIF('Must list'!E5:E600,\"Before\")"),
    ('That hold the day', "=COUNTIF('Must list'!E5:E600,\"After\")"),
    ('Statutory — not the clinic’s to waive', "=COUNTIF('Must list'!F5:F600,\"STATUTORY\")"),
]
r = 22
for label, formula in totals:
    ws.cell(row=r, column=2, value=label).font = BOLD
    c = ws.cell(row=r, column=4, value=formula)
    c.font, c.alignment, c.border, c.fill = BOLD, CTR, BOX, NOTE_FILL
    r += 1

ws['B29'] = ('Nothing here has been signed off. The requirements were drawn from ordinary '
             'practice so the engine had something real to enforce; every one is the clinical '
             'director’s to confirm or overrule. Use the last column of the Must list.')
ws['B29'].font = Font(name=F, size=10, bold=True, color='9D2F26')
ws['B29'].alignment = WRAP
ws.merge_cells('B29:C29')
ws.row_dimensions[29].height = 44

# ═══════════════════════════════════════════════════════════ 2 · Must list
ws = wb.create_sheet('Must list')
widths(ws, {'A': 13, 'B': 34, 'C': 20, 'D': 46, 'E': 9, 'F': 12, 'G': 24,
            'H': 26, 'I': 76, 'J': 30})
ws['A1'] = 'Mandatory before treatment'
ws['A2'] = ('Filter column A for one procedure. BEFORE holds the chair; AFTER holds the day. '
            'Column I is what would actually prove it — a requirement whose evidence is '
            '"somebody ticked it" is one that has already failed.')
ws['A1'].font, ws['A2'].font = H1, MUTED
ws['A2'].alignment = WRAP
ws.merge_cells('A2:J2')
ws.row_dimensions[2].height = 32

head(ws, 4, ['Code', 'Treatment', 'Requirement', 'What must be true', 'When',
             'Basis', 'Whose', 'Only if the patient is…',
             'What proves it', 'APPROVED? / CHANGE'])
r = 5
for x in ROWS:
    cond = FACT_WORDS.get(x['needs'], x['needs']) if x['needs'] else ''
    put(ws, r, [x['code'], x['treatment'], x['gateId'], x['label'],
                x['stage'].title(), x['basis'], role(x['owner']), cond,
                x['evidence'], None],
        fills={'F': BASIS_FILL.get(x['basis'], NOTE_FILL), 'J': YOU_FILL},
        wrap_cols=('B', 'D', 'I', 'J'))
    ws.cell(row=r, column=1).font = BOLD
    ws.cell(row=r, column=5).alignment = CTR
    ws.cell(row=r, column=6).alignment = CTR
    ws.cell(row=r, column=6).font = Font(
        name=F, size=9, bold=True, color=BASIS_FONT.get(x['basis'], '000000'))
    ws.cell(row=r, column=9).font = MUTED
    ws.row_dimensions[r].height = 28
    r += 1
ws.freeze_panes = 'C5'
ws.auto_filter.ref = f'A4:J{r-1}'
ws['J4'].comment = Comment(
    'Approve the requirement as it stands, or say what should change. '
    'Nothing in this list has been ratified.', 'KuBi', width=300, height=90)
ws['H4'].comment = Comment(
    'A conditional requirement. If the answer is NOT KNOWN, the requirement '
    'FAILS — it is not skipped.', 'KuBi', width=300, height=90)

# ═══════════════════════════════════════════════════════════ 3 · By treatment
ws = wb.create_sheet('By treatment')
widths(ws, {'A': 13, 'B': 42, 'C': 16, 'D': 11, 'E': 11, 'F': 10, 'G': 34})
ws['A1'] = 'How much each procedure has to satisfy'
ws['A2'] = 'BEFORE is what holds the chair. AFTER is what holds the day.'
ws['A1'].font, ws['A2'].font = H1, MUTED
head(ws, 4, ['Code', 'Treatment', 'Category', 'Before', 'After', 'Total', 'NOTES'])
r = 5
for t in sorted(TREATMENTS, key=lambda t: -t['before']):
    put(ws, r, [t['code'], t['name'], t['category'].title(),
                t['before'], t['after'], t['total'], None],
        fills={'G': YOU_FILL}, wrap_cols=('B', 'G'))
    ws.cell(row=r, column=1).font = BOLD
    for col in (4, 5, 6):
        ws.cell(row=r, column=col).alignment = CTR
    r += 1
ws.freeze_panes = 'A5'
ws.auto_filter.ref = f'A4:G{r-1}'

# ═══════════════════════════════════════════════════════════ 4 · Gate library
ws = wb.create_sheet('Gate library')
widths(ws, {'A': 22, 'B': 46, 'C': 12, 'D': 9, 'E': 9, 'F': 26, 'G': 80, 'H': 30})
ws['A1'] = 'The distinct requirements'
ws['A2'] = ('Each one is defined once and used by however many treatments need it, so changing '
            'what proves a consent changes it everywhere at once.')
ws['A1'].font, ws['A2'].font = H1, MUTED
head(ws, 4, ['Requirement', 'What must be true', 'Basis', 'When', 'Used by',
             'Only this role may attest', 'What proves it', 'YOUR CORRECTION'])
r = 5
for gate in sorted(GATES, key=lambda g: -g['usedBy']):
    put(ws, r, [gate['id'], gate['label'], gate['basis'], gate['stage'].title(),
                gate['usedBy'], role(gate['attestedBy']) or 'anyone competent',
                gate['evidence'], None],
        fills={'C': BASIS_FILL.get(gate['basis'], NOTE_FILL), 'H': YOU_FILL},
        wrap_cols=('B', 'G', 'H'))
    ws.cell(row=r, column=1).font = BOLD
    ws.cell(row=r, column=3).alignment = CTR
    ws.cell(row=r, column=3).font = Font(
        name=F, size=9, bold=True, color=BASIS_FONT.get(gate['basis'], '000000'))
    ws.cell(row=r, column=4).alignment = CTR
    ws.cell(row=r, column=5).alignment = CTR
    ws.cell(row=r, column=7).font = MUTED
    ws.row_dimensions[r].height = 28
    r += 1
ws.freeze_panes = 'B5'
ws.auto_filter.ref = f'A4:H{r-1}'

# ═══════════════════════════════════════════════════════════ 5 · Basis
ws = wb.create_sheet('Basis')
widths(ws, {'A': 16, 'B': 66, 'C': 12, 'D': 40})
ws['A1'] = 'The five kinds of requirement'
ws['A2'] = 'Which decides who may argue about one.'
ws['A1'].font, ws['A2'].font = H1, MUTED
head(ws, 4, ['Basis', 'What it means', 'Count', 'Who may change it'])
counts = Counter(x['basis'] for x in ROWS)
WHO = {
    'STATUTORY': 'Nobody. Not the owner, not the director.',
    'CONSENT': 'Nobody — but the wording is the director’s.',
    'SAFETY': 'The clinical director, with a written reason.',
    'CLINICAL': 'The clinical director.',
    'RECORD': 'The clinical director.',
}
r = 5
for basis in ['STATUTORY', 'CONSENT', 'SAFETY', 'CLINICAL', 'RECORD']:
    put(ws, r, [basis, BASIS_MEANING[basis], counts.get(basis, 0), WHO[basis]],
        fills={'A': BASIS_FILL[basis]}, wrap_cols=('B', 'D'))
    ws.cell(row=r, column=1).font = Font(
        name=F, size=10, bold=True, color=BASIS_FONT[basis])
    ws.cell(row=r, column=3).alignment = CTR
    ws.row_dimensions[r].height = 34
    r += 1

r += 1
ws.cell(row=r, column=1, value='Where the requirements come from').font = H2
r += 1
ws.cell(row=r, column=1, value=(
    'Not written twice. Every requirement here is a blocking item in the treatment catalogue, '
    'so there is one source of truth for what holds a procedure. What this engine adds is the '
    'EVIDENCE — what would actually prove it — and the BASIS, which is whose rule it is. Two '
    'requirements also reach outside the catalogue entirely: "equipment fit for this procedure" '
    'reads the asset register, because "sterilization confirmed" is not a fact about implants, '
    'it is a fact about the autoclave.')).font = INK
ws.cell(row=r, column=1).alignment = WRAP
ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=4)
ws.row_dimensions[r].height = 76

# ═══════════════════════════════════════════════════════════ by role tally
by_role = defaultdict(int)
for x in ROWS:
    by_role[x['owner']] += 1
ws = wb['By treatment']
row = ws.max_row + 2
ws.cell(row=row, column=1, value='Requirements by role').font = H2
row += 1
for owner, n in sorted(by_role.items(), key=lambda kv: -kv[1]):
    ws.cell(row=row, column=1, value=role(owner)).font = BOLD
    c = ws.cell(row=row, column=4, value=n)
    c.font, c.alignment = BOLD, CTR
    row += 1

for sheet in wb.worksheets:
    sheet.sheet_view.showGridLines = False

wb.calculation.fullCalcOnLoad = True
wb.save(OUT)
print(f'{OUT} — {len(TREATMENTS)} treatments, {len(GATES)} gates, {len(ROWS)} rows')
