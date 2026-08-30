// ============================================================
// Config - ตั้งค่าระบบ
// ============================================================

const CONFIG = {
  // ⚠️ Spreadsheet ID ของ Google Sheets ที่ใช้เป็น Database
  SPREADSHEET_ID: '10Rr3Z0fYJxpwBT9a_OuQ5dBFR781-y1FxbAE1u1uKfg',
  SCRIPT_ID: '17BbuoNou2OrKTA-ZUx8fd849haMZQUX7h1x3U6FYYIoOStxbExFxawBQ',
  WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbxPLGu4ps-ejjLDzRVkRI_DLQoChdz4GmVxfpdg0IsGvwICXeAHPcozBXnXoZAxKiJ-/exec',

  APP_NAME: 'ระบบบริหารงานกลุ่มบริหารกิจการนักเรียน',
  VERSION: '1.0.0',

  // ============================================================
  // ชื่อ Sheet tabs ทั้งหมด (ภาษาอังกฤษ)
  // ============================================================
  SHEET_NAMES: {
    STUDENTS:           'Students',
    PARENTS:            'Parents',
    USERS:              'Users',
    SCORE_LOGS:         'ScoreLogs',
    LEAVE_REQUESTS:     'LeaveRequests',
    INVITATION_LETTERS: 'InvitationLetters',
    TIMELINE:           'Timeline',
    LINE_BINDINGS:      'LineBindings',
    ANNOUNCEMENTS:      'Announcements',
    AUDIT_LOG:          'AuditLog',
    CONFIG:             'Config',
  },

  // ============================================================
  // ระบบสิทธิ์ (Roles) — ตามสเปกที่ล็อกไว้ 5 roles
  // ============================================================
  ROLES: {
    ADMIN:      'admin',
    DEPUTY:     'deputy',
    ADVISOR:    'advisor',
    DISCIPLINE: 'discipline',
    PATROL:     'patrol',
  },

  ROLE_LABELS: {
    admin:      'ผู้ดูแลระบบ',
    deputy:     'รองผู้อำนวยการ/ผู้บริหาร',
    advisor:    'ครูที่ปรึกษา',
    discipline: 'ครูฝ่ายปกครอง',
    patrol:     'คณะกรรมการสารวัตรนักเรียน',
  },

  // ตาราง permission ตามที่ล็อกไว้:
  // score / approveLeave / editDelete ทุก role ยกเว้น patrol (approveLeave, editDelete = false)
  // manageSystem เฉพาะ admin เท่านั้น
  PERMISSIONS: {
    admin:      { score: true,  approveLeave: true,  editDelete: true,  manageSystem: true  },
    deputy:     { score: true,  approveLeave: true,  editDelete: true,  manageSystem: false },
    advisor:    { score: true,  approveLeave: true,  editDelete: true,  manageSystem: false },
    discipline: { score: true,  approveLeave: true,  editDelete: true,  manageSystem: false },
    patrol:     { score: true,  approveLeave: false, editDelete: false, manageSystem: false },
  },

  // ============================================================
  // คะแนนความประพฤติ
  // ============================================================
  SCORE: {
    INITIAL_SCORE: 100,
    ALERT_INTERVAL: 20,
  },

  // ============================================================
  // Session
  // ============================================================
  SESSION_DURATION_HOURS: 6,   // CacheService max = 6 ชม. (21,600 วินาที)

  // ============================================================
  // ข้อมูลโรงเรียน (สำหรับหนังสือราชการ)
  // ============================================================
  SCHOOL_INFO: {
    NAME: 'โรงเรียนสมเด็จพิทยาคม',
    ADDRESS: 'อำเภอสมเด็จ จังหวัดกาฬสินธุ์',
    POSTAL_CODE: '๔๖๑๕๐',
    PHONE: '๐๘๖-๔๕๖๓๑๐๕',
    EMAIL: 'somdetpit.spk@gmail.com',
    MOTTO: 'เรียนดี มีคุณธรรม',
    DEPARTMENT: 'กลุ่มบริหารกิจการนักเรียน',
    LOCATION_DETAIL: 'ห้องกลุ่มบริหารกิจการนักเรียน อาคาร 2 ชั้น 2'
  },

  // ============================================================
  // ผู้ลงนาม (แก้ไขได้ภายหลังผ่าน Sheet Config โดยตรง)
  // ============================================================
  SIGNER_INFO: {
    NAME: 'นายธนวิทย์ ชารีรักษ์',
    POSITION: 'รองผู้อำนวยการสถานศึกษา ปฏิบัติราชการแทน\nผู้อำนวยการโรงเรียนสมเด็จพิทยาคม'
  }
}; // <-- ย้าย }; มาปิด Object CONFIG ที่ตรงนี้แทน

// ============================================================
// Helper Functions + Performance Cache Layer
// ============================================================

/**
 * In-memory cache — อยู่ตลอด request lifecycle (ไม่ต้องมี TTL ซับซ้อน)
 * ทุก write operation ต้องเรียก invalidateAllCache_() หลังเขียน
 */
var _cachedSpreadsheet = null;
var _cachedSheetData = {};   // { sheetName: { headers: [], rows: [] } }
var _cachedConfigMap = null; // { key: value } สำหรับ Config sheet
var _sheetCache = {};        // { sheetName: Sheet } cache Sheet objects ใน request scope

// Cross-execution cache TTL (วินาที)
const SHEET_CACHE_TTL = 300; // 5 นาที

/**
 * เปิด Spreadsheet หลักของระบบ (cached — ไม่เปิดใหม่ทุกครั้ง)
 */
function getSpreadsheet() {
  if (_cachedSpreadsheet) return _cachedSpreadsheet;
  if (!CONFIG.SPREADSHEET_ID) {
    throw new Error('กรุณาตั้งค่า SPREADSHEET_ID ใน Config.gs');
  }
  _cachedSpreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  return _cachedSpreadsheet;
}

/**
 * เปิด Sheet ตามชื่อที่กำหนด (cached ใน request scope — ไม่เปิดซ้ำใน execution เดียวกัน)
 */
function getSheet(sheetName) {
  if (_sheetCache[sheetName]) return _sheetCache[sheetName];
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(`ไม่พบ Sheet ชื่อ: ${sheetName}`);
  }
  _sheetCache[sheetName] = sheet;
  return sheet;
}

/**
 * ดึงข้อมูลทั้งชีตเป็น { headers: [], rows: [] } แบบ cached
 * — ใช้แทน sheet.getDataRange().getValues() ที่เรียกซ้ำๆ
 * — 2 layers: in-memory (request scope) + CacheService (cross-execution, TTL 5 นาที)
 * — rows เป็น array of arrays (ไม่ convert เป็น object เพื่อความเร็ว)
 */
function getCachedSheetData_(sheetName) {
  // Layer 1: in-memory cache (request scope)
  if (_cachedSheetData[sheetName]) return _cachedSheetData[sheetName];

  // Layer 2: CacheService (cross-execution)
  const cache = CacheService.getScriptCache();
  const cacheKey = 'SHEET_DATA_' + sheetName;
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      const result = JSON.parse(cached);
      _cachedSheetData[sheetName] = result;
      return result;
    } catch (e) { /* cache corrupt — อ่าน Sheet ใหม่ */ }
  }

  // Layer 3: อ่านจาก Sheet จริง
  const sheet = getSheet(sheetName);
  const data = sheet.getDataRange().getValues();
  const result = { headers: data[0] || [], rows: data.slice(1) };
  _cachedSheetData[sheetName] = result;

  // เก็บลง CacheService (ข้าม execution) — ใช้ JSON.stringify
  try {
    cache.put(cacheKey, JSON.stringify(result), SHEET_CACHE_TTL);
  } catch (e) { /* ข้อมูลใหญ่เกิน cache limit — ข้ามไป */ }

  return result;
}

/**
 * ดึงข้อมูล Config sheet เป็น Map { key: value } — cached
 * ใช้แทน getConfigValue_() ที่อ่านทั้งชีตทุกครั้ง
 */
function getCachedConfigMap_() {
  if (_cachedConfigMap) return _cachedConfigMap;
  _cachedConfigMap = {};
  try {
    const data = getCachedSheetData_(CONFIG.SHEET_NAMES.CONFIG);
    for (let i = 0; i < data.rows.length; i++) {
      const key = data.rows[i][0];
      if (key) _cachedConfigMap[key] = data.rows[i][1];
    }
  } catch (e) {
    // ถ้า Config sheet ไม่มี ให้คืน object ว่าง
  }
  return _cachedConfigMap;
}

/**
 * อ่านค่าจาก Config sheet (cached version)
 */
function getConfigValue_(key) {
  const map = getCachedConfigMap_();
  return map[key] !== undefined ? map[key] : null;
}

/**
 * เขียนค่าลง Config sheet + clear cache ทันที
 */
function setConfigValue_(key, value, description) {
  const sheet = getSheet(CONFIG.SHEET_NAMES.CONFIG);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      // clear config cache ทันทีหลังเขียน
      _cachedConfigMap = null;
      if (_cachedSheetData[CONFIG.SHEET_NAMES.CONFIG]) {
        delete _cachedSheetData[CONFIG.SHEET_NAMES.CONFIG];
      }
      return;
    }
  }
  sheet.appendRow([key, value, description || '']);
  // clear cache หลัง append
  _cachedConfigMap = null;
  if (_cachedSheetData[CONFIG.SHEET_NAMES.CONFIG]) {
    delete _cachedSheetData[CONFIG.SHEET_NAMES.CONFIG];
  }
}

/**
 * ล้าง cache ทั้งหมด — เรียกหลังทุก write operation
 * (เพิ่ม/แก้ไข/ลบ ข้อมูลใน Sheets)
 */
function invalidateAllCache_() {
  const cache = CacheService.getScriptCache();
  // ลบ cross-execution cache ของทุก sheet
  Object.keys(CONFIG.SHEET_NAMES).forEach(function (key) {
    cache.remove('SHEET_DATA_' + CONFIG.SHEET_NAMES[key]);
  });
  _cachedSpreadsheet = null;
  _cachedSheetData = {};
  _cachedConfigMap = null;
  _sheetCache = {};
}

/**
 * ล้าง cache เฉพาะชีตที่ระบุ — เรียกหลังเขียนข้อมูลชีตนั้นๆ
 * ล้างทั้ง in-memory และ CacheService (cross-execution)
 */
function invalidateSheetCache_(sheetName) {
  if (_cachedSheetData[sheetName]) {
    delete _cachedSheetData[sheetName];
  }
  CacheService.getScriptCache().remove('SHEET_DATA_' + sheetName);
  // ถ้าแก้ Config ต้อง clear config map ด้วย
  if (sheetName === CONFIG.SHEET_NAMES.CONFIG) {
    _cachedConfigMap = null;
  }
}

/**
 * ตรวจสอบและเพิ่มคอลัมน์ Permissions ใน Sheet Users ถ้ายังไม่มี
 * สำหรับผู้ใช้เดิมที่ยังไม่มีค่า Permissions → เติมสิทธิ์จาก role ปัจจุบัน (migrate)
 * @return {number} คอลัมน์ index ของ Permissions (0-based)
 */
function ensurePermissionsColumn_() {
  // เช็ค CacheService ก่อน — ถ้าเคยตรวจแล้วว่ามีคอลัมน์ Permissions ก็ไม่ต้องเรียกซ้ำ
  const permCache = CacheService.getScriptCache();
  const cachedResult = permCache.get('PERM_COL_EXISTS');
  if (cachedResult !== null) return Number(cachedResult);

  const sheet = getSheet(CONFIG.SHEET_NAMES.USERS);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colPerm = headers.indexOf('Permissions');
  if (colPerm !== -1) {
    permCache.put('PERM_COL_EXISTS', String(colPerm), 3600);
    return colPerm; // มีแล้ว
  }

  // เพิ่มคอลัมน์ใหม่ถัดจากคอลัมน์สุดท้าย
  const newColPos = headers.length + 1;
  sheet.getRange(1, newColPos).setValue('Permissions')
    .setFontWeight('bold').setBackground('#152A52').setFontColor('#FFFFFF');

  // Migrate ผู้ใช้เดิม: เติมสิทธิ์จาก role ปัจจุบัน
  const data = sheet.getDataRange().getValues();
  const colRole = headers.indexOf('Role');
  const lastRow = sheet.getLastRow();
  for (let i = 1; i < data.length; i++) {
    const role = data[i][colRole];
    const perms = CONFIG.PERMISSIONS[role] || CONFIG.PERMISSIONS[CONFIG.ROLES.PATROL] || {};
    sheet.getRange(i + 1, newColPos).setValue(JSON.stringify(perms));
  }

  invalidateSheetCache_(CONFIG.SHEET_NAMES.USERS);
  Logger.log('ensurePermissionsColumn_: เพิ่มคอลัมน์ Permissions และ migrate ผู้ใช้เดิมแล้ว');
  permCache.put('PERM_COL_EXISTS', String(newColPos - 1), 3600);
  return newColPos - 1; // 0-based index
}
