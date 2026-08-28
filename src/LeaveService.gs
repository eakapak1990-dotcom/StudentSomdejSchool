// ============================================
// LEAVESERVICE.GS - จัดการคำร้องขออนุญาตออกนอกโรงเรียน
// ============================================

function api_createLeaveRequest_(token, payload) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!session.permissions || !session.permissions.score) {
      return { success: false, message: 'คุณไม่มีสิทธิ์สร้างคำร้อง' };
    }

    const studentId = payload.studentId;
    const reason = (payload.reason || '').trim();
    const leaveDate = (payload.leaveDate || '').trim();
    const outTime = (payload.outTime || '').trim();
    const inTime = (payload.inTime || '').trim();

    if (!studentId) return { success: false, message: 'กรุณาเลือกนักเรียน' };
    if (!reason) return { success: false, message: 'กรุณาระบุเหตุผล' };
    if (!leaveDate || !outTime || !inTime) return { success: false, message: 'กรุณาระบุวันที่และเวลาที่ขอออก/ขอกลับ' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(leaveDate)) return { success: false, message: 'รูปแบบวันที่ไม่ถูกต้อง' };

    const student = findStudentById_(studentId);
    if (!student) return { success: false, message: 'ไม่พบข้อมูลนักเรียน' };

   const sheet = getSheet(CONFIG.SHEET_NAMES.LEAVE_REQUESTS);
    ensureLeaveRequestDateColumn_();
    const requestId = Utilities.getUuid();
    const recordSequence = getNextRecordSequence_('leave');
    const now = new Date();
    const nextRow = sheet.getLastRow() + 1;

    // บังคับให้คอลัมน์วันที่/เวลา (D=RequestedOutTime, E=RequestedInTime, F=RequestedDate) เป็น Plain Text
    // ป้องกัน Google Sheet ตีความ "11:00" เป็นวันที่อัตโนมัติ (1899-12-30 ...)
    sheet.getRange(nextRow, 4, 1, 3).setNumberFormat('@');

    sheet.appendRow([
      requestId, studentId, reason, outTime, inTime, leaveDate,
      'pending', '', '', '',
      '', '', now, now
    ]);
    sheet.getRange(nextRow, 4, 1, 3).setNumberFormat('@');
    sheet.getRange(nextRow, 4, 1, 3).setValues([[outTime, inTime, leaveDate]]);

    const studentName = (student.Prefix || '') + (student.FirstName || '') + ' ' + (student.LastName || '');
    addTimelineEvent_(studentId, 'leave',
      'ยื่นคำร้องขออนุญาตออกนอกโรงเรียน: ' + reason,
      'วันที่ ' + leaveDate + ' · ขอออก ' + outTime + ' · ขอกลับ ' + inTime + ' · บันทึกโดย ' + session.fullName,
      session.fullName);

    logAudit_(session, 'CREATE', CONFIG.SHEET_NAMES.LEAVE_REQUESTS, requestId, '', 'สร้างคำร้อง: ' + studentName + ' - ' + reason);

    return { success: true, requestId: requestId, recordSequence: recordSequence };
  } catch (err) {
    Logger.log('API error: ' + err.message);
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ กรุณาลองใหม่อีกครั้ง' };
  }
}

function api_getLeaveRequests_(token, filters) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!session.permissions || !session.permissions.approveLeave) {
      return { success: false, message: 'คุณไม่มีสิทธิ์ดูรายการคำร้อง' };
    }

    filters = filters || {};
    const cached = getCachedSheetData_(CONFIG.SHEET_NAMES.LEAVE_REQUESTS);
    const headers = cached.headers;
    let requests = cached.rows.map(row => rowToObject_(headers, row));

    if (filters.status && filters.status !== 'all') {
      requests = requests.filter(r => r.Status === filters.status);
    }

    requests.sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt));

    // เติมชื่อ/ชั้นเรียนนักเรียนให้แต่ละคำร้อง
    const studentCached = getCachedSheetData_(CONFIG.SHEET_NAMES.STUDENTS);
    const studentHeaders = studentCached.headers;
    const studentMap = {};
    studentCached.rows.forEach(row => {
      const obj = rowToObject_(studentHeaders, row);
      studentMap[obj.StudentID] = obj;
    });

    requests.forEach(r => {
      const st = studentMap[r.StudentID];
      r.StudentName = st ? (st.Prefix || '') + (st.FirstName || '') + ' ' + (st.LastName || '') : r.StudentID;
      r.StudentClass = st ? (st.Grade + '/' + st.Room) : '-';
    });

    const colStatus = headers.indexOf('Status');
    const allRows = cached.rows;
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
    Logger.log('API error: ' + err.message);
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ กรุณาลองใหม่อีกครั้ง' };
  }
}

function api_updateLeaveStatus_(token, requestId, status, approvalReason) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!session.permissions || !session.permissions.approveLeave) {
      return { success: false, message: 'คุณไม่มีสิทธิ์อนุมัติคำร้อง' };
    }
    if (!['approved', 'rejected'].includes(status)) {
      return { success: false, message: 'สถานะไม่ถูกต้อง' };
    }

    // LockService: กัน race condition เมื่อหลายคนอนุมัติ/ไม่อนุมัติพร้อมกัน
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const sheet = getSheet(CONFIG.SHEET_NAMES.LEAVE_REQUESTS);
      const cached = getCachedSheetData_(CONFIG.SHEET_NAMES.LEAVE_REQUESTS);
      const headers = cached.headers;
      const colId = headers.indexOf('RequestID');

      for (let i = 0; i < cached.rows.length; i++) {
        if (cached.rows[i][colId] === requestId) {
          const rowObj = rowToObject_(headers, cached.rows[i]);
          if (rowObj.Status !== 'pending') {
            return { success: false, message: 'คำร้องนี้ถูกดำเนินการไปแล้ว' };
          }

          sheet.getRange(i + 2, headers.indexOf('Status') + 1).setValue(status);
          sheet.getRange(i + 2, headers.indexOf('ApprovedBy') + 1).setValue(session.userId);
          sheet.getRange(i + 2, headers.indexOf('ApprovedByName') + 1).setValue(session.fullName);
          sheet.getRange(i + 2, headers.indexOf('ApprovalReason') + 1).setValue(approvalReason || '');
          sheet.getRange(i + 2, headers.indexOf('UpdatedAt') + 1).setValue(new Date());

          const studentId = rowObj.StudentID;
          const statusText = status === 'approved' ? 'อนุมัติ' : 'ไม่อนุมัติ';
          addTimelineEvent_(studentId, 'leave',
            'คำร้องออกนอกโรงเรียนได้รับการ' + statusText,
            (approvalReason ? 'เหตุผล: ' + approvalReason + ' · ' : '') + 'ดำเนินการโดย ' + session.fullName,
            session.fullName);

          logAudit_(session, 'UPDATE_STATUS', CONFIG.SHEET_NAMES.LEAVE_REQUESTS, requestId, 'pending', status);

          // แจ้งเตือนผู้ปกครองผ่าน LINE เมื่ออนุมัติ — ไม่กระทบงานหลักถ้า LINE error
          if (status === 'approved') {
            try {
              notifyLeaveApprovalEvent_(studentId, rowObj.Reason, rowObj.RequestedDate, rowObj.RequestedOutTime, rowObj.RequestedInTime, session.fullName, new Date());
            } catch (lineErr) {
              Logger.log('ส่ง LINE แจ้งเตือนอนุมัติคำร้องไม่สำเร็จ: ' + lineErr.message);
            }
          }

          return { success: true };
        }
      }
      return { success: false, message: 'ไม่พบคำร้องนี้' };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    Logger.log('API error: ' + err.message);
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ กรุณาลองใหม่อีกครั้ง' };
  }
}

/**
 * บันทึกเวลาออกจากโรงเรียนจริง (เฉพาะคำร้องที่อนุมัติแล้ว)
 * เมื่อบันทึกเวลาออกจริง → แจ้งเตือนผู้ปกครอง "นักเรียนออกจากโรงเรียนแล้ว"
 */
function api_updateLeaveActualTimes_(token, requestId, actualOutTime, actualInTime) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!session.permissions || !session.permissions.approveLeave) {
      return { success: false, message: 'คุณไม่มีสิทธิ์บันทึกเวลาออกจริง' };
    }
    // LockService: กันการบันทึกเวลาจริงพร้อมกันหลายคน
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const sheet = getSheet(CONFIG.SHEET_NAMES.LEAVE_REQUESTS);
      const cached = getCachedSheetData_(CONFIG.SHEET_NAMES.LEAVE_REQUESTS);
      const headers = cached.headers;
      const colId = headers.indexOf('RequestID');

      for (let i = 0; i < cached.rows.length; i++) {
        if (cached.rows[i][colId] === requestId) {
          const rowObj = rowToObject_(headers, cached.rows[i]);
          if (rowObj.Status !== 'approved') {
            return { success: false, message: 'บันทึกเวลาออกจริงได้เฉพาะคำร้องที่อนุมัติแล้ว' };
          }
          const outTime = String(actualOutTime || '').trim();
          const inTime = String(actualInTime || '').trim();
          if (outTime && !/^\d{2}:\d{2}$/.test(outTime)) {
            return { success: false, message: 'รูปแบบเวลาออกจริงไม่ถูกต้อง' };
          }
          if (inTime && !/^\d{2}:\d{2}$/.test(inTime)) {
            return { success: false, message: 'รูปแบบเวลากลับถึงไม่ถูกต้อง' };
          }
          if (!outTime && !inTime) {
            return { success: false, message: 'กรุณาระบุเวลาอย่างน้อยหนึ่งเวลา' };
          }
          let outNotified = false;
          if (outTime) {
            sheet.getRange(i + 2, headers.indexOf('ActualOutTime') + 1).setValue(outTime);
            sheet.getRange(i + 2, headers.indexOf('UpdatedAt') + 1).setValue(new Date());
            // แจ้งเตือนผู้ปกครองว่านักเรียนออกจากโรงเรียนแล้ว
            try {
              const lineRes = notifyLeaveActualOutEvent_(rowObj.StudentID, rowObj.Reason, outTime, session.fullName, new Date());
              outNotified = !!lineRes.sent;
            } catch (lineErr) {
              Logger.log('ส่ง LINE แจ้งเตือนเวลาออกจริงไม่สำเร็จ: ' + lineErr.message);
            }
          }
          if (inTime) {
            sheet.getRange(i + 2, headers.indexOf('ActualInTime') + 1).setValue(inTime);
          }
          logAudit_(session, 'UPDATE', CONFIG.SHEET_NAMES.LEAVE_REQUESTS, requestId, '',
            'บันทึกเวลาออกจริง: ' + (outTime || '-') + ' · กลับถึง: ' + (inTime || '-'));
          return { success: true, outNotified: outNotified };
        }
      }
      return { success: false, message: 'ไม่พบคำร้องนี้' };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    Logger.log('API error: ' + err.message);
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ กรุณาลองใหม่อีกครั้ง' };
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
function apiUpdateLeaveActualTimes(token, requestId, actualOutTime, actualInTime) {
  return api_updateLeaveActualTimes_(token, requestId, actualOutTime, actualInTime);
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
