// ============================================
// LETTERSERVICE.GS - จัดการหนังสือเชิญผู้ปกครอง (สร้าง/ยืนยัน/ส่งออก PDF)
// ============================================

/**
 * หาหรือสร้าง Google Docs Template เปล่าสำหรับหนังสือเชิญ (รันอัตโนมัติครั้งแรกที่ใช้งาน)
 */
function getOrCreateLetterTemplate_() {
  let templateId = getConfigValue_('LETTER_TEMPLATE_DOC_ID');
  if (templateId) {
    try {
      DocumentApp.openById(templateId); // เช็คว่ายังเปิดได้จริง
      return templateId;
    } catch (e) {
      // ไฟล์เดิมอาจถูกลบไปแล้ว สร้างใหม่
    }
  }

  const doc = DocumentApp.create('เทมเพลตหนังสือเชิญผู้ปกครอง (ระบบสร้างอัตโนมัติ)');
  const body = doc.getBody();
  body.clear();

  body.appendParagraph('บันทึกข้อความ').setHeading(DocumentApp.ParagraphHeading.TITLE).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  body.appendParagraph('ที่ {{LetterNo}}').setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  body.appendParagraph('วันที่ {{IssueDate}}').setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  body.appendParagraph('');
  body.appendParagraph('เรื่อง {{Subject}}');
  body.appendParagraph('เรียน ผู้ปกครองของ {{StudentPrefix}}{{StudentName}}');
  body.appendParagraph('');
  body.appendParagraph(
    'ด้วยกลุ่มบริหารกิจการนักเรียน ขอเรียนแจ้งท่านผู้ปกครองทราบว่า นักเรียนชื่อ ' +
    '{{StudentPrefix}}{{StudentName}} ระดับชั้น {{Grade}}/{{Room}} เลขประจำตัว {{StudentID}} ' +
    'มีเรื่องเกี่ยวกับความประพฤติที่ต้องการแจ้งให้ท่านทราบและขอความร่วมมือ ดังรายละเอียดต่อไปนี้'
  );
  body.appendParagraph('');
  body.appendParagraph('รายละเอียด: {{Detail}}');
  body.appendParagraph('คะแนนความประพฤติคงเหลือ: {{CurrentScore}} คะแนน');
  body.appendParagraph('');
  body.appendParagraph(
    'จึงเรียนมาเพื่อโปรดทราบ และขอความกรุณาท่านผู้ปกครองติดต่อกลับมายังโรงเรียน ' +
    'เพื่อร่วมกันหาแนวทางดูแลนักเรียนต่อไป'
  );
  body.appendParagraph('');
  body.appendParagraph('');
  body.appendParagraph('ขอแสดงความนับถือ').setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  body.appendParagraph('');
  body.appendParagraph('{{SignatureBlock}}').setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  body.appendParagraph('({{SignerName}})').setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  body.appendParagraph('{{SignerPosition}}').setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  doc.saveAndClose();

  // ย้ายไปไว้ในโฟลเดอร์ Root ของระบบ (ไม่ปะปนกับ My Drive ทั่วไป)
  const root = DriveApp.getFolderById(DRIVE_ROOT_FOLDER_ID);
  const file = DriveApp.getFileById(doc.getId());
  root.addFile(file);
  DriveApp.getRootFolder().removeFile(file);

  setConfigValue_('LETTER_TEMPLATE_DOC_ID', doc.getId(), 'Google Docs Template สำหรับหนังสือเชิญผู้ปกครอง (แก้ไขเนื้อหาได้ที่ไฟล์นี้)');
  return doc.getId();
}

/**
 * สร้างเลขที่หนังสือถัดไป รูปแบบ ศธ.บก.XXX/ปีการศึกษา
 */
function generateLetterNo_() {
  const year = getConfigValue_('CURRENT_ACADEMIC_YEAR') || '2569';
  const sheet = getSheet(CONFIG.SHEET_NAMES.INVITATION_LETTERS);
  const data = sheet.getDataRange().getValues();
  let maxNum = 0;
  data.slice(1).forEach(row => {
    const no = String(row[1] || ''); // LetterNo
    const match = no.match(/ศธ\.บก\.(\d+)\//);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  });
  const nextNum = String(maxNum + 1).padStart(3, '0');
  return 'ศธ.บก.' + nextNum + '/' + year;
}

/**
 * สร้างร่างหนังสือเชิญ (Draft) - เรียกจากฟอร์มในระบบ หรือเรียกอัตโนมัติจากระบบคะแนน
 */
function createLetterDraft_(studentId, subject, detail, signatureType, createdByLabel) {
  const student = findStudentById_(studentId);
  if (!student) throw new Error('ไม่พบข้อมูลนักเรียน');

  const sheet = getSheet(CONFIG.SHEET_NAMES.INVITATION_LETTERS);
  const letterId = Utilities.getUuid();
  const letterNo = generateLetterNo_();
  const now = new Date();

  sheet.appendRow([
    letterId, letterNo, studentId, subject, 'draft',
    signatureType || 'เซ็นหลังพิมพ์', '', createdByLabel || 'ระบบอัตโนมัติ', now, ''
  ]);

  // เก็บรายละเอียดเนื้อหาไว้ใน Timeline เพื่อดึงมาใช้ตอน generate PDF (เก็บใน Description)
  addTimelineEvent_(studentId, 'invite',
    'สร้างร่างหนังสือเชิญผู้ปกครอง เลขที่ ' + letterNo,
    subject + (detail ? ' — ' + detail : ''),
    createdByLabel || 'ระบบอัตโนมัติ');

  return { letterId, letterNo, detail };
}

/**
 * เรียกจาก ScoreService เมื่อคะแนนข้ามเกณฑ์แจ้งเตือน — สร้างร่างอัตโนมัติ
 */
function createAutoDraftLetter_(studentId, threshold, currentScore) {
  const subject = 'แจ้งพฤติกรรมกรณีคะแนนความประพฤติลดต่ำกว่าเกณฑ์';
  const detail = 'คะแนนความประพฤติของนักเรียนลดลงถึงเกณฑ์ ' + threshold + ' คะแนน (คะแนนคงเหลือ ' + currentScore + ' คะแนน) ระบบจึงสร้างร่างหนังสือเชิญผู้ปกครองให้อัตโนมัติ กรุณาตรวจสอบและยืนยันออกเอกสารที่เมนู "หนังสือเชิญผู้ปกครอง"';
  return createLetterDraft_(studentId, subject, detail, 'เซ็นหลังพิมพ์', 'ระบบอัตโนมัติ');
}

function api_createLetter_(token, payload) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!CONFIG.PERMISSIONS[session.role] || !CONFIG.PERMISSIONS[session.role].editDelete) {
      return { success: false, message: 'คุณไม่มีสิทธิ์สร้างหนังสือเชิญ' };
    }
    if (!payload.studentId) return { success: false, message: 'กรุณาเลือกนักเรียน' };
    if (!payload.subject) return { success: false, message: 'กรุณาระบุเรื่อง' };

    const result = createLetterDraft_(payload.studentId, payload.subject, payload.detail, payload.signatureType, session.fullName);
    logAudit_(session, 'CREATE', CONFIG.SHEET_NAMES.INVITATION_LETTERS, result.letterId, '', 'สร้างร่างหนังสือเชิญ: ' + result.letterNo);

    return { success: true, letterId: result.letterId, letterNo: result.letterNo };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

function api_getLetters_(token, filters) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

    filters = filters || {};
    const sheet = getSheet(CONFIG.SHEET_NAMES.INVITATION_LETTERS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    let letters = data.slice(1).map(row => rowToObject_(headers, row));

    if (filters.status && filters.status !== 'all') {
      letters = letters.filter(l => l.Status === filters.status);
    }

    letters.sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt));

    const studentSheet = getSheet(CONFIG.SHEET_NAMES.STUDENTS);
    const studentData = studentSheet.getDataRange().getValues();
    const studentHeaders = studentData[0];
    const studentMap = {};
    studentData.slice(1).forEach(row => {
      const obj = rowToObject_(studentHeaders, row);
      studentMap[obj.StudentID] = obj;
    });

    letters.forEach(l => {
      const st = studentMap[l.StudentID];
      l.StudentName = st ? (st.Prefix || '') + (st.FirstName || '') + ' ' + (st.LastName || '') : l.StudentID;
    });

    const colStatus = headers.indexOf('Status');
    const allRows = data.slice(1);
    const draftCount = allRows.filter(r => r[colStatus] === 'draft').length;
    const confirmedCount = allRows.filter(r => r[colStatus] === 'confirmed').length;

    return { success: true, letters: letters, draftCount: draftCount, confirmedCount: confirmedCount, totalCount: allRows.length };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

/**
 * ยืนยันออกเอกสารจริง — generate PDF จาก Template แล้วบันทึกลง Drive
 */
function api_confirmLetter_(token, letterId) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!CONFIG.PERMISSIONS[session.role] || !CONFIG.PERMISSIONS[session.role].editDelete) {
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

    // ดึงรายละเอียดล่าสุดจาก Timeline (บันทึกไว้ตอนสร้าง draft)
    const timeline = getStudentTimeline_(letterObj.StudentID);
    const relatedEvent = timeline.find(ev => ev.Title && ev.Title.indexOf(letterObj.LetterNo) !== -1);
    const detail = relatedEvent ? relatedEvent.Description.split(' — ').slice(1).join(' — ') : '';

    const templateId = getOrCreateLetterTemplate_();
    const templateFile = DriveApp.getFileById(templateId);
    const targetFolder = getLetterFolder_(student.Grade);

    const copyName = letterObj.LetterNo.replace(/\//g, '_') + '_' + letterObj.StudentID;
    const copyFile = templateFile.makeCopy(copyName, targetFolder);
    const copyDoc = DocumentApp.openById(copyFile.getId());
    const body = copyDoc.getBody();

    const signatureBlock = letterObj.SignatureType === 'ลายเซ็นสแกน' ? '[ลายเซ็นสแกน — รอเฟสถัดไป]' : '.........................................';

    const replacements = {
      '{{LetterNo}}': letterObj.LetterNo,
      '{{IssueDate}}': toThaiDateServer_(new Date()),
      '{{Subject}}': letterObj.Subject,
      '{{StudentPrefix}}': student.Prefix || '',
      '{{StudentName}}': (student.FirstName || '') + ' ' + (student.LastName || ''),
      '{{Grade}}': student.Grade || '',
      '{{Room}}': student.Room || '',
      '{{StudentID}}': student.StudentID || '',
      '{{Detail}}': detail || '-',
      '{{CurrentScore}}': String(student.CurrentScore),
      '{{SignatureBlock}}': signatureBlock,
      '{{SignerName}}': 'เซ็นชื่อ',
      '{{SignerPosition}}': 'ครูฝ่ายปกครอง'
    };
    Object.keys(replacements).forEach(key => body.replaceText(key.replace(/[{}]/g, '\\$&'), replacements[key]));
    copyDoc.saveAndClose();

    const pdfBlob = DriveApp.getFileById(copyFile.getId()).getAs('application/pdf');
    const pdfFile = targetFolder.createFile(pdfBlob).setName(copyName + '.pdf');
    DriveApp.getFileById(copyFile.getId()).setTrashed(true); // ลบไฟล์ Doc ชั่วคราว เหลือแค่ PDF

    sheet.getRange(rowIndex + 1, headers.indexOf('Status') + 1).setValue('confirmed');
    sheet.getRange(rowIndex + 1, headers.indexOf('PdfFileID') + 1).setValue(pdfFile.getId());
    sheet.getRange(rowIndex + 1, headers.indexOf('ConfirmedAt') + 1).setValue(new Date());

    addTimelineEvent_(letterObj.StudentID, 'invite',
      'ออกหนังสือเชิญผู้ปกครองเรียบร้อยแล้ว เลขที่ ' + letterObj.LetterNo,
      'ยืนยันโดย ' + session.fullName, session.fullName);

    logAudit_(session, 'CONFIRM', CONFIG.SHEET_NAMES.INVITATION_LETTERS, letterId, 'draft', 'confirmed');

    return { success: true, pdfUrl: pdfFile.getUrl(), pdfFileId: pdfFile.getId() };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

function toThaiDateServer_(date) {
  const thaiMonths = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  return date.getDate() + ' ' + thaiMonths[date.getMonth()] + ' ' + (date.getFullYear() + 543);
}

// ============================================
// Public Functions (สำหรับ google.script.run)
// ============================================
function apiCreateLetter(token, payload) {
  return api_createLetter_(token, payload);
}
function apiGetLetters(token, filters) {
  return api_getLetters_(token, filters);
}
function apiConfirmLetter(token, letterId) {
  return api_confirmLetter_(token, letterId);
}