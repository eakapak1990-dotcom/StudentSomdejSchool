# ระบบงานกิจการนักศึกษา (Student Affairs System)

ระบบบริหารจัดการงานกิจการนักศึกษา พัฒนาด้วย Google Apps Script

## Tech Stack

- **Frontend/Backend:** Google Apps Script (GAS)
- **Database:** Google Sheets
- **IDE:** VS Code + clasp
- **Version Control:** GitHub

## โครงสร้างโปรเจกต์

```
student-affairs-system/
├── src/
│   ├── appsscript.json   ← GAS configuration
│   ├── Code.gs           ← Main entry point (doGet, doPost)
│   ├── Config.gs         ← ตั้งค่าระบบและ Database
│   └── Index.html        ← Frontend UI (จะเพิ่มภายหลัง)
├── .clasp.json           ← clasp configuration
├── .gitignore
└── README.md
```

## การพัฒนา

### ติดตั้ง

```bash
nvm use 20
npm install -g @google/clasp
clasp login
```

### Push โค้ดขึ้น Google Apps Script

```bash
clasp push
```

### Pull โค้ดจาก Google Apps Script

```bash
clasp pull
```

### เปิด GAS Editor ใน Browser

```bash
clasp open
```

## Workflow

1. แก้โค้ดใน VS Code
2. `clasp push` → ส่งขึ้น Google Apps Script
3. `git add . && git commit -m "message"` → บันทึก
4. `git push` → ส่งขึ้น GitHub
