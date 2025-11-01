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

function _normalizeHeader(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function _getHeaderMap(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] || [];
  return headers.reduce((map, header, idx) => {
    const normalized = _normalizeHeader(header);
    if (normalized && !map.hasOwnProperty(normalized)) {
      map[normalized] = idx + 1;
    }
    return map;
  }, {});
}

function _resolveColumn(headerMap, ...candidates) {
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (!candidate) continue;
    const normalized = _normalizeHeader(candidate);
    if (normalized && headerMap.hasOwnProperty(normalized)) {
      return headerMap[normalized];
    }
  }
  return null;
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

  const headerMap = _getHeaderMap(sh);

  const familyIdCol = _resolveColumn(headerMap, 'FamilyID', 'Family Id', 'Family');
  const leadNameCol = _resolveColumn(headerMap, 'LeadName', 'Lead Name', 'Primary Contact');
  const leadEmailCol = _resolveColumn(headerMap, 'LeadEmail', 'Lead Email');
  const membersCol = _resolveColumn(headerMap, 'Members', 'Guest Names', 'Guests');
  const uniqueCodeCol = _resolveColumn(headerMap, 'UniqueCode', 'FamilyCode', 'Code', 'Access Code');
  const submittedCol = _resolveColumn(headerMap, 'Submitted', 'RSVPSubmitted', 'Responded');
  const submittedAtCol = _resolveColumn(headerMap, 'SubmittedAt', 'Submitted At', 'LastUpdated', 'UpdatedAt');

  if (!familyIdCol || !leadNameCol || !membersCol || !uniqueCodeCol) {
    throw new Error('Missing required columns in roster sheet.');
  }

  const dataRows = values.slice(1);

  return dataRows.map((row, rowIdx) => ({
    rowIndex: rowIdx + 2,
    FamilyID: row[familyIdCol - 1],
    LeadName: row[leadNameCol - 1],
    LeadEmail: leadEmailCol ? row[leadEmailCol - 1] : '',
    Members: _parseMembers(row[membersCol - 1]),
    UniqueCode: uniqueCodeCol ? row[uniqueCodeCol - 1] : '',
    Submitted: submittedCol ? String(row[submittedCol - 1] || '').toUpperCase() === 'TRUE' : false,
    SubmittedAt: submittedAtCol ? row[submittedAtCol - 1] || '' : ''
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
  const submittedCol = _resolveColumn(headerMap, 'Submitted', 'RSVPSubmitted', 'Responded');
  const submittedAtCol = _resolveColumn(headerMap, 'SubmittedAt', 'Submitted At', 'LastUpdated', 'UpdatedAt');

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

  const headerMap = _getHeaderMap(sh);
  const timestampCol = _resolveColumn(headerMap, 'Timestamp', 'SubmittedAt');
  const familyIdCol = _resolveColumn(headerMap, 'FamilyID', 'Family Id', 'Family');
  const personNameCol = _resolveColumn(headerMap, 'PersonName', 'Name', 'Guest');
  const attendingCol = _resolveColumn(headerMap, 'Attending', 'Response', 'RSVP');
  const notesCol = _resolveColumn(headerMap, 'Notes', 'Comments', 'Message');

  const width = sh.getLastColumn();
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues();
  const byFamily = familyIdCol
    ? rows.filter((row) => String(row[familyIdCol - 1]) === String(familyID))
    : [];
  if (!byFamily.length) {
    return { statuses: [], notes: '', submittedAt: null };
  }

  const grouped = new Map();
  byFamily.forEach((row) => {
    const rawTs = timestampCol ? row[timestampCol - 1] : null;
    const tsDate = _toDate(rawTs);
    if (!tsDate) return;
    const key = tsDate.getTime();
    if (!grouped.has(key)) {
      grouped.set(key, { notes: notesCol ? row[notesCol - 1] || '' : '', statuses: [] });
    }
    const bucket = grouped.get(key);
    if (notesCol && row[notesCol - 1]) {
      bucket.notes = row[notesCol - 1];
    }
    const personName = personNameCol ? row[personNameCol - 1] : '';
    if (!personName) return;
    const attendingValue = attendingCol ? row[attendingCol - 1] : '';
    bucket.statuses.push({
      name: personName,
      attending: String(attendingValue).toLowerCase() === 'yes'
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