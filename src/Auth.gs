// ============================================
// AUTH.GS - ระบบ Login และ Session
// ============================================

const LOGIN_MAX_ATTEMPTS = 5;          // จำนวนครั้งที่ผิดก่อนล็อก
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // ล็อก 15 นาที

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

  // ใช้ cached Users sheet (ไม่อ่านใหม่ทุกครั้ง)
  // ensurePermissionsColumn_ ก่อนเพื่อรองรับระบบเดิมที่ยังไม่มีคอลัมน์ Permissions
  // เช็ค CacheService ก่อน — ถ้าเคยตรวจแล้วว่ามีคอลัมน์ Permissions ก็ไม่ต้องเรียกซ้ำ
  const permCache = CacheService.getScriptCache();
  let colPerm = permCache.get('PERM_COL_EXISTS');
  if (colPerm === null) {
    try { colPerm = ensurePermissionsColumn_(); } catch (e) { colPerm = -1; }
    if (colPerm !== -1) permCache.put('PERM_COL_EXISTS', String(colPerm), 3600);
  } else {
    colPerm = Number(colPerm);
  }
  const cached = getCachedSheetData_(CONFIG.SHEET_NAMES.USERS);
  const headers = cached.headers;

  const colUsername = headers.indexOf('Username');
  const colPasswordHash = headers.indexOf('PasswordHash');
  const colUserID = headers.indexOf('UserID');
  const colFullName = headers.indexOf('FullName');
  const colRole = headers.indexOf('Role');
  const colActive = headers.indexOf('Active');
  if (colPerm === -1) colPerm = headers.indexOf('Permissions');

  const recordFail = function (message) {
    const count = Number(failData.count || 0) + 1;
    if (count >= LOGIN_MAX_ATTEMPTS) {
      props.setProperty(failKey, JSON.stringify({ count: count, lockedUntil: now + LOGIN_LOCKOUT_MS }));
      return { success: false, message: message + ' — บัญชีถูกล็อก 15 นาที (พยายามผิด ' + count + ' ครั้ง)' };
    }
    props.setProperty(failKey, JSON.stringify({ count: count }));
    return { success: false, message: message + ' (ครั้งที่ ' + count + '/' + LOGIN_MAX_ATTEMPTS + ')' };
  };

  for (let i = 0; i < cached.rows.length; i++) {
    const row = cached.rows[i];
    if (row[colUsername] === username) {
      if (!row[colActive]) {
        return { success: false, message: 'บัญชีนี้ถูกระงับการใช้งาน' };
      }
      if (!verifyPassword_(password, String(row[colPasswordHash] || ''))) {
        return recordFail('รหัสผ่านไม่ถูกต้อง');
      }
      // สำเร็จ → ล้างตัวนับ
      props.deleteProperty(failKey);

      // อ่านสิทธิ์รายบุคคลจากคอลัมน์ Permissions (JSON)
      let userPermissions = {};
      if (colPerm !== -1) {
        try {
          const rawPerm = row[colPerm];
          if (rawPerm && String(rawPerm).trim()) {
            userPermissions = JSON.parse(String(rawPerm));
          } else {
            // ถ้ายังว่าง → ใช้สิทธิ์จาก role เป็น fallback
            userPermissions = CONFIG.PERMISSIONS[row[colRole]] || {};
          }
        } catch (e) {
          userPermissions = CONFIG.PERMISSIONS[row[colRole]] || {};
        }
      } else {
        userPermissions = CONFIG.PERMISSIONS[row[colRole]] || {};
      }

      // สร้าง session (เร็ว — ไม่เขียน Sheets)
      const token = createSession_(row[colUserID], row[colFullName], row[colRole], userPermissions);

      // อัปเดต LastLogin + hash upgrade — เขียนแยกกัน (ไม่ทับคอลัมน์อื่น)
      try {
        const sheet = getSheet(CONFIG.SHEET_NAMES.USERS);
        sheet.getRange(i + 2, headers.indexOf('LastLogin') + 1).setValue(new Date());
        // ยกระดับ hash รุ่นเก่า (pbkdf2 หรือ SHA-256 ไร้ salt) เป็น sha256salt อัตโนมัติ
        const storedHash = String(row[colPasswordHash] || '');
        if (storedHash.indexOf('sha256salt:') !== 0) {
          sheet.getRange(i + 2, colPasswordHash + 1).setValue(hashPassword_(password));
        }
        invalidateSheetCache_(CONFIG.SHEET_NAMES.USERS);
      } catch (e) { Logger.log('post-login write error: ' + e.message); }

      return {
        success: true,
        token: token,
        user: {
          userId: row[colUserID],
          fullName: row[colFullName],
          role: row[colRole],
          roleLabel: CONFIG.ROLE_LABELS[row[colRole]] || row[colRole],
          permissions: userPermissions
        }
      };
    }
  }

  return recordFail('ไม่พบชื่อผู้ใช้นี้ในระบบ');
}

// ============================================
// การแฮชรหัสผ่าน: SHA-256 + salt (รวดเร็ว 1 RPC)
// รองรับย้อนหลัง: pbkdf2:iter:salt:hash, sha256salt:salt:hash, และ SHA-256 ไร้ salt
// ============================================

/** เข้ารหัส password ด้วย SHA-256 + salt — รูปแบบ 'sha256salt:salt:hash' (1 RPC) */
function hashPassword_(password) {
  const salt = Utilities.getUuid().replace(/-/g, '').substr(0, 16);
  const hash = sha256Hex_(password + salt);
  return 'sha256salt:' + salt + ':' + hash;
}

/** ตรวจสอบ password กับค่าในฐาน — รองรับทั้ง sha256salt, pbkdf2 และ SHA-256 ไร้ salt */
function verifyPassword_(password, stored) {
  if (!stored) return false;

  // รุ่นใหม่: sha256salt:salt:hash
  if (stored.indexOf('sha256salt:') === 0) {
    const parts = stored.split(':');
    const salt = parts[1] || '';
    const expected = parts[2] || '';
    if (!salt || !expected) return false;
    return sha256Hex_(password + salt) === expected;
  }

  // รุ่นเก่า: pbkdf2:iter:salt:hash (ช้า — ใช้ตอน verify แล้ว upgrade)
  if (stored.indexOf('pbkdf2:') === 0) {
    const parts = stored.split(':');
    const iter = Math.max(1, Number(parts[1]) || 1000);
    const salt = parts[2] || '';
    const expected = parts[3] || '';
    if (!salt || !expected) return false;
    return pbkdf2Sha256Hex_(password, salt, iter) === expected;
  }

  // รุ่นเก่าสุด: SHA-256 ไร้ salt
  return hashPasswordLegacy_(password) === stored;
}

/** SHA-256 → hex string (1 RPC) */
function sha256Hex_(input) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8);
  return digest.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}

/** รหัสผ่านรุ่นเก่า (SHA-256 ไร้ salt) — ใช้เฉพาะเทียบ hash เดิม */
function hashPasswordLegacy_(password) {
  return sha256Hex_(password);
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

/** อ่านเวอร์ชัน session ของผู้ใช้ (ใช้เพิกถอน session เก่าหลังเปลี่ยนรหัส) — อ่านจาก CacheService ก่อน (เร็วกว่า PropertiesService) */
function getSessionVersion_(userId) {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'SESSION_VER_' + userId;
  const cached = cache.get(cacheKey);
  if (cached !== null) return Number(cached);
  // Fallback: อ่านจาก PropertiesService แล้ว cache ไว้
  const ver = Number(PropertiesService.getScriptProperties().getProperty(cacheKey) || 0);
  cache.put(cacheKey, String(ver), 1800); // cache 30 นาที
  return ver;
}

/** เพิ่มเวอร์ชัน session → session เก่าทั้งหมดของผู้นั้นใช้ไม่ได้ทันที — เขียนทั้ง PropertiesService และ CacheService */
function bumpSessionVersion_(userId) {
  const cacheKey = 'SESSION_VER_' + userId;
  const newVer = getSessionVersion_(userId) + 1;
  PropertiesService.getScriptProperties().setProperty(cacheKey, String(newVer));
  CacheService.getScriptCache().put(cacheKey, String(newVer), 1800);
}

/** สร้าง Session token เก็บใน CacheService */
function createSession_(userId, fullName, role, permissions) {
  const token = Utilities.getUuid();
  const cache = CacheService.getScriptCache();
  const sessionData = JSON.stringify({ userId: userId, fullName: fullName, role: role, permissions: permissions || {}, ver: getSessionVersion_(userId) });
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
    const cached = getCachedSheetData_(CONFIG.SHEET_NAMES.USERS);
    const headers = cached.headers;
    const colUsername = headers.indexOf('Username');
    const colPasswordHash = headers.indexOf('PasswordHash');
    const colFullName = headers.indexOf('FullName');
    const colActive = headers.indexOf('Active');

    for (let i = 0; i < cached.rows.length; i++) {
      const row = cached.rows[i];
      if (row[colUsername] === username) {
        if (!row[colActive]) return { success: false, message: 'บัญชีนี้ถูกระงับการใช้งาน' };
        if (!verifyPassword_(password, String(row[colPasswordHash] || ''))) {
          return { success: false, message: 'รหัสผ่านไม่ถูกต้อง' };
        }
        // ยกระดับ hash รุ่นเก่า (pbkdf2 หรือ SHA-256 ไร้ salt) เป็น sha256salt อัตโนมัติ
        const storedHash = String(row[colPasswordHash] || '');
        if (storedHash.indexOf('sha256salt:') !== 0) {
          try {
            sheet.getRange(i + 2, colPasswordHash + 1).setValue(hashPassword_(password));
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
