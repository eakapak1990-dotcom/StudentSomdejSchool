// ============================================
// AUTH.GS - ระบบ Login และ Session
// ============================================

const LOGIN_MAX_ATTEMPTS = 5;          // จำนวนครั้งที่ผิดก่อนล็อก
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // ล็อก 15 นาที
const PBKDF2_ITERATIONS = 10000;

/**
 * จัดการ Login — ตรวจสอบ username/password จาก Sheet Users
 * มี rate limit: ผิด 5 ครั้ง/15 นาที → ล็อกชั่วคราว
 */
function handleLogin_(username, password) {
  if (!username || !password) {
    return { success: false, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' };
  }

  // ---- Rate limit / Lockout ----
  const props = PropertiesService.getScriptProperties();
  const failKey = 'LOGIN_FAIL_' + username;
  let failData = {};
  try { failData = JSON.parse(props.getProperty(failKey) || '{}'); } catch (e) { failData = {}; }
  const now = Date.now();
  if (failData.lockedUntil && now < failData.lockedUntil) {
    const mins = Math.ceil((failData.lockedUntil - now) / 60000);
    return { success: false, message: 'บัญชีถูกล็อกชั่วคราว กรุณารอประมาณ ' + mins + ' นาที (พยายามล็อกอินผิดหลายครั้ง)' };
  }
  if (failData.lockedUntil && now >= failData.lockedUntil) {
    props.deleteProperty(failKey); // หมดเวลาล็อก
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

  const recordFail = function (message) {
    const count = Number(failData.count || 0) + 1;
    if (count >= LOGIN_MAX_ATTEMPTS) {
      props.setProperty(failKey, JSON.stringify({ count: count, lockedUntil: now + LOGIN_LOCKOUT_MS }));
      return { success: false, message: message + ' — บัญชีถูกล็อก 15 นาที (พยายามผิด ' + count + ' ครั้ง)' };
    }
    props.setProperty(failKey, JSON.stringify({ count: count }));
    return { success: false, message: message + ' (ครั้งที่ ' + count + '/' + LOGIN_MAX_ATTEMPTS + ')' };
  };

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[colUsername] === username) {
      if (!row[colActive]) {
        return { success: false, message: 'บัญชีนี้ถูกระงับการใช้งาน' };
      }
      if (!verifyPassword_(password, String(row[colPasswordHash] || ''))) {
        return recordFail('รหัสผ่านไม่ถูกต้อง');
      }
      // สำเร็จ → ล้างตัวนับ + ถ้า hash เป็นรุ่นเก่า (SHA-256 ไร้ salt) ให้ยกระดับเป็น PBKDF2 อัตโนมัติ
      props.deleteProperty(failKey);
      if (String(row[colPasswordHash] || '').indexOf('pbkdf2:') !== 0) {
        try {
          sheet.getRange(i + 1, colPasswordHash + 1).setValue(hashPassword_(password));
        } catch (e) { Logger.log('ยกระดับ hash ล้มเหลว: ' + e.message); }
      }
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
    }
  }

  return recordFail('ไม่พบชื่อผู้ใช้นี้ในระบบ');
}

// ============================================
// การแฮชรหัสผ่าน: PBKDF2-HMAC-SHA256 + salt (ย้อนหลังรองรับ SHA-256 ไร้ salt)
// ============================================

/** เข้ารหัส password ด้วย PBKDF2-HMAC-SHA256 + salt เฉพาะผู้ใช้ — รูปแบบ 'pbkdf2:iter:salt:hash' */
function hashPassword_(password) {
  const salt = Utilities.getUuid().replace(/-/g, '').substr(0, 16); // 16 ตัวอักษร hex
  return 'pbkdf2:' + PBKDF2_ITERATIONS + ':' + salt + ':' + pbkdf2Sha256Hex_(password, salt, PBKDF2_ITERATIONS);
}

/** ตรวจสอบ password กับค่าในฐาน — รองรับทั้งรุ่นใหม่ (PBKDF2) และรุ่นเก่า (SHA-256) */
function verifyPassword_(password, stored) {
  if (!stored) return false;
  if (stored.indexOf('pbkdf2:') === 0) {
    const parts = stored.split(':');
    const iter = Math.max(1, Number(parts[1]) || PBKDF2_ITERATIONS);
    const salt = parts[2] || '';
    const expected = parts[3] || '';
    if (!salt || !expected) return false;
    return pbkdf2Sha256Hex_(password, salt, iter) === expected;
  }
  // รุ่นเก่า: SHA-256 ไร้ salt (เก็บ hex ตรง ๆ) — รองรับเพื่อไม่ให้ผู้ใช้เดิมล็อกอินไม่ได้
  return hashPasswordLegacy_(password) === stored;
}

/** รหัสผ่านรุ่นเก่า (SHA-256 ไร้ salt) — ใช้เฉพาะเทียบ hash เดิม */
function hashPasswordLegacy_(password) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password);
  return digest.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}

/** hex → byte array */
function hexToBytes_(hex) {
  const out = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.substr(i, 2), 16));
  return out;
}

/** byte array → hex */
function bytesToHex_(bytes) {
  return bytes.map(b => (b & 255).toString(16).padStart(2, '0')).join('');
}

/** HMAC-SHA256 → byte array (unsigned) */
function hmacSha256Bytes_(messageBytes, keyBytes) {
  const sig = Utilities.computeHmacSha256Signature(messageBytes, keyBytes);
  return sig.map(b => b & 255);
}

/**
 * PBKDF2-HMAC-SHA256 (dkLen=32) — ผ่านการเทียบกับ RFC 8018 test vector แล้ว
 * แนวคิด: U1 = HMAC(pw, salt||INT(1)), Ui = HMAC(pw, U(i-1)), T = U1 xor ... xor Uc
 */
function pbkdf2Sha256Hex_(password, saltHex, iterations) {
  const salt = hexToBytes_(saltHex);
  const pw = Utilities.newBlob(password, Utilities.Charset.UTF_8).getBytes();
  let u = hmacSha256Bytes_(salt.concat([0, 0, 0, 1]), pw);
  const t = u.slice();
  for (let i = 1; i < iterations; i++) {
    u = hmacSha256Bytes_(u, pw);
    for (let j = 0; j < t.length; j++) t[j] ^= u[j];
  }
  return bytesToHex_(t);
}

// ============================================
// Session (CacheService) + Session version
// ============================================

/** อ่านเวอร์ชัน session ของผู้ใช้ (ใช้เพิกถอน session เก่าหลังเปลี่ยนรหัส) */
function getSessionVersion_(userId) {
  return Number(PropertiesService.getScriptProperties().getProperty('SESSION_VER_' + userId) || 0);
}

/** เพิ่มเวอร์ชัน session → session เก่าทั้งหมดของผู้นั้นใช้ไม่ได้ทันที */
function bumpSessionVersion_(userId) {
  PropertiesService.getScriptProperties().setProperty('SESSION_VER_' + userId, String(getSessionVersion_(userId) + 1));
}

/** สร้าง Session token เก็บใน CacheService */
function createSession_(userId, fullName, role) {
  const token = Utilities.getUuid();
  const cache = CacheService.getScriptCache();
  const sessionData = JSON.stringify({ userId: userId, fullName: fullName, role: role, ver: getSessionVersion_(userId) });
  cache.put(token, sessionData, CONFIG.SESSION_DURATION_HOURS * 3600);
  return token;
}

/** ตรวจสอบ Session token ว่ายังใช้ได้อยู่ไหม */
function validateSession_(token) {
  if (!token) return null;
  const cache = CacheService.getScriptCache();
  const sessionData = cache.get(token);
  if (!sessionData) return null;
  const s = JSON.parse(sessionData);
  // session เก่ากว่าเวอร์ชันปัจจุบัน (เช่น เปลี่ยนรหัสผ่านแล้ว) → ไม่ใช้ได้
  if (s.ver !== getSessionVersion_(s.userId)) return null;
  return s;
}

// ============================================
// Public Functions (สำหรับ google.script.run)
// google.script.run เรียกฟังก์ชันที่มี _ ต่อท้ายไม่ได้
// ============================================

/** ฟังก์ชันสาธารณะสำหรับ Frontend เรียก Login */
function handleLoginFromClient(username, password) {
  return handleLogin_(username, password);
}

/** ฟังก์ชันสาธารณะสำหรับ Frontend ตรวจสอบ Session */
function validateSessionFromClient(token) {
  return validateSession_(token);
}

/**
 * ยืนยันตัวตน (username + password) ของผู้ใช้ที่ login อยู่
 * ใช้สำหรับปลดล็อกการแก้ไขการตั้งค่าที่ถูกล็อก (เช่น หน้า "การแจ้งเตือน LINE")
 * ไม่สร้าง session ใหม่ — ตรวจสอบแค่รหัสผ่านว่าถูกต้อง
 */
function apiVerifyAdminPassword_(token, username, password) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!username || !password) return { success: false, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' };

    const sheet = getSheet(CONFIG.SHEET_NAMES.USERS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colUsername = headers.indexOf('Username');
    const colPasswordHash = headers.indexOf('PasswordHash');
    const colFullName = headers.indexOf('FullName');
    const colActive = headers.indexOf('Active');

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[colUsername] === username) {
        if (!row[colActive]) return { success: false, message: 'บัญชีนี้ถูกระงับการใช้งาน' };
        if (!verifyPassword_(password, String(row[colPasswordHash] || ''))) {
          return { success: false, message: 'รหัสผ่านไม่ถูกต้อง' };
        }
        // ยกระดับ hash รุ่นเก่าให้เป็น PBKDF2 อัตโนมัติ
        if (String(row[colPasswordHash] || '').indexOf('pbkdf2:') !== 0) {
          try {
            sheet.getRange(i + 1, colPasswordHash + 1).setValue(hashPassword_(password));
          } catch (e) { Logger.log('ยกระดับ hash ล้มเหลว: ' + e.message); }
        }
        return { success: true, fullName: row[colFullName] };
      }
    }
    return { success: false, message: 'ไม่พบชื่อผู้ใช้นี้ในระบบ' };
  } catch (err) {
    Logger.log('apiVerifyAdminPassword_ error: ' + err.message);
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ กรุณาลองใหม่อีกครั้ง' };
  }
}

function verifyAdminPassword(token, username, password) {
  return apiVerifyAdminPassword_(token, username, password);
}
