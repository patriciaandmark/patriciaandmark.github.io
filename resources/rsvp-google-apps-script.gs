/**
 * Google Apps Script that powers the Patricia & Mark RSVP workflow.
 *
 * The site submits RSVPs with fields Name, Email, Attendance, FamilyID,
 * LeadName, and AttendingNames. The script stores the raw submission in a
 * "FormResponses" tab and updates the authoritative guest list that lives in
 * the "GuestList" tab. A GET request with ?action=guestList returns the
 * current guest list as JSON for the static site.
 */
const SHEET_ID = '1keeUUKuJ4uabjNtHy2bYq2nKt6_ZR3VPX6Dp57Lj9cw';
const GUEST_LIST_TAB = 'GuestList';
const RESPONSES_TAB = 'FormResponses';

const RESPONSE_HEADERS = [
  'Timestamp',
  'FamilyID',
  'LeadName',
  'SubmittedBy',
  'Email',
  'Attendance',
  'Status',
  'AttendingNames',
  'RawPayload',
];

function doGet(e) {
  try {
    const action = ((e && e.parameter && e.parameter.action) || '').toString().toLowerCase();
    if (!action || action === 'guestlist' || action === 'guest-list') {
      const ss = SpreadsheetApp.openById(SHEET_ID);
      const guestSheet = getRequiredSheet(ss, GUEST_LIST_TAB);
      const rows = getGuestListRows(guestSheet);
      return jsonResponse({ status: 'ok', rows: rows });
    }
    return jsonResponse({ status: 'error', message: 'Unsupported action.' });
  } catch (error) {
    Logger.log('[RSVP] Error handling GET request: %s', error);
    return jsonResponse({ status: 'error', message: error.message || String(error) });
  }
}

function doPost(e) {
  try {
    const payload = parsePayload(e);
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const guestSheet = getRequiredSheet(ss, GUEST_LIST_TAB);
    const responseSheet = getRequiredSheet(ss, RESPONSES_TAB);

    ensureHeaders(responseSheet, RESPONSE_HEADERS);
    appendResponseRow(responseSheet, payload);
    updateGuestListRows(guestSheet, payload);

    return jsonResponse({ status: 'ok' });
  } catch (error) {
    Logger.log('[RSVP] Error handling submission: %s', error);
    return jsonResponse({ status: 'error', message: error.message || String(error) });
  }
}

function doOptions() {
  return jsonResponse({ status: 'ok' });
}

function parsePayload(e) {
  if (!e || !e.parameter) {
    throw new Error('No form data was received.');
  }

  const data = e.parameter;
  const familyId = (data.FamilyID || '').trim();
  if (!familyId) {
    throw new Error('Missing required FamilyID field.');
  }

  const timestamp = new Date();
  const attendingNames = (data.AttendingNames || '')
    .split(',')
    .map(function (name) {
      return name.trim();
    })
    .filter(Boolean);

  const payload = {
    familyId: familyId,
    submittedBy: (data.Name || '').trim(),
    leadName: (data.LeadName || '').trim(),
    email: (data.Email || '').trim(),
    attendance: (data.Attendance || '').trim(),
    attendingNames: attendingNames,
    attendingCount: attendingNames.length,
    timestamp: timestamp,
    raw: data,
  };

  payload.status = deriveStatus(payload);
  return payload;
}

function deriveStatus(payload) {
  const attendance = (payload.attendance || '').toLowerCase();
  if (!attendance) {
    return 'Pending';
  }
  if (attendance === 'not attending') {
    return 'Declined';
  }
  if (payload.attendingCount > 0) {
    return 'Confirmed';
  }
  return 'Pending';
}

function getRequiredSheet(spreadsheet, name) {
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    throw new Error('The sheet "' + name + '" could not be found.');
  }
  return sheet;
}

function ensureHeaders(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    return;
  }

  const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var needsUpdate = false;
  for (var i = 0; i < headers.length; i++) {
    if ((currentHeaders[i] || '').toString().trim() !== headers[i]) {
      needsUpdate = true;
      break;
    }
  }

  if (needsUpdate) {
    sheet.insertRowBefore(1);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

function appendResponseRow(sheet, payload) {
  const timestamp = formatDateTime(payload.timestamp);
  sheet.appendRow([
    timestamp,
    payload.familyId,
    payload.leadName || payload.submittedBy,
    payload.submittedBy || payload.leadName,
    payload.email,
    payload.attendance,
    payload.status,
    payload.attendingNames.join(', '),
    JSON.stringify(payload.raw),
  ]);
}

function updateGuestListRows(sheet, payload) {
  const range = sheet.getDataRange();
  const values = range.getValues();
  if (values.length <= 1) {
    throw new Error('The guest list sheet must contain a header row and at least one guest.');
  }

  const headers = values[0];
  const columnIndex = mapHeaders(headers);
  const familyIdColumn = columnIndex.FamilyID;
  if (familyIdColumn == null) {
    throw new Error('The guest list sheet is missing a FamilyID column.');
  }

  const matchingRows = [];
  for (var row = 1; row < values.length; row++) {
    var rowFamilyId = (values[row][familyIdColumn] || '').toString().trim();
    if (rowFamilyId === payload.familyId) {
      matchingRows.push(row);
    }
  }

  if (matchingRows.length === 0) {
    throw new Error('No rows were found for FamilyID "' + payload.familyId + '".');
  }

  var leadName = payload.leadName;
  if (!leadName && columnIndex.Role != null && columnIndex.MemberName != null) {
    for (var i = 0; i < matchingRows.length; i++) {
      var rowIndex = matchingRows[i];
      var role = (values[rowIndex][columnIndex.Role] || '').toString().toLowerCase();
      if (role === 'lead') {
        leadName = (values[rowIndex][columnIndex.MemberName] || '').toString().trim();
        break;
      }
    }
  }
  if (!leadName) {
    leadName = payload.submittedBy;
  }

  const formattedTimestamp = formatDateTime(payload.timestamp);
  const attendingCount = payload.status === 'Declined' ? 0 : payload.attendingCount;
  const attendanceNote = payload.status === 'Declined'
    ? 'Not attending'
    : payload.attendingNames.join(', ');

  for (var j = 0; j < matchingRows.length; j++) {
    var index = matchingRows[j];

    if (columnIndex.GuestsAttending != null) {
      values[index][columnIndex.GuestsAttending] = attendingCount;
    }
    if (columnIndex.RSVPStatus != null) {
      values[index][columnIndex.RSVPStatus] = payload.status;
    }
    if (columnIndex.LastUpdated != null) {
      values[index][columnIndex.LastUpdated] = formattedTimestamp;
    }
    if (columnIndex.Notes != null && attendanceNote) {
      values[index][columnIndex.Notes] = attendanceNote;
    }
    if (columnIndex.ContactEmail != null && payload.email) {
      values[index][columnIndex.ContactEmail] = payload.email;
    }
    if (columnIndex.LeadName != null && leadName) {
      values[index][columnIndex.LeadName] = leadName;
    }
  }

  range.setValues(values);
}

function getGuestListRows(sheet) {
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length <= 1) {
    return [];
  }

  const headers = values[0].map(function (header) {
    return (header || '').toString().trim();
  });

  const rows = [];
  for (var row = 1; row < values.length; row++) {
    var rowValues = values[row];
    var record = {};
    var isEmpty = true;
    for (var col = 0; col < headers.length; col++) {
      var key = headers[col];
      if (!key) {
        continue;
      }
      var cell = rowValues[col];
      if (cell !== '' && cell != null) {
        isEmpty = false;
      }
      record[key] = cell;
    }
    if (!isEmpty) {
      rows.push(record);
    }
  }

  return rows;
}

function mapHeaders(headers) {
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var key = (headers[i] || '').toString().trim();
    if (key) {
      map[key] = i;
    }
  }
  return map;
}

function formatDateTime(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeader('Access-Control-Allow-Origin', '*')
    .setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type')
    .setHeader('Cache-Control', 'no-cache, no-store, max-age=0, must-revalidate');
}
