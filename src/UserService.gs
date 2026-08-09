// ============================================
// USERSERVICE.GS - จัดการผู้ใช้งานและสิทธิ์
// ============================================

function api_getUsers_(token) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!CONFIG.PERMISSIONS[session.role] || !CONFIG.PERMISSIONS[session.role].manageSystem) {
      return { success: false, message: 'คุณไม่มีสิทธิ์เข้าถึงหน้านี้' };
    }

    const sheet = getSheet(CONFIG.SHEET_NAMES.USERS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const users = data.slice(1).map(row => {
      const obj = rowToObject_(headers, row);
      delete obj.PasswordHash; // ไม่ส่ง hash รหัสผ่านออกไปฝั่ง client เด็ดขาด
      return obj;
    });

    return { success: true, users: users };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

function api_addUser_(token, payload) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!CONFIG.PERMISSIONS[session.role] || !CONFIG.PERMISSIONS[session.role].manageSystem) {
      return { success: false, message: 'คุณไม่มีสิทธิ์เพิ่มผู้ใช้งาน' };
    }

    const username = (payload.username || '').trim();
    const password = payload.password || '';
    const fullName = (payload.fullName || '').trim();
    const role = payload.role || '';

    if (!username || !password || !fullName || !role) {
      return { success: false, message: 'กรุณากรอกข้อมูลให้ครบ' };
    }
    if (!CONFIG.ROLE_LABELS[role]) {
      return { success: false, message: 'บทบาทไม่ถูกต้อง' };
    }
    if (password.length < 8) {
      return { success: false, message: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' };
    }

    const sheet = getSheet(CONFIG.SHEET_NAMES.USERS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colUsername = headers.indexOf('Username');

    for (let i = 1; i < data.length; i++) {
      if (data[i][colUsername] === username) {
        return { success: false, message: 'ชื่อผู้ใช้นี้มีอยู่แล้วในระบบ' };
      }
    }

    const newUserId = 'USR' + String(data.length).padStart(4, '0');
    sheet.appendRow([
      newUserId, username, hashPassword_(password), fullName,
      role, true, '', new Date()
    ]);

    logAudit_(session, 'CREATE', CONFIG.SHEET_NAMES.USERS, newUserId, '', 'เพิ่มผู้ใช้งานใหม่: ' + username + ' (' + role + ')');

    return { success: true, userId: newUserId };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

function api_toggleUserActive_(token, userId, active) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!CONFIG.PERMISSIONS[session.role] || !CONFIG.PERMISSIONS[session.role].manageSystem) {
      return { success: false, message: 'คุณไม่มีสิทธิ์ดำเนินการนี้' };
    }
    if (userId === session.userId) {
      return { success: false, message: 'ไม่สามารถระงับบัญชีของตัวเองได้' };
    }

    const sheet = getSheet(CONFIG.SHEET_NAMES.USERS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colId = headers.indexOf('UserID');

    for (let i = 1; i < data.length; i++) {
      if (data[i][colId] === userId) {
        sheet.getRange(i + 1, headers.indexOf('Active') + 1).setValue(active);
        logAudit_(session, active ? 'ACTIVATE' : 'SUSPEND', CONFIG.SHEET_NAMES.USERS, userId, '', active ? 'เปิดใช้งาน' : 'ระงับการใช้งาน');
        return { success: true };
      }
    }
    return { success: false, message: 'ไม่พบผู้ใช้งานนี้' };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

function api_changeOwnPassword_(token, oldPassword, newPassword) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };

    if (!oldPassword || !newPassword) {
      return { success: false, message: 'กรุณากรอกรหัสผ่านให้ครบ' };
    }
    if (newPassword.length < 8) {
      return { success: false, message: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร' };
    }

    const sheet = getSheet(CONFIG.SHEET_NAMES.USERS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colId = headers.indexOf('UserID');
    const colHash = headers.indexOf('PasswordHash');

    for (let i = 1; i < data.length; i++) {
      if (data[i][colId] === session.userId) {
        const currentHash = data[i][colHash];
        if (hashPassword_(oldPassword) !== currentHash) {
          return { success: false, message: 'รหัสผ่านเดิมไม่ถูกต้อง' };
        }
        sheet.getRange(i + 1, colHash + 1).setValue(hashPassword_(newPassword));
        logAudit_(session, 'CHANGE_PASSWORD', CONFIG.SHEET_NAMES.USERS, session.userId, '', 'เปลี่ยนรหัสผ่านตนเอง');
        return { success: true };
      }
    }
    return { success: false, message: 'ไม่พบบัญชีผู้ใช้งาน' };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

function api_resetUserPassword_(token, userId, newPassword) {
  try {
    const session = validateSession_(token);
    if (!session) return { success: false, message: 'กรุณาเข้าสู่ระบบใหม่' };
    if (!CONFIG.PERMISSIONS[session.role] || !CONFIG.PERMISSIONS[session.role].manageSystem) {
      return { success: false, message: 'คุณไม่มีสิทธิ์รีเซ็ตรหัสผ่านผู้อื่น' };
    }
    if (!newPassword || newPassword.length < 8) {
      return { success: false, message: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร' };
    }

    const sheet = getSheet(CONFIG.SHEET_NAMES.USERS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const colId = headers.indexOf('UserID');
    const colHash = headers.indexOf('PasswordHash');

    for (let i = 1; i < data.length; i++) {
      if (data[i][colId] === userId) {
        sheet.getRange(i + 1, colHash + 1).setValue(hashPassword_(newPassword));
        logAudit_(session, 'RESET_PASSWORD', CONFIG.SHEET_NAMES.USERS, userId, '', 'รีเซ็ตรหัสผ่านโดยผู้ดูแลระบบ');
        return { success: true };
      }
    }
    return { success: false, message: 'ไม่พบผู้ใช้งานนี้' };
  } catch (err) {
    return { success: false, message: 'เกิดข้อผิดพลาดฝั่งระบบ: ' + err.message };
  }
}

// ============================================
// Public Functions (สำหรับ google.script.run)
// ============================================
function apiGetUsers(token) { return api_getUsers_(token); }
function apiAddUser(token, payload) { return api_addUser_(token, payload); }
function apiToggleUserActive(token, userId, active) { return api_toggleUserActive_(token, userId, active); }
function apiChangeOwnPassword(token, oldPassword, newPassword) { return api_changeOwnPassword_(token, oldPassword, newPassword); }
function apiResetUserPassword(token, userId, newPassword) { return api_resetUserPassword_(token, userId, newPassword); }