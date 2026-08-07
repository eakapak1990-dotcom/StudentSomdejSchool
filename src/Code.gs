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
    .setTitle('ระบบงานกิจการนักศึกษา')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * รับ HTTP POST request (สำหรับ API calls จาก Frontend)
 */
function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const action = data.action;

  switch (action) {
    // เพิ่ม action handlers ที่นี่
    default:
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, message: 'Unknown action' }))
        .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Helper: โหลด HTML partial files
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
