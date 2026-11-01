// Pure decision logic for the branch-availability checker.
// No DOM access here, so the same file runs in the browser and in `node --test`.

export const RESULT_FREE = "free";   // "ว่าง"
export const RESULT_TAKEN = "taken"; // "มีสาขาแล้ว"

const BANGKOK = "กรุงเทพมหานคร";

// ---------- Thai name normalisation and fuzzy matching ----------

const PROVINCE_ALIASES = {
  "กรุงเทพ": BANGKOK, "กรุงเทพฯ": BANGKOK, "กทม": BANGKOK, "กรุงเทพมหานคร": BANGKOK, "bangkok": BANGKOK,
  "โคราช": "นครราชสีมา", "อยุธยา": "พระนครศรีอยุธยา", "กรุงเก่า": "พระนครศรีอยุธยา",
  "นครศรี": "นครศรีธรรมราช",
};

/** Strip prefixes, spaces, punctuation and Unicode variants so that
 *  "อ. นางรอง", "อำเภอนางรอง" and "นางรอง" all compare equal. */
export function normalizeName(s) {
  if (s == null) return "";
  let t = String(s).normalize("NFC")
    .replace(/[​-‍﻿]/g, "")
    .replace(/ํา/g, "ำ") // ํ + า  →  ำ (common typing variant)
    .trim().toLowerCase();
  t = t.replace(/^(จังหวัด|จ\.|กิ่งอำเภอ|กิ่ง\s*อ\.|อำเภอ|อ\.|เขต)\s*/u, "");
  return t.replace(/[\s.\-_,()ฯ]/g, "");
}

export function levenshtein(a, b) {
  a = [...a]; b = [...b];
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Find the best candidate for a typed name. Returns the candidate or null.
 *  Order: exact → unique prefix/contains → smallest edit distance within tolerance. */
export function matchName(input, candidates, key = x => x) {
  const q = normalizeName(input);
  if (!q) return null;
  const norm = candidates.map(c => [c, normalizeName(key(c))]);
  const exact = norm.find(([, n]) => n === q);
  if (exact) return exact[0];
  const pre = norm.filter(([, n]) => n.startsWith(q) || q.startsWith(n));
  if (pre.length === 1 && Math.min(q.length, normalizeName(key(pre[0][0])).length) >= 2) return pre[0][0];
  const sub = norm.filter(([, n]) => n.includes(q) || q.includes(n));
  if (sub.length === 1 && q.length >= 3) return sub[0][0];
  let best = null, bestD = Infinity;
  for (const [c, n] of norm) {
    const d = levenshtein(q, n);
    if (d < bestD) { bestD = d; best = c; }
  }
  const tolerance = Math.max(1, Math.floor([...q].length / 4));
  return bestD <= tolerance ? best : null;
}

export function matchProvince(input, provinces) {
  const alias = PROVINCE_ALIASES[normalizeName(input)] || PROVINCE_ALIASES[String(input || "").trim()];
  if (alias && provinces.includes(alias)) return alias;
  return matchName(input, provinces);
}

// ---------- Area type ----------

/** "urban" = เขตเมือง (3 km radius rule), "rural" = อำเภอรอบนอก (1 branch per district). */
export function classifyDistrict(province, district, cfg) {
  const has = list => (list || []).some(([p, d]) => p === province && d === district);
  if (has(cfg.FORCE_URBAN)) return "urban";
  if (has(cfg.FORCE_RURAL)) return "rural";
  if (province === BANGKOK) return "urban";
  if ((cfg.URBAN_WHOLE_PROVINCES || []).includes(province)) return "urban";
  if (district.startsWith("เมือง")) return "urban";
  return "rural";
}

/** Build a lookup over the national district list, adding the area type. */
export function buildDistrictIndex(rows, cfg) {
  const byProvince = new Map();
  const byCode = new Map();
  for (const r of rows) {
    const item = { ...r, type: classifyDistrict(r.p, r.d, cfg) };
    if (!byProvince.has(r.p)) byProvince.set(r.p, []);
    byProvince.get(r.p).push(item);
    byCode.set(r.code, item);
  }
  const provinces = [...byProvince.keys()].sort((a, b) => a.localeCompare(b, "th"));
  for (const list of byProvince.values()) list.sort((a, b) => a.d.localeCompare(b.d, "th"));
  return { provinces, byProvince, byCode };
}

export function findDistrict(index, provinceInput, districtInput) {
  const province = matchProvince(provinceInput, index.provinces);
  if (!province) return { province: null, district: null };
  if (districtInput == null || String(districtInput).trim() === "") return { province, district: null };
  const district = matchName(districtInput, index.byProvince.get(province), x => x.d);
  return { province, district };
}

export function districtLabel(item) {
  return (item.p === BANGKOK ? "เขต" : "อำเภอ") + item.d;
}

// ---------- Geometry ----------

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371.0088, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Point `km` away from (lat,lng) on bearing `deg` — used by tests to build exact distances. */
export function destination(lat, lng, km, deg) {
  const R = 6371.0088, rad = Math.PI / 180, d = km / R, b = deg * rad;
  const p1 = lat * rad, l1 = lng * rad;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 / rad, l2 / rad];
}

const inThailand = (lat, lng) => lat >= 5 && lat <= 21 && lng >= 97 && lng <= 106.5;

// ---------- CSV ----------

export function parseCSV(text) {
  text = String(text).replace(/^﻿/, "");
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}

const num = s => {
  const t = String(s ?? "").trim().replace(/[^\d.\-]/g, "");
  return t === "" ? NaN : Number(t);
};

/** Accepts 2026-11-01, 1/11/2026, 01-11-2569 (Buddhist year) etc. Returns a Date at local midnight or null. */
export function parseDate(s) {
  const t = String(s ?? "").trim();
  let y, m, d, mt;
  if ((mt = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) [y, m, d] = [mt[1], mt[2], mt[3]];
  else if ((mt = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) [d, m, y] = [mt[1], mt[2], mt[3]];
  else return null;
  y = +y; m = +m; d = +d;
  if (y > 2400) y -= 543;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  return dt.getMonth() === m - 1 ? dt : null;
}

const THAI_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
export function formatThaiDate(dt) {
  return `${dt.getDate()} ${THAI_MONTHS[dt.getMonth()]} ${dt.getFullYear() + 543}`;
}

/**
 * Turn the sheet CSV into branch records.
 * Columns by position: รหัสสาขา | จังหวัด | อำเภอหรือเขต | ละติจูด | ลองจิจูด | วันที่บันทึก
 * Every non-empty row is a booked branch. Rows we cannot fully read are still kept
 * (and reported in `problems`) so that a typo never turns a booked area into "ว่าง".
 */
export function parseBranches(csvText, index) {
  const rows = parseCSV(csvText);
  if (rows.length && isNaN(num(rows[0][3])) && isNaN(num(rows[0][4]))) rows.shift(); // header row
  const branches = [], problems = [];
  rows.forEach((r, i) => {
    const [code = "", prov = "", dist = "", latS = "", lngS = "", dateS = ""] = r.map(c => String(c).trim());
    if (![code, prov, dist, latS, lngS].some(Boolean)) return;
    const line = i + 2;
    let lat = num(latS), lng = num(lngS);
    if (inThailand(lng, lat) && !inThailand(lat, lng)) [lat, lng] = [lng, lat]; // columns swapped
    const coordsOk = Number.isFinite(lat) && Number.isFinite(lng) && inThailand(lat, lng);
    const { province, district } = findDistrict(index, prov, dist);
    const b = {
      code, provinceRaw: prov, districtRaw: dist,
      province: province || prov, district: district ? district.d : dist,
      districtCode: district ? district.code : null,
      type: district ? district.type : null,
      lat: coordsOk ? lat : null, lng: coordsOk ? lng : null,
      date: parseDate(dateS),
    };
    if (!district) problems.push({ line, code, msg: `หาอำเภอ "${dist}" จังหวัด "${prov}" ไม่พบ` });
    if (!coordsOk) problems.push({ line, code, msg: `พิกัดไม่ถูกต้อง (${latS}, ${lngS})` });
    if (!b.date && dateS) problems.push({ line, code, msg: `อ่านวันที่ "${dateS}" ไม่ได้` });
    branches.push(b);
  });
  const dates = branches.map(b => b.date).filter(Boolean);
  const latest = dates.length ? new Date(Math.max(...dates)) : null;
  return { branches, problems, latest };
}

// ---------- The decision ----------

/** Distance shown to the customer: truncated (not rounded) to 0.1 km so the number
 *  never contradicts the verdict — e.g. 2.96 km shows "2.9", never "3.0" next to "มีสาขาแล้ว". */
export function displayKm(km) {
  return (Math.floor(Math.round(km * 1000) / 100) / 10).toFixed(1);
}

/** อำเภอรอบนอก: taken when any branch in the sheet is in that district. */
export function checkRural(district, branches) {
  const n = branches.filter(b =>
    b.districtCode ? b.districtCode === district.code
      : normalizeName(b.province) === normalizeName(district.p) && normalizeName(b.district) === normalizeName(district.d)
  ).length;
  return { status: n > 0 ? RESULT_TAKEN : RESULT_FREE, count: n };
}

/** เขตเมือง: straight-line distance from the pin to every branch in the sheet, any district.
 *  Taken when the nearest branch is closer than `radiusKm` (compared in whole metres). */
export function checkUrban(lat, lng, branches, radiusKm = 3, district = null) {
  let nearest = Infinity;
  for (const b of branches) {
    if (b.lat == null) continue;
    nearest = Math.min(nearest, haversineKm(lat, lng, b.lat, b.lng));
  }
  // A booked branch in this very district without usable coordinates: we cannot measure,
  // so never claim "ว่าง" — ask the customer to contact the team instead.
  const unmeasurable = district && branches.some(b => b.lat == null && b.districtCode === district.code);
  const takenByDistance = Math.round(nearest * 1000) < Math.round(radiusKm * 1000);
  if (!takenByDistance && unmeasurable) return { status: "unknown", nearestKm: nearest };
  return { status: takenByDistance ? RESULT_TAKEN : RESULT_FREE, nearestKm: nearest };
}

// ---------- Reading a location the customer pasted ----------

/** Pull coordinates out of pasted text: "13.75, 100.50", Google Maps URLs (…/@lat,lng,…  !3dlat!4dlng
 *  ?q=lat,lng  ll=  query=  destination=), or degrees-minutes-seconds. Returns [lat,lng] or null. */
export function parseLatLng(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const ok = (a, b) => {
    a = +a; b = +b;
    if (inThailand(a, b)) return [a, b];
    if (inThailand(b, a)) return [b, a];
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 ? [a, b] : null;
  };
  let m;
  const dec = "(-?\\d{1,3}\\.\\d+)";
  if ((m = t.match(new RegExp(`!3d${dec}!4d${dec}`)))) return ok(m[1], m[2]);
  let u = t; try { u = decodeURIComponent(t); } catch { /* keep raw */ }
  if ((m = u.match(new RegExp(`[?&](?:q|ll|query|destination|center|sll)=(?:loc:)?${dec}\\s*,\\s*${dec}`)))) return ok(m[1], m[2]);
  if ((m = u.match(new RegExp(`/(?:search|place|dir)/${dec},\\s*\\+?${dec}`)))) return ok(m[1], m[2]);
  if ((m = u.match(new RegExp(`@${dec},${dec}`)))) return ok(m[1], m[2]);
  if ((m = u.match(/^\s*\(?\s*(-?\d{1,3}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*\)?\s*$/))) return ok(m[1], m[2]);
  const dms = /(\d{1,3})°\s*(\d{1,2})['′]\s*(\d{1,2}(?:\.\d+)?)["″]?\s*([NSEW])/gi;
  const parts = [...u.matchAll(dms)];
  if (parts.length >= 2) {
    const v = p => (+p[1] + p[2] / 60 + p[3] / 3600) * (/[SW]/i.test(p[4]) ? -1 : 1);
    const latP = parts.find(p => /[NS]/i.test(p[4])), lngP = parts.find(p => /[EW]/i.test(p[4]));
    if (latP && lngP) return ok(v(latP), v(lngP));
  }
  return null;
}

export function isShortMapsLink(text) {
  return /(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)/i.test(String(text || ""));
}

/** Append a cache-busting timestamp so every visit reads the current sheet. */
export function withCacheBuster(url, now = Date.now()) {
  return url + (url.includes("?") ? "&" : "?") + "t=" + now;
}
