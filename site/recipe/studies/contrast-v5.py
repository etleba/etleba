"""Contrast for the Zufall Stochastic Editorial tokens (recipe/direction-v5.md).

Reads the token values from src/styles.css, so a change to a token is checked, then tests every
text pair against 4.5:1 and every non-text pair (control boundaries, markers, focus rings) against
3:1, WCAG 2.x relative luminance. Decorative rules and construction lines are listed too, as exempt.
Run: python recipe/studies/contrast-v5.py [--json recipe/evidence/contrast-v5.result.json]
"""
import json
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
css = (root / "src" / "styles.css").read_text(encoding="utf-8")


def token(name: str) -> str:
    """A token's hex value, following var(--other) aliases."""
    m = re.search(rf"--{re.escape(name)}:\s*([^;]+);", css)
    if not m:
        raise SystemExit(f"token --{name} not found in src/styles.css")
    value = m.group(1).strip()
    alias = re.fullmatch(r"var\(--([a-z-]+)\)", value)
    return token(alias.group(1)) if alias else value


def lin(c: float) -> float:
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgb(h: str):
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def lum(h: str) -> float:
    r, g, b = rgb(h)
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def ratio(a: str, b: str) -> float:
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def over(fg: str, bg: str, alpha: float) -> str:
    """The colour of `fg` at `alpha` over `bg`, as the figure's construction lines are drawn."""
    f, b = rgb(fg), rgb(bg)
    return "#" + "".join(f"{round(a * alpha + c * (1 - alpha)):02x}" for a, c in zip(f, b))


T = {n: token(n) for n in [
    "surface-page", "surface-emphasis", "text-primary", "text-secondary", "border-quiet", "focus-ring",
    "status-error", "status-success", "status-warning", "text-inverse", "text-inverse-secondary",
    "border-quiet-inverse", "border-strong", "border-control", "border-control-inverse", "focus-ring-inverse",
]}

# (kind, what it is, foreground token, background token or hex)
pairs = [
    ("text", "Body, title and labels: ink on paper", "text-primary", "surface-page"),
    ("text", "Secondary text, captions, code line: muted ink on paper", "text-secondary", "surface-page"),
    ("text", "Error message: error on paper (with a x symbol)", "status-error", "surface-page"),
    ("text", "Success text, if used: success on paper", "status-success", "surface-page"),
    ("text", "Warning field text: ink on the warning field", "text-primary", "status-warning"),
    ("text", "Pressed button and tooltip text: paper on ink", "surface-page", "text-primary"),
    ("text", "Index text: off-white on deep field", "text-inverse", "surface-emphasis"),
    ("text", "Index secondary text, number, language, year, placeholder: on deep field", "text-inverse-secondary", "surface-emphasis"),
    ("text", "Selected index row: ink on paper", "text-primary", "surface-page"),
    ("text", "Selected index row number and meta: muted ink on paper", "text-secondary", "surface-page"),
    ("text", "README code block: off-white on deep field", "text-inverse", "surface-emphasis"),
    ("text", "Drive badge and tooltip: off-white / inverse secondary on deep field", "text-inverse-secondary", "surface-emphasis"),
    ("text", "Disk label name (ink on paper sticker)", "text-primary", "surface-page"),
    ("text", "Disk label foot line (muted ink on paper sticker)", "text-secondary", "surface-page"),
    ("text", "Inverse sticker name: off-white on deep field", "text-inverse", "surface-emphasis"),
    ("text", "Inverse sticker foot line: inverse secondary on deep field", "text-inverse-secondary", "surface-emphasis"),
    ("text", "Skip link: off-white on deep field", "text-inverse", "surface-emphasis"),
    ("non-text", "Focus ring on paper (2px outline)", "focus-ring", "surface-page"),
    ("non-text", "Focus ring on deep field (index): the inverse ring", "focus-ring-inverse", "surface-emphasis"),
    ("non-text", "Control boundary on paper: buttons, kbd (1px)", "border-control", "surface-page"),
    ("non-text", "Control boundary on deep field: the search field, kbd", "border-control-inverse", "surface-emphasis"),
    ("non-text", "Strong rule on paper: bar, sheet edge, figure plate", "border-strong", "surface-page"),
    ("non-text", "Inverse rule under the index head", "text-inverse", "surface-emphasis"),
    ("non-text", "Selected marker dot: ink on the paper row", "text-primary", "surface-page"),
    ("non-text", "Boot point, unwritten ring: control border on paper", "border-control", "surface-page"),
    ("non-text", "Boot point, written: ink on paper", "text-primary", "surface-page"),
    ("non-text", "Figure ink on paper sticker, sheet and page", "text-primary", "surface-page"),
    ("non-text", "Figure ink on the inverse sticker and the index", "text-inverse", "surface-emphasis"),
    ("non-text", "Selected-row figure after inversion (a near-black on paper)", "#0d0e12", "surface-page"),
]

# Informational: the focus ring that would fail on deep field (why there is an inverse ring), and decorative pairs.
info = [
    ("info", "The paper focus ring on deep field would not pass (so the index uses the inverse ring)", "focus-ring", "surface-emphasis"),
]
exempt = [
    ("exempt", "Quiet rule on paper (decorative separator, not a control boundary)", "border-quiet", "surface-page"),
    ("exempt", "Quiet rule on deep field (decorative separator between index rows)", "border-quiet-inverse", "surface-emphasis"),
    ("exempt", "Drive light, dim: on the bezel (decorative; the sheet's text states the reading)", "border-quiet-inverse", "surface-emphasis"),
    ("exempt", "Figure construction rings, ink at 32% on paper (decorative; points and the plot carry the data)", over(T["text-primary"], T["surface-page"], 0.32), "surface-page"),
    ("exempt", "Figure contour rules, ink at 30% on paper (decorative)", over(T["text-primary"], T["surface-page"], 0.30), "surface-page"),
]


def value(x: str) -> str:
    return T[x] if x in T else x


rows = []
failures = 0
for kind, what, fg, bg in pairs + info + exempt:
    a, b = value(fg), value(bg)
    r = ratio(a, b)
    need = 4.5 if kind == "text" else 3.0 if kind == "non-text" else None
    ok = None if need is None else r >= need
    if ok is False:
        failures += 1
    rows.append({"kind": kind, "what": what, "foreground": a, "background": b, "ratio": round(r, 2), "required": need, "pass": ok})

for r in rows:
    flag = "    " if r["pass"] is None else ("PASS" if r["pass"] else "FAIL")
    need = "  -  " if r["required"] is None else f"{r['required']:.1f}:1"
    print(f"{flag}  {r['kind']:8} {r['ratio']:>6.2f}:1  need {need}  {r['foreground']} on {r['background']}  {r['what']}")

print()
print("tokens:", json.dumps(T))
print(f"RESULT: {'PASS' if failures == 0 else 'FAIL'} ({sum(1 for r in rows if r['pass'])} passed, {failures} failed, {sum(1 for r in rows if r['pass'] is None)} informational or exempt)")

if "--json" in sys.argv:
    out = Path(sys.argv[sys.argv.index("--json") + 1])
    out.write_text(json.dumps({"tool": "contrast-v5", "status": "PASS" if failures == 0 else "FAIL", "tokens": T, "pairs": rows}, indent=2), encoding="utf-8")
    print("wrote", out)
sys.exit(1 if failures else 0)
