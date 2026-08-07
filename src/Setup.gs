// ============================================================
// Setup - ติดตั้งและเริ่มต้นระบบ (รันครั้งแรกครั้งเดียว)
// ============================================================

/**
 * รันครั้งแรกเพื่อสร้าง Sheet tabs ทั้งหมดที่จำเป็น
 */
function setupSheets() {
  const ss = getSpreadsheet();
  const sheetsToCreate = [
    { name: CONFIG.SHEET_NAMES.STUDENTS,   headers: ['รหัสนักศึกษา', 'ชื่อ-นามสกุล', 'สาขา', 'ชั้นปี', 'เบอร์โทร', 'อีเมล', 'สถานะ'] },
    { name: CONFIG.SHEET_NAMES.ACTIVITIES, headers: ['รหัสกิจกรรม', 'ชื่อกิจกรรม', 'วันที่', 'สถานที่', 'ผู้รับผิดชอบ', 'จำนวนที่รับ', 'สถานะ'] },
    { name: CONFIG.SHEET_NAMES.RECORDS,    headers: ['รหัส', 'รหัสนักศึกษา', 'รหัสกิจกรรม', 'วันที่ลงทะเบียน', 'สถานะ', 'หมายเหตุ'] },
  ];

  sheetsToCreate.forEach(({ name, headers }) => {
    let sheet = ss.getSheetByName(name);

    if (!sheet) {
      sheet = ss.insertSheet(name);
      Logger.log(`✅ สร้าง Sheet: ${name}`);
    } else {
      Logger.log(`⚠️ Sheet มีอยู่แล้ว: ${name}`);
    }

    // ใส่ Headers ถ้ายังว่างอยู่
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#4A90D9')
        .setFontColor('#FFFFFF');
      sheet.setFrozenRows(1);
    }
  });

  Logger.log('🎉 Setup เสร็จสมบูรณ์!');
  SpreadsheetApp.flush();
}

/**
 * ทดสอบการเชื่อมต่อกับ Google Sheets
 */
function testConnection() {
  try {
    const ss = getSpreadsheet();
    Logger.log(`✅ เชื่อมต่อสำเร็จ: ${ss.getName()}`);
    Logger.log(`📋 จำนวน Sheets: ${ss.getSheets().length}`);
    ss.getSheets().forEach(s => Logger.log(` - ${s.getName()}`));
  } catch (e) {
    Logger.log(`❌ Error: ${e.message}`);
  }
}
