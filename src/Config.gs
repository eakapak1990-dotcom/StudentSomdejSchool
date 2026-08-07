// ============================================================
// Config - ตั้งค่าระบบ
// ============================================================

const CONFIG = {
  // ⚠️ ใส่ Spreadsheet ID ของ Google Sheets ที่ใช้เป็น Database
  // เปิด Google Sheets → URL จะเป็น: docs.google.com/spreadsheets/d/<<ID>>/edit
  SPREADSHEET_ID: '',

  SCRIPT_ID: '1X_lQTXUF8yLiCV-nkye7mfAmFyGjAdMuVvXk0jICAQA',
  WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbydTMIeXgYK-sd_FT8h4BsEinZeFfW-f71Dh6kRggBRIvfT1sTPMy6FTyt-XMKgaqxVMA/exec',

  SHEET_NAMES: {
    STUDENTS: 'นักศึกษา',
    ACTIVITIES: 'กิจกรรม',
    RECORDS: 'บันทึก',
  },
  APP_NAME: 'ระบบงานกิจการนักศึกษา',
  VERSION: '1.0.0',
};

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
