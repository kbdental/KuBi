"""
The asset register as a workbook, generated from the engine.

The 'Your register' sheet is the important one: it is the blank the clinic's
own asset list gets pasted into. Every column it asks for is a column the
engine actually uses — nothing is collected for the sake of collecting it, and
the two columns that decide whether the whole thing works (last service date
and interval) are marked as such.

    node scripts/dump-assets.mjs > assets.json
    python3 scripts/build-assets-xlsx.py assets.json docs/clinic/kubi-equipment.xlsx
"""
import json
import sys
from collections import Counter, defaultdict

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

SRC = sys.argv[1] if len(sys.argv) > 1 else 'assets.json'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'docs/clinic/kubi-equipment.xlsx'

data = json.load(open(SRC))
ASSETS, CYCLES = data['assets'], data['cycles']

F = 'Arial'
INK = Font(name=F, size=10)
BOLD = Font(name=F, size=10, bold=True)
H1 = Font(name=F, size=16, bold=True)
H2 = Font(name=F, size=12, bold=True)
MUTED = Font(name=F, size=9, color='666666')
HEADF = Font(name=F, size=10, bold=True, color='FFFFFF')
HEADF_KEY = Font(name=F, size=10, bold=True, color='000000')

HEAD_FILL = PatternFill('solid', fgColor='0C5F4E')
KEY_HEAD_FILL = PatternFill('solid', fgColor='FFD400')
YOU_FILL = PatternFill('solid', fgColor='FFFF00')
STOP_FILL = PatternFill('solid', fgColor='F8D0CC')
WARN_FILL = PatternFill('solid', fgColor='FDF0D5')
OK_FILL = PatternFill('solid', fgColor='DCEDE6')
NOTE_FILL = PatternFill('solid', fgColor='F2F4F2')

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
role = lambda r: ROLE_WORDS.get(r, r)

CRIT_WORDS = {
    'STOPS_CLINIC': 'Clinic stops',
    'STOPS_WORK': 'One room stops',
    'DEGRADES': 'Day continues',
}

wb = Workbook()


def head(ws, row, cols, key_cols=()):
    for i, c in enumerate(cols, start=1):
        cell = ws.cell(row=row, column=i, value=c)
        if get_column_letter(i) in key_cols:
            cell.font, cell.fill = HEADF_KEY, KEY_HEAD_FILL
        else:
            cell.font, cell.fill = HEADF, HEAD_FILL
        cell.border = BOX
        cell.alignment = Alignment(vertical='center', wrap_text=True)
    ws.row_dimensions[row].height = 34


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


def interval(d):
    return {1: 'Daily', 7: 'Weekly', 30: 'Monthly', 90: 'Quarterly',
            180: 'Six-monthly', 365: 'Yearly', 730: 'Two-yearly',
            1825: 'Five-yearly'}.get(d, f'Every {d} days')


# ═══════════════════════════════════════════════════════════ 1 · Read me
ws = wb.active
ws.title = 'Read me'
widths(ws, {'A': 3, 'B': 32, 'C': 70, 'D': 14})
ws['B2'] = 'KuBi — the equipment engine'
ws['B2'].font = H1
ws['B3'] = 'Every asset carries its own record, and the record generates the work.'
ws['B3'].font = MUTED
ws['B4'] = 'Generated from the engine. Regenerate with scripts/build-assets-xlsx.py.'
ws['B4'].font = MUTED

ws['B6'] = 'The rule'
ws['B6'].font = H2
ws['B7'] = ('"If Next Service Date = Today, the app automatically creates the service task." '
            'It does — and it also brings the task forward by the warning period, because a '
            'vendor cannot be booked on the morning the service falls due. What fires ON the '
            'day is the overdue state, which is louder.')
ws['B7'].font, ws['B7'].alignment = INK, WRAP
ws.merge_cells('B7:C7')
ws.row_dimensions[7].height = 58

ws['B9'] = 'The sheets'
ws['B9'].font = H2
sheets = [
    ('Your register', 'START HERE. The blank for the clinic’s own asset list. Paste yours in, '
                      'or send the Google Sheet and it gets loaded for you.'),
    ('Register', 'The 44 synthetic assets currently in the engine, for reference.'),
    ('Cycles', 'All 73 recurring obligations — what, how often, whose, and whether it stops '
               'the asset being used.'),
    ('By role', 'What each role carries across the whole register.'),
    ('How it decides', 'The four states an asset can be in, and why UNSERVICED is not the '
                       'same as nothing being due.'),
]
r = 10
for name, meaning in sheets:
    ws.cell(row=r, column=2, value=f"Sheet '{name}'").font = BOLD
    c = ws.cell(row=r, column=3, value=meaning)
    c.font, c.alignment = INK, WRAP
    ws.row_dimensions[r].height = 28
    r += 1

ws['B17'] = 'Totals'
ws['B17'].font = H2
totals = [
    ('Assets in the engine', "=COUNTA(Register!A5:A100)"),
    ('Recurring obligations', "=COUNTA(Cycles!A5:A200)"),
    ('That stop the asset being used', '=COUNTIF(Cycles!G5:G200,"YES")'),
    ('Assets whose failure stops the clinic', '=COUNTIF(Register!F5:F100,"Clinic stops")'),
    ('Rows filled into Your register', "=COUNTA('Your register'!A6:A300)"),
]
r = 18
for label, formula in totals:
    ws.cell(row=r, column=2, value=label).font = BOLD
    c = ws.cell(row=r, column=4, value=formula)
    c.font, c.alignment, c.border, c.fill = BOLD, CTR, BOX, NOTE_FILL
    r += 1

ws['B24'] = ('The register in this workbook is synthetic — the tags, serial numbers and contract '
             'dates are made up so the engine had something real to run on. Send the clinic’s own '
             'asset list and it replaces this one row for row, without a line of the engine '
             'changing.')
ws['B24'].font = Font(name=F, size=10, bold=True, color='9D2F26')
ws['B24'].alignment = WRAP
ws.merge_cells('B24:C24')
ws.row_dimensions[24].height = 44

# ═══════════════════════════════════════════════════════════ 2 · Your register
ws = wb.create_sheet('Your register')
widths(ws, {'A': 16, 'B': 34, 'C': 18, 'D': 22, 'E': 24, 'F': 18, 'G': 18,
            'H': 18, 'I': 16, 'J': 16, 'K': 16, 'L': 20, 'M': 22, 'N': 36, 'O': 30})
ws['A1'] = 'Your register — paste the clinic’s asset list here'
ws['A1'].font = H1
ws['A2'] = ('Every column below is one the engine actually uses. The two in YELLOW HEADERS are '
            'the ones that make it work: without a last service date and an interval, no due '
            'date can be calculated — and the engine will report the asset as UNSERVICED rather '
            'than as nothing being due.')
ws['A2'].font = MUTED
ws['A2'].alignment = WRAP
ws.merge_cells('A2:O2')
ws.row_dimensions[2].height = 40

head(ws, 4, ['Asset ID', 'Name', 'Category', 'Location', 'Responsible role',
             'Criticality', 'Make', 'Model', 'Serial', 'Commissioned',
             'Warranty until', 'LAST SERVICE', 'SERVICE INTERVAL',
             'Daily check — with its pass test', 'AMC vendor / expiry / cover'],
     key_cols=('L', 'M'))

EXAMPLE = ['AUTOCLAVE-01', 'Autoclave', 'Sterilization', 'Sterilisation room',
           'Sterilization technician', 'Clinic stops', 'Runyes', 'Class B 23L',
           'RY-B23-4471', '2023-04-11', '2025-04-10', '2026-02-14', 'Six-monthly',
           'Water level, gasket intact, helix pack passes on the first cycle',
           'Runyes India / 2026-11-14 / two visits a year, gasket and filter included']
put(ws, 5, EXAMPLE, wrap_cols=('N', 'O'))
for i in range(1, 16):
    ws.cell(row=5, column=i).font = Font(name=F, size=10, italic=True, color='777777')
ws.cell(row=5, column=1).comment = Comment(
    'An example row, showing the format. Overwrite it or delete it.', 'KuBi',
    width=260, height=70)
ws.row_dimensions[5].height = 40

for r in range(6, 300):
    for i in range(1, 16):
        c = ws.cell(row=r, column=i)
        c.border, c.font = BOX, INK
        c.fill = YOU_FILL if i in (12, 13) else PatternFill('solid', fgColor='FFFFFF')
ws.freeze_panes = 'C5'
ws.auto_filter.ref = 'A4:O299'

ws['C4'].comment = Comment(
    'One of: Chairside, Sterilization, Imaging, Plant, Facility, Safety, '
    'Front office, Laboratory.', 'KuBi', width=280, height=80)
ws['E4'].comment = Comment(
    'A ROLE, never a person — the record has to survive somebody leaving. '
    'One of: Dental assistant, Senior assistant, Sterilization technician, '
    'Reception, Housekeeping, Clinic manager, Lab coordinator, '
    'Inventory coordinator.', 'KuBi', width=320, height=120)
ws['F4'].comment = Comment(
    'What breaks when it fails: "Clinic stops", "One room stops", '
    'or "Day continues".', 'KuBi', width=280, height=80)
ws['L4'].comment = Comment(
    'The date it was ACTUALLY last serviced. Leave blank if genuinely unknown '
    '— the engine reports UNSERVICED, which is louder than overdue, rather '
    'than guessing.', 'KuBi', width=320, height=110)
ws['N4'].comment = Comment(
    'Not "switch it on". A daily check needs a pass test, or it becomes a tick '
    'somebody does from the corridor.', 'KuBi', width=300, height=90)

# ═══════════════════════════════════════════════════════════ 3 · Register
ws = wb.create_sheet('Register')
widths(ws, {'A': 16, 'B': 32, 'C': 15, 'D': 20, 'E': 24, 'F': 17, 'G': 16,
            'H': 18, 'I': 8, 'J': 9, 'K': 46, 'L': 44, 'M': 30})
ws['A1'] = 'The 44 assets currently in the engine'
ws['A2'] = 'Synthetic, and here for reference — the shape your own list will take.'
ws['A1'].font, ws['A2'].font = H1, MUTED
head(ws, 4, ['Asset ID', 'Name', 'Category', 'Location', 'Responsible',
             'Criticality', 'Make', 'Model', 'Cycles', 'Blocking',
             'Daily check', 'AMC', 'Documents'])
r = 5
for a in ASSETS:
    amc = 'no contract'
    if a['amcVendor']:
        amc = a['amcVendor'] + ('' if a['amcKnownExpiry'] else ' — NO EXPIRY RECORDED')
    fills = {}
    if a['criticality'] == 'STOPS_CLINIC':
        fills['F'] = STOP_FILL
    elif a['criticality'] == 'STOPS_WORK':
        fills['F'] = WARN_FILL
    else:
        fills['F'] = OK_FILL
    if a['amcVendor'] and not a['amcKnownExpiry']:
        fills['L'] = WARN_FILL
    if not a['documents']:
        fills['M'] = WARN_FILL
    put(ws, r, [a['tag'], a['name'], a['category'].title().replace('_', ' '),
                a['location'], role(a['responsible']),
                CRIT_WORDS.get(a['criticality'], a['criticality']),
                a['make'], a['model'], a['cycles'], a['blocking'],
                a['dailyCheck'] or 'none',
                amc, ', '.join(a['documents']) or 'none held'],
        fills=fills, wrap_cols=('K', 'L', 'M'))
    ws.cell(row=r, column=1).font = BOLD
    ws.cell(row=r, column=9).alignment = CTR
    ws.cell(row=r, column=10).alignment = CTR
    ws.row_dimensions[r].height = 30
    r += 1
ws.freeze_panes = 'C5'
ws.auto_filter.ref = f'A4:M{r-1}'

# ═══════════════════════════════════════════════════════════ 4 · Cycles
ws = wb.create_sheet('Cycles')
widths(ws, {'A': 16, 'B': 30, 'C': 34, 'D': 16, 'E': 14, 'F': 24, 'G': 10,
            'H': 74, 'I': 28})
ws['A1'] = 'The 73 recurring obligations'
ws['A2'] = ('Each one is its own clock. An autoclave has four running at once — the service, '
            'the weekly spore test, the annual validation and the gasket — and they are not '
            'one date. Filter column G for the ones that stop an asset being used.')
ws['A1'].font, ws['A2'].font = H1, MUTED
head(ws, 4, ['Asset ID', 'Asset', 'What is due', 'How often',
             'Warn ahead', 'Whose', 'Blocks?', 'Why it matters', 'YOUR CORRECTION'])
r = 5
for c in CYCLES:
    put(ws, r, [c['tag'], c['assetName'], c['label'], interval(c['everyDays']),
                f"{c['warnAheadDays']} days" if c['warnAheadDays'] else 'same day',
                role(c['owner']), 'YES' if c['blocks'] else '', c['because'], None],
        fills={'G': STOP_FILL if c['blocks'] else WARN_FILL, 'I': YOU_FILL},
        wrap_cols=('C', 'H', 'I'))
    ws.cell(row=r, column=1).font = BOLD
    ws.cell(row=r, column=7).alignment = CTR
    ws.cell(row=r, column=7).font = Font(name=F, size=10, bold=True, color='9D2F26')
    ws.cell(row=r, column=8).font = MUTED
    ws.row_dimensions[r].height = 28
    r += 1
ws.freeze_panes = 'C5'
ws.auto_filter.ref = f'A4:I{r-1}'

# ═══════════════════════════════════════════════════════════ 5 · By role
ws = wb.create_sheet('By role')
widths(ws, {'A': 26, 'B': 10, 'C': 10, 'D': 11, 'E': 72})
ws['A1'] = 'What each role carries'
ws['A2'] = 'The responsible person is held as a role, so the record survives somebody leaving.'
ws['A1'].font, ws['A2'].font = H1, MUTED
head(ws, 4, ['Role', 'Assets', 'Cycles', 'Blocking', 'The ones that block, by name'])

owns = defaultdict(list)
for a in ASSETS:
    owns[a['responsible']].append(a)
cyc_by_role = defaultdict(list)
for c in CYCLES:
    cyc_by_role[c['owner']].append(c)

r = 5
for owner in sorted(set(list(owns) + list(cyc_by_role)),
                    key=lambda o: -len(cyc_by_role.get(o, []))):
    cs = cyc_by_role.get(owner, [])
    blocking = [c for c in cs if c['blocks']]
    names = sorted({f"{c['label']} ({c['tag']})" for c in blocking})
    put(ws, r, [role(owner), len(owns.get(owner, [])), len(cs), len(blocking),
                ' · '.join(names[:10]) + (' …' if len(names) > 10 else '') or '—'],
        wrap_cols=('E',))
    ws.cell(row=r, column=1).font = BOLD
    for col in (2, 3, 4):
        ws.cell(row=r, column=col).alignment = CTR
    ws.row_dimensions[r].height = 48
    r += 1
ws.freeze_panes = 'A5'

# ═══════════════════════════════════════════════════════════ 6 · How it decides
ws = wb.create_sheet('How it decides')
widths(ws, {'A': 22, 'B': 74, 'C': 40})
ws['A1'] = 'The four states, and why the order matters'
ws['A1'].font = H1
head(ws, 3, ['State', 'What it means', 'What the engine does'])
states = [
    ('DOWN', 'Reported broken and not yet reported back. Downtime counts from the failure '
             'to now — it is the absence of a restoration event, not a status field somebody sets.',
     'Shows first. Everything else waits.'),
    ('UNSERVICED', 'Nobody has ever recorded a service against it. NOT the same as nothing '
                   'being due: the arithmetic "next = last + interval" cannot run at all, and '
                   'the obvious implementation quietly reports no service due — the exact '
                   'opposite of the truth.',
     'Ranked ABOVE overdue. A machine with no history is a machine nobody can vouch for.'),
    ('OVERDUE', 'Serviced at some point, and the next date has passed.',
     'The task exists with a day count against it.'),
    ('OPERATIONAL', 'Working, and everything due against it is in date.',
     'Quiet. Nothing is shown that nobody needs to act on.'),
]
r = 4
for name, meaning, does in states:
    put(ws, r, [name, meaning, does],
        fills={'A': STOP_FILL if name in ('DOWN', 'UNSERVICED')
               else WARN_FILL if name == 'OVERDUE' else OK_FILL},
        wrap_cols=('B', 'C'))
    ws.cell(row=r, column=1).font = BOLD
    ws.row_dimensions[r].height = 72
    r += 1

r += 1
ws.cell(row=r, column=1, value='Three things a checklist would show as one').font = H2
r += 1
ws.cell(row=r, column=1, value=(
    'No service interval at all · an interval nobody has ever met · an interval that has '
    'lapsed. A curing light has a monthly radiometer reading and no service contract; a fridge '
    'has a temperature log and no engineer. Reporting either as "never serviced" reads as '
    'neglect rather than as a machine that does not need servicing — so the engine holds the '
    'three apart and the screen shows them differently.')).font = INK
ws.cell(row=r, column=1).alignment = WRAP
ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=3)
ws.row_dimensions[r].height = 76

r += 2
ws.cell(row=r, column=1, value='Warning ahead, not on the day').font = H2
r += 1
ws.cell(row=r, column=1, value=(
    '"Next Service Date = Today" is the floor, not the ceiling. An AMC that expires today '
    'cannot be renewed today, and an autoclave validation booked on the morning it falls due '
    'means a day with no sterilisation. So every cycle carries a warning period as well as an '
    'interval, and the work appears that many days early. What fires ON the day is the overdue '
    'state, which is a different and louder thing.')).font = INK
ws.cell(row=r, column=1).alignment = WRAP
ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=3)
ws.row_dimensions[r].height = 76

# ═══════════════════════════════════════════════════════════ category tally
cats = Counter(a['category'] for a in ASSETS)
ws = wb['Register']
row = ws.max_row + 2
ws.cell(row=row, column=1, value='By category').font = H2
row += 1
for cat, n in sorted(cats.items()):
    ws.cell(row=row, column=1, value=cat.title().replace('_', ' ')).font = BOLD
    c = ws.cell(row=row, column=3, value=n)
    c.font, c.alignment = BOLD, CTR
    row += 1

for sheet in wb.worksheets:
    sheet.sheet_view.showGridLines = False

wb.calculation.fullCalcOnLoad = True
wb.save(OUT)
print(f'{OUT} — {len(ASSETS)} assets, {len(CYCLES)} cycles')
