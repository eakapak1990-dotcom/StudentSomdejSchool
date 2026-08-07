// ============================================================
// Student Affairs System - Main Entry Point
// ============================================================

/**
 * ฟังก์ชันหลักสำหรับ Web App
 * รับ HTTP GET request และส่ง HTML กลับ
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(CONFIG.APP_NAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * รับ HTTP POST request (สำหรับ API calls จาก Frontend)
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    switch (action) {
      case 'login':
        return jsonResponse_(handleLogin_(data.username, data.password));

      // เพิ่ม action handlers อื่นๆ ต่อจากนี้ (เฟสถัดไป)

      default:
        return jsonResponse_({ success: false, message: 'Unknown action: ' + action });
    }
  } catch (err) {
    return jsonResponse_({ success: false, message: 'เกิดข้อผิดพลาด: ' + err.message });
  }
}

/**
 * Helper: ส่งค่ากลับเป็น JSON
 */
function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Helper: โหลด HTML partial files
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
