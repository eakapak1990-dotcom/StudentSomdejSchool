# สรุปปัญหา: LIFF ผูกบัญชีผู้ปกครองไม่สำเร็จ (init ค้างในแอป LINE)

> อัปเดตล่าสุด: 14 ส.ค. 2569 · ✅ **แก้สำเร็จแล้ว — ยืนยันจากมือถือจริง**: หน้า standalone โหลดที่ top-level (`boisterous-cupcake-6f6374.netlify.app`), `liff.init()` เสร็จ, หน้าขอยินยอมขึ้น, ข้อมูลนักเรียนโหลดผ่าน API ได้ (ดูข้อ 5 → สถานะปัจจุบัน)

---

## 1. อาการ (Symptom)

| สภาพแวดล้อม | ผลที่เห็น |
|---|---|
| **มือถือ — เปิดในแอป LINE** (ลิงก์ `https://liff.line.me/2011098537-oAL9uwZt`) | แถบสถานะ**ค้าง "กำลังเชื่อมต่อ LINE... (v53)"** ตลอดเวลา กดเชื่อมต่อ → **"เชื่อมต่อไม่สำเร็จ — กรุณากรอกข้อมูลให้ครบ (รหัสนักเรียน, เบอร์โทร, รหัส PIN)"** |
| เดสก์ท็อป — เปิดในเบราว์เซอร์ | init ผ่าน แต่ไม่มี userId → "ไม่สามารถระบุตัวตนบัญชี LINE ได้ [profile-error]" (ปกติสำหรับเบราว์เซอร์ — ไม่ใช่ปัญหา) |

---

## 2. สิ่งที่ยืนยันแล้ว (Verified Facts)

- ✅ โค้ด **v53/v54** รันบนมือถือจริง (เห็นเวอร์ชันบนหัวเพจ) → **ไม่ใช่ปัญหาแคช**
- ✅ **แก้สำเร็จแล้ว (14 ส.ค. 2569, มือถือจริง):** แบนเดอร์เขียว "เชื่อมต่อ LINE แล้ว — สวัสดีครับคุณพ่อคุณแม่" + `URL: boisterous-cupcake-6f6374.netlify.app` (top-level ไม่ใช่ iframe GAS) + หน้า "นักเรียนของฉัน" แสดงนักเรียนที่ผูกแล้วพร้อมคะแนน → **init เสร็จ + API GAS ทำงานครบ**
- ✅ **API (GAS Version 60) ตรวจแล้ว:** `doPost` action `liffGetMyStudents` → `{"success":true,"students":[...]}` (HTTP 200, `Access-Control-Allow-Origin: *`) — ยิงผ่าน node fetch แบบ browser
- ✅ **Channel สถานะ Published แล้ว** (ภาพ Console — ตัดทฤษฎี Developing ออก)
- ✅ **LIFF SDK อัปเกรดเป็น `liff/edge/2/sdk.js`** (v2.29.2 — อัปเดตอัตโนมัติ) จากเดิม `edge/2.1` (ปี 2019) — ตรวจบนคลาวด์แล้ว
- ✅ **ฝั่ง LINE server ทำงานปกติ** — ยิง `https://access.line.me/liff/v1/authorize?app_id=2011098537-oAL9uwZt...` ตรง ๆ พบว่า LINE redirect ไปหน้า login → consent ได้ปกติ (`scope=openid profile`, `redirect_uri` ถูกต้อง = endpoint ของระบบ) → **ไม่ใช่ปัญหา channel ถูกบล็อก/ลบ**
- ✅ **URL จบตรงกัน** — `curl` ยิง endpoint `.../exec?page=liff&v=3` ได้ HTTP 200 ตรง ๆ ไม่มี redirect → URL ที่ `liff.init()` รัน = Endpoint URL เป๊ะ (ตัดทฤษฎี v2.27.2 warning จากการ URL ไม่ตรงออก — ตรวจเช็คของ SDK ทำงานหลัง init เสร็จ ไม่ใช่ต้นเหตุของการค้าง)
- ⚠️ **พบ `bot_prompt=aggressive` ใน authorize URL** — LIFF app ตั้ง **Add friend option = On (aggressive)** ไว้ (LINE จะแสดงหน้า "เพิ่มเพื่อน OA" ตามหลังหน้าขอยินยอม) แต่ตาม docs ยังไม่ได้ตั้ง **Linked LINE Official Account** ใน Basic settings ของ channel → เป็นตัวต้องสงสัยอันดับ 1 ของการที่ native consent flow ในแอป LINE ค้างเงียบ
- 🔍 **แกะโค้ด LIFF SDK 2.29.2 แล้ว** — `liff.init()` ในแอป LINE มีขั้นตอน: (1) รอ native bridge `window._liff.features` พร้อม → (2) ถ้ายังไม่มี access token → redirect ไป `access.line.me/liff/v1/authorize` (LINE app ดักจับ navigation แสดงหน้า consent แบบ native) → (3) กลับมาพร้อม `code` → แลก token → init เสร็จ **จุดที่ค้างได้ 2 จุด: (1) รอ bridge ที่ไม่เคยถูกส่ง, (2) รอ redirect กลับจากหน้า consent ที่ไม่เคยเสร็จ — ทั้งคู่ให้อาการเดียวกันกับที่เจอ (หน้า render ปกติ, init ค้างเงียบ, ไม่มีหน้า consent, หน้าไม่ redirect ไปไหน)**
- ✅ LIFF App: **Size = Full, Scopes = openid** ✓, Endpoint URL = `.../exec?page=liff&v=3` ✓
- ✅ **ลำดับพารามิเตอร์ถูกต้อง** — client: `apiLiffBind(lineUserId, studentId, phone, pin)` ↔ server: `function apiLiffBind(lineUserId, studentId, parentPhone, pin)` — ตรงกันทุกตัว (ตัดทฤษฎี parameter mismatch ออก)
- ✅ **PIN ถูกส่งแล้ว** (แก้ตั้งแต่ v47) — client อ่าน `bind_pin` + ตรวจ `^\d{4,6}$` + ส่งเป็นพารามิเตอร์ที่ 4
- ✅ **เบอร์โทร normalize แล้ว** (v48) — `825633030` = `0825633030` (เติม 0 หน้าอัตโนมัติ)
- ✅ ข้อความ error "กรอกข้อมูลให้ครบ (รหัสนักเรียน, เบอร์โทร, รหัส PIN)" มาจาก **backend `apiLiffBind`** (LineService.gs บรรทัด ~479) เมื่อ `!lineUserId || !studentId || !parentPhone || !pin` — ในภาพผู้ใช้กรอกครบทั้ง 3 ช่อง → ตัวที่ว่างคือ **`lineUserId`**
- ✅ ฟีเจอร์อื่นของระบบทำงานครบ (บันทึกคะแนน/หนังสือเชิญ/คำร้อง, หน้า LINE admin, ตั้งค่า Token/LIFF ID ผ่าน)

---

## 3. ปัญหาหลัก (Root Issue — ยืนยันแล้ว)

> **Google Apps Script (HtmlService) ฝังทุกหน้าใน iframe บน `script.googleusercontent.com` (`userCodeAppPanel`) เสมอ → LINE จะ attach native bridge เต็ม (`window._liff.features`) + ยิง ready event เฉพาะที่ frame บนสุด (หน้า endpoint URL) → `liff.init()` ที่รันใน iframe ของ GAS จึงค้างตลอดกาลในแอป LINE**

หลักฐาน: v54 บนมือถือจริงแสดง `URL: ...script.googleusercontent.com/userCodeAppPanel` (ไม่ใช่ endpoint) + `native bridge (_liff): มี` (bridge แค่ shell ยังไม่สมบูรณ์) + `access_token: ไม่มี` + init ค้าง 8 วิ → ตรงกับจุดค้าง "รอ ready event" ในโค้ด SDK (บรรทัด `window._liff && window._liff.features`)

อธิบายทุกอาการที่เจอ: เปิดในเบราว์เซอร์ผ่าน (external mode ไม่ต้องใช้ bridge), ทั้ง iOS/Android ค้างเหมือนกัน (LIFF runtime เดียวกัน), SDK เก่า v2.1 ก็ค้าง (iframe เดิม), ไม่มีหน้า consent (LINE ไม่เคยรู้ว่ามี LIFF context เต็ม), หน้าไม่ redirect (init ไม่ถึงขั้นตอน authorize)

---

## 4. สาเหตุ (สรุป)

1. ✅ **ยืนยันแล้ว: GAS iframe (`script.googleusercontent.com/userCodeAppPanel`) → LIFF bridge/ready ไม่สมบูรณ์ → init ค้าง** (ต้นเหตุจริง — แก้โดยโฮสต์หน้า standalone ดูข้อ 5)
2. **Add friend option (aggressive) + Linked OA** — ยังควรตั้ง Linked LINE Official Account ให้ครบ (flow หน้าเพิ่มเพื่อน OA จะได้แสดงได้) แต่**ไม่ใช่ต้นเหตุ**ของค้าง
3. ~~LINE app เวอร์ชันเก่า~~ — ตัดออก (LINE app 26.11.0 บนเครื่องจริง)
4. ~~Channel ยัง Developing~~ — ตัดออก (Published แล้ว)

---

## 5. แนวทางแก้ (Action Plan — วิธีที่ถูกต้อง)

> **สรุป: ต้องให้หน้า LIFF โหลดที่ top-level (ไม่ใช่ iframe ของ GAS) → โฮสต์ `liff-web/index.html` บน static host แล้วเปลี่ยน Endpoint URL ของ LIFF app**

### โค้ดที่เตรียมไว้แล้ว (ใน working tree)
- **`liff-web/index.html`** — หน้า LIFF แบบ standalone (UI เดิมทุกอย่าง) โหลด LIFF SDK ที่ top-level, เรียกข้อมูลผ่าน `fetch` ไปยัง GAS doPost API (`text/plain` JSON → ไม่มี CORS preflight)
- **`src/Code.gs`** — `doPost` รองรับ action `liff*` แล้ว (liffBind/liffUnbind/liffChangePin/liffGetMyStudents/liffGetStudentScore/liffGetNotifications/liffSubmitLeave/liffGetAnnouncements — map ไป apiLiff* ใน LineService.gs)

### สถานะปัจจุบัน (14 ส.ค. 2569 — ใช้งานได้แล้ว)
- **Static host (Netlify):** `https://boisterous-cupcake-6f6374.netlify.app/index.html` — public ✓ (ต้องกด **Claim site** + **Make public** หลังอัปโหลดผ่าน Netlify Drop ไม่งั้นมีรหัสผ่าน/private)
- **GAS:** deploy เป็น **Version 60** แล้ว (URL เดิม) — `doPost` รองรับ `liff*` ครบ + CORS ผ่าน (`Access-Control-Allow-Origin: *`)
- **Endpoint URL ของ LIFF app** = Netlify URL แล้ว (เปลี่ยนจาก `.../exec?page=liff&v=3`)
- **ข้อความทักทาย:** แสดงชื่อจริงผู้ปกครองจาก ID token แทน `[idToken]` (แก้ล่าสุด — ต้องอัปโหลด `liff-web/` ขึ้น Netlify อีกครั้ง ดูวิธีอัปเดตด้านล่าง)

### วิธีอัปเดตหน้า Netlify หลังแก้โค้ด
1. แก้ `liff-web/index.html` ในเครื่องเสร็จ → เข้า https://app.netlify.com → โปรเจกต์ `boisterous-cupcake-6f6374`
2. ที่ช่อง **"Drag and drop your project folder here to deploy new changes"** → ลากโฟลเดอร์ `liff-web` วางใหม่ (ทับ deployment เดิม)
3. รอ Deploy เสร็จ → เปิด URL เดิม ทดสอบ (แบนเดอร์ดีบั๊กควรเป็นเวอร์ชันใหม่)

### ขั้นตอน (ครั้งแรกที่ทำ)
1. **push + deploy GAS**: `clasp push` แล้ว deploy version ใหม่ (URL เดิม — ใช้วิธี A: `clasp deploy -i AKfycbxhqY2Eqf46YxAfJuxW73zNn4JQ3K7NXRFRa3Y_g0-W8ZvJ0Mu2JGxv4zjq7AUHVYFtyQ` หรือวิธี B: Apps Script Editor → Deploy → Manage deployments → ✏️ → New version → Deploy)
2. **อัปโหลด `liff-web/` ขึ้น static host (https) อย่างใดอย่างหนึ่ง:**
   - **Netlify Drop** (ง่ายสุด): เข้า https://app.netlify.com/drop → ลากโฟลเดอร์ `liff-web` วาง → ได้ URL เช่น `https://xxx.netlify.app`
   - **GitHub Pages**: push โฟลเดอร์ `liff-web` ขึ้น GitHub → Settings → Pages → เลือก branch → ได้ `https://<user>.github.io/<repo>/`
   - **Vercel / Firebase Hosting** ก็ได้
3. **LINE Developers Console → ช่อง `ระบบผู้ปกครอง` → แท็บ LIFF → แก้ LIFF app** → **Endpoint URL** = URL จากข้อ 2 (เช่น `https://xxx.netlify.app/index.html`)
4. เปิด `https://liff.line.me/2011098537-oAL9uwZt` ในแอป LINE → ครั้งแรกควรเห็น**หน้าขอยินยอม** → Allow → หน้าโหลด + แบนเดอร์เขียว → ผูกบัญชีได้เลย

### เช็คหลังทำ (แบนเดอร์ของหน้า standalone)
- ควรเห็น `LIFF browser: ใช่`, `top-level: ใช่`, `native bridge (_liff): มี`, `URL: <static-host>` (ไม่ใช่ `...googleusercontent.com`)
- ถ้าเห็น `top-level: ไม่ใช่ (iframe!)` แปลว่ายังโฮสต์ผิดที่ (เช่น ฝังใน iframe อีก)

### สิ่งที่ยังแนะนำให้ทำ (ไม่ใช่ต้นเหตุแต่ควรครบ)
- **Linked LINE Official Account** ใน Basic settings → เลือก OA `student_affairs` (ถ้ายังว่าง) — จำเป็นสำหรับหน้า "เพิ่มเพื่อน OA" ตอน consent (Add friend option aggressive) และเป็นพื้นฐานที่ดีของระบบ
- ทางเลือกอนาคต: LINE แนะนำให้สร้าง LIFF ใหม่เป็น **LINE MINI App** (ตั้งแต่ ก.พ. 2025) — ข้อจำกัดเรื่องโฮสติ้งเหมือนกัน (ต้อง top-level)

### สิ่งที่ v54 (Liff.html ใน GAS) ตรวจให้ — ตอนนี้ไม่ต้องใช้อีกแล้ว
- เดิมใช้ตรวจหาจุดค้าง; ต้นเหตุคือ iframe ของ GAS → หน้าใน GAS ไม่สามารถใช้ LIFF ได้ ทางเดียวคือโฮสต์ standalone (ข้อ 5 ข้างต้น)

---

## 6. ข้อมูลที่เกี่ยวข้อง

| รายการ | ค่า |
|---|---|
| Web App URL (v53) | `https://script.google.com/macros/s/AKfycbxhqY2Eqf46YxAfJuxW73zNn4JQ3K7NXRFRa3Y_g0-W8ZvJ0Mu2JGxv4zjq7AUHVYFtyQ/exec` |
| LIFF ID | `2011098537-oAL9uwZt` |
| LIFF URL | `https://liff.line.me/2011098537-oAL9uwZt` |
| Channel Messaging API | `student_affairs` · ID `2011084567` (provider `student-affairs-system`) |
| Channel LINE Login (โฮสต์ LIFF) | `ระบบผู้ปกครอง` (provider `student-affairs-system`) |
| OA | `student_affairs` · Basic ID `@374rpwus` |

**ไฟล์ที่เกี่ยวข้อง (ปัจจุบัน):**
- `liff-web/index.html` — หน้า LIFF standalone (โฮสต์ static) — เรียก GAS ผ่าน `fetch` POST `text/plain` JSON (แสดงชื่อจริงผู้ปกครองในข้อความทักทาย)
- `src/Code.gs` — `doPost` dispatcher สำหรับ action `liff*` (JSON API)
- `src/Liff.html` — หน้า LIFF เดิมที่โฮสต์ใน GAS (ใช้ไม่ได้กับ LIFF — เหลือไว้เป็นอ้างอิง/ดีบั๊ก v54)
- `src/LineService.gs` — `apiLiff*` (bind/unbind/changePin/students/score/notif/leave/news)
- `src/StudentService.gs` + `src/Setup.gs` — เก็บเลข 0 ของเบอร์โทร (commit: `e1ea2dc`)

**ข้อมูลที่เกี่ยวข้อง:**
- Channel LINE Login `ระบบผู้ปกครอง` → สถานะ **Published** ✓ (ตรวจแล้ว 14 ส.ค. 2569)
- Web App URL: `https://script.google.com/macros/s/AKfycbxhqY2Eqf46YxAfJuxW73zNn4JQ3K7NXRFRa3Y_g0-W8ZvJ0Mu2JGxv4zjq7AUHVYFtyQ/exec`
- LIFF ID: `2011098537-oAL9uwZt` · LIFF URL: `https://liff.line.me/2011098537-oAL9uwZt`
- OA: `student_affairs` · Basic ID `@374rpwus` (provider `student-affairs-system`)
