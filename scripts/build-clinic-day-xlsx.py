from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.comments import Comment

F = "Arial"
INK   = Font(name=F, size=10)
BOLD  = Font(name=F, size=10, bold=True)
H1    = Font(name=F, size=16, bold=True)
H2    = Font(name=F, size=12, bold=True)
MUTED = Font(name=F, size=9, color="666666")
HEADF = Font(name=F, size=10, bold=True, color="FFFFFF")

HEAD_FILL = PatternFill("solid", fgColor="0C5F4E")   # KuBi green
YOU_FILL  = PatternFill("solid", fgColor="FFFF00")   # you fill this in
GAP_FILL  = PatternFill("solid", fgColor="F8D0CC")   # a gap
OK_FILL   = PatternFill("solid", fgColor="DCEDE6")   # covered
NOTE_FILL = PatternFill("solid", fgColor="F2F4F2")

THIN = Side(style="thin", color="D5DBD7")
BOX  = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

WRAP = Alignment(vertical="top", wrap_text=True)
TOP  = Alignment(vertical="top")
CTR  = Alignment(horizontal="center", vertical="top")

wb = Workbook()

def head(ws, row, cols):
    for i, c in enumerate(cols, start=1):
        cell = ws.cell(row=row, column=i, value=c)
        cell.font, cell.fill, cell.border = HEADF, HEAD_FILL, BOX
        cell.alignment = Alignment(vertical="center", wrap_text=True)
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

# ═══════════════════════════════════════════════════════════ 1 · Read me
ws = wb.active
ws.title = "Read me"
widths(ws, {"A": 3, "B": 34, "C": 62, "D": 14})
ws["B2"] = "KuBi — the clinic day"; ws["B2"].font = H1
ws["B3"] = "Clinic readiness (opening) and clinic closing — every block, every owner, every gap."
ws["B3"].font = MUTED
ws["B4"] = "Read out of the built system on 10 August 2026. Synthetic data only."
ws["B4"].font = MUTED

ws["B6"] = "Where to start"; ws["B6"].font = H2
ws["B7"] = "Sheet 'Gaps to fill'"
ws["C7"] = "14 open questions. Fill the YELLOW columns. Everything else is what KuBi already does."
ws["B8"] = "Sheet 'Opening controls'"
ws["C8"] = "All 12 matrix opening controls. Filter Status = GAP to see the 7 with no block."
ws["B9"] = "Sheet 'Closing controls'"
ws["C9"] = "All 16 matrix closing controls. None is a gap — kept so it can be checked, not believed."
ws["B10"] = "Sheet 'Blocks'"
ws["C10"] = "The 20 blocks the system actually runs — 9 in the morning, 11 in the evening."
ws["B11"] = "Sheet 'Roles'"
ws["C11"] = "Who owns what, morning and evening. Roles only — names never appear."
ws["B12"] = "Sheet 'Already settled'"
ws["C12"] = "Rulings you have already given, so none is reopened by accident."
for r in range(7, 13):
    ws.cell(row=r, column=2).font = BOLD
    ws.cell(row=r, column=3).font = INK
    ws.cell(row=r, column=3).alignment = WRAP

ws["B14"] = "Colour key"; ws["B14"].font = H2
key = [("YELLOW", "You fill this in. Nothing else in the workbook expects your input.", YOU_FILL),
       ("PINK", "A gap — the clinic does this work and KuBi has no block for it.", GAP_FILL),
       ("GREEN", "Covered — a block owns it, with a role that is enforced server-side.", OK_FILL)]
r = 15
for name, meaning, fill in key:
    c = ws.cell(row=r, column=2, value=name); c.font = BOLD; c.fill = fill; c.border = BOX
    d = ws.cell(row=r, column=3, value=meaning); d.font = INK; d.alignment = WRAP
    r += 1

ws["B19"] = "Progress"; ws["B19"].font = H2
prog = [("Open questions", '=COUNTA(\'Gaps to fill\'!B5:B18)'),
        ("Answered so far", '=COUNTA(\'Gaps to fill\'!H5:H18)'),
        ("Still outstanding", '=D20-D21'),
        ("Opening controls with no block", '=COUNTIF(\'Opening controls\'!E5:E16,"GAP")'),
        ("Closing controls with no block", '=COUNTIF(\'Closing controls\'!E5:E20,"GAP")')]
r = 20
for label, formula in prog:
    ws.cell(row=r, column=2, value=label).font = BOLD
    c = ws.cell(row=r, column=4, value=formula)
    c.font = BOLD; c.alignment = CTR; c.border = BOX; c.fill = NOTE_FILL
    r += 1
ws["B25"] = "The counts above update themselves as you fill the yellow columns in."
ws["B25"].font = MUTED

# ═══════════════════════════════════════════════════════════ 2 · Gaps to fill
ws = wb.create_sheet("Gaps to fill")
widths(ws, {"A": 7, "B": 13, "C": 11, "D": 20, "E": 40, "F": 44, "G": 30,
            "H": 26, "I": 34, "J": 18, "K": 30})
ws["A1"] = "The 12 open questions"; ws["A1"].font = H1
ws["A2"] = ("Everything KuBi does not yet know. Fill the three yellow columns. "
            "No owner has been invented for any row below — a guessed owner is a block "
            "reported by whoever happens to be standing there.")
ws["A2"].font = MUTED; ws.merge_cells("A2:K2"); ws["A2"].alignment = WRAP
ws.row_dimensions[2].height = 28

head(ws, 4, ["#", "Area", "Priority", "Matrix control", "The question",
             "Why it matters", "What KuBi does today",
             "YOUR RULING", "OWNER ROLE (if it needs one)", "BY WHEN", "NOTES"])

GAPS = [
 ("G-01", "Opening", "HIGH", "OPEN-001, 007, 008,\n009, 010, 011",
  "Who opens the building?",
  "Six matrix controls are one job: unlock the clinic, lights and fans, ACs at 24 °C, air diffuser, water availability, water pump. Neither document has this section — your closing drill switches all of it off in the evening, and the opening procedure begins with people already inside a working building.",
  "Nothing. There is no block, so the morning cannot report it and cannot refuse on it."),
 ("G-02", "Opening", "CRITICAL", "OPEN-012",
  "Who checks morning emergency readiness?",
  "The emergency kit, the drugs and their expiry dates, the oxygen. Patient safety. Absent from the matrix detail, from the opening procedure, and from every block.",
  "Nothing. This is the most serious gap in the workbook."),
 ("G-03", "Opening", "CRITICAL", "OPEN-012",
  "Is emergency readiness a daily look, or a dated expiry register?",
  "The answer decides the shape: a daily look is a readiness block like any other; expiry dates are a register with its own review cycle and its own escalation when something is 30 days out.",
  "Nothing."),
 ("G-04", "Document", "HIGH", "ENT-03",
  "The K. B. Dental Hand Hygiene Protocol",
  "\"Will provide later\". The staff-entry gate — 20-second handwash, all surfaces — currently has no standard behind it, so nothing can be checked against it.",
  "Staff entry is counted, not gated. Honest, but not a control."),
 ("G-05", "Conflict", "MEDIUM", "HK-001",
  "Reception floor agent — Virulex, or 1% sodium hypochlorite?",
  "The 3-bucket technique says Virulex; the reception paragraph says 1% sodium hypochlorite. Both are in your opening document.",
  "Housekeeping's block does not name an agent, so neither is enforced."),
 ("G-06", "Conflict", "HIGH", "—",
  "Eye shield — disinfect and reuse, or red bin?",
  "PPE says protective eyewear is disinfected and UV-sanitised after every use. BMW puts the eye shield in the red bin as contaminated plastic. Both can be true only if these are two different items.",
  "Neither is enforced."),
 ("G-07", "Conflict", "HIGH", "—",
  "Needles — formalin chamber, or white sharps box?",
  "The formalin chamber is listed for \"plastics, syringes, needles, scissors\"; BMW puts needles in the white sharps box, never recapped. Sterilising and discarding the same item cannot both be the rule.",
  "Neither is enforced."),
 ("G-08", "Conflict", "MEDIUM", "—",
  "Fumigation cadence — every day, or holiday / end of day?",
  "\"Once every day\" and \"on a holiday or end of the day\" are not the same schedule.",
  "Built as daily, inside the ENVIRONMENT closing block."),
 ("G-09", "Ordering", "LOW", "—",
  "Floors before surfaces, or after?",
  "Both happen in the morning and nothing says which comes first. It matters only if one re-contaminates the other.",
  "Not sequenced. The two blocks can be reported in any order."),
 ("G-10", "Ordering", "LOW", "—",
  "Equipment check before the sterilisation run, or after?",
  "The autoclave and ultrasonic cleaner are checked in §3 and used in §7. Presumably checked first, but it is not written.",
  "Not sequenced."),
 ("G-11", "Ordering", "MEDIUM", "—",
  "Where does the chemical route run?",
  "The 16 steps end in an autoclave. The chemical-route instruments presumably go to the formalin chamber, but no step sequence is given for them.",
  "Only the autoclave route is built."),
 ("G-12", "Model", "MEDIUM", "—",
  "Per-patient sterilisation has one owner and you named two.",
  "You said the technician AND the dental assistant do per-patient runs. The flow gives each step a single owning role, so it displays as the technician's even when an assistant does it. Widening it means letting a node have two owners, which changes the frozen model — so it is raised rather than done.",
  "Displayed owner is narrower than the clinic. Nothing is refused."),
 ("G-13", "Closing", "HIGH", "—",
  "Two sub-steps of the closing drill are not in KuBi's copy.",
  "The Operatory Closing Protocol runs (a) to (g). KuBi holds (a) instruments to the sterilisation room, (b) chair surfaces re-wiped, (d) and (e) light, compressor and suction off, (g) operatory floor mopped. Steps (c) and (f) were never captured. See the 'Inside each block' sheet.",
  "The block refuses correctly, but its checklist is incomplete — an assistant reading it would miss two steps."),
 ("G-14", "Closing", "MEDIUM", "CLOSE-009,\n013, 014",
  "The two blocks added last week have no sub-steps.",
  "RESTOCK (restock the rooms for tomorrow) and TOMORROW (review tomorrow's list and the lab cases due) are enforced as blocks, but nobody has written down what is actually checked inside them — which consumables, to what minimum; which lab cases count as due.",
  "Both hold the lockup. Neither tells the person what to do."),
]

r = 5
for gid, area, pri, ctrl, q, why, today in GAPS:
    put(ws, r, [gid, area, pri, ctrl, q, why, today, None, None, None, None],
        fills={"H": YOU_FILL, "I": YOU_FILL, "J": YOU_FILL, "K": YOU_FILL},
        wrap_cols=("D", "E", "F", "G", "H", "I", "K"))
    if pri == "CRITICAL":
        ws.cell(row=r, column=3).fill = GAP_FILL
        ws.cell(row=r, column=3).font = Font(name=F, size=10, bold=True, color="9D2F26")
    ws.cell(row=r, column=1).font = BOLD
    ws.row_dimensions[r].height = 62
    r += 1

ws.cell(row=r + 1, column=5,
        value="Example of a filled row — delete or overwrite. "
              "G-01: \"Housekeeping, they arrive first\" · OWNER ROLE: HOUSEKEEPING").font = MUTED
ws.cell(row=r + 1, column=5).alignment = WRAP
ws.freeze_panes = "A5"
ws.auto_filter.ref = f"A4:K{r-1}"

ws["H4"].comment = Comment(
    "Your answer in plain words. One sentence is enough — it becomes the "
    "reason line in the code.", "KuBi", width=280, height=90)
ws["I4"].comment = Comment(
    "One of: HOUSEKEEPING, RECEPTION, DENTAL_ASSISTANT, SENIOR_ASSISTANT, "
    "STERILIZATION_TECHNICIAN, CLINIC_MANAGER, TREATING_DOCTOR. "
    "Leave blank where the row is not about ownership.", "KuBi", width=300, height=110)

# ═══════════════════════════════════════════════════════════ 3 · Opening controls
ws = wb.create_sheet("Opening controls")
widths(ws, {"A": 12, "B": 34, "C": 20, "D": 26, "E": 10, "F": 58, "G": 28, "H": 30})
ws["A1"] = "Opening — the matrix's 12 controls, traced"; ws["A1"].font = H1
ws["A2"] = "Filter column E to GAP to see the seven with no block. 5 covered, 7 gaps."
ws["A2"].font = MUTED
head(ws, 4, ["Control", "What it is", "Covered by block", "Owner role",
             "Status", "Why", "YOUR RULING", "NOTES"])

OPENING = [
 ("OPEN-001", "Open the second-floor clinic", "—", "—", "GAP",
  "Opening the premises itself — no block unlocks the building or switches it on."),
 ("OPEN-002", "Reception readiness", "RECEPTION", "RECEPTION", "COVERED",
  "The waiting and billing area — 15 items in your §4."),
 ("OPEN-003", "Treatment room readiness", "OPERATORY x4", "DENTAL_ASSISTANT", "COVERED",
  "One block per room from the master — 24 disinfection actions each."),
 ("OPEN-004", "Dental chair check", "OPERATORY x4", "DENTAL_ASSISTANT", "COVERED",
  "One of the four per-room checks you named."),
 ("OPEN-005", "Suction check", "OPERATORY x4", "DENTAL_ASSISTANT", "COVERED",
  "Checked in each room even though the plant is centralised."),
 ("OPEN-006", "Compressor check", "EQUIPMENT", "SENIOR_ASSISTANT", "COVERED",
  "Central kit, so it is the senior assistant's one round — including the 5-minute warm-up."),
 ("OPEN-007", "ACs at 24 °C", "—", "—", "GAP",
  "Part of opening the building, which no block covers."),
 ("OPEN-008", "Air diffuser", "—", "—", "GAP",
  "Part of opening the building, which no block covers."),
 ("OPEN-009", "Water availability", "—", "—", "GAP",
  "Part of opening the building, which no block covers."),
 ("OPEN-010", "Water pump", "—", "—", "GAP",
  "Your ruling: starting the water pump is a task of opening, not closing. The morning has no block for it yet."),
 ("OPEN-011", "Lights and fans", "—", "—", "GAP",
  "Part of opening the building, which no block covers."),
 ("OPEN-012", "Morning emergency readiness", "—", "—", "GAP",
  "The kit, the drugs and their expiry. PATIENT SAFETY — in neither document and in no block."),
]
r = 5
for cid, what, blk, owner, status, why in OPENING:
    put(ws, r, [cid, what, blk, owner, status, why, None, None],
        fills={"E": GAP_FILL if status == "GAP" else OK_FILL, "G": YOU_FILL, "H": YOU_FILL},
        wrap_cols=("B", "F", "G", "H"))
    ws.cell(row=r, column=1).font = Font(name=F, size=10, bold=True)
    ws.cell(row=r, column=5).alignment = CTR
    ws.cell(row=r, column=5).font = Font(
        name=F, size=10, bold=True, color="9D2F26" if status == "GAP" else "0C5F4E")
    ws.row_dimensions[r].height = 34
    r += 1
ws.freeze_panes = "A5"
ws.auto_filter.ref = f"A4:H{r-1}"
ws.cell(row=r + 1, column=1, value="Covered").font = BOLD
ws.cell(row=r + 1, column=2, value='=COUNTIF(E5:E16,"COVERED")').font = BOLD
ws.cell(row=r + 2, column=1, value="Gaps").font = BOLD
ws.cell(row=r + 2, column=2, value='=COUNTIF(E5:E16,"GAP")').font = BOLD

# ═══════════════════════════════════════════════════════════ 4 · Closing controls
ws = wb.create_sheet("Closing controls")
widths(ws, {"A": 12, "B": 40, "C": 24, "D": 26, "E": 10, "F": 66, "G": 28})
ws["A1"] = "Closing — the matrix's 16 controls, traced"; ws["A1"].font = H1
ws["A2"] = ("None is a gap. Seven once read \"Assigned Staff\", which is not an owner; "
            "each is now derived from the section of your closing drill that contains the work.")
ws["A2"].font = MUTED
head(ws, 4, ["Control", "What it is", "Covered by block", "Owner role", "Status", "Why", "NOTES"])

CLOSING = [
 ("CLOSE-001", "Remaining patients cleared", "governance", "TREATING_DOCTOR", "COVERED",
  "Locking the day is refused on an unfinished visit."),
 ("CLOSE-002", "Clinical notes complete", "governance", "TREATING_DOCTOR", "COVERED",
  "Refused on an unwritten clinical note."),
 ("CLOSE-003", "Follow-ups scheduled", "governance", "RECEPTION", "COVERED",
  "The day-after call is a consequence of finishing treatment."),
 ("CLOSE-004", "Instruments collected", "OPERATORY_CLOSED x4", "DENTAL_ASSISTANT", "COVERED",
  "Operatory Closing (a) — trays cleared to the sterilisation room."),
 ("CLOSE-005", "Sterilization complete, same day", "the morning", "STERILIZATION_TECHNICIAN", "COVERED",
  "Superseded by your ruling: the morning run catches yesterday. Not reachable at these hours — see 'Already settled'."),
 ("CLOSE-006", "Sterile instruments stored", "the morning", "STERILIZATION_TECHNICIAN", "COVERED",
  "Storage happens after the morning run is released."),
 ("CLOSE-007", "Biomedical waste closed", "WASTE", "HOUSEKEEPING", "COVERED",
  "BMW Closing Protocol."),
 ("CLOSE-008", "Chairs cleaned, all rooms", "OPERATORY_CLOSED x4", "DENTAL_ASSISTANT", "COVERED",
  "Operatory Closing (b) — chair surfaces re-wiped, per room."),
 ("CLOSE-009", "Consumables replenished", "RESTOCK", "DENTAL_ASSISTANT", "COVERED",
  "ADDED on your instruction. The same hands that just cleared the trays, in the same rooms."),
 ("CLOSE-010", "Equipment shutdown", "OPERATORY_CLOSED x4", "DENTAL_ASSISTANT", "COVERED",
  "One matrix row, three jobs: light/compressor/suction are the assistant's per room; the board is Security; the chairs are Environment."),
 ("CLOSE-011", "AC, lights and fans off", "ENVIRONMENT", "HOUSEKEEPING", "COVERED",
  "Clinic Environment Closing (d)."),
 ("CLOSE-012", "Water pump", "the morning", "—", "MOVED",
  "Your ruling: not a closing task. STARTING the pump is an opening task — see OPEN-010, which is still a gap."),
 ("CLOSE-013", "Lab cases reviewed", "TOMORROW", "RECEPTION", "COVERED",
  "ADDED on your instruction, with CLOSE-014 — one sit-down, not two."),
 ("CLOSE-014", "Tomorrow's cases reviewed", "TOMORROW", "RECEPTION", "COVERED",
  "ADDED on your instruction. You cannot review tomorrow's list without noticing which case is at the lab."),
 ("CLOSE-015", "Clinic secured", "SECURITY", "RECEPTION", "COVERED",
  "Security & Lockdown Protocol, ending in the key handover."),
 ("CLOSE-016", "Day closed", "governance", "CLINIC_MANAGER", "COVERED",
  "Calculated, never ticked. Refused until the whole drill is done, with no override."),
]
r = 5
for cid, what, blk, owner, status, why in CLOSING:
    fill = OK_FILL if status == "COVERED" else PatternFill("solid", fgColor="FDF0D5")
    put(ws, r, [cid, what, blk, owner, status, why, None],
        fills={"E": fill, "G": YOU_FILL}, wrap_cols=("B", "F", "G"))
    ws.cell(row=r, column=1).font = Font(name=F, size=10, bold=True)
    ws.cell(row=r, column=5).alignment = CTR
    ws.cell(row=r, column=5).font = Font(
        name=F, size=10, bold=True, color="0C5F4E" if status == "COVERED" else "7D5610")
    ws.row_dimensions[r].height = 34
    r += 1
ws.freeze_panes = "A5"
ws.auto_filter.ref = f"A4:G{r-1}"

# ═══════════════════════════════════════════════════════════ 5 · Blocks
ws = wb.create_sheet("Blocks")
widths(ws, {"A": 10, "B": 5, "C": 24, "D": 42, "E": 26, "F": 26,
            "G": 12, "H": 14, "I": 14, "J": 30})
ws["A1"] = "The 20 blocks the system runs"; ws["A1"].font = H1
ws["A2"] = ("Morning: 50 minutes for everything but the autoclave, which is 75 to cooling and runs alongside. "
            "Evening: 30 minutes from the moment the clinic shuts. Neither figure is the sum of its blocks — "
            "more than one person is working.")
ws["A2"].font = MUTED; ws.merge_cells("A2:J2"); ws["A2"].alignment = WRAP
ws.row_dimensions[2].height = 26
head(ws, 4, ["Half", "#", "Block", "What it is", "Owner role", "Completed by event",
             "Minutes", "Holds door", "Patient safety", "NOTES"])

BLOCKS = [
 ("Morning", 1, "OPERATORY:op-1", "Prepare Operatory 1", "DENTAL_ASSISTANT", "OPERATORY_READY", "15", "YES", "YES"),
 ("Morning", 2, "OPERATORY:op-2", "Prepare Operatory 2", "DENTAL_ASSISTANT", "OPERATORY_READY", "15", "YES", "YES"),
 ("Morning", 3, "OPERATORY:op-3", "Prepare Operatory 3", "DENTAL_ASSISTANT", "OPERATORY_READY", "15", "YES", "YES"),
 ("Morning", 4, "OPERATORY:op-4", "Prepare Operatory 4", "DENTAL_ASSISTANT", "OPERATORY_READY", "15", "YES", "YES"),
 ("Morning", 5, "STERILE", "Release the morning sterilisation run", "STERILIZATION_TECHNICIAN", "BATCH_RELEASED", "75", "YES", "YES"),
 ("Morning", 6, "EQUIPMENT", "Check the equipment", "SENIOR_ASSISTANT only", "EQUIPMENT_VERIFIED", "in the 50", "YES", "YES"),
 ("Morning", 7, "COMMON_AREAS", "Clean the floors, pantry and washroom", "HOUSEKEEPING", "COMMON_AREAS_READY", "45", "YES", "YES"),
 ("Morning", 8, "RECEPTION", "Ready the waiting and billing area", "RECEPTION", "RECEPTION_READY", "in the 50", "YES", "no"),
 ("Morning", 9, "STOCK", "Check stock, as required", "DENTAL_ASSISTANT", "STOCK_VERIFIED", "as required", "advisory", "no"),
 ("Evening", 1, "OPERATORY_CLOSED:op-1", "Close down Operatory 1", "DENTAL_ASSISTANT", "OPERATORY_CLOSED", "", "YES", "YES"),
 ("Evening", 2, "OPERATORY_CLOSED:op-2", "Close down Operatory 2", "DENTAL_ASSISTANT", "OPERATORY_CLOSED", "", "YES", "YES"),
 ("Evening", 3, "OPERATORY_CLOSED:op-3", "Close down Operatory 3", "DENTAL_ASSISTANT", "OPERATORY_CLOSED", "", "YES", "YES"),
 ("Evening", 4, "OPERATORY_CLOSED:op-4", "Close down Operatory 4", "DENTAL_ASSISTANT", "OPERATORY_CLOSED", "", "YES", "YES"),
 ("Evening", 5, "RESTOCK", "Restock the rooms for tomorrow", "DENTAL_ASSISTANT", "CONSUMABLES_RESTOCKED", "", "YES", "no"),
 ("Evening", 6, "PAYMENTS", "Reconcile the day's takings", "RECEPTION", "PAYMENTS_RECONCILED", "", "YES", "no"),
 ("Evening", 7, "REPORT", "Send the daily collection report", "RECEPTION", "DAY_REPORTED", "", "YES", "no"),
 ("Evening", 8, "TOMORROW", "Review tomorrow's list and the lab cases due", "RECEPTION", "TOMORROW_REVIEWED", "", "YES", "no"),
 ("Evening", 9, "WASTE", "Close the bio-medical waste", "HOUSEKEEPING", "WASTE_CLOSED", "", "YES", "YES"),
 ("Evening", 10, "ENVIRONMENT", "Close the clinic down and fumigate", "HOUSEKEEPING", "ENVIRONMENT_CLOSED", "", "YES", "YES"),
 ("Evening", 11, "SECURITY", "Secure the premises and hand over the key", "RECEPTION", "PREMISES_SECURED", "", "YES", "no"),
]
r = 5
for half, n, bid, what, owner, ev, mins, holds, crit in BLOCKS:
    put(ws, r, [half, n, bid, what, owner, ev, mins, holds, crit, None],
        fills={"J": YOU_FILL}, wrap_cols=("D", "J"))
    ws.cell(row=r, column=1).font = Font(
        name=F, size=10, bold=True, color="0C5F4E" if half == "Morning" else "7D5610")
    for col in (7, 8, 9):
        ws.cell(row=r, column=col).alignment = CTR
    if crit == "YES":
        ws.cell(row=r, column=9).font = Font(name=F, size=10, bold=True, color="9D2F26")
    if holds == "advisory":
        ws.cell(row=r, column=8).font = Font(name=F, size=10, color="7D5610")
    r += 1
ws.freeze_panes = "A5"
ws.auto_filter.ref = f"A4:J{r-1}"
ws.cell(row=r + 1, column=3, value="Morning blocks").font = BOLD
ws.cell(row=r + 1, column=5, value='=COUNTIF(A5:A24,"Morning")').font = BOLD
ws.cell(row=r + 2, column=3, value="Evening blocks").font = BOLD
ws.cell(row=r + 2, column=5, value='=COUNTIF(A5:A24,"Evening")').font = BOLD
ws.cell(row=r + 3, column=3, value="Patient-safety blocks").font = BOLD
ws.cell(row=r + 3, column=5, value='=COUNTIF(I5:I24,"YES")').font = BOLD

# ═══════════════════════════════════════════════════════════ 6 · Roles
ws = wb.create_sheet("Roles")
widths(ws, {"A": 30, "B": 46, "C": 46, "D": 46})
ws["A1"] = "Who does what"; ws["A1"].font = H1
ws["A2"] = ("Roles, never names — names change and roles do not. The log still records which "
            "employee did what; that is provenance, not the interface.")
ws["A2"].font = MUTED; ws.merge_cells("A2:D2"); ws["A2"].alignment = WRAP
head(ws, 4, ["Role", "Morning", "Evening", "Enforced how"])

ROLES = [
 ("DENTAL_ASSISTANT", "4 operatories, 15 min each · stock, as required",
  "4 operatories · restock for tomorrow",
  "May report rooms and stock. May not report the equipment round."),
 ("SENIOR_ASSISTANT", "The equipment round — ONLY they may report it",
  "May stand in on the rooms",
  "Counts as an assistant for rooms and stock, and nowhere else."),
 ("STERILIZATION_TECHNICIAN", "The morning run — 75 min to cooling", "—",
  "May not release their own batch — separation of duties."),
 ("HOUSEKEEPING", "Floors, pantry, washroom — 45 min",
  "Bio-medical waste · clinic environment and fumigation",
  "Refused if anybody else reports the floors, in their own words."),
 ("RECEPTION", "The waiting and billing area",
  "Takings · daily report · tomorrow's list · lockdown and key",
  "Refused if anybody else reports the takings."),
 ("CLINIC_MANAGER", "—", "Locks the day",
  "Refused until the whole drill is done. No override path exists."),
 ("TREATING_DOCTOR", "—", "Clinical notes, via the gate on lockup",
  "The day cannot be locked with an unwritten note."),
]
r = 5
for role, morning, evening, how in ROLES:
    put(ws, r, [role, morning, evening, how], wrap_cols=("B", "C", "D"))
    ws.cell(row=r, column=1).font = Font(name=F, size=10, bold=True)
    ws.row_dimensions[r].height = 32
    r += 1
ws.freeze_panes = "A5"

ws.cell(row=r + 1, column=1,
        value="Found live: a dental assistant recorded housekeeping's floors and the clinic "
              "accepted it. Ownership was never compared against the recording role, for any "
              "event. Now refused server-side — a UI check is only a courtesy.").font = MUTED
ws.merge_cells(f"A{r+1}:D{r+1}")
ws.cell(row=r + 1, column=1).alignment = WRAP
ws.row_dimensions[r + 1].height = 30

# ═══════════════════════════════════════════════════════════ 7 · Already settled
ws = wb.create_sheet("Already settled")
widths(ws, {"A": 44, "B": 76})
ws["A1"] = "Rulings you have already given"; ws["A1"].font = H1
ws["A2"] = "Kept so none is reopened by accident. If any of these has changed, say so and it moves."
ws["A2"].font = MUTED
head(ws, 4, ["Question", "Your ruling"])
SETTLED = [
 ("How many operatories?", "Four, from a master. A fifth is a row in a table, not a release."),
 ("Technician or assistant on sterilisation?", "The technician owns the morning run; either does the per-patient runs."),
 ("What is checked in each operatory?", "Dental chair, x-ray, hand instruments, suction. Not the special kit — it travels on a trolley and is the equipment round instead."),
 ("Who owns each morning block?", "Rooms and stock -> Assistant or Senior. Equipment round -> Senior only. Waiting and billing -> Reception. Floors -> Housekeeping. Morning run -> Technician."),
 ("The equipment round and waiting area durations", "They happen inside the 50 minutes. No clock of their own, which is different from unknown."),
 ("Is the first appointment the readiness target?", "Yes. A day with nothing booked reports no target rather than an invented one."),
 ("Total readiness minutes", "50, excluding the sterilisation cycle."),
 ("Total closing minutes", "30, from the moment the clinic shuts."),
 ("Clinic shut time", "18:30 normally, 19:00 on exception days. Both held as data."),
 ("Refuse, or acknowledge, at lockup?", "Keep refusing. No override path, for anybody."),
 ("Same-day sterilisation?", "No. The morning run catches yesterday's instruments. The arithmetic: cycle 75 min, team leaves 30 min after shut, so the last collection that could be stored today is 17:45 — before the clinic shuts."),
 ("Fumigation", "Daily at end of day. Not the long pole — the hour the rooms stay shut is spent with nobody in the building."),
 ("Water pump", "Not a closing task. Starting it is an opening task."),
 ("Names in the interface?", "Roles only."),
 ("Patient names?", "Fine. The audit log stays as it is."),
]
r = 5
for q, a in SETTLED:
    put(ws, r, [q, a], wrap_cols=("A", "B"))
    ws.cell(row=r, column=1).font = BOLD
    ws.row_dimensions[r].height = 30
    r += 1
ws.freeze_panes = "A5"

# ═══════════════════════════════════════════════════════ 8 · Inside each block
ws = wb.create_sheet("Inside each block")
widths(ws, {"A": 10, "B": 22, "C": 22, "D": 6, "E": 56, "F": 44, "G": 30, "H": 28})
ws["A1"] = "What is actually inside each block"; ws["A1"].font = H1
ws["A2"] = ('"Prepare Operatory 1" is 24 actions, not one. This sheet is the detail under every '
            'block, taken from your own documents. Filter column C to see one block at a time. '
            'Rows marked MISSING are steps your document has and KuBi\'s copy does not.')
ws["A2"].font = MUTED; ws.merge_cells("A2:H2"); ws["A2"].alignment = WRAP
ws.row_dimensions[2].height = 30
head(ws, 4, ["Half", "Block", "Group", "#", "Step", "Measured value / detail",
             "Source", "YOUR CORRECTION"])

M, E = "Morning", "Evening"
STEPS = [
 # ── staff entry (counted, not a block) ────────────────────────────────────
 (M, "(staff entry)", "Per person", 1, "Commute in regular clothing", "", "Opening §1 ENT-01"),
 (M, "(staff entry)", "Per person", 2, "External footwear off; clinic slippers on", "at the door", "Opening §1 ENT-02"),
 (M, "(staff entry)", "Per person", 3, "Handwash, soap and water, all surfaces", "20 seconds minimum — the Hand Hygiene Protocol behind this is still owed (G-04)", "Opening §1 ENT-03"),
 (M, "(staff entry)", "Per person", 4, "Alcohol-based hand sanitizer", "after the handwash, not instead of it", "Opening §1 ENT-04"),
 (M, "(staff entry)", "Per person", 5, "Uniform + 3-layer surgical mask + head cap", "", "Opening §1 ENT-05"),
 (M, "(staff entry)", "Per person", 6, "Fresh laundered uniform", "daily, no exception", "Opening §1 ENT-06"),
 (M, "(staff entry)", "Per person", 7, "Gloves on before any cleaning task", "Housekeeping — the one role the document names", "Opening §1 ENT-07"),
 (M, "(staff entry)", "Per person", 8, "Personal belongings into the UV cabinet", "90 seconds — bags, wallets, keys, phones", "Opening §1 ENT-08"),
 # ── operatory prep — 24 ───────────────────────────────────────────────────
 (M, "OPERATORY x4", "A · Dental chair", 1, "Instrument tray", "Bacilol or equivalent throughout", "Opening §2 A"),
 (M, "OPERATORY x4", "A · Dental chair", 2, "Chair upholstery (seat)", "", "Opening §2 A"),
 (M, "OPERATORY x4", "A · Dental chair", 3, "Patient headrest", "", "Opening §2 A"),
 (M, "OPERATORY x4", "A · Dental chair", 4, "Patient armrest", "", "Opening §2 A"),
 (M, "OPERATORY x4", "A · Dental chair", 5, "Dental light handle", "", "Opening §2 A"),
 (M, "OPERATORY x4", "A · Dental chair", 6, "Spittoon tray and metal/plastic tube", "", "Opening §2 A"),
 (M, "OPERATORY x4", "A · Dental chair", 7, "Suction filter", "remove from casing, clean under running water, disinfect, clean the casing interior", "Opening §2 A"),
 (M, "OPERATORY x4", "A · Dental chair", 8, "All surfaces of the doctor's stool", "", "Opening §2 A"),
 (M, "OPERATORY x4", "A · Dental chair", 9, "External surfaces of every handpiece tube", "air-rotor, air motor, scaler, suction, three-way syringe", "Opening §2 A"),
 (M, "OPERATORY x4", "A · Dental chair", 10, "Cling-film wrap AFTER disinfection", "instrument tray, armrest, headrest, light handle, three-way syringe, suction tube — a second pass, not part of the first", "Opening §2 A"),
 (M, "OPERATORY x4", "A · Dental chair", 11, "Booster bottle filled with distilled water", "", "Opening §2 A"),
 (M, "OPERATORY x4", "B · Surfaces", 12, "Countertops", "everything into drawers — nothing left on the countertop", "Opening §2 B"),
 (M, "OPERATORY x4", "B · Surfaces", 13, "Drawers and handles", "", "Opening §2 B"),
 (M, "OPERATORY x4", "B · Surfaces", 14, "Operatory door and handles", "", "Opening §2 B"),
 (M, "OPERATORY x4", "B · Surfaces", 15, "Partition between operatories", "", "Opening §2 B"),
 (M, "OPERATORY x4", "B · Surfaces", 16, "Laptop/desktop, keyboard, mouse", "keyboard wrapped in cling film after disinfection", "Opening §2 B"),
 (M, "OPERATORY x4", "C · Equipment", 17, "Portable RVG unit, sensor and cable", "all surfaces wrapped EXCEPT the sensor", "Opening §2 C"),
 (M, "OPERATORY x4", "C · Equipment", 18, "Lead aprons and thyroid collar", "", "Opening §2 C"),
 (M, "OPERATORY x4", "C · Equipment", 19, "Intraoral camera / scanner", "no seepage into the sensor", "Opening §2 C"),
 (M, "OPERATORY x4", "C · Equipment", 20, "Instrument trolley exterior", "", "Opening §2 C"),
 (M, "OPERATORY x4", "C · Equipment", 21, "Motorised suction exterior", "", "Opening §2 C"),
 (M, "OPERATORY x4", "C · Equipment", 22, "Aerosol suction device", "used for all AGPs, operated within 23 cm of the field", "Opening §2 C"),
 (M, "OPERATORY x4", "C · Equipment", 23, "Day-to-day articles into the UV chamber", "", "Opening §2 C"),
 (M, "OPERATORY x4", "C · Equipment", 24, "Formalin chamber on the operatory slab", "4-6 tablets", "Opening §2 C"),
 # ── equipment round — 10 ──────────────────────────────────────────────────
 (M, "EQUIPMENT", "Round", 1, "Dental chair", "back, up/down and headrest all move", "Opening §5"),
 (M, "EQUIPMENT", "Round", 2, "Dental light", "bulb lights", "Opening §5"),
 (M, "EQUIPMENT", "Round", 3, "Compressor", "on, 5-minute warm-up, pressure gauge read — a real wait, not a tick", "Opening §5"),
 (M, "EQUIPMENT", "Round", 4, "Suction unit", "suction strength", "Opening §5"),
 (M, "EQUIPMENT", "Round", 5, "Ultrasonic scaler", "activates", "Opening §5"),
 (M, "EQUIPMENT", "Round", 6, "RVG / X-ray", "power and connectivity", "Opening §5"),
 (M, "EQUIPMENT", "Round", 7, "Intraoral camera", "captures an image", "Opening §5"),
 (M, "EQUIPMENT", "Round", 8, "Autoclave", "water level and heating", "Opening §5"),
 (M, "EQUIPMENT", "Round", 9, "Ultrasonic cleaner", "solution level", "Opening §5"),
 (M, "EQUIPMENT", "Round", 10, "UV cabinets", "UV activates", "Opening §5"),
 (M, "EQUIPMENT", "Round", 11, "Any fault to the Equipment Fault Register; Clinic Manager notified", "plus backup instruments confirmed for every critical procedure", "Opening §5"),
 # ── sterilisation — 16 ────────────────────────────────────────────────────
 (M, "STERILE", "PPE first", 0, "Disposable gown, face mask, household gloves; handwash, sanitizer", "then heavy-duty gloves against sharps injury", "Opening §7"),
 (M, "STERILE", "5-step protocol", 1, "Non-foaming neutral detergent", "pH 5-9. Measured detergent to measured water. NOT washing liquid", "Opening §7"),
 (M, "STERILE", "5-step protocol", 2, "Nylon brush", "NOT green pads or wire brushes", "Opening §7"),
 (M, "STERILE", "5-step protocol", 3, "First wash under running water", "", "Opening §7"),
 (M, "STERILE", "5-step protocol", 4, "Fill tub, lukewarm", "below 35 °C — warmer coagulates proteins and prevents their removal", "Opening §7"),
 (M, "STERILE", "5-step protocol", 5, "Fully immerse, wash by hand, avoid scrubbing", "reduces aerosol. Disassemble multi-part tools; final rinse warm", "Opening §7"),
 (M, "STERILE", "5-step protocol", 6, "Dry", "prevents carryover of polluted water", "Opening §7"),
 (M, "STERILE", "5-step protocol", 7, "Soak in pre-formed soapy solution", "15 minutes, then scrub-wash", "Opening §7"),
 (M, "STERILE", "5-step protocol", 8, "Wash under running water", "all remnants removed", "Opening §7"),
 (M, "STERILE", "5-step protocol", 9, "Re-check handles, tips, drills", "under magnifying glass with light, then dry", "Opening §7"),
 (M, "STERILE", "5-step protocol", 10, "Ultrasonic cleaner", "5-10 minutes · 950 ml distilled water + 50 ml Korsolex", "Opening §7"),
 (M, "STERILE", "5-step protocol", 11, "Wash with warm distilled water", "", "Opening §7"),
 (M, "STERILE", "5-step protocol", 12, "Inspect; any hand scrubbing under warm water", "reduces aerosol", "Opening §7"),
 (M, "STERILE", "5-step protocol", 13, "Dry with clean towel", "", "Opening §7"),
 (M, "STERILE", "5-step protocol", 14, "Pack in pouches, seal all open ends", "write date + initials on the back. Decontamination ends here", "Opening §7"),
 (M, "STERILE", "5-step protocol", 15, "Autoclave", "121-131 °C, to kill spores", "Opening §7"),
 (M, "STERILE", "5-step protocol", 16, "Remove with gloved hands and Chitel forceps", "store in UV cabinets and drawers", "Opening §7"),
 (M, "STERILE", "Storage standard", 17, "Dust-proof, spacious enough to rotate, not moist, nothing crushed or bent", "earliest sterilized used first", "Opening §7"),
 (M, "STERILE", "Room surfaces", 18, "Countertops; autoclave, ultrasonic cleaner, sealing machine, water distiller, needle cutter; cabinets, UV cabinets, drawers, handles; glass door and handle", "", "Opening §7"),
 # ── reception — 15 ────────────────────────────────────────────────────────
 (M, "RECEPTION", "Touchpoints", 1, "Side table with flower pot", "", "Opening §3"),
 (M, "RECEPTION", "Touchpoints", 2, "All tables and countertops", "", "Opening §3"),
 (M, "RECEPTION", "Touchpoints", 3, "Coffee machine", "", "Opening §3"),
 (M, "RECEPTION", "Touchpoints", 4, "Sofas and chairs", "", "Opening §3"),
 (M, "RECEPTION", "Touchpoints", 5, "Main entry wood and glass door + handle", "", "Opening §3"),
 (M, "RECEPTION", "Touchpoints", 6, "TV, AC, fridge and remotes", "", "Opening §3"),
 (M, "RECEPTION", "Touchpoints", 7, "Printer, card machine, landline", "", "Opening §3"),
 (M, "RECEPTION", "Touchpoints", 8, "Cabinets, drawers and handles", "", "Opening §3"),
 (M, "RECEPTION", "Touchpoints", 9, "Water available as disposable bottles on request", "", "Opening §3"),
 (M, "RECEPTION", "Preparation", 10, "Used shoe-cover bin, lidded and foot-operated; dispenser stocked", "", "Opening §3"),
 (M, "RECEPTION", "Preparation", 11, "A4 paper pre-loaded", "for the whole day", "Opening §3"),
 (M, "RECEPTION", "Preparation", 12, "New registration forms stocked in the drawer", "for the whole day", "Opening §3"),
 (M, "RECEPTION", "Preparation", 13, "Old forms scanned and filed immediately", "UV chamber available for forms", "Opening §3"),
 (M, "RECEPTION", "Preparation", 14, "DVR, fire alarm/cylinder and DVD player function-checked", "in the morning specifically, to avoid touching them during the day", "Opening §3"),
 (M, "RECEPTION", "Preparation", 15, "Personal belongings 90 s UV", "then ENT-08", "Opening §3"),
 # ── housekeeping ──────────────────────────────────────────────────────────
 (M, "COMMON_AREAS", "Floors", 1, "3-bucket technique", "detergent + warm water · plain water · Virulex. Mop with detergent, rinse and squeeze in plain, mop again with Virulex after drying", "Opening §8"),
 (M, "COMMON_AREAS", "Floors", 2, "Work from the far corner towards the door", "", "Opening §8"),
 (M, "COMMON_AREAS", "Floors", 3, "No broom sweeping", "aerosol", "Opening §8"),
 (M, "COMMON_AREAS", "Floors", 4, "Operatory floors", "once in the morning, then after every patient", "Opening §8"),
 (M, "COMMON_AREAS", "Floors", 5, "Waiting, billing, doctor's room, pantry, washroom", "minimum twice a day", "Opening §8"),
 (M, "COMMON_AREAS", "Floors", 6, "Mop care", "hot water and detergent, disinfect with Virulex, dry upside-down", "Opening §8"),
 (M, "COMMON_AREAS", "Pantry", 7, "Countertops · refrigerator · induction/LPG stove", "", "Opening §4"),
 (M, "COMMON_AREAS", "Pantry", 8, "Cleaning waste into the black bin", "lidded, foot-operated", "Opening §4"),
 (M, "COMMON_AREAS", "Washroom", 9, "Washbasin and taps · faucets and jet spray · door and handle", "", "Opening §4"),
 (M, "COMMON_AREAS", "Washroom", 10, "Refill soap dispenser and tissue", "", "Opening §4"),
 # ── stock — 12 ────────────────────────────────────────────────────────────
 (M, "STOCK", "12 lines", 1, "Gloves — exam and surgical", "at or below minimum -> Purchase Request to the Clinic Manager, immediately", "Opening §6"),
 (M, "STOCK", "12 lines", 2, "3-layer surgical and N95 masks", "", "Opening §6"),
 (M, "STOCK", "12 lines", 3, "Head caps", "", "Opening §6"),
 (M, "STOCK", "12 lines", 4, "Cling film", "", "Opening §6"),
 (M, "STOCK", "12 lines", 5, "Patient drapes and bibs", "", "Opening §6"),
 (M, "STOCK", "12 lines", 6, "Cotton, gauze, dressing packs", "", "Opening §6"),
 (M, "STOCK", "12 lines", 7, "Anaesthetic cartridges and needles", "", "Opening §6"),
 (M, "STOCK", "12 lines", 8, "Suction tips and saliva ejectors", "", "Opening §6"),
 (M, "STOCK", "12 lines", 9, "Sterilization pouches", "", "Opening §6"),
 (M, "STOCK", "12 lines", 10, "Autoclave distilled water", "", "Opening §6"),
 (M, "STOCK", "12 lines", 11, "Bacilol", "", "Opening §6"),
 (M, "STOCK", "12 lines", 12, "Hand sanitizer", "", "Opening §6"),
 # ── evening ───────────────────────────────────────────────────────────────
 (E, "OPERATORY_CLOSED x4", "Protocol (a-g)", 1, "(a) Instruments cleared to the sterilisation room", "nothing dirty left out — this is CLOSE-004", "Closing drill"),
 (E, "OPERATORY_CLOSED x4", "Protocol (a-g)", 2, "(b) Chair surfaces re-wiped", "per room — this is CLOSE-008", "Closing drill"),
 (E, "OPERATORY_CLOSED x4", "Protocol (a-g)", 3, "(c) MISSING — not in KuBi's copy", "please re-send this step (G-13)", "Closing drill"),
 (E, "OPERATORY_CLOSED x4", "Protocol (a-g)", 4, "(d) Dental light off", "part of CLOSE-010", "Closing drill"),
 (E, "OPERATORY_CLOSED x4", "Protocol (a-g)", 5, "(e) Compressor and suction off", "part of CLOSE-010", "Closing drill"),
 (E, "OPERATORY_CLOSED x4", "Protocol (a-g)", 6, "(f) MISSING — not in KuBi's copy", "please re-send this step (G-13)", "Closing drill"),
 (E, "OPERATORY_CLOSED x4", "Protocol (a-g)", 7, "(g) Operatory floor mopped", "belongs to whoever closes the room, not to housekeeping", "Closing drill"),
 (E, "RESTOCK", "Added block", 1, "NO SUB-STEPS YET", "which consumables, to what minimum? (G-14)", "added on your instruction"),
 (E, "PAYMENTS", "Protocol (a-f)", 1, "Cash, card and TPA payments reconciled", "with a Discrepancy Log and a petty-cash balance behind it", "Closing drill"),
 (E, "PAYMENTS", "Protocol (a-f)", 2, "Six sub-steps (a-f); KuBi holds the summary only", "re-send if the detail should be enforced", "Closing drill"),
 (E, "REPORT", "Protocol (a-b)", 1, "Daily collection report sent to the manager", "", "Closing drill"),
 (E, "TOMORROW", "Added block", 1, "NO SUB-STEPS YET", "which lab cases count as due; what counts as a special requirement? (G-14)", "added on your instruction"),
 (E, "WASTE", "Protocol (a-e)", 1, "Bins closed and the logbook written", "all bins puncture-proof, lidded, foot-operated, bio-hazard symbol, non-chlorinated bags", "Closing drill · Opening §9"),
 (E, "WASTE", "Protocol (a-e)", 2, "Five sub-steps (a-e); KuBi holds the summary only", "re-send if the detail should be enforced", "Closing drill"),
 (E, "ENVIRONMENT", "Protocol (a-g)", 1, "(a) Chairs raised and electricity off", "part of CLOSE-010", "Closing drill"),
 (E, "ENVIRONMENT", "Protocol (a-g)", 2, "(d) Windows, fans and ACs off", "this is CLOSE-011", "Closing drill"),
 (E, "ENVIRONMENT", "Protocol (a-g)", 3, "Waiting area, pantry and washroom", "", "Closing drill"),
 (E, "ENVIRONMENT", "Protocol (a-g)", 4, "Fumigation", "Germishield (Virex II), 50 ml in 950 ml water, covers 2-3 surgeries. Room closed 1 hour+ afterwards", "Opening §8"),
 (E, "ENVIRONMENT", "Protocol (a-g)", 5, "Sub-steps (b), (c), (e), (f), (g); KuBi holds the summary only", "re-send if the detail should be enforced", "Closing drill"),
 (E, "SECURITY", "Protocol (a-h)", 1, "(c) The board and non-critical points off", "part of CLOSE-010", "Closing drill"),
 (E, "SECURITY", "Protocol (a-h)", 2, "Clinic locked and the key handed over", "the last act of the day", "Closing drill"),
 (E, "SECURITY", "Protocol (a-h)", 3, "Sub-steps (a), (b), (d)-(h); KuBi holds the summary only", "re-send if the detail should be enforced", "Closing drill"),
]

r = 5
for half, blk, grp, n, step, detail, source in STEPS:
    missing = "MISSING" in step or "NO SUB-STEPS" in step or "summary only" in step
    put(ws, r, [half, blk, grp, n if n else None, step, detail, source, None],
        fills={"H": YOU_FILL, **({"E": GAP_FILL, "F": GAP_FILL} if missing else {})},
        wrap_cols=("E", "F", "G", "H"))
    ws.cell(row=r, column=1).font = Font(
        name=F, size=10, bold=True, color="0C5F4E" if half == M else "7D5610")
    ws.cell(row=r, column=2).font = Font(name=F, size=10, bold=True)
    ws.cell(row=r, column=4).alignment = CTR
    ws.cell(row=r, column=7).font = MUTED
    if missing:
        ws.cell(row=r, column=5).font = Font(name=F, size=10, bold=True, color="9D2F26")
    r += 1
ws.freeze_panes = "A5"
ws.auto_filter.ref = f"A4:H{r-1}"

last = r - 1
tot = r + 1
ws.cell(row=tot, column=2, value="Steps in the morning").font = BOLD
ws.cell(row=tot, column=4, value=f'=COUNTIF(A5:A{last},"Morning")').font = BOLD
ws.cell(row=tot + 1, column=2, value="Steps in the evening").font = BOLD
ws.cell(row=tot + 1, column=4, value=f'=COUNTIF(A5:A{last},"Evening")').font = BOLD
ws.cell(row=tot + 2, column=2, value="Per operatory, every morning").font = BOLD
ws.cell(row=tot + 2, column=4, value=f'=COUNTIF(B5:B{last},"OPERATORY x4")').font = BOLD
ws.cell(row=tot + 3, column=2, value="…times four rooms").font = BOLD
ws.cell(row=tot + 3, column=4, value=f'=D{tot+2}*4').font = BOLD
ws.cell(row=tot + 4, column=2,
        value="That is what 15 minutes a room buys, and why the morning is 50 minutes with "
              "more than one person in it.").font = MUTED

for sheet in wb.worksheets:
    sheet.sheet_view.showGridLines = False

# Excel, Sheets and Numbers all recalculate on open when this is set, which is
# what makes the counters live as the yellow columns are filled in.
wb.calculation.fullCalcOnLoad = True

wb.save("/home/user/kubi/docs/clinic/kubi-clinic-day.xlsx")
print("written")
