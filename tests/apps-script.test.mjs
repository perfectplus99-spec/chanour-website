// Tests for the sheet's Apps Script link → coordinates logic (the parts that do not need Google).
// Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Apps Script files are plain JS with a .gs extension; load a copy as .cjs
const src = readFileSync(new URL("../docs/apps-script/พิกัดจากลิงก์.gs", import.meta.url), "utf8");
const dir = mkdtempSync(join(tmpdir(), "gs-"));
writeFileSync(join(dir, "script.cjs"), src);
const { parseCoords, coordsFromLink } = createRequire(import.meta.url)(join(dir, "script.cjs"));

// A fake web: url -> response
const web = routes => url => {
  if (!(url in routes)) throw new Error("unexpected fetch " + url);
  const r = routes[url];
  if (r instanceof Error) throw r;
  return r;
};
const redirect = location => ({ status: 302, location, body: "" });
const page = body => ({ status: 200, location: "", body });
const near = (got, lat, lng) => assert.ok(got.lat != null && Math.abs(got.lat - lat) < 1e-6 && Math.abs(got.lng - lng) < 1e-6, JSON.stringify(got));

test("coordinate pair pasted directly (no fetch)", () => {
  near(coordsFromLink("14.99301, 103.10293", web({})), 14.99301, 103.10293);
  near(coordsFromLink("103.10293, 14.99301", web({})), 14.99301, 103.10293);
});

test("full links of several shapes (no fetch)", () => {
  near(coordsFromLink("https://www.google.com/maps/place/X/@14.99,103.10,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d14.9931!4d103.1031?entry=ttu", web({})), 14.9931, 103.1031);
  near(coordsFromLink("https://maps.google.com/?q=14.8366,102.8941", web({})), 14.8366, 102.8941);
  near(coordsFromLink("https://www.google.com/maps/search/13.7563,+100.5018?entry=tts", web({})), 13.7563, 100.5018);
  near(coordsFromLink("https://www.google.com/maps/@13.7563,100.5018,15z", web({})), 13.7563, 100.5018);
});

test("short link that redirects to a place link", () => {
  const f = web({
    "https://maps.app.goo.gl/AAA": redirect("https://www.google.com/maps/place/%E0%B8%8A%E0%B8%B2%E0%B8%99%E0%B8%B1%E0%B8%A7/@14.63,102.79,17z/data=!4m6!3m5!8m2!3d14.6336183!4d102.7902479!16s?entry=ttu"),
  });
  near(coordsFromLink("https://maps.app.goo.gl/AAA", f), 14.6336183, 102.7902479);
});

test("short link → ?q=lat,lng", () => {
  const f = web({ "https://maps.app.goo.gl/BBB": redirect("https://maps.google.com/?q=16.5444158,104.728749&entry=gps") });
  near(coordsFromLink("https://maps.app.goo.gl/BBB", f), 16.5444158, 104.728749);
});

test("short link → place page without coordinates in the URL; read them from the page", () => {
  const f = web({
    "https://maps.app.goo.gl/CCC": redirect("https://maps.google.com/maps?q=%E0%B8%8A%E0%B8%B2%E0%B8%99%E0%B8%B1%E0%B8%A7&ftid=0x311:0xabc&entry=gps"),
    "https://maps.google.com/maps?q=%E0%B8%8A%E0%B8%B2%E0%B8%99%E0%B8%B1%E0%B8%A7&ftid=0x311:0xabc&entry=gps":
      page('<html><meta content="https://maps.google.com/maps/api/staticmap?center=15.2333975%2C104.8668&amp;zoom=17" property="og:image"></html>'),
  });
  near(coordsFromLink("https://maps.app.goo.gl/CCC", f), 15.2333975, 104.8668);
});

test("page with only the app state array [zoom, lng, lat]", () => {
  const f = web({
    "https://maps.app.goo.gl/DDD": redirect("/maps?cid=123"),
    "https://www.google.com/maps?cid=123": page('<script>window.APP_INITIALIZATION_STATE=[[[2994.66,99.67959329,8.161589187],[0,0,0],[1024,768],13.1]];</script>'),
  });
  near(coordsFromLink("https://maps.app.goo.gl/DDD", f), 8.161589187, 99.67959329);
});

test("failures explain what to do instead", () => {
  const f = web({ "https://maps.app.goo.gl/EEE": new Error("timeout") });
  assert.match(coordsFromLink("https://maps.app.goo.gl/EEE", f).error, /เปิดลิงก์ไม่สำเร็จ/);
  assert.match(coordsFromLink("https://example.com/x", web({})).error, /ไม่ใช่ลิงก์ Google Maps/);
  assert.match(coordsFromLink("ถนนจิระ บุรีรัมย์", web({})).error, /ไม่ใช่ลิงก์หรือตัวเลขพิกัด/);
  const g = web({ "https://maps.app.goo.gl/FFF": page("<html>no coordinates here</html>") });
  assert.match(coordsFromLink("https://maps.app.goo.gl/FFF", g).error, /หาพิกัดในลิงก์ไม่เจอ/);
});

test("coordinates outside Thailand are ignored", () => {
  assert.equal(parseCoords("https://www.google.com/maps/@48.85,2.35,15z"), null);
});
