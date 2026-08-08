/* Glasswing G3X-style PFD renderer
 * Canvas-drawn: synthetic terrain PFD with tapes, HSI with inset map,
 * engine strip, top-down map pane. Touch: tap map inset → split screen.
 */
"use strict";

/* ─────────── state ─────────── */
const S = {
  pitch:2, roll:0, hdg:104, ias:120, tas:131, alt:2440, vs:-600, gs:121,
  baro:29.92, sel_alt:2000, dtk:104, trk:104,
  lat:45.62, lon:-122.60,
  wpt_next:"BLAZR", wpt_after:"TRAYL", wpt_dist:2.0, ete_min:1, eta_utc:"21:41",
  rpm:2300, map:24.5, oil_psi:89, oil_f:207, fuel_gph:17.5,
  cht:[372,368,375,371], egt:[1540,1528,1546,1539],
  fuel_l:20, fuel_r:21, volts:13.9, oat_f:59,
  timer:1800, utc:"16:10:38",
  nearest:[{id:"KVUO",name:"Pearson",brg:103,dist:5.1},
           {id:"KSPB",name:"Scappoose",brg:313,dist:7.9},
           {id:"KPDX",name:"Portland Intl",brg:107,dist:8.2}],
  com1_act:118.100, com1_stby:118.700,
  com2_act:128.350, com2_stby:121.900,
};
const D = Object.assign({}, S);       // displayed (smoothed) values
let mapSplit = false, mapRange = 15, identUntil = 0;

/* smoothing toward live state */
function smooth() {
  for (const k of ["pitch","roll","hdg","ias","tas","alt","vs","gs","rpm","map",
                   "oil_psi","oil_f","fuel_gph","volts","fuel_l","fuel_r","trk"]) {
    D[k] += (S[k] - D[k]) * 0.18;
  }
  D.cht = S.cht; D.egt = S.egt;
}

/* ─────────── websocket ─────────── */
let _lastMsg = -1e9;                      // perf-time of last live telemetry frame (start stale → sim runs at once)
function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  let ws;
  try { ws = new WebSocket(`${proto}://${location.hostname}:8760`); }
  catch (_) { setTimeout(connect, 4000); return; }   // no server → sim fallback drives it
  ws.onmessage = e => {
    try { Object.assign(S, JSON.parse(e.data)); _lastMsg = performance.now(); } catch(_){}
  };
  ws.onclose = () => setTimeout(connect, 4000);
  ws.onopen = () => { window._ws = ws; };
}
function sendEvent(type, data={}) {
  if (window._ws && window._ws.readyState === 1)
    window._ws.send(JSON.stringify({type, ...data}));
}
connect();

/* ─────────── helpers ─────────── */
const TAU = Math.PI * 2;
const MAG = "#e879f9", CYN = "#22d3ee", GRN = "#4ade80", WHT = "#f2f2f5",
      DIM = "#9a9aa2", AMB = "#f2c230";
function setupCanvas(c) {
  const r = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  c.width = r.width * dpr; c.height = r.height * dpr;
  const x = c.getContext("2d");
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [x, r.width, r.height];
}
function txt(x, s, px, py, size, color=WHT, align="center", weight=700) {
  x.fillStyle = color; x.font = `${weight} ${size}px -apple-system,Helvetica,Arial`;
  x.textAlign = align; x.textBaseline = "middle"; x.fillText(s, px, py);
}
function fmtTimer(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec/3600), m = Math.floor(sec%3600/60), s = sec%60;
  return h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`
               : `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
/* deterministic pseudo-noise for synthetic terrain */
function hash2(a, b) { let h = Math.sin(a*127.1 + b*311.7) * 43758.5453; return h - Math.floor(h); }
function noise2(a, b) {
  const ia = Math.floor(a), ib = Math.floor(b), fa = a-ia, fb = b-ib;
  const u = fa*fa*(3-2*fa), v = fb*fb*(3-2*fb);
  return hash2(ia,ib)*(1-u)*(1-v) + hash2(ia+1,ib)*u*(1-v) +
         hash2(ia,ib+1)*(1-u)*v + hash2(ia+1,ib+1)*u*v;
}
function fbm(a, b) { return noise2(a,b)*0.55 + noise2(a*2.3,b*2.3)*0.3 + noise2(a*5.1,b*5.1)*0.15; }

/* terrain color by height (Garmin-like greens → yellow → brown) */
function terrColor(h) {
  if (h < 0.42) return `rgb(${30+h*60|0},${90+h*120|0},${30+h*30|0})`;
  if (h < 0.62) return `rgb(${80+(h-.42)*400|0},${140+(h-.42)*200|0},${40|0})`;
  return `rgb(${160+(h-.62)*180|0},${120+(h-.62)*120|0},${60|0})`;
}

/* ═══════════ PFD ═══════════ */
const pfdC = document.getElementById("pfd-canvas");

function drawPFD() {
  const [x, W, H] = setupCanvas(pfdC);
  const cx = W/2, cy = H*0.46;
  const pxPerDeg = H/55;                      // pitch scale
  const roll = D.roll*Math.PI/180;

  /* ---- synthetic vision background ---- */
  x.save();
  x.beginPath(); x.rect(0,0,W,H); x.clip();
  x.translate(cx, cy); x.rotate(-roll); x.translate(0, D.pitch*pxPerDeg);
  const span = Math.hypot(W,H);
  // sky
  const sky = x.createLinearGradient(0,-span,0,0);
  sky.addColorStop(0,"#0a3aa8"); sky.addColorStop(1,"#3f7ae0");
  x.fillStyle = sky; x.fillRect(-span,-span,span*2,span);
  // terrain: hill-shaded synthetic ground
  const grd = x.createLinearGradient(0,0,0,span*0.6);
  grd.addColorStop(0,"#5a6e35"); grd.addColorStop(0.5,"#48602c"); grd.addColorStop(1,"#2e421e");
  x.fillStyle = grd;
  x.beginPath(); x.moveTo(-span,0);
  for (let i = -span; i <= span; i += 22) {
    const n = fbm(i*0.0016 + D.lon*2, D.lat*2);
    x.lineTo(i, n*n*H*0.35 + 2);
  }
  x.lineTo(span, span); x.lineTo(-span, span); x.closePath(); x.fill();
  // darker ridge overlay for depth
  x.fillStyle = "rgba(20,40,14,0.35)";
  x.beginPath(); x.moveTo(-span,0);
  for (let i = -span; i <= span; i += 26) {
    const n = fbm(i*0.003 + 50 + D.lon*3, D.lat*3);
    x.lineTo(i, n*n*H*0.5 + H*0.08);
  }
  x.lineTo(span, span); x.lineTo(-span, span); x.closePath(); x.fill();
  // horizon line
  x.strokeStyle = "#fff"; x.lineWidth = 2;
  x.beginPath(); x.moveTo(-span,0); x.lineTo(span,0); x.stroke();
  // pitch ladder
  x.strokeStyle = "rgba(255,255,255,0.9)"; x.lineWidth = 1.5;
  x.fillStyle = "#fff";
  for (let p = -20; p <= 20; p += 5) {
    if (p === 0) continue;
    const y = -p*pxPerDeg, w = (p % 10 === 0) ? 60 : 30;
    x.beginPath(); x.moveTo(-w, y); x.lineTo(w, y); x.stroke();
    if (p % 10 === 0) { txt(x, Math.abs(p), -w-14, y, 12); txt(x, Math.abs(p), w+14, y, 12); }
  }
  x.restore();

  /* ---- roll arc + pointer ---- */
  x.save(); x.translate(cx, cy);
  x.strokeStyle = WHT; x.lineWidth = 2;
  x.beginPath(); x.arc(0, 0, H*0.30, -Math.PI*0.78, -Math.PI*0.22); x.stroke();
  for (const a of [-60,-45,-30,-20,-10,0,10,20,30,45,60]) {
    const r1 = H*0.30, r2 = r1 - (a % 30 === 0 ? 12 : 7);
    const th = -Math.PI/2 + a*Math.PI/180;
    x.beginPath();
    x.moveTo(Math.cos(th)*r1, Math.sin(th)*r1);
    x.lineTo(Math.cos(th)*r2, Math.sin(th)*r2);
    x.stroke();
  }
  // fixed aircraft symbol (magenta-ish white W)
  x.rotate(-roll);
  x.fillStyle = GRN;
  x.beginPath(); x.moveTo(0,-H*0.30-12); x.lineTo(-9,-H*0.30+2); x.lineTo(9,-H*0.30+2); x.closePath(); x.fill();
  x.rotate(roll);
  x.strokeStyle = WHT; x.lineWidth = 4; x.lineJoin = "round";
  x.beginPath();                       // flying-W
  x.moveTo(-70,0); x.lineTo(-24,0); x.lineTo(-12,12); x.lineTo(0,0);
  x.lineTo(12,12); x.lineTo(24,0); x.lineTo(70,0); x.stroke();
  x.fillStyle = WHT;
  x.beginPath(); x.moveTo(0,-H*0.30-14); x.lineTo(-7,-H*0.30-2); x.lineTo(7,-H*0.30-2); x.closePath(); x.fill();
  x.restore();

  /* ---- magenta approach pathway boxes (synthetic vision HUD) ---- */
  x.save(); x.translate(cx, cy); x.rotate(-roll);
  x.strokeStyle = MAG; x.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const yy = D.pitch*pxPerDeg + i*i*10 + 26, w = 46 - i*8, h = 16 - i*2;
    x.strokeRect(-w/2, yy, w, h);
  }
  x.restore();

  drawAirspeedTape(x, W, H);
  drawAltTape(x, W, H);
  drawHeadingStrip(x, W, H);
  drawHSIInset(x, W, H);

  /* ---- mode annunciations ---- */
  const modes = ["GPS","AP","YD","GP"];
  x.strokeStyle = "#333"; x.fillStyle = "rgba(0,0,0,0.55)";
  const mw = 62, mh = 24, my = 4;
  let mx = cx - mw*2;
  for (const m of modes) {
    x.fillRect(mx, my, mw-4, mh); x.strokeRect(mx, my, mw-4, mh);
    txt(x, m, mx + (mw-4)/2, my + mh/2, 13, m === "GP" ? GRN : (m === "AP" ? WHT : GRN));
    mx += mw;
  }
  // tail number plaque
  txt(x, "N675PD", cx, my + mh + 12, 11, "#f0abfc");
}

/* ---- airspeed tape (left) ---- */
function drawAirspeedTape(x, W, H) {
  const tw = 78, th = H*0.52, tx = 8, ty = H*0.16, pyPerKt = th/60;
  x.fillStyle = "rgba(10,10,14,0.85)"; x.fillRect(tx, ty, tw, th);
  x.strokeStyle = "#444"; x.strokeRect(tx, ty, tw, th);
  const ias = D.ias;
  x.font = "700 13px -apple-system,Helvetica"; x.textAlign = "right"; x.textBaseline = "middle";
  for (let k = Math.floor((ias-30)/10)*10; k <= ias+30; k += 10) {
    if (k < 0) continue;
    const y = ty + th/2 + (ias-k)*pyPerKt;
    if (y < ty+6 || y > ty+th-6) continue;
    x.fillStyle = WHT; x.fillRect(tx+tw-10, y-1, 10, 2);
    x.fillText(k, tx+tw-14, y);
    if (k+5 <= ias+30) {
      const y5 = ty + th/2 + (ias-k-5)*pyPerKt;
      if (y5 > ty+4 && y5 < ty+th-4) x.fillRect(tx+tw-6, y5-1, 6, 1.5);
    }
  }
  // green band 60–160
  const yTop = ty + th/2 + (ias-160)*pyPerKt, yBot = ty + th/2 + (ias-60)*pyPerKt;
  x.fillStyle = "rgba(74,222,128,0.9)";
  x.fillRect(tx+tw-4, Math.max(ty,yTop), 4, Math.min(yBot,ty+th)-Math.max(ty,yTop));
  // selected-speed bug
  const bugY = ty + th/2 + (ias-120)*pyPerKt;
  x.fillStyle = CYN; x.fillRect(tx+tw-2, bugY-6, 4, 12);
  txt(x, "120", tx-2, bugY, 13, CYN, "right"); txt(x, "KT", tx-2, bugY+14, 9, CYN, "right");
  // current speed pointer box
  const cy0 = ty + th/2;
  x.fillStyle = "#000"; x.strokeStyle = WHT; x.lineWidth = 1.5;
  x.beginPath();
  x.moveTo(tx+6, cy0-16); x.lineTo(tx+tw-18, cy0-16); x.lineTo(tx+tw-18, cy0-8);
  x.lineTo(tx+tw-2, cy0); x.lineTo(tx+tw-18, cy0+8); x.lineTo(tx+tw-18, cy0+16);
  x.lineTo(tx+6, cy0+16); x.closePath(); x.fill(); x.stroke();
  txt(x, Math.round(ias), tx+tw/2-4, cy0, 18, WHT);
  // TAS / GS block
  txt(x, "TAS", tx+26, ty+th+16, 11, DIM, "left");
  txt(x, Math.round(D.tas), tx+tw-6, ty+th+16, 13, MAG, "right");
  txt(x, "GS", tx+26, ty+th+32, 11, DIM, "left");
  txt(x, Math.round(D.gs), tx+tw-6, ty+th+32, 13, WHT, "right");
}

/* ---- altitude tape + VSI (right) ---- */
function drawAltTape(x, W, H) {
  const tw = 88, th = H*0.52, tx = W-tw-8, ty = H*0.16, pyPerFt = th/600;
  x.fillStyle = "rgba(10,10,14,0.85)"; x.fillRect(tx, ty, tw, th);
  x.strokeStyle = "#444"; x.strokeRect(tx, ty, tw, th);
  const alt = D.alt;
  x.font = "700 13px -apple-system,Helvetica"; x.textAlign = "left"; x.textBaseline = "middle";
  for (let f = Math.floor((alt-300)/100)*100; f <= alt+300; f += 100) {
    const y = ty + th/2 + (alt-f)*pyPerFt;
    if (y < ty+6 || y > ty+th-6) continue;
    x.fillStyle = WHT; x.fillRect(tx, y-1, 10, 2);
    x.fillText(f, tx+14, y);
    const y50 = y + 50*pyPerFt;
    if (y50 > ty+4 && y50 < ty+th-4) x.fillRect(tx, y50-1, 6, 1.5);
  }
  // selected altitude bug + readout (cyan)
  const sy = ty + th/2 + (alt-D.sel_alt)*pyPerFt;
  if (sy > ty-20 && sy < ty+th+20) {
    const yc = Math.min(Math.max(sy, ty+6), ty+th-6);
    x.fillStyle = CYN; x.beginPath();
    x.moveTo(tx, yc-8); x.lineTo(tx-8, yc); x.lineTo(tx, yc+8); x.closePath(); x.fill();
  }
  txt(x, Math.round(D.sel_alt), tx-10, ty+14, 14, CYN, "right");
  txt(x, "FT", tx-10, ty+28, 9, CYN, "right");
  // current altitude box
  const cy0 = ty + th/2;
  x.fillStyle = "#000"; x.strokeStyle = WHT; x.lineWidth = 1.5;
  x.beginPath();
  x.moveTo(tx+tw-6, cy0-18); x.lineTo(tx+18, cy0-18); x.lineTo(tx+18, cy0-9);
  x.lineTo(tx+2, cy0); x.lineTo(tx+18, cy0+9); x.lineTo(tx+18, cy0+18);
  x.lineTo(tx+tw-6, cy0+18); x.closePath(); x.fill(); x.stroke();
  txt(x, Math.round(alt), tx+tw/2+4, cy0-5, 17, WHT);
  txt(x, String(Math.abs(Math.round(alt))%100).padStart(2,"0"), tx+tw/2+4, cy0+9, 12, WHT);
  // VSI strip
  const vx = tx+tw+2, vw = 14;
  x.fillStyle = "rgba(10,10,14,0.85)"; x.fillRect(vx, ty, vw, th);
  x.strokeStyle = "#444"; x.strokeRect(vx, ty, vw, th);
  const vpy = th/4000;
  x.fillStyle = WHT;
  for (let v = -2000; v <= 2000; v += 500) {
    const y = ty + th/2 - v*vpy;
    if (y < ty+4 || y > ty+th-4) continue;
    x.fillRect(vx, y-1, 5, 1.5);
    if (v !== 0 && Math.abs(v) % 1000 === 0)
      txt(x, Math.abs(v/1000), vx+vw+10, y, 10, WHT);
  }
  const vy = ty + th/2 - Math.max(-2000, Math.min(2000, D.vs))*vpy;
  x.fillStyle = MAG; x.beginPath();
  x.moveTo(vx+vw, vy); x.lineTo(vx+vw+8, vy-6); x.lineTo(vx+vw+8, vy+6); x.closePath(); x.fill();
  txt(x, Math.round(D.vs), vx+vw+26, vy, 11, MAG);
  // BARO MIN + baro setting
  txt(x, "BARO MIN", tx-10, ty+th+16, 10, CYN, "right");
  txt(x, "296", tx-10, ty+th+30, 12, CYN, "right");
  txt(x, S.baro.toFixed(2), tx-10, ty+th+50, 15, CYN, "right");
  txt(x, "IN", tx-10, ty+th+62, 9, CYN, "right");
}

/* ---- heading strip (top center of PFD) ---- */
function drawHeadingStrip(x, W, H) {
  const hw = 260, hx = W/2-hw/2, hy = H*0.135, hh = 26, pxPerDeg = 3;
  x.fillStyle = "rgba(10,10,14,0.8)"; x.fillRect(hx, hy, hw, hh);
  x.strokeStyle = "#444"; x.strokeRect(hx, hy, hw, hh);
  x.save(); x.beginPath(); x.rect(hx, hy, hw, hh); x.clip();
  x.font = "700 12px -apple-system,Helvetica"; x.textAlign = "center"; x.textBaseline = "middle";
  for (let d = Math.floor((D.hdg-45)/5)*5; d <= D.hdg+45; d += 5) {
    const xx = hx + hw/2 + (d-D.hdg)*pxPerDeg;
    const lbl = ((d%360)+360)%360;
    if (lbl % 30 === 0) {
      x.fillStyle = WHT; x.fillRect(xx-1, hy+hh-9, 2, 9);
      x.fillText(lbl/10 || "N", xx, hy+9);
    } else { x.fillStyle = DIM; x.fillRect(xx-0.5, hy+hh-6, 1.5, 6); }
  }
  // DTK magenta bug
  const bx = hx + hw/2 + ((D.dtk - D.hdg + 540) % 360 - 180)*pxPerDeg;
  x.fillStyle = MAG; x.beginPath();
  x.moveTo(bx, hy+hh); x.lineTo(bx-6, hy+hh-9); x.lineTo(bx+6, hy+hh-9); x.closePath(); x.fill();
  x.restore();
  // lubber + readout
  x.fillStyle = GRN; x.beginPath();
  x.moveTo(W/2, hy+hh+2); x.lineTo(W/2-6, hy+hh+10); x.lineTo(W/2+6, hy+hh+10); x.closePath(); x.fill();
  x.fillStyle = "#000"; x.strokeStyle = WHT;
  const by = hy+hh+12;
  x.fillRect(W/2-30, by, 60, 20); x.strokeRect(W/2-30, by, 60, 20);
  txt(x, String(Math.round(D.hdg)).padStart(3,"0")+"°", W/2, by+10, 14, MAG);
  // HDG SYNC + DTK chips
  txt(x, "HDG", hx-30, by+2, 10, DIM); txt(x, "SYNC", hx-30, by+15, 12, CYN);
  txt(x, "DTK", hx+hw+34, by+2, 10, DIM); txt(x, Math.round(D.dtk)+"°", hx+hw+34, by+15, 12, MAG);
}

/* ---- HSI inset at bottom center of PFD (map-in-rose, like G3X) ---- */
function drawHSIInset(x, W, H) {
  const R = Math.min(W, H)*0.20, cx = W/2, cy = H - R*0.55;
  // terrain wedge backdrop
  x.save(); x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.clip();
  x.fillStyle = "#0d1f0c"; x.fillRect(cx-R, cy-R, R*2, R*2);
  for (let i = -R; i < R; i += 7) for (let j = -R; j < R; j += 7) {
    const n = fbm((D.lon + i*0.0004)*30, (D.lat + j*0.0004)*30);
    if (n > 0.52) { x.fillStyle = terrColor(n); x.fillRect(cx+i, cy+j, 7, 7); }
  }
  // course line + waypoints
  x.strokeStyle = MAG; x.lineWidth = 2.5;
  x.beginPath(); x.moveTo(cx, cy+R); x.lineTo(cx, cy-R); x.stroke();
  x.fillStyle = MAG;
  txt(x, "BLAZR", cx+8, cy-R*0.5, 11, MAG, "left");
  txt(x, "TRAYL", cx+8, cy+R*0.45, 11, WHT, "left");
  x.beginPath(); x.arc(cx, cy-R*0.55, 4, 0, TAU); x.strokeStyle = MAG; x.stroke();
  x.restore();
  // rose
  x.strokeStyle = WHT; x.lineWidth = 2;
  x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.stroke();
  x.font = "700 12px -apple-system,Helvetica"; x.textAlign = "center"; x.textBaseline = "middle";
  for (let d = 0; d < 360; d += 10) {
    const th = (d - D.hdg - 90)*Math.PI/180;
    const r1 = R, r2 = R - (d % 30 === 0 ? 11 : 6);
    x.strokeStyle = WHT; x.lineWidth = d % 30 === 0 ? 2 : 1;
    x.beginPath();
    x.moveTo(cx+Math.cos(th)*r1, cy+Math.sin(th)*r1);
    x.lineTo(cx+Math.cos(th)*r2, cy+Math.sin(th)*r2); x.stroke();
    if (d % 30 === 0) {
      const labels = {0:"N",3:"3",6:"6",9:"E",12:"12",15:"15",18:"S",21:"21",24:"24",27:"W",30:"30",33:"33"};
      txt(x, labels[d/30] ?? "", cx+Math.cos(th)*(R-20), cy+Math.sin(th)*(R-20), 11, WHT);
    }
  }
  // ownship
  x.fillStyle = WHT; x.beginPath();
  x.moveTo(cx, cy-10); x.lineTo(cx-6, cy+8); x.lineTo(cx, cy+4); x.lineTo(cx+6, cy+8);
  x.closePath(); x.fill();
  // range + mode labels
  txt(x, "2.5NM", cx-R*0.55, cy+R*0.35, 10, CYN);
  txt(x, "FMS", cx-16, cy+R+10, 11, MAG); txt(x, "LPV", cx+16, cy+R+10, 11, WHT);
}

/* ═══════════ top-down map pane ═══════════ */
const mapC = document.getElementById("map-canvas");
function drawMap() {
  const [x, W, H] = setupCanvas(mapC);
  const scale = (mapSplit ? Math.min(W,H) : Math.min(W,H)) / (mapRange*2); // px per NM-ish
  // synthetic terrain field
  const cell = mapSplit ? 10 : 7;
  for (let i = 0; i < W; i += cell) for (let j = 0; j < H; j += cell) {
    const wx = D.lon + (i - W/2)/cell*0.004, wy = D.lat - (j - H/2)/cell*0.004;
    const n = fbm(wx*30, wy*30);
    x.fillStyle = terrColor(n);
    x.fillRect(i, j, cell, cell);
  }
  const cx = W/2, cy = H/2;
  // range rings
  x.strokeStyle = "rgba(255,255,255,0.5)"; x.setLineDash([5,5]);
  for (const r of [0.5, 1]) {
    x.beginPath(); x.arc(cx, cy, Math.min(W,H)/2*r, 0, TAU); x.stroke();
  }
  x.setLineDash([]);
  // course to next wpt (magenta)
  const brg = (D.dtk - D.hdg)*Math.PI/180;
  x.strokeStyle = MAG; x.lineWidth = 3;
  x.beginPath(); x.moveTo(cx, cy);
  x.lineTo(cx + Math.sin(brg)*Math.min(W,H)*0.42, cy - Math.cos(brg)*Math.min(W,H)*0.42);
  x.stroke();
  // waypoint symbols
  const wpts = [
    {n:S.wpt_next, dx:0.30, dy:-0.34, mag:true},
    {n:S.wpt_after, dx:0.16, dy:0.28},
    {n:"BUXOM", dx:0.33, dy:0.36},
    {n:"KHIO", dx:-0.3, dy:0.1},
    {n:"BTG", dx:0.38, dy:-0.42},
    {n:"K4", dx:-0.38, dy:-0.3},
  ];
  for (const w of wpts) {
    const px = cx + w.dx*W, py = cy + w.dy*H;
    x.strokeStyle = w.mag ? MAG : WHT; x.lineWidth = 2;
    x.save(); x.translate(px, py); x.rotate(Math.PI/4);
    x.strokeRect(-5,-5,10,10); x.restore();
    txt(x, w.n, px, py-13, 11, w.mag ? MAG : WHT);
  }
  // ownship
  x.save(); x.translate(cx, cy);
  x.fillStyle = WHT; x.beginPath();
  x.moveTo(0,-12); x.lineTo(-8,10); x.lineTo(0,5); x.lineTo(8,10); x.closePath(); x.fill();
  x.restore();
  // north arrow
  x.strokeStyle = WHT; x.lineWidth = 2;
  x.beginPath(); x.moveTo(16,26); x.lineTo(16,10); x.stroke();
  x.beginPath(); x.moveTo(16,8); x.lineTo(12,15); x.lineTo(20,15); x.closePath();
  x.fillStyle = WHT; x.fill();
  // range label
  txt(x, "Auto", 30, H-26, 11, WHT, "left");
  txt(x, mapRange+"NM", 30, H-12, 12, MAG, "left");
  // obs readout box
  x.fillStyle = "rgba(0,0,0,0.6)"; x.fillRect(6, 6, 74, 44);
  txt(x, "K4 4200", 43, 20, 11, WHT);
  txt(x, "4200FT", 43, 34, 10, CYN);
  txt(x, "2000", 43, 46, 10, CYN);
}

/* ═══════════ HSI rose (right column) ═══════════ */
const hsiC = document.getElementById("hsi-canvas");
function drawHSI() {
  const [x, W, H] = setupCanvas(hsiC);
  const cx = W/2, cy = H/2 + 6, R = Math.min(W,H)/2 - 14;
  x.fillStyle = "#0a0a0d"; x.fillRect(0,0,W,H);
  x.strokeStyle = WHT; x.lineWidth = 2;
  x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.stroke();
  x.font = "700 12px -apple-system,Helvetica"; x.textAlign = "center"; x.textBaseline = "middle";
  for (let d = 0; d < 360; d += 15) {
    const th = (d-90)*Math.PI/180;   // compass card rotates with heading
    const r1 = R, r2 = R - (d % 45 === 0 ? 12 : 7);
    x.strokeStyle = WHT; x.lineWidth = d % 45 === 0 ? 2 : 1;
    x.beginPath();
    x.moveTo(cx+Math.cos(th)*r1, cy+Math.sin(th)*r1);
    x.lineTo(cx+Math.cos(th)*r2, cy+Math.sin(th)*r2); x.stroke();
  }
  // CDI arrow to DTK
  const th = (D.dtk-90)*Math.PI/180;
  x.strokeStyle = MAG; x.lineWidth = 3;
  x.beginPath();
  x.moveTo(cx+Math.cos(th)*(R-16), cy+Math.sin(th)*(R-16));
  x.lineTo(cx, cy);
  x.lineTo(cx-Math.cos(th)*(R-16), cy-Math.sin(th)*(R-16));
  x.stroke();
  x.fillStyle = MAG; x.beginPath();
  const hx = cx+Math.cos(th)*(R-16), hy = cy+Math.sin(th)*(R-16);
  x.moveTo(hx, hy);
  x.lineTo(hx + Math.cos(th+2.6)*12, hy + Math.sin(th+2.6)*12);
  x.lineTo(hx + Math.cos(th-2.6)*12, hy + Math.sin(th-2.6)*12);
  x.closePath(); x.fill();
  // waypoint labels
  txt(x, S.wpt_next, cx+40, cy-46, 13, MAG, "left");
  txt(x, S.wpt_after, cx+34, cy+18, 13, WHT, "left");
  txt(x, "BUXOM", cx+16, cy+56, 12, WHT, "left");
  // dev dots
  x.fillStyle = WHT;
  for (const dx of [-24,-12,12,24]) { x.beginPath(); x.arc(cx+dx, cy, 2.5, 0, TAU); x.fill(); }
  // ownship diamond
  x.save(); x.translate(cx, cy-2); x.rotate(Math.PI/4);
  x.strokeStyle = WHT; x.lineWidth = 2.5; x.strokeRect(-6,-6,12,12); x.restore();
  txt(x, "+05", cx-R+18, cy-R+22, 12, WHT);
  txt(x, "6.0NM", 14, H-12, 12, CYN, "left");
}

/* ═══════════ engine strip ═══════════ */
const engC = document.getElementById("engine-canvas");
function gauge(x, W, y, h, label, val, min, max, norm, fmt=v=>Math.round(v), unit="") {
  const bw = W-16, bx = 8, frac = Math.max(0, Math.min(1, (val-min)/(max-min)));
  txt(x, label, bx, y+6, 10, DIM, "left");
  txt(x, fmt(val)+unit, W-8, y+6, 12, WHT, "right");
  x.fillStyle = "#20202a"; x.fillRect(bx, y+14, bw, 8);
  x.fillStyle = GRN; x.fillRect(bx, y+14, bw*frac, 8);
  if (frac > norm) { // amber beyond normal top
    x.fillStyle = AMB; x.fillRect(bx+bw*norm, y+14, bw*(frac-norm), 8);
  }
  x.strokeStyle = "#3a3a44"; x.strokeRect(bx, y+14, bw, 8);
  return y + h;
}
function drawEngine() {
  const [x, W, H] = setupCanvas(engC);
  x.fillStyle = "#0e0e11"; x.fillRect(0,0,W,H);
  // RPM & MAP round mini-gauges
  const r = W*0.30, cx1 = W/2;
  function dial(cy, val, min, max, label, disp) {
    x.strokeStyle = "#3a3a44"; x.lineWidth = 2;
    x.beginPath(); x.arc(cx1, cy, r, Math.PI*0.75, Math.PI*2.25); x.stroke();
    x.strokeStyle = GRN; x.lineWidth = 4;
    const a0 = Math.PI*0.75, a1 = a0 + (val-min)/(max-min)*Math.PI*1.5;
    x.beginPath(); x.arc(cx1, cy, r, a0, Math.min(a1, Math.PI*2.25)); x.stroke();
    x.strokeStyle = AMB; x.lineWidth = 4;
    const an = a0 + 0.85*Math.PI*1.5;
    x.beginPath(); x.arc(cx1, cy, r, an, Math.PI*2.25); x.stroke();
    txt(x, label, cx1, cy-4, 9, DIM);
    txt(x, disp, cx1, cy+12, 15, WHT);
  }
  dial(44, D.rpm, 0, 2800, "RPM", Math.round(D.rpm));
  dial(44+r*2+14, D.map, 10, 30, "MAN IN", D.map.toFixed(1));
  let y = r*4 + 44;
  y = gauge(x, W, y, 34, "OIL PSI", D.oil_psi, 0, 130, 0.9);
  y = gauge(x, W, y, 34, "FUEL GPH", D.fuel_gph, 0, 25, 0.9);
  y = gauge(x, W, y, 34, "OIL °F", D.oil_f, 100, 260, 0.92);
  // CHT/EGT bar pairs
  txt(x, "CHT °F (4)", 8, y+6, 10, DIM, "left");
  txt(x, Math.round(Math.max(...D.cht)), W-8, y+6, 12, WHT, "right");
  y += 14;
  const bw2 = (W-24)/4;
  D.cht.forEach((v,i)=>{
    const f = Math.max(0, Math.min(1, (v-200)/300));
    x.fillStyle = "#20202a"; x.fillRect(8+i*(bw2+2), y, bw2, 26);
    x.fillStyle = f > 0.85 ? AMB : GRN; x.fillRect(8+i*(bw2+2), y+26-26*f, bw2, 26*f);
  });
  y += 38;
  txt(x, "EGT °F (3)", 8, y+6, 10, DIM, "left");
  txt(x, Math.round(Math.max(...D.egt)), W-8, y+6, 12, WHT, "right");
  y += 14;
  D.egt.slice(0,4).forEach((v,i)=>{
    const f = Math.max(0, Math.min(1, (v-1200)/500));
    x.fillStyle = "#20202a"; x.fillRect(8+i*(bw2+2), y, bw2, 26);
    x.fillStyle = f > 0.9 ? "#f87171" : GRN; x.fillRect(8+i*(bw2+2), y+26-26*f, bw2, 26*f);
  });
  y += 40;
  // fuel L/R vertical
  for (const [i, v] of [D.fuel_l, D.fuel_r].entries()) {
    const fx = 18 + i*(W/2), fh = 60, fw = 22;
    txt(x, v.toFixed(0), fx+fw/2, y-6, 13, WHT);
    x.fillStyle = "#20202a"; x.fillRect(fx, y, fw, fh);
    x.fillStyle = "#38bdf8"; x.fillRect(fx, y+fh*(1-v/25), fw, fh*v/25);
    x.strokeStyle = "#3a3a44"; x.strokeRect(fx, y, fw, fh);
    txt(x, "FUEL", fx+fw/2, y+fh+10, 9, DIM);
    txt(x, "GAL", fx+fw/2, y+fh+20, 9, DIM);
    txt(x, (v*2).toFixed(0), fx+fw/2, y+fh+32, 11, WHT);
  }
  y += 112;
  gauge(x, W, y, 34, "VOLTS", D.volts, 8, 16, 0.97, v=>v.toFixed(1));
}

/* ═══════════ DOM sync + events ═══════════ */
function syncDOM() {
  const $ = id => document.getElementById(id);
  $("dtk_next").textContent = Math.round(S.dtk)+"°";
  $("trk_box").textContent = Math.round(S.trk)+"°";
  $("wpt_dist").textContent = S.wpt_dist.toFixed(1);
  $("leg_from").textContent = S.wpt_after; $("leg_to").textContent = S.wpt_next;
  const em = Math.max(0, Math.round(S.ete_min));
  $("ete").textContent = `${String(Math.floor(em/60)).padStart(2,"0")}:${String(em%60).padStart(2,"0")}`;
  $("eta").textContent = S.eta_utc; $("utc").textContent = S.utc;
  $("timer").textContent = fmtTimer(S.timer);
  $("oat").textContent = Math.round(S.oat_f);
  $("com1a_name").textContent = S.com1_act_name || "COM1 ACT";
  $("com1s_name").textContent = S.com1_stby_name || "COM1 STBY";
  $("com2a_name").textContent = S.com2_act_name || "COM2 ACT";
  $("com2s_name").textContent = S.com2_stby_name || "COM2 STBY";
  $("nearest-list").innerHTML = S.nearest.map(a =>
    `<div class="nrow"><span class="nid">${a.id}</span><span class="nname">${a.name}</span>`+
    `<span class="nbrg">↑ ${a.brg}°</span><span class="ndist">${a.dist.toFixed(1)}NM</span></div>`).join("");
  document.getElementById("btn_ident").classList.toggle("active", Date.now() < identUntil);
}

function toggleSplit() {
  mapSplit = !mapSplit;
  document.getElementById("root").classList.toggle("split", mapSplit);
  sendEvent("split", {on: mapSplit});
}
document.getElementById("mapbox").addEventListener("click", toggleSplit);
document.getElementById("btn_split").addEventListener("click", toggleSplit);
document.getElementById("btn_ident").addEventListener("click", () => {
  identUntil = Date.now() + 18000; sendEvent("ident");
});
document.querySelectorAll(".freq").forEach(el =>
  el.addEventListener("click", () => {
    const grp = el.closest(".tgroup").id;
    const a = grp === "com1" ? ["com1_act","com1_stby"] : ["com2_act","com2_stby"];
    [S[a[0]], S[a[1]]] = [S[a[1]], S[a[0]]];
    el.parentElement.querySelectorAll(".freq").forEach(f => {
      const v = f.classList.contains("act") ? S[a[0]] : S[a[1]];
      f.textContent = v.toFixed(3);
    });
    sendEvent(grp + "_swap");
  }));

/* ─────────── offline sim fallback ───────────
 * Mirrors server.py:SimSource so the display animates with no backend
 * (e.g. served static from GitHub Pages). Runs only while no live
 * telemetry is arriving; a real server instantly takes over. */
const _sim = { t0: performance.now()/1000, last: performance.now()/1000,
               wpt_next: S.wpt_next, wpt_after: S.wpt_after, wpt_dist: S.wpt_dist,
               fuel_l: S.fuel_l, fuel_r: S.fuel_r, timer: S.timer };
const _p2 = n => String(n).padStart(2, "0");
const _hms = d => `${_p2(d.getUTCHours())}:${_p2(d.getUTCMinutes())}:${_p2(d.getUTCSeconds())}`;
const _hm  = d => `${_p2(d.getUTCHours())}:${_p2(d.getUTCMinutes())}`;
function simTick() {
  const now = performance.now()/1000;
  const dt = Math.min(0.1, now - _sim.last); _sim.last = now;
  const t = now - _sim.t0;
  S.roll  = 15 * Math.sin(t/9);
  S.pitch = 3 + 2 * Math.sin(t/7 + 1);
  S.hdg   = (S.hdg + S.roll*0.06*dt*10 + 360) % 360;
  S.trk   = S.hdg;
  S.ias   = Math.max(60, 120 + 12*Math.sin(t/13));
  S.tas   = S.ias * 1.09;
  S.gs    = S.tas - 10;
  S.vs    = 500 * Math.sin(t/11);
  S.alt  += S.vs/60 * dt;
  const r = S.hdg * Math.PI/180;
  S.lat  += Math.cos(r)*S.gs*dt/3440/60;
  S.lon  += Math.sin(r)*S.gs*dt/(3440*Math.cos(S.lat*Math.PI/180))/60;
  _sim.wpt_dist = Math.max(0.2, _sim.wpt_dist - S.gs*dt/3600);
  if (_sim.wpt_dist < 0.25) { _sim.wpt_next = _sim.wpt_after; _sim.wpt_after = "BUXOM"; _sim.wpt_dist = 6.0; }
  S.wpt_next = _sim.wpt_next; S.wpt_after = _sim.wpt_after; S.wpt_dist = _sim.wpt_dist;
  S.rpm = 2300 + 30*Math.sin(t/5);
  _sim.fuel_l = Math.max(0, _sim.fuel_l - dt/3600*8.5);
  _sim.fuel_r = Math.max(0, _sim.fuel_r - dt/3600*8.5);
  S.fuel_l = _sim.fuel_l; S.fuel_r = _sim.fuel_r;
  _sim.timer = Math.max(0, _sim.timer - dt); S.timer = _sim.timer;
  S.utc = _hms(new Date());
  S.eta_utc = _hm(new Date(Date.now() + _sim.wpt_dist/Math.max(S.gs,1)*3600*1000));
}

/* ═══════════ main loop ═══════════ */
function frame() {
  if (performance.now() - _lastMsg > 2000) simTick();   // no live data → self-animate
  smooth();
  drawPFD(); drawMap(); drawHSI(); drawEngine(); syncDOM();
  requestAnimationFrame(frame);
}
frame();
