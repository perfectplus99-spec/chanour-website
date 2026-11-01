# chanour-website
เว็บไซต์แบรนด์ชานัว (Chanour)

## หน้าเช็คสาขาว่าง (`/check-branch`)

- โค้ดหน้าเว็บ: `check-branch/` (ตั้งค่าที่ `check-branch/config.js`, กฎตัดสินที่ `check-branch/logic.js`)
- รายชื่อจังหวัด อำเภอ เขต ทั้งประเทศ (77 จังหวัด 928 อำเภอ/เขต) พร้อมขอบเขตอำเภอ: `check-branch/data/`
  ที่มา: OCHA / Royal Thai Survey Department ผ่านแพ็กเกจ thai-geolocate (MIT) ปรับให้เบาลงด้วย mapshaper
- ไฟล์ตัวอย่างชีต: `check-branch/data/branches-sample.csv`
- คู่มือแอดมิน: [`docs/คู่มือแอดมิน-เช็คสาขาว่าง.md`](docs/คู่มือแอดมิน-เช็คสาขาว่าง.md)
- ทดสอบ: `node --test tests/*.test.mjs` และ `node tests/e2e.cjs` (ต้องมี Playwright)
