// ============================================
// LETTERSERVICE.GS - จัดการหนังสือเชิญผู้ปกครอง (สร้าง/ยืนยัน/ส่งออก PDF)
// ============================================

// แก้ไขรูปแบบ/ข้อความของหนังสือได้จาก Google Docs นี้โดยตรง
// ไม่ต้องแก้ไขโค้ดเพื่อปรับหน้าตาของแบบฟอร์ม
const DEFAULT_LETTER_TEMPLATE_DOC_ID = '1WCXNjjx5oNF2KfljK3XXzoNw71LRWRusTI60rBrYCPQ';
const LETTER_NO_FIXED_PREFIX = 'ศธ 04293.43/';

/**
 * คืนค่า Google Docs template ที่ใช้สร้างหนังสือเชิญ
 * ค่าในชีต Config (LETTER_TEMPLATE_DOC_ID) ใช้เปลี่ยนไปยังเทมเพลตฉบับใหม่ได้ในอนาคต
 */
function getOrCreateLetterTemplate_() {
  const templateId = getConfigValue_('LETTER_TEMPLATE_DOC_ID') || DEFAULT_LETTER_TEMPLATE_DOC_ID;
  try {
    DocumentApp.openById(templateId);
  } catch (err) {
    throw new Error('ไม่สามารถเปิด Google Docs template ได้ กรุณาตรวจสอบค่า LETTER_TEMPLATE_DOC_ID และสิทธิ์เข้าถึงไฟล์');
  }

  // บันทึกค่าเริ่มต้นไว้ใน Config เพียงครั้งเดียว เพื่อให้เปลี่ยนเทมเพลตได้ภายหลังจากชีต
  if (!getConfigValue_('LETTER_TEMPLATE_DOC_ID')) {
    setConfigValue_(
      'LETTER_TEMPLATE_DOC_ID',
      templateId,
      'Google Docs template สำหรับหนังสือเชิญผู้ปกครอง — แก้ไขรูปแบบจากไฟล์นี้โดยตรง'
    );
  }
  return templateId;
}

/** สร้างเลขที่หนังสือจากเลขลำดับที่เจ้าหน้าที่กรอก เช่น ว116 */
function buildLetterNo_(suffix) {
  const manualNo = String(suffix || '').trim();
  if (!/^ว\d+$/.test(manualNo)) {
    throw new Error('กรุณากรอกเลขลำดับในรูปแบบ ว116');
  }
  return LETTER_NO_FIXED_PREFIX + manualNo;
}

function isLetterNoInUse_(letterNo, excludeLetterId) {
  const sheet = getSheet(CONFIG.SHEET_NAMES.INVITATION_LETTERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('LetterID');
  const noCol = headers.indexOf('LetterNo');
  return data.slice(1).some(row => row[idCol] !== excludeLetterId && row[noCol] === letterNo);
}

/**
 * แปลงวันที่เป็นข้อความไทยแบบเต็ม "วันพฤหัสบดี ที่ 30 เดือน มกราคม พ.ศ. 2568"
 */
function toThaiFullDateText_(dateStr) {
  const d = new Date(dateStr);
  const days = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];
  const months = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  return days[d.getDay()] + ' ที่ ' + d.getDate() + ' เดือน ' + months[d.getMonth()] + ' พ.ศ. ' + (d.getFullYear() + 543);
}

/**
 * วางลายเซ็นลงในย่อหน้าที่กำหนดโดย Google Docs template
 * ใช้ {{SignatureImage}} เพื่อระบุตำแหน่ง หรือใช้บรรทัดว่างก่อนชื่อผู้ลงนามเป็นค่าเดิม
 */
function insertScannedSignature_(body, signerName, signatureFileId) {
  const paragraphs = body.getParagraphs();
  let target = null;
  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i].getText().indexOf('{{SignatureImage}}') !== -1) {
      paragraphs[i].replaceText('\\{\\{SignatureImage\\}\\}', '');
      target = paragraphs[i];
      break;
    }
  }
  if (!target) {
    for (let i = 0; i < paragraphs.length; i++) {
      if (paragraphs[i].getText().trim() === '') {
        const nextText = (paragraphs[i + 1] && paragraphs[i + 1].getText()) || '';
        if (nextText.indexOf(signerName) !== -1) {
          target = paragraphs[i];
          break;
        }
      }
    }
  }
  if (!target) return;

  // appendInlineImage รักษาการจัดแนวของย่อหน้าที่ตั้งไว้ใน Google Docs
  const image = target.appendInlineImage(DriveApp.getFileById(signatureFileId).getBlob());
  image.setWidth(120);
  image.setHeight(45);
}

/**
 * สร้างร่างหนังสือเชิญ (Draft)
 */
function createLetterDraft_(studentId, detail, appointmentDate, appointmentTime, signatureType, createdByLabel, manualNo) {
  const student = findStudentById_(studentId);
  if (!student) throw new Error('ไม่พบข้อมูลนักเรียน');

  const sheet = getSheet(CONFIG.SHEET_NAMES.INVITATION_LETTERS);
  const letterId = Utilities.getUuid();
  const recordSequence = getNextRecordSequence_('letter');
  const letterNo = manualNo ? buildLetterNo_(manualNo) : '';
  if (letterNo && isLetterNoInUse_(letterNo)) throw new Error('เลขที่หนังสือนี้ถูกใช้งานแล้ว');
  const now = new Date();
  const subject = 'ขอเชิญผู้ปกครอง';

  sheet.appendRow([
    letterId, letterNo, studentId, subject, 'draft',
    signatureType || 'เซ็นหลังพิมพ์', '', createdByLabel || 'ระบบอัตโนมัติ', now, ''
  ]);

  addTimelineEvent_(studentId, 'invite',
    'สร้างร่างหนังสือเชิญผู้ปกครอง' + (letterNo ? ' เลขที่ ' + letterNo : ''),
    detail + ' — นัดหมาย ' + appointmentDate + ' เวลา ' + appointmentTime + ' น. — LetterID: ' + letterId,
    createdByLabel || 'ระบบอัตโนมัติ');

  return { letterId, letterNo, detail, appointmentDate, appointmentTime, recordSequence };
}

function createAutoDraftLetter_(studentId, threshold, currentScore) {
  const detail = 'คะแนนความประพฤติลดลงถึงเกณฑ์ ' + threshold + ' คะแนน กรุณาตรวจสอบและนัดหมายวัน-เวลาที่เมนู "หนังสือเชิญผู้ปกครอง"';
  // ยังไม่กำหนดวันนัดหมาย (ให้เจ้าหน้าที่กรอกภายหลัง) — สร้างสถานะ draft ไว้ก่อน
  return createLetterDraft_(studentId, detail, '', '', 'เซ็นหลังพิมพ์', 'ระบบอัตโนมัติ', '');
}

function api_createLetter_(token, payload) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!session.permissions || !session.permissions.editDelete) {
      return { success: false, message: 'คุณไม่มีสิทธิ์สร้างหนังสือเชิญ' };
    }
    if (!payload.studentId) return { success: false, message: 'กรุณาเลือกนักเรียน' };
    if (!payload.detail) return { success: false, message: 'กรุณาระบุรายละเอียดปัญหา' };
    if (!payload.appointmentDate || !payload.appointmentTime) {
      return { success: false, message: 'กรุณาระบุวันและเวลานัดหมาย' };
    }
    if (!payload.letterNoSuffix) return { success: false, message: 'กรุณากรอกเลขลำดับหนังสือ' };

    const result = createLetterDraft_(
      payload.studentId, payload.detail, payload.appointmentDate, payload.appointmentTime,
      payload.signatureType, session.fullName, payload.letterNoSuffix
    );
    logAudit_(session, 'CREATE', CONFIG.SHEET_NAMES.INVITATION_LETTERS, result.letterId, '', 'สร้างร่างหนังสือเชิญ: ' + result.letterNo);

    return {
      success: true,
      letterId: result.letterId,
      letterNo: result.letterNo,
      recordSequence: result.recordSequence
    };
  } catch (err) {
    Logger.log('API error: ' + err.message);
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ กรุณาลองใหม่อีกครั้ง' };
  }
}

function api_getLetters_(token, filters) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

    filters = filters || {};
    const letterCached = getCachedSheetData_(CONFIG.SHEET_NAMES.INVITATION_LETTERS);
    let letters = letterCached.rows.map(row => rowToObject_(letterCached.headers, row));

    if (filters.status && filters.status !== 'all') {
      letters = letters.filter(l => l.Status === filters.status);
    }
    letters.sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt));

    const studentCached = getCachedSheetData_(CONFIG.SHEET_NAMES.STUDENTS);
    const studentMap = {};
    studentCached.rows.forEach(row => {
      const obj = rowToObject_(studentCached.headers, row);
      studentMap[obj.StudentID] = obj;
    });
    letters.forEach(l => {
      const st = studentMap[l.StudentID];
      l.StudentName = st ? (st.Prefix || '') + (st.FirstName || '') + ' ' + (st.LastName || '') : l.StudentID;
    });

    const colStatus = letterCached.headers.indexOf('Status');
    const allRows = letterCached.rows;
    const draftCount = allRows.filter(r => r[colStatus] === 'draft').length;
    const confirmedCount = allRows.filter(r => r[colStatus] === 'confirmed').length;

    return { success: true, letters: letters, draftCount: draftCount, confirmedCount: confirmedCount, totalCount: allRows.length };
  } catch (err) {
    Logger.log('API error: ' + err.message);
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ กรุณาลองใหม่อีกครั้ง' };
  }
}

/**
 * สร้าง PDF ตัวอย่างจาก Google Docs template ล่าสุด
 * ไม่มีการบันทึกลง InvitationLetters, Timeline หรือ Audit Log
 */
function api_previewLetter_(token, payload) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!session.permissions || !session.permissions.editDelete) {
      return { success: false, message: 'คุณไม่มีสิทธิ์พรีวิวหนังสือเชิญ' };
    }
    if (!payload.studentId || !payload.detail || !payload.appointmentDate || !payload.appointmentTime || !payload.letterNoSuffix) {
      return { success: false, message: 'กรุณากรอกข้อมูลหนังสือให้ครบก่อนพรีวิว' };
    }

    const student = findStudentById_(payload.studentId);
    if (!student) return { success: false, message: 'ไม่พบข้อมูลนักเรียน' };

    const letterNo = buildLetterNo_(payload.letterNoSuffix);
    const templateId = getOrCreateLetterTemplate_();
    const targetFolder = getLetterPreviewFolder_();
    const copyName = 'ตัวอย่าง_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    const copyFile = DriveApp.getFileById(templateId).makeCopy(copyName, targetFolder);
    const copyDoc = DocumentApp.openById(copyFile.getId());
    const body = copyDoc.getBody();
    const school = CONFIG.SCHOOL_INFO;
    const sig = CONFIG.SIGNER_INFO;
    const replacements = {
      '{{LetterNo}}': letterNo,
      '{{SchoolName}}': school.NAME,
      '{{SchoolAddress}}': school.ADDRESS,
      '{{SchoolPostalCode}}': school.POSTAL_CODE || '',
      '{{IssueDate}}': toThaiDateServer_(new Date()),
      '{{StudentPrefix}}': student.Prefix || '',
      '{{StudentName}}': (student.FirstName || '') + ' ' + (student.LastName || ''),
      '{{Grade}}': student.Grade || '',
      '{{Room}}': student.Room || '',
      '{{Detail}}': payload.detail,
      '{{LocationDetail}}': school.LOCATION_DETAIL,
      '{{AppointmentDateText}}': toThaiFullDateText_(payload.appointmentDate),
      '{{AppointmentTime}}': payload.appointmentTime,
      '{{SignerName}}': sig.NAME,
      '{{SignerPosition}}': sig.POSITION,
      '{{SignerPositionLine1}}': String(sig.POSITION).split('\n')[0] || '',
      '{{SignerPositionLine2}}': String(sig.POSITION).split('\n').slice(1).join(' ') || '',
      '{{Department}}': school.DEPARTMENT,
      '{{Phone}}': school.PHONE,
      '{{Email}}': school.EMAIL,
      '{{Motto}}': school.MOTTO,
      '{{SignatureBlock}}': payload.signatureType === 'เซ็นหลังพิมพ์' ? '.........................................' : ''
    };
    Object.keys(replacements).forEach(key => body.replaceText(key.replace(/[{}]/g, '\\$&'), replacements[key]));

    const sigFileId = getConfigValue_('LETTER_SIGNATURE_FILE_ID');
    if (payload.signatureType === 'ลายเซ็นสแกน' && sigFileId) {
      insertScannedSignature_(body, sig.NAME, sigFileId);
    } else {
      body.replaceText('\\{\\{SignatureImage\\}\\}', '');
    }

    copyDoc.saveAndClose();
    const pdfFile = targetFolder.createFile(DriveApp.getFileById(copyFile.getId()).getAs('application/pdf'))
      .setName(copyName + '.pdf');
    DriveApp.getFileById(copyFile.getId()).setTrashed(true);

    return { success: true, pdfUrl: pdfFile.getUrl(), pdfFileId: pdfFile.getId() };
  } catch (err) {
    Logger.log('api_previewLetter_ error: ' + err.message);
    return { success: false, message: 'ไม่สามารถสร้างไฟล์ตัวอย่างได้ กรุณาลองใหม่อีกครั้ง' };
  }
}

/**
 * ยืนยันออกเอกสารจริง (ต้องกรอกวัน-เวลานัดหมายก่อน หากยังไม่มี)
 */
function api_confirmLetter_(token, letterId, appointmentDate, appointmentTime, letterNoSuffix) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!session.permissions || !session.permissions.editDelete) {
      return { success: false, message: 'คุณไม่มีสิทธิ์ยืนยันออกเอกสาร' };
    }

    const sheet = getSheet(CONFIG.SHEET_NAMES.INVITATION_LETTERS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colId = headers.indexOf('LetterID');

    let rowIndex = -1, letterObj = null;
    for (let i = 1; i < data.length; i++) {
      if (data[i][colId] === letterId) { rowIndex = i; letterObj = rowToObject_(headers, data[i]); break; }
    }
    if (rowIndex === -1) return { success: false, message: 'ไม่พบหนังสือเชิญนี้' };
    if (letterObj.Status !== 'draft') return { success: false, message: 'หนังสือนี้ถูกดำเนินการไปแล้ว' };

    const student = findStudentById_(letterObj.StudentID);
    if (!student) return { success: false, message: 'ไม่พบข้อมูลนักเรียน' };

    const timeline = getStudentTimeline_(letterObj.StudentID);
    const relatedEvent = timeline.find(ev => ev.Description && ev.Description.indexOf('LetterID: ' + letterObj.LetterID) !== -1)
      || timeline.find(ev => letterObj.LetterNo && ev.Title && ev.Title.indexOf(letterObj.LetterNo) !== -1);
    let detail = '';
    let apptDate = appointmentDate, apptTime = appointmentTime;
    if (relatedEvent && relatedEvent.Description) {
      const parts = relatedEvent.Description.split(' — นัดหมาย ');
      detail = parts[0] || '';
      if (!apptDate && parts[1]) {
        const m = parts[1].match(/^(.*) เวลา (.*) น\.$/);
        if (m) { apptDate = apptDate || m[1]; apptTime = apptTime || m[2]; }
      }
    }
    if (!apptDate || !apptTime) {
      return { success: false, message: 'กรุณาระบุวันและเวลานัดหมายก่อนยืนยันออกเอกสาร' };
    }

    if (!letterObj.LetterNo) {
      const letterNo = buildLetterNo_(letterNoSuffix);
      if (isLetterNoInUse_(letterNo, letterId)) return { success: false, message: 'เลขที่หนังสือนี้ถูกใช้งานแล้ว' };
      sheet.getRange(rowIndex + 1, headers.indexOf('LetterNo') + 1).setValue(letterNo);
      letterObj.LetterNo = letterNo;
    }

    const templateId = getOrCreateLetterTemplate_();
    const templateFile = DriveApp.getFileById(templateId);
    const targetFolder = getLetterFolder_(student.Grade);

    const copyName = letterObj.LetterNo.replace(/[\/\s]/g, '_') + '_' + letterObj.StudentID;
    const copyFile = templateFile.makeCopy(copyName, targetFolder);
    const copyDoc = DocumentApp.openById(copyFile.getId());
    const body = copyDoc.getBody();

    const sig = CONFIG.SIGNER_INFO;
    const school = CONFIG.SCHOOL_INFO;
    const sigFileId = getConfigValue_('LETTER_SIGNATURE_FILE_ID');

    const replacements = {
      '{{LetterNo}}': letterObj.LetterNo,
      '{{SchoolName}}': school.NAME,
      '{{SchoolAddress}}': school.ADDRESS,
      '{{SchoolPostalCode}}': school.POSTAL_CODE || '',
      '{{IssueDate}}': toThaiDateServer_(new Date()),
      '{{StudentPrefix}}': student.Prefix || '',
      '{{StudentName}}': (student.FirstName || '') + ' ' + (student.LastName || ''),
      '{{Grade}}': student.Grade || '',
      '{{Room}}': student.Room || '',
      '{{Detail}}': detail || '-',
      '{{LocationDetail}}': school.LOCATION_DETAIL,
      '{{AppointmentDateText}}': toThaiFullDateText_(apptDate),
      '{{AppointmentTime}}': apptTime,
      '{{SignerName}}': sig.NAME,
      '{{SignerPosition}}': sig.POSITION,
      '{{SignerPositionLine1}}': String(sig.POSITION).split('\n')[0] || '',
      '{{SignerPositionLine2}}': String(sig.POSITION).split('\n').slice(1).join(' ') || '',
      '{{Department}}': school.DEPARTMENT,
      '{{Phone}}': school.PHONE,
      '{{Email}}': school.EMAIL,
      '{{Motto}}': school.MOTTO,
      '{{SignatureBlock}}': letterObj.SignatureType === 'เซ็นหลังพิมพ์' ? '.........................................' : ''
    };
    Object.keys(replacements).forEach(key => body.replaceText(key.replace(/[{}]/g, '\\$&'), replacements[key]));

    // แทรกรูปลายเซ็นโดยเคารพตำแหน่งที่กำหนดใน Google Docs template
    if (letterObj.SignatureType === 'ลายเซ็นสแกน' && sigFileId) {
      insertScannedSignature_(body, sig.NAME, sigFileId);
    } else {
      body.replaceText('\\{\\{SignatureImage\\}\\}', '');
    }

    copyDoc.saveAndClose();

    const pdfBlob = DriveApp.getFileById(copyFile.getId()).getAs('application/pdf');
    const pdfFile = targetFolder.createFile(pdfBlob).setName(copyName + '.pdf');
    DriveApp.getFileById(copyFile.getId()).setTrashed(true);

    sheet.getRange(rowIndex + 1, headers.indexOf('Status') + 1).setValue('confirmed');
    sheet.getRange(rowIndex + 1, headers.indexOf('PdfFileID') + 1).setValue(pdfFile.getId());
    sheet.getRange(rowIndex + 1, headers.indexOf('ConfirmedAt') + 1).setValue(new Date());

    addTimelineEvent_(letterObj.StudentID, 'invite',
      'ออกหนังสือเชิญผู้ปกครองเรียบร้อยแล้ว เลขที่ ' + letterObj.LetterNo,
      'ยืนยันโดย ' + session.fullName, session.fullName);
    logAudit_(session, 'CONFIRM', CONFIG.SHEET_NAMES.INVITATION_LETTERS, letterId, 'draft', 'confirmed');

    // แจ้งเตือนผู้ปกครองผ่าน LINE ว่ามีหนังสือเชิญ — ไม่กระทบงานหลักถ้า LINE error
    try {
      notifyLetterEvent_(letterObj.StudentID, letterObj.LetterNo, detail || '-',
        toThaiFullDateText_(apptDate) + ' ' + apptTime + ' น.', session.fullName, new Date());
    } catch (lineErr) {
      Logger.log('ส่ง LINE แจ้งเตือนหนังสือเชิญไม่สำเร็จ: ' + lineErr.message);
    }

    return { success: true, pdfUrl: pdfFile.getUrl(), pdfFileId: pdfFile.getId() };
  } catch (err) {
    Logger.log('API error: ' + err.message);
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ กรุณาลองใหม่อีกครั้ง' };
  }
}

function toThaiDateServer_(date) {
  const thaiMonths = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  return date.getDate() + ' ' + thaiMonths[date.getMonth()] + ' ' + (date.getFullYear() + 543);
}

// ============================================
// Public Functions (สำหรับ google.script.run)
// ============================================
function apiCreateLetter(token, payload) { return api_createLetter_(token, payload); }
function apiGetLetters(token, filters) { return api_getLetters_(token, filters); }
function apiPreviewLetter(token, payload) { return api_previewLetter_(token, payload); }
function apiConfirmLetter(token, letterId, appointmentDate, appointmentTime, letterNoSuffix) {
  return api_confirmLetter_(token, letterId, appointmentDate, appointmentTime, letterNoSuffix);
}
