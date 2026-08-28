// ============================================
// SCORESERVICE.GS - จัดการเพิ่ม/ลดคะแนนความประพฤติ
// ============================================

const SCORE_THRESHOLDS = [80, 60, 40, 20, 0];

function api_addScore_(token, payload) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!session.permissions || !session.permissions.score) {
      return { success: false, message: 'คุณไม่มีสิทธิ์บันทึกคะแนน' };
    }

    const studentId = payload.studentId;
    const type = payload.type; // 'add' หรือ 'deduct'
    const amountRaw = Number(payload.amount);
    const reason = (payload.reason || '').trim();

    if (!studentId) return { success: false, message: 'กรุณาเลือกนักเรียน' };
    if (!['add', 'deduct'].includes(type)) return { success: false, message: 'ประเภทรายการไม่ถูกต้อง' };
    if (!Number.isInteger(amountRaw) || amountRaw <= 0 || amountRaw > 50) {
      return { success: false, message: 'จำนวนคะแนนต้องเป็นจำนวนเต็ม 1–50' };
    }
    const amount = amountRaw;
    if (!reason) return { success: false, message: 'กรุณาระบุเหตุผล' };

    // LockService: กัน lost update เมื่อบันทึกคะแนนพร้อมกัน (อ่านคะแนนเดิม → คำนวณ → เขียน)
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const cached = getCachedSheetData_(CONFIG.SHEET_NAMES.STUDENTS);
    const headers = cached.headers;
    const colId = headers.indexOf('StudentID');
    const colScore = headers.indexOf('CurrentScore');
    const colPhase = headers.indexOf('EducationPhase');
    const colFirstName = headers.indexOf('FirstName');
    const colLastName = headers.indexOf('LastName');
    const colPrefix = headers.indexOf('Prefix');

    let rowIndex = -1, oldScore = 0, phase = '', studentName = '';
    for (let i = 0; i < cached.rows.length; i++) {
      if (sameId_(cached.rows[i][colId], studentId)) {
        rowIndex = i;
        phase = cached.rows[i][colPhase];
        studentName = (cached.rows[i][colPrefix] || '') + (cached.rows[i][colFirstName] || '') + ' ' + (cached.rows[i][colLastName] || '');
        
        // คำนวณคะแนนเดิมที่แท้จริงจากประวัติ (SCORE_LOGS) ป้องกันค่าว่างในฐานข้อมูล
        const scoreLogs = getCachedSheetData_(CONFIG.SHEET_NAMES.SCORE_LOGS);
        const logIdCol = scoreLogs.headers.indexOf('StudentID');
        const logTypeCol = scoreLogs.headers.indexOf('Type');
        const logAmtCol = scoreLogs.headers.indexOf('Amount');
        let netChange = 0;
        if (scoreLogs && scoreLogs.rows) {
          for (let j = 0; j < scoreLogs.rows.length; j++) {
            if (sameId_(scoreLogs.rows[j][logIdCol], studentId)) {
              let t = scoreLogs.rows[j][logTypeCol];
              let a = Number(scoreLogs.rows[j][logAmtCol]) || 0;
              if (t === 'add') netChange += a;
              else if (t === 'deduct') netChange -= a;
            }
          }
        }
        oldScore = (Number(CONFIG.SCORE.INITIAL_SCORE) || 100) + netChange;
        
        break;
      }
    }
      if (rowIndex === -1) return { success: false, message: 'ไม่พบข้อมูลนักเรียน' };

      const newScore = type === 'add' ? oldScore + amount : oldScore - amount;
      if (newScore < 0) {
        return { success: false, message: 'คะแนนคงเหลือไม่พอสำหรับการหัก (คงเหลือ ' + oldScore + ' คะแนน)' };
      }

        // อัปเดตคะแนนใน Sheet Students
      const sheet = getSheet(CONFIG.SHEET_NAMES.STUDENTS);
      sheet.getRange(rowIndex + 2, colScore + 1).setValue(newScore);
      sheet.getRange(rowIndex + 2, headers.indexOf('UpdatedAt') + 1).setValue(new Date());
      invalidateSheetCache_(CONFIG.SHEET_NAMES.STUDENTS);

      // วัน/เวลาที่เกิดเหตุ (ไม่บังคับ) — ใช้ย้อนรอยเหตุการณ์ เช่น เหตุเกิดก่อนวันที่บันทึก
      const eventTime = String(payload.eventTime || '').trim();
      if (eventTime && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(eventTime)) {
        return { success: false, message: 'รูปแบบวัน/เวลาที่เกิดเหตุไม่ถูกต้อง' };
      }

      // บันทึกลง ScoreLogs
      const logSheet = getSheet(CONFIG.SHEET_NAMES.SCORE_LOGS);
      ensureScoreLogEventTimeColumn_();
      const logId = Utilities.getUuid();
      const recordSequence = getNextRecordSequence_('score');
      logSheet.appendRow([
        logId, studentId, type, amount, reason,
        session.userId, session.fullName, new Date(), phase, eventTime
      ]);
      // กัน Google Sheets แปลงวัน/เวลาที่เกิดเหตุเป็นวันที่อัตโนมัติ — เก็บเป็นข้อความ
      const logRow = logSheet.getLastRow();
      logSheet.getRange(logRow, 10).setNumberFormat('@');
      logSheet.getRange(logRow, 10).setValue(eventTime);

      // เพิ่ม Timeline event
      const eventType = type === 'add' ? 'add' : 'deduct';
      const eventTitle = (type === 'add' ? 'ได้รับเพิ่มคะแนน ' : 'ถูกหักคะแนน ') + amount + ' คะแนน: ' + reason;
      addTimelineEvent_(studentId, eventType, eventTitle, 'บันทึกโดย ' + session.fullName, session.fullName);

      logAudit_(session, 'SCORE_' + type.toUpperCase(), CONFIG.SHEET_NAMES.STUDENTS, studentId,
        'คะแนนเดิม: ' + oldScore, 'คะแนนใหม่: ' + newScore + ' (' + reason + ')');

      // แจ้งเตือนผู้ปกครองผ่าน LINE (ถ้าเชื่อมแล้ว) — ไม่กระทบการบันทึกหลักถ้า LINE error
      try {
        notifyScoreEvent_(studentId, type, amount, oldScore, newScore, reason, session.fullName, new Date());
      } catch (lineErr) {
        Logger.log('ส่ง LINE แจ้งเตือนคะแนนไม่สำเร็จ: ' + lineErr.message);
      }

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
        alertTriggered: alertTriggered,
        recordSequence: recordSequence
      };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    Logger.log('api_addScore_ error: ' + err.message);
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ กรุณาลองใหม่อีกครั้ง' };
  }
}

function api_getScoreHistory_(token, filters) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!session.permissions || !session.permissions.score) {
      return { success: false, message: 'คุณไม่มีสิทธิ์ดูประวัติคะแนน' };
    }

    filters = filters || {};
    const limit = filters.limit || 50;

    const logCached = getCachedSheetData_(CONFIG.SHEET_NAMES.SCORE_LOGS);
    let logs = logCached.rows.map(row => rowToObject_(logCached.headers, row));

    if (filters.studentId) {
      logs = logs.filter(l => sameId_(l.StudentID, filters.studentId));
    }

    logs.sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));
    logs = logs.slice(0, limit);

    // เติมชื่อนักเรียนให้แต่ละ log
    const studentCached = getCachedSheetData_(CONFIG.SHEET_NAMES.STUDENTS);
    const nameMap = {};
    studentCached.rows.forEach(row => {
      const obj = rowToObject_(studentCached.headers, row);
      nameMap[obj.StudentID] = (obj.Prefix || '') + (obj.FirstName || '') + ' ' + (obj.LastName || '');
    });

    logs.forEach(l => { l.StudentName = nameMap[l.StudentID] || l.StudentID; });

    return { success: true, logs: logs };
  } catch (err) {
    Logger.log('API error: ' + err.message);
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ กรุณาลองใหม่อีกครั้ง' };
  }
}

/**
 * ตรวจสอบว่า Sheet ScoreLogs มีคอลัมน์ EventTime แล้วหรือยัง
 * ถ้ายังไม่มี → เพิ่มคอลัมน์ถัดจาก EducationPhase (กันข้อมูลเดิมเลื่อน) + เขียนหัวคอลัมน์
 */
function ensureScoreLogEventTimeColumn_() {
  const sheet = getSheet(CONFIG.SHEET_NAMES.SCORE_LOGS);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.indexOf('EventTime') !== -1) return;
  const colPhase = headers.indexOf('EducationPhase'); // 0-based index
  let newColPos; // 1-based position ของคอลัมน์ใหม่ (ถัดจาก EducationPhase)
  if (colPhase !== -1) {
    sheet.insertColumnAfter(colPhase + 1);
    newColPos = colPhase + 2;
  } else {
    sheet.insertColumnAfter(headers.length);
    newColPos = headers.length + 1;
  }
  sheet.getRange(1, newColPos).setValue('EventTime')
    .setFontWeight('bold').setBackground('#152A52').setFontColor('#FFFFFF');
  Logger.log('ensureScoreLogEventTimeColumn_: เพิ่มคอลัมน์ EventTime แล้ว');
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
