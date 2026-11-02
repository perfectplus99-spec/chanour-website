/**
 * ชานัว: เติมละติจูด / ลองจิจูด อัตโนมัติ เมื่อวางลิงก์ Google Maps ในคอลัมน์ G
 *
 * รองรับ
 *   - ลิงก์ย่อจากปุ่มแชร์ในแอปมือถือ  https://maps.app.goo.gl/xxxx  (สคริปต์เปิดลิงก์ให้เอง)
 *   - ลิงก์เต็ม  https://www.google.com/maps/place/...  /  ...?q=14.99,103.10  /  .../@14.99,103.10,17z
 *   - ตัวเลขพิกัด  14.99301, 103.10293
 *
 * คอลัมน์ในแท็บข้อมูลสาขา
 *   A รหัสสาขา | B จังหวัด | C อำเภอหรือเขต | D ละติจูด | E ลองจิจูด | F วันที่บันทึก | G ลิงก์ Google Maps หรือ พิกัด | H สถานะพิกัด
 *
 * ติดตั้งครั้งเดียว: วางโค้ดนี้ใน ส่วนขยาย > Apps Script แล้วกดเรียกใช้ฟังก์ชัน setup แล้วกดอนุญาต
 */

var LINK_COL = 7;   // G
var LAT_COL = 4;    // D
var LNG_COL = 5;    // E
var STATUS_COL = 8; // H
var FIRST_ROW = 2;

/** รันครั้งเดียว: สร้างตัวทำงานอัตโนมัติเมื่อแก้ชีต และหัวคอลัมน์ G / H */
function setup() {
  var ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onLinkEdit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onLinkEdit').forSpreadsheet(ss).onEdit().create();
  var sh = dataSheet_();
  if (!sh.getRange(1, LINK_COL).getValue()) sh.getRange(1, LINK_COL).setValue('ลิงก์ Google Maps หรือ พิกัด');
  if (!sh.getRange(1, STATUS_COL).getValue()) sh.getRange(1, STATUS_COL).setValue('สถานะพิกัด');
  SpreadsheetApp.getActive().toast('ตั้งค่าเสร็จแล้ว วางลิงก์ในคอลัมน์ G ได้เลย', 'ชานัว', 5);
}

/** เมนูบนชีต */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('ชานัว')
    .addItem('อัปเดตพิกัดจากลิงก์ทุกแถว', 'updateAllRows')
    .addToUi();
}

/** ทำงานทุกครั้งที่มีการแก้ชีต: ถ้าแก้คอลัมน์ G ให้แปลงลิงก์เป็นพิกัด */
function onLinkEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (!isDataSheet_(sh)) return;
  var r0 = e.range.getRow(), c0 = e.range.getColumn();
  var nr = e.range.getNumRows(), nc = e.range.getNumColumns();
  if (c0 > LINK_COL || c0 + nc - 1 < LINK_COL) return;
  for (var r = Math.max(r0, FIRST_ROW); r < r0 + nr; r++) fillRow_(sh, r);
}

/** เมนู: อ่านคอลัมน์ G ทุกแถวใหม่ (ใช้หลังติดตั้ง หรือเมื่อสงสัยว่าพิกัดไม่ตรง) */
function updateAllRows() {
  SpreadsheetApp.getActive().getSheets().filter(isDataSheet_).forEach(function (sh) {
    var last = sh.getLastRow();
    for (var r = FIRST_ROW; r <= last; r++) {
      if (String(sh.getRange(r, LINK_COL).getValue()).trim()) fillRow_(sh, r);
    }
  });
  SpreadsheetApp.getActive().toast('อัปเดตพิกัดเรียบร้อย', 'ชานัว', 5);
}

function fillRow_(sh, r) {
  var text = String(sh.getRange(r, LINK_COL).getValue()).trim();
  var status = sh.getRange(r, STATUS_COL);
  if (!text) { status.clearContent(); return; }
  var res = coordsFromLink(text, fetchUrl_);
  if (res.lat != null) {
    sh.getRange(r, LAT_COL, 1, 2).setNumberFormat('@').setValues([[String(res.lat), String(res.lng)]]);
    status.setValue('✓ ใช้ได้');
  } else {
    sh.getRange(r, LAT_COL, 1, 2).clearContent();
    status.setValue('⚠ ' + res.error);
  }
}

/** แท็บที่สคริปต์ดูแล = แท็บที่ช่อง A1 เขียนว่า "รหัสสาขา" (แท็บทดสอบที่ก๊อปหัวตารางไปก็ใช้ได้) */
function isDataSheet_(sh) {
  return String(sh.getRange(1, 1).getValue()).trim() === 'รหัสสาขา';
}

function dataSheet_() {
  var sheets = SpreadsheetApp.getActive().getSheets().filter(isDataSheet_);
  return sheets.length ? sheets[0] : SpreadsheetApp.getActive().getSheets()[0];
}

/** ดึงหน้าเว็บโดยไม่ตามลิงก์ต่อเอง เพื่อจะได้เห็นที่อยู่ปลายทางของลิงก์ย่อ */
function fetchUrl_(url) {
  var res = UrlFetchApp.fetch(url, {
    followRedirects: false, muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36', 'Accept-Language': 'th,en' }
  });
  var h = res.getAllHeaders();
  return { status: res.getResponseCode(), location: h.Location || h.location || '', body: res.getContentText() };
}

/* ---------- ส่วนคำนวณ (ไม่ใช้บริการของกูเกิล ทดสอบนอกชีตได้) ---------- */

function inThailand_(lat, lng) { return lat >= 5 && lat <= 21 && lng >= 97 && lng <= 106.5; }

/** หาพิกัดในข้อความ: ลิงก์เต็มแบบต่างๆ หรือ ตัวเลขพิกัดคู่ */
function parseCoords(text) {
  var t = String(text || '');
  try { t = decodeURIComponent(t); } catch (e) { /* ใช้ข้อความเดิม */ }
  var num = '(-?\\d{1,3}\\.\\d+)';
  var patterns = [
    new RegExp('!3d' + num + '!4d' + num),                                    // จุดของสถานที่
    new RegExp('[?&](?:q|ll|query|destination|center|sll)=(?:loc:)?' + num + '\\s*,\\s*\\+?' + num),
    new RegExp('/(?:search|place|dir)/' + num + ',\\s*\\+?' + num),
    new RegExp('center=' + num + ',' + num),                                  // ภาพแผนที่ในหน้าเว็บ
    new RegExp('@' + num + ',' + num),                                        // จุดกึ่งกลางแผนที่
    new RegExp('^\\s*\\(?\\s*' + num + '\\s*[, ]\\s*' + num + '\\s*\\)?\\s*$')  // 14.99, 103.10
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = t.match(patterns[i]);
    if (!m) continue;
    var a = parseFloat(m[1]), b = parseFloat(m[2]);
    if (inThailand_(a, b)) return { lat: a, lng: b };
    if (inThailand_(b, a)) return { lat: b, lng: a };
  }
  return null;
}

/** ในหน้าเว็บ Google Maps พิกัดอยู่ในรูป [ระดับซูม, ลองจิจูด, ละติจูด] */
function parseCoordsFromPage(html) {
  var direct = parseCoords(html.replace(/\\u0026/g, '&').replace(/&amp;/g, '&'));
  if (direct) return direct;
  var re = /\[\s*-?\d+(?:\.\d+)?\s*,\s*(-?\d{2,3}\.\d+)\s*,\s*(-?\d{1,2}\.\d+)\s*\]/g, m;
  while ((m = re.exec(html))) {
    var lng = parseFloat(m[1]), lat = parseFloat(m[2]);
    if (inThailand_(lat, lng)) return { lat: lat, lng: lng };
  }
  return null;
}

/**
 * แปลงลิงก์หรือข้อความเป็นพิกัด
 * @param {string} text  ข้อความในคอลัมน์ G
 * @param {function(string):{status:number,location:string,body:string}} fetch  ตัวดึงหน้าเว็บ
 * @return {{lat:number,lng:number}|{lat:null,error:string}}
 */
function coordsFromLink(text, fetch) {
  var t = String(text || '').trim();
  var direct = parseCoords(t);
  if (direct) return direct;
  if (!/^https?:\/\//i.test(t)) return { lat: null, error: 'ไม่ใช่ลิงก์หรือตัวเลขพิกัด' };
  if (!/(google\.[a-z.]+\/maps|maps\.google\.|goo\.gl|maps\.app\.goo\.gl|g\.co\/kgs)/i.test(t)) {
    return { lat: null, error: 'ไม่ใช่ลิงก์ Google Maps' };
  }
  var url = t;
  try {
    for (var hop = 0; hop < 6; hop++) {
      var res = fetch(url);
      if (res.status >= 300 && res.status < 400 && res.location) {
        url = res.location.indexOf('http') === 0 ? res.location : 'https://www.google.com' + res.location;
        var fromUrl = parseCoords(url);
        if (fromUrl) return fromUrl;
        continue;
      }
      if (res.status === 200) {
        var fromPage = parseCoordsFromPage(res.body || '');
        if (fromPage) return fromPage;
      }
      break;
    }
  } catch (e) {
    return { lat: null, error: 'เปิดลิงก์ไม่สำเร็จ ลองใหม่ หรือใช้ตัวเลขพิกัดแทน' };
  }
  return { lat: null, error: 'หาพิกัดในลิงก์ไม่เจอ ให้กดค้างบนแผนที่แล้วคัดลอกตัวเลขพิกัดแทน' };
}

// ให้ทดสอบนอกชีตได้ (ใน Apps Script ไม่มี module จึงไม่มีผล)
if (typeof module !== 'undefined') module.exports = { parseCoords: parseCoords, parseCoordsFromPage: parseCoordsFromPage, coordsFromLink: coordsFromLink };
