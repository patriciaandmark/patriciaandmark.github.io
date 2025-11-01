/**** CONFIG ****/
const SPREADSHEET_ID = '1dHKdsnTTpVUuyx9EJoGNiEgZs9cBU-7gneRI8xgFELg';
const SHEET_ROSTER = 'Roster';
const SHEET_RESPONSES = 'Responses';

// Toggle to be permissive on name matching (case-insensitive, trims spaces)
const CASE_INSENSITIVE = true;

/**** HELPERS ****/
function _open() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function _getSheet(name) {
  const ss = _open();
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error(`Missing sheet "${name}"`);
  return sh;
}

function _nowISO() {
  return new Date();
}

function _parseMembers(cell) {
  if (!cell) return [];
  // members separated by semicolons or newlines
  return String(cell)
    .split(/[;\n]/)
    .map(s => s.trim())
    .filter(Boolean);
}

function _readRoster() {
  const sh = _getSheet(SHEET_ROSTER);
  const values = sh.getDataRange().getValues();
  const headers = values.shift();
  const idx = Object.fromEntries(headers.map((h, i) => [String(h).trim(), i]));

  return values.map(row => ({
    rowIndex: values.indexOf(row) + 2, // add header row offset
    FamilyID: row[idx['FamilyID']],
    LeadName: row[idx['LeadName']],
    LeadEmail: row[idx['LeadEmail']],
    Members: _parseMembers(row[idx['Members']]),
    Submitted: String(row[idx['Submitted']] || '').toString().toUpperCase() === 'TRUE',
    SubmittedAt: row[idx['SubmittedAt']] || ''
  }));
}

function _writeSubmitLock(rowIndex) {
  const sh = _getSheet(SHEET_ROSTER);
  // Columns: Submitted (E), SubmittedAt (F) in template
  sh.getRange(rowIndex, 5).setValue(true);
  sh.getRange(rowIndex, 6).setValue(_nowISO());
}

function _appendResponses(familyID, leadName, notes, statuses) {
  const sh = _getSheet(SHEET_RESPONSES);
  // Ensure headers exist
  if (sh.getLastRow() === 0) {
    sh.appendRow(['Timestamp', 'FamilyID', 'PersonName', 'Attending', 'SubmittedBy', 'Notes']);
  }
  const ts = _nowISO();
  const rows = statuses.map(s => [ts, familyID, s.name, s.attending ? 'Yes' : 'No', leadName, notes || '']);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/**** API ****/
// GET  /?action=getFamily&lead=Mariel%20Jabillo
function doGet(e) {
  try {
    const action = (e.parameter.action || '').trim();

    if (action === 'getFamily') {
      const lead = (e.parameter.lead || '').trim();
      if (!lead) return _json({ ok: false, error: 'Missing "lead" parameter.' });

      const roster = _readRoster();
      const match = roster.find(r => {
        if (CASE_INSENSITIVE) {
          return String(r.LeadName || '').toLowerCase() === lead.toLowerCase();
        }
        return String(r.LeadName || '') === lead;
      });

      if (!match) {
        return _json({ ok: false, error: 'Lead not found. Please check the spelling or contact the couple.' });
      }

      return _json({
        ok: true,
        data: {
          familyId: match.FamilyID,
          leadName: match.LeadName,
          members: match.Members,
          submitted: match.Submitted,
          submittedAt: match.SubmittedAt ? new Date(match.SubmittedAt).toISOString() : null
        }
      });
    }

    // default route / health
    return _json({ ok: true, status: 'RSVP API is live.' });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

// POST JSON to submit family response
// Body:
// {
//   "familyId": "FAM-001",
//   "leadName": "Mariel Jabillo",
//   "notes": "Vegetarian meal for Chloe",
//   "statuses": [{"name":"Mariel Jabillo","attending":true}, ...]
// }
function doPost(e) {
  try {
    const lock = LockService.getScriptLock();
    lock.tryLock(30000); // 30s

    const body = JSON.parse(e.postData.contents || '{}');
    const { familyId, leadName, notes, statuses } = body;

    if (!familyId || !leadName || !Array.isArray(statuses) || statuses.length === 0) {
      return _json({ ok: false, error: 'Missing required fields (familyId, leadName, statuses).' });
    }

    // Validate family & lock status
    const roster = _readRoster();
    const match = roster.find(r => {
      const leadOk = CASE_INSENSITIVE
        ? String(r.LeadName || '').toLowerCase() === String(leadName || '').toLowerCase()
        : String(r.LeadName || '') === String(leadName || '');
      return leadOk && String(r.FamilyID) === String(familyId);
    });

    if (!match) {
      return _json({ ok: false, error: 'Family not found or lead mismatch.' });
    }

    if (match.Submitted) {
      return _json({
        ok: false,
        locked: true,
        message: 'This family’s RSVP has already been submitted. Please contact the couple for changes.'
      });
    }

    // Validate members (names must be within the roster’s Members list)
    const allowed = new Set(match.Members.map(m => CASE_INSENSITIVE ? m.toLowerCase() : m));
    for (const s of statuses) {
      const key = CASE_INSENSITIVE ? String(s.name).toLowerCase() : String(s.name);
      if (!allowed.has(key)) {
        return _json({ ok: false, error: `Unknown member "${s.name}" for this family.` });
      }
    }

    // Write responses (one row per person)
    _appendResponses(match.FamilyID, match.LeadName, notes, statuses);

    // Lock the family in Roster
    _writeSubmitLock(match.rowIndex);

    return _json({ ok: true, message: 'RSVP submitted. Thank you!' });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  } finally {
    try {
      LockService.getScriptLock().releaseLock();
    } catch (_) {}
  }
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
