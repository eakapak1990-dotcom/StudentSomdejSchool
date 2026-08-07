// ============================================
// AUTH.GS - ระบบ Login และ Session
// ============================================

/**
 * จัดการ Login — ตรวจสอบ username/password จาก Sheet Users
 */
function handleLogin_(username, password) {
  if (!username || !password) {
    return { success: false, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' };
  }

  const sheet = getSheet(CONFIG.SHEET_NAMES.USERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const colUsername = headers.indexOf('Username');
  const colPasswordHash = headers.indexOf('PasswordHash');
  const colUserID = headers.indexOf('UserID');
  const colFullName = headers.indexOf('FullName');
  const colRole = headers.indexOf('Role');
  const colActive = headers.indexOf('Active');

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[colUsername] === username) {
      if (!row[colActive]) {
        return { success: false, message: 'บัญชีนี้ถูกระงับการใช้งาน' };
      }
      const hashedInput = hashPassword_(password);
      if (hashedInput === row[colPasswordHash]) {
        const token = createSession_(row[colUserID], row[colFullName], row[colRole]);
        sheet.getRange(i + 1, headers.indexOf('LastLogin') + 1).setValue(new Date());

        return {
          success: true,
          token: token,
          user: {
            userId: row[colUserID],
            fullName: row[colFullName],
            role: row[colRole],
            roleLabel: CONFIG.ROLE_LABELS[row[colRole]] || row[colRole],
            permissions: CONFIG.PERMISSIONS[row[colRole]] || {}
          }
        };
      } else {
        return { success: false, message: 'รหัสผ่านไม่ถูกต้อง' };
      }
    }
  }

  return { success: false, message: 'ไม่พบชื่อผู้ใช้นี้ในระบบ' };
}

/**
 * เข้ารหัส password ด้วย SHA-256
 */
function hashPassword_(password) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password);
  return digest.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}

/**
 * สร้าง Session token เก็บใน CacheService
 */
function createSession_(userId, fullName, role) {
  const token = Utilities.getUuid();
  const cache = CacheService.getScriptCache();
  const sessionData = JSON.stringify({ userId, fullName, role });
  cache.put(token, sessionData, CONFIG.SESSION_DURATION_HOURS * 3600);
  return token;
}

/**
 * ตรวจสอบ Session token ว่ายังใช้ได้อยู่ไหม
 */
function validateSession_(token) {
  if (!token) return null;
  const cache = CacheService.getScriptCache();
  const sessionData = cache.get(token);
  if (!sessionData) return null;
  return JSON.parse(sessionData);
}
