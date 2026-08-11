// ============================================
// DRIVESERVICE.GS - จัดการโฟลเดอร์ Google Drive สำหรับเก็บเอกสาร
// ============================================

const DRIVE_ROOT_FOLDER_ID = '1-R2d4CFvwjcgTP7VwfkMbiJ2Gc1KV1VH';

/**
 * หาหรือสร้างโฟลเดอร์ย่อยภายใต้ parent ที่กำหนด
 */
function getOrCreateSubfolder_(parentFolder, name) {
  const it = parentFolder.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parentFolder.createFolder(name);
}

/**
 * คืนค่าโฟลเดอร์ปลายทางสำหรับเก็บ PDF หนังสือเชิญของนักเรียนตามระดับชั้น
 * โครงสร้าง: Root -> ปีการศึกษา XXXX -> หนังสือเชิญผู้ปกครอง -> ระดับชั้น
 */
function getLetterFolder_(grade) {
  const root = DriveApp.getFolderById(DRIVE_ROOT_FOLDER_ID);
  const year = getConfigValue_('CURRENT_ACADEMIC_YEAR') || '2569';
  const yearFolder = getOrCreateSubfolder_(root, 'ปีการศึกษา ' + year);
  const lettersFolder = getOrCreateSubfolder_(yearFolder, 'หนังสือเชิญผู้ปกครอง');
  const gradeFolder = getOrCreateSubfolder_(lettersFolder, grade || 'ไม่ระบุระดับชั้น');
  return gradeFolder;
}

/**
 * คืนค่าโฟลเดอร์ปลายทางสำหรับเก็บรูปนักเรียน
 * โครงสร้าง: Root -> ปีการศึกษา XXXX -> รูปนักเรียน -> ระดับชั้น -> ห้อง
 * ปีที่ใช้คือปีการศึกษาปัจจุบัน ณ ตอนอัปโหลด (ปีที่ถ่ายรูปครั้งแรก ตามที่ล็อกไว้)
 */
function getStudentPhotoFolder_(grade, room) {
  const root = DriveApp.getFolderById(DRIVE_ROOT_FOLDER_ID);
  const year = getConfigValue_('CURRENT_ACADEMIC_YEAR') || '2569';
  const yearFolder = getOrCreateSubfolder_(root, 'ปีการศึกษา ' + year);
  const photoFolder = getOrCreateSubfolder_(yearFolder, 'รูปนักเรียน');
  const gradeFolder = getOrCreateSubfolder_(photoFolder, grade || 'ไม่ระบุระดับชั้น');
  const roomFolder = getOrCreateSubfolder_(gradeFolder, room || 'ไม่ระบุห้อง');
  return roomFolder;
}

/** โฟลเดอร์สำหรับ PDF ตัวอย่าง - ไม่ปะปนกับหนังสือที่ออกจริง */
function getLetterPreviewFolder_() {
  const root = DriveApp.getFolderById(DRIVE_ROOT_FOLDER_ID);
  return getOrCreateSubfolder_(root, 'ตัวอย่างหนังสือเชิญ (Preview)');
}

/**
 * อ่าน/เขียนค่าตั้งค่าระบบจาก Sheet Config (key-value)
 */
function getConfigValue_(key) {
  const sheet = getSheet(CONFIG.SHEET_NAMES.CONFIG);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) return data[i][1];
  }
  return null;
}

function setConfigValue_(key, value, description) {
  const sheet = getSheet(CONFIG.SHEET_NAMES.CONFIG);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value, description || '']);
}
