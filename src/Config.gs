// ============================================================
// Config - ตั้งค่าระบบ
// ============================================================

const CONFIG = {
  SPREADSHEET_ID: '1X_lQTXUF8yLiCV-nkye7mfAmFyGjAdMuVvXk0jICAQA',
  SCRIPT_ID: '1XaxgmZ6vqLEGP_CIR_KI9H6cMzuOkZjuXYetmSQ816cWRU_fxV1YlMh-',
  WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbydTMIeXgYK-sd_FT8h4BsEinZeFfW-f71Dh6kRggBRIvfT1sTPMy6FTyt-XMKgaqxVMA/exec',

  APP_NAME: 'ระบบงานกิจการนักศึกษา',
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
  // ระบบสิทธิ์ (Roles)
  // ============================================================
  ROLES: {
    ADMIN:   'admin',
    STAFF:   'staff',
    STUDENT: 'student',
  },

  ROLE_LABELS: {
    admin:   'ผู้ดูแลระบบ',
    staff:   'เจ้าหน้าที่',
    student: 'นักศึกษา',
  },

  PERMISSIONS: {
    admin: {
      manageUsers:      true,
      manageStudents:   true,
      manageScores:     true,
      manageLeave:      true,
      manageLetter:     true,
      viewReports:      true,
      viewAuditLog:     true,
      manageConfig:     true,
    },
    staff: {
      manageUsers:      false,
      manageStudents:   true,
      manageScores:     true,
      manageLeave:      true,
      manageLetter:     true,
      viewReports:      true,
      viewAuditLog:     false,
      manageConfig:     false,
    },
    student: {
      manageUsers:      false,
      manageStudents:   false,
      manageScores:     false,
      manageLeave:      false,
      manageLetter:     false,
      viewReports:      false,
      viewAuditLog:     false,
      manageConfig:     false,
    },
  },

  // ============================================================
  // Session
  // ============================================================
  SESSION_DURATION_HOURS: 6,
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
