#!/usr/bin/env python3
"""glasswing_bridge — the sync point between Super AFCS (ROS2) and the
Glasswing data bus (FIX-Gateway NetFIX, tcp:3490).

Two directions:
  * ROS2 topics  -> NetFIX keys  (AFCS_MODE, AFCS_TARGET, ... see docs/INTEGRATION.md)
  * NetFIX keys  -> ROS2 topics  (flight data for mission logic + AFCS_CMD writes
                                  coming from panel/HUD buttons)

Protocol (same as glasswing-ui/server.py NetfixSource and the Track-2 HUD):
  subscribe: send "@sKEY\n" per key
  receive:   "KEY;value;aux;flags\n"
  write:     "KEY;value\n"          (via FIX-Gateway command server, tcp:3490 write)

This node is deliberately plain-Python-asyncio so it runs anywhere (Pi 5, Jetson,
dev Mac) with zero compiled deps beyond rclpy.
"""
import asyncio
import math
import rclpy
from rclpy.node import Node
from std_msgs.msg import String, Float32

# NetFIX keys we publish INTO FIX-Gateway (Track 3 -> Tracks 1/2)
AFCS_KEYS = ["AFCS_MODE", "AFCS_TARGET", "AFCS_PHASE", "AFCS_INTENT",
             "AFCS_DTG_NM", "AFCS_ETA_S", "AFCS_WIND", "AFCS_ENERGY",
             "AFCS_ADVISORY"]

# NetFIX keys we subscribe to FROM FIX-Gateway (flight data + panel/HUD commands)
SUBSCRIBE_KEYS = ["PITCH", "ROLL", "HEAD", "IAS", "TAS", "ALT", "VS", "GS",
                  "LAT", "LONG", "COURSE", "OAT", "RPM", "AFCS_CMD",
                  "TRAFFIC_BRG", "TRAFFIC_DIST", "TRAFFIC_RELALT"]


class NetfixLink:
    """Minimal asyncio NetFIX client with auto-reconnect."""

    def __init__(self, host: str, port: int, on_line, logger):
        self.host, self.port = host, port
        self.on_line, self.log = on_line, logger
        self._writer = None

    async def run(self):
        while True:
            try:
                reader, writer = await asyncio.open_connection(self.host, self.port)
                self._writer = writer
                for k in SUBSCRIBE_KEYS:
                    writer.write(f"@s{k}\n".encode())
                await writer.drain()
                self.log.info(f"netfix: connected {self.host}:{self.port}")
                while True:
                    raw = await asyncio.wait_for(reader.readline(), timeout=30.0)
                    if not raw:
                        raise ConnectionError("eof")
                    self.on_line(raw.decode(errors="replace").strip())
            except Exception as e:
                self._writer = None
                self.log.warn(f"netfix: {e} — retry in 3s")
                await asyncio.sleep(3.0)

    def write_key(self, key: str, value):
        if self._writer is not None:
            self._writer.write(f"{key};{value}\n".encode())


class GlasswingBridge(Node):
    def __init__(self):
        super().__init__("glasswing_bridge")
        self.declare_parameter("netfix_host", "127.0.0.1")
        self.declare_parameter("netfix_port", 3490)
        host = self.get_parameter("netfix_host").value
        port = self.get_parameter("netfix_port").value

        self.link = NetfixLink(host, port, self._on_netfix_line, self.get_logger())
        self._loop = asyncio.get_event_loop()
        self._loop.create_task(self.link.run())

        # ROS2 -> NetFIX: AFCS state topics become FIX keys
        self._ros2key = {
            "mode": "AFCS_MODE", "target": "AFCS_TARGET", "phase": "AFCS_PHASE",
            "intent": "AFCS_INTENT", "wind": "AFCS_WIND", "advisory": "AFCS_ADVISORY",
        }
        for topic, key in self._ros2key.items():
            self.create_subscription(
                String, f"/afcs/{topic}",
                lambda m, k=key: self.link.write_key(k, m.data), 10)
        self.create_subscription(Float32, "/afcs/dtg_nm",
                                 lambda m: self.link.write_key("AFCS_DTG_NM", f"{m.data:.1f}"), 10)
        self.create_subscription(Float32, "/afcs/eta_s",
                                 lambda m: self.link.write_key("AFCS_ETA_S", f"{m.data:.0f}"), 10)
        self.create_subscription(Float32, "/afcs/energy",
                                 lambda m: self.link.write_key("AFCS_ENERGY", f"{m.data:+.2f}"), 10)

        # NetFIX -> ROS2
        self.state_pub = self.create_publisher(String, "/glasswing/state", 10)
        self.cmd_pub = self.create_publisher(String, "/afcs/cmd", 10)

    def _on_netfix_line(self, line: str):
        if not line or line[0] in "@!":
            return
        parts = line.split(";")
        if len(parts) < 2:
            return
        key, val = parts[0], parts[1]
        if key == "AFCS_CMD":
            # panel/HUD command (e.g. DISENGAGE, GO_AROUND, CONFIRM) -> executive
            msg = String(); msg.data = val.strip().upper()
            self.cmd_pub.publish(msg)
            self.get_logger().warn(f"AFCS_CMD from cockpit: {msg.data}")
        else:
            msg = String(); msg.data = line
            self.state_pub.publish(msg)


def main():
    rclpy.init()
    node = GlasswingBridge()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
