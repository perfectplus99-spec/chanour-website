// UI for /check-branch. Decision rules live in logic.js; editable settings in config.js.
import CFG from "./config.js";
import {
  RESULT_FREE, RESULT_TAKEN, buildDistrictIndex, findDistrict, districtLabel, normalizeName,
  parseBranches, formatThaiDate, checkRural, checkUrban, displayKm, parseLatLng, isShortMapsLink, withCacheBuster,
} from "./logic.js";

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const RADIUS = Number(CFG.RADIUS_KM) || 3;
const TH_BOUNDS = [[5.6, 97.3], [20.5, 105.7]];
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

let index = null;      // national district list
let branches = null;   // rows from the sheet
let geo = null;        // district polygons (by code), loaded for the maps
let sel = { province: null, district: null };
let pinMap = null, pinMarker = null;

document.querySelectorAll(".chat-link").forEach(a => { a.href = CFG.CHAT_URL || "/#contact"; });

// ---------- Loading ----------

async function loadSheet() {
  if (!CFG.SHEET_CSV_URL) throw new Error("ยังไม่ได้ใส่ SHEET_CSV_URL ใน check-branch/config.js");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(withCacheBuster(CFG.SHEET_CSV_URL), { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    if (/^\s*</.test(text)) throw new Error("ได้หน้าเว็บแทนไฟล์ CSV — ชีตอาจยังไม่ได้เผยแพร่");
    return text;
  } finally { clearTimeout(timer); }
}

async function init() {
  let csv, rows;
  try {
    [rows, csv] = await Promise.all([
      fetch("/check-branch/data/districts.json").then(r => { if (!r.ok) throw new Error("districts " + r.status); return r.json(); }),
      loadSheet(),
    ]);
    index = buildDistrictIndex(rows, CFG);
    const parsed = parseBranches(csv, index);
    if (!parsed.branches.length) throw new Error("ชีตไม่มีข้อมูลสาขา");
    branches = parsed.branches;
    renderStats(parsed);
    renderList();
    renderProblems(parsed.problems);
  } catch (err) {
    console.error("[เช็คสาขาว่าง] โหลดข้อมูลไม่สำเร็จ:", err);
    return showLoadError();
  }
  setupCombos();
  applyQuery();
  loadGeo().then(drawOverview);
}

function showLoadError() {
  $("loadError").hidden = false;
  $("step1").hidden = true;
  $("step2").hidden = true;
  $("result").innerHTML = "";
  $("asOf").textContent = "—";
  $("total").textContent = "—";
  $("provGrid").innerHTML = '<p class="empty-note">โหลดข้อมูลไม่สำเร็จ กรุณาโหลดหน้าใหม่</p>';
  document.body.dataset.state = "error";
}

async function loadGeo() {
  if (geo) return geo;
  try {
    const g = await fetch("/check-branch/data/districts.geojson").then(r => r.json());
    geo = new Map(g.features.map(f => [f.properties.code, f]));
  } catch (e) { console.warn("โหลดขอบเขตอำเภอไม่สำเร็จ", e); geo = new Map(); }
  return geo;
}

// ---------- Header + list ----------

function renderStats(parsed) {
  $("asOf").textContent = parsed.latest ? formatThaiDate(parsed.latest) : "—";
  $("total").textContent = parsed.branches.length.toLocaleString("th-TH") + " สาขา";
  document.body.dataset.state = "ready";
}

function renderList() {
  const byProv = new Map();
  for (const b of branches) {
    if (!byProv.has(b.province)) byProv.set(b.province, new Map());
    const label = b.districtCode ? districtLabel(index.byCode.get(b.districtCode)) : b.district;
    const m = byProv.get(b.province);
    m.set(label, (m.get(label) || 0) + 1);
  }
  const provs = [...byProv.keys()].sort((a, b) => a.localeCompare(b, "th"));
  $("provGrid").innerHTML = provs.map(p => {
    const m = byProv.get(p);
    const n = [...m.values()].reduce((a, b) => a + b, 0);
    const items = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "th"))
      .map(([d, c]) => `<li>${esc(d)}${c > 1 ? `<b>×${c}</b>` : ""}</li>`).join("");
    return `<article class="prov"><header><h3>${esc(p)}</h3><span>${n} สาขา</span></header><ul>${items}</ul></article>`;
  }).join("");
}

function renderProblems(problems) {
  // Visible to admins only: add ?ตรวจข้อมูล=1 (or ?admin=1) to the address.
  const q = new URLSearchParams(location.search);
  if (!(q.has("ตรวจข้อมูล") || q.has("admin"))) {
    if (problems.length) console.warn("[เช็คสาขาว่าง] ข้อมูลในชีตที่ควรแก้:", problems);
    return;
  }
  const box = $("problems");
  box.hidden = false;
  box.innerHTML = problems.length
    ? `<b>สำหรับแอดมิน: พบแถวที่ควรแก้ ${problems.length} จุด</b><ul>${problems.map(p => `<li>แถว ${p.line}${p.code ? ` (${esc(p.code)})` : ""}: ${esc(p.msg)}</li>`).join("")}</ul>`
    : "<b>สำหรับแอดมิน: ข้อมูลในชีตถูกต้องทุกแถว</b>";
}

// ---------- Searchable dropdowns ----------

function combo(root, { getItems, render, onPick }) {
  const input = root.querySelector("input"), list = root.querySelector("ul"), clear = root.querySelector(".combo-clear");
  let shown = [], active = -1;
  const open = () => {
    const q = normalizeName(input.value);
    const items = getItems();
    shown = q ? items.filter(it => normalizeName(render(it).text).includes(q)) : items;
    // When the box shows the current pick, list everything so the user can change it.
    if (input.dataset.picked && input.value === input.dataset.picked) shown = items;
    active = shown.length ? 0 : -1;
    list.innerHTML = shown.length
      ? shown.map((it, i) => { const r = render(it); return `<li role="option" id="${list.id}-${i}" data-i="${i}" aria-selected="${i === active}">${esc(r.text)}${r.hint ? `<small>${esc(r.hint)}</small>` : ""}</li>`; }).join("")
      : '<li class="empty">ไม่พบชื่อที่ตรง ลองพิมพ์ใหม่</li>';
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); };
  const move = d => {
    if (!shown.length) return;
    active = (active + d + shown.length) % shown.length;
    list.querySelectorAll("li").forEach((li, i) => li.setAttribute("aria-selected", i === active));
    const li = list.children[active];
    li?.scrollIntoView({ block: "nearest" });
    input.setAttribute("aria-activedescendant", li?.id || "");
  };
  const pick = it => { close(); onPick(it); };
  input.addEventListener("focus", () => { input.select(); open(); });
  input.addEventListener("input", open);
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); list.hidden ? open() : move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") { e.preventDefault(); if (!list.hidden && shown[active]) pick(shown[active]); }
    else if (e.key === "Escape") close();
  });
  list.addEventListener("mousedown", e => e.preventDefault()); // keep focus so blur doesn't close first
  list.addEventListener("click", e => { const li = e.target.closest("li[data-i]"); if (li) pick(shown[+li.dataset.i]); });
  input.addEventListener("blur", () => setTimeout(close, 120));
  clear.addEventListener("click", () => { input.value = ""; input.dataset.picked = ""; clear.hidden = true; onPick(null); input.focus(); });
  return {
    set(text) { input.value = text || ""; input.dataset.picked = text || ""; clear.hidden = !text; },
    enable(on, placeholder) { input.disabled = !on; if (placeholder) input.placeholder = placeholder; },
    input,
  };
}

let provBox, distBox;
function setupCombos() {
  provBox = combo($("provCombo"), {
    getItems: () => index.provinces,
    render: p => ({ text: p, hint: index.byProvince.get(p).length + " อำเภอ" }),
    onPick: p => selectProvince(p, true),
  });
  distBox = combo($("distCombo"), {
    getItems: () => (sel.province ? index.byProvince.get(sel.province) : []),
    render: d => ({ text: districtLabel(d), hint: d.type === "urban" ? "เขตเมือง" : "" }),
    onPick: d => selectDistrict(d, true),
  });
  provBox.enable(true);
}

function selectProvince(p, focusNext) {
  sel = { province: p, district: null };
  provBox.set(p);
  distBox.set("");
  distBox.enable(!!p, p ? "พิมพ์ชื่ออำเภอหรือเขต" : "เลือกจังหวัดก่อน");
  $("pickNote").textContent = "";
  resetBelow();
  syncUrl();
  if (p && focusNext) distBox.input.focus();
}

function selectDistrict(d, userAction) {
  sel.district = d;
  distBox.set(d ? districtLabel(d) : "");
  resetBelow();
  syncUrl();
  if (!d) return;
  $("pickNote").innerHTML = d.type === "urban"
    ? '<span class="tag urban">เขตเมือง</span> ต้องปักหมุดตำแหน่งเพื่อวัดระยะห่างจากสาขาอื่น'
    : '<span class="tag">อำเภอรอบนอก</span> 1 อำเภอเปิดได้ 1 สาขา';
  if (d.type === "rural") {
    const r = checkRural(d, branches);
    showResult(r.status, { district: d });
    if (userAction) $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    $("step2").hidden = false;
    openPinMap(d);
    if (userAction) $("step2").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function resetBelow() {
  $("step2").hidden = true;
  $("result").innerHTML = "";
  $("result").className = "";
  if (pinMarker) { pinMarker.remove(); pinMarker = null; }
  $("pinMsg").className = "msg";
  $("pinQuick").hidden = true;
}

function syncUrl() {
  const q = new URLSearchParams(location.search);
  ["จังหวัด", "อำเภอ", "เขต", "province", "district", "amphoe"].forEach(k => q.delete(k));
  if (sel.province) q.set("จังหวัด", sel.province);
  if (sel.district) q.set("อำเภอ", sel.district.d);
  const s = q.toString();
  history.replaceState(null, "", location.pathname + (s ? "?" + s : "") + location.hash);
}

function applyQuery() {
  const q = new URLSearchParams(location.search);
  const p = q.get("จังหวัด") ?? q.get("province") ?? q.get("p");
  const d = q.get("อำเภอ") ?? q.get("เขต") ?? q.get("district") ?? q.get("amphoe") ?? q.get("d");
  if (!p && !d) return;
  const found = findDistrict(index, p || "", d || "");
  if (!found.province) {
    $("pickNote").innerHTML = `<span class="msg warn">ไม่พบจังหวัด “${esc(p || "")}” กรุณาเลือกจากรายการ</span>`;
    return;
  }
  selectProvince(found.province, false);
  if (found.district) selectDistrict(found.district, false);
  else if (d) $("pickNote").innerHTML = `<span class="msg warn">ไม่พบอำเภอ “${esc(d)}” ใน${esc(found.province)} กรุณาเลือกจากรายการ</span>`;
  // Shared links land on the checker, not the hero
  ($("result").firstChild ? $("result") : $(found.district ? "step2" : "step1")).scrollIntoView({ block: "start" });
}

// ---------- Pin map (เขตเมือง) ----------

const pinIcon = () => L.divIcon({
  className: "pin-icon", iconSize: [36, 48], iconAnchor: [18, 46],
  html: '<svg viewBox="0 0 36 48" width="36" height="48" aria-hidden="true"><path d="M18 1C8.6 1 1 8.6 1 18c0 12.4 17 29 17 29s17-16.6 17-29C35 8.6 27.4 1 18 1z" fill="#D9000E" stroke="#fff" stroke-width="2"/><circle cx="18" cy="18" r="7" fill="#fff"/></svg>',
});

function branchCircles(layerGroup) {
  for (const b of branches) {
    if (b.lat == null) continue;
    L.circle([b.lat, b.lng], { radius: RADIUS * 1000, color: "#D9000E", weight: 1.5, fillColor: "#D9000E", fillOpacity: .14, interactive: false }).addTo(layerGroup);
    L.circleMarker([b.lat, b.lng], { radius: 4, color: "#fff", weight: 1.5, fillColor: "#D9000E", fillOpacity: 1, interactive: false }).addTo(layerGroup);
  }
}

function openPinMap(d) {
  if (!pinMap) {
    pinMap = L.map("pinMap", { zoomControl: true }).setView(d.c, 13);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR }).addTo(pinMap);
    branchCircles(L.layerGroup().addTo(pinMap));
    pinMap.on("click", e => placePin(e.latlng.lat, e.latlng.lng, "แตะบนแผนที่"));
  }
  pinMap.invalidateSize();
  pinMap.fitBounds([[d.b[0], d.b[1]], [d.b[2], d.b[3]]], { padding: [10, 10] });
  $("pinMsg").textContent = "เช่น 14.9930, 103.1029 (ในแผนที่กูเกิล กดค้างที่จุดนั้นแล้วคัดลอกตัวเลขพิกัด)";
  setTimeout(() => pinMap.invalidateSize(), 200);
}

function placePin(lat, lng, source) {
  if (!pinMarker) {
    pinMarker = L.marker([lat, lng], { draggable: true, icon: pinIcon(), keyboard: true, title: "จุดที่จะเปิดร้าน" }).addTo(pinMap);
    pinMarker.on("dragend", () => { const p = pinMarker.getLatLng(); evaluatePin(p.lat, p.lng); });
  } else pinMarker.setLatLng([lat, lng]);
  const tapped = source === "แตะบนแผนที่";
  if (!tapped) pinMap.setView([lat, lng], Math.max(pinMap.getZoom(), 14));
  evaluatePin(lat, lng);
  // Typed/located pins jump to the verdict; taps keep the map in view (the quick line under it shows the verdict)
  if (!tapped) $("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

function evaluatePin(lat, lng) {
  const d = sel.district;
  const r = checkUrban(lat, lng, branches, RADIUS, d);
  const inside = pointInDistrict(lat, lng, d);
  const msg = $("pinMsg");
  msg.className = inside === false ? "msg warn" : "msg";
  msg.textContent = `หมุดอยู่ที่ ${lat.toFixed(5)}, ${lng.toFixed(5)}`
    + (inside === false ? ` — จุดนี้อยู่นอก${districtLabel(d)} ตรวจว่าปักถูกทำเลหรือไม่` : "");
  const quick = $("pinQuick");
  quick.hidden = false;
  if (r.status === "unknown") { quick.className = "pin-quick"; quick.innerHTML = 'ตรวจจุดนี้ไม่ได้ <a href="#result">ดูรายละเอียด ↓</a>'; return showUnknown(d); }
  const free = r.status === RESULT_FREE;
  quick.className = "pin-quick " + (free ? "free" : "taken");
  quick.innerHTML = `<b>${free ? "ว่าง" : "มีสาขาแล้ว"}</b> · ใกล้สุด ${displayKm(r.nearestKm)} กม. <a href="#result">ดูผล ↓</a>`;
  showResult(r.status, { district: d, km: r.nearestKm });
}

function pointInDistrict(lat, lng, d) {
  const f = geo && d && geo.get(d.code);
  if (!f) return null;
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  const inRing = ring => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  return polys.some(([outer, ...holes]) => inRing(outer) && !holes.some(inRing));
}

$("locBtn").addEventListener("click", () => {
  const msg = $("pinMsg");
  if (!navigator.geolocation) { msg.className = "msg warn"; msg.textContent = "เครื่องนี้ไม่รองรับการหาตำแหน่ง ลองแตะบนแผนที่แทน"; return; }
  msg.className = "msg"; msg.textContent = "กำลังหาตำแหน่งของคุณ…";
  navigator.geolocation.getCurrentPosition(
    pos => placePin(pos.coords.latitude, pos.coords.longitude, "ตำแหน่งปัจจุบัน"),
    err => { msg.className = "msg warn"; msg.textContent = err.code === 1 ? "ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง เปิดสิทธิ์ตำแหน่งในเบราว์เซอร์ หรือแตะบนแผนที่แทน" : "หาตำแหน่งไม่สำเร็จ ลองอีกครั้ง หรือแตะบนแผนที่แทน"; },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
});

$("pasteForm").addEventListener("submit", async e => {
  e.preventDefault();
  const text = $("pasteInput").value.trim(), msg = $("pinMsg");
  if (!text) return;
  const ll = parseLatLng(text);
  if (ll) return placePin(ll[0], ll[1], "วางพิกัด");
  if (isShortMapsLink(text)) {
    msg.className = "msg warn";
    msg.textContent = "ลิงก์ย่อของแผนที่กูเกิลอ่านพิกัดไม่ได้ ให้เปิดลิงก์ในแผนที่กูเกิล กดค้างที่หมุด แล้วคัดลอกตัวเลขพิกัด (เช่น 14.9930, 103.1029) มาวางแทน";
    return;
  }
  if (/^https?:/i.test(text)) { msg.className = "msg warn"; msg.textContent = "ไม่พบพิกัดในลิงก์นี้ ลองคัดลอกตัวเลขพิกัดจากแผนที่กูเกิลมาวางแทน"; return; }
  // Treat as an address: free OpenStreetMap geocoder (no key)
  msg.className = "msg"; msg.textContent = "กำลังค้นหาที่อยู่…";
  try {
    const d = sel.district;
    const q = `${text} ${d ? d.d + " " + d.p : ""}`.trim();
    const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=th&accept-language=th&q=" + encodeURIComponent(q);
    let hits = await fetch(url).then(r => r.json());
    if (!hits.length && d) hits = await fetch(url.replace(encodeURIComponent(q), encodeURIComponent(text))).then(r => r.json());
    if (!hits.length) throw new Error("not found");
    placePin(+hits[0].lat, +hits[0].lon, "ที่อยู่");
    msg.textContent += " — ตำแหน่งจากที่อยู่อาจคลาดเคลื่อน ลากหมุดให้ตรงจุดได้";
  } catch {
    msg.className = "msg warn";
    msg.textContent = "หาที่อยู่นี้ไม่พบ ลองวางตัวเลขพิกัดจากแผนที่กูเกิล หรือแตะบนแผนที่แทน";
  }
});

// ---------- Result ----------

function showResult(status, { district, km }) {
  const box = $("result");
  const free = status === RESULT_FREE;
  const where = `${districtLabel(district)} · จ.${district.p}`;
  const dist = km != null && Number.isFinite(km)
    ? `<p class="dist">สาขาที่ใกล้ที่สุดห่าง <b>${displayKm(km)}</b> กม.</p><p class="straight">วัดระยะแบบเส้นตรง</p>` : "";
  const ruleNote = district.type === "urban"
    ? (free ? `ห่างจากทุกสาขาตั้งแต่ ${RADIUS} กม. ขึ้นไป` : `มีสาขาอยู่ในรัศมีไม่ถึง ${RADIUS} กม. จากจุดนี้`)
    : (free ? "ยังไม่มีสาขาในอำเภอนี้" : "อำเภอนี้มีสาขาชานัวแล้ว");
  box.className = "result " + (free ? "free" : "taken");
  box.dataset.status = free ? "ว่าง" : "มีสาขาแล้ว";
  box.innerHTML = `
    <p class="where">${esc(where)}</p>
    <b class="big">${free ? "ว่าง" : "มีสาขาแล้ว"}</b>
    <p>${esc(ruleNote)}</p>
    ${dist}
    ${free
      ? `<p class="advice">รีบทักทีมงานเพื่อยืนยันสิทธิ์ก่อนมีผู้จองทำเลนี้</p>
         <div class="acts"><a class="btn btn-green" href="${esc(CFG.CHAT_URL || "/#contact")}" target="_blank" rel="noopener">ทักทีมงานเพื่อยืนยันสิทธิ์</a></div>`
      : `<p class="advice">${district.type === "urban" ? "ลองขยับหมุดไปทำเลอื่นที่ห่างออกไป หรือ" : "ลอง"}เลือกอำเภอใกล้เคียงที่ยังว่าง ทีมงานช่วยแนะนำทำเลให้ได้</p>
         <div class="acts"><button class="btn btn-red" type="button" id="againBtn">เช็คใหม่</button></div>`}`;
  $("againBtn")?.addEventListener("click", restart);
}

function showUnknown(d) {
  const box = $("result");
  box.className = "alert";
  box.dataset.status = "";
  box.innerHTML = `<b>ยังตรวจจุดนี้ไม่ได้</b><p>ข้อมูลสาขาใน${esc(districtLabel(d))}ยังไม่ครบ กรุณาทักทีมงานเพื่อตรวจให้</p>
    <div class="acts"><a class="btn btn-red btn-sm" href="${esc(CFG.CHAT_URL || "/#contact")}" target="_blank" rel="noopener">ทักทีมงาน</a></div>`;
}

function restart() {
  selectProvince(null, false);
  provBox.set("");
  $("step1").scrollIntoView({ behavior: "smooth", block: "start" });
  setTimeout(() => provBox.input.focus({ preventScroll: true }), 400);
}

// ---------- Overview map ----------

function drawOverview() {
  const map = L.map("overviewMap", { scrollWheelZoom: false, zoomSnap: .25 }).fitBounds(TH_BOUNDS);
  L.tileLayer(TILE_URL, { maxZoom: 18, attribution: TILE_ATTR }).addTo(map);
  const ruralCodes = new Set(branches.filter(b => b.type === "rural").map(b => b.districtCode));
  for (const code of ruralCodes) {
    const f = geo.get(code);
    if (!f) continue;
    const d = index.byCode.get(code);
    L.geoJSON(f, { style: { color: "#C2611A", weight: 1.5, fillColor: "#F0913F", fillOpacity: .55 } })
      .bindTooltip(`${districtLabel(d)} จ.${d.p}`, { sticky: true }).addTo(map);
  }
  for (const b of branches) {
    if (b.lat == null || b.type === "rural") continue;
    L.circle([b.lat, b.lng], { radius: RADIUS * 1000, color: "#D9000E", weight: 2, fillColor: "#D9000E", fillOpacity: .22 }).addTo(map);
  }
  // Keep the polygons/circles crisp when the section first becomes visible
  new IntersectionObserver((es, o) => { if (es[0].isIntersecting) { map.invalidateSize(); o.disconnect(); } }).observe($("overviewMap"));
}

init();
