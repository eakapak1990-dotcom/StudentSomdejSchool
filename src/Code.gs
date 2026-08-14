// ============================================================
// Student Affairs System - Main Entry Point
// ============================================================

/**
 * ฟังก์ชันหลักสำหรับ Web App
 * รับ HTTP GET request และส่ง HTML กลับ
 */
function doGet(e) {
  // หน้า LIFF สำหรับผู้ปกครอง (เปิดผ่าน LINE OA) — ใช้ URL .../exec?page=liff
  if (e && e.parameter && e.parameter.page === 'liff') {
    return HtmlService.createTemplateFromFile('Liff')
      .evaluate()
      .setTitle('ผู้ปกครอง — ' + CONFIG.APP_NAME)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

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
    // รองรับทั้ง JSON (text/plain / application/json) และ form-encoded
    let data;
    const raw = e && e.postData && e.postData.contents;
    try {
      data = JSON.parse(raw || '{}');
    } catch (err) {
      data = (e && e.parameter) || {};
    }
    const action = data.action;

    switch (action) {
      case 'login':
        return jsonResponse_(handleLogin_(data.username, data.password));

      // ===== LIFF API (หน้า LIFF โฮสต์นอก GAS เรียกผ่าน HTTP — ดู liff-web/index.html) =====
      case 'liffBind':
        return jsonResponse_(apiLiffBind(data.lineUserId, data.studentId, data.parentPhone, data.pin));
      case 'liffUnbind':
        return jsonResponse_(apiLiffUnbind(data.lineUserId, data.studentId, data.pin));
      case 'liffChangePin':
        return jsonResponse_(apiLiffChangePin(data.lineUserId, data.studentId, data.oldPin, data.newPin));
      case 'liffGetMyStudents':
        return jsonResponse_(apiLiffGetMyStudents(data.lineUserId));
      case 'liffGetStudentScore':
        return jsonResponse_(apiLiffGetStudentScore(data.lineUserId, data.studentId));
      case 'liffGetNotifications':
        return jsonResponse_(apiLiffGetNotifications(data.lineUserId, data.studentId));
      case 'liffSubmitLeave':
        return jsonResponse_(apiLiffSubmitLeave(data.lineUserId, data.studentId, data.reason, data.leaveDate, data.outTime, data.inTime));
      case 'liffGetAnnouncements':
        return jsonResponse_(apiLiffGetAnnouncements(data.lineUserId));

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
