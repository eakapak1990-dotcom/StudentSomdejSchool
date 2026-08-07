// ============================================
// SETUP.GS - รันครั้งเดียวเพื่อสร้างโครงสร้าง Sheet ทั้งหมด
// วิธีใช้: เปิด Apps Script Editor -> เลือกฟังก์ชัน setupAllSheets -> กด Run
// ============================================

function setupAllSheets() {
  const ss = getSpreadsheet();

  createSheetWithHeaders_(ss, CONFIG.SHEET_NAMES.STUDENTS, [
    'StudentID', 'CitizenID', 'Prefix', 'FirstName', 'LastName', 'Gender',
    'Grade', 'Room', 'No', 'DOB', 'Weight', 'Height', 'BloodType',
    'Religion', 'Ethnicity', 'Nationality',
    'Address_No', 'Address_Moo', 'Address_Road', 'Address_Tambon', 'Address_Amphoe', 'Address_Province',
    'CurrentScore', 'EducationPhase', 'PhotoFileID', 'LineLinked',
    'CreatedAt', 'UpdatedAt'
  ]);

  createSheetWithHeaders_(ss, CONFIG.SHEET_NAMES.PARENTS, [
    'StudentID', 'ParentName', 'ParentRelation', 'ParentJob', 'ParentPhone',
    'FatherName', 'FatherJob', 'MotherName', 'MotherJob', 'UpdatedAt'
  ]);

  createSheetWithHeaders_(ss, CONFIG.SHEET_NAMES.USERS, [
    'UserID', 'Username', 'PasswordHash', 'FullName', 'Role',
    'Active', 'LastLogin', 'CreatedAt'
  ]);

  createSheetWithHeaders_(ss, CONFIG.SHEET_NAMES.SCORE_LOGS, [
    'LogID', 'StudentID', 'Type', 'Amount', 'Reason',
    'RecordedBy', 'RecordedByName', 'Timestamp', 'EducationPhase'
  ]);

  createSheetWithHeaders_(ss, CONFIG.SHEET_NAMES.LEAVE_REQUESTS, [
    'RequestID', 'StudentID', 'Reason', 'RequestedOutTime', 'RequestedInTime',
    'Status', 'ApprovedBy', 'ApprovedByName', 'ApprovalReason',
    'ActualOutTime', 'ActualInTime', 'CreatedAt', 'UpdatedAt'
  ]);

  createSheetWithHeaders_(ss, CONFIG.SHEET_NAMES.INVITATION_LETTERS, [
    'LetterID', 'LetterNo', 'StudentID', 'Subject', 'Status',
    'SignatureType', 'PdfFileID', 'CreatedBy', 'CreatedAt', 'ConfirmedAt'
  ]);

  createSheetWithHeaders_(ss, CONFIG.SHEET_NAMES.TIMELINE, [
    'EventID', 'StudentID', 'EventType', 'Title', 'Description',
    'RecordedBy', 'Timestamp'
  ]);

  createSheetWithHeaders_(ss, CONFIG.SHEET_NAMES.LINE_BINDINGS, [
    'BindingID', 'StudentID', 'LineUserID', 'ParentDisplayName',
    'BoundAt', 'Active'
  ]);

  createSheetWithHeaders_(ss, CONFIG.SHEET_NAMES.AUDIT_LOG, [
    'LogID', 'UserID', 'UserName', 'Action', 'TargetSheet', 'TargetID',
    'BeforeValue', 'AfterValue', 'Timestamp'
  ]);

  createSheetWithHeaders_(ss, CONFIG.SHEET_NAMES.CONFIG, [
    'Key', 'Value', 'Description'
  ]);

  // ใส่ค่า Config เริ่มต้น
  const configSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.CONFIG);
  if (configSheet.getLastRow() === 1) {
    configSheet.appendRow(['CURRENT_ACADEMIC_YEAR', '2569', 'ปีการศึกษาปัจจุบัน']);
    configSheet.appendRow(['INITIAL_SCORE', '100', 'คะแนนเริ่มต้นของนักเรียน']);
    configSheet.appendRow(['ALERT_INTERVAL', '20', 'แจ้งเตือนทุกๆ กี่คะแนนที่ลดลง']);
  }

  // สร้าง Admin เริ่มต้น
  const usersSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.USERS);
  if (usersSheet.getLastRow() === 1) {
    usersSheet.appendRow([
      'USR0001', 'admin', hashPassword_('Admin@1234'), 'ผู้ดูแลระบบ',
      CONFIG.ROLES.ADMIN, true, '', new Date()
    ]);
  }

  SpreadsheetApp.getUi().alert(
    'ตั้งค่า Sheet ทั้งหมดเรียบร้อยแล้ว!\n\n' +
    'Username: admin\nPassword: Admin@1234\n\n' +
    '⚠️ กรุณาเปลี่ยนรหัสผ่านทันทีหลังเข้าสู่ระบบครั้งแรก'
  );
}

/**
 * Helper: สร้าง Sheet พร้อม Headers
 */
function createSheetWithHeaders_(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#152A52')
      .setFontColor('#FFFFFF');
  }
}

/**
 * ทดสอบการเชื่อมต่อกับ Google Sheets
 */
function testConnection() {
  try {
    const ss = getSpreadsheet();
    Logger.log('✅ เชื่อมต่อสำเร็จ: ' + ss.getName());
    Logger.log('📋 จำนวน Sheets: ' + ss.getSheets().length);
    ss.getSheets().forEach(function(s) { Logger.log(' - ' + s.getName()); });
  } catch (e) {
    Logger.log('❌ Error: ' + e.message);
  }
}
