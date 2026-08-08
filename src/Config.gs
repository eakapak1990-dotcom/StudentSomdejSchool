// ============================================================
// Config - ตั้งค่าระบบ
// ============================================================

const CONFIG = {
  // ⚠️ Spreadsheet ID ของ Google Sheets ที่ใช้เป็น Database
  SPREADSHEET_ID: '1X_lQTXUF8yLiCV-nkye7mfAmFyGjAdMuVvXk0jICAQA',
  SCRIPT_ID: '1XaxgmZ6vqLEGP_CIR_KI9H6cMzuOkZjuXYetmSQ816cWRU_fxV1YlMh-',
  WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbydTMIeXgYK-sd_FT8h4BsEinZeFfW-f71Dh6kRggBRIvfT1sTPMy6FTyt-XMKgaqxVMA/exec',

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
};

// ============================================================
// Helper Functions
// ============================================================

/**
 * เปิด Spreadsheet หลักของระบบ
 */
function getSpreadsheet() {
  if (!CONFIG.SPREADSHEET_ID) {
    throw new Error('กรุณาตั้งค่า SPREADSHEET_ID ใน Config.gs');
  }
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

/**
 * เปิด Sheet ตามชื่อที่กำหนด
 */
function getSheet(sheetName) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(`ไม่พบ Sheet ชื่อ: ${sheetName}`);
  }
  return sheet;
}