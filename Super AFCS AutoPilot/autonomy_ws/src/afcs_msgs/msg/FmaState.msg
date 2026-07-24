# Flight Mode Annunciation — what the airplane is doing and why.
# glasswing_bridge republishes this to NetFIX; panel + HUD render it.
string mode        # OFF|SHADOW|ARMED|AUTO_TAKEOFF|ENROUTE|APPROACH|AUTOLAND|GO_AROUND|DEGRADED|FAILSAFE
string target      # e.g. "KSQL RWY30"
string phase       # fine-grained phase from the active action
string intent      # plain-language plan ("Downwind entry 45, land RWY30, wind 280@12")
float32 dtg_nm
float32 eta_s
string advisory    # latest advisory, empty when none
