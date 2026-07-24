# AR/XR HUD Avionics — Project Glasswing, Track 2: Auxiliary Wearable HUD

**Project context:** This is **Track 2 of Project Glasswing** (`~/DEV/Aviation/Project Glasswing/MASTER-PLAN.md`). Track 1 (the other work stream) is the traditional glass cockpit: FIX-Gateway data broker + pyEfis on the Pi + `glasswing-ui` (G3X-style touch display). Track 2 — this document — is the **lightweight auxiliary HUD**: a second display surface consuming the *same* data as the primary glass, worn as near-normal-looking AR glasses by the PIC.

**Mission:** VFR flight, small-to-medium GA aircraft. The pilot sees the real world through the lenses with the primary glass cockpit's instrument data overlaid — attitude, airspeed, altitude, heading — without ever looking down. Heads-up, eyes-out. The HUD is an **auxiliary mirror of the primary glass, never a sole source**: if it dies, nothing is lost.

**Stack:** Android (Kotlin) + Canvas 2D rendering + **NetFIX over TCP** (the Glasswing data bus)
**Targets:** RayNeo X2/X3, XREAL One/Ultra, Rokid Max, VITURE Pro — consumer see-through glasses with normal-eyewear form factor (USB-C DisplayPort + vendor SDK)
**Rejected stack:** Godot + OpenXR (see rationale in §1)

### Position in the Glasswing architecture

```
SpeedyBee F405 (AHRS+ADC+GPS) ──MAVLink──▶ FIX-Gateway ──NetFIX tcp:3490──▶ pyEfis        (Track 1: panel)
CAN-FIX EIS nodes ──────────CAN──────────▶ (data broker) ──NetFIX tcp:3490──▶ glasswing-ui  (Track 1: touch)
                                            │          └─NetFIX tcp:3490──▶ AR HUD       (Track 2: this doc)
                                            └─NetFIX────▶ Chronos-2 advisory engine
```

**Key consequence:** the HUD does NOT parse sim/telemetry protocols itself. It subscribes to FIX-Gateway's NetFIX server — identical to `glasswing-ui/server.py:NetfixSource`. Dev path: ArduPilot SITL (milestone0) or MSFS adapter → FIX-Gateway → NetFIX → HUD. Flight path: SpeedyBee → FIX-Gateway on the Pi → NetFIX over cockpit Wi-Fi → HUD phone. The bytes are identical; only the gateway's upstream connection string changes.

---

## 0. Read This First: Operational Context & Safety

This is a **supplemental situational-awareness display for VFR flight in a real aircraft**. That framing drives every design decision in this document.

### 0.1 Regulatory & safety posture (non-negotiable)
- ⚠️ **This is NOT certified avionics.** It is not TSO'd, not STC'd, and must **never** be used as a primary flight instrument. The certified panel instruments remain the sole legal source of flight data.
- ⚠️ **Experimental / personal-use project.** Do not use for IFR, IMC, night ops, or any phase of flight where its failure or inaccuracy could create a hazard.
- ⚠️ **Sterile-cockpit discipline:** the HUD must never demand attention. No alerts that pull eyes inward during critical phases (takeoff, landing, pattern). Declutter is a safety feature, not a UI preference.
- ⚠️ **Single-point-of-failure design rule:** if the HUD dies mid-flight (phone battery, cable, crash), the pilot loses **nothing** they need. Verify every flight: panel instruments first, HUD as bonus.
- ⚠️ Test extensively on the ground and as a **passenger** before ever using as PIC.

### 0.2 Human-factors design pillars for see-through VFR HUD
1. **Black = transparent.** On see-through optics, unlit pixels show the real world. The HUD must be sparse symbology on black — never panels, never backgrounds.
2. **Conformal symbology where possible.** A pitch ladder that matches the real horizon (Phase 2 head tracking) is worth 10× a floating instrument. Until then, keep symbology minimal and off-center so it never occludes traffic or the runway.
3. **Sunlight readability.** Birdbath/waveguide optics wash out in bright sun. Use high-luminance colors (green/white, never blue/red at low brightness), bold strokes, and expect to tune against a bright sky.
4. **Glanceable in <1 second.** Round-dial thinking, not MFD thinking. Big numerics, minimal text, no menus in flight.
5. **Latency matters.** A laggy attitude display is worse than none (mild motion-sickness + wrong cues). Target <100ms sensor-to-photon; keep telemetry at 20–50Hz and the render loop uncapped.

### 0.3 Where does the data come from?

**Primary (Glasswing-native): FIX-Gateway NetFIX, tcp:3490.** The Pi running FIX-Gateway is already the system of record for Track 1 — the HUD is just a third NetFIX client. This covers every development and flight configuration with one code path:

| Config | Upstream into FIX-Gateway | HUD sees |
|---|---|---|
| Dev: SITL (milestone0) | ArduPlane SITL → mavlink plugin | Full attitude + air data + GPS, real ArduPilot EKF output |
| Dev: MSFS | glasswing-ui `MsfsSource` adapter (to be wired) → FIX db keys | Same keys |
| Flight: SpeedyBee | F405 WING → mavlink plugin (serial/WiFi) | Real AHRS-grade attitude + pitot IAS + baro ALT + GPS |
| Flight: engine later | CAN-FIX EIS nodes → canfix plugin | RPM/OILP/OILT/FFLOW... for the EMS strip |

NetFIX keys used (same set as `glasswing-ui/server.py`): `PITCH, ROLL, HEAD, IAS, TAS, ALT, VS, GS, LAT, LONG, COURSE, OAT, RPM, MAP, OILP, OILT, FFLOW, VOLT`.

**Secondary/standalone option: Stratux GDL90 (UDP:4000)** — parser in §7b. Useful for bench-testing the HUD without the Glasswing stack running, or as a completely independent backup path (separate AHRS from the SpeedyBee = cross-check source, which the master plan §6 flags as desirable for attitude). **Do not** use it as the primary: it would fork the HUD's data model away from the primary glass, defeating the "auxiliary mirror of the same data" design.

**Fallback: phone GPS** via `LocationManager` — groundspeed/GPS-alt/track only, no attitude. Last-resort SA cues.

⚠️ **Data-quality rule inherited from the primary glass:** NetFIX `IAS` from the SpeedyBee's pitot is real indicated airspeed — the trap from the standalone-Stratux design (GPS groundspeed masquerading as airspeed) does not apply on the primary path. But if the HUD ever falls back to `GS` (no IAS available), the tape must switch its label to `GS` and change color — silently showing groundspeed as airspeed on short final is a genuine hazard.

---

## 1. Why Android and not Godot/OpenXR

| Concern | Godot + OpenXR | Android (Kotlin) |
|---|---|---|
| XREAL / Rokid / RayNeo support | ❌ None — OpenXR runtimes for these glasses don't exist in Godot's ecosystem | ✅ Official SDKs (NRSDK, UXR, RayNeo) |
| How glasses connect | Requires OpenXR runtime | Glasses appear as a USB-C **DisplayPort secondary display** — zero SDK needed for basic mirroring |
| 2D vector PFD rendering | SubViewport → quad → material pipeline | Direct `Canvas.draw*()` — pixel-perfect, trivially 60–120 Hz |
| Text legibility | Needs SDF fonts, supersampling, MSAA tuning | Free — Android text rendering is best-in-class |
| UDP telemetry | GDScript `PacketPeerUDP` | Kotlin `DatagramSocket` + coroutines/flows |
| Head tracking (3DoF/6DoF) | Via OpenXR | Via vendor SDK, added incrementally later |
| Build iteration | Export → deploy | `adb install` in seconds |

**Verdict:** The glasses ecosystem *is* Android. Godot's OpenXR targets Quest/SteamVR-class HMDs, not see-through tethered glasses. For a 2D HUD, an engine is pure overhead. Scrap Godot.

**Phase plan:**
- **Phase 1 (this doc):** 2D HUD rendered to the glasses display, UDP telemetry, zero vendor SDK. Works on *any* DP-alt-mode glasses.
- **Phase 2 (later):** Add vendor SDK (NRSDK etc.) for head tracking → spatially-anchored panels.

---

## 2. Architecture

```
┌────────────────────────┐   NetFIX tcp:3490    ┌─────────────────────────────┐
│ FIX-Gateway on Pi 5    │  "PITCH;12.5;.."     │  Android phone (HUD host)   │
│ (Glasswing data broker;│ ───────────────────► │  ┌───────────────────────┐  │
│  SITL/MSFS/SpeedyBee   │  client sends        │  │ NetfixClient (§7a)    │  │
│  upstream — see §0.3)  │  "@sPITCH" etc.      │  │  └► StateFlow<PfdData>│  │
└────────────────────────┘                      │  └─────────┬─────────────┘  │
                                                │            ▼                │
┌────────────────────────┐   GDL90 UDP:4000     │  ┌───────────────────────┐  │
│ Stratux (optional      │ ───────────────────► │  │ HudView (Canvas)      │  │
│ backup/cross-check, §7b│   (backup path only) │  │ attitude, tapes, HSI  │  │
└────────────────────────┘                      │  └─────────┬─────────────┘  │
                                                └────────────┼────────────────┘
                                                             ▼ Presentation API
                                                ┌─────────────────────────────┐
                                                │  AR glasses (2nd display)   │
                                                └─────────────────────────────┘
```

Key Android mechanism: **`Presentation`** (from `android.app`) — a special dialog that renders content onto a **secondary display** detected via `DisplayManager`. This is how we push the HUD to the glasses while the phone screen stays a control panel.

---

## 3. Project Structure

```
ar-hud-avionics/
├── settings.gradle.kts
├── build.gradle.kts                 (root)
└── app/
    ├── build.gradle.kts
    └── src/main/
        ├── AndroidManifest.xml
        └── java/com/hud/avionics/
            ├── MainActivity.kt
            ├── HudPresentation.kt
            ├── TelemetryClient.kt
            ├── PfdData.kt
            └── ui/
                └── HudView.kt
```

---

## 4. Gradle Files

### `settings.gradle.kts`
```kotlin
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "ar-hud-avionics"
include(":app")
```

### Root `build.gradle.kts`
```kotlin
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "2.0.20" apply false
}
```

### `app/build.gradle.kts`
```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.hud.avionics"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.hud.avionics"
        minSdk = 26                // DisplayManager Presentation works from API 17; 26 covers all glasses hosts
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
}
```

---

## 5. `AndroidManifest.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <!-- Needed to receive UDP broadcasts on some networks -->
    <uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE" />

    <application
        android:label="AR HUD Avionics"
        android:theme="@style/Theme.AppCompat.NoActionBar"
        android:allowBackup="false">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:launchMode="singleTask"
            android:configChanges="orientation|screenSize|screenLayout|smallestScreenSize|keyboardHidden"
            android:screenOrientation="landscape">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

> **Note:** UDP requires the phone and the sim PC to be on the same LAN (or the PC tethered/hotspot). No `BLUETOOTH`/XR permissions needed for Phase 1 — the glasses are just a display.

---

## 6. `PfdData.kt` — Telemetry Model

```kotlin
package com.hud.avionics

/** Immutable snapshot of one telemetry frame. All angles in degrees. */
data class PfdData(
    val pitchDeg: Float = 0f,
    val rollDeg: Float = 0f,
    val headingDeg: Float = 0f,
    val indicatedAirspeedKts: Float = 0f,
    val altitudeFt: Float = 0f,
    val verticalSpeedFpm: Float = 0f,
    val timestampMs: Long = 0L
) {
    companion object { val EMPTY = PfdData() }
}
```

---

## 7. `TelemetryClient.kt` — UDP Listener

Supports **two packet formats**, auto-detected per packet:

1. **CSV** (custom shim / python bridge): `"pitch,roll,heading,ias,alt,vs"`
2. **X-Plane 11/12 binary DATA output** (native, no shim needed): 5-byte `"DATA\0"` header followed by N records of 36 bytes: `int32 index` + `int32 unused` … actually 8 × float32 values.

```kotlin
package com.hud.avionics

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.nio.ByteBuffer
import java.nio.ByteOrder

class TelemetryClient(
    private val scope: CoroutineScope,
    private val listenPort: Int = 49001   // X-Plane: Settings → Data Output → "Send to port"
) {
    private val _pfd = MutableStateFlow(PfdData.EMPTY)
    val pfd: StateFlow<PfdData> = _pfd

    @Volatile private var running = false
    private var socket: DatagramSocket? = null

    // Latest raw values from X-Plane dataref rows (indexed by X-Plane output row number)
    private val xpRows = HashMap<Int, FloatArray>()

    fun start() {
        if (running) return
        running = true
        scope.launch(Dispatchers.IO) {
            try {
                socket = DatagramSocket(listenPort).apply {
                    soTimeout = 1000   // lets us check `running` periodically
                    reuseAddress = true
                }
                Log.i(TAG, "Listening for telemetry on UDP :$listenPort")
                val buf = ByteArray(4096)
                while (isActive && running) {
                    val packet = DatagramPacket(buf, buf.size)
                    try {
                        socket?.receive(packet)
                        parse(packet.data, packet.length)
                    } catch (_: java.net.SocketTimeoutException) {
                        // idle loop — check running flag
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Telemetry socket error", e)
            }
        }
    }

    fun stop() {
        running = false
        socket?.close()
        socket = null
    }

    private fun parse(data: ByteArray, length: Int) {
        if (length >= 5 && data[0] == 'D'.code.toByte() && data[1] == 'A'.code.toByte()
            && data[2] == 'T'.code.toByte() && data[3] == 'A'.code.toByte()) {
            parseXPlaneBinary(data, length)
        } else {
            parseCsv(String(data, 0, length, Charsets.UTF_8))
        }
    }

    // ---- Format 1: CSV "pitch,roll,heading,ias,alt,vs" ----
    private fun parseCsv(text: String) {
        val p = text.trim().split(',')
        if (p.size < 6) return
        try {
            _pfd.value = PfdData(
                pitchDeg = p[0].toFloat(),
                rollDeg = p[1].toFloat(),
                headingDeg = p[2].toFloat(),
                indicatedAirspeedKts = p[3].toFloat(),
                altitudeFt = p[4].toFloat(),
                verticalSpeedFpm = p[5].toFloat(),
                timestampMs = System.currentTimeMillis()
            )
        } catch (_: NumberFormatException) { /* drop malformed packet */ }
    }

    // ---- Format 2: X-Plane binary DATA ----
    // Header: "DATA\0" then records of 36 bytes: [int32 rowIndex][8 x float32]
    // Relevant default output rows (selectable in X-Plane's Data Output screen):
    //   Row 17: pitch, roll, heading (deg)   → "Pitch, roll, & headings"
    //   Row 3 : indicated airspeed (kts) is in row 3 "Speeds" (kias at index varies)
    //   Row 20: latitude/longitude/altitude  → altitude ft MSL at index 2
    //   Row 16: angular velocities...        → we use VVI from row 21 (moment) or compute
    // Simplest robust config: enable rows 3, 17, 20 and map indices below.
    private fun parseXPlaneBinary(data: ByteArray, length: Int) {
        val bb = ByteBuffer.wrap(data, 5, length - 5).order(ByteOrder.LITTLE_ENDIAN)
        while (bb.remaining() >= 36) {
            val row = bb.int
            val values = FloatArray(8) { bb.float }
            xpRows[row] = values
        }
        val r3  = xpRows[3]    // speeds: [0]=ias kts (X-Plane 12: index 0 is indicated AS)
        val r17 = xpRows[17]   // [0]=pitch, [1]=roll, [2]=heading true
        val r20 = xpRows[20]   // [2]=altitude ft MSL
        if (r17 != null) {
            _pfd.value = PfdData(
                pitchDeg = r17[0],
                rollDeg = r17[1],
                headingDeg = r17[2],
                indicatedAirspeedKts = r3?.get(0) ?: 0f,
                altitudeFt = r20?.get(2) ?: 0f,
                verticalSpeedFpm = xpRows[16]?.get(3) ?: 0f,  // optional VVI row
                timestampMs = System.currentTimeMillis()
            )
        }
    }

    companion object { private const val TAG = "TelemetryClient" }
}
```

> **X-Plane setup:** Settings → Data Output → check rows **3 (Speeds)**, **17 (Pitch, roll & headings)**, **20 (Lat, Lon & Altitude)**; set "UDP rate" to 30–50/sec; set destination IP to your phone's LAN IP, port **49001**.
> **MSFS:** has no UDP. Use a Python shim with `SimConnect` (e.g. `Python-SimConnect`) that prints CSV over UDP to port 49001 — the CSV parser above then works unchanged.

---

## 7a. `NetfixClient.kt` — Primary Data Path (Glasswing NetFIX)

Mirrors `glasswing-ui/server.py:NetfixSource` exactly: TCP connect to FIX-Gateway on :3490, send one subscription line per key (`@sPITCH\n`), then parse `KEY;value;...` lines forever. Reconnects with backoff.

```kotlin
package com.hud.avionics

import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.InetSocketAddress
import java.net.Socket

/** NetFIX client — subscribes to FIX-Gateway (the Glasswing data broker).
 *  Protocol: send "@sKEY\n" per key; receive "KEY;value;aux;flags" lines.
 *  Reference implementation: glasswing-ui/server.py class NetfixSource. */
class NetfixClient(
    private val scope: CoroutineScope,
    private val host: String = "192.168.4.1",   // Pi on cockpit Wi-Fi; 127.0.0.1 via adb forward for bench
    private val port: Int = 3490
) {
    private val _pfd = MutableStateFlow(PfdData.EMPTY)
    val pfd: StateFlow<PfdData> = _pfd
    @Volatile private var running = false

    // Same key set as glasswing-ui
    private val keys = listOf("PITCH","ROLL","HEAD","IAS","TAS","ALT","VS","GS",
        "LAT","LONG","COURSE","OAT","RPM","MAP","OILP","OILT","FFLOW","VOLT")

    fun start() {
        running = true
        scope.launch(Dispatchers.IO) {
            while (isActive && running) {
                try {
                    Socket().use { sock ->
                        sock.connect(InetSocketAddress(host, port), 5000)
                        sock.soTimeout = 30_000   // matches server.py's 30s readline timeout
                        val w = OutputStreamWriter(sock.getOutputStream())
                        val r = BufferedReader(InputStreamReader(sock.getInputStream()))
                        for (k in keys) { w.write("@s$k\n"); }
                        w.flush()
                        Log.i(TAG, "connected to FIX-Gateway $host:$port")
                        var line: String?
                        while (r.readLine().also { line = it } != null) {
                            parse(line!!)
                        }
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "netfix: $e — retrying in 3s")
                    delay(3000)
                }
            }
        }
    }

    fun stop() { running = false }

    private fun parse(line: String) {
        if (line.isEmpty() || line[0] == '@' || line[0] == '!') return
        val parts = line.split(';')
        if (parts.size < 2) return
        val v = parts[1].toFloatOrNull() ?: return
        val cur = _pfd.value
        _pfd.value = when (parts[0]) {
            "PITCH"  -> cur.copy(pitchDeg = v)
            "ROLL"   -> cur.copy(rollDeg = v)
            "HEAD"   -> cur.copy(headingDeg = v)
            "IAS"    -> cur.copy(indicatedAirspeedKts = v)
            "ALT"    -> cur.copy(altitudeFt = v)
            "VS"     -> cur.copy(verticalSpeedFpm = v)
            else     -> return   // GS/LAT/LONG/RPM/etc. consumed later (map, EMS strip)
        }.copy(timestampMs = System.currentTimeMillis())
    }

    companion object { private const val TAG = "NetfixClient" }
}
```

> **Bench dev with SITL (no aircraft, no Pi):** run milestone0 (`run-glasswing-sim.sh`) on the Mac, then either run the HUD in the Android emulator with `adb reverse`… actually NetFIX is a client→server connect, so use `adb forward tcp:3490 tcp:3490` and point `host = "127.0.0.1"` in the emulator, or point a physical phone at the Mac's LAN IP. `MainActivity` should accept host/port from a settings screen; defaults above.
> **Cockpit topology:** Pi 5 runs FIX-Gateway + hostapd (cockpit Wi-Fi AP); phone joins that network and connects to the Pi's IP. Latency over local Wi-Fi ≈ 5–20ms — fine.

---

## 7b. `Gdl90Client.kt` — Standalone/Backup Source (Stratux AHRS + GPS)

GDL90 frames are byte-stuffed: `0x7E` flags delimit each frame and `0x7D` is the escape byte (`0x7D 0x5E` = `0x7E`, `0x7D 0x5D` = `0x7D`). Each frame carries a 1-byte message ID and a CRC-16 (table-driven, poly 0x1021, init 0). For a HUD you only need three message IDs:

| ID | Content | Key fields |
|---|---|---|
| `0x00` | Heartbeat | link alive |
| `0x0A` | Ownship report | lat/lon, altitude, speed, track |
| `0x4C` | Stratux AHRS message | pitch/roll/heading (int16 LE = deg × 10) |

```kotlin
package com.hud.avionics

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.net.DatagramPacket
import java.net.DatagramSocket

/** GDL90 receiver for Stratux. Phone connects to the Stratux Wi-Fi hotspot;
 *  Stratux broadcasts on UDP 4000. */
class Gdl90Client(private val scope: CoroutineScope, private val port: Int = 4000) {

    private val _pfd = MutableStateFlow(PfdData.EMPTY)
    val pfd: StateFlow<PfdData> = _pfd
    @Volatile private var running = false

    // Ownship + AHRS arrive as separate messages; merge latest values
    private var altFt = 0f; private var gsKts = 0f; private var trackDeg = 0f
    private var pitch = 0f; private var roll = 0f; private var hdg = 0f

    fun start() {
        running = true
        scope.launch(Dispatchers.IO) {
            val sock = DatagramSocket(port).apply { reuseAddress = true }
            val buf = ByteArray(512)
            while (isActive && running) {
                try {
                    val p = DatagramPacket(buf, buf.size)
                    sock.receive(p)
                    onFrame(unstuff(p.data, p.length))
                } catch (_: Exception) { /* keep listening */ }
            }
        }
    }
    fun stop() { running = false }

    /** Strip 0x7E flags and undo 0x7D byte-stuffing. */
    private fun unstuff(raw: ByteArray, len: Int): ByteArray {
        val out = ArrayList<Byte>(len)
        var esc = false
        for (i in 0 until len) {
            val b = raw[i]
            when {
                b == 0x7E.toByte() -> { /* frame flag — ignore */ }
                esc -> { out.add((b.toInt() xor 0x20).toByte()); esc = false }
                b == 0x7D.toByte() -> esc = true
                else -> out.add(b)
            }
        }
        return out.toByteArray()
    }

    private fun onFrame(f: ByteArray) {
        if (f.size < 3) return
        when (f[0].toInt() and 0xFF) {
            0x0A -> parseOwnship(f)   // Ownship: alt, groundspeed, track
            0x4C -> parseAhrs(f)      // Stratux AHRS: pitch, roll, heading
        }
    }

    private fun le16(f: ByteArray, o: Int) =
        (f[o].toInt() and 0xFF) or ((f[o + 1].toInt() and 0xFF) shl 8)

    private fun parseOwnship(f: ByteArray) {
        // GDL90 ownship: altitude at bytes 10-11 (ft * 25/... spec: alt = raw*25 - 1000),
        // ground speed kts at 15-16, track/8 at 17-18 (deg = raw * 360/256)
        if (f.size < 19) return
        altFt = le16(f, 10) * 25f - 1000f
        gsKts = le16(f, 15).toFloat()
        trackDeg = le16(f, 17) * 360f / 256f
        publish()
    }

    private fun parseAhrs(f: ByteArray) {
        // Stratux AHRS message (ID 0x4C): int16 LE values, degrees x10
        // [1..2]=roll, [3..4]=pitch, [5..6]=heading, [7..8]=slip_skid, ...
        if (f.size < 7) return
        fun s16(o: Int): Int {
            val v = le16(f, o)
            return if (v >= 0x8000) v - 0x10000 else v
        }
        roll = s16(1) / 10f
        pitch = s16(3) / 10f
        hdg = s16(5) / 10f
        publish()
    }

    private fun publish() {
        _pfd.value = PfdData(
            pitchDeg = pitch, rollDeg = roll,
            headingDeg = hdg,               // magnetic from AHRS; fall back to GPS track if AHRS absent
            indicatedAirspeedKts = gsKts,   // NOTE: GPS groundspeed, NOT IAS — see warning below
            altitudeFt = altFt,             // GPS altitude, not pressure altitude
            verticalSpeedFpm = 0f,
            timestampMs = System.currentTimeMillis()
        )
    }
}
```

> ⚠️ **CRITICAL DATA-QUALITY WARNING (backup path only):** this GDL90 client feeds GPS groundspeed and GPS altitude — **not** airspeed/pressure altitude. It must only be used with the GS/GPS-ALT relabeling rule from §0.3, or in the decluttered attitude+heading profile. The primary NetFIX path carries true pitot IAS and baro ALT from the SpeedyBee, which is why NetFIX is primary.

---

## 8. `HudView.kt` — The PFD Renderer

A single custom `View` doing all drawing in `onDraw`. Black background is essential: on see-through glasses, **black = transparent** (pixels emit no light). Everything you draw is light added to the real world.

```kotlin
package com.hud.avionics.ui

import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.View
import com.hud.avionics.PfdData
import kotlin.math.*

class HudView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null
) : View(context, attrs) {

    @Volatile var data: PfdData = PfdData.EMPTY
        set(value) {
            field = value
            postInvalidateOnAnimation()   // thread-safe redraw from coroutine
        }

    // ---- Paints (green-on-black phosphor style; switch to white for outdoor use) ----
    private val green = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.GREEN; style = Paint.Style.STROKE; strokeWidth = 3f
    }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.GREEN; textSize = 34f; typeface = Typeface.MONOSPACE
        textAlign = Paint.Align.CENTER
    }
    private val textSmall = Paint(textPaint).apply { textSize = 24f }
    private val fillGreen = Paint(green).apply { style = Paint.Style.FILL }

    // Tunables
    private val pxPerDegPitch = 10f      // pitch ladder sensitivity
    private val tapePxPerKt = 4f         // airspeed tape sensitivity
    private val tapePxPerFt = 0.25f      // altitude tape: 4px per 100ft... adjust to taste

    // Reusable objects (never allocate in onDraw)
    private val path = Path()
    private val tmpRect = RectF()

    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat()
        val h = height.toFloat()
        val cx = w / 2f
        val cy = h / 2f

        canvas.drawColor(Color.BLACK)   // black = transparent on see-through optics

        drawAttitudeIndicator(canvas, cx, cy)
        drawFixedAircraftSymbol(canvas, cx, cy)
        drawAirspeedTape(canvas, w * 0.12f, cy, h * 0.7f)
        drawAltitudeTape(canvas, w * 0.88f, cy, h * 0.7f)
        drawHeadingStrip(canvas, cx, h * 0.06f, w * 0.5f)
        drawStatusText(canvas, w, h)
    }

    // ------------------------------------------------------------------
    // Artificial horizon: rotates with roll, translates with pitch.
    // Sign convention: nose UP (positive pitch) => horizon moves DOWN.
    // ------------------------------------------------------------------
    private fun drawAttitudeIndicator(c: Canvas, cx: Float, cy: Float) {
        c.save()
        // Clip to a central region so the ladder doesn't overdraw the tapes
        val clipW = width * 0.5f
        val clipH = height * 0.72f
        tmpRect.set(cx - clipW / 2, cy - clipH / 2, cx + clipW / 2, cy + clipH / 2)
        c.clipRect(tmpRect)

        // Transform order matters: rotate about the display center, THEN
        // offset along the (rotated) pitch axis so pitch stays perpendicular
        // to the horizon line — exactly like a real attitude indicator.
        c.rotate(-data.rollDeg, cx, cy)
        val pitchOffsetPx = data.pitchDeg * pxPerDegPitch
        c.translate(0f, pitchOffsetPx)

        // Horizon line (long)
        c.drawLine(cx - 2000, cy, cx + 2000, cy, green)

        // Pitch ladder: lines every 10°, minor every 5°
        for (deg in -90..90 step 5) {
            if (deg == 0) continue
            val y = cy - deg * pxPerDegPitch
            val half = when {
                deg % 10 == 0 -> 120f   // major
                else -> 60f             // minor
            }
            c.drawLine(cx - half, y, cx + half, y, green)
            if (deg % 10 == 0) {
                val label = abs(deg).toString()
                c.drawText(label, cx - half - 45, y + 10, textSmall)
                c.drawText(label, cx + half + 45, y + 10, textSmall)
            }
        }
        c.restore()
    }

    // Fixed aircraft reference symbol (the "wings" that stay glued to the pilot)
    private fun drawFixedAircraftSymbol(c: Canvas, cx: Float, cy: Float) {
        path.reset()
        path.moveTo(cx - 110, cy); path.lineTo(cx - 40, cy)
        path.lineTo(cx - 40, cy + 18)                       // left wing + droop
        path.moveTo(cx + 40, cy); path.lineTo(cx + 40, cy + 18)
        path.lineTo(cx + 110, cy)                           // right wing + droop
        path.moveTo(cx - 10, cy); path.lineTo(cx, cy - 12)  // center caret
        path.lineTo(cx + 10, cy)
        c.drawPath(path, green)
    }

    // ------------------------------------------------------------------
    // Airspeed scrolling tape (left). Current value boxed at center.
    // ------------------------------------------------------------------
    private fun drawAirspeedTape(c: Canvas, x: Float, cy: Float, tapeH: Float) {
        val ias = data.indicatedAirspeedKts
        c.save()
        tmpRect.set(x - 80, cy - tapeH / 2, x + 80, cy + tapeH / 2)
        c.clipRect(tmpRect)

        val startKt = (floor((ias - tapeH / 2 / tapePxPerKt) / 10) * 10).toInt()
        val endKt = (ceil((ias + tapeH / 2 / tapePxPerKt) / 10) * 10).toInt()
        for (kt in startKt..endKt step 10) {
            if (kt < 0) continue
            val y = cy - (kt - ias) * tapePxPerKt
            c.drawLine(x - 25, y, x + 25, y, green)
            c.drawText(kt.toString(), x - 55, y + 9, textSmall)
        }
        c.restore()

        // Current-value box
        tmpRect.set(x - 45, cy - 28, x + 45, cy + 28)
        c.drawRect(tmpRect, fillGreen)
        textPaint.color = Color.BLACK
        c.drawText(ias.roundToInt().toString(), x, cy + 12, textPaint)
        textPaint.color = Color.GREEN
    }

    // ------------------------------------------------------------------
    // Altitude scrolling tape (right).
    // ------------------------------------------------------------------
    private fun drawAltitudeTape(c: Canvas, x: Float, cy: Float, tapeH: Float) {
        val alt = data.altitudeFt
        c.save()
        tmpRect.set(x - 90, cy - tapeH / 2, x + 90, cy + tapeH / 2)
        c.clipRect(tmpRect)

        val step = 100
        val start = (floor((alt - tapeH / 2 / tapePxPerFt / step) ) * step).toInt()
        val end = (ceil((alt + tapeH / 2 / tapePxPerFt / step)) * step).toInt()
        var a = start
        while (a <= end) {
            if (a >= 0) {
                val y = cy - (a - alt) * (tapePxPerFt / step) * step / 1f  // = alt->px
                val yPx = cy - (a - alt) * tapePxPerFt
                c.drawLine(x - 25, yPx, x + 25, yPx, green)
                c.drawText(a.toString(), x + 62, yPx + 9, textSmall)
            }
            a += step
        }
        c.restore()

        tmpRect.set(x - 55, cy - 28, x + 55, cy + 28)
        c.drawRect(tmpRect, fillGreen)
        textPaint.color = Color.BLACK
        c.drawText(alt.roundToInt().toString(), x, cy + 12, textPaint)
        textPaint.color = Color.GREEN

        // VSI readout under the box
        val vs = data.verticalSpeedFpm.roundToInt()
        c.drawText(if (vs >= 0) "+$vs" else "$vs", x, cy + 70, textSmall)
    }

    // ------------------------------------------------------------------
    // Heading strip across the top.
    // ------------------------------------------------------------------
    private fun drawHeadingStrip(c: Canvas, cx: Float, y: Float, stripW: Float) {
        val hdg = data.headingDeg
        val pxPerDeg = stripW / 60f   // show 60° of compass
        c.save()
        tmpRect.set(cx - stripW / 2, y - 40, cx + stripW / 2, y + 55)
        c.clipRect(tmpRect)

        val first = (floor((hdg - 30) / 5) * 5).toInt()
        for (d in first..(first + 65) step 5) {
            val x = cx + (d - hdg) * pxPerDeg
            val norm = ((d % 360) + 360) % 360
            val major = norm % 10 == 0
            c.drawLine(x, y, x, y + if (major) 22 else 12, green)
            if (norm % 30 == 0) {
                val lbl = when (norm) {
                    0 -> "N"; 90 -> "E"; 180 -> "S"; 270 -> "W"
                    else -> (norm / 10).toString()
                }
                c.drawText(lbl, x, y + 48, textSmall)
            }
        }
        c.restore()
        // Fixed lubber line
        path.reset()
        path.moveTo(cx - 10, y - 28); path.lineTo(cx + 10, y - 28); path.lineTo(cx, y - 12)
        path.close()
        c.drawPath(path, fillGreen)
    }

    private fun drawStatusText(c: Canvas, w: Float, h: Float) {
        val age = System.currentTimeMillis() - data.timestampMs
        val stale = age > 1500
        val msg = if (stale) "NO TELEMETRY  (${age / 1000}s)" else "LINK OK"
        textSmall.textAlign = Paint.Align.RIGHT
        c.drawText(msg, w - 30, h - 30, textSmall)
        textSmall.textAlign = Paint.Align.CENTER
    }
}
```

---

## 9. `HudPresentation.kt` — Render to the Glasses Display

```kotlin
package com.hud.avionics

import android.app.Presentation
import android.content.Context
import android.os.Bundle
import android.view.Display
import com.hud.avionics.ui.HudView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** Pushes the HUD onto the secondary display (the AR glasses). */
class HudPresentation(
    outerContext: Context,
    display: Display,
    private val pfdFlow: StateFlow<PfdData>,
    private val scope: CoroutineScope
) : Presentation(outerContext, display) {

    private lateinit var hudView: HudView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        hudView = HudView(context).apply {
            setBackgroundColor(android.graphics.Color.BLACK)
            keepScreenOn = true
        }
        setContentView(hudView)

        // Collect telemetry on the UI thread and feed the view
        scope.launch {
            pfdFlow.collect { hudView.data = it }
        }
    }
}
```

---

## 10. `MainActivity.kt` — Display Detection + Wiring

```kotlin
package com.hud.avionics

import android.content.Context
import android.hardware.display.DisplayManager
import android.os.Bundle
import android.view.Display
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope

class MainActivity : AppCompatActivity() {

    private lateinit var telemetry: TelemetryClient
    private var presentation: HudPresentation? = null
    private lateinit var statusText: TextView

    private val displayListener = object : DisplayManager.DisplayListener {
        override fun onDisplayAdded(displayId: Int) = attachPresentation()
        override fun onDisplayRemoved(displayId: Int) = detachPresentation(displayId)
        override fun onDisplayChanged(displayId: Int) {}
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        statusText = TextView(this).apply {
            text = "AR HUD Avionics\n\nPlug in glasses to start HUD.\nTelemetry: UDP :49001"
            textSize = 18f
            setPadding(48, 48, 48, 48)
        }
        setContentView(statusText)

        telemetry = TelemetryClient(lifecycleScope, listenPort = 49001)
        telemetry.start()

        val dm = getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
        dm.registerDisplayListener(displayListener, null)
        attachPresentation()   // glasses may already be connected
    }

    private fun attachPresentation() {
        val dm = getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
        val glasses: Display? = dm.displays.firstOrNull {
            it.displayId != Display.DEFAULT_DISPLAY
        }
        if (glasses != null && presentation == null) {
            presentation = HudPresentation(this, glasses, telemetry.pfd, lifecycleScope).also {
                it.show()
                runOnUiThread { statusText.text = "HUD active on: ${glasses.name}" }
            }
        }
    }

    private fun detachPresentation(displayId: Int) {
        if (presentation?.display?.displayId == displayId) {
            presentation?.dismiss()
            presentation = null
            runOnUiThread { statusText.text = "Glasses disconnected." }
        }
    }

    override fun onDestroy() {
        (getSystemService(Context.DISPLAY_SERVICE) as DisplayManager)
            .unregisterDisplayListener(displayListener)
        presentation?.dismiss()
        telemetry.stop()
        super.onDestroy()
    }
}
```

---

## 11. Testing Without a Simulator

Quick fake telemetry broadcaster (Python) — run on your dev machine, phone on same Wi-Fi:

```python
# fake_telemetry.py  — sends CSV "pitch,roll,heading,ias,alt,vs" to the phone
import socket, math, time, sys

PHONE_IP = sys.argv[1] if len(sys.argv) > 1 else "192.168.1.50"
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

t = 0.0
while True:
    t += 0.033
    msg = "%.2f,%.2f,%.1f,%.1f,%.0f,%.0f" % (
        8 * math.sin(t * 0.5),          # gentle pitch oscillation
        25 * math.sin(t * 0.3),         # slow roll
        (t * 10) % 360,                 # slowly turning heading
        120 + 15 * math.sin(t * 0.2),   # airspeed
        3500 + 50 * math.sin(t * 0.4),  # altitude
        500 * math.sin(t * 0.4),        # VSI
    )
    sock.sendto(msg.encode(), (PHONE_IP, 49001))
    time.sleep(0.033)   # ~30 Hz
```

---

## 12. Build & Deploy

```bash
# Requires Android SDK + JDK 17
./gradlew assembleDebug
adb install app/build/outputs/apk/debug/app-debug.apk

# Watch telemetry logs
adb logcat -s TelemetryClient
```

**Checklist on device:**
1. Phone and sim PC on same LAN (phone hotspot works great — PC connects to it, phone gets a known IP).
2. X-Plane Data Output → phone IP, port 49001, rows 3/17/20 enabled. *or* run `fake_telemetry.py`.
3. Plug in glasses → HUD appears on glasses, status text updates on phone.

---

## 13. Phase 2: Head Tracking (Vendor SDKs)

When you want the panel spatially anchored instead of display-locked:

| Glasses | SDK | Notes |
|---|---|---|
| XREAL Air 2 / One / Ultra | **NRSDK** (Android, Unity, also has Android Java API) | 3DoF IMU free; 6DoF needs XREAL Eye / Beam Pro / Ultra cameras. NRSDK 2.x requires dev registration |
| Rokid Max / Air | **Rokid UXR SDK** | 3DoF/6DoF depending on model + Station |
| RayNeo X2/X3 | **RayNeo SDK** | True binocular AR w/ SLAM, but Android-based standalone |
| VITURE Pro | Neck-band SDK | 3DoF via their app; limited raw access |

Integration shape: replace `HudPresentation` with a `GLSurfaceView` (or keep Canvas and apply the SDK's head-pose quaternion as a translation offset of the whole HUD — for a HUD, 3DoF "world-locked panel" ≈ just offsetting by yaw/pitch × a distance factor; you don't need OpenGL for that).

---

## 14. Known Gotchas

- **Black = transparent** on see-through optics. Never fill the background with anything but black on the glasses display. Green/white elements only.
- **Focus distance:** most birdbath-optics glasses focus at ~4m. Fine text is legible but keep `textSize` ≥ 22px at 1080p and prefer bold strokes (strokeWidth 3px+).
- **Monocular vs binocular:** one HUD view rendered identically to both eyes — no stereo disparity needed for a HUD. Don't attempt depth effects.
- **UDP on hotel/corp Wi-Fi:** AP client isolation will silently eat packets. Use the phone's hotspot (sim dev) or the Stratux's own hotspot (aircraft).
- **Battery & heat in the cockpit:** glasses draw power from the phone; a summer cockpit is hot. Test worst case (2+ hour flight, sun on the glareshield, phone charging from ship's USB). Carry the phone on a vent mount, not the glareshield.
- **Sunlight washout:** consumer waveguide/birdbath glasses lose contrast against bright sky. Mitigations: green or white symbology only, stroke ≥3px, and tune glasses brightness on the ground against a bright horizon before flight. If it's marginal on the ground, it will be unreadable in the air.
- **Latency:** Wi-Fi AHRS (Stratux) adds ~50–150ms. Fine for VFR SA cues; do NOT use it for aggressive maneuvering reference. If the display feels "drunk" (lagging attitude), declutter to heading/altitude only.
- **AHRS orientation:** the Stratux AHRS must be mounted level and aligned to the longitudinal axis (configure orientation in the Stratux web UI, `/logs/ahrs` calibration page), or pitch/roll will be cross-coupled garbage.
- **Sunglasses compatibility:** verify the glasses' optics work in a bright cockpit with your prescription — several models need clip-in inserts; order them early.
- **Interference check:** verify no interference with comm/nav/GPS (Stratux + phone + glasses in a 12V panel environment) on the ground, engine running, all radios transmitting.
- **Presentation API quirks:** some phones (Samsung DeX-capable ones) handle secondary displays differently — if `DisplayManager` shows zero extra displays with glasses attached, check that the app isn't being routed into DeX mode.

---

## 15. Track 3 sync: Super AFCS (autonomy) on the HUD

**Track 3** (`~/DEV/Aviation/Super AFCS AutoPilot/`) adds the autopilot brain: auto
takeoff/land, nearest-airport divert, perception, voice commands. The HUD stays a
pure NetFIX client — it just subscribes to the new `AFCS_*` keys (contract:
`Super AFCS AutoPilot/docs/INTEGRATION.md`):

- Add to `NetfixClient.keys`: `AFCS_MODE, AFCS_TARGET, AFCS_PHASE, AFCS_INTENT,
  AFCS_ADVISORY, TRAFFIC_BRG, TRAFFIC_DIST, TRAFFIC_RELALT`.
- **FMA line** (top center, above the heading strip): `AFCS_MODE` + `AFCS_TARGET`,
  one slim line — e.g. `APPROACH · KSQL RWY30`. This is the "what is the airplane
  doing and why" annunciation; it must be visible at all times when AFCS is engaged.
- **Intent ticker** (bottom center, auto-expiring): `AFCS_INTENT` / `AFCS_ADVISORY`
  in plain pilot language ("Downwind entry 45°, land RWY30, wind 280@12").
- **Traffic chevron** at `TRAFFIC_BRG` on the heading strip when `TRAFFIC_DIST` < 2 NM
  — conformal with the compass, decluttered otherwise.
- **Voice front-end**: the HUD phone is the mic. Utterances go to Track 3's
  `afcs_human_interface` (Track 3 owns the intent grammar + readback/confirm
  protocol — never parse intents in the HUD app).
- Declutter rules (§0.1) still win: FMA is one line; advisories interrupt symbology
  only when safety-relevant; black = transparent.
- Failure isolation: if `AFCS_MODE` goes stale/absent the HUD is unaffected — flight
  symbology comes from the FC keys, exactly as before (Track 3 dies → lose nothing).

### §15.1 HUD-side code for the AFCS FMA

**`PfdData.kt`** — add AFCS fields (strings stay strings; `EMPTY` defaults keep
pre-AFCS behavior when keys are absent):

```kotlin
data class PfdData(
    // ... existing flight fields ...
    val afcsMode: String = "OFF",      // AFCS_MODE
    val afcsTarget: String = "",       // AFCS_TARGET
    val afcsPhase: String = "",        // AFCS_PHASE
    val afcsIntent: String = "",       // AFCS_INTENT (plain-language plan)
    val afcsAdvisory: String = "",     // AFCS_ADVISORY
    val trafficBrgDeg: Float = 0f,     // TRAFFIC_BRG
    val trafficDistNm: Float = 99f,    // TRAFFIC_DIST
    val timestampMs: Long = 0L
)
```

**`NetfixClient.kt`** — extend the subscription list and parser:

```kotlin
private val keys = listOf("PITCH","ROLL","HEAD","IAS","TAS","ALT","VS","GS",
    "LAT","LONG","COURSE","OAT","RPM","MAP","OILP","OILT","FFLOW","VOLT",
    // Track 3 (Super AFCS) — see docs/INTEGRATION.md
    "AFCS_MODE","AFCS_TARGET","AFCS_PHASE","AFCS_INTENT","AFCS_ADVISORY",
    "TRAFFIC_BRG","TRAFFIC_DIST","TRAFFIC_RELALT")

// in parse(): strings don't take the toFloatOrNull path — handle before it:
private fun parse(line: String) {
    if (line.isEmpty() || line[0] == '@' || line[0] == '!') return
    val parts = line.split(';')
    if (parts.size < 2) return
    val cur = _pfd.value
    when (parts[0]) {   // string keys first
        "AFCS_MODE"     -> { _pfd.value = cur.copy(afcsMode = parts[1].trim()); return }
        "AFCS_TARGET"   -> { _pfd.value = cur.copy(afcsTarget = parts[1].trim()); return }
        "AFCS_PHASE"    -> { _pfd.value = cur.copy(afcsPhase = parts[1].trim()); return }
        "AFCS_INTENT"   -> { _pfd.value = cur.copy(afcsIntent = parts[1].trim()); return }
        "AFCS_ADVISORY" -> { _pfd.value = cur.copy(afcsAdvisory = parts[1].trim()); return }
    }
    val v = parts[1].toFloatOrNull() ?: return
    _pfd.value = when (parts[0]) {
        // ... existing float cases ...
        "TRAFFIC_BRG"  -> cur.copy(trafficBrgDeg = v)
        "TRAFFIC_DIST" -> cur.copy(trafficDistNm = v)
        else -> return
    }.copy(timestampMs = System.currentTimeMillis())
}
```

**`HudView.kt`** — FMA strip + traffic chevron. Call `drawFmaStrip()` and
`drawTrafficChevron()` from `onDraw` after the heading strip:

```kotlin
private val amber = Paint(textPaint).apply { color = 0xFFFFB000.toInt() } // annunciator amber

// FMA: one slim line top-center above the heading strip + intent ticker bottom.
// Always visible when AFCS != OFF; OFF/stale renders nothing (declutter wins).
private fun drawFmaStrip(c: Canvas, cx: Float, top: Float, w: Float, h: Float) {
    val d = data
    if (d.afcsMode == "OFF" || d.afcsMode.isEmpty()) return
    val engaged = d.afcsMode !in listOf("SHADOW")
    val modePaint = if (engaged) textSmall else amber   // amber = shadow/advisory only
    val line1 = if (d.afcsTarget.isEmpty()) d.afcsMode
                else "${d.afcsMode} · ${d.afcsTarget}"
    c.drawText(line1, cx, top + 30, modePaint)

    // Intent ticker (plain-language plan from the autonomy — the "why")
    val ticker = d.afcsAdvisory.ifEmpty { d.afcsIntent }
    if (ticker.isNotEmpty()) {
        textSmall.textAlign = Paint.Align.CENTER
        c.drawText(ticker, cx, h - 60, if (d.afcsAdvisory.isNotEmpty()) amber else textSmall)
    }
}

// Traffic chevron on the heading strip: diamond at relative bearing when < 2 NM.
private fun drawTrafficChevron(c: Canvas, cx: Float, stripY: Float, stripW: Float) {
    val d = data
    if (d.trafficDistNm >= 2f) return
    val relBrg = ((d.trafficBrgDeg - d.headingDeg + 540) % 360) - 180
    if (abs(relBrg) > 30) return                       // off-strip: declutter
    val x = cx + relBrg * (stripW / 60f)
    path.reset()
    path.moveTo(x, stripY + 70); path.lineTo(x + 9, stripY + 82)
    path.lineTo(x, stripY + 94); path.lineTo(x - 9, stripY + 82)
    path.close()
    c.drawPath(path, if (d.trafficDistNm < 1f) amber else fillGreen)
}
```

The phone-mic voice front-end (§15 bullet 4) sends raw utterances to Track 3's
`afcs_human_interface`; the HUD only renders readbacks via `AFCS_ADVISORY` —
no intent parsing in the app.

## 15b. Roadmap (aligned to Glasswing milestones)

- [ ] **H1 — bench:** HUD renders against SITL via NetFIX (Glasswing milestone0 stack, zero hardware)
- [ ] **H2 — dev:** MSFS adapter → FIX-Gateway → HUD (mirrors glasswing-ui's MsfsSource work)
- [ ] **H3 — flight data:** SpeedyBee F405 → FIX-Gateway → HUD over cockpit Wi-Fi (rides Glasswing milestone 3 hardware)
- [ ] Tape smoothing (exponential filter on roll/pitch)
- [ ] VFR declutter profile: attitude + heading + altitude core set; GS/IAS labeling rule (§0.3)
- [ ] Traffic overlay — either GDL90 0x14 via Stratux backup path, or FIX keys if gateway gains an ADS-B plugin
- [ ] EMS mini-strip (RPM/OILP/OILT) once CAN-FIX EIS nodes exist (Glasswing milestone 4)
- [ ] **H4:** vendor SDK head tracking → conformal horizon (pitch ladder locked to real horizon) — highest-value VFR upgrade
- [ ] Cross-check attitude: SpeedyBee vs Stratux AHRS disagreement flag (master plan §6 risk #2)
- [ ] Synthetic vision terrain (later; reuse glasswing-ui terrain work; 3D → GLSurfaceView)
