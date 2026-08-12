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

/**
 * ออกเลขลำดับสำหรับข้อความยืนยันหลังบันทึก
 * แยกตามปีการศึกษาและประเภทงาน โดยไม่กระทบ UUID หรือเลขหนังสือราชการเดิม
 */
function getNextRecordSequence_(recordType) {
  const validTypes = ['score', 'leave', 'letter'];
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

    // เปิดใช้ครั้งแรก: เริ่มต่อจากจำนวนข้อมูลเดิมในชีต เพื่อไม่ให้เลขซ้ำกับรายการเก่า
    if (!lastSequence) {
      const sheetByType = {
        score: CONFIG.SHEET_NAMES.SCORE_LOGS,
        leave: CONFIG.SHEET_NAMES.LEAVE_REQUESTS,
        letter: CONFIG.SHEET_NAMES.INVITATION_LETTERS
      };
      lastSequence = Math.max(0, getSheet(sheetByType[recordType]).getLastRow() - 1);
    }

    const nextSequence = lastSequence + 1;
    properties.setProperty(propertyKey, String(nextSequence));
    return nextSequence;
  } finally {
    lock.releaseLock();
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
