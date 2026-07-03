const OVERRIDES_SHEET_NAME = 'Tier Overrides';
const TIER_SHEET_NAMES = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'BLACK TIER'];
const HEADERS = [
  'Key',
  'Merchant ID',
  'Merchant Name',
  'Source Tier',
  'Target Tier',
  'Moved At',
  'Updated At',
  'Updated By',
  'Active',
  'Physical Status',
  'Physical At',
  'Physical Message',
  'Source Headers JSON',
  'Source Row JSON'
];

const HEADER_ALIASES = {
  agency: ['network', 'networkagency'],
  network: ['agency', 'networkagency'],
  backendepc: ['epc'],
  ordercount: ['orders', 'order'],
  revenue: ['salesamount', 'junesales', 'june revenue', 'may revenue'],
  tierreason: ['reason', 'blackreason'],
  country: ['marketplace', 'region'],
  asins: ['asin', 'topasins'],
  asin: ['asins', 'topasin']
};

function configuredSecret_() {
  return String(PropertiesService.getScriptProperties().getProperty('TIER_MOVES_WEBHOOK_SECRET') || '').trim();
}

function assertSecret_(payload) {
  const expected = configuredSecret_();
  if (!expected) return;
  const actual = String((payload && payload.secret) || '').trim();
  if (actual !== expected) {
    throw new Error('Invalid tier move secret');
  }
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function spreadsheet_() {
  const spreadsheetId = String(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '').trim();
  return spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function overridesSheet_() {
  const spreadsheet = spreadsheet_();
  let sheet = spreadsheet.getSheetByName(OVERRIDES_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(OVERRIDES_SHEET_NAME);
  const current = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (current.join('\t') !== HEADERS.join('\t')) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
  return sheet;
}

function normalizeId_(value) {
  return String(value || '').trim().replace(/\.0$/, '');
}

function normalizeText_(value) {
  return String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}

function normalizeHeader_(value) {
  return normalizeText_(value);
}

function canonicalTier_(value) {
  const text = String(value || '').trim();
  const lowered = text.toLowerCase();
  if (lowered === 'black' || lowered === 'black tier') return 'BLACK TIER';
  const match = lowered.match(/tier\s*([1-4])/);
  return match ? `Tier ${match[1]}` : text;
}

function isTierName_(tierName) {
  return TIER_SHEET_NAMES.indexOf(canonicalTier_(tierName)) !== -1;
}

function moveIdentity_(move) {
  const key = String(move && move.key || '').trim();
  if (key) return key;
  return [
    normalizeId_(move && (move.merchantId || move.merchant_id)),
    canonicalTier_(move && (move.sourceTier || move.source_tier)),
    canonicalTier_(move && (move.targetTier || move.target_tier))
  ].join('|');
}

function cleanMove_(record) {
  if (!record || typeof record !== 'object') return null;
  const sourceTier = canonicalTier_(record.sourceTier || record.source_tier);
  const targetTier = canonicalTier_(record.targetTier || record.target_tier);
  const merchantId = normalizeId_(record.merchantId || record.merchant_id);
  const key = String(record.key || record.rowKey || record.row_key || '').trim();
  if (!isTierName_(sourceTier) || !isTierName_(targetTier)) return null;
  if (sourceTier === targetTier) return null;
  if (!merchantId && !key) return null;
  return {
    key,
    merchantId,
    merchantName: String(record.merchantName || record.merchant_name || '').trim(),
    sourceTier,
    targetTier,
    movedAt: String(record.movedAt || record.moved_at || new Date().toISOString()).trim(),
    physicalStatus: String(record.physicalStatus || record.physical_status || '').trim(),
    physicalAt: String(record.physicalAt || record.physical_at || '').trim(),
    physicalMessage: String(record.physicalMessage || record.physical_message || '').trim(),
    sourceHeadersJson: String(record.sourceHeadersJson || record.source_headers_json || '').trim(),
    sourceRowJson: String(record.sourceRowJson || record.source_row_json || '').trim()
  };
}

function rowToMove_(row) {
  return cleanMove_({
    key: row[0],
    merchantId: row[1],
    merchantName: row[2],
    sourceTier: row[3],
    targetTier: row[4],
    movedAt: row[5],
    physicalStatus: row[9],
    physicalAt: row[10],
    physicalMessage: row[11],
    sourceHeadersJson: row[12],
    sourceRowJson: row[13]
  });
}

function readOverrideRows_() {
  const sheet = overridesSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet
    .getRange(2, 1, lastRow - 1, HEADERS.length)
    .getValues()
    .map((row, index) => {
      const move = rowToMove_(row);
      if (move) {
        move.rowNumber = index + 2;
        move.active = isActiveValue_(row[8]);
        move.updatedAt = row[6];
        move.updatedBy = row[7];
      }
      return move;
    })
    .filter(Boolean);
}

function isActiveValue_(value) {
  if (value === '' || value === null || value === undefined) return true;
  return String(value).toUpperCase() !== 'FALSE';
}

function activeMoves_() {
  return readOverrideRows_()
    .filter((move) => move.active)
    .map((move) => ({
      key: move.key,
      merchantId: move.merchantId,
      merchantName: move.merchantName,
      sourceTier: move.sourceTier,
      targetTier: move.targetTier,
      movedAt: move.movedAt,
      updatedAt: String(move.updatedAt || ''),
      updatedBy: String(move.updatedBy || ''),
      physicalStatus: move.physicalStatus,
      physicalAt: move.physicalAt,
      physicalMessage: move.physicalMessage
    }));
}

function deactivateActiveRows_(sheet, updatedAt, updatedBy) {
  const rows = readOverrideRows_().filter((move) => move.active);
  rows.forEach((move) => {
    sheet.getRange(move.rowNumber, 7, 1, 3).setValues([[updatedAt, updatedBy, 'FALSE']]);
  });
}

function appendOverrideRows_(sheet, moves, resultsByIdentity, previousByIdentity, updatedAt, updatedBy) {
  if (!moves.length) return;
  const rows = moves.map((move) => {
    const identity = moveIdentity_(move);
    const result = resultsByIdentity[identity] || {};
    const previous = previousByIdentity[identity] || {};
    return [
      move.key || '',
      move.merchantId || '',
      move.merchantName || '',
      move.sourceTier || '',
      move.targetTier || '',
      move.movedAt || '',
      updatedAt,
      updatedBy,
      'TRUE',
      result.status || move.physicalStatus || '',
      result.physicalAt || move.physicalAt || '',
      result.message || move.physicalMessage || '',
      result.sourceHeadersJson || move.sourceHeadersJson || previous.sourceHeadersJson || '',
      result.sourceRowJson || move.sourceRowJson || previous.sourceRowJson || ''
    ];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
}

function headerInfo_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  const maxRows = Math.min(lastRow, 40);
  if (!maxRows || !lastColumn) throw new Error(`Sheet ${sheet.getName()} has no readable header`);
  const values = sheet.getRange(1, 1, maxRows, lastColumn).getValues();
  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const normalized = values[rowIndex].map(normalizeHeader_);
    const merchantIndex = normalized.indexOf('merchantid');
    const nameIndex = normalized.indexOf('merchantname');
    if (merchantIndex !== -1 && nameIndex !== -1) {
      return {
        headerRow: rowIndex + 1,
        headers: values[rowIndex].map((value) => String(value || '').trim()),
        merchantColumn: merchantIndex + 1,
        nameColumn: nameIndex + 1
      };
    }
  }
  throw new Error(`Could not find Merchant ID / Merchant Name header in ${sheet.getName()}`);
}

function findTierRow_(spreadsheet, tierName, move) {
  const sheetName = canonicalTier_(tierName);
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) return null;
  const info = headerInfo_(sheet);
  const dataStart = info.headerRow + 1;
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < dataStart) return null;
  const values = sheet.getRange(dataStart, 1, lastRow - info.headerRow, lastColumn).getValues();
  const merchantId = normalizeId_(move.merchantId || move.merchant_id);
  const merchantName = normalizeText_(move.merchantName || move.merchant_name);
  const matches = [];
  values.forEach((row, index) => {
    const rowId = normalizeId_(row[info.merchantColumn - 1]);
    if (!merchantId || rowId !== merchantId) return;
    matches.push({
      sheet,
      sheetName,
      info,
      rowNumber: dataStart + index,
      values: row,
      nameMatch: merchantName && normalizeText_(row[info.nameColumn - 1]) === merchantName
    });
  });
  if (!matches.length) return null;
  return matches.find((match) => match.nameMatch) || matches[0];
}

function findRowInAnyTier_(spreadsheet, move, preferredTiers) {
  const tried = {};
  const tiers = []
    .concat(preferredTiers || [])
    .concat(TIER_SHEET_NAMES)
    .map(canonicalTier_)
    .filter((tierName) => {
      if (!isTierName_(tierName) || tried[tierName]) return false;
      tried[tierName] = true;
      return true;
    });
  for (let index = 0; index < tiers.length; index += 1) {
    const found = findTierRow_(spreadsheet, tiers[index], move);
    if (found) return found;
  }
  return null;
}

function valueFromSource_(sourceByHeader, targetHeader) {
  const normalized = normalizeHeader_(targetHeader);
  if (sourceByHeader[normalized] !== undefined && sourceByHeader[normalized] !== '') {
    return sourceByHeader[normalized];
  }
  const aliases = HEADER_ALIASES[normalized] || [];
  for (let index = 0; index < aliases.length; index += 1) {
    const alias = normalizeHeader_(aliases[index]);
    if (sourceByHeader[alias] !== undefined && sourceByHeader[alias] !== '') {
      return sourceByHeader[alias];
    }
  }
  return '';
}

function mapRowToTarget_(sourceHeaders, sourceValues, targetHeaders, move) {
  const sourceByHeader = {};
  sourceHeaders.forEach((header, index) => {
    sourceByHeader[normalizeHeader_(header)] = sourceValues[index];
  });
  return targetHeaders.map((header) => {
    const normalized = normalizeHeader_(header);
    if (normalized === 'merchantid') return move.merchantId || valueFromSource_(sourceByHeader, header);
    if (normalized === 'merchantname') return move.merchantName || valueFromSource_(sourceByHeader, header);
    if (normalized === 'tierreason' || normalized === 'reason') {
      return valueFromSource_(sourceByHeader, header) || `Moved from ${move.sourceTier}`;
    }
    return valueFromSource_(sourceByHeader, header);
  });
}

function nextAppendRow_(sheet, info) {
  const dataStart = info.headerRow + 1;
  const lastRow = sheet.getLastRow();
  if (lastRow < dataStart) return dataStart;
  const idValues = sheet.getRange(dataStart, info.merchantColumn, lastRow - info.headerRow, 1).getValues();
  let lastDataRow = info.headerRow;
  idValues.forEach((row, index) => {
    if (normalizeId_(row[0])) lastDataRow = dataStart + index;
  });
  return lastDataRow + 1;
}

function appendMappedRow_(sourceHeaders, sourceValues, target, move) {
  const targetInfo = headerInfo_(target);
  const targetValues = mapRowToTarget_(sourceHeaders, sourceValues, targetInfo.headers, move);
  const appendRow = Math.max(nextAppendRow_(target, targetInfo), targetInfo.headerRow + 1);
  if (appendRow <= target.getLastRow()) {
    target.insertRowsBefore(appendRow, 1);
  }
  if (appendRow > targetInfo.headerRow + 1) {
    target
      .getRange(appendRow - 1, 1, 1, targetValues.length)
      .copyTo(target.getRange(appendRow, 1, 1, targetValues.length), { formatOnly: true });
  }
  target.getRange(appendRow, 1, 1, targetValues.length).setValues([targetValues]);
  return appendRow;
}

function safeJson_(value) {
  try {
    return JSON.stringify(value || []);
  } catch (error) {
    return '';
  }
}

function parseJsonArray_(text) {
  try {
    const parsed = JSON.parse(String(text || ''));
    return Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

function ensurePhysicalMove_(spreadsheet, move) {
  const now = new Date().toISOString();
  const targetSheet = spreadsheet.getSheetByName(move.targetTier);
  if (!targetSheet) {
    return { status: 'target_missing', physicalAt: now, message: `Target sheet ${move.targetTier} not found` };
  }

  const sourceRow = findTierRow_(spreadsheet, move.sourceTier, move);
  const targetRow = findTierRow_(spreadsheet, move.targetTier, move);
  if (targetRow) {
    if (sourceRow && sourceRow.sheet.getSheetId() !== targetRow.sheet.getSheetId()) {
      const sourceHeadersJson = safeJson_(sourceRow.info.headers);
      const sourceRowJson = safeJson_(sourceRow.values);
      sourceRow.sheet.deleteRow(sourceRow.rowNumber);
      return {
        status: 'already_in_target_removed_source',
        physicalAt: now,
        message: `Already in ${move.targetTier}; removed source row ${sourceRow.rowNumber} from ${move.sourceTier}`,
        sourceHeadersJson,
        sourceRowJson
      };
    }
    return {
      status: 'already_in_target',
      physicalAt: now,
      message: `Merchant ${move.merchantId} is already in ${move.targetTier}`
    };
  }

  const found = sourceRow || findRowInAnyTier_(spreadsheet, move, [move.sourceTier]);
  if (!found) {
    return {
      status: 'source_not_found',
      physicalAt: now,
      message: `Merchant ${move.merchantId || move.merchantName} was not found in tier tabs`
    };
  }

  const sourceHeadersJson = safeJson_(found.info.headers);
  const sourceRowJson = safeJson_(found.values);
  const appendedRow = appendMappedRow_(found.info.headers, found.values, targetSheet, move);
  if (found.sheet.getSheetId() !== targetSheet.getSheetId()) {
    found.sheet.deleteRow(found.rowNumber);
  }
  return {
    status: 'moved',
    physicalAt: now,
    message: `Moved from ${found.sheetName} row ${found.rowNumber} to ${move.targetTier} row ${appendedRow}`,
    sourceHeadersJson,
    sourceRowJson
  };
}

function rollbackPhysicalMove_(spreadsheet, move) {
  const now = new Date().toISOString();
  const sourceSheet = spreadsheet.getSheetByName(move.sourceTier);
  if (!sourceSheet) {
    return { status: 'rollback_source_missing', physicalAt: now, message: `Source sheet ${move.sourceTier} not found` };
  }
  const sourceRow = findTierRow_(spreadsheet, move.sourceTier, move);
  const targetRow = findTierRow_(spreadsheet, move.targetTier, move);
  if (sourceRow) {
    if (targetRow && targetRow.sheet.getSheetId() !== sourceRow.sheet.getSheetId()) {
      targetRow.sheet.deleteRow(targetRow.rowNumber);
      return {
        status: 'rolled_back_removed_target',
        physicalAt: now,
        message: `Merchant already in ${move.sourceTier}; removed duplicate from ${move.targetTier}`
      };
    }
    return {
      status: 'already_in_source',
      physicalAt: now,
      message: `Merchant ${move.merchantId} is already in ${move.sourceTier}`
    };
  }
  if (!targetRow) {
    return {
      status: 'rollback_row_not_found',
      physicalAt: now,
      message: `No row found to roll back for merchant ${move.merchantId || move.merchantName}`
    };
  }

  const snapshotHeaders = parseJsonArray_(move.sourceHeadersJson);
  const snapshotValues = parseJsonArray_(move.sourceRowJson);
  const sourceHeaders = snapshotHeaders || targetRow.info.headers;
  const sourceValues = snapshotValues || targetRow.values;
  const appendedRow = appendMappedRow_(sourceHeaders, sourceValues, sourceSheet, {
    merchantId: move.merchantId,
    merchantName: move.merchantName,
    sourceTier: move.targetTier,
    targetTier: move.sourceTier
  });
  targetRow.sheet.deleteRow(targetRow.rowNumber);
  return {
    status: 'rolled_back',
    physicalAt: now,
    message: `Rolled back from ${move.targetTier} row ${targetRow.rowNumber} to ${move.sourceTier} row ${appendedRow}`
  };
}

function mergeUpsertMoves_(previousMoves, incomingMoves) {
  const byIdentity = {};
  previousMoves.forEach((move) => {
    byIdentity[moveIdentity_(move)] = move;
  });
  incomingMoves.forEach((move) => {
    byIdentity[moveIdentity_(move)] = move;
  });
  return Object.keys(byIdentity).map((identity) => byIdentity[identity]);
}

function replaceMoves_(payload) {
  const spreadsheet = spreadsheet_();
  const sheet = overridesSheet_();
  const updatedAt = payload.updatedAt || new Date().toISOString();
  const updatedBy = payload.updatedBy || 'offer-intelligence-ui';
  const action = String(payload.action || 'replace').toLowerCase();
  const previousMoves = readOverrideRows_().filter((move) => move.active);
  const previousByIdentity = {};
  previousMoves.forEach((move) => {
    previousByIdentity[moveIdentity_(move)] = move;
  });

  const incomingMoves = (payload.moves || []).map(cleanMove_).filter(Boolean);
  const desiredMoves = action === 'clear'
    ? []
    : action === 'upsert'
      ? mergeUpsertMoves_(previousMoves, incomingMoves)
      : incomingMoves;
  const desiredIdentities = {};
  desiredMoves.forEach((move) => {
    desiredIdentities[moveIdentity_(move)] = true;
  });

  const resultsByIdentity = {};
  previousMoves.forEach((move) => {
    const identity = moveIdentity_(move);
    if (!desiredIdentities[identity]) {
      resultsByIdentity[identity] = rollbackPhysicalMove_(spreadsheet, move);
    }
  });
  desiredMoves.forEach((move) => {
    resultsByIdentity[moveIdentity_(move)] = ensurePhysicalMove_(spreadsheet, move);
  });

  deactivateActiveRows_(sheet, updatedAt, updatedBy);
  appendOverrideRows_(sheet, desiredMoves, resultsByIdentity, previousByIdentity, updatedAt, updatedBy);
  return activeMoves_();
}

function doGet(e) {
  try {
    assertSecret_(e && e.parameter);
    return json_({ ok: true, configured: true, moves: activeMoves_() });
  } catch (error) {
    return json_({ ok: false, configured: true, error: String(error && error.message || error) });
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    assertSecret_(payload);
    const action = String(payload.action || 'replace').toLowerCase();
    if (['replace', 'upsert', 'clear'].indexOf(action) === -1) {
      throw new Error(`Unsupported tier move action: ${action}`);
    }
    const moves = replaceMoves_({ ...payload, action });
    return json_({ ok: true, configured: true, action, moves });
  } catch (error) {
    return json_({ ok: false, configured: true, error: String(error && error.message || error) });
  }
}
