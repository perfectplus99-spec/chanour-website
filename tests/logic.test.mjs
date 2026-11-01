// Run: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as L from "../check-branch/logic.js";
import cfg from "../check-branch/config.js";

const districts = JSON.parse(readFileSync(new URL("../check-branch/data/districts.json", import.meta.url)));
const index = L.buildDistrictIndex(districts, cfg);
const sample = readFileSync(new URL("../check-branch/data/branches-sample.csv", import.meta.url), "utf8");
const { branches } = L.parseBranches(sample, index);
const get = (p, d) => L.findDistrict(index, p, d).district;

test("dataset covers the whole country", () => {
  assert.equal(index.provinces.length, 77);
  assert.equal(districts.length, 928);
  assert.equal(index.byProvince.get("กรุงเทพมหานคร").length, 50);
});

test("area classification", () => {
  const t = (p, d) => get(p, d).type;
  assert.equal(t("บุรีรัมย์", "เมืองบุรีรัมย์"), "urban");
  assert.equal(t("บุรีรัมย์", "นางรอง"), "rural");
  assert.equal(t("กรุงเทพมหานคร", "บางรัก"), "urban");
  for (const p of ["นนทบุรี", "ปทุมธานี", "สมุทรปราการ", "สมุทรสาคร", "นครปฐม"])
    assert.ok(index.byProvince.get(p).every(x => x.type === "urban"), p);
  assert.equal(t("พระนครศรีอยุธยา", "พระนครศรีอยุธยา"), "urban");
  assert.equal(t("นครราชสีมา", "เมืองยาง"), "rural");
  assert.equal(t("นครศรีธรรมราช", "เมืองนครศรีธรรมราช"), "urban");
  for (const [p, d] of [["ศรีสะเกษ", "เมืองจันทร์"], ["ร้อยเอ็ด", "เมืองสรวง"], ["ลำปาง", "เมืองปาน"]]) assert.equal(t(p, d), "rural");
  // every province has at least one urban district (its capital district)
  for (const p of index.provinces) assert.ok(index.byProvince.get(p).some(x => x.type === "urban"), p);
});

test("sample sheet parses 5 rows with no problems", () => {
  const r = L.parseBranches(sample, index);
  assert.equal(r.branches.length, 5);
  assert.deepEqual(r.problems, []);
  assert.equal(L.formatThaiDate(r.latest), "28 ตุลาคม 2569");
});

test("rural district WITH a branch → มีสาขาแล้ว", () => {
  assert.equal(L.checkRural(get("บุรีรัมย์", "นางรอง"), branches).status, L.RESULT_TAKEN);
});

test("rural district WITHOUT a branch → ว่าง", () => {
  assert.equal(L.checkRural(get("บุรีรัมย์", "ประโคนชัย"), branches).status, L.RESULT_FREE);
});

test("urban: 2.9 km → มีสาขาแล้ว, 3.0 km → ว่าง", () => {
  const b = [{ lat: 14.9930, lng: 103.1029, districtCode: "TH3101" }];
  const [a1, a2] = L.destination(b[0].lat, b[0].lng, 2.9, 90);
  const r1 = L.checkUrban(a1, a2, b, 3);
  assert.equal(r1.status, L.RESULT_TAKEN);
  assert.equal(L.displayKm(r1.nearestKm), "2.9");
  const [c1, c2] = L.destination(b[0].lat, b[0].lng, 3.0, 90);
  const r2 = L.checkUrban(c1, c2, b, 3);
  assert.equal(r2.status, L.RESULT_FREE);
  assert.equal(L.displayKm(r2.nearestKm), "3.0");
  // 2.96 km must not be displayed as "3.0" next to "มีสาขาแล้ว"
  const [d1, d2] = L.destination(b[0].lat, b[0].lng, 2.96, 0);
  assert.equal(L.checkUrban(d1, d2, b, 3).status, L.RESULT_TAKEN);
  assert.equal(L.displayKm(L.checkUrban(d1, d2, b, 3).nearestKm), "2.9");
});

test("urban pin near a branch in a NEIGHBOURING district → มีสาขาแล้ว", () => {
  // Sample row CB-005 is in อ.ลำปลายมาศ, right next to the อ.เมืองบุรีรัมย์ boundary.
  // The pin below lies inside อ.เมืองบุรีรัมย์, about 2.5 km from CB-005 and far from CB-001.
  const neighbour = branches.find(b => b.code === "CB-005");
  assert.equal(neighbour.type, "rural");
  const pin = [14.8424, 102.9166];
  const r = L.checkUrban(...pin, branches, 3, get("บุรีรัมย์", "เมืองบุรีรัมย์"));
  assert.equal(r.status, L.RESULT_TAKEN);
  assert.equal(L.displayKm(r.nearestKm), "2.5");
});

test("urban branch without coordinates in the same district never yields ว่าง", () => {
  const d = get("ขอนแก่น", "เมืองขอนแก่น");
  const b = [{ lat: null, lng: null, districtCode: d.code }];
  assert.equal(L.checkUrban(d.c[0], d.c[1], b, 3, d).status, "unknown");
});

test("fuzzy names", () => {
  assert.equal(get("บุรีรัมย์", "อำเภอนางรอง").d, "นางรอง");
  assert.equal(get("จ.บุรีรัมย์", "อ. นางรอง").d, "นางรอง");
  assert.equal(get("บุรีรัม", "นางรอ").d, "นางรอง");
  assert.equal(get("กทม", "เขตบางรัก").d, "บางรัก");
  assert.equal(get("โคราช", "ปากช่อง").d, "ปากช่อง");
  assert.equal(get("บุรีรัมย์", "เมือง").d, "เมืองบุรีรัมย์");
  assert.equal(get("เชียงใหม่", "สันกำแพง").d, "สันกำแพง");
  assert.equal(get("เชียงใหม่", "สันกําแพง").d, "สันกำแพง"); // ํา typing variant
  assert.equal(get("บุรีรัมย์", "ไม่มีอำเภอนี้แน่นอน"), null);
});

test("pasted locations", () => {
  assert.deepEqual(L.parseLatLng("14.9930, 103.1029"), [14.993, 103.1029]);
  assert.deepEqual(L.parseLatLng("103.1029, 14.9930"), [14.993, 103.1029]);
  assert.deepEqual(L.parseLatLng("https://www.google.com/maps/place/x/@14.99,103.10,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d14.9931!4d103.1031"), [14.9931, 103.1031]);
  assert.deepEqual(L.parseLatLng("https://www.google.com/maps/@13.7563,100.5018,15z"), [13.7563, 100.5018]);
  assert.deepEqual(L.parseLatLng("https://maps.google.com/?q=13.7563,100.5018"), [13.7563, 100.5018]);
  assert.deepEqual(L.parseLatLng("https://www.google.com/maps/search/13.7563,+100.5018"), [13.7563, 100.5018]);
  const dms = L.parseLatLng(`13°45'22.7"N 100°30'06.5"E`);
  assert.ok(Math.abs(dms[0] - 13.75631) < 1e-4 && Math.abs(dms[1] - 100.50181) < 1e-4);
  assert.equal(L.parseLatLng("ถนนจิระ บุรีรัมย์"), null);
  assert.ok(L.isShortMapsLink("https://maps.app.goo.gl/abc123"));
});

test("dates and CSV quirks", () => {
  assert.equal(L.formatThaiDate(L.parseDate("2026-11-01")), "1 พฤศจิกายน 2569");
  assert.equal(L.formatThaiDate(L.parseDate("1/11/2569")), "1 พฤศจิกายน 2569");
  const r = L.parseBranches('﻿รหัสสาขา,จังหวัด,อำเภอหรือเขต,ละติจูด,ลองจิจูด,วันที่บันทึก\r\n"A1","บุรีรัมย์","นางรอง","14.63","102.79","2026-10-01"\r\n,,,,,\r\n', index);
  assert.equal(r.branches.length, 1);
  assert.equal(r.branches[0].districtCode, get("บุรีรัมย์", "นางรอง").code);
});

test("empty sheet yields zero branches (page must show an error, never ว่าง)", () => {
  assert.equal(L.parseBranches("รหัสสาขา,จังหวัด,อำเภอหรือเขต,ละติจูด,ลองจิจูด,วันที่บันทึก\n", index).branches.length, 0);
  assert.equal(L.parseBranches("", index).branches.length, 0);
});

test("cache buster", () => {
  assert.equal(L.withCacheBuster("https://x/pub?output=csv", 5), "https://x/pub?output=csv&t=5");
  assert.equal(L.withCacheBuster("https://x/a.csv", 5), "https://x/a.csv?t=5");
});
