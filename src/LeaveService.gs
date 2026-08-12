// ============================================
// LEAVESERVICE.GS - จัดการคำร้องขออนุญาตออกนอกโรงเรียน
// ============================================

function api_createLeaveRequest_(token, payload) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!CONFIG.PERMISSIONS[session.role] || !CONFIG.PERMISSIONS[session.role].score) {
      return { success: false, message: 'คุณไม่มีสิทธิ์สร้างคำร้อง' };
    }

    const studentId = payload.studentId;
    const reason = (payload.reason || '').trim();
    const outTime = (payload.outTime || '').trim();
    const inTime = (payload.inTime || '').trim();

    if (!studentId) return { success: false, message: 'กรุณาเลือกนักเรียน' };
    if (!reason) return { success: false, message: 'กรุณาระบุเหตุผล' };
    if (!outTime || !inTime) return { success: false, message: 'กรุณาระบุเวลาที่ขอออกและขอกลับ' };

    const student = findStudentById_(studentId);
    if (!student) return { success: false, message: 'ไม่พบข้อมูลนักเรียน' };

   const sheet = getSheet(CONFIG.SHEET_NAMES.LEAVE_REQUESTS);
    const requestId = Utilities.getUuid();
    const recordSequence = getNextRecordSequence_('leave');
    const now = new Date();
    const nextRow = sheet.getLastRow() + 1;

    // บังคับให้คอลัมน์เวลา (D=RequestedOutTime, E=RequestedInTime) เป็น Plain Text
    // ป้องกัน Google Sheet ตีความ "11:00" เป็นวันที่อัตโนมัติ
    sheet.getRange(nextRow, 4, 1, 2).setNumberFormat('@');

    sheet.appendRow([
      requestId, studentId, reason, outTime, inTime,
      'pending', '', '', '',
      '', '', now, now
    ]);

    const studentName = (student.Prefix || '') + (student.FirstName || '') + ' ' + (student.LastName || '');
    addTimelineEvent_(studentId, 'leave',
      'ยื่นคำร้องขออนุญาตออกนอกโรงเรียน: ' + reason,
      'ขอออก ' + outTime + ' · ขอกลับ ' + inTime + ' · บันทึกโดย ' + session.fullName,
      session.fullName);

    logAudit_(session, 'CREATE', CONFIG.SHEET_NAMES.LEAVE_REQUESTS, requestId, '', 'สร้างคำร้อง: ' + studentName + ' - ' + reason);

    return { success: true, requestId: requestId, recordSequence: recordSequence };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

function api_getLeaveRequests_(token, filters) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

    filters = filters || {};
    const sheet = getSheet(CONFIG.SHEET_NAMES.LEAVE_REQUESTS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    let requests = data.slice(1).map(row => rowToObject_(headers, row));

    if (filters.status && filters.status !== 'all') {
      requests = requests.filter(r => r.Status === filters.status);
    }

    requests.sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt));

    // เติมชื่อ/ชั้นเรียนนักเรียนให้แต่ละคำร้อง
    const studentSheet = getSheet(CONFIG.SHEET_NAMES.STUDENTS);
    const studentData = studentSheet.getDataRange().getValues();
    const studentHeaders = studentData[0];
    const studentMap = {};
    studentData.slice(1).forEach(row => {
      const obj = rowToObject_(studentHeaders, row);
      studentMap[obj.StudentID] = obj;
    });

    requests.forEach(r => {
      const st = studentMap[r.StudentID];
      r.StudentName = st ? (st.Prefix || '') + (st.FirstName || '') + ' ' + (st.LastName || '') : r.StudentID;
      r.StudentClass = st ? (st.Grade + '/' + st.Room) : '-';
    });

    const colStatus = headers.indexOf('Status');
    const allRows = data.slice(1);
    const pendingCount = allRows.filter(row => row[colStatus] === 'pending').length;
    const approvedCount = allRows.filter(row => row[colStatus] === 'approved').length;
    const rejectedCount = allRows.filter(row => row[colStatus] === 'rejected').length;
    const totalCount = allRows.length;

    return {
      success: true, requests: requests,
      pendingCount: pendingCount, approvedCount: approvedCount,
      rejectedCount: rejectedCount, totalCount: totalCount
    };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

function api_updateLeaveStatus_(token, requestId, status, approvalReason) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!CONFIG.PERMISSIONS[session.role] || !CONFIG.PERMISSIONS[session.role].approveLeave) {
      return { success: false, message: 'คุณไม่มีสิทธิ์อนุมัติคำร้อง' };
    }
    if (!['approved', 'rejected'].includes(status)) {
      return { success: false, message: 'สถานะไม่ถูกต้อง' };
    }

    const sheet = getSheet(CONFIG.SHEET_NAMES.LEAVE_REQUESTS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colId = headers.indexOf('RequestID');

    for (let i = 1; i < data.length; i++) {
      if (data[i][colId] === requestId) {
        const rowObj = rowToObject_(headers, data[i]);
        if (rowObj.Status !== 'pending') {
          return { success: false, message: 'คำร้องนี้ถูกดำเนินการไปแล้ว' };
        }

        sheet.getRange(i + 1, headers.indexOf('Status') + 1).setValue(status);
        sheet.getRange(i + 1, headers.indexOf('ApprovedBy') + 1).setValue(session.userId);
        sheet.getRange(i + 1, headers.indexOf('ApprovedByName') + 1).setValue(session.fullName);
        sheet.getRange(i + 1, headers.indexOf('ApprovalReason') + 1).setValue(approvalReason || '');
        sheet.getRange(i + 1, headers.indexOf('UpdatedAt') + 1).setValue(new Date());

        const studentId = rowObj.StudentID;
        const statusText = status === 'approved' ? 'อนุมัติ' : 'ไม่อนุมัติ';
        addTimelineEvent_(studentId, 'leave',
          'คำร้องออกนอกโรงเรียนได้รับการ' + statusText,
          (approvalReason ? 'เหตุผล: ' + approvalReason + ' · ' : '') + 'ดำเนินการโดย ' + session.fullName,
          session.fullName);

        logAudit_(session, 'UPDATE_STATUS', CONFIG.SHEET_NAMES.LEAVE_REQUESTS, requestId, 'pending', status);

        return { success: true };
      }
    }
    return { success: false, message: 'ไม่พบคำร้องนี้' };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

// ============================================
// Public Functions (สำหรับ google.script.run)
// ============================================
function apiCreateLeaveRequest(token, payload) {
  return api_createLeaveRequest_(token, payload);
}
function apiGetLeaveRequests(token, filters) {
  return api_getLeaveRequests_(token, filters);
}
function apiUpdateLeaveStatus(token, requestId, status, approvalReason) {
  return api_updateLeaveStatus_(token, requestId, status, approvalReason);
}
/**
 * MIGRATION: รันครั้งเดียวเพื่อแก้ไขข้อมูลเวลาที่เพี้ยนจากบั๊กเดิม
 * วิธีใช้: เปิด Apps Script Editor -> เลือกฟังก์ชัน fixLeaveTimeFormat -> กด Run
 */
function fixLeaveTimeFormat() {
  const sheet = getSheet(CONFIG.SHEET_NAMES.LEAVE_REQUESTS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('ไม่มีข้อมูลให้แก้ไข');
    return;
  }

  // ตั้ง format คอลัมน์ D,E (RequestedOutTime, RequestedInTime) เป็น Plain Text ทั้งคอลัมน์
  sheet.getRange(2, 4, lastRow - 1, 2).setNumberFormat('@');

  const data = sheet.getRange(2, 4, lastRow - 1, 2).getValues();
  const fixed = data.map(row => row.map(cell => {
    if (cell instanceof Date) {
      // แปลง Date object ที่เพี้ยนกลับเป็น HH:mm โดยอิงจากเวลาที่เก็บไว้ (UTC)
      const h = String(cell.getUTCHours()).padStart(2, '0');
      const m = String(cell.getUTCMinutes()).padStart(2, '0');
      return h + ':' + m;
    }
    return cell; // ถ้าเป็น string อยู่แล้วไม่ต้องแก้
  }));

  sheet.getRange(2, 4, lastRow - 1, 2).setValues(fixed);
  SpreadsheetApp.getUi().alert('แก้ไขรูปแบบเวลาเรียบร้อยแล้ว จำนวน ' + (lastRow - 1) + ' แถว');
}
