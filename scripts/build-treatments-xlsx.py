"""
The treatment catalogue as a workbook, generated from the engine.

Not hand-maintained. `scripts/dump-treatments.mjs` reads TREATMENTS out of
packages/contracts and this turns it into something that can be filtered, and
— on the Sign-off sheet — ratified. Nothing in the catalogue has been approved
by the clinical director; that sheet is where it gets approved, one row at a
time, and the yellow columns are the only input cells.

    node scripts/dump-treatments.mjs && python3 scripts/build-treatments-xlsx.py
"""
import json
import sys
from collections import Counter, defaultdict

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

SRC = sys.argv[1] if len(sys.argv) > 1 else 'treatments.json'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'docs/clinic/kubi-treatments.xlsx'

data = json.load(open(SRC))
TREATMENTS, ROWS = data['treatments'], data['rows']

F = 'Arial'
INK = Font(name=F, size=10)
BOLD = Font(name=F, size=10, bold=True)
H1 = Font(name=F, size=16, bold=True)
H2 = Font(name=F, size=12, bold=True)
MUTED = Font(name=F, size=9, color='666666')
HEADF = Font(name=F, size=10, bold=True, color='FFFFFF')

HEAD_FILL = PatternFill('solid', fgColor='0C5F4E')
YOU_FILL = PatternFill('solid', fgColor='FFFF00')
BLOCK_FILL = PatternFill('solid', fgColor='F8D0CC')
ADVISE_FILL = PatternFill('solid', fgColor='FDF0D5')
COND_FILL = PatternFill('solid', fgColor='E4E8F5')
NOTE_FILL = PatternFill('solid', fgColor='F2F4F2')

THIN = Side(style='thin', color='D5DBD7')
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
WRAP = Alignment(vertical='top', wrap_text=True)
TOP = Alignment(vertical='top')
CTR = Alignment(horizontal='center', vertical='top')

wb = Workbook()


def head(ws, row, cols):
    for i, c in enumerate(cols, start=1):
        cell = ws.cell(row=row, column=i, value=c)
        cell.font, cell.fill, cell.border = HEADF, HEAD_FILL, BOX
        cell.alignment = Alignment(vertical='center', wrap_text=True)
    ws.row_dimensions[row].height = 30


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


def when(stage, offset):
    """A due time said the way a clinic says it, not in minutes."""
    if offset == 0:
        return 'at the appointment' if stage == 'BEFORE' else 'at delivery'
    if offset % 1440 == 0:
        n = offset // 1440
        unit = 'day' if n == 1 else 'days'
        return f'{n} {unit} before' if stage == 'BEFORE' else f'{n} {unit} after'
    if offset % 60 == 0:
        n = offset // 60
        unit = 'hour' if n == 1 else 'hours'
        return f'{n} {unit} before' if stage == 'BEFORE' else f'{n} {unit} after'
    return f'{offset} min before' if stage == 'BEFORE' else f'{offset} min after'


FACT_WORDS = {
    'anticoagulated': 'on a blood thinner',
    'prophylaxisIndicated': 'needs antibiotic prophylaxis',
    'diabetic': 'diabetic',
    'antiresorptive': 'on a bisphosphonate',
    'pregnant': 'pregnant',
    'penicillinAllergy': 'allergic to penicillin',
    'smoker': 'a smoker',
    'minor': 'a minor',
}

ROLE_WORDS = {
    'TREATING_DOCTOR': 'Treating doctor',
    'RECEPTION': 'Reception',
    'DENTAL_ASSISTANT': 'Dental assistant',
    'SENIOR_ASSISTANT': 'Senior assistant',
    'STERILIZATION_TECHNICIAN': 'Sterilization technician',
    'LAB_COORDINATOR': 'Lab coordinator',
    'INVENTORY_COORDINATOR': 'Inventory coordinator',
    'HOUSEKEEPING': 'Housekeeping',
    'CLINIC_MANAGER': 'Clinic manager',
}
role = lambda r: ROLE_WORDS.get(r, r)

# ═══════════════════════════════════════════════════════════ 1 · Read me
ws = wb.active
ws.title = 'Read me'
widths(ws, {'A': 3, 'B': 32, 'C': 66, 'D': 14})
ws['B2'] = 'KuBi — the treatment catalogue'
ws['B2'].font = H1
ws['B3'] = 'Every treatment the clinic books, and the work each one generates by itself.'
ws['B3'].font = MUTED
ws['B4'] = 'Generated from the engine, not typed. Regenerate with scripts/build-treatments-xlsx.py.'
ws['B4'].font = MUTED

ws['B6'] = 'The idea'
ws['B6'].font = H2
ws['B7'] = ('Booking a treatment is what makes its work exist. Nobody creates the consent, '
            'the inventory check or the post-operative call — they are derived from the '
            'booking, so correcting a protocol corrects every booking already in the diary.')
ws['B7'].font = INK
ws['B7'].alignment = WRAP
ws.merge_cells('B7:C7')
ws.row_dimensions[7].height = 46

ws['B9'] = 'The sheets'
ws['B9'].font = H2
sheets = [
    ('Sign-off', 'START HERE. One row per treatment for the clinical director to approve or change. '
                 'Nothing in this catalogue has been ratified.'),
    ('Treatments', 'All 39, with how much work each one generates and how much of it blocks.'),
    ('All work', 'All 538 items. Filter by treatment, owner, stage, or gate.'),
    ('By role', 'What each role owns across the whole catalogue.'),
    ('Conditions', 'The eight patient facts that change what a treatment requires — and what '
                   'happens when nobody has asked.'),
]
r = 10
for name, meaning in sheets:
    ws.cell(row=r, column=2, value=f"Sheet '{name}'").font = BOLD
    c = ws.cell(row=r, column=3, value=meaning)
    c.font, c.alignment = INK, WRAP
    ws.row_dimensions[r].height = 28
    r += 1

ws['B17'] = 'Colour key'
ws['B17'].font = H2
key = [('YELLOW', 'You fill this in.', YOU_FILL),
       ('PINK', 'BLOCK — the treatment may not start (or the day may not close) without it.', BLOCK_FILL),
       ('AMBER', 'ADVISE — real work that does not hold a patient in a chair.', ADVISE_FILL),
       ('BLUE', 'Conditional — applies only to some patients. See the Conditions sheet.', COND_FILL)]
r = 18
for name, meaning, fill in key:
    c = ws.cell(row=r, column=2, value=name)
    c.font, c.fill, c.border = BOLD, fill, BOX
    d = ws.cell(row=r, column=3, value=meaning)
    d.font, d.alignment = INK, WRAP
    r += 1

ws['B23'] = 'Totals'
ws['B23'].font = H2
totals = [
    ('Treatments', "=COUNTA(Treatments!A5:A100)"),
    ('Categories', "=SUMPRODUCT((Treatments!C5:C43<>\"\")/COUNTIF(Treatments!C5:C43,Treatments!C5:C43&\"\"))"),
    ('Pieces of work', "=COUNTA('All work'!A5:A600)"),
    ('Of those, blocking', "=COUNTIF('All work'!H5:H600,\"BLOCK\")"),
    ('Conditional on a patient fact', "=COUNTIF('All work'!I5:I600,\"<>\")"),
    ('Treatments signed off', "=COUNTA('Sign-off'!E5:E43)"),
]
r = 24
for label, formula in totals:
    ws.cell(row=r, column=2, value=label).font = BOLD
    c = ws.cell(row=r, column=4, value=formula)
    c.font, c.alignment, c.border, c.fill = BOLD, CTR, BOX, NOTE_FILL
    r += 1

ws['B31'] = ('Nothing here has been signed off. The timings, the gates and the conditions were '
             'drawn from ordinary practice so the engine had something real to run on. Every one '
             'is the clinical director’s to confirm or overrule.')
ws['B31'].font = Font(name=F, size=10, bold=True, color='9D2F26')
ws['B31'].alignment = WRAP
ws.merge_cells('B31:C31')
ws.row_dimensions[31].height = 40

# ═══════════════════════════════════════════════════════════ 2 · Sign-off
ws = wb.create_sheet('Sign-off')
widths(ws, {'A': 14, 'B': 40, 'C': 16, 'D': 10, 'E': 18, 'F': 36, 'G': 34, 'H': 14})
ws['A1'] = 'Sign-off — one row per treatment'
ws['A1'].font = H1
ws['A2'] = ('The catalogue is a scaffold until this sheet is filled in. Approve a treatment as it '
            'stands, or say what to change. The system keeps refusing to call it ratified until then.')
ws['A2'].font = MUTED
head(ws, 4, ['Code', 'Treatment', 'Category', 'Work', 'APPROVED? (Y/N)',
             'WHAT TO CHANGE', 'WHAT IS MISSING', 'BY WHOM'])
r = 5
for t in TREATMENTS:
    put(ws, r, [t['code'], t['name'], t['category'].title(), t['items'], None, None, None, None],
        fills={'E': YOU_FILL, 'F': YOU_FILL, 'G': YOU_FILL, 'H': YOU_FILL},
        wrap_cols=('B', 'F', 'G'))
    ws.cell(row=r, column=1).font = BOLD
    ws.cell(row=r, column=4).alignment = CTR
    r += 1
ws.freeze_panes = 'A5'
ws.auto_filter.ref = f'A4:H{r-1}'
ws['E4'].comment = Comment(
    'Y approves the treatment exactly as the All work sheet has it. '
    'N means something must change — say what in the next column.', 'KuBi', width=300, height=90)

# ═══════════════════════════════════════════════════════════ 3 · Treatments
ws = wb.create_sheet('Treatments')
widths(ws, {'A': 14, 'B': 42, 'C': 16, 'D': 9, 'E': 9, 'F': 8, 'G': 9,
            'H': 9, 'I': 10, 'J': 11, 'K': 30})
ws['A1'] = 'The 39 treatments'
ws['A2'] = 'Filter column C for a category. "Blocking" is how much of the work holds the chair or the day.'
ws['A1'].font, ws['A2'].font = H1, MUTED
head(ws, 4, ['Code', 'Treatment', 'Category', 'Chair min', 'Sittings',
             'Work', 'Before', 'After', 'Blocking', 'Conditional', 'NOTES'])
r = 5
for t in TREATMENTS:
    put(ws, r, [t['code'], t['name'], t['category'].title(), t['minutes'], t['sittings'],
                t['items'], t['before'], t['after'], t['blocking'], t['conditional'], None],
        fills={'K': YOU_FILL}, wrap_cols=('B', 'K'))
    ws.cell(row=r, column=1).font = BOLD
    for col in range(4, 11):
        ws.cell(row=r, column=col).alignment = CTR
    r += 1
ws.freeze_panes = 'A5'
ws.auto_filter.ref = f'A4:K{r-1}'

# ═══════════════════════════════════════════════════════════ 4 · All work
ws = wb.create_sheet('All work')
widths(ws, {'A': 13, 'B': 34, 'C': 20, 'D': 52, 'E': 24, 'F': 9, 'G': 22,
            'H': 9, 'I': 26, 'J': 72, 'K': 28})
ws['A1'] = 'All 538 pieces of work'
ws['A2'] = ('Every row was derived from a booking, never typed. Filter column A for one treatment, '
            'column E for one role, or column H for what actually blocks.')
ws['A1'].font, ws['A2'].font = H1, MUTED
head(ws, 4, ['Code', 'Treatment', 'Item', 'What it is', 'Owner', 'Stage',
             'When', 'Gate', 'Only if the patient is…', 'Why', 'YOUR CORRECTION'])
r = 5
for x in ROWS:
    cond = ''
    if x['needs']:
        word = FACT_WORDS.get(x['needs'], x['needs'])
        cond = f'NOT {word}' if x['needsAbsent'] else word
    fills = {'K': YOU_FILL, 'H': BLOCK_FILL if x['gate'] == 'BLOCK' else ADVISE_FILL}
    if cond:
        fills['I'] = COND_FILL
    put(ws, r, [x['code'], x['name'], x['itemId'], x['label'], role(x['owner']),
                x['stage'].title(), when(x['stage'], x['offset']), x['gate'],
                cond, x['because'], None],
        fills=fills, wrap_cols=('B', 'D', 'J', 'K'))
    ws.cell(row=r, column=1).font = BOLD
    ws.cell(row=r, column=8).alignment = CTR
    ws.cell(row=r, column=8).font = Font(
        name=F, size=10, bold=True,
        color='9D2F26' if x['gate'] == 'BLOCK' else '7D5610')
    ws.cell(row=r, column=10).font = MUTED
    r += 1
ws.freeze_panes = 'D5'
ws.auto_filter.ref = f'A4:K{r-1}'

# ═══════════════════════════════════════════════════════════ 5 · By role
ws = wb.create_sheet('By role')
widths(ws, {'A': 28, 'B': 10, 'C': 11, 'D': 10, 'E': 10, 'F': 66})
ws['A1'] = 'What each role owns, across the whole catalogue'
ws['A2'] = 'Counted over items, so a role owning one item in 30 treatments shows 30.'
ws['A1'].font, ws['A2'].font = H1, MUTED
head(ws, 4, ['Role', 'Items', 'Blocking', 'Before', 'After', 'The ones that block, by name'])

by_role = defaultdict(list)
for x in ROWS:
    by_role[x['owner']].append(x)
r = 5
for owner, items in sorted(by_role.items(), key=lambda kv: -len(kv[1])):
    blocking = [i for i in items if i['gate'] == 'BLOCK']
    names = sorted({i['label'] for i in blocking})
    put(ws, r, [role(owner), len(items), len(blocking),
                sum(1 for i in items if i['stage'] == 'BEFORE'),
                sum(1 for i in items if i['stage'] == 'AFTER'),
                ' · '.join(names[:14]) + (' …' if len(names) > 14 else '')],
        wrap_cols=('F',))
    ws.cell(row=r, column=1).font = BOLD
    for col in (2, 3, 4, 5):
        ws.cell(row=r, column=col).alignment = CTR
    ws.row_dimensions[r].height = 46
    r += 1
ws.freeze_panes = 'A5'

# ═══════════════════════════════════════════════════════════ 6 · Conditions
ws = wb.create_sheet('Conditions')
widths(ws, {'A': 26, 'B': 44, 'C': 9, 'D': 70, 'E': 30})
ws['A1'] = 'The eight questions that change the work'
ws['A2'] = ('Each is yes, no, or NOBODY HAS ASKED — and the third is not the same as no. '
            'An unasked question holds the chair exactly as an undone task does.')
ws['A1'].font, ws['A2'].font = H1, MUTED
head(ws, 4, ['Patient fact', 'Asked as', 'Items', 'What it adds', 'NOTES'])

by_fact = defaultdict(list)
for x in ROWS:
    if x['needs']:
        by_fact[x['needs']].append(x)
r = 5
for fact, word in FACT_WORDS.items():
    items = by_fact.get(fact, [])
    adds = sorted({i['label'] for i in items})
    put(ws, r, [fact, f'Is the patient {word}?', len(items),
                ' · '.join(adds) if adds else '—', None],
        fills={'E': YOU_FILL, 'A': COND_FILL}, wrap_cols=('B', 'D', 'E'))
    ws.cell(row=r, column=1).font = BOLD
    ws.cell(row=r, column=3).alignment = CTR
    ws.row_dimensions[r].height = 40
    r += 1
ws.freeze_panes = 'A5'

ws.cell(row=r + 1, column=1,
        value='Why this matters more than it looks').font = H2
ws.cell(row=r + 2, column=1, value=(
    'The obvious way to write a conditional item is "if the patient is anticoagulated, add the '
    'bleeding plan". That silently skips the item when the answer is NOT KNOWN as well as when it '
    'is no — and an unasked question then looks exactly like a negative one. So a fact here is '
    'yes / no / nobody-asked, and an item on an unasked question is UNKNOWN, which blocks. The '
    'refusal names the question rather than the task: "Nobody has asked whether the patient is on '
    'a blood thinner", not "the bleeding plan has not been agreed" — which would send somebody to '
    'ring a prescriber about a patient who may not need one.')).font = INK
ws.cell(row=r + 2, column=1).alignment = WRAP
ws.merge_cells(start_row=r + 2, start_column=1, end_row=r + 2, end_column=4)
ws.row_dimensions[r + 2].height = 90

# ═══════════════════════════════════════════════════════════ categories tally
cats = Counter(t['category'] for t in TREATMENTS)
ws = wb['Treatments']
row = ws.max_row + 2
ws.cell(row=row, column=1, value='By category').font = H2
row += 1
for cat, n in sorted(cats.items()):
    ws.cell(row=row, column=1, value=cat.title()).font = BOLD
    ws.cell(row=row, column=4, value=n).alignment = CTR
    ws.cell(row=row, column=4).font = BOLD
    row += 1

for sheet in wb.worksheets:
    sheet.sheet_view.showGridLines = False

wb.calculation.fullCalcOnLoad = True
wb.save(OUT)
print(f'{OUT} — {len(TREATMENTS)} treatments, {len(ROWS)} items')
