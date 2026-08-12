// ============================================
// STUDENTSERVICE.GS - จัดการข้อมูลนักเรียน + ผู้ปกครอง
// ============================================

function api_getStudents_(token, filters) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

    const sheet = getSheet(CONFIG.SHEET_NAMES.STUDENTS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    let students = data.slice(1).map(row => rowToObject_(headers, row));

    if (filters) {
      const q = (filters.q || '').trim().toLowerCase();
      if (q) {
        students = students.filter(s =>
          (String(s.FirstName) + String(s.LastName) + String(s.StudentID) + String(s.CitizenID)).toLowerCase().includes(q)
        );
      }
      if (filters.grade) students = students.filter(s => s.Grade === filters.grade);
      if (filters.room) students = students.filter(s => s.Room === filters.room);
    }

    students.sort((a, b) => (String(a.Grade) + String(a.Room) + String(a.No)) > (String(b.Grade) + String(b.Room) + String(b.No)) ? 1 : -1);

    return { success: true, students: students.slice(0, 200), total: students.length };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

function api_getStudentDetail_(token, studentId) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

    const student = findStudentById_(studentId);
    if (!student) return { success: false, message: 'ไม่พบข้อมูลนักเรียน' };

    const parent = findParentByStudentId_(studentId);
    const timeline = getStudentTimeline_(studentId);
    const scoreSummary = getStudentScoreSummary_(studentId, student.CurrentScore);

    return { success: true, student, parent, timeline, scoreSummary };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

function api_addStudent_(token, payload) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!CONFIG.PERMISSIONS[session.role] || !CONFIG.PERMISSIONS[session.role].editDelete) {
      return { success: false, message: 'คุณไม่มีสิทธิ์เพิ่มข้อมูลนักเรียน' };
    }

    const required = ['studentId', 'firstName', 'lastName', 'citizenId', 'grade', 'room', 'no', 'dob'];
    const missing = required.filter(k => !payload[k] || String(payload[k]).trim() === '');
    if (missing.length > 0) {
      return { success: false, message: 'กรุณากรอกข้อมูลให้ครบ: ' + missing.join(', ') };
    }
    if (!/^\d{13}$/.test(String(payload.citizenId))) {
      return { success: false, message: 'เลขประจำตัวประชาชนต้องเป็นตัวเลข 13 หลัก' };
    }

    // รหัสนักเรียน: กรอกเองได้ (ไม่สร้างอัตโนมัติ) ต้องไม่ซ้ำกับรายการเดิมในระบบ
    const newId = String(payload.studentId).trim();
    if (!/^[A-Za-z0-9\-_./]+$/.test(newId)) {
      return { success: false, message: 'รหัสนักเรียนต้องเป็นตัวอักษร ตัวเลข หรือ - _ . / เท่านั้น' };
    }
    if (newId.length > 20) {
      return { success: false, message: 'รหัสนักเรียนยาวเกินไป (สูงสุด 20 ตัวอักษร)' };
    }
    if (findStudentById_(newId)) {
      return { success: false, message: 'รหัสนักเรียนนี้ถูกใช้งานแล้ว กรุณาใช้รหัสอื่น' };
    }

    const sheet = getSheet(CONFIG.SHEET_NAMES.STUDENTS);
    const recordSequence = getNextRecordSequence_('student');
    const now = new Date();
    const educationPhase = getEducationPhase_(payload.grade);

    sheet.appendRow([
      newId, payload.citizenId || '', payload.prefix || '', payload.firstName || '', payload.lastName || '',
      payload.gender || '', payload.grade || '', payload.room || '', payload.no || '',
      payload.dob || '', payload.weight || '', payload.height || '', payload.bloodType || '',
      payload.religion || '', payload.ethnicity || '', payload.nationality || '',
      payload.addressNo || '', payload.addressMoo || '', payload.addressRoad || '',
      payload.addressTambon || '', payload.addressAmphoe || '', payload.addressProvince || '',
      CONFIG.SCORE.INITIAL_SCORE, educationPhase, '', false,
      now, now
    ]);

    // บันทึกข้อมูลผู้ปกครอง
    const parentSheet = getSheet(CONFIG.SHEET_NAMES.PARENTS);
    parentSheet.appendRow([
      newId, payload.parentName || '', payload.parentRelation || '', payload.parentJob || '', payload.parentPhone || '',
      payload.fatherName || '', payload.fatherJob || '', payload.motherName || '', payload.motherJob || '', now
    ]);

    logAudit_(session, 'CREATE', CONFIG.SHEET_NAMES.STUDENTS, newId, '', 'เพิ่มนักเรียนใหม่: ' + payload.firstName + ' ' + payload.lastName);
    addTimelineEvent_(newId, 'create', 'เพิ่มข้อมูลนักเรียนเข้าระบบ', 'บันทึกโดย ' + session.fullName, session.fullName);

    return { success: true, studentId: newId, recordSequence: recordSequence };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

/**
 * นำเข้านักเรียนเป็นชุด (จาก Excel/CSV ที่ตรวจสอบฝั่ง client แล้ว)
 * - ตรวจสอบความถูกต้องทีละแถว และบันทึกเฉพาะแถวที่ผ่าน (batch setValues เพื่อความเร็ว)
 * - รหัสนักเรียนระบุเองในไฟล์ ต้องไม่ซ้ำกันในไฟล์และต้องไม่มีในระบบ
 */
function api_importStudents_(token, rows) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!CONFIG.PERMISSIONS[session.role] || !CONFIG.PERMISSIONS[session.role].editDelete) {
      return { success: false, message: 'คุณไม่มีสิทธิ์นำเข้านักเรียน' };
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return { success: false, message: 'ไม่มีข้อมูลนักเรียนให้นำเข้า' };
    }
    if (rows.length > 500) {
      return { success: false, message: 'นำเข้าได้ครั้งละไม่เกิน 500 คน' };
    }

    const studentsSheet = getSheet(CONFIG.SHEET_NAMES.STUDENTS);
    const parentsSheet = getSheet(CONFIG.SHEET_NAMES.PARENTS);
    const now = new Date();
    const seenIds = {}; // ป้องกันรหัสซ้ำภายในไฟล์เดียวกัน
    const validRows = [];
    const errors = [];

    rows.forEach((row, idx) => {
      const lineNo = idx + 2; // บรรทัดในไฟล์ (บรรทัด 1 = หัวคอลัมน์)
      try {
        row = row || {};
        const newId = String(row.studentId || '').trim();
        const missing = ['studentId', 'firstName', 'lastName', 'citizenId', 'grade', 'room', 'no', 'dob']
          .filter(k => !row[k] || String(row[k]).trim() === '');
        if (missing.length > 0) throw new Error('กรอกไม่ครบ: ' + missing.join(', '));
        if (!/^[A-Za-z0-9\-_./]+$/.test(newId)) throw new Error('รหัสนักเรียนมีอักขระไม่ถูกต้อง');
        if (newId.length > 20) throw new Error('รหัสนักเรียนยาวเกินไป');
        if (!/^\d{13}$/.test(String(row.citizenId).trim())) throw new Error('เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก');
        if (seenIds[newId]) throw new Error('รหัสนักเรียนซ้ำกันในไฟล์');
        if (findStudentById_(newId)) throw new Error('รหัสนักเรียนนี้ถูกใช้งานแล้ว');

        seenIds[newId] = true;
        validRows.push({
          studentId: newId,
          phase: getEducationPhase_(row.grade),
          firstName: String(row.firstName || '').trim(),
          lastName: String(row.lastName || '').trim(),
          parentName: String(row.parentName || '').trim(),
          parentPhone: String(row.parentPhone || '').trim(),
          row: row,
          lineNo: lineNo
        });
      } catch (e) {
        errors.push({
          line: lineNo,
          studentId: String((row || {}).studentId || '').trim() || '-',
          message: e.message
        });
      }
    });

    if (validRows.length > 0) {
      // --- เขียน Students แบบ batch ---
      const studentRows = validRows.map(v => {
        const p = v.row;
        return [
          v.studentId, String(p.citizenId || '').trim(), p.prefix || '', v.firstName, v.lastName,
          p.gender || '', p.grade || '', p.room || '', p.no || '',
          p.dob || '', p.weight || '', p.height || '', p.bloodType || '',
          p.religion || '', p.ethnicity || '', p.nationality || '',
          p.addressNo || '', p.addressMoo || '', p.addressRoad || '',
          p.addressTambon || '', p.addressAmphoe || '', p.addressProvince || '',
          CONFIG.SCORE.INITIAL_SCORE, v.phase, '', false, now, now
        ];
      });
      studentsSheet.getRange(studentsSheet.getLastRow() + 1, 1, studentRows.length, studentRows[0].length)
        .setValues(studentRows);

      // --- เขียน Parents แบบ batch (เฉพาะแถวที่มีข้อมูลผู้ปกครอง) ---
      const parentRows = validRows
        .filter(v => v.parentName || v.parentPhone)
        .map(v => {
          const p = v.row;
          return [
            v.studentId, p.parentName || '', p.parentRelation || '', p.parentJob || '', p.parentPhone || '',
            p.fatherName || '', p.fatherJob || '', p.motherName || '', p.motherJob || '', now
          ];
        });
      if (parentRows.length > 0) {
        parentsSheet.getRange(parentsSheet.getLastRow() + 1, 1, parentRows.length, parentRows[0].length)
          .setValues(parentRows);
      }

      // --- เขียน Timeline แบบ batch ---
      const tlRows = validRows.map(v => [
        Utilities.getUuid(), v.studentId, 'create',
        'เพิ่มข้อมูลนักเรียนเข้าระบบ (นำเข้าชุด)', 'นำเข้าโดย ' + session.fullName, session.fullName, now
      ]);
      const tlSheet = getSheet(CONFIG.SHEET_NAMES.TIMELINE);
      tlSheet.getRange(tlSheet.getLastRow() + 1, 1, tlRows.length, tlRows[0].length).setValues(tlRows);

      logAudit_(session, 'CREATE', CONFIG.SHEET_NAMES.STUDENTS, '', '',
        'นำเข้านักเรียนเป็นชุด: สำเร็จ ' + validRows.length + ' คน, ข้าม ' + errors.length + ' รายการ');
    }

    return {
      success: true,
      imported: validRows.length,
      failed: errors.length,
      errors: errors.slice(0, 50)
    };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

function api_updateStudent_(token, studentId, payload) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!CONFIG.PERMISSIONS[session.role] || !CONFIG.PERMISSIONS[session.role].editDelete) {
      return { success: false, message: 'คุณไม่มีสิทธิ์แก้ไขข้อมูลนี้' };
    }

    // --- อัปเดต Students sheet ---
    const sheet = getSheet(CONFIG.SHEET_NAMES.STUDENTS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colId = headers.indexOf('StudentID');
    let found = false;

    // Map payload keys → Students column names
    const studentFieldMap = {
      prefix: 'Prefix', firstName: 'FirstName', lastName: 'LastName', gender: 'Gender',
      grade: 'Grade', room: 'Room', no: 'No', citizenId: 'CitizenID', dob: 'DOB',
      bloodType: 'BloodType', weight: 'Weight', height: 'Height',
      nationality: 'Nationality', religion: 'Religion', ethnicity: 'Ethnicity',
      addressNo: 'Address_No', addressMoo: 'Address_Moo', addressRoad: 'Address_Road',
      addressTambon: 'Address_Tambon', addressAmphoe: 'Address_Amphoe', addressProvince: 'Address_Province'
    };

    for (let i = 1; i < data.length; i++) {
      if (data[i][colId] === studentId) {
        const before = JSON.stringify(rowToObject_(headers, data[i]));
        Object.keys(studentFieldMap).forEach(key => {
          if (payload[key] !== undefined) {
            const col = headers.indexOf(studentFieldMap[key]);
            if (col !== -1) sheet.getRange(i + 1, col + 1).setValue(payload[key]);
          }
        });
        // อัปเดต EducationPhase ตามระดับชั้นใหม่
        if (payload.grade) {
          const phaseCol = headers.indexOf('EducationPhase');
          if (phaseCol !== -1) sheet.getRange(i + 1, phaseCol + 1).setValue(getEducationPhase_(payload.grade));
        }
        sheet.getRange(i + 1, headers.indexOf('UpdatedAt') + 1).setValue(new Date());
        found = true;

        logAudit_(session, 'UPDATE', CONFIG.SHEET_NAMES.STUDENTS, studentId, before, JSON.stringify(payload));
        break;
      }
    }
    if (!found) return { success: false, message: 'ไม่พบนักเรียน' };

    // --- อัปเดต Parents sheet ---
    const parentFieldMap = {
      parentName: 'ParentName', parentRelation: 'ParentRelation', parentJob: 'ParentJob',
      parentPhone: 'ParentPhone', fatherName: 'FatherName', fatherJob: 'FatherJob',
      motherName: 'MotherName', motherJob: 'MotherJob'
    };
    const hasParentData = Object.keys(parentFieldMap).some(k => payload[k] !== undefined);

    if (hasParentData) {
      const pSheet = getSheet(CONFIG.SHEET_NAMES.PARENTS);
      const pData = pSheet.getDataRange().getValues();
      const pHeaders = pData[0];
      const pColId = pHeaders.indexOf('StudentID');
      let parentFound = false;

      for (let i = 1; i < pData.length; i++) {
        if (pData[i][pColId] === studentId) {
          Object.keys(parentFieldMap).forEach(key => {
            if (payload[key] !== undefined) {
              const col = pHeaders.indexOf(parentFieldMap[key]);
              if (col !== -1) pSheet.getRange(i + 1, col + 1).setValue(payload[key]);
            }
          });
          pSheet.getRange(i + 1, pHeaders.indexOf('UpdatedAt') + 1).setValue(new Date());
          parentFound = true;
          break;
        }
      }

      // ถ้าไม่มีแถวผู้ปกครอง → สร้างใหม่
      if (!parentFound) {
        pSheet.appendRow([
          studentId,
          payload.parentName || '', payload.parentRelation || '', payload.parentJob || '', payload.parentPhone || '',
          payload.fatherName || '', payload.fatherJob || '', payload.motherName || '', payload.motherJob || '',
          new Date()
        ]);
      }
    }

    return { success: true };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

function api_deleteStudent_(token, studentId) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!CONFIG.PERMISSIONS[session.role] || !CONFIG.PERMISSIONS[session.role].editDelete) {
      return { success: false, message: 'คุณไม่มีสิทธิ์ลบข้อมูลนี้' };
    }

    const sheet = getSheet(CONFIG.SHEET_NAMES.STUDENTS);
    const data = sheet.getDataRange().getValues();
    const colId = data[0].indexOf('StudentID');

    for (let i = 1; i < data.length; i++) {
      if (data[i][colId] === studentId) {
        const before = JSON.stringify(rowToObject_(data[0], data[i]));
        sheet.deleteRow(i + 1);

        // ลบ orphaned records ที่เกี่ยวข้อง
        deleteRelatedRows_(CONFIG.SHEET_NAMES.PARENTS, studentId);
        deleteRelatedRows_(CONFIG.SHEET_NAMES.TIMELINE, studentId);
        deleteRelatedRows_(CONFIG.SHEET_NAMES.LINE_BINDINGS, studentId);

        logAudit_(session, 'DELETE', CONFIG.SHEET_NAMES.STUDENTS, studentId, before, '');
        return { success: true };
      }
    }
    return { success: false, message: 'ไม่พบนักเรียน' };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

/**
 * ดึงข้อมูลสรุปสำหรับ Dashboard (ข้อมูลจริงจาก Sheet)
 */
function api_getDashboardSummary_(token) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

    const studSheet = getSheet(CONFIG.SHEET_NAMES.STUDENTS);
    const studData = studSheet.getDataRange().getValues();
    const studHeaders = studData[0];
    const students = studData.slice(1);

    const totalStudents = students.length;

    // นักเรียนคะแนน < 70 (กลุ่มเสี่ยง)
    const colScore = studHeaders.indexOf('CurrentScore');
    const atRisk = students.filter(r => Number(r[colScore]) < 70).length;

    // นักเรียนที่เชื่อม LINE แล้ว
    const colLine = studHeaders.indexOf('LineLinked');
    const lineLinked = students.filter(r => r[colLine] === true).length;

    // เหตุการณ์วันนี้จาก Timeline
    const tlSheet = getSheet(CONFIG.SHEET_NAMES.TIMELINE);
    const tlData = tlSheet.getDataRange().getValues();
    const tlHeaders = tlData[0];
    const colTs = tlHeaders.indexOf('Timestamp');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEvents = tlData.slice(1).filter(r => {
      const ts = r[colTs];
      if (ts instanceof Date) {
        const d = new Date(ts);
        d.setHours(0, 0, 0, 0);
        return d.getTime() === today.getTime();
      }
      return false;
    }).length;

    // 5 เหตุการณ์ล่าสุดจาก Timeline (สำหรับแสดงในหน้า Dashboard)
    const recentEvents = tlData.slice(1)
      .map(row => rowToObject_(tlHeaders, row))
      .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
      .slice(0, 5);

    return {
      success: true,
      summary: { totalStudents, atRisk, lineLinked, todayEvents },
      recentTimeline: recentEvents
    };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

/* ============ Helper Functions ============ */

function rowToObject_(headers, row) {
  const obj = {};
  headers.forEach((h, i) => {
    let val = row[i];
    if (val instanceof Date) {
      val = val.toISOString();
    } else if (val === undefined) {
      val = '';
    } else if (typeof val === 'number' && isNaN(val)) {
      val = '';
    }
    obj[h] = val;
  });
  return obj;
}

function findStudentById_(studentId) {
  const sheet = getSheet(CONFIG.SHEET_NAMES.STUDENTS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colId = headers.indexOf('StudentID');
  for (let i = 1; i < data.length; i++) {
    if (data[i][colId] === studentId) return rowToObject_(headers, data[i]);
  }
  return null;
}

function findParentByStudentId_(studentId) {
  const sheet = getSheet(CONFIG.SHEET_NAMES.PARENTS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colId = headers.indexOf('StudentID');
  for (let i = 1; i < data.length; i++) {
    if (data[i][colId] === studentId) return rowToObject_(headers, data[i]);
  }
  return null;
}

/**
 * สรุปคะแนนความประพฤติของนักเรียนสำหรับหน้าโปรไฟล์
 * - initialScore : คะแนนเริ่มต้น (ตาม Config)
 * - totalDeducted: คะแนนที่หักสุทธิ (หักลบกับคะแนนที่เพิ่มแล้ว) ไม่ต่ำกว่า 0
 * - deductedCount: จำนวนครั้งที่ถูกหักคะแนน (ใช้ตัดสิน "ไม่มีประวัติการหักคะแนน")
 * - currentScore : คะแนนคงเหลือปัจจุบัน
 */
function getStudentScoreSummary_(studentId, currentScore) {
  const logSheet = getSheet(CONFIG.SHEET_NAMES.SCORE_LOGS);
  const data = logSheet.getDataRange().getValues();
  const headers = data[0];
  const colId = headers.indexOf('StudentID');
  const colType = headers.indexOf('Type');
  const colAmount = headers.indexOf('Amount');

  let totalDeducted = 0;
  let deductedCount = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i][colId] !== studentId) continue;
    const type = data[i][colType];
    const amount = Number(data[i][colAmount]) || 0;
    if (type === 'deduct') {
      totalDeducted += amount;
      deductedCount++;
    } else if (type === 'add') {
      totalDeducted -= amount;
    }
  }
  totalDeducted = Math.max(0, totalDeducted);

  return {
    initialScore: Number(CONFIG.SCORE.INITIAL_SCORE) || 100,
    totalDeducted: totalDeducted,
    deductedCount: deductedCount,
    currentScore: Number(currentScore) || 0
  };
}


function getEducationPhase_(grade) {
  if (['ม.1', 'ม.2', 'ม.3'].indexOf(grade) !== -1) return 'ม.ต้น';
  if (['ม.4', 'ม.5', 'ม.6'].indexOf(grade) !== -1) return 'ม.ปลาย';
  return '';
}

function logAudit_(session, action, targetSheet, targetId, before, after) {
  const sheet = getSheet(CONFIG.SHEET_NAMES.AUDIT_LOG);
  sheet.appendRow([
    Utilities.getUuid(), session.userId, session.fullName, action,
    targetSheet, targetId, before, after, new Date()
  ]);
}

function addTimelineEvent_(studentId, eventType, title, description, recordedBy) {
  const sheet = getSheet(CONFIG.SHEET_NAMES.TIMELINE);
  sheet.appendRow([
    Utilities.getUuid(), studentId, eventType, title, description, recordedBy, new Date()
  ]);
}

/**
 * ออกเลขลำดับสำหรับข้อความยืนยันหลังบันทึก
 * แยกตามปีการศึกษาและประเภทงาน โดยไม่กระทบ UUID หรือเลขหนังสือราชการเดิม
 *
 * หลักการ:
 * - เก็บตัวนับไว้ใน Script Properties (ค่าระบบภายใน) ไม่แก้โครงสร้างชีต
 * - ใช้ LockService ป้องกันเลขซ้ำเมื่อมีคนบันทึกพร้อมกัน
 * - คีย์ตัวนับผูกกับปีการศึกษาปัจจุบัน (CURRENT_ACADEMIC_YEAR)
 *   เมื่อขึ้นปีการศึกษาใหม่จะเริ่มนับใหม่โดยอัตโนมัติ
 * - ครั้งแรกของแต่ละปี: นับจากจำนวนรายการที่บันทึกจริงในปีนั้น ๆ
 *   เพื่อต่อเลขกับข้อมูลเดิมโดยไม่ซ้ำกัน
 */
function getNextRecordSequence_(recordType) {
  const validTypes = ['student', 'score', 'leave', 'letter'];
  if (validTypes.indexOf(recordType) === -1) {
    throw new Error('ประเภทรายการสำหรับออกเลขลำดับไม่ถูกต้อง');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const academicYear = String(getConfigValue_('CURRENT_ACADEMIC_YEAR') || '2569');
    const propertyKey = 'RECORD_SEQUENCE_' + academicYear + '_' + recordType.toUpperCase();
    const properties = PropertiesService.getScriptProperties();
    let lastSequence = Number(properties.getProperty(propertyKey));

    // ยังไม่เคยออกเลขในปีการศึกษานี้: นับรายการที่ถูกบันทึกในปีการศึกษาปัจจุบัน
    // (ใช้ช่วงภาคเรียนจาก Config ถ้ากำหนดไว้; ไม่มี → นับทั้งชีตเป็นค่าปลอดภัย)
    if (!lastSequence) {
      const sheetByType = {
        student: CONFIG.SHEET_NAMES.STUDENTS,
        score: CONFIG.SHEET_NAMES.SCORE_LOGS,
        leave: CONFIG.SHEET_NAMES.LEAVE_REQUESTS,
        letter: CONFIG.SHEET_NAMES.INVITATION_LETTERS
      };
      lastSequence = countRecordsInAcademicYear_(sheetByType[recordType]);
    }

    const nextSequence = lastSequence + 1;
    properties.setProperty(propertyKey, String(nextSequence));
    return nextSequence;
  } finally {
    lock.releaseLock();
  }
}

/**
 * นับจำนวนรายการที่ถูกบันทึกภายในปีการศึกษาปัจจุบัน
 * (อิงช่วงวัน SEMESTER_1_START → SEMESTER_2_END จาก Sheet Config)
 * ถ้าไม่ได้กำหนดช่วงภาคเรียนไว้ ให้ใช้จำนวนแถวข้อมูลทั้งหมดในชีตแทน
 */
function countRecordsInAcademicYear_(sheetName) {
  try {
    const sheet = getSheet(sheetName);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    const start = parseConfigDate_(getConfigValue_('SEMESTER_1_START'), false);
    const end = parseConfigDate_(getConfigValue_('SEMESTER_2_END'), true);
    if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
      return Math.max(0, data.length - 1);
    }

    // คอลัมน์เวลา: ScoreLogs ใช้ Timestamp ส่วนชีตอื่นใช้ CreatedAt
    const col = headers.indexOf('CreatedAt') !== -1 ? headers.indexOf('CreatedAt')
      : headers.indexOf('Timestamp');
    if (col === -1) return Math.max(0, data.length - 1);

    let count = 0;
    for (let i = 1; i < data.length; i++) {
      const ts = data[i][col];
      if (ts instanceof Date && ts.getTime() >= start.getTime() && ts.getTime() <= end.getTime()) {
        count++;
      }
    }
    return count;
  } catch (e) {
    try {
      return Math.max(0, getSheet(sheetName).getLastRow() - 1);
    } catch (e2) {
      return 0;
    }
  }
}

function getStudentTimeline_(studentId) {
  const sheet = getSheet(CONFIG.SHEET_NAMES.TIMELINE);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colId = headers.indexOf('StudentID');
  const events = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][colId] === studentId) events.push(rowToObject_(headers, data[i]));
  }
  events.sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));
  return events;
}

/**
 * ลบแถวทั้งหมดที่เกี่ยวข้องกับ StudentID ออกจาก Sheet ที่ระบุ
 * ลบจากล่างขึ้นบน เพื่อไม่ให้ row index เลื่อน
 */
function deleteRelatedRows_(sheetName, studentId) {
  try {
    const sheet = getSheet(sheetName);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colId = headers.indexOf('StudentID');
    if (colId === -1) return;

    // วน reverse เพื่อลบจากล่างขึ้นบน
    for (let i = data.length - 1; i >= 1; i--) {
      if (data[i][colId] === studentId) {
        sheet.deleteRow(i + 1);
      }
    }
  } catch (e) {
    // ถ้า sheet ไม่มีก็ข้ามไป
  }
}

// ============================================
// Public Functions (สำหรับ google.script.run)
// ============================================

function apiGetStudents(token, filters) {
  return api_getStudents_(token, filters);
}

function apiGetStudentDetail(token, studentId) {
  return api_getStudentDetail_(token, studentId);
}

function apiAddStudent(token, payload) {
  return api_addStudent_(token, payload);
}

function apiImportStudents(token, rows) {
  return api_importStudents_(token, rows);
}

function apiUpdateStudent(token, studentId, payload) {
  return api_updateStudent_(token, studentId, payload);
}

function apiDeleteStudent(token, studentId) {
  return api_deleteStudent_(token, studentId);
}

function apiGetDashboardSummary(token) {
  return api_getDashboardSummary_(token);
}
/**
 * อัปโหลดรูปนักเรียน (รับ Base64 จาก client ที่บีบอัดมาแล้ว) เข้า Drive
 * และอัปเดต PhotoFileID ใน Sheet Students
 */
function api_uploadStudentPhoto_(token, studentId, base64Data, mimeType, fileExt) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!CONFIG.PERMISSIONS[session.role] || !CONFIG.PERMISSIONS[session.role].editDelete) {
      return { success: false, message: 'คุณไม่มีสิทธิ์อัปโหลดรูปภาพ' };
    }

    const student = findStudentById_(studentId);
    if (!student) return { success: false, message: 'ไม่พบข้อมูลนักเรียน' };

    if (!/^(image\/jpeg|image\/png)$/.test(mimeType)) {
      return { success: false, message: 'รองรับเฉพาะไฟล์ .jpg หรือ .png เท่านั้น' };
    }

    // ตรวจขนาดไฟล์หลังบีบอัด (ไม่ควรเกิน 1MB ตามที่กำหนด, เผื่อไว้ 1.2MB กันพลาด)
    const sizeBytes = Math.ceil(base64Data.length * 3 / 4);
    if (sizeBytes > 1.2 * 1024 * 1024) {
      return { success: false, message: 'ไฟล์รูปมีขนาดใหญ่เกินไปแม้บีบอัดแล้ว กรุณาลองรูปอื่น' };
    }

    const folder = getStudentPhotoFolder_(student.Grade, student.Room);
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, studentId + '.' + fileExt);

    // ลบรูปเก่าถ้ามี (แทนที่รูปใหม่ ไม่ใช่ซ้อนไฟล์เก่าค้างไว้)
    if (student.PhotoFileID) {
      try { DriveApp.getFileById(student.PhotoFileID).setTrashed(true); } catch (e) { /* ไฟล์เก่าอาจถูกลบไปแล้ว ข้ามได้ */ }
    }

    const photoFile = folder.createFile(blob);
    photoFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const sheet = getSheet(CONFIG.SHEET_NAMES.STUDENTS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colId = headers.indexOf('StudentID');
    const colPhoto = headers.indexOf('PhotoFileID');

    for (let i = 1; i < data.length; i++) {
      if (data[i][colId] === studentId) {
        sheet.getRange(i + 1, colPhoto + 1).setValue(photoFile.getId());
        sheet.getRange(i + 1, headers.indexOf('UpdatedAt') + 1).setValue(new Date());
        break;
      }
    }

    logAudit_(session, 'UPDATE', CONFIG.SHEET_NAMES.STUDENTS, studentId, '', 'อัปโหลดรูปนักเรียนใหม่');

    return { success: true, photoFileId: photoFile.getId(), photoUrl: 'https://drive.google.com/thumbnail?id=' + photoFile.getId() + '&sz=w400' };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

// ============================================
// Public Function (สำหรับ google.script.run)
// ============================================
function apiUploadStudentPhoto(token, studentId, base64Data, mimeType, fileExt) {
  return api_uploadStudentPhoto_(token, studentId, base64Data, mimeType, fileExt);
}
