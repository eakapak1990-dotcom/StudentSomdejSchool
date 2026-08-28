# Plan: ตรวจสอบและเร่งความเร็วการโหลดข้อมูล (Login 5-8 วินาที)

## สรุป
Login ใช้เวลา 5-8 วินาที เนื่องจาก:
1. **`ensurePermissionsColumn_()` ถูกเรียกทุกครั้ง** ใน `handleLogin_` — อ่าน Sheet Users ทั้งหมดทุกครั้งเพื่อตรวจสอบคอลัมน์ แม้คอลัมน์จะมีอยู่แล้ว
2. **`invalidateSheetCache_` ก่อน `getCachedSheetData_`** ใน `handleLogin_` บรรทัด 36-37 — ทำให้ cache ใช้ไม่ได้ ต้องอ่าน Sheet ใหม่ทุกครั้ง
3. **`api_getDashboardSummary_` อ่าน Sheet 2 แผ่นตรง** (Students + Timeline) โดยไม่ใช้ `getCachedSheetData_` — ถูกเรียกทันทีหลัง login
4. **PBKDF2 1000 iterations** — แต่ละรอบเรียก `computeHmacSha256Signature` ซึ่งเป็น Apps Script API call (ช้ากว่า native code มาก) — 1000 รอบ = ~1000 API calls

## การวิเคราะห์จุดที่ช้า

### จุดที่ 1: `ensurePermissionsColumn_()` ใน handleLogin_ (บรรทัด 35)
- **ปัญหา**: เรียกทุกครั้งที่ login แม้คอลัมน์ Permissions จะมีอยู่แล้ว
- ฟังก์ชันนี้เปิด Sheet → อ่าน headers → ตรวจสอบ ถ้ามีแล้วก็ return ทันที แต่การเปิด Sheet และอ่าน headers ยังใช้เวลา ~200-500ms
- **วิธีแก้**: ใช้ CacheService เก็บผลการตรวจสอบ ถ้าเคยตรวจแล้วว่ามีคอลัมน์ ก็ไม่ต้องตรวจซ้ำ

### จุดที่ 2: `invalidateSheetCache_` ก่อน `getCachedSheetData_` (บรรทัด 36-37)
- **ปัญหา**: invalidate cache แล้วอ่านใหม่ทันที = ไม่ได้ใช้ประโยชน์จาก cache เลย
- เหตุผลเดิม: ต้องการอ่านข้อมูล Users ล่าสุด แต่ในบริบท login ข้อมูล Users เปลี่ยนไม่บ่อย
- **วิธีแก้**: เอา `invalidateSheetCache_` ออก ใช้ cache ได้เลย เพราะ cache เป็น in-memory ต่อ request อยู่แล้ว (ไม่มีข้อมูลเก่าข้าม request)

### จุดที่ 3: `api_getDashboardSummary_` ไม่ใช้ cache (DashboardService.gs บรรทัด 11, 35)
- **ปัญหา**: อ่าน Sheet Students และ Timeline โดยตรงด้วย `getDataRange().getValues()` ทั้งที่มี `getCachedSheetData_` ใช้
- **วิธีแก้**: เปลี่ยนไปใช้ `getCachedSheetData_` ทั้ง 2 จุด

### จุดที่ 4: PBKDF2 1000 iterations (Auth.gs บรรทัด 7, 172-181)
- **ปัญหา**: ลูป 1000 รอบ แต่ละรอบเรียก `Utilities.computeHmacSha256Signature` ซึ่งเป็น Apps Script API call
- ใน GAS แต่ละ API call ใช้ ~1-3ms → 1000 รอบ = 1-3 วินาทีเฉพาะ hash
- **วิธีแก้**: ลด iterations จาก 1000 เป็น 100 (ยังปลอดภัยเพียงพอสำหรับระบบภายในโรงเรียน) + เก็บ cached hash ใน CacheService

### จุดที่ 5: ฟังก์ชันอื่นที่อ่าน Sheet ตรงโดยไม่ใช้ cache (40 จุด)
- UserService.gs: 6 จุด (ทุกฟังก์ชันอ่าน Sheet ตรง)
- DashboardService.gs: 2 จุด
- ReportService.gs: 6 จุด (3 ฟังก์ชันอ่าน 2 ชีทติดต่อกัน)
- LineService.gs: 11 จุด
- LetterService.gs: 2 จุด
- LeaveService.gs: 4 จุด
- StudentService.gs: 3 จุด
- Auth.gs: 1 จุด (apiVerifyAdminPassword_)
- **วิธีแก้**: เปลี่ยนจาก `sheet.getDataRange().getValues()` เป็น `getCachedSheetData_(sheetName)` ในจุดที่เป็น read-only (ไม่ได้เขียนกลับ)

## การเปลี่ยนแปลงที่จะทำ

### ไฟล์ 1: `src/Auth.gs`

**1.1** บรรทัด 7: ลด `PBKDF2_ITERATIONS` จาก 1000 เป็น 100
```javascript
const PBKDF2_ITERATIONS = 100;  // เร็วขึ้น 10x ยังปลอดภัยสำหรับระบบภายใน
```

**1.2** บรรทัด 34-37: เปลี่ยนการเรียก `ensurePermissionsColumn_()` ให้ใช้ CacheService
```javascript
// เช็ค cache ก่อน — ถ้าเคยตรวจแล้วว่ามีคอลัมน์ Permissions ก็ไม่ต้องเรียกซ้ำ
const cache = CacheService.getScriptCache();
let colPerm = cache.get('PERM_COL_EXISTS');
if (colPerm === null) {
  try { colPerm = ensurePermissionsColumn_(); } catch (e) { colPerm = -1; }
  if (colPerm !== -1) cache.put('PERM_COL_EXISTS', String(colPerm), 3600); // cache 1 ชม.
}
```

**1.3** บรรทัด 36: เอา `invalidateSheetCache_` ออก — ไม่จำเป็นต้อง invalidate ก่อนอ่าน
```javascript
// เอาบรรทัดนี้ออก: invalidateSheetCache_(CONFIG.SHEET_NAMES.USERS);
const cached = getCachedSheetData_(CONFIG.SHEET_NAMES.USERS);
```

**1.4** บรรทัด 92-100: หลังเขียน LastLogin ให้ใช้ `invalidateSheetCache_` เฉพาะ Users (มีอยู่แล้ว) — ไม่ต้องเปลี่ยน

**1.5** บรรทัด 246: `apiVerifyAdminPassword_` เปลี่ยนจาก `sheet.getDataRange().getValues()` เป็น `getCachedSheetData_`
```javascript
const cached = getCachedSheetData_(CONFIG.SHEET_NAMES.USERS);
const headers = cached.headers;
// ... ใช้ cached.rows แทน data.slice(1)
```

### ไฟล์ 2: `src/Config.gs`

**2.1** `ensurePermissionsColumn_()` (บรรทัด 227-251): เพิ่ม cache check ที่ต้นฟังก์ชัน
```javascript
function ensurePermissionsColumn_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('PERM_COL_EXISTS');
  if (cached !== null) return Number(cached);

  const sheet = getSheet(CONFIG.SHEET_NAMES.USERS);
  // ... โค้ดเดิม ...
  cache.put('PERM_COL_EXISTS', String(newColPos - 1), 3600);
  return newColPos - 1;
}
```

### ไฟล์ 3: `src/DashboardService.gs`

**3.1** บรรทัด 10-13: เปลี่ยนจาก `getDataRange().getValues()` เป็น `getCachedSheetData_`
```javascript
const studentData = getCachedSheetData_(CONFIG.SHEET_NAMES.STUDENTS);
const studentHeaders = studentData.headers;
const students = studentData.rows.map(row => rowToObject_(studentHeaders, row));
```

**3.2** บรรทัด 34-37: เปลี่ยน Timeline ให้ใช้ cache เช่นกัน
```javascript
const timelineData = getCachedSheetData_(CONFIG.SHEET_NAMES.TIMELINE);
const timelineHeaders = timelineData.headers;
let events = timelineData.rows.map(row => rowToObject_(timelineHeaders, row));
```

### ไฟล์ 4: `src/UserService.gs`

**4.1** ทุกฟังก์ชันที่อ่าน Sheet ตรง (6 จุด) เปลี่ยนเป็น `getCachedSheetData_`
- `api_getUsers_` บรรทัด 17
- `api_addUser_` บรรทัด 70
- `api_toggleUserActive_` บรรทัด 113
- `api_changeOwnPassword_` บรรทัด 144
- `api_resetUserPassword_` บรรทัด 181
- `api_updateUserPermissions_` บรรทัด 223

### ไฟล์ 5: `src/ReportService.gs`

**5.1** 6 จุดที่อ่าน Sheet ตรงเปลี่ยนเป็น `getCachedSheetData_`
- `api_getScoreOverview_` บรรทัด 155, 163
- `api_getRoomReasonStats_` บรรทัด 270, 278
- `api_getLetterLeaveStats_` บรรทัด 365, 394

### ไฟล์ 6: `src/LineService.gs`

**6.1** 11 จุดที่อ่าน Sheet ตรงเปลี่ยนเป็น `getCachedSheetData_` (เฉพาะจุดที่เป็น read-only)

### ไฟล์ 7: `src/LeaveService.gs`

**7.1** 4 จุดที่อ่าน Sheet ตรงเปลี่ยนเป็น `getCachedSheetData_`
- `api_createLeaveRequest_` บรรทัด 71, 83
- `api_getLeaveRequests_` บรรทัด 131
- `api_updateLeaveStatus_` บรรทัด 195

### ไฟล์ 8: `src/LetterService.gs`

**8.1** 2 จุดที่อ่าน Sheet ตรงเปลี่ยนเป็น `getCachedSheetData_`
- `isLetterNoInUse_` บรรทัด 44
- `api_confirmLetter_` บรรทัด 281

### ไฟล์ 9: `src/StudentService.gs`

**9.1** 3 จุดที่อ่าน Sheet ตรงเปลี่ยนเป็น `getCachedSheetData_`
- `api_importStudents_` บรรทัด 324
- `countRecordsInAcademicYear_` บรรทัด 618
- `deleteRelatedRows_` บรรทัด 667

**หมายเหตุ**: `api_uploadStudentPhoto_` บรรทัด 756 อ่าน Sheet เพื่อค้นหานักเรียน ก็เปลี่ยนเช่นกัน

## ลำดับการทำงาน (Priority)

1. **แก้จุดที่ช้าที่สุดก่อน** (ส่งผลตรง login):
   - Auth.gs: ลด PBKDF2 iterations + cache ensurePermissionsColumn_ + เอา invalidate ออก
   - DashboardService.gs: ใช้ cache

2. **แก้จุดที่ช้ารองลงมา** (ส่งผลหลัง login):
   - UserService.gs: 6 จุด
   - ReportService.gs: 6 จุด

3. **แก้จุดที่เหลือ** (ป้องกันปัญหาในอนาคต):
   - LineService.gs: 11 จุด
   - LeaveService.gs: 4 จุด
   - LetterService.gs: 2 จุด
   - StudentService.gs: 3 จุด

## ข้อควรระวัง

- **ฟังก์ชันที่เขียนกลับ Sheet**: หลังเขียนต้องเรียก `invalidateSheetCache_(sheetName)` เสมอ (มีอยู่แล้วในโค้ดส่วนใหญ่)
- **PBKDF2 ลด iterations**: ผู้ใช้เดิมที่มี hash 1000 iterations ยัง login ได้ เพราะ `verifyPassword_` อ่าน iterations จาก stored hash (บรรทัด 134: `const iter = Math.max(1, Number(parts[1]) || PBKDF2_ITERATIONS)`)
- **cache key `PERM_COL_EXISTS`**: ถ้ามีการเพิ่มคอลัมน์ใหม่ใน Sheet โดยตรง ต้องลบ cache นี้ — แต่ในทางปฏิบัติไม่เกิดบ่อย

## การตรวจสอบ

- หลังแก้ไข ให้ทดสอบ login และจับเวลา — ควรลดลงจาก 5-8 วินาที เหลือ 1-2 วินาที
- ทดสอบว่าผู้ใช้เดิม (hash 1000 iterations) ยัง login ได้
- ทดสอบว่า Dashboard โหลดเร็วขึ้น
- ทดสอบฟังก์ชันอื่น ๆ (เพิ่มคะแนน, ดูรายงาน, จัดการผู้ใช้) ว่ายังทำงานปกติ