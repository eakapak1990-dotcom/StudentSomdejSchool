// ============================================================
// LINESERVICE.GS - แจ้งเตือนผู้ปกครองผ่าน LINE OA (Flex Message) + LIFF
//
// หลักการ:
// - ส่งเฉพาะผู้ปกครองที่ผูกบัญชี LINE (LINE_BINDINGS, Active=true) เท่านั้น
// - ใช้ Flex Message หนึ่งใบรวมข้อมูลทั้งหมด (ประหยัดจำนวนข้อความต่อเหตุการณ์)
// - ค่า Token/LIFF ID เก็บใน Sheet Config (จัดการได้จากหน้า "การแจ้งเตือน LINE")
// ============================================================

const LINE_API_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

// ============================================================
// 1. ข้อมูลการเชื่อมต่อ (Bindings)
// ============================================================

/** คืนค่ารายการผูกบัญชีที่ Active ของนักเรียนคนนั้น */
function getLineBindingsForStudent_(studentId) {
  const sheet = getSheet(CONFIG.SHEET_NAMES.LINE_BINDINGS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colBinding = headers.indexOf('BindingID');
  const colId = headers.indexOf('StudentID');
  const colLine = headers.indexOf('LineUserID');
  const colName = headers.indexOf('ParentDisplayName');
  const colBoundAt = headers.indexOf('BoundAt');
  const colActive = headers.indexOf('Active');
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][colId] === studentId && data[i][colActive] !== false) {
      out.push({
        BindingID: data[i][colBinding],
        StudentID: data[i][colId],
        LineUserID: data[i][colLine],
        ParentDisplayName: data[i][colName] || 'ผู้ปกครอง',
        BoundAt: data[i][colBoundAt]
      });
    }
  }
  return out;
}

/** คืนค่ารายการผูกบัญชีที่ Active ของ LINE user คนหนึ่ง (ใช้ฝั่ง LIFF) */
function getLineBindingsForUser_(lineUserId) {
  const sheet = getSheet(CONFIG.SHEET_NAMES.LINE_BINDINGS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colBinding = headers.indexOf('BindingID');
  const colId = headers.indexOf('StudentID');
  const colLine = headers.indexOf('LineUserID');
  const colActive = headers.indexOf('Active');
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][colLine] === lineUserId && data[i][colActive] !== false) {
      out.push({ BindingID: data[i][colBinding], StudentID: data[i][colId] });
    }
  }
  return out;
}

/** อัปเดตสถานะ LineLinked ในชีต Students (ใช้คำนวณสถิติแดชบอร์ด) */
function setStudentLineLinked_(studentId, linked) {
  try {
    const sheet = getSheet(CONFIG.SHEET_NAMES.STUDENTS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colId = headers.indexOf('StudentID');
    const colLine = headers.indexOf('LineLinked');
    if (colId === -1 || colLine === -1) return;
    for (let i = 1; i < data.length; i++) {
      if (data[i][colId] === studentId) {
        sheet.getRange(i + 1, colLine + 1).setValue(linked);
        return;
      }
    }
  } catch (e) { /* ไม่กระทบงานหลัก */ }
}

// ============================================================
// 2. การส่งข้อความ (Flex Message)
// ============================================================

/** ส่ง Flex Message ไปยัง LINE user รายเดียว */
function sendLinePush_(lineUserId, message) {
  const token = getConfigValue_('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) return { sent: false, reason: 'ยังไม่ได้ตั้งค่า Channel Access Token' };
  if (!lineUserId) return { sent: false, reason: 'ไม่มี LineUserID' };
  const res = UrlFetchApp.fetch(LINE_API_PUSH_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ to: lineUserId, messages: [message] }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  return { sent: code === 200, code: code, body: res.getContentText() };
}

/** แถวข้อมูลใน Flex body */
function flexInfoRow_(label, value) {
  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    contents: [
      { type: 'text', text: String(label), color: '#8C96B3', size: 'xs', flex: 2, gravity: 'center' },
      { type: 'text', text: String(value === undefined || value === null ? '-' : value), color: '#1A2233', size: 'xs', flex: 5, wrap: true, gravity: 'center' }
    ]
  };
}

/** แถวคะแนน (ตัวหนา + สีตามประเภท) — รองรับ label เอง เช่น 'คะแนนเดิม' / 'คะแนนที่ตัด' */
function flexPointsRow_(label, text, color) {
  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    contents: [
      { type: 'text', text: String(label || 'คะแนน'), color: '#8C96B3', size: 'xs', flex: 2, gravity: 'center' },
      { type: 'text', text: String(text === undefined || text === null ? '-' : text), color: color || '#1A2233', size: 'md', weight: 'bold', flex: 5, gravity: 'center' }
    ]
  };
}

/** สร้าง Flex Message ใบเดียวรวมรายละเอียดเหตุการณ์ทั้งหมด */
function buildEventFlexMessage_(ev) {
  const bodyContents = [
    flexInfoRow_('นักเรียน', ev.studentName),
    flexInfoRow_('ชั้น/ห้อง', ev.studentClass),
    flexInfoRow_('วันเวลา', ev.timestampText),
    flexInfoRow_('เหตุการณ์', ev.eventText || '-')
  ];
  if (ev.pointsRows && ev.pointsRows.length) {
    ev.pointsRows.forEach(function (r) {
      bodyContents.push(flexPointsRow_(r.label, r.text, r.color));
    });
  } else if (ev.pointsText) {
    bodyContents.push(flexPointsRow_('คะแนน', ev.pointsText, ev.pointsColor));
  }
  if (ev.extraText) bodyContents.push(flexInfoRow_('หมายเหตุ', ev.extraText));
  bodyContents.push(flexInfoRow_('ผู้บันทึก', ev.recorder || 'ระบบอัตโนมัติ'));
  if (ev.contact) bodyContents.push(flexInfoRow_('ติดต่อโรงเรียน', ev.contact));

  return {
    type: 'flex',
    altText: ev.altText || ev.title,
    contents: {
      type: 'bubble',
      size: 'giga',
      header: {
        type: 'box',
        layout: 'horizontal',
        backgroundColor: ev.accentColor || '#152A52',
        paddingAll: '14px',
        contents: [
          { type: 'text', text: String(ev.title || 'แจ้งเตือน'), color: '#FFFFFF', weight: 'bold', size: 'lg', flex: 1, wrap: true }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '14px',
        contents: bodyContents
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        backgroundColor: '#F6F7FB',
        paddingAll: '10px',
        contents: [
          { type: 'text', text: ev.appName || CONFIG.APP_NAME, color: '#8C96B3', size: 'xs', flex: 1, gravity: 'center' }
        ]
      }
    }
  };
}

/**
 * กระจายการแจ้งเตือนไปยังผู้ปกครองทุกคนที่ผูก LINE กับนักเรียนคนนี้
 * ไม่ throw — คืนค่า { sent, notified, errors } เพื่อให้งานหลักปลอดภัยเสมอ
 */
function notifyStudentEvent_(studentId, ev) {
  const bindings = getLineBindingsForStudent_(studentId);
  if (!bindings.length) return { sent: false, notified: 0, errors: ['ไม่พบผู้ปกครองที่เชื่อม LINE'] };
  const contact = getConfigValue_('LINE_CONTACT_CHANNEL') || CONFIG.SCHOOL_INFO.PHONE || '';
  const message = buildEventFlexMessage_(Object.assign({}, ev, { contact: contact, appName: CONFIG.APP_NAME }));
  let notified = 0;
  const errors = [];
  bindings.forEach(function (b) {
    try {
      const r = sendLinePush_(b.LineUserID, message);
      if (r.sent) notified++;
      else errors.push((b.ParentDisplayName || b.LineUserID) + ': ' + (r.reason || ('HTTP ' + r.code)));
    } catch (e) {
      errors.push((b.ParentDisplayName || b.LineUserID) + ': ' + e.message);
    }
  });
  logLineNotification_(studentId, ev.auditType || ev.title, notified, errors);
  return { sent: notified > 0, notified: notified, errors: errors };
}

/** บันทึกประวัติการส่ง LINE แจ้งเตือนลง AuditLog (สำหรับ LIFF ดูย้อนหลัง + ตรวจสอบของโรงเรียน) */
function logLineNotification_(studentId, eventType, notified, errors) {
  try {
    const sheet = getSheet(CONFIG.SHEET_NAMES.AUDIT_LOG);
    sheet.appendRow([
      Utilities.getUuid(), '', 'LINE-OA', 'LINE_SENT', 'LineBindings', studentId,
      String(eventType || '').slice(0, 200),
      JSON.stringify({ notified: notified || 0, errors: errors || [] }), new Date()
    ]);
  } catch (e) { /* อย่าให้ประวัติ LINE กระทบงานหลัก */ }
}

// ============================================================
// 3. รูปแบบการแจ้งเตือนแต่ละเหตุการณ์
// ============================================================

function getStudentDisplayName_(st) {
  return (st.Prefix || '') + (st.FirstName || '') + ' ' + (st.LastName || '');
}

/** ① นักเรียนถูกตัดคะแนน / ได้รับการเพิ่มคะแนน */
function notifyScoreEvent_(studentId, type, amount, oldScore, newScore, reason, recorder, timestamp) {
  const st = findStudentById_(studentId);
  if (!st) return { sent: false };
  const isDeduct = type === 'deduct';
  if (!isDeduct && getConfigValue_('LINE_NOTIFY_SCORE_ADD') !== 'true') {
    return { sent: false, notified: 0, errors: ['ปิดการแจ้งเตือนคะแนนเพิ่ม (LINE_NOTIFY_SCORE_ADD)'] };
  }
  const oldVal = oldScore === undefined || oldScore === null || isNaN(Number(oldScore)) ? null : Number(oldScore);
  const newVal = newScore === undefined || newScore === null || isNaN(Number(newScore)) ? null : Number(newScore);
  const deltaColor = isDeduct ? '#C2483A' : '#1F8A5B';
  const deltaText = (isDeduct ? '-' : '+') + amount + ' คะแนน';
  return notifyStudentEvent_(studentId, {
    title: isDeduct ? '⚠️ นักเรียนถูกตัดคะแนนความประพฤติ' : '🌟 นักเรียนได้รับคะแนนความประพฤติ',
    accentColor: deltaColor,
    studentName: getStudentDisplayName_(st),
    studentClass: (st.Grade || '-') + '/' + (st.Room || '-'),
    timestampText: thaiTimestampText_(timestamp || new Date()),
    eventText: reason || '-',
    pointsRows: [
      { label: 'คะแนนปัจจุบัน', text: oldVal === null ? '-' : oldVal + ' คะแนน', color: '#1A2233' },
      { label: isDeduct ? 'คะแนนที่ตัด' : 'คะแนนที่เพิ่ม', text: deltaText, color: deltaColor },
      { label: 'คะแนนคงเหลือ', text: newVal === null ? '-' : newVal + ' คะแนน', color: '#1A2233' }
    ],
    recorder: recorder || '-',
    altText: (isDeduct ? 'ตัดคะแนน' : 'เพิ่มคะแนน') + ' ' + amount + ' คะแนน' +
      (newVal === null ? '' : ' (คงเหลือ ' + newVal + ')') + ': ' + getStudentDisplayName_(st)
  });
}

/** ② มีการออกหนังสือเชิญผู้ปกครอง */
function notifyLetterEvent_(studentId, letterNo, detail, appointmentText, recorder, timestamp) {
  const st = findStudentById_(studentId);
  if (!st) return { sent: false };
  return notifyStudentEvent_(studentId, {
    title: '📩 มีหนังสือเชิญผู้ปกครอง',
    accentColor: '#C9861F',
    studentName: getStudentDisplayName_(st),
    studentClass: (st.Grade || '-') + '/' + (st.Room || '-'),
    timestampText: thaiTimestampText_(timestamp || new Date()),
    eventText: detail || '-',
    extraText: (letterNo ? 'เลขที่ ' + letterNo : '') + (appointmentText ? ' · นัดหมาย ' + appointmentText : ''),
    recorder: recorder || '-',
    altText: 'หนังสือเชิญผู้ปกครอง' + (letterNo ? ' ' + letterNo : '') + ': ' + getStudentDisplayName_(st)
  });
}

/** ③ ได้รับอนุญาตให้ออกนอกบริเวณโรงเรียน */
function notifyLeaveApprovalEvent_(studentId, reason, leaveDate, outTime, inTime, approver, timestamp) {
  const st = findStudentById_(studentId);
  if (!st) return { sent: false };
  const outT = formatLeaveTime_(outTime);
  const inT = formatLeaveTime_(inTime);
  const dateT = thaiShortDateText_(leaveDate);
  let extra = '';
  if (dateT) extra = 'วันที่ ' + dateT + ' · ';
  extra += 'ออก ' + (outT || '-') + ' น. · กลับ ' + (inT || '-') + ' น.';
  return notifyStudentEvent_(studentId, {
    title: '✅ อนุมัติคำร้องออกนอกโรงเรียน',
    accentColor: '#1F8A5B',
    studentName: getStudentDisplayName_(st),
    studentClass: (st.Grade || '-') + '/' + (st.Room || '-'),
    timestampText: thaiTimestampText_(timestamp || new Date()),
    eventText: reason || '-',
    extraText: extra,
    recorder: approver || '-',
    altText: 'อนุมัติคำร้องออกนอกโรงเรียน: ' + getStudentDisplayName_(st)
  });
}

/** ④ นักเรียนออกจากโรงเรียนแล้ว (บันทึกเวลาออกจริงตามคำร้องที่อนุมัติ) */
function notifyLeaveActualOutEvent_(studentId, reason, actualOutTime, recorder, timestamp) {
  const st = findStudentById_(studentId);
  if (!st) return { sent: false };
  return notifyStudentEvent_(studentId, {
    title: '🚪 นักเรียนออกจากโรงเรียนแล้ว',
    accentColor: '#284A8A',
    studentName: getStudentDisplayName_(st),
    studentClass: (st.Grade || '-') + '/' + (st.Room || '-'),
    timestampText: thaiTimestampText_(timestamp || new Date()),
    eventText: reason || '-',
    extraText: 'ออกจากโรงเรียนเมื่อ ' + actualOutTime + ' น.',
    recorder: recorder || '-',
    altText: 'นักเรียนออกจากโรงเรียนแล้ว: ' + getStudentDisplayName_(st)
  });
}

/** แปลงวันที่เป็นข้อความไทยสั้น เช่น "12 ส.ค. 2569 21:30 น." */
function thaiTimestampText_(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  const tz = Session.getScriptTimeZone();
  let s = Utilities.formatDate(d, tz, 'd MMM yyyy HH:mm');
  const en = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const th = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  en.forEach(function (m, i) { s = s.split(m).join(th[i]); });
  const y = Utilities.formatDate(d, tz, 'yyyy');
  s = s.replace(y, String(Number(y) + 543));
  return s + ' น.';
}

// ============================================================
// 4. Admin APIs (สำหรับหน้า "การแจ้งเตือน LINE")
// ============================================================

function getAllLineBindings_() {
  const sheet = getSheet(CONFIG.SHEET_NAMES.LINE_BINDINGS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colBinding = headers.indexOf('BindingID');
  const colId = headers.indexOf('StudentID');
  const colLine = headers.indexOf('LineUserID');
  const colName = headers.indexOf('ParentDisplayName');
  const colBoundAt = headers.indexOf('BoundAt');
  const colActive = headers.indexOf('Active');
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const st = data[i][colId] ? findStudentById_(String(data[i][colId])) : null;
    out.push({
      BindingID: data[i][colBinding],
      StudentID: data[i][colId],
      LineUserID: data[i][colLine],
      ParentDisplayName: data[i][colName] || 'ผู้ปกครอง',
      BoundAt: data[i][colBoundAt] ? thaiTimestampText_(data[i][colBoundAt]) : '-',
      Active: data[i][colActive],
      StudentName: st ? getStudentDisplayName_(st) : '(ไม่พบนักเรียน)',
      StudentClass: st ? (st.Grade || '-') + '/' + (st.Room || '-') : '-'
    });
  }
  out.sort(function (a, b) { return String(b.BoundAt) > String(a.BoundAt) ? 1 : -1; });
  return out;
}

function countLineLinkedStudents_() {
  const sheet = getSheet(CONFIG.SHEET_NAMES.STUDENTS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colLine = headers.indexOf('LineLinked');
  if (colLine === -1) return 0;
  return data.slice(1).filter(function (r) { return r[colLine] === true; }).length;
}

function api_getLineSettings_(token) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    const bindings = getAllLineBindings_();
    return {
      success: true,
      settings: {
        channelAccessToken: getConfigValue_('LINE_CHANNEL_ACCESS_TOKEN') || '',
        liffId: getConfigValue_('LINE_LIFF_ID') || '',
        notifyScoreAdd: getConfigValue_('LINE_NOTIFY_SCORE_ADD') === 'true',
        contactChannel: getConfigValue_('LINE_CONTACT_CHANNEL') || ''
      },
      stats: {
        hasToken: !!getConfigValue_('LINE_CHANNEL_ACCESS_TOKEN'),
        hasLiff: !!getConfigValue_('LINE_LIFF_ID'),
        totalBindings: bindings.length,
        linkedStudents: countLineLinkedStudents_(),
        bindings: bindings
      }
    };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

function api_saveLineSettings_(token, settings) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!CONFIG.PERMISSIONS[session.role] || !CONFIG.PERMISSIONS[session.role].editDelete) {
      return { success: false, message: 'คุณไม่มีสิทธิ์จัดการการตั้งค่า LINE' };
    }
    setConfigValue_('LINE_CHANNEL_ACCESS_TOKEN', String(settings.channelAccessToken || '').trim(), 'LINE OA Channel Access Token (Messaging API)');
    setConfigValue_('LINE_LIFF_ID', String(settings.liffId || '').trim(), 'LINE LIFF App ID');
    setConfigValue_('LINE_NOTIFY_SCORE_ADD', settings.notifyScoreAdd ? 'true' : 'false', 'แจ้งเตือนเมื่อนักเรียนได้คะแนนเพิ่ม (true/false)');
    setConfigValue_('LINE_CONTACT_CHANNEL', String(settings.contactChannel || '').trim(), 'ช่องทางติดต่อกลับโรงเรียน');
    return { success: true };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

function api_addLineBinding_(token, studentId, lineUserId, parentDisplayName) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!CONFIG.PERMISSIONS[session.role] || !CONFIG.PERMISSIONS[session.role].editDelete) {
      return { success: false, message: 'คุณไม่มีสิทธิ์จัดการการเชื่อมต่อ LINE' };
    }
    const st = findStudentById_(String(studentId || '').trim());
    if (!st) return { success: false, message: 'ไม่พบนักเรียน' };
    if (!lineUserId) return { success: false, message: 'กรุณากรอก LineUserID' };
    const existing = getLineBindingsForStudent_(st.StudentID).filter(function (b) { return b.LineUserID === lineUserId; });
    if (existing.length) return { success: false, message: 'บัญชี LINE นี้ผูกกับนักเรียนคนนี้อยู่แล้ว' };
    const sheet = getSheet(CONFIG.SHEET_NAMES.LINE_BINDINGS);
    sheet.appendRow([Utilities.getUuid(), st.StudentID, lineUserId, parentDisplayName || getStudentDisplayName_(st), new Date(), true]);
    setStudentLineLinked_(st.StudentID, true);
    return { success: true };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

function api_removeLineBinding_(token, bindingId) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!CONFIG.PERMISSIONS[session.role] || !CONFIG.PERMISSIONS[session.role].editDelete) {
      return { success: false, message: 'คุณไม่มีสิทธิ์จัดการการเชื่อมต่อ LINE' };
    }
    const sheet = getSheet(CONFIG.SHEET_NAMES.LINE_BINDINGS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colBinding = headers.indexOf('BindingID');
    for (let i = data.length - 1; i >= 1; i--) {
      if (data[i][colBinding] === bindingId) {
        const studentId = data[i][headers.indexOf('StudentID')];
        sheet.deleteRow(i + 1);
        // ถ้านักเรียนไม่มี binding อื่นเหลืออยู่ → reset LineLinked
        if (!getLineBindingsForStudent_(studentId).length) setStudentLineLinked_(studentId, false);
        return { success: true };
      }
    }
    return { success: false, message: 'ไม่พบรายการเชื่อมต่อนี้' };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

/** ส่งข้อความทดสอบไปยังผู้ปกครองคนแรกที่ผูก LINE ไว้ */
function api_testLineNotification_(token) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    const bindings = getAllLineBindings_();
    const active = bindings.filter(function (b) { return b.Active !== false && b.LineUserID; });
    if (!active.length) return { success: false, message: 'ยังไม่มีผู้ปกครองที่ผูก LINE — สร้างการเชื่อมต่อก่อนทดสอบ' };
    const testMsg = buildEventFlexMessage_({
      title: '🔔 ทดสอบการแจ้งเตือน LINE',
      accentColor: '#152A52',
      studentName: active[0].StudentName,
      studentClass: active[0].StudentClass,
      timestampText: thaiTimestampText_(new Date()),
      eventText: 'ข้อความทดสอบจากระบบ — หากเห็นข้อความนี้แสดงว่าการตั้งค่า LINE ถูกต้อง',
      recorder: session.fullName,
      contact: getConfigValue_('LINE_CONTACT_CHANNEL') || CONFIG.SCHOOL_INFO.PHONE || '',
      appName: CONFIG.APP_NAME
    });
    const r = sendLinePush_(active[0].LineUserID, testMsg);
    if (r.sent) return { success: true, message: 'ส่งข้อความทดสอบไปยัง ' + active[0].ParentDisplayName + ' เรียบร้อยแล้ว' };
    return { success: false, message: 'ส่งไม่สำเร็จ: ' + (r.reason || ('HTTP ' + r.code + ' — ' + (r.body || ''))) };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

// ============================================================
// 5. LIFF APIs (ผู้ปกครองเรียกจากหน้า LIFF — ตรวจความสัมพันธ์ก่อนเสมอ)
// ============================================================

/** ตรวจสอบว่า LINE user มีสิทธิ์เข้าถึงนักเรียนคนนี้ (ต้องผูกบัญชีแล้ว) */
function verifyLiffBinding_(lineUserId, studentId) {
  const list = getLineBindingsForUser_(lineUserId).filter(function (b) {
    return b.StudentID === String(studentId || '').trim();
  });
  return list.length ? list[0] : null;
}

/**
 * ผูกบัญชี LINE กับนักเรียน โดยยืนยันเบอร์โทรผู้ปกครอง + ตั้งรหัส PIN ส่วนตัว
 * (PIN ใช้ยืนยันการยกเลิกการเชื่อมต่อ/เปลี่ยน PIN — ความปลอดภัยชั้นที่ 2)
 */
/** เบอร์โทรไทย: ป้องกันเลข 0 หน้าหายตอนนำเข้าจาก Excel (825633030 → 0825633030) */
function normalizePhone_(p) {
  let s = String(p == null ? '' : p).trim().replace(/[-\s]/g, '');
  if (/^[89]\d{8}$/.test(s)) s = '0' + s;       // มือถือ 9 หลัก (เลข 0 หน้าหายตอนนำเข้า Excel)
  else if (/^[2-7]\d{7}$/.test(s)) s = '0' + s; // เบอร์บ้าน 8 หลัก (เลข 0 หน้าหาย)
  return s;
}

function apiLiffBind(lineUserId, studentId, parentPhone, pin) {
  try {
    if (!lineUserId || !studentId || !parentPhone || !pin) {
      return { success: false, message: 'กรุณากรอกข้อมูลให้ครบ (รหัสนักเรียน, เบอร์โทร, รหัส PIN)' };
    }
    pin = String(pin).trim();
    if (!/^\d{4,6}$/.test(pin)) {
      return { success: false, message: 'รหัส PIN ต้องเป็นตัวเลข 4–6 หลัก' };
    }
    const st = findStudentById_(String(studentId).trim());
    if (!st) return { success: false, message: 'ไม่พบรหัสนักเรียนนี้ในระบบ' };
    const parent = findParentByStudentId_(st.StudentID);
    if (!parent || !parent.ParentPhone) {
      return { success: false, message: 'ไม่พบข้อมูลเบอร์โทรผู้ปกครองของนักเรียนคนนี้ในระบบ' };
    }
    const inputPhone = normalizePhone_(parentPhone);
    const storedPhone = normalizePhone_(parent.ParentPhone);
    if (inputPhone !== storedPhone) {
      return { success: false, message: 'เบอร์โทรศัพท์ไม่ตรงกับข้อมูลผู้ปกครองของนักเรียนคนนี้' };
    }
    const existing = getLineBindingsForStudent_(st.StudentID).filter(function (b) { return b.LineUserID === lineUserId; });
    if (existing.length) {
      return { success: true, alreadyBound: true, studentId: st.StudentID, parentName: parent.ParentName };
    }
    const sheet = getSheet(CONFIG.SHEET_NAMES.LINE_BINDINGS);
    sheet.appendRow([Utilities.getUuid(), st.StudentID, lineUserId, parent.ParentName || 'ผู้ปกครอง', new Date(), true, hashPassword_(pin)]);
    setStudentLineLinked_(st.StudentID, true);
    return { success: true, studentId: st.StudentID, parentName: parent.ParentName };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

/** ยกเลิกการเชื่อมต่อ ต้องยืนยันด้วยรหัส PIN */
function apiLiffUnbind(lineUserId, studentId, pin) {
  try {
    const sheet = getSheet(CONFIG.SHEET_NAMES.LINE_BINDINGS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colBinding = headers.indexOf('BindingID');
    const colLine = headers.indexOf('LineUserID');
    const colId = headers.indexOf('StudentID');
    const colPin = headers.indexOf('PinCode');
    const colActive = headers.indexOf('Active');
    for (let i = 1; i < data.length; i++) {
      if (data[i][colLine] === lineUserId && data[i][colId] === String(studentId).trim() && data[i][colActive] !== false) {
        const pinHash = data[i][colPin];
        if (!pinHash || hashPassword_(String(pin || '').trim()) !== String(pinHash)) {
          return { success: false, message: 'รหัส PIN ไม่ถูกต้อง' };
        }
        sheet.getRange(i + 1, colActive + 1).setValue(false);
        if (!getLineBindingsForStudent_(String(studentId).trim()).length) {
          setStudentLineLinked_(String(studentId).trim(), false);
        }
        return { success: true };
      }
    }
    return { success: false, message: 'ไม่พบการเชื่อมต่อของนักเรียนคนนี้' };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

/** เปลี่ยนรหัส PIN ต้องยืนยัน PIN เดิม */
function apiLiffChangePin(lineUserId, studentId, oldPin, newPin) {
  try {
    oldPin = String(oldPin || '').trim();
    newPin = String(newPin || '').trim();
    if (!/^\d{4,6}$/.test(newPin)) return { success: false, message: 'รหัส PIN ใหม่ต้องเป็นตัวเลข 4–6 หลัก' };
    const sheet = getSheet(CONFIG.SHEET_NAMES.LINE_BINDINGS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colLine = headers.indexOf('LineUserID');
    const colId = headers.indexOf('StudentID');
    const colPin = headers.indexOf('PinCode');
    const colActive = headers.indexOf('Active');
    for (let i = 1; i < data.length; i++) {
      if (data[i][colLine] === lineUserId && data[i][colId] === String(studentId).trim() && data[i][colActive] !== false) {
        const pinHash = data[i][colPin];
        if (!pinHash || hashPassword_(oldPin) !== String(pinHash)) {
          return { success: false, message: 'รหัส PIN เดิมไม่ถูกต้อง' };
        }
        sheet.getRange(i + 1, colPin + 1).setValue(hashPassword_(newPin));
        return { success: true };
      }
    }
    return { success: false, message: 'ไม่พบการเชื่อมต่อของนักเรียนคนนี้' };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

/** รายชื่อนักเรียนที่ LINE user นี้ผูกไว้ (หน้าแรก LIFF) */
function apiLiffGetMyStudents(lineUserId) {
  try {
    if (!lineUserId) return { success: false, message: 'ไม่พบข้อมูลบัญชี LINE' };
    const bindings = getLineBindingsForUser_(lineUserId);
    const students = bindings.map(function (b) {
      const st = findStudentById_(b.StudentID);
      return st ? {
        studentId: st.StudentID,
        name: getStudentDisplayName_(st),
        className: (st.Grade || '-') + '/' + (st.Room || '-'),
        currentScore: st.CurrentScore
      } : { studentId: b.StudentID, name: '(ไม่พบข้อมูล)', className: '-', currentScore: 0 };
    });
    return { success: true, students: students };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

/** ดูคะแนนความประพฤติ + เกณฑ์แจ้งเตือน + สถานะหนังสือเชิญ — เฉพาะผู้ปกครองที่ผูกบัญชีแล้ว */
function apiLiffGetStudentScore(lineUserId, studentId) {
  try {
    const binding = verifyLiffBinding_(lineUserId, studentId);
    if (!binding) {
      return { success: false, message: 'คุณไม่ได้รับอนุญาตให้ดูข้อมูลนักเรียนคนนี้ — กรุณาผูกบัญชีกับรหัสนักเรียนที่ถูกต้องก่อน' };
    }
    const st = findStudentById_(binding.StudentID);
    if (!st) return { success: false, message: 'ไม่พบข้อมูลนักเรียน' };
    const scoreSummary = getStudentScoreSummary_(binding.StudentID, st.CurrentScore);
    const history = getRecentScoreLogs_(binding.StudentID, 10);
    const currentScore = Number(st.CurrentScore) || 0;
    // เกณฑ์แจ้งเตือนเชิญผู้ปกครอง (80/60/40/20/0)
    const thresholds = [80, 60, 40, 20, 0];
    let crossedThreshold = null;
    for (let t = 0; t < thresholds.length; t++) {
      if (currentScore <= thresholds[t]) { crossedThreshold = thresholds[t]; break; }
    }
    return {
      success: true,
      student: {
        studentId: st.StudentID,
        name: getStudentDisplayName_(st),
        className: (st.Grade || '-') + '/' + (st.Room || '-')
      },
      scoreSummary: scoreSummary,
      history: history,
      threshold: crossedThreshold,
      letters: getStudentLetters_(binding.StudentID).map(function (l) {
        return {
          letterNo: l.LetterNo || 'ยังไม่มีเลขที่',
          status: l.Status,
          statusText: l.Status === 'confirmed' ? 'ออกเอกสารแล้ว' : (l.Status === 'draft' ? 'รอออกเอกสาร' : l.Status),
          createdAt: thaiTimestampText_(l.CreatedAt),
          createdBy: l.CreatedBy || '-'
        };
      })
    };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

/** หนังสือเชิญผู้ปกครองของนักเรียนคนหนึ่ง (เรียงล่าสุดก่อน) */
function getStudentLetters_(studentId) {
  const sheet = getSheet(CONFIG.SHEET_NAMES.INVITATION_LETTERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colId = headers.indexOf('StudentID');
  const letters = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][colId] === studentId) letters.push(rowToObject_(headers, data[i]));
  }
  letters.sort(function (a, b) { return new Date(b.CreatedAt) - new Date(a.CreatedAt); });
  return letters;
}

/** การแจ้งเตือนล่าสุดของนักเรียน (จาก Timeline — เหตุการณ์ที่ระบบแจ้ง/บันทึก) */
function apiLiffGetNotifications(lineUserId, studentId) {
  try {
    const binding = verifyLiffBinding_(lineUserId, studentId);
    if (!binding) {
      return { success: false, message: 'คุณไม่ได้รับอนุญาตให้ดูข้อมูลนักเรียนคนนี้' };
    }
    const events = getStudentTimeline_(binding.StudentID).slice(0, 15).map(function (ev) {
      return {
        type: ev.EventType,
        title: ev.Title,
        description: ev.Description || '',
        timestamp: thaiTimestampText_(ev.Timestamp)
      };
    });
    return { success: true, events: events };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

/** ผู้ปกครองยื่นคำร้องขอออกนอกโรงเรียนผ่าน LINE */
function apiLiffSubmitLeave(lineUserId, studentId, reason, leaveDate, outTime, inTime) {
  try {
    const binding = getLineBindingsForUser_(lineUserId).filter(function (b) { return b.StudentID === String(studentId).trim(); });
    if (!binding.length) {
      return { success: false, message: 'คุณไม่ได้รับอนุญาตให้ยื่นคำร้องแทนนักเรียนคนนี้ — กรุณาผูกบัญชีก่อน' };
    }
    reason = String(reason || '').trim();
    leaveDate = String(leaveDate || '').trim();
    outTime = String(outTime || '').trim();
    inTime = String(inTime || '').trim();
    if (!reason || !leaveDate || !outTime || !inTime) return { success: false, message: 'กรุณากรอกเหตุผล วันที่ขอออก และเวลาที่ขอออก/ขอกลับให้ครบ' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(leaveDate)) {
      return { success: false, message: 'รูปแบบวันที่ไม่ถูกต้อง' };
    }
    if (!/^\d{2}:\d{2}$/.test(outTime) || !/^\d{2}:\d{2}$/.test(inTime)) {
      return { success: false, message: 'รูปแบบเวลาไม่ถูกต้อง' };
    }
    const sheet = getSheet(CONFIG.SHEET_NAMES.LEAVE_REQUESTS);
    ensureLeaveRequestDateColumn_();
    const requestId = Utilities.getUuid();
    const now = new Date();
    const nextRow = sheet.getLastRow() + 1;
    // บันทึกวันที่/เวลาเป็นข้อความล้วน (ตั้ง Format 'Plain Text' ก่อนเขียน + เขียนซ้ำหลังตั้ง Format)
    // ป้องกัน Google Sheets แปลง "10:00" เป็นวันที่ (1899-12-30 ...) ทำให้ Flex แสดงเวลาผิด
    sheet.getRange(nextRow, 4, 1, 3).setNumberFormat('@');
    sheet.appendRow([requestId, binding[0].StudentID, reason, outTime, inTime, leaveDate, 'pending', '', '', '', '', '', now, now]);
    sheet.getRange(nextRow, 4, 1, 3).setNumberFormat('@');
    sheet.getRange(nextRow, 4, 1, 3).setValues([[outTime, inTime, leaveDate]]);
    addTimelineEvent_(binding[0].StudentID, 'leave',
      'ผู้ปกครองยื่นคำร้องขอออกนอกโรงเรียนผ่าน LINE: ' + reason,
      'วันที่ ' + leaveDate + ' · ขอออก ' + outTime + ' น. · ขอกลับ ' + inTime + ' น. · ผ่าน LINE',
      'ผู้ปกครอง (LINE)');
    return { success: true, requestId: requestId };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

/**
 * ตรวจสอบว่า Sheet LeaveRequests มีคอลัมน์ RequestedDate แล้วหรือยัง
 * ถ้ายังไม่มี → เพิ่มคอลัมน์ถัดจาก RequestedInTime (กันข้อมูลเดิมเลื่อน) + เขียนหัวคอลัมน์
 */
function ensureLeaveRequestDateColumn_() {
  const sheet = getSheet(CONFIG.SHEET_NAMES.LEAVE_REQUESTS);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.indexOf('RequestedDate') !== -1) return;
  const colIn = headers.indexOf('RequestedInTime'); // 0-based index
  let newColPos; // 1-based position ของคอลัมน์ใหม่ (ถัดจาก RequestedInTime)
  if (colIn !== -1) {
    // RequestedInTime อยู่ 1-based ตำแหน่ง colIn+1 → แทรกคอลัมน์ใหม่ที่ตำแหน่ง colIn+2
    sheet.insertColumnAfter(colIn + 1);
    newColPos = colIn + 2;
  } else {
    sheet.insertColumnAfter(headers.length);
    newColPos = headers.length + 1;
  }
  sheet.getRange(1, newColPos).setValue('RequestedDate')
    .setFontWeight('bold').setBackground('#152A52').setFontColor('#FFFFFF');
  Logger.log('ensureLeaveRequestDateColumn_: เพิ่มคอลัมน์ RequestedDate แล้ว');
}

/** แปลงค่าเวลาจาก Sheet (อาจเป็น Date ที่เพี้ยนจาก Excel epoch) เป็น HH:mm */
function formatLeaveTime_(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (!isNaN(d.getTime())) {
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    return h + ':' + m;
  }
  return String(v);
}

/** แปลงวันที่เป็นข้อความไทยสั้น เช่น "14 ส.ค. 2569" (รองรับทั้ง 'YYYY-MM-DD' และ Date) */
function thaiShortDateText_(v) {
  if (v === undefined || v === null || v === '') return null;
  let day, month, year;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const p = v.split('-');
    day = Number(p[2]); month = Number(p[1]); year = Number(p[0]);
  } else {
    const d = new Date(v);
    if (isNaN(d.getTime())) return null;
    const tz = Session.getScriptTimeZone();
    day = Number(Utilities.formatDate(d, tz, 'd'));
    month = Number(Utilities.formatDate(d, tz, 'M'));
    year = Number(Utilities.formatDate(d, tz, 'yyyy'));
  }
  const th = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return day + ' ' + (th[month] || month) + ' ' + (year + 543);
}

/** ประวัติคะแนนล่าสุดของนักเรียน (แสดงใน LIFF) */
function getRecentScoreLogs_(studentId, limit) {
  const sheet = getSheet(CONFIG.SHEET_NAMES.SCORE_LOGS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colId = headers.indexOf('StudentID');
  const logs = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][colId] === studentId) logs.push(rowToObject_(headers, data[i]));
  }
  logs.sort(function (a, b) { return new Date(b.Timestamp) - new Date(a.Timestamp); });
  return logs.slice(0, limit).map(function (l) {
    return {
      type: l.Type,
      amount: l.Amount,
      reason: l.Reason,
      timestamp: thaiTimestampText_(l.Timestamp),
      recordedByName: l.RecordedByName || '-'
    };
  });
}

/** ค่า LIFF App ID (ใช้แทรกลงในเทมเพลตหน้า Liff.html) */
function getLiffId_() {
  return String(getConfigValue_('LINE_LIFF_ID') || '').trim();
}

// ============================================================
// 6. ข่าว/ประกาศโรงเรียน (LIFF + แจ้งเตือน LINE ทั้งหมดที่ผูก)
// ============================================================

function getAllAnnouncements_() {
  const sheet = getSheet(CONFIG.SHEET_NAMES.ANNOUNCEMENTS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colId = headers.indexOf('AnnouncementID');
  const colTitle = headers.indexOf('Title');
  const colMsg = headers.indexOf('Message');
  const colType = headers.indexOf('Type');
  const colCreated = headers.indexOf('CreatedAt');
  const colActive = headers.indexOf('Active');
  const colBy = headers.indexOf('CreatedBy');
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][colId]) continue;
    out.push({
      announcementId: data[i][colId],
      title: data[i][colTitle],
      message: data[i][colMsg],
      type: data[i][colType] || 'announcement',
      createdAt: data[i][colCreated] ? thaiTimestampText_(data[i][colCreated]) : '-',
      active: data[i][colActive] !== false,
      createdBy: data[i][colBy] || '-'
    });
  }
  out.reverse(); // ใหม่สุดก่อน
  return out;
}

function api_getAnnouncements_(token) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    return { success: true, announcements: getAllAnnouncements_() };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

function api_addAnnouncement_(token, title, message, type, sendLine) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!CONFIG.PERMISSIONS[session.role] || !CONFIG.PERMISSIONS[session.role].editDelete) {
      return { success: false, message: 'คุณไม่มีสิทธิ์ประกาศข่าว' };
    }
    title = String(title || '').trim();
    message = String(message || '').trim();
    if (!title || !message) return { success: false, message: 'กรุณากรอกหัวข้อและเนื้อหาข่าว' };
    const sheet = getSheet(CONFIG.SHEET_NAMES.ANNOUNCEMENTS);
    sheet.appendRow([Utilities.getUuid(), title, message, type || 'announcement', new Date(), true, session.fullName]);
    let broadcast = null;
    if (sendLine) {
      broadcast = broadcastAnnouncement_(title, message, type || 'announcement');
    }
    return { success: true, broadcast: broadcast };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

function api_deleteAnnouncement_(token, announcementId) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!CONFIG.PERMISSIONS[session.role] || !CONFIG.PERMISSIONS[session.role].editDelete) {
      return { success: false, message: 'คุณไม่มีสิทธิ์ลบประกาศ' };
    }
    const sheet = getSheet(CONFIG.SHEET_NAMES.ANNOUNCEMENTS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colId = headers.indexOf('AnnouncementID');
    for (let i = data.length - 1; i >= 1; i--) {
      if (data[i][colId] === announcementId) {
        sheet.deleteRow(i + 1);
        return { success: true };
      }
    }
    return { success: false, message: 'ไม่พบประกาศนี้' };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

/** ผู้ปกครองดูข่าว/ประกาศ (เปิดจาก LIFF — ข่าวโรงเรียนไม่ใช่ข้อมูลส่วนบุคคล) */
function apiLiffGetAnnouncements(lineUserId) {
  try {
    const list = getAllAnnouncements_().filter(function (a) { return a.active; });
    return { success: true, announcements: list.slice(0, 20) };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

/** LINE user ทั้งหมดที่ผูกบัญชี (ไม่ซ้ำ) สำหรับส่งข่าว/ประกาศ */
function getAllActiveBindingsUsers_() {
  const sheet = getSheet(CONFIG.SHEET_NAMES.LINE_BINDINGS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colLine = headers.indexOf('LineUserID');
  const colActive = headers.indexOf('Active');
  const seen = {};
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][colActive] === false) continue;
    const uid = data[i][colLine];
    if (uid && !seen[uid]) { seen[uid] = true; out.push(uid); }
  }
  return out;
}

/** Flex สำหรับข่าว/ประกาศ */
function buildAnnouncementFlex_(title, message, type) {
  const typeLabel = { announcement: '📢 ประกาศโรงเรียน', exam: '📝 กำหนดการสอบ', holiday: '🏖️ วันหยุด/ปิดภาคเรียน', activity: '🏫 กิจกรรมโรงเรียน' };
  return {
    type: 'flex',
    altText: (typeLabel[type] || '📢 ประกาศโรงเรียน') + ': ' + title,
    contents: {
      type: 'bubble',
      size: 'giga',
      header: {
        type: 'box', layout: 'horizontal', backgroundColor: '#152A52', paddingAll: '14px',
        contents: [{ type: 'text', text: typeLabel[type] || '📢 ประกาศโรงเรียน', color: '#D9B94A', weight: 'bold', size: 'lg', flex: 1, wrap: true }]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
        contents: [
          { type: 'text', text: String(title), color: '#1A2233', weight: 'bold', size: 'md', wrap: true },
          { type: 'text', text: String(message), color: '#5B6478', size: 'sm', wrap: true }
        ]
      },
      footer: {
        type: 'box', layout: 'horizontal', backgroundColor: '#F6F7FB', paddingAll: '10px',
        contents: [{ type: 'text', text: CONFIG.APP_NAME, color: '#8C96B3', size: 'xs', flex: 1, gravity: 'center' }]
      }
    }
  };
}

/** ส่งข่าว/ประกาศไปยังผู้ปกครองทุกคนที่ผูกบัญชี (ไม่ซ้ำผู้ใช้) */
function broadcastAnnouncement_(title, message, type) {
  const users = getAllActiveBindingsUsers_();
  const msg = buildAnnouncementFlex_(title, message, type);
  let sent = 0;
  const errors = [];
  users.forEach(function (uid) {
    try {
      const r = sendLinePush_(uid, msg);
      if (r.sent) sent++;
      else errors.push(r.reason || ('HTTP ' + r.code));
    } catch (e) { errors.push(e.message); }
  });
  if (users.length) {
    logLineNotification_('', 'BROADCAST_ANNOUNCEMENT: ' + title, sent, errors);
  }
  return { sent: sent, total: users.length };
}

// ============================================================
// Public Functions (สำหรับ google.script.run)
// ============================================================
function apiGetLineSettings(token) { return api_getLineSettings_(token); }
function apiSaveLineSettings(token, settings) { return api_saveLineSettings_(token, settings); }
function apiGetLineBindings(token) { return api_getLineSettings_(token); }
function apiAddLineBinding(token, studentId, lineUserId, parentDisplayName) { return api_addLineBinding_(token, studentId, lineUserId, parentDisplayName); }
function apiRemoveLineBinding(token, bindingId) { return api_removeLineBinding_(token, bindingId); }
function apiTestLineNotification(token) { return api_testLineNotification_(token); }
function apiGetAnnouncements(token) { return api_getAnnouncements_(token); }
function apiAddAnnouncement(token, title, message, type, sendLine) { return api_addAnnouncement_(token, title, message, type, sendLine); }
function apiDeleteAnnouncement(token, announcementId) { return api_deleteAnnouncement_(token, announcementId); }
