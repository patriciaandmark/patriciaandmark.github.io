/**** CONFIG ****/
const SPREADSHEET_ID = '1dHKdsnTTpVUuyx9EJoGNiEgZs9cBU-7gneRI8xgFELg';
const SHEET_ROSTER = 'Roster';
const SHEET_RESPONSES = 'Responses';

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

function _getHeaderMap(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] || [];
  return Object.fromEntries(headers.map((h, i) => [String(h).trim(), i + 1]));
}

function _nowISO() {
  return new Date();
}

function _parseMembers(cell) {
  if (!cell) return [];
  return String(cell)
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function _normalize(value) {
  return String(value || '').trim();
}

function _normalizeForMatch(value) {
  const trimmed = _normalize(value);
  return CASE_INSENSITIVE ? trimmed.toLowerCase() : trimmed;
}

function _toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function _readRoster() {
  const sh = _getSheet(SHEET_ROSTER);
  const values = sh.getDataRange().getValues();
  if (!values.length) return [];

  const headers = values.shift().map((h) => String(h).trim());
  const index = Object.fromEntries(headers.map((h, i) => [h, i]));

  return values.map((row, rowIdx) => ({
    rowIndex: rowIdx + 2,
    FamilyID: row[index['FamilyID']],
    LeadName: row[index['LeadName']],
    LeadEmail: row[index['LeadEmail']],
    Members: _parseMembers(row[index['Members']]),
    UniqueCode: index.hasOwnProperty('UniqueCode') ? row[index['UniqueCode']] : '',
    Submitted: String(row[index['Submitted']] || '').toUpperCase() === 'TRUE',
    SubmittedAt: row[index['SubmittedAt']] || ''
  }));
}

function _findRosterByCode(roster, code) {
  const target = _normalizeForMatch(code);
  return roster.find((entry) => _normalizeForMatch(entry.UniqueCode) === target);
}

function _appendResponses(familyID, leadName, notes, statuses) {
  const sh = _getSheet(SHEET_RESPONSES);
  if (sh.getLastRow() === 0) {
    sh.appendRow(['Timestamp', 'FamilyID', 'PersonName', 'Attending', 'SubmittedBy', 'Notes']);
  }

  const ts = _nowISO();
  const rows = statuses.map((s) => [
    ts,
    familyID,
    s.name,
    s.attending ? 'Yes' : 'No',
    leadName,
    notes || ''
  ]);

  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function _writeSubmissionStatus(rowIndex, submittedAt) {
  const sh = _getSheet(SHEET_ROSTER);
  const headerMap = _getHeaderMap(sh);
  const submittedCol = headerMap['Submitted'];
  const submittedAtCol = headerMap['SubmittedAt'];

  if (submittedCol) {
    sh.getRange(rowIndex, submittedCol).setValue(true);
  }
  if (submittedAtCol) {
    sh.getRange(rowIndex, submittedAtCol).setValue(submittedAt || _nowISO());
  }
}

function _readLatestSubmission(familyID) {
  const sh = _getSheet(SHEET_RESPONSES);
  if (sh.getLastRow() < 2) {
    return { statuses: [], notes: '', submittedAt: null };
  }

  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  const byFamily = rows.filter((row) => String(row[1]) === String(familyID));
  if (!byFamily.length) {
    return { statuses: [], notes: '', submittedAt: null };
  }

  const grouped = new Map();
  byFamily.forEach((row) => {
    const rawTs = row[0];
    const tsDate = _toDate(rawTs);
    if (!tsDate) return;
    const key = tsDate.getTime();
    if (!grouped.has(key)) {
      grouped.set(key, { notes: row[5] || '', statuses: [] });
    }
    const bucket = grouped.get(key);
    if (row[5]) {
      bucket.notes = row[5];
    }
    bucket.statuses.push({
      name: row[2],
      attending: String(row[3]).toLowerCase() === 'yes'
    });
  });

  if (!grouped.size) {
    return { statuses: [], notes: '', submittedAt: null };
  }

  const latestKey = Math.max(...grouped.keys());
  const latest = grouped.get(latestKey) || { statuses: [], notes: '' };
  return {
    statuses: latest.statuses,
    notes: latest.notes || '',
    submittedAt: new Date(latestKey)
  };
}

/**** API ****/
function doGet(e) {
  try {
    const action = _normalize(e.parameter.action);

    if (action === 'getFamilyByCode') {
      const code = _normalize(e.parameter.code);
      if (!code) return _json({ ok: false, error: 'Missing "code" parameter.' });

      const roster = _readRoster();
      const match = _findRosterByCode(roster, code);
      if (!match) {
        return _json({ ok: false, error: 'Invalid family code. Please double-check and try again.' });
      }

      const latest = _readLatestSubmission(match.FamilyID);
      const submittedAt = latest.submittedAt || _toDate(match.SubmittedAt);

      return _json({
        ok: true,
        data: {
          familyId: match.FamilyID,
          leadName: match.LeadName,
          members: match.Members,
          submitted: Boolean(match.Submitted),
          submittedAt: submittedAt ? submittedAt.toISOString() : null,
          notes: latest.notes || '',
          statuses: latest.statuses || []
        }
      });
    }

    if (action === 'getFamily') {
      const lead = _normalize(e.parameter.lead);
      if (!lead) return _json({ ok: false, error: 'Missing "lead" parameter.' });

      const roster = _readRoster();
      const match = roster.find((entry) => _normalizeForMatch(entry.LeadName) === _normalizeForMatch(lead));
      if (!match) {
        return _json({ ok: false, error: 'Lead not found. Please check the spelling or contact the couple.' });
      }

      return _json({
        ok: true,
        data: {
          familyId: match.FamilyID,
          leadName: match.LeadName,
          members: match.Members,
          submitted: Boolean(match.Submitted),
          submittedAt: match.SubmittedAt ? _toDate(match.SubmittedAt).toISOString() : null
        }
      });
    }

    return _json({ ok: true, status: 'RSVP API is live.' });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.tryLock(30000);

    const body = JSON.parse(e.postData.contents || '{}');
    const { familyId, code, notes, statuses } = body;

    if (!familyId || !code || !Array.isArray(statuses) || statuses.length === 0) {
      return _json({ ok: false, error: 'Missing required fields (familyId, code, statuses).' });
    }

    const roster = _readRoster();
    const match = roster.find((entry) => String(entry.FamilyID) === String(familyId));
    if (!match) {
      return _json({ ok: false, error: 'Family not found.' });
    }

    if (_normalizeForMatch(match.UniqueCode) !== _normalizeForMatch(code)) {
      return _json({ ok: false, error: 'The family code does not match our records.' });
    }

    const allowed = new Set(match.Members.map((name) => _normalizeForMatch(name)));
    for (let i = 0; i < statuses.length; i += 1) {
      const entry = statuses[i];
      if (!entry || !_normalize(entry.name)) {
        return _json({ ok: false, error: 'All members must include a name.' });
      }
      if (!allowed.has(_normalizeForMatch(entry.name))) {
        return _json({ ok: false, error: `Unknown member "${entry.name}" for this family.` });
      }
    }

    _appendResponses(match.FamilyID, match.LeadName, notes, statuses);
    const submittedAt = _nowISO();
    _writeSubmissionStatus(match.rowIndex, submittedAt);

    return _json({ ok: true, message: 'RSVP saved.', submittedAt: submittedAt.toISOString() });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  } finally {
    try {
      lock.releaseLock();
    } catch (error) {
      // ignore release errors
    }
  }
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}