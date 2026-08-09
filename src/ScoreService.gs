// ============================================
// SCORESERVICE.GS - จัดการเพิ่ม/ลดคะแนนความประพฤติ
// ============================================

const SCORE_THRESHOLDS = [80, 60, 40, 20, 0];

function api_addScore_(token, payload) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!CONFIG.PERMISSIONS[session.role] || !CONFIG.PERMISSIONS[session.role].score) {
      return { success: false, message: 'คุณไม่มีสิทธิ์บันทึกคะแนน' };
    }

    const studentId = payload.studentId;
    const type = payload.type; // 'add' หรือ 'deduct'
    const amount = Math.abs(Number(payload.amount) || 0);
    const reason = (payload.reason || '').trim();

    if (!studentId) return { success: false, message: 'กรุณาเลือกนักเรียน' };
    if (!['add', 'deduct'].includes(type)) return { success: false, message: 'ประเภทรายการไม่ถูกต้อง' };
    if (amount <= 0) return { success: false, message: 'กรุณาระบุจำนวนคะแนนให้ถูกต้อง' };
    if (!reason) return { success: false, message: 'กรุณาระบุเหตุผล' };

    const sheet = getSheet(CONFIG.SHEET_NAMES.STUDENTS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colId = headers.indexOf('StudentID');
    const colScore = headers.indexOf('CurrentScore');
    const colPhase = headers.indexOf('EducationPhase');
    const colFirstName = headers.indexOf('FirstName');
    const colLastName = headers.indexOf('LastName');
    const colPrefix = headers.indexOf('Prefix');

    let rowIndex = -1, oldScore = 0, phase = '', studentName = '';
    for (let i = 1; i < data.length; i++) {
      if (data[i][colId] === studentId) {
        rowIndex = i;
        oldScore = Number(data[i][colScore]) || 0;
        phase = data[i][colPhase];
        studentName = (data[i][colPrefix] || '') + (data[i][colFirstName] || '') + ' ' + (data[i][colLastName] || '');
        break;
      }
    }
    if (rowIndex === -1) return { success: false, message: 'ไม่พบข้อมูลนักเรียน' };

    const newScore = type === 'add' ? oldScore + amount : oldScore - amount;

    // อัปเดตคะแนนใน Sheet Students
    sheet.getRange(rowIndex + 1, colScore + 1).setValue(newScore);
    sheet.getRange(rowIndex + 1, headers.indexOf('UpdatedAt') + 1).setValue(new Date());

    // บันทึกลง ScoreLogs
    const logSheet = getSheet(CONFIG.SHEET_NAMES.SCORE_LOGS);
    const logId = Utilities.getUuid();
    logSheet.appendRow([
      logId, studentId, type, amount, reason,
      session.userId, session.fullName, new Date(), phase
    ]);

    // เพิ่ม Timeline event
    const eventType = type === 'add' ? 'add' : 'deduct';
    const eventTitle = (type === 'add' ? 'ได้รับเพิ่มคะแนน ' : 'ถูกหักคะแนน ') + amount + ' คะแนน: ' + reason;
    addTimelineEvent_(studentId, eventType, eventTitle, 'บันทึกโดย ' + session.fullName, session.fullName);

    logAudit_(session, 'SCORE_' + type.toUpperCase(), CONFIG.SHEET_NAMES.STUDENTS, studentId,
      'คะแนนเดิม: ' + oldScore, 'คะแนนใหม่: ' + newScore + ' (' + reason + ')');

    // ตรวจสอบว่าข้ามเกณฑ์แจ้งเตือนหรือไม่ (เฉพาะกรณีลดคะแนน)
    let alertTriggered = null;
    if (type === 'deduct') {
      for (let t = 0; t < SCORE_THRESHOLDS.length; t++) {
        const threshold = SCORE_THRESHOLDS[t];
        if (oldScore > threshold && newScore <= threshold) {
          alertTriggered = threshold;
          addTimelineEvent_(
            studentId, 'alert',
            'แจ้งเตือน: คะแนนลดถึงเกณฑ์ ' + threshold + ' คะแนน — ต้องเชิญผู้ปกครอง',
            'คะแนนคงเหลือ ' + newScore + ' คะแนน (รอบ' + phase + ')',
            'ระบบอัตโนมัติ'
          );
          // สร้างร่างหนังสือเชิญผู้ปกครองอัตโนมัติทันที (สถานะ draft รอเจ้าหน้าที่ยืนยัน)
          try {
            createAutoDraftLetter_(studentId, threshold, newScore);
          } catch (letterErr) {
            // ไม่ให้การสร้างหนังสือ error กระทบการบันทึกคะแนนหลัก
            Logger.log('สร้างร่างหนังสือเชิญอัตโนมัติไม่สำเร็จ: ' + letterErr.message);
          }
          break;
        }
      }
    }

    return {
      success: true,
      newScore: newScore,
      studentName: studentName,
      alertTriggered: alertTriggered
    };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

function api_getScoreHistory_(token, filters) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

    filters = filters || {};
    const limit = filters.limit || 50;

    const logSheet = getSheet(CONFIG.SHEET_NAMES.SCORE_LOGS);
    const logData = logSheet.getDataRange().getValues();
    const logHeaders = logData[0];
    let logs = logData.slice(1).map(row => rowToObject_(logHeaders, row));

    if (filters.studentId) {
      logs = logs.filter(l => l.StudentID === filters.studentId);
    }

    logs.sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));
    logs = logs.slice(0, limit);

    // เติมชื่อนักเรียนให้แต่ละ log
    const studentSheet = getSheet(CONFIG.SHEET_NAMES.STUDENTS);
    const studentData = studentSheet.getDataRange().getValues();
    const studentHeaders = studentData[0];
    const nameMap = {};
    studentData.slice(1).forEach(row => {
      const obj = rowToObject_(studentHeaders, row);
      nameMap[obj.StudentID] = (obj.Prefix || '') + (obj.FirstName || '') + ' ' + (obj.LastName || '');
    });

    logs.forEach(l => { l.StudentName = nameMap[l.StudentID] || l.StudentID; });

    return { success: true, logs: logs };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

// ============================================
// Public Functions (สำหรับ google.script.run)
// ============================================
function apiAddScore(token, payload) {
  return api_addScore_(token, payload);
}
function apiGetScoreHistory(token, filters) {
  return api_getScoreHistory_(token, filters);
}