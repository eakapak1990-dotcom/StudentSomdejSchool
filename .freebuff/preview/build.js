// สร้างไฟล์พรีวิวแบบ standalone จากโค้ดจริงของ Google Apps Script
// วิธีใช้: node .freebuff/preview/build.js
// (จำลองการทำงานของ Code.gs doGet() + include() + CONFIG ในเครื่อง)
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');

// ค่าจาก src/Config.gs (CONFIG) — ใช้เฉพาะค่าที่หน้าเว็บอ้างถึง
const APP_NAME = 'ระบบบริหารงานกลุ่มบริหารกิจการนักเรียน';
const VERSION = '1.0.0';

const index = fs.readFileSync(path.join(SRC, 'Index.html'), 'utf8');
const css = fs.readFileSync(path.join(SRC, 'CSS.html'), 'utf8');
const js = fs.readFileSync(path.join(SRC, 'JavaScript.html'), 'utf8');
const shim = fs.readFileSync(path.join(__dirname, 'shim.html'), 'utf8');

let out = index;
out = out.replace(/<\?= CONFIG\.APP_NAME \?>/g, APP_NAME)
         .replace(/<\?= CONFIG\.VERSION \?>/g, VERSION)
         .replace(/<\?!= include\('CSS'\); \?>/g, css)
         .replace(/<\?!= include\('JavaScript'\); \?>/g, js);

// แทรก shim (จำลอง google.script.run) ก่อน </body> — เฉพาะไฟล์พรีวิวเท่านั้น
out = out.replace('</body>', shim + '\n</body>');

const outDir = path.join(__dirname, 'index.html');
fs.writeFileSync(outDir, out, 'utf8');
console.log('Wrote preview page: ' + outDir + ' (' + out.length + ' chars)');
