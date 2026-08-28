// ============================================
// REPORTSERVICE.GS - รายงาน & สถิติ + ตั้งค่าภาคเรียน
// ============================================

/**
 * ดึงค่าตั้งค่าภาคเรียนทั้งหมด (สำหรับหน้า admin)
 */
function api_getSemesterConfig_(token) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!session.permissions || !session.permissions.manageSystem) {
      return { success: false, message: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' };
    }

    return {
      success: true,
      semester1Start: getConfigValue_('SEMESTER_1_START') || '',
      semester1End: getConfigValue_('SEMESTER_1_END') || '',
      semester2Start: getConfigValue_('SEMESTER_2_START') || '',
      semester2End: getConfigValue_('SEMESTER_2_END') || ''
    };
  } catch (err) {
    Logger.log('API error: ' + err.message);
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ กรุณาลองใหม่อีกครั้ง' };
  }
}

/**
 * บันทึกค่าตั้งค่าภาคเรียน (เฉพาะ admin / role ที่มีสิทธิ์ manageSystem)
 */
function api_saveSemesterConfig_(token, payload) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!session.permissions || !session.permissions.manageSystem) {
      return { success: false, message: 'คุณไม่มีสิทธิ์แก้ไขส่วนนี้' };
    }

    const required = ['semester1Start', 'semester1End', 'semester2Start', 'semester2End'];
    const missing = required.filter(k => !payload[k]);
    if (missing.length > 0) {
      return { success: false, message: 'กรุณากรอกวันที่ให้ครบทุกช่อง' };
    }

    // ตรวจสอบว่าวันเริ่มต้องมาก่อนวันสิ้นสุดของแต่ละภาคเรียน
    if (new Date(payload.semester1Start) >= new Date(payload.semester1End)) {
      return { success: false, message: 'วันเริ่มภาคเรียนที่ 1 ต้องมาก่อนวันสิ้นสุด' };
    }
    if (new Date(payload.semester2Start) >= new Date(payload.semester2End)) {
      return { success: false, message: 'วันเริ่มภาคเรียนที่ 2 ต้องมาก่อนวันสิ้นสุด' };
    }

    setConfigValue_('SEMESTER_1_START', payload.semester1Start, 'วันเริ่มภาคเรียนที่ 1');
    setConfigValue_('SEMESTER_1_END', payload.semester1End, 'วันสิ้นสุดภาคเรียนที่ 1');
    setConfigValue_('SEMESTER_2_START', payload.semester2Start, 'วันเริ่มภาคเรียนที่ 2');
    setConfigValue_('SEMESTER_2_END', payload.semester2End, 'วันสิ้นสุดภาคเรียนที่ 2');

    logAudit_(session, 'UPDATE', CONFIG.SHEET_NAMES.CONFIG, 'SEMESTER_CONFIG', '', JSON.stringify(payload));

    return { success: true };
  } catch (err) {
    Logger.log('API error: ' + err.message);
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ กรุณาลองใหม่อีกครั้ง' };
  }
}

// ============================================
// Public Functions (สำหรับ google.script.run) - ตั้งค่าภาคเรียน
// ============================================

function apiGetSemesterConfig(token) {
  return api_getSemesterConfig_(token);
}

function apiSaveSemesterConfig(token, payload) {
  return api_saveSemesterConfig_(token, payload);
}


// ============================================
// ภาพรวมสถิติคะแนนความประพฤติ
// ============================================

/**
 * แปลงค่าจาก Config (อาจเป็น Date object หรือ string ก็ได้) ให้เป็น Date ที่ถูกต้องเสมอ
 * แก้ปัญหา Google Sheets แปลง string วันที่เป็น Date object อัตโนมัติตอนบันทึก
 */
function parseConfigDate_(value, endOfDay) {
  let d;
  if (value instanceof Date) {
    d = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  } else {
    d = new Date(String(value).split('T')[0]);
  }
  if (endOfDay) {
    d.setHours(23, 59, 59, 999);
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

function resolveDateRange_(filters) {
  const period = filters.period || 'year';
  let start, end;
  const now = new Date();

  if (period === 'day') {
    const d = filters.date ? new Date(filters.date) : now;
    start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
  } else if (period === 'month') {
    const d = filters.month ? new Date(filters.month + '-01') : now;
    start = new Date(d.getFullYear(), d.getMonth(), 1);
    end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
  } else if (period === 'semester1') {
    start = parseConfigDate_(getConfigValue_('SEMESTER_1_START'), false);
    end = parseConfigDate_(getConfigValue_('SEMESTER_1_END'), true);
  } else if (period === 'semester2') {
    start = parseConfigDate_(getConfigValue_('SEMESTER_2_START'), false);
    end = parseConfigDate_(getConfigValue_('SEMESTER_2_END'), true);
  } else if (period === 'custom') {
    start = new Date(filters.startDate);
    end = new Date(filters.endDate + 'T23:59:59');
  } else {
    // year - ใช้ทั้งภาคเรียน 1 และ 2 รวมกัน ถ้ามี Config ครบ
    const s1 = getConfigValue_('SEMESTER_1_START');
    const e2 = getConfigValue_('SEMESTER_2_END');
    start = s1 ? parseConfigDate_(s1, false) : new Date(now.getFullYear(), 0, 1);
    end = e2 ? parseConfigDate_(e2, true) : now;
  }
  return { start, end };
}

/**
 * ภาพรวมสถิติคะแนน: แนวโน้ม + Top ตัดคะแนนมากสุด + Top ดีเด่น
 *
 * หมายเหตุโครงสร้างจริงของ Sheet ScoreLogs (อ้างอิงจาก Setup.gs):
 *   LogID, StudentID, Type, Amount, Reason, RecordedBy, RecordedByName, Timestamp, EducationPhase
 * ไม่มีคอลัมน์ StudentName ใน ScoreLogs โดยตรง จึงต้อง join ชื่อจาก Sheet Students ผ่าน StudentID
 */
function api_getScoreOverview_(token, filters) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!session.permissions || !session.permissions.score) {
      return { success: false, message: 'คุณไม่มีสิทธิ์ดูรายงาน' };
    }

    const { start, end } = resolveDateRange_(filters || {});

    // --- โหลดข้อมูลนักเรียนทั้งหมดไว้ล่วงหน้า (ใช้ join ชื่อ + สร้าง Top ดีเด่น) ---
    const studSheet = getSheet(CONFIG.SHEET_NAMES.STUDENTS);
    const studData = studSheet.getDataRange().getValues();
    const studHeaders = studData[0];
    const students = studData.slice(1).map(row => rowToObject_(studHeaders, row));
    const studentMap = {};
    students.forEach(s => { studentMap[s.StudentID] = s; });

    // --- อ่าน ScoreLogs ---
    const logSheet = getSheet(CONFIG.SHEET_NAMES.SCORE_LOGS);
    const logData = logSheet.getDataRange().getValues();
    const logHeaders = logData[0];
    const colTs = logHeaders.indexOf('Timestamp');
    const colType = logHeaders.indexOf('Type');
    const colAmount = logHeaders.indexOf('Amount');
    const colStudentId = logHeaders.indexOf('StudentID');

    const logsInRange = [];
    for (let i = 1; i < logData.length; i++) {
      const ts = new Date(logData[i][colTs]);
      if (ts >= start && ts <= end) {
        logsInRange.push({
          date: ts,
          type: logData[i][colType],
          amount: Number(logData[i][colAmount]) || 0,
          studentId: logData[i][colStudentId]
        });
      }
    }

    // --- แนวโน้มรายวัน (group by date) ---
    const trendMap = {};
    logsInRange.forEach(l => {
      const key = Utilities.formatDate(l.date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      if (!trendMap[key]) trendMap[key] = { add: 0, deduct: 0 };
      if (l.type === 'add') trendMap[key].add += l.amount;
      else trendMap[key].deduct += l.amount;
    });
    const sortedDates = Object.keys(trendMap).sort();
    const trend = {
      labels: sortedDates,
      addData: sortedDates.map(d => trendMap[d].add),
      deductData: sortedDates.map(d => trendMap[d].deduct)
    };

    // --- Top ตัดคะแนนมากสุด (รวมตามนักเรียนในช่วงที่กรอง, join ชื่อจาก studentMap) ---
    const deductMap = {};
    logsInRange.filter(l => l.type === 'deduct').forEach(l => {
      if (!deductMap[l.studentId]) deductMap[l.studentId] = { studentId: l.studentId, total: 0 };
      deductMap[l.studentId].total += l.amount;
    });
    const topDeducted = Object.values(deductMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map(d => {
        const st = studentMap[d.studentId];
        return {
          studentId: d.studentId,
          studentName: st ? (st.Prefix || '') + (st.FirstName || '') + ' ' + (st.LastName || '') : d.studentId,
          grade: st ? st.Grade : '-',
          room: st ? st.Room : '-',
          total: d.total
        };
      });

    // --- Top ดีเด่น: CurrentScore สูงสุด (ไม่ขึ้นกับช่วงเวลาที่กรอง) ---
    const topGood = [...students]
      .sort((a, b) => Number(b.CurrentScore) - Number(a.CurrentScore))
      .slice(0, 10)
      .map(s => ({
        studentId: s.StudentID,
        studentName: (s.Prefix || '') + (s.FirstName || '') + ' ' + (s.LastName || ''),
        grade: s.Grade,
        room: s.Room,
        currentScore: s.CurrentScore
      }));

    // --- สรุปยอดรวม ---
    const totalAdd = logsInRange.filter(l => l.type === 'add').reduce((sum, l) => sum + l.amount, 0);
    const totalDeduct = logsInRange.filter(l => l.type === 'deduct').reduce((sum, l) => sum + l.amount, 0);

    return {
      success: true,
      trend,
      topDeducted,
      topGood,
      summary: { totalAdd, totalDeduct, totalRecords: logsInRange.length }
    };
  } catch (err) {
    Logger.log('API error: ' + err.message);
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ กรุณาลองใหม่อีกครั้ง' };
  }
}

// ============================================
// Public Function (สำหรับ google.script.run) - ภาพรวมสถิติคะแนน
// ============================================

function apiGetScoreOverview(token, filters) {
  return api_getScoreOverview_(token, filters);
}
  /**
 * สถิติห้องเรียนที่มีการกระทำผิดมากสุด + ประเภทเหตุผลที่พบบ่อยที่สุด
 * ใช้ Reason ที่บันทึกใน ScoreLogs ตอน Type = 'deduct' เป็นตัวแทน "ประเภทความผิด"
 */
function api_getRoomReasonStats_(token, filters) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!session.permissions || !session.permissions.score) {
      return { success: false, message: 'คุณไม่มีสิทธิ์ดูรายงาน' };
    }

    const { start, end } = resolveDateRange_(filters || {});

    // --- โหลดนักเรียนไว้ join ห้อง ---
    const studSheet = getSheet(CONFIG.SHEET_NAMES.STUDENTS);
    const studData = studSheet.getDataRange().getValues();
    const studHeaders = studData[0];
    const students = studData.slice(1).map(row => rowToObject_(studHeaders, row));
    const studentMap = {};
    students.forEach(s => { studentMap[s.StudentID] = s; });

    // --- อ่าน ScoreLogs เฉพาะ deduct ในช่วงเวลาที่กรอง ---
    const logSheet = getSheet(CONFIG.SHEET_NAMES.SCORE_LOGS);
    const logData = logSheet.getDataRange().getValues();
    const logHeaders = logData[0];
    const colTs = logHeaders.indexOf('Timestamp');
    const colType = logHeaders.indexOf('Type');
    const colAmount = logHeaders.indexOf('Amount');
    const colStudentId = logHeaders.indexOf('StudentID');
    const colReason = logHeaders.indexOf('Reason');

    const roomMap = {};    // 'ม.1/1' -> { count, totalDeducted }
    const reasonMap = {};  // 'มาโรงเรียนสาย' -> count

    for (let i = 1; i < logData.length; i++) {
      if (logData[i][colType] !== 'deduct') continue;
      const ts = new Date(logData[i][colTs]);
      if (ts < start || ts > end) continue;

      const studentId = logData[i][colStudentId];
      const amount = Number(logData[i][colAmount]) || 0;
      const reason = String(logData[i][colReason] || 'ไม่ระบุเหตุผล').trim();
      const st = studentMap[studentId];
      const roomKey = st ? (st.Grade + '/' + st.Room) : 'ไม่ทราบห้อง';

      if (!roomMap[roomKey]) roomMap[roomKey] = { room: roomKey, count: 0, totalDeducted: 0 };
      roomMap[roomKey].count += 1;
      roomMap[roomKey].totalDeducted += amount;

      if (!reasonMap[reason]) reasonMap[reason] = 0;
      reasonMap[reason] += 1;
    }

    // --- ห้องเรียนเรียงจากมากไปน้อย (Top 10) ---
    const roomStats = Object.values(roomMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // --- ประเภทความผิด เรียงจากมากไปน้อย (Top 8 + รวมที่เหลือเป็น "อื่นๆ") ---
    const reasonEntries = Object.entries(reasonMap)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    const topReasons = reasonEntries.slice(0, 8);
    const otherCount = reasonEntries.slice(8).reduce((sum, r) => sum + r.count, 0);
    if (otherCount > 0) topReasons.push({ reason: 'อื่นๆ', count: otherCount });

    return {
      success: true,
      roomStats,
      reasonStats: topReasons,
      totalIncidents: Object.values(roomMap).reduce((sum, r) => sum + r.count, 0)
    };
  } catch (err) {
    Logger.log('API error: ' + err.message);
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ กรุณาลองใหม่อีกครั้ง' };
  }
}

function apiGetRoomReasonStats(token, filters) {
  return api_getRoomReasonStats_(token, filters);
}

// ============================================
// สถิติหนังสือเชิญผู้ปกครองและคำร้องออกนอกโรงเรียน
// ============================================
function api_getLetterLeaveStats_(token, filters) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!session.permissions || !session.permissions.score) {
      return { success: false, message: 'คุณไม่มีสิทธิ์ดูรายงาน' };
    }

    const range = resolveDateRange_(filters || {});
    const start = range.start;
    const end = range.end;
    const timezone = Session.getScriptTimeZone();

    function isInRange(value) {
      const date = new Date(value);
      return !isNaN(date.getTime()) && date >= start && date <= end;
    }

    function getDateKey(value) {
      return Utilities.formatDate(new Date(value), timezone, 'yyyy-MM-dd');
    }

    // หนังสือเชิญ: นับตามวันที่สร้างเอกสาร และแยกสถานะปัจจุบันของเอกสารนั้น
    const letterSheet = getSheet(CONFIG.SHEET_NAMES.INVITATION_LETTERS);
    const letterData = letterSheet.getDataRange().getValues();
    const letterHeaders = letterData[0] || [];
    const letterStatusCol = letterHeaders.indexOf('Status');
    const letterCreatedCol = letterHeaders.indexOf('CreatedAt');
    const letterSummary = { total: 0, draft: 0, confirmed: 0 };
    const letterTrendMap = {};

    letterData.slice(1).forEach(row => {
      const createdAt = row[letterCreatedCol];
      if (!isInRange(createdAt)) return;

      const status = String(row[letterStatusCol] || 'draft').toLowerCase();
      const key = getDateKey(createdAt);
      if (!letterTrendMap[key]) letterTrendMap[key] = { draft: 0, confirmed: 0 };

      letterSummary.total += 1;
      if (status === 'confirmed') {
        letterSummary.confirmed += 1;
        letterTrendMap[key].confirmed += 1;
      } else {
        letterSummary.draft += 1;
        letterTrendMap[key].draft += 1;
      }
    });

    const letterLabels = Object.keys(letterTrendMap).sort();

    // คำร้องออกนอกโรงเรียน: นับตามวันที่ยื่นคำร้อง และแยกตามสถานะปัจจุบัน
    const leaveSheet = getSheet(CONFIG.SHEET_NAMES.LEAVE_REQUESTS);
    const leaveData = leaveSheet.getDataRange().getValues();
    const leaveHeaders = leaveData[0] || [];
    const leaveStatusCol = leaveHeaders.indexOf('Status');
    const leaveCreatedCol = leaveHeaders.indexOf('CreatedAt');
    const leaveSummary = { total: 0, pending: 0, approved: 0, rejected: 0 };
    const leaveTrendMap = {};

    leaveData.slice(1).forEach(row => {
      const createdAt = row[leaveCreatedCol];
      if (!isInRange(createdAt)) return;

      const status = String(row[leaveStatusCol] || 'pending').toLowerCase();
      const key = getDateKey(createdAt);
      if (!leaveTrendMap[key]) {
        leaveTrendMap[key] = { pending: 0, approved: 0, rejected: 0 };
      }

      leaveSummary.total += 1;
      if (status === 'approved') {
        leaveSummary.approved += 1;
        leaveTrendMap[key].approved += 1;
      } else if (status === 'rejected') {
        leaveSummary.rejected += 1;
        leaveTrendMap[key].rejected += 1;
      } else {
        leaveSummary.pending += 1;
        leaveTrendMap[key].pending += 1;
      }
    });

    const leaveLabels = Object.keys(leaveTrendMap).sort();

    return {
      success: true,
      letterSummary: letterSummary,
      leaveSummary: leaveSummary,
      letterTrend: {
        labels: letterLabels,
        draftData: letterLabels.map(key => letterTrendMap[key].draft),
        confirmedData: letterLabels.map(key => letterTrendMap[key].confirmed)
      },
      leaveTrend: {
        labels: leaveLabels,
        pendingData: leaveLabels.map(key => leaveTrendMap[key].pending),
        approvedData: leaveLabels.map(key => leaveTrendMap[key].approved),
        rejectedData: leaveLabels.map(key => leaveTrendMap[key].rejected)
      }
    };
  } catch (err) {
    Logger.log('API error: ' + err.message);
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ กรุณาลองใหม่อีกครั้ง' };
  }
}

function apiGetLetterLeaveStats(token, filters) {
  return api_getLetterLeaveStats_(token, filters);
}

// ============================================
// ส่งออกรายงาน (PDF / Excel)
// ============================================
function getReportExportFolder_() {
  const root = DriveApp.getFolderById(DRIVE_ROOT_FOLDER_ID);
  const year = getConfigValue_('CURRENT_ACADEMIC_YEAR') || '2569';
  const yearFolder = getOrCreateSubfolder_(root, 'ปีการศึกษา ' + year);
  return getOrCreateSubfolder_(yearFolder, 'รายงานและสถิติ');
}

function getReportPeriodLabel_(filters) {
  const period = (filters || {}).period || 'year';
  if (period === 'day') return 'รายวัน ' + (filters.date || 'วันนี้');
  if (period === 'month') return 'รายเดือน ' + (filters.month || 'เดือนปัจจุบัน');
  if (period === 'semester1') return 'ภาคเรียนที่ 1';
  if (period === 'semester2') return 'ภาคเรียนที่ 2';
  if (period === 'custom') return (filters.startDate || '-') + ' ถึง ' + (filters.endDate || '-');
  return 'ปีการศึกษา';
}

function buildReportExportContent_(token, reportType, filters) {
  let result;
  let title;
  const sections = [];

  if (reportType === 'score') {
    result = api_getScoreOverview_(token, filters);
    title = 'รายงานภาพรวมคะแนนความประพฤติ';
    if (!result.success) return result;
    sections.push({
      title: 'สรุปคะแนน',
      headers: ['คะแนนที่เพิ่มรวม', 'คะแนนที่ถูกตัดรวม', 'จำนวนรายการ'],
      rows: [[result.summary.totalAdd, result.summary.totalDeduct, result.summary.totalRecords]]
    });
    sections.push({
      title: 'แนวโน้มคะแนนรายวัน',
      headers: ['วันที่', 'คะแนนที่เพิ่ม', 'คะแนนที่ถูกตัด'],
      rows: result.trend.labels.map((label, index) => [label, result.trend.addData[index], result.trend.deductData[index]])
    });
    sections.push({
      title: 'นักเรียนที่ถูกตัดคะแนนมากที่สุด',
      headers: ['ลำดับ', 'รหัสนักเรียน', 'ชื่อ-สกุล', 'ชั้น/ห้อง', 'คะแนนที่ถูกตัด'],
      rows: result.topDeducted.map((student, index) => [index + 1, student.studentId, student.studentName, student.grade + '/' + student.room, student.total])
    });
  } else if (reportType === 'room') {
    result = api_getRoomReasonStats_(token, filters);
    title = 'รายงานห้องเรียนและประเภทความผิด';
    if (!result.success) return result;
    sections.push({
      title: 'ห้องเรียนที่มีการกระทำผิดมากที่สุด',
      headers: ['ห้องเรียน', 'จำนวนเหตุการณ์', 'คะแนนที่ถูกตัดรวม'],
      rows: result.roomStats.map(room => [room.room, room.count, room.totalDeducted])
    });
    sections.push({
      title: 'ประเภทการกระทำผิดที่พบบ่อยที่สุด',
      headers: ['ประเภท', 'จำนวนเหตุการณ์'],
      rows: result.reasonStats.map(reason => [reason.reason, reason.count])
    });
  } else if (reportType === 'document') {
    result = api_getLetterLeaveStats_(token, filters);
    title = 'รายงานหนังสือเชิญและการออกนอกโรงเรียน';
    if (!result.success) return result;
    sections.push({
      title: 'สรุปหนังสือเชิญผู้ปกครอง',
      headers: ['ทั้งหมด', 'ร่าง', 'ออกเอกสารแล้ว'],
      rows: [[result.letterSummary.total, result.letterSummary.draft, result.letterSummary.confirmed]]
    });
    sections.push({
      title: 'สรุปคำร้องออกนอกโรงเรียน',
      headers: ['ทั้งหมด', 'รอพิจารณา', 'อนุมัติ', 'ไม่อนุมัติ'],
      rows: [[result.leaveSummary.total, result.leaveSummary.pending, result.leaveSummary.approved, result.leaveSummary.rejected]]
    });
    sections.push({
      title: 'แนวโน้มหนังสือเชิญผู้ปกครอง',
      headers: ['วันที่', 'ร่าง', 'ออกเอกสารแล้ว'],
      rows: result.letterTrend.labels.map((label, index) => [label, result.letterTrend.draftData[index], result.letterTrend.confirmedData[index]])
    });
    sections.push({
      title: 'แนวโน้มคำร้องออกนอกโรงเรียน',
      headers: ['วันที่', 'รอพิจารณา', 'อนุมัติ', 'ไม่อนุมัติ'],
      rows: result.leaveTrend.labels.map((label, index) => [label, result.leaveTrend.pendingData[index], result.leaveTrend.approvedData[index], result.leaveTrend.rejectedData[index]])
    });
  } else {
    return { success: false, message: 'ไม่รู้จักประเภทรายงาน' };
  }

  return { success: true, title: title, periodLabel: getReportPeriodLabel_(filters), sections: sections };
}

function api_exportReport_(token, reportType, filters, format) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!session.permissions || !session.permissions.editDelete) {
      return { success: false, message: 'คุณไม่มีสิทธิ์ส่งออกรายงาน' };
    }
    if (['pdf', 'excel'].indexOf(format) === -1) {
      return { success: false, message: 'เลือกรูปแบบไฟล์ไม่ถูกต้อง' };
    }

    const content = buildReportExportContent_(token, reportType, filters || {});
    if (!content.success) return content;

    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    const baseName = content.title.replace(/[\\/:*?"<>|]/g, '_') + '_' + timestamp;
    const outputFolder = getReportExportFolder_();
    let outputFile;

    if (format === 'pdf') {
      const document = DocumentApp.create(baseName);
      const body = document.getBody();
      body.appendParagraph(content.title).setHeading(DocumentApp.ParagraphHeading.HEADING1);
      body.appendParagraph('ช่วงเวลา: ' + content.periodLabel);
      body.appendParagraph('จัดทำเมื่อ: ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'));

      content.sections.forEach(section => {
        body.appendParagraph(section.title).setHeading(DocumentApp.ParagraphHeading.HEADING2);
        const tableValues = [section.headers].concat(section.rows.length ? section.rows : [['ไม่มีข้อมูล']]);
        body.appendTable(tableValues.map(row => row.map(value => String(value == null ? '' : value))));
      });

      document.saveAndClose();
      const tempFile = DriveApp.getFileById(document.getId());
      outputFile = outputFolder.createFile(tempFile.getAs(MimeType.PDF)).setName(baseName + '.pdf');
      tempFile.setTrashed(true);
    } else {
      const spreadsheet = SpreadsheetApp.create(baseName);
      const firstSheet = spreadsheet.getSheets()[0];
      firstSheet.setName('สรุปรายงาน');
      let rowIndex = 1;
      firstSheet.getRange(rowIndex++, 1).setValue(content.title).setFontWeight('bold').setFontSize(16);
      firstSheet.getRange(rowIndex++, 1).setValue('ช่วงเวลา: ' + content.periodLabel);
      firstSheet.getRange(rowIndex++, 1).setValue('จัดทำเมื่อ: ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'));
      rowIndex++;

      content.sections.forEach(section => {
        firstSheet.getRange(rowIndex++, 1).setValue(section.title).setFontWeight('bold');
        firstSheet.getRange(rowIndex, 1, 1, section.headers.length).setValues([section.headers]).setFontWeight('bold');
        rowIndex++;
        const rows = section.rows.length ? section.rows : [['ไม่มีข้อมูล']];
        firstSheet.getRange(rowIndex, 1, rows.length, section.headers.length).setValues(rows.map(row => {
          const values = row.slice();
          while (values.length < section.headers.length) values.push('');
          return values;
        }));
        rowIndex += rows.length + 2;
      });
      firstSheet.autoResizeColumns(1, 6);

      // บังคับให้ Google Sheets เขียนข้อมูลทั้งหมดก่อนเรียก Drive export
      // หากไม่ flush การแปลงทันทีอาจได้ไฟล์ Excel เปล่า
      SpreadsheetApp.flush();

      const excelMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      // DriveApp.getAs() ไม่รองรับการแปลง Google Sheets เป็น .xlsx โดยตรง
      // จึงใช้ Drive export endpoint ซึ่งรองรับรูปแบบ Excel โดยเฉพาะ
      const exportUrl = 'https://www.googleapis.com/drive/v3/files/' + spreadsheet.getId()
        + '/export?mimeType=' + encodeURIComponent(excelMimeType);
      const exportResponse = UrlFetchApp.fetch(exportUrl, {
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        muteHttpExceptions: true
      });
      if (exportResponse.getResponseCode() !== 200) {
        throw new Error('Google Drive ไม่สามารถแปลงเป็น Excel ได้ (รหัส ' + exportResponse.getResponseCode() + ')');
      }
      outputFile = outputFolder.createFile(exportResponse.getBlob()).setName(baseName + '.xlsx');
      DriveApp.getFileById(spreadsheet.getId()).setTrashed(true);
    }

    logAudit_(session, 'EXPORT', CONFIG.SHEET_NAMES.AUDIT_LOG, reportType, '', format.toUpperCase() + ': ' + outputFile.getName());
    return { success: true, fileUrl: outputFile.getUrl(), fileName: outputFile.getName() };
  } catch (err) {
    Logger.log('api_exportReport_ error: ' + err.message);
    return { success: false, message: 'ไม่สามารถส่งออกรายงานได้ กรุณาลองใหม่อีกครั้ง' };
  }
}

function apiExportReport(token, reportType, filters, format) {
  return api_exportReport_(token, reportType, filters, format);
}
