// ============================================
// DASHBOARDSERVICE.GS - สรุปข้อมูลภาพรวมสำหรับ Dashboard
// ============================================

function api_getDashboardSummary_(token) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

    const studentSheet = getSheet(CONFIG.SHEET_NAMES.STUDENTS);
    const studentData = studentSheet.getDataRange().getValues();
    const studentHeaders = studentData[0];
    const students = studentData.slice(1).map(row => rowToObject_(studentHeaders, row));

    const totalStudents = students.length;
    const atRisk = students.filter(s => Number(s.CurrentScore) < 70).length;
    const lineLinked = students.filter(s => s.LineLinked === true).length;

    // สร้าง lookup ชื่อนักเรียนจาก StudentID (ใช้กับ Timeline)
    const nameMap = {};
    students.forEach(s => {
      nameMap[s.StudentID] = (s.Prefix || '') + (s.FirstName || '') + ' ' + (s.LastName || '');
    });

    // สถิตินักเรียนแยกตามระดับชั้น
    const gradeOrder = ['ม.1', 'ม.2', 'ม.3', 'ม.4', 'ม.5', 'ม.6'];
    const gradeCounts = {};
    gradeOrder.forEach(g => gradeCounts[g] = 0);
    students.forEach(s => {
      if (gradeCounts.hasOwnProperty(s.Grade)) gradeCounts[s.Grade]++;
    });

    // Timeline: เหตุการณ์วันนี้ + เหตุการณ์ล่าสุด
    const timelineSheet = getSheet(CONFIG.SHEET_NAMES.TIMELINE);
    const timelineData = timelineSheet.getDataRange().getValues();
    const timelineHeaders = timelineData[0];
    let events = timelineData.slice(1).map(row => rowToObject_(timelineHeaders, row));

    events.sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));

    const todayStr = new Date().toDateString();
    const todayEvents = events.filter(ev => new Date(ev.Timestamp).toDateString() === todayStr).length;

    const recentTimeline = events.slice(0, 8).map(ev => ({
      EventType: ev.EventType,
      Title: (nameMap[ev.StudentID] ? nameMap[ev.StudentID] + ' — ' : '') + ev.Title,
      Description: ev.Description,
      Timestamp: ev.Timestamp
    }));

    return {
      success: true,
      summary: { totalStudents, atRisk, lineLinked, todayEvents },
      gradeDistribution: { labels: gradeOrder, counts: gradeOrder.map(g => gradeCounts[g]) },
      recentTimeline
    };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

// ============================================
// Public Function (สำหรับ google.script.run)
// ============================================
function apiGetDashboardSummary(token) {
  return api_getDashboardSummary_(token);
}