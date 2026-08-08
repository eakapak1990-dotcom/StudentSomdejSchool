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

    return { success: true, student, parent, timeline };
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

    const required = ['firstName', 'lastName', 'citizenId', 'grade', 'room', 'no', 'dob'];
    const missing = required.filter(k => !payload[k] || String(payload[k]).trim() === '');
    if (missing.length > 0) {
      return { success: false, message: 'กรุณากรอกข้อมูลให้ครบ: ' + missing.join(', ') };
    }
    if (!/^\d{13}$/.test(String(payload.citizenId))) {
      return { success: false, message: 'เลขประจำตัวประชาชนต้องเป็นตัวเลข 13 หลัก' };
    }

    const sheet = getSheet(CONFIG.SHEET_NAMES.STUDENTS);
    const newId = generateStudentId_();
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

    return { success: true, studentId: newId };
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

    const sheet = getSheet(CONFIG.SHEET_NAMES.STUDENTS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colId = headers.indexOf('StudentID');

    for (let i = 1; i < data.length; i++) {
      if (data[i][colId] === studentId) {
        const before = JSON.stringify(rowToObject_(headers, data[i]));
        Object.keys(payload).forEach(key => {
          const col = headers.indexOf(key);
          if (col !== -1) sheet.getRange(i + 1, col + 1).setValue(payload[key]);
        });
        sheet.getRange(i + 1, headers.indexOf('UpdatedAt') + 1).setValue(new Date());

        logAudit_(session, 'UPDATE', CONFIG.SHEET_NAMES.STUDENTS, studentId, before, JSON.stringify(payload));
        return { success: true };
      }
    }
    return { success: false, message: 'ไม่พบนักเรียน' };
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
        logAudit_(session, 'DELETE', CONFIG.SHEET_NAMES.STUDENTS, studentId, before, '');
        return { success: true };
      }
    }
    return { success: false, message: 'ไม่พบนักเรียน' };
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
 * สร้าง StudentID ใหม่ โดยสแกนหาเลขสูงสุดที่มีอยู่จริงในชีท
 * (ไม่ใช้ getLastRow() เพราะถ้ามีการลบแถวออก จะทำให้ได้เลขซ้ำกับของเดิม)
 */
function generateStudentId_() {
  const sheet = getSheet(CONFIG.SHEET_NAMES.STUDENTS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colId = headers.indexOf('StudentID');

  let maxNum = 10000;
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][colId] || '');
    const num = parseInt(id.replace('STD', ''), 10);
    if (!isNaN(num) && num > maxNum) maxNum = num;
  }
  return 'STD' + String(maxNum + 1).padStart(5, '0');
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

function apiUpdateStudent(token, studentId, payload) {
  return api_updateStudent_(token, studentId, payload);
}

function apiDeleteStudent(token, studentId) {
  return api_deleteStudent_(token, studentId);
}