// End-to-end check of /check-branch in a real browser (Chromium via Playwright).
// Run: node tests/e2e.cjs   (serves the repo itself on a local port; the sheet is mocked)
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SHEET = "https://sheet.test/pub?output=csv";
const SAMPLE = fs.readFileSync(path.join(ROOT, "check-branch/data/branches-sample.csv"), "utf8");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".geojson": "application/json", ".csv": "text/csv", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg" };

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        // mimic GitHub Pages: /check-branch → /check-branch/
        if (fs.existsSync(f) && fs.statSync(f).isDirectory()) { rsp.writeHead(301, { Location: p + "/" + (req.url.split("?")[1] ? "?" + req.url.split("?")[1] : "") }); return rsp.end(); }
        rsp.writeHead(404); return rsp.end();
      }
      rsp.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(rsp);
    }).listen(0, () => res(srv));
  });
}

let failures = 0;
const ok = (cond, name) => { console.log((cond ? "PASS " : "FAIL ") + name); if (!cond) failures++; };

(async () => {
  const srv = await serve();
  const base = `http://localhost:${srv.address().port}`;
  const browser = await chromium.launch();

  async function open(url, { csv = SAMPLE, status = 200, mobile = true } = {}) {
    const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "th-TH" } : { viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const fetched = [];
    page.on("pageerror", e => { console.log("  pageerror:", e.message); failures++; });
    await page.route("**/check-branch/config.js", async route => {
      const body = fs.readFileSync(path.join(ROOT, "check-branch/config.js"), "utf8").replace('SHEET_CSV_URL: ""', `SHEET_CSV_URL: "${SHEET}"`);
      route.fulfill({ status: 200, contentType: "text/javascript", body });
    });
    await page.route("https://sheet.test/**", route => { fetched.push(route.request().url()); status === "abort" ? route.abort() : route.fulfill({ status, contentType: "text/csv", body: csv, headers: { "Access-Control-Allow-Origin": "*" } }); });
    await page.route(/tile\.openstreetmap\.org|fonts\.(googleapis|gstatic)\.com|nominatim/, route => route.abort());
    await page.goto(base + url);
    await page.waitForFunction(() => document.body.dataset.state);
    return { page, ctx, fetched };
  }
  const resultText = page => page.$eval("#result", el => el.dataset.status || "").catch(() => "");

  // 1. Header stats + cache buster
  {
    const { page, ctx, fetched } = await open("/check-branch/");
    ok((await page.textContent("#asOf")) === "28 ตุลาคม 2569", "ข้อมูล ณ วันที่ = วันที่บันทึกล่าสุด");
    ok((await page.textContent("#total")) === "5 สาขา", "จำนวนสาขาทั้งหมด 5");
    ok(/[?&]t=\d+/.test(fetched[0] || ""), "เติมค่าเวลาท้ายลิงก์ชีต: " + fetched[0]);
    ok((await page.$$eval(".prov", els => els.length)) === 3, "รายการสาขาแยก 3 จังหวัด");
    await page.waitForTimeout(800);
    await page.screenshot({ path: process.env.SHOTS + "/01-top.png", fullPage: true }).catch(() => {});
    await ctx.close();
  }

  // 2. Rural district WITH a branch, chosen by typing
  {
    const { page, ctx } = await open("/check-branch/");
    await page.fill("#provInput", "บุรีรัม");
    await page.click("#provList li[data-i='0']");
    await page.fill("#distInput", "นางรอง");
    await page.keyboard.press("Enter");
    await page.waitForSelector("#result.result");
    ok((await resultText(page)) === "มีสาขาแล้ว", "อำเภอรอบนอกที่มีสาขา (นางรอง) → มีสาขาแล้ว");
    ok(await page.isVisible("#againBtn"), "มีปุ่มเช็คใหม่");
    ok(!(await page.isVisible("#step2")), "อำเภอรอบนอกไม่ต้องปักหมุด");
    await page.screenshot({ path: process.env.SHOTS + "/02-rural-taken.png" }).catch(() => {});
    await page.click("#againBtn");
    ok((await page.inputValue("#provInput")) === "" && (await page.$eval("#result", e => e.innerHTML.trim())) === "", "กดเช็คใหม่แล้วล้างค่า");
    await ctx.close();
  }

  // 3. Rural district WITHOUT a branch via prefilled link (with “อำเภอ” prefix + typo)
  {
    const { page, ctx } = await open("/check-branch?" + new URLSearchParams({ "จังหวัด": "จ.บุรีรัมย์", "อำเภอ": "อำเภอประโคนชัย" }));
    await page.waitForSelector("#result.result");
    ok((await resultText(page)) === "ว่าง", "ลิงก์ล่วงหน้า อ.ประโคนชัย → ว่าง ทันที");
    const href = await page.getAttribute("#result a.btn-green", "href");
    ok(href === "https://lin.ee/UHhTVER", "ปุ่มทักทีมงานลิงก์ไปแชต: " + href);
    ok((await page.inputValue("#provInput")) === "บุรีรัมย์" && (await page.inputValue("#distInput")) === "อำเภอประโคนชัย", "เลือกจังหวัดอำเภอให้อัตโนมัติ");
    await page.screenshot({ path: process.env.SHOTS + "/03-rural-free.png" }).catch(() => {});
    await ctx.close();
  }
  {
    const { page, ctx } = await open("/check-branch?" + new URLSearchParams({ "จังหวัด": "บุรีรัมย์", "อำเภอ": "นางรอ" }));
    await page.waitForSelector("#result.result");
    ok((await resultText(page)) === "มีสาขาแล้ว", "ลิงก์สะกดผิดเล็กน้อย (นางรอ) → จับคู่ นางรอง → มีสาขาแล้ว");
    await ctx.close();
  }

  // 4. Urban: pin 2.9 km / 3.0 km from CB-001 (14.9930, 103.1029) via the paste box
  const dest = (lat, lng, km, deg) => {
    const R = 6371.0088, r = Math.PI / 180, d = km / R, b = deg * r, p1 = lat * r, l1 = lng * r;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return [p2 / r, l2 / r];
  };
  {
    const { page, ctx } = await open("/check-branch?" + new URLSearchParams({ "จังหวัด": "บุรีรัมย์", "อำเภอ": "เมือง" }));
    await page.waitForSelector("#step2:not([hidden])");
    ok((await page.$eval("#result", e => e.innerHTML.trim())) === "", "เขตเมืองยังไม่ตอบจนกว่าจะปักหมุด");
    const [a, b] = dest(14.9930, 103.1029, 2.9, 200);
    await page.fill("#pasteInput", `${a.toFixed(7)}, ${b.toFixed(7)}`);
    await page.click("#pasteForm button");
    await page.waitForSelector("#result.result");
    ok((await resultText(page)) === "มีสาขาแล้ว", "เขตเมือง ห่าง 2.9 กม. → มีสาขาแล้ว");
    ok((await page.textContent("#result .dist")).includes("2.9"), "แสดงระยะ 2.9 กม.");
    ok((await page.textContent("#result")).includes("วัดระยะแบบเส้นตรง"), "มีข้อความ วัดระยะแบบเส้นตรง");
    await page.screenshot({ path: process.env.SHOTS + "/04-urban-taken.png" }).catch(() => {});
    const [c, d] = dest(14.9930, 103.1029, 3.0, 200);
    await page.fill("#pasteInput", `https://www.google.com/maps/place/x/@${c},${d},17z/data=!3m1!4b1!8m2!3d${c.toFixed(7)}!4d${d.toFixed(7)}`);
    await page.click("#pasteForm button");
    await page.waitForFunction(() => document.querySelector("#result").dataset.status === "ว่าง");
    ok((await resultText(page)) === "ว่าง", "เขตเมือง ห่าง 3.0 กม. (วางลิงก์แผนที่กูเกิล) → ว่าง");
    ok((await page.textContent("#result .dist")).includes("3.0"), "แสดงระยะ 3.0 กม.");
    await page.screenshot({ path: process.env.SHOTS + "/05-urban-free.png" }).catch(() => {});
    // Tap on the map also works
    const box = await page.locator("#pinMap").boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(200);
    ok(["ว่าง", "มีสาขาแล้ว"].includes(await resultText(page)), "แตะบนแผนที่แล้วได้ผล");
    await ctx.close();
  }

  // 5. Urban pin inside อ.เมืองบุรีรัมย์ but < 3 km from a branch in neighbouring อ.ลำปลายมาศ
  {
    const { page, ctx } = await open("/check-branch?" + new URLSearchParams({ "จังหวัด": "บุรีรัมย์", "อำเภอ": "เมืองบุรีรัมย์" }));
    await page.waitForSelector("#step2:not([hidden])");
    await page.fill("#pasteInput", "14.8424, 102.9166");
    await page.click("#pasteForm button");
    await page.waitForSelector("#result.result");
    ok((await resultText(page)) === "มีสาขาแล้ว", "จุดในอำเภอเมือง ห่างสาขาอำเภอข้างเคียง < 3 กม. → มีสาขาแล้ว");
    await ctx.close();
  }

  // 6. Geolocation button
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["geolocation"], geolocation: { latitude: 16.4322, longitude: 102.8236 } });
    const page = await ctx.newPage();
    await page.route("**/check-branch/config.js", r => r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(ROOT, "check-branch/config.js"), "utf8").replace('SHEET_CSV_URL: ""', `SHEET_CSV_URL: "${SHEET}"`) }));
    await page.route("https://sheet.test/**", r => r.fulfill({ contentType: "text/csv", body: SAMPLE, headers: { "Access-Control-Allow-Origin": "*" } }));
    await page.route(/tile\.openstreetmap\.org|fonts\./, r => r.abort());
    await page.goto(base + "/check-branch/?จังหวัด=ขอนแก่น&อำเภอ=เมืองขอนแก่น");
    await page.waitForSelector("#step2:not([hidden])");
    await page.click("#locBtn");
    await page.waitForSelector("#result.result");
    ok((await resultText(page)) === "มีสาขาแล้ว" && (await page.textContent("#result .dist")).includes("0.0"), "ปุ่มใช้ตำแหน่งปัจจุบันของฉัน ทำงาน");
    await ctx.close();
  }

  // 7. Failure modes must never answer ว่าง
  for (const [name, opts] of [
    ["ชีตว่างเปล่า (มีแต่หัวตาราง)", { csv: "รหัสสาขา,จังหวัด,อำเภอหรือเขต,ละติจูด,ลองจิจูด,วันที่บันทึก\n" }],
    ["ดึงข้อมูลไม่สำเร็จ (HTTP 500)", { status: 500 }],
    ["ดึงข้อมูลไม่สำเร็จ (เครือข่ายล่ม)", { status: "abort" }],
    ["ชีตยังไม่เผยแพร่ (ได้หน้า HTML)", { csv: "<!DOCTYPE html><html>sign in</html>" }],
  ]) {
    const { page, ctx } = await open("/check-branch?" + new URLSearchParams({ "จังหวัด": "บุรีรัมย์", "อำเภอ": "ประโคนชัย" }), opts);
    const shown = await page.isVisible("#loadError");
    const txt = await page.textContent("#loadError");
    ok(shown && txt.includes("โหลดหน้าใหม่") && (await resultText(page)) === "" && !(await page.isVisible("#step1")), name + " → แจ้งให้โหลดหน้าใหม่ ไม่ตอบว่าว่าง");
    if (name.startsWith("ชีตว่าง")) await page.screenshot({ path: process.env.SHOTS + "/06-error.png" }).catch(() => {});
    await ctx.close();
  }
  // config not filled in yet
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.route(/tile\.openstreetmap\.org|fonts\./, r => r.abort());
    await page.goto(base + "/check-branch/");
    await page.waitForFunction(() => document.body.dataset.state);
    ok(await page.isVisible("#loadError"), "ยังไม่ใส่ลิงก์ชีตในไฟล์ตั้งค่า → แจ้งให้โหลดหน้าใหม่");
    await ctx.close();
  }

  // 8. Links from the main site
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } });
    const page = await ctx.newPage();
    await page.route(/fonts\./, r => r.abort());
    await page.goto(base + "/");
    const hrefs = await page.$$eval('a[href^="/check-branch"]', as => as.map(a => [a.textContent.trim(), a.closest("nav, #price, #kit")?.id || a.closest("nav")?.className]));
    ok(hrefs.some(h => h[1] === "nav") && hrefs.some(h => h[1] === "price") && hrefs.some(h => h[1] === "kit"), "ปุ่มเช็คสาขาว่าง อยู่ที่เมนูบนสุด / ค่าแฟรนไชส์ / ใต้ตารางแพ็กเกจ: " + JSON.stringify(hrefs));
    ok(await page.isVisible('nav a[href^="/check-branch"]'), "ปุ่มบนเมนูเห็นได้บนมือถือ");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    ok(!overflow, "หน้าแรกไม่ล้นจอที่ความกว้าง 360px");
    await page.screenshot({ path: process.env.SHOTS + "/07-home-nav.png" }).catch(() => {});
    await page.click('nav a[href^="/check-branch"]');
    await page.waitForURL(/check-branch/);
    ok(true, "กดแล้วไปหน้า /check-branch");
    await ctx.close();
  }
  {
    const { page, ctx } = await open("/check-branch/", { mobile: true });
    ok(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "หน้าเช็คสาขาไม่ล้นจอบนมือถือ");
    await ctx.close();
  }

  await browser.close();
  srv.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})();
