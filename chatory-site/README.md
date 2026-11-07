# เว็บแฟรนไชส์ชาโทรี่ — chatorythailand.com

เว็บไซต์ static (HTML + รูป + ไฟล์ข้อมูล) ไม่ต้อง build ใช้กับ Cloudflare Pages
โฟลเดอร์นี้แยกจากเว็บชานัวทั้งหมด (ไม่ใช้ไฟล์ร่วมกัน)

## ตั้งค่า Cloudflare Pages (ครั้งเดียว)

Workers & Pages → Create → Pages → Connect to Git → เลือก repo `chanour-website`

| ช่อง | ค่า |
|---|---|
| Production branch | `claude/kind-thompson-ldgjf4` |
| Framework preset | None |
| Build command | (เว้นว่าง) |
| Build output directory | `chatory-site` |

แล้วไปที่ Custom domains → เพิ่ม `chatorythailand.com` และ `www.chatorythailand.com`

ทุกครั้งที่มีการ push ไฟล์ในโฟลเดอร์นี้ขึ้น branch ข้างบน Cloudflare จะอัปเดตเว็บให้อัตโนมัติ

## ไฟล์

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `index.html` | หน้าเว็บทั้งหมด (สไตล์และสคริปต์อยู่ในไฟล์) |
| `branches.json` | รายชื่อ 34 สาขาพร้อมพิกัด จากชีต “เช็คสาขา ชาโทรี่ และ โทริ” |
| `th-districts.json` | ขอบเขตอำเภอทั่วไทย ใช้วาดแผนที่และเช็คทำเล (OCHA / กรมแผนที่ทหาร) |
| `assets/` | รูป โลโก้ ภาพเคลื่อนไหวโปรโมชั่น |
| `_headers` | ตั้งค่า cache ของ Cloudflare Pages |

## อัปเดตสาขา

แก้ `branches.json` ให้ตรงกับชีต (ช่อง `brand` ใช้ `chatory` หรือ `torii`) แล้วแก้ `updated` เป็นวันที่ล่าสุด
