"""intent_parser — aviation-shaped grammar for voice/text commands.

Design rules (SAFETY.md §5):
  * tiny, unambiguous grammar — no free-form LLM guessing in the control path
  * every parse returns a readback string; execution only after confirm
  * unknown input parses to REJECTED, never to a best-guess action
"""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class Intent:
    kind: str        # DIVERT | LAND_AT | CLIMB_TO | HOLD | GO_AROUND | DISENGAGE
                     # | SAY_INTENTIONS | REJECTED
    argument: str
    readback: str
    safety_critical: bool


_WORDNUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
            "six": 6, "seven": 7, "eight": 8, "nine": 9, "zero": 0}


def _digits(text: str) -> str:
    """Altitude words -> digits.
    'four thousand five hundred' -> 4500; 'four five hundred' -> 4500;
    'sixty five hundred' -> 6500; bare digits '4500' -> 4500."""
    t = text.lower()
    m = re.search(r"\d[\d,]{1,7}", t)
    if m:
        return m.group(0).replace(",", "")
    words = re.findall(r"[a-z]+", t)
    tens = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
            "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}
    total, current, i = 0, 0, 0
    while i < len(words):
        w = words[i]
        if w in _WORDNUM:
            if i + 1 < len(words) and words[i + 1] == "thousand":
                total += _WORDNUM[w] * 1000; i += 2; continue
            if i + 1 < len(words) and words[i + 1] == "hundred":
                # "sixty five hundred": prefix (60) + 5 -> 6500
                prefix = current + _WORDNUM[w] if current >= 20 else _WORDNUM[w]
                total += prefix * 100; current = 0; i += 2; continue
            current = current * 10 + _WORDNUM[w]
        elif w in tens:
            current += tens[w]
        elif w == "thousand":
            total += max(current, 1) * 1000; current = 0
        elif w == "hundred":
            total += max(current, 1) * 100; current = 0
        i += 1
    n = total + current
    return str(n) if n else ""


def parse(utterance: str) -> Intent:
    u = utterance.strip().lower()
    u = re.sub(r"^(glasswing|ok glasswing|hey glasswing)[,\s]*", "", u)

    if re.search(r"\b(disengage|my aircraft|i have (the )?(aircraft|controls))\b", u):
        return Intent("DISENGAGE", "", "Autonomy off. You have the aircraft.", True)
    if re.search(r"\bgo ?around\b", u):
        return Intent("GO_AROUND", "", "Go around.", True)
    if re.search(r"\b(say|what are) (your )?intentions\b", u):
        return Intent("SAY_INTENTIONS", "", "", False)

    m = re.search(r"\b(land at|take me to|divert to|go to)\s+([a-z0-9\s]{2,12})$", u)
    if m:
        arg = m.group(2).strip().upper()
        if re.search(r"\b(nearest|closest)\b", u):
            return Intent("DIVERT", "nearest", "Diverting to the nearest suitable airport. Confirm?", True)
        return Intent("LAND_AT", arg, f"We will fly the approach and land at {arg}. Confirm?", True)

    if re.search(r"\bnearest (airport|airfield|strip)|get (me|us) down\b", u):
        return Intent("DIVERT", "nearest", "Nearest suitable airport. Confirm?", True)

    m = re.search(r"\b(climb|descend|climb and maintain|descend and maintain)\s+(?:to\s+)?(.+)$", u)
    if m:
        alt = _digits(m.group(2))
        if alt:
            verb = "Climb" if "climb" in m.group(1) else "Descend"
            return Intent("CLIMB_TO", alt, f"{verb} and maintain {alt} feet. Confirm?", True)

    if re.search(r"\bhold\b", u):
        return Intent("HOLD", "present position", "Holding at present position. Confirm?", True)

    return Intent("REJECTED", "", "Sorry, I didn't understand. Try 'divert to nearest airport' or 'say intentions'.", False)
