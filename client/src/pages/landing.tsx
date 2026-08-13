import { useState, useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { Link } from "wouter";

/* ═══════════════════════════════════════════════════════════════════════
   JAGO — Premium Light Landing Page
   Investor-Grade · Apple Elegance · Stripe Polish · Uber Trust
   ═══════════════════════════════════════════════════════════════════════ */

const C = {
  brand: "#f1dcfa",
  lavender: "#f8effc",
  softPurple: "#dca8ff",
  violet: "#b66dff",
  roseGlow: "#ffc8ef",
  skyTint: "#eef7ff",
  cream: "#fffdf9",
  heading: "#44385a",
  body: "#6c6480",
  bodyLight: "#9a90ad",
  border: "rgba(182,109,255,0.14)",
  borderStrong: "rgba(182,109,255,0.22)",
  white: "#ffffff",
  gradViolet: "linear-gradient(135deg, #b66dff 0%, #dca8ff 100%)",
  gradRose: "linear-gradient(135deg, #b66dff 0%, #ffc8ef 100%)",
  gradText: "linear-gradient(90deg, #b66dff, #dca8ff, #ffc8ef, #b66dff)",
  gradHero: "linear-gradient(160deg, #fffdf9 0%, #f8effc 30%, #eef7ff 60%, #f8effc 100%)",
  glass: "rgba(255,255,255,0.70)",
  glassBorder: "rgba(182,109,255,0.12)",
  glowViolet: "rgba(182,109,255,0.20)",
  glowRose: "rgba(255,200,239,0.25)",
  cardBg: "rgba(255,255,255,0.80)",
  sectionAlt: "#f8effc",
} as const;

const ft = "'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
const LANDING_NAV_OFFSET = 104;

/* ─────────────── HOOKS ─────────────── */
function useReveal(threshold = 0.12) {
  const ref = useRef<HTMLDivElement>(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVis(true); io.disconnect(); } },
      { threshold }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return { ref, vis };
}

function useCountUp(target: number, dur = 2200) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = Date.now();
      const tick = () => {
        const p = Math.min((Date.now() - t0) / dur, 1);
        setVal(Math.round((1 - Math.pow(1 - p, 4)) * target));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [target, dur]);
  return { ref, val };
}

/* ─────────────── PHONE MOCKUP ─────────────── */
const SCREENS = ["home", "route", "fare", "pilot", "track"] as const;
type Screen = typeof SCREENS[number];

function MiniScreen({ screen }: { screen: Screen }) {
  const [eta, setEta] = useState(3);
  useEffect(() => {
    if (screen !== "track") return;
    const t = setInterval(() => setEta(e => Math.max(1, e - 1)), 1400);
    return () => clearInterval(t);
  }, [screen]);

  const accent = "#b66dff";

  const Bar = () => (
    <div style={{ height: 28, background: "#faf7ff", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", flexShrink: 0, borderBottom: "1px solid rgba(182,109,255,0.06)" }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: "#44385a", fontFamily: ft }}>9:41</span>
      <div style={{ width: 52, height: 6, borderRadius: 3, background: "#e8dcf5" }} />
      <span style={{ fontSize: 8, color: "#9a90ad" }}>●●● ▮</span>
    </div>
  );

  if (screen === "home") return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#fffdf9" }}>
      <Bar />
      <div style={{ flex: 1, position: "relative", background: "linear-gradient(160deg,#f8effc,#eef7ff)", overflow: "hidden" }}>
        {[...Array(6)].map((_, i) => <div key={i} style={{ position: "absolute", left: 0, right: 0, top: `${i * 18}%`, height: 1, background: "rgba(182,109,255,.04)" }} />)}
        {[...Array(6)].map((_, i) => <div key={`v${i}`} style={{ position: "absolute", top: 0, bottom: 0, left: `${i * 18}%`, width: 1, background: "rgba(182,109,255,.04)" }} />)}
        <div style={{ position: "absolute", left: "48%", top: "42%", transform: "translate(-50%,-50%)" }}>
          <div style={{ width: 16, height: 16, borderRadius: "50%", background: accent, border: "3px solid #fff", boxShadow: `0 0 0 8px rgba(182,109,255,.12), 0 0 20px rgba(182,109,255,.2)` }} />
        </div>
        <div style={{ position: "absolute", left: "68%", top: "28%", width: 10, height: 10, borderRadius: "50%", background: "#ffc8ef", boxShadow: "0 0 12px rgba(255,200,239,.3)", animation: "jg-pulse 2s infinite" }} />
        <div style={{ position: "absolute", left: "25%", top: "65%", width: 7, height: 7, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 10px rgba(74,222,128,.3)", animation: "jg-pulse 2.5s infinite" }} />
      </div>
      <div style={{ background: "#fff", padding: "14px 12px 12px", boxShadow: "0 -6px 24px rgba(182,109,255,.06)", borderRadius: "18px 18px 0 0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 10, color: "#6c6480", fontFamily: ft }}>Good morning ✨</span>
          <div style={{ width: 22, height: 22, borderRadius: "50%", background: C.gradViolet, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 8, color: "#fff", fontWeight: 800 }}>R</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#f8effc", borderRadius: 12, padding: "9px 10px", marginBottom: 10, border: "1px solid rgba(182,109,255,.08)" }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: accent }} />
          <span style={{ fontSize: 10, color: "#9a90ad", fontFamily: ft }}>Where do you want to go?</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-around" }}>
          {[["🏍️", "Bike"], ["🛺", "Auto"], ["🚗", "Car"], ["📦", "Parcel"]].map(([e, l]) => (
            <div key={l} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <div style={{ width: 36, height: 36, borderRadius: 12, background: "#f8effc", border: "1px solid rgba(182,109,255,.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>{e}</div>
              <span style={{ fontSize: 8, color: "#44385a", fontWeight: 600, fontFamily: ft }}>{l}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (screen === "route") return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#fff" }}>
      <Bar />
      <div style={{ background: C.gradViolet, padding: "16px 12px 20px" }}>
        <p style={{ fontSize: 8.5, color: "rgba(255,255,255,.55)", margin: "0 0 8px", fontFamily: ft, textTransform: "uppercase", letterSpacing: 1.5 }}>Set Route</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, background: "rgba(255,255,255,.15)", borderRadius: 10, padding: "8px 10px" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#4ade80" }} />
            <span style={{ fontSize: 10, color: "rgba(255,255,255,.85)", fontFamily: ft }}>Current Location</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, background: "#fff", borderRadius: 10, padding: "8px 10px" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: accent }} />
            <span style={{ fontSize: 10, color: accent, fontWeight: 700, fontFamily: ft }}>Hitech City Metro</span>
          </div>
        </div>
      </div>
      <div style={{ flex: 1, padding: "10px 12px", overflow: "hidden" }}>
        {[{ p: "Hitech City Metro", d: "3.2 km" }, { p: "Apollo Hospital", d: "5.8 km" }, { p: "Inorbit Mall", d: "2.1 km" }].map((x, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #f3eef8" }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "#f8effc", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>📍</div>
            <div><p style={{ margin: 0, fontSize: 10.5, fontWeight: 600, color: "#44385a", fontFamily: ft }}>{x.p}</p><p style={{ margin: 0, fontSize: 8, color: "#9a90ad" }}>{x.d}</p></div>
          </div>
        ))}
      </div>
      <div style={{ padding: "0 12px 14px" }}>
        <div style={{ background: C.gradViolet, borderRadius: 14, padding: "12px", textAlign: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", fontFamily: ft }}>Confirm Route →</span>
        </div>
      </div>
    </div>
  );

  if (screen === "fare") return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#fffdf9" }}>
      <Bar />
      <div style={{ flex: 1, background: "linear-gradient(140deg,#f8effc,#eef7ff)", position: "relative", overflow: "hidden" }}>
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id="routeG" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor={accent} /><stop offset="100%" stopColor="#ffc8ef" /></linearGradient>
          </defs>
          <path d="M25 72 Q50 48 75 28" stroke="url(#routeG)" strokeWidth="2.5" fill="none" strokeDasharray="5 3" opacity="0.6" />
          <circle cx="25" cy="72" r="4" fill="#fff" stroke={accent} strokeWidth="1.5" />
          <circle cx="75" cy="28" r="4" fill="#ffc8ef" />
        </svg>
        <div style={{ position: "absolute", right: 10, top: 10, background: "#fff", borderRadius: 8, padding: "4px 10px", boxShadow: "0 2px 12px rgba(182,109,255,.1)" }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: accent, fontFamily: ft }}>3.2 km · 8 min</span>
        </div>
      </div>
      <div style={{ background: "#fff", padding: "14px 12px", boxShadow: "0 -6px 20px rgba(182,109,255,.06)", borderRadius: "18px 18px 0 0" }}>
        <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
          {[{ t: "Bike", f: "₹45", a: true }, { t: "Auto", f: "₹75", a: false }, { t: "Cab", f: "₹130", a: false }].map(o => (
            <div key={o.t} style={{ flex: 1, padding: "8px 4px", borderRadius: 12, border: `2px solid ${o.a ? accent : "transparent"}`, background: o.a ? "#f8effc" : "#faf7ff", textAlign: "center" }}>
              <p style={{ margin: 0, fontSize: 9, fontWeight: 700, fontFamily: ft, color: o.a ? accent : "#9a90ad" }}>{o.t}</p>
              <p style={{ margin: "2px 0 0", fontSize: 14, fontWeight: 900, color: o.a ? accent : "#bbb5c7", fontFamily: ft }}>{o.f}</p>
            </div>
          ))}
        </div>
        <div style={{ background: C.gradViolet, borderRadius: 14, padding: "12px", textAlign: "center", boxShadow: `0 4px 16px ${C.glowViolet}` }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "#fff", fontFamily: ft }}>Confirm Booking ✓</span>
        </div>
      </div>
    </div>
  );

  if (screen === "pilot") return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#fff" }}>
      <Bar />
      <div style={{ background: C.gradRose, padding: "22px 12px 28px", textAlign: "center" }}>
        <div style={{ width: 42, height: 42, borderRadius: "50%", background: "rgba(255,255,255,.25)", margin: "0 auto 8px", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(8px)" }}>
          <span style={{ fontSize: 20, color: "#fff" }}>✓</span>
        </div>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#fff", fontFamily: ft }}>Pilot Matched!</p>
        <p style={{ margin: "4px 0 0", fontSize: 10, color: "rgba(255,255,255,.7)", fontFamily: ft }}>Arriving in 2 min</p>
      </div>
      <div style={{ flex: 1, padding: "14px 12px", background: "#faf7ff" }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 14, boxShadow: "0 4px 20px rgba(182,109,255,.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: "50%", background: C.gradViolet, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#fff", fontWeight: 800 }}>R</div>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#44385a", fontFamily: ft }}>Ravi Kumar</p>
              <span style={{ fontSize: 9.5, color: "#9a90ad", fontFamily: ft }}>⭐ 4.8 · 1,240 rides</span>
            </div>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#f8effc", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>📞</div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, borderTop: "1px solid #f3eef8" }}>
            {[{ l: "Vehicle", v: "Activa" }, { l: "Plate", v: "TS09AB" }, { l: "OTP", v: "7482" }].map(x => (
              <div key={x.l} style={{ textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: 7.5, color: "#9a90ad", fontFamily: ft }}>{x.l}</p>
                <p style={{ margin: "2px 0 0", fontSize: 11, fontWeight: 800, color: x.l === "OTP" ? accent : "#44385a", fontFamily: ft }}>{x.v}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // track
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#fffdf9" }}>
      <Bar />
      <div style={{ flex: 1, background: "linear-gradient(140deg,#f8effc,#eef7ff)", position: "relative" }}>
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M28 65 Q48 48 68 28" stroke="url(#routeG)" strokeWidth="2" fill="none" opacity=".4" />
          <circle cx="28" cy="65" r="3" fill="#fff" stroke={accent} strokeWidth="1.5" />
          <circle cx="68" cy="28" r="3" fill="#ffc8ef" />
          <circle cx="45" cy="50" r="5" fill={accent} />
          <circle cx="45" cy="50" r="9" fill="rgba(182,109,255,.1)" />
        </svg>
        <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", background: "#fff", borderRadius: 20, padding: "5px 14px", boxShadow: "0 4px 16px rgba(182,109,255,.1)", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: accent, animation: "jg-pulse 1.5s infinite" }} />
          <span style={{ fontSize: 9.5, fontWeight: 700, color: "#44385a", fontFamily: ft }}>Pilot arriving in {eta} min</span>
        </div>
      </div>
      <div style={{ background: "#fff", padding: "12px", boxShadow: "0 -6px 20px rgba(182,109,255,.05)", borderRadius: "18px 18px 0 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "#44385a", fontFamily: ft }}>Ravi Kumar · Bike</p>
            <p style={{ margin: "2px 0 0", fontSize: 8.5, color: "#9a90ad" }}>TS09AB1234</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 900, background: C.gradViolet, backgroundClip: "text", WebkitBackgroundClip: "text", color: "transparent" }}>₹45</p>
            <p style={{ margin: 0, fontSize: 8, color: "#9a90ad" }}>Cash</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {["Call", "Cancel", "Share"].map((l, ai) => (
            <div key={l} style={{ flex: 1, background: ai === 1 ? "#fff5f7" : "#f8effc", borderRadius: 10, padding: "8px 4px", textAlign: "center", border: `1px solid ${ai === 1 ? "#fecdd3" : "rgba(182,109,255,.08)"}` }}>
              <span style={{ fontSize: 9.5, fontWeight: 600, color: ai === 1 ? "#e11d48" : accent, fontFamily: ft }}>{l}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FloatingPhone() {
  const [idx, setIdx] = useState(0);
  const [key, setKey] = useState(0);
  useEffect(() => {
    const t = setInterval(() => { setKey(k => k + 1); setIdx(i => (i + 1) % SCREENS.length); }, 3600);
    return () => clearInterval(t);
  }, []);
  const labels = ["Home", "Route", "Fare", "Pilot", "Track"];

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
      <div style={{ position: "relative", width: 272, height: 554 }}>
        {/* Rotating glow rings */}
        <div style={{ position: "absolute", inset: -55, border: "1.5px solid rgba(182,109,255,.06)", borderRadius: "50%", animation: "jg-spin-slow 30s linear infinite" }} />
        <div style={{ position: "absolute", inset: -85, border: "1px solid rgba(255,200,239,.05)", borderRadius: "50%", animation: "jg-spin-slow 45s linear infinite reverse" }} />

        {/* Main glow */}
        <div style={{ position: "absolute", inset: -50, borderRadius: 60, background: `radial-gradient(ellipse, ${C.glowViolet} 0%, ${C.glowRose} 40%, transparent 70%)`, filter: "blur(60px)", animation: "jg-glow-pulse 5s ease-in-out infinite" }} />

        {/* Floating glass cards around phone */}
        <div style={{ position: "absolute", top: 40, left: -85, background: "rgba(255,255,255,.85)", backdropFilter: "blur(12px)", borderRadius: 14, padding: "8px 14px", border: "1px solid rgba(182,109,255,.1)", animation: "jg-float-card 5s ease-in-out infinite", zIndex: 5, boxShadow: "0 8px 24px rgba(182,109,255,.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80" }} />
            <span style={{ fontSize: 10, color: "#44385a", fontWeight: 600, fontFamily: ft }}>Live GPS</span>
          </div>
        </div>
        <div style={{ position: "absolute", bottom: 80, right: -95, background: "rgba(255,255,255,.85)", backdropFilter: "blur(12px)", borderRadius: 14, padding: "8px 14px", border: "1px solid rgba(182,109,255,.1)", animation: "jg-float-card 6s ease-in-out infinite 1s", zIndex: 5, boxShadow: "0 8px 24px rgba(182,109,255,.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11 }}>⭐</span>
            <span style={{ fontSize: 10, color: "#44385a", fontWeight: 600, fontFamily: ft }}>4.9 Rating</span>
          </div>
        </div>
        <div style={{ position: "absolute", top: "55%", left: -75, background: "rgba(255,255,255,.85)", backdropFilter: "blur(12px)", borderRadius: 14, padding: "8px 14px", border: "1px solid rgba(182,109,255,.1)", animation: "jg-float-card 7s ease-in-out infinite 2s", zIndex: 5, boxShadow: "0 8px 24px rgba(182,109,255,.08)" }}>
          <span style={{ fontSize: 10, color: "#44385a", fontWeight: 600, fontFamily: ft }}>₹45 · 8 min</span>
        </div>
        <div style={{ position: "absolute", top: 10, right: -70, background: "rgba(255,255,255,.85)", backdropFilter: "blur(12px)", borderRadius: 14, padding: "8px 14px", border: "1px solid rgba(255,200,239,.15)", animation: "jg-float-card 5.5s ease-in-out infinite 0.5s", zIndex: 5, boxShadow: "0 8px 24px rgba(255,200,239,.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11 }}>🚀</span>
            <span style={{ fontSize: 10, color: "#44385a", fontWeight: 600, fontFamily: ft }}>60s Match</span>
          </div>
        </div>

        {/* Phone body */}
        <div style={{ position: "absolute", inset: 0, borderRadius: 44, animation: "jg-float 5.5s ease-in-out infinite" }}>
          <div style={{ position: "absolute", inset: 0, borderRadius: 44, background: "#f0e4f7", boxShadow: `0 50px 100px rgba(182,109,255,.20), 0 20px 50px rgba(0,0,0,.06), inset 0 0 0 1.5px rgba(255,255,255,.6), 0 0 0 2px rgba(182,109,255,.12)`, overflow: "hidden" }}>
            {/* Side buttons */}
            <div style={{ position: "absolute", left: -3, top: 100, width: 3, height: 26, background: "#dcc6ee", borderRadius: "3px 0 0 3px" }} />
            <div style={{ position: "absolute", left: -3, top: 140, width: 3, height: 26, background: "#dcc6ee", borderRadius: "3px 0 0 3px" }} />
            <div style={{ position: "absolute", right: -3, top: 120, width: 3, height: 36, background: "#dcc6ee", borderRadius: "0 3px 3px 0" }} />
            {/* Screen */}
            <div style={{ position: "absolute", inset: 7, borderRadius: 38, overflow: "hidden", background: "#fff" }}>
              <div key={key} style={{ width: "100%", height: "100%", animation: "jg-screen-slide .4s cubic-bezier(.16,1,.3,1) forwards" }}>
                <MiniScreen screen={SCREENS[idx]} />
              </div>
            </div>
            {/* Glass reflection */}
            <div style={{ position: "absolute", top: 0, left: 0, right: "55%", bottom: "45%", background: "linear-gradient(150deg, rgba(255,255,255,.25), transparent)", borderRadius: "44px 0 0 0", pointerEvents: "none" }} />
          </div>
        </div>
      </div>
      {/* Dots */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", zIndex: 2 }}>
        {SCREENS.map((_, i) => (
          <button key={i} onClick={() => { setIdx(i); setKey(k => k + 1); }}
            style={{ width: i === idx ? 28 : 8, height: 8, borderRadius: 4, background: i === idx ? C.gradViolet : "rgba(182,109,255,.12)", border: "none", cursor: "pointer", transition: "all .35s cubic-bezier(.16,1,.3,1)", padding: 0 }}
          />
        ))}
      </div>
      <p style={{ fontSize: 10, fontWeight: 600, color: C.bodyLight, fontFamily: ft, margin: 0, letterSpacing: 2.5, textTransform: "uppercase" }}>{labels[idx]}</p>
    </div>
  );
}

/* ─────────────── MARQUEE ─────────────── */
function Marquee() {
  const items = ["Safe Rides ✦", "Fast Pickup ✦", "Lowest Fare ✦", "Verified Pilots ✦", "Live Tracking ✦", "Cashless Pay ✦", "24/7 Support ✦", "Zero Surge ✦", "Wallet Cashback ✦", "GPS Enabled ✦", "SOS Shield ✦", "Top Rated ✦"];
  const dup = [...items, ...items];
  return (
    <div style={{ overflow: "hidden", background: "rgba(248,239,252,0.6)", borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, padding: "20px 0", position: "relative", backdropFilter: "blur(12px)" }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 100, background: `linear-gradient(90deg, ${C.cream}, transparent)`, zIndex: 2 }} />
      <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 100, background: `linear-gradient(270deg, ${C.cream}, transparent)`, zIndex: 2 }} />
      <div style={{ display: "flex", gap: 48, animation: "jg-marquee 32s linear infinite", width: "max-content" }}>
        {dup.map((t, i) => (
          <span key={i} style={{ fontSize: 13, fontWeight: 600, color: C.violet, fontFamily: ft, letterSpacing: 0.5, whiteSpace: "nowrap" }}>{t}</span>
        ))}
      </div>
    </div>
  );
}

/* ─────────────── SECTION HEADER ─────────────── */
function SecHead({ tag, title, sub, align = "center" }: { tag: string; title: ReactNode; sub?: string; align?: "center" | "left" }) {
  return (
    <div style={{ textAlign: align, maxWidth: align === "center" ? 640 : undefined, margin: align === "center" ? "0 auto 56px" : "0 0 48px" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(182,109,255,.06)", border: "1px solid rgba(182,109,255,.14)", borderRadius: 40, padding: "6px 18px 6px 14px", marginBottom: 20 }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.violet, boxShadow: `0 0 8px ${C.glowViolet}`, animation: "jg-pulse 2s infinite" }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: C.violet, textTransform: "uppercase", letterSpacing: 2.5, fontFamily: ft }}>{tag}</span>
      </div>
      <h2 style={{ fontSize: "clamp(28px, 3.5vw, 46px)", fontWeight: 900, fontFamily: ft, letterSpacing: -1.5, lineHeight: 1.1, color: C.heading, marginBottom: sub ? 16 : 0 }}>{title}</h2>
      {sub && <p style={{ fontSize: 16, color: C.body, lineHeight: 1.8, fontWeight: 400, maxWidth: 520, margin: align === "center" ? "0 auto" : undefined }}>{sub}</p>}
    </div>
  );
}

/* ─────────────── GRADIENT WORD ─────────────── */
function GradWord({ children }: { children: string }) {
  return <span style={{ background: C.gradText, backgroundSize: "300% auto", backgroundClip: "text", WebkitBackgroundClip: "text", color: "transparent", animation: "jg-grad-shift 5s ease-in-out infinite" }}>{children}</span>;
}

/* ─────────────── TESTIMONIAL CARD ─────────────── */
function TestimonialSlider() {
  const [active, setActive] = useState(0);
  const testimonials = [
    { name: "Priya Sharma", role: "Daily Commuter", city: "Hyderabad", text: "Pickup in 40 seconds! I've never seen anything this fast. JAGO is my daily ride now.", rating: 5, avatar: "PS" },
    { name: "Arjun Reddy", role: "College Student", city: "Bangalore", text: "Cheaper than all other apps. I save ₹200+ every week using JAGO for my college commute.", rating: 5, avatar: "AR" },
    { name: "Sneha Patel", role: "Working Professional", city: "Mumbai", text: "Clean UI and safe drivers. As a woman, I feel very safe with SOS feature and live tracking.", rating: 5, avatar: "SP" },
    { name: "Vikram Singh", role: "Freelancer", city: "Delhi", text: "Best bike taxi in the city! The pilots are professional and the app is super smooth.", rating: 5, avatar: "VS" },
  ];

  useEffect(() => {
    const t = setInterval(() => setActive(a => (a + 1) % testimonials.length), 4500);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ position: "relative", maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 24, overflow: "hidden" }}>
        {testimonials.map((t, i) => (
          <div key={i} style={{
            minWidth: "100%",
            transform: `translateX(-${active * 100}%)`,
            transition: "transform .6s cubic-bezier(.16,1,.3,1)",
            padding: "0 20px",
          }}>
            <div style={{
              background: C.white,
              borderRadius: 28,
              padding: "44px 48px",
              border: `1px solid ${C.border}`,
              boxShadow: "0 20px 60px rgba(182,109,255,.06)",
              textAlign: "center",
              position: "relative",
              overflow: "hidden",
            }}>
              <div style={{ position: "absolute", top: -20, right: -20, width: 100, height: 100, borderRadius: "50%", background: "rgba(248,239,252,.5)", filter: "blur(30px)", pointerEvents: "none" }} />
              <div style={{ fontSize: 36, marginBottom: 8, opacity: 0.15, color: C.violet }}>❝</div>
              <p style={{ fontSize: 20, fontWeight: 500, color: C.heading, lineHeight: 1.7, fontFamily: ft, marginBottom: 28, fontStyle: "italic" }}>
                "{t.text}"
              </p>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
                <div style={{ width: 48, height: 48, borderRadius: "50%", background: C.gradViolet, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: "#fff", fontFamily: ft }}>
                  {t.avatar}
                </div>
                <div style={{ textAlign: "left" }}>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.heading, fontFamily: ft }}>{t.name}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: C.body }}>{t.role} · {t.city}</p>
                </div>
              </div>
              <div style={{ display: "flex", gap: 4, justifyContent: "center", marginTop: 16 }}>
                {[...Array(t.rating)].map((_, j) => <span key={j} style={{ fontSize: 14, color: "#fbbf24" }}>★</span>)}
              </div>
            </div>
          </div>
        ))}
      </div>
      {/* Dots */}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 28 }}>
        {testimonials.map((_, i) => (
          <button key={i} onClick={() => setActive(i)} style={{
            width: i === active ? 28 : 8,
            height: 8,
            borderRadius: 4,
            background: i === active ? C.gradViolet : "rgba(182,109,255,.15)",
            border: "none",
            cursor: "pointer",
            transition: "all .35s cubic-bezier(.16,1,.3,1)",
            padding: 0,
          }} />
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   MAIN LANDING PAGE
   ═══════════════════════════════════════════════════ */
export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);

  const cRides = useCountUp(500000, 2400);
  const cCities = useCountUp(50, 1600);
  const cPilots = useCountUp(20000, 2000);
  const cRating = useCountUp(49, 1500);

  const rSvc = useReveal();
  const rHow = useReveal();
  const rWhy = useReveal();
  const rPilot = useReveal();
  const rStats = useReveal();
  const rTest = useReveal();
  const rCta = useReveal();

  const [typeText, setTypeText] = useState("");
  const [wordIdx, setWordIdx] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const words = ["Faster.", "Safe.", "Happy."];

  useEffect(() => {
    const timeout = setTimeout(() => {
      const currentWord = words[wordIdx];
      if (!isDeleting) {
        setTypeText(currentWord.substring(0, typeText.length + 1));
        if (typeText === currentWord) {
          setTimeout(() => setIsDeleting(true), 2500);
        }
      } else {
        setTypeText(currentWord.substring(0, typeText.length - 1));
        if (typeText === "") {
          setIsDeleting(false);
          setWordIdx((prev) => (prev + 1) % words.length);
        }
      }
    }, isDeleting ? 60 : 120);
    return () => clearTimeout(timeout);
  }, [typeText, isDeleting, wordIdx]);

  const [selSvc, setSelSvc] = useState<null | any>(null);
  const [svcModalVisible, setSvcModalVisible] = useState(false);

  const scrollToSection = (hash: string) => {
    if (typeof document === "undefined" || !hash.startsWith("#")) return;
    const target = document.querySelector<HTMLElement>(hash);
    if (!target) return;
    const top = Math.max(0, target.getBoundingClientRect().top + window.scrollY - LANDING_NAV_OFFSET);
    window.history.replaceState(null, "", hash);
    window.scrollTo({ top, behavior: "smooth" });
  };

  const handleSectionNavigation = (event: MouseEvent<HTMLElement>, hash: string) => {
    event.preventDefault();
    scrollToSection(hash);
  };

  const handlePlaceholderClick = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
  };

  const openServiceModal = (service: any) => {
    setSelSvc(service);
    requestAnimationFrame(() => setSvcModalVisible(true));
  };

  const closeServiceModal = () => {
    setSvcModalVisible(false);
    window.setTimeout(() => setSelSvc(null), 240);
  };

  const closeServiceModalAndNavigate = (event: MouseEvent<HTMLElement>, hash: string) => {
    event.preventDefault();
    closeServiceModal();
    window.setTimeout(() => scrollToSection(hash), 180);
  };

  useEffect(() => {
    if (!selSvc) return;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [selSvc]);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 30);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  useEffect(() => {
    if (!window.location.hash) return;
    requestAnimationFrame(() => scrollToSection(window.location.hash));
  }, []);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
        body{font-family:${ft};background:${C.cream};overflow-x:hidden;color:${C.body}}
        ::selection{background:rgba(182,109,255,.2);color:${C.heading}}
        section[id]{scroll-margin-top:${LANDING_NAV_OFFSET}px}

        @keyframes jg-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-18px)}}
        @keyframes jg-float-card{0%,100%{transform:translateY(0) rotate(0deg)}50%{transform:translateY(-10px) rotate(0.5deg)}}
        @keyframes jg-glow-pulse{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:.75;transform:scale(1.04)}}
        @keyframes jg-pulse{0%,100%{box-shadow:0 0 0 0 rgba(182,109,255,.4);opacity:1}50%{box-shadow:0 0 0 10px rgba(182,109,255,0);opacity:.6}}
        @keyframes jg-grad-shift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
        @keyframes jg-fade-up{from{opacity:0;transform:translateY(48px)}to{opacity:1;transform:translateY(0)}}
        @keyframes jg-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}
        @keyframes jg-screen-slide{from{opacity:0;transform:translateX(20px) scale(.98)}to{opacity:1;transform:translateX(0) scale(1)}}
        @keyframes jg-spin-slow{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes jg-bar-grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
        @keyframes jg-counter-glow{0%,100%{text-shadow:0 0 30px rgba(182,109,255,0)}50%{text-shadow:0 0 30px rgba(182,109,255,.15)}}
        @keyframes jg-stagger-in{from{opacity:0;transform:translateY(30px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes jg-shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
        @keyframes jg-hero-text{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}
        @keyframes jg-orb-drift{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(30px,-20px) scale(1.08)}66%{transform:translate(-20px,15px) scale(.95)}}
        @keyframes jg-blink{50%{opacity:0}}

        .rv{opacity:0;transform:translateY(40px);transition:opacity .9s cubic-bezier(.16,1,.3,1),transform .9s cubic-bezier(.16,1,.3,1)}
        .rv.v{opacity:1;transform:translateY(0)}

        .premium-card{
          background:rgba(255,255,255,0.82);
          backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
          border:1px solid ${C.border};
          border-radius:24px;
          transition:transform .4s cubic-bezier(.16,1,.3,1),box-shadow .4s,border-color .4s
        }
        .premium-card:hover{
          transform:translateY(-6px);
          box-shadow:0 24px 64px rgba(182,109,255,.10)!important;
          border-color:rgba(182,109,255,.22)!important
        }

        .svc-card{animation:jg-stagger-in .7s cubic-bezier(.16,1,.3,1) both}
        .svc-card:nth-child(1){animation-delay:.05s}.svc-card:nth-child(2){animation-delay:.1s}.svc-card:nth-child(3){animation-delay:.15s}
        .svc-card:nth-child(4){animation-delay:.2s}.svc-card:nth-child(5){animation-delay:.25s}.svc-card:nth-child(6){animation-delay:.3s}
        .svc-card .svc-icon{transition:transform .35s cubic-bezier(.16,1,.3,1)}
        .svc-card:hover .svc-icon{transform:scale(1.12) translateY(-2px)}
        .svc-card .svc-arrow{transition:transform .3s,opacity .3s;opacity:.3}
        .svc-card:hover .svc-arrow{transform:translate(3px,-3px);opacity:.9}

        .step-card{animation:jg-stagger-in .8s cubic-bezier(.16,1,.3,1) both}
        .step-card:nth-child(1){animation-delay:.1s}.step-card:nth-child(2){animation-delay:.25s}.step-card:nth-child(3){animation-delay:.4s}

        .btn-primary{
          position:relative;overflow:hidden;
          transition:transform .25s cubic-bezier(.16,1,.3,1),box-shadow .25s
        }
        .btn-primary:hover{
          transform:translateY(-3px) scale(1.02);
          box-shadow:0 24px 56px ${C.glowViolet}!important
        }
        .btn-primary::before{content:'';position:absolute;top:0;left:-100%;width:60%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.18),transparent);transition:left .6s}
        .btn-primary:hover::before{left:150%}

        .btn-glass{
          transition:transform .25s cubic-bezier(.16,1,.3,1),box-shadow .25s,border-color .25s
        }
        .btn-glass:hover{
          transform:translateY(-2px);
          box-shadow:0 16px 40px rgba(182,109,255,.08)!important;
          border-color:rgba(182,109,255,.25)!important
        }

        .nav-link{color:${C.body};text-decoration:none;font-size:14px;font-weight:500;transition:color .25s;position:relative;display:inline-block}
        .nav-link:hover{color:${C.violet}}
        .nav-link::after{content:'';position:absolute;bottom:-4px;left:50%;width:0;height:2px;background:${C.gradViolet};border-radius:2px;transition:width .3s,left .3s}
        .nav-link:hover::after{width:100%;left:0}

        .cx{max-width:1240px;margin:0 auto;padding:0 32px}
        .sec{padding:100px 0}

        @media(max-width:960px){
          .hero-grid{grid-template-columns:1fr!important;text-align:center}
          .hero-left{align-items:center}
          .hero-badges{justify-content:center}
          .hero-btns{justify-content:center}
          .svc-grid{grid-template-columns:1fr 1fr!important}
          .how-grid{grid-template-columns:1fr!important}
          .feature-grid{grid-template-columns:1fr 1fr!important}
          .pilot-grid{grid-template-columns:1fr!important}
          .stat-grid{grid-template-columns:1fr 1fr!important}
          .foot-grid{grid-template-columns:1fr 1fr!important}
          .desk-only{display:none!important}
        }
        @media(max-width:640px){
          .svc-grid{grid-template-columns:1fr!important}
          .feature-grid{grid-template-columns:1fr!important}
          .stat-grid{grid-template-columns:1fr!important}
          .foot-grid{grid-template-columns:1fr!important}
          .sec{padding:72px 0}
        }

        .modal-overlay{
          position:fixed;inset:0;background:rgba(68,56,90,0.4);
          backdrop-filter:blur(10px);z-index:1000;
          display:flex;align-items:center;justify-content:center;padding:24px;
          opacity:0;transition:opacity .22s ease-out,backdrop-filter .22s ease-out;
          overscroll-behavior:contain;
        }
        .modal-overlay.open{opacity:1}

        .service-detail-card{
          background:#fff;border-radius:12px;width:100%;max-width:580px;
          position:relative;overflow:hidden;box-shadow:0 32px 80px rgba(182,109,255,0.25);
          opacity:0;transform:translate3d(0,24px,0) scale(.97);
          transition:transform .28s cubic-bezier(.16,1,.3,1),opacity .22s ease-out,box-shadow .28s ease-out;
          will-change:transform,opacity;
        }
        .modal-overlay.open .service-detail-card{opacity:1;transform:translate3d(0,0,0) scale(1)}
      `}</style>

      <div data-testid="landing-page" style={{ background: C.cream, color: C.body, minHeight: "100vh" }}>

        {/* ═══ NAV ═══ */}
        <nav style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 500,
          backdropFilter: scrolled ? "blur(24px) saturate(1.6)" : "blur(0px)",
          WebkitBackdropFilter: scrolled ? "blur(24px) saturate(1.6)" : "blur(0px)",
          background: scrolled ? "rgba(255,253,249,.92)" : "transparent",
          borderBottom: scrolled ? `1px solid ${C.border}` : "1px solid transparent",
          transition: "all .5s cubic-bezier(.16,1,.3,1)",
          boxShadow: scrolled ? "0 4px 30px rgba(182,109,255,.06)" : "none",
        }}>
          <div className="cx" style={{ height: 80, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Link href="/" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
              <img src="/jago-logo-new.png" alt="JAGO" style={{ height: 52, width: "auto" }} />
            </Link>
            <div className="desk-only" style={{ display: "flex", gap: 40, alignItems: "center" }}>
              {[["#services", "Services"], ["#how", "How It Works"], ["#why", "Why JAGO"], ["#earn", "Earn"], ["#download", "Download"]].map(([h, l]) => (
                <a key={h} href={h} className="nav-link" onClick={(event) => handleSectionNavigation(event, h)}>{l}</a>
              ))}
            </div>
            <a href="#download" className="btn-primary" onClick={(event) => handleSectionNavigation(event, "#download")} style={{
              padding: "12px 28px", borderRadius: 14, background: C.gradViolet, color: "#fff",
              fontSize: 14, fontWeight: 700, textDecoration: "none", fontFamily: ft,
              boxShadow: `0 8px 28px ${C.glowViolet}`,
            }}>
              Book Ride
            </a>
          </div>
        </nav>

        {/* ═══ SERVICE MODAL ═══ */}
        {selSvc && (
          <div className={`modal-overlay ${svcModalVisible ? "open" : ""}`} onClick={closeServiceModal}>
            <div className="service-detail-card" onClick={e => e.stopPropagation()} style={{ border: `1px solid ${C.border}` }}>
              <button onClick={closeServiceModal} style={{ position: "absolute", top: 20, right: 20, background: "#f8effc", border: "none", width: 36, height: 36, borderRadius: 4, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: C.violet, zIndex: 10 }}>×</button>
              
              <div style={{ padding: "40px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 28 }}>
                  <div style={{ width: 70, height: 70, borderRadius: 8, background: selSvc.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, boxShadow: `0 8px 24px ${selSvc.c}15`, border: `1px solid ${selSvc.c}15` }}>
                    {selSvc.e}
                  </div>
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 800, color: selSvc.c, textTransform: "uppercase", letterSpacing: 1.5, background: `${selSvc.c}10`, padding: "3px 10px", borderRadius: 4, marginBottom: 6, display: "inline-block" }}>{selSvc.tag}</span>
                    <h2 style={{ fontSize: 28, fontWeight: 900, color: C.heading, margin: 0, fontFamily: ft, letterSpacing: -0.5 }}>{selSvc.t}</h2>
                  </div>
                </div>

                <div style={{ marginBottom: 28 }}>
                  <p style={{ fontSize: 16, color: C.body, lineHeight: 1.7, marginBottom: 20 }}>
                    {selSvc.longD || selSvc.d}
                  </p>
                  <div style={{ background: "#f8effc44", borderRadius: 8, padding: "20px 24px", border: `1px solid ${C.border}` }}>
                    <h4 style={{ fontSize: 13, fontWeight: 800, color: C.heading, marginBottom: 14, textTransform: "uppercase", letterSpacing: 1 }}>Premium Features</h4>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      {["Safety Shield", "No Surge Fee", "Eco Friendly", "Live GPS", "Top Tech", "Verified Pilots"].map(f => (
                        <div key={f} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.body }}>
                          <div style={{ width: 6, height: 6, borderRadius: 1.5, background: "#4ade80" }} /> {f}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                   <p style={{ textAlign: "center", fontSize: 11, color: C.bodyLight, margin: 0, fontWeight: 700, letterSpacing: 0.5 }}>READY TO MOVE BETTER?</p>
                   <a href="#download" className="btn-primary" onClick={(event) => closeServiceModalAndNavigate(event, "#download")} style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
                      background: C.gradViolet, color: "#fff", padding: "18px", borderRadius: 8,
                      textDecoration: "none", fontFamily: ft, fontWeight: 800, fontSize: 16,
                      boxShadow: `0 12px 32px ${C.glowViolet}`
                   }}>
                      Download JAGO App
                   </a>
                   <div style={{ display: "flex", justifyContent: "center", gap: 20, opacity: 0.5 }}>
                      <span style={{ fontSize: 11 }}> App Store</span>
                      <span style={{ fontSize: 11 }}>▶ Play Store</span>
                   </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ HERO ═══ */}
        <section data-testid="hero-section" style={{ minHeight: "100vh", display: "flex", alignItems: "center", position: "relative", overflow: "hidden", paddingTop: 80 }}>
          {/* Background */}
          <div style={{ position: "absolute", inset: 0, background: C.gradHero, zIndex: 0 }} />
          {/* Orbs */}
          <div style={{ position: "absolute", top: "0%", right: "-5%", width: 700, height: 700, borderRadius: "50%", background: "radial-gradient(circle, rgba(182,109,255,.08) 0%, transparent 55%)", animation: "jg-orb-drift 20s ease-in-out infinite", pointerEvents: "none" }} />
          <div style={{ position: "absolute", bottom: "-10%", left: "-8%", width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,200,239,.10) 0%, transparent 55%)", animation: "jg-orb-drift 25s ease-in-out infinite reverse", pointerEvents: "none" }} />
          <div style={{ position: "absolute", top: "40%", left: "30%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(238,247,255,.15) 0%, transparent 55%)", animation: "jg-orb-drift 18s ease-in-out infinite 3s", pointerEvents: "none" }} />
          {/* Subtle grid */}
          <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(182,109,255,.03) 1px, transparent 1px), linear-gradient(90deg, rgba(182,109,255,.03) 1px, transparent 1px)", backgroundSize: "80px 80px", pointerEvents: "none" }} />

          <div className="cx hero-grid" style={{ width: "100%", display: "grid", gridTemplateColumns: "1.15fr 0.85fr", gap: 56, alignItems: "center", padding: "88px 32px 120px", position: "relative", zIndex: 2 }}>
            {/* LEFT */}
            <div className="hero-left" style={{ display: "flex", flexDirection: "column", animation: "jg-fade-up 1.1s cubic-bezier(.16,1,.3,1) forwards" }}>
              {/* Live badge */}
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(182,109,255,.06)", border: `1px solid rgba(182,109,255,.14)`, borderRadius: 40, padding: "8px 22px 8px 14px", marginBottom: 36, backdropFilter: "blur(12px)", alignSelf: "flex-start" }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#4ade80", animation: "jg-pulse 1.8s infinite" }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: C.violet, fontFamily: ft }}>🚀 India's Premium Mobility Super App</span>
              </div>

              {/* Heading */}
              <h1 style={{ fontSize: "clamp(32px, 4.5vw, 54px)", fontWeight: 900, lineHeight: 1.1, marginBottom: 20, fontFamily: ft, letterSpacing: -2.5 }}>
                <span style={{ color: C.heading, display: "block", animation: "jg-hero-text .8s cubic-bezier(.16,1,.3,1) forwards", animationDelay: ".1s", opacity: 0 }}>Move Smarter.</span>
                <span style={{ display: "block", animation: "jg-hero-text .8s cubic-bezier(.16,1,.3,1) forwards", animationDelay: ".3s", opacity: 0 }}>
                  <span style={{ background: C.gradText, backgroundSize: "300% auto", backgroundClip: "text", WebkitBackgroundClip: "text", color: "transparent", animation: "jg-grad-shift 5s ease-in-out infinite" }}>Ride Better.</span>
                </span>
                <span style={{ color: C.heading, display: "block", animation: "jg-hero-text .8s cubic-bezier(.16,1,.3,1) forwards", animationDelay: ".5s", opacity: 0 }}>
                  Live <span style={{ color: C.violet }}>{typeText}</span>
                  <span style={{ borderRight: `3px solid ${C.violet}`, marginLeft: 2, animation: "jg-blink .8s step-end infinite" }} />
                </span>
              </h1>

              <p style={{ fontSize: 17, color: C.body, lineHeight: 1.75, maxWidth: 500, marginBottom: 36, fontWeight: 400, letterSpacing: -.2, animation: "jg-hero-text .8s cubic-bezier(.16,1,.3,1) forwards", animationDelay: ".65s", opacity: 0 }}>
                India's premium ride-booking super app for bike taxi, auto, cab, rentals, parcel delivery, and pilot earnings.
              </p>

              {/* CTA Buttons */}
              <div className="hero-btns" style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 40, animation: "jg-hero-text .8s cubic-bezier(.16,1,.3,1) forwards", animationDelay: ".8s", opacity: 0 }}>
                <a href="#download" data-testid="btn-book-ride-primary" className="btn-primary" onClick={(event) => handleSectionNavigation(event, "#download")} style={{
                  display: "inline-flex", alignItems: "center", gap: 10,
                  background: C.gradViolet, color: "#fff",
                  padding: "18px 40px", borderRadius: 18, textDecoration: "none",
                  fontFamily: ft, fontWeight: 800, fontSize: 16,
                  boxShadow: `0 16px 48px ${C.glowViolet}`,
                }}>
                  Book Ride Now
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                </a>
                <a href="/auth" className="btn-glass" style={{
                  display: "inline-flex", alignItems: "center", gap: 10,
                  background: "rgba(255,255,255,.65)", border: `1.5px solid ${C.border}`,
                  backdropFilter: "blur(12px)", color: C.violet,
                  padding: "18px 36px", borderRadius: 18, textDecoration: "none",
                  fontFamily: ft, fontWeight: 700, fontSize: 16,
                }}>
                  Become Pilot
                </a>
              </div>

              {/* Trust badges */}
              <div className="hero-badges" style={{ display: "flex", gap: 44, flexWrap: "wrap", animation: "jg-hero-text .8s cubic-bezier(.16,1,.3,1) forwards", animationDelay: ".95s", opacity: 0 }}>
                {[{ v: "500K+", l: "Trusted Riders" }, { v: "20K+", l: "Active Pilots" }, { v: "50+", l: "Indian Cities" }].map((s, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 14 }}>⭐</span>
                    <div>
                      <p style={{ fontSize: 22, fontWeight: 900, color: C.heading, margin: 0, fontFamily: ft, lineHeight: 1 }}>{s.v}</p>
                      <p style={{ fontSize: 11, color: C.bodyLight, margin: "2px 0 0", fontFamily: ft, letterSpacing: .5 }}>{s.l}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* RIGHT */}
            <div style={{ display: "flex", justifyContent: "center" }}>
              <FloatingPhone />
            </div>
          </div>

          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 120, background: `linear-gradient(transparent, ${C.cream})`, pointerEvents: "none", zIndex: 3 }} />
        </section>

        <Marquee />

        {/* ═══ SERVICES — BENTO GRID ═══ */}
        <section id="services" className="sec" style={{ background: C.cream }}>
          <div className="cx">
            <div ref={rSvc.ref} className={`rv${rSvc.vis ? " v" : ""}`}>
              <SecHead tag="Our Services" title={<>Every ride, <GradWord>every need.</GradWord></>} sub="From city hops to long-distance hauls — JAGO handles it all with premium quality." />
              <div className="svc-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
                {[
                  { e: "🏍️", t: "Bike Taxi", d: "Fastest through city traffic. Beat the rush every day.", longD: "Skip the gridlock with JAGO Bike Taxis. Our verified pilots are trained to navigate city traffic efficiently and safely, getting you to your destination 50% faster than cars.", tag: "Popular", bg: "linear-gradient(140deg, #f8effc 0%, #ffe8f7 100%)", c: "#b66dff" },
                  { e: "🛺", t: "Auto Ride", d: "Comfortable CNG auto rides at fair prices.", longD: "The classic city commute, upgraded. Enjoy reliable, eco-friendly auto rides with transparent pricing and zero haggling. Perfect for short bursts across the neighborhood.", tag: "Eco", bg: "linear-gradient(140deg, #eef7ff 0%, #f8effc 100%)", c: "#7c8cf5" },
                  { e: "🚗", t: "Cab Ride", d: "AC cabs for business trips & family outings.", longD: "Experience premium comfort in our air-conditioned cabs. Ideal for business meetings, airport runs, or family weekend trips. Luxury mobility at an affordable price point.", tag: "Premium", bg: "linear-gradient(140deg, #fffdf9 0%, #ffc8ef22 100%)", c: "#e77dc4" },
                  { e: "📦", t: "Parcel Delivery", d: "Same-day door to door delivery across city.", longD: "Send items across the city instantly. From forgotten keys to business documents, our hyper-local delivery network ensures your parcels arrive safely in under 60 minutes.", tag: "Express", bg: "linear-gradient(140deg, #eef7ff 0%, #e8fff4 100%)", c: "#4ade80" },
                  { e: "🔄", t: "Rentals", d: "Hourly & daily vehicle rentals for every need.", longD: "Keep the ride as long as you need. With JAGO Rentals, you can book vehicles by the hour or day, perfect for shopping trips or multiple stops around the city.", tag: "Flexible", bg: "linear-gradient(140deg, #eef7ff 0%, #f0edff 100%)", c: "#60a5fa" },
                  { e: "🛣️", t: "Outstation", d: "Transparent long-distance rides with zero surge.", longD: "Plan your weekend getaway with confidence. Our outstation service offers fixed rates, expert drivers, and well-maintained vehicles for a stress-free travel experience.", tag: "Long-haul", bg: "linear-gradient(140deg, #fffdf9 0%, #fff3e0 100%)", c: "#f59e0b" },
                ].map((s, i) => (
                  <div key={i} onClick={() => openServiceModal(s)} className="premium-card svc-card" style={{ padding: 0, overflow: "hidden", cursor: "pointer", position: "relative" }}>
                    {/* Gradient left edge */}
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: `linear-gradient(180deg, ${s.c}, transparent)`, borderRadius: "24px 0 0 24px" }} />
                    <div style={{ padding: "24px 24px", display: "flex", alignItems: "center", gap: 18, background: s.bg }}>
                      <div className="svc-icon" style={{
                        width: 56, height: 56, borderRadius: 16,
                        background: `${s.c}10`, border: `1px solid ${s.c}18`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 28, flexShrink: 0,
                        filter: `drop-shadow(0 2px 8px ${s.c}20)`,
                      }}>{s.e}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <h3 style={{ fontSize: 16, fontWeight: 800, color: C.heading, fontFamily: ft, margin: 0, letterSpacing: -.3 }}>{s.t}</h3>
                          <span style={{ fontSize: 9, fontWeight: 700, color: s.c, textTransform: "uppercase", letterSpacing: 1.2, background: `${s.c}10`, border: `1px solid ${s.c}20`, borderRadius: 20, padding: "2px 10px", fontFamily: ft }}>{s.tag}</span>
                        </div>
                        <p style={{ fontSize: 13, color: C.body, lineHeight: 1.5, margin: 0 }}>{s.d}</p>
                      </div>
                      <svg className="svc-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={s.c} strokeWidth="2.5" strokeLinecap="round"><path d="M7 17l9.2-9.2M17 17V7.8H7.8" /></svg>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ═══ HOW IT WORKS ═══ */}
        <section id="how" className="sec" style={{ background: C.sectionAlt, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(182,109,255,.05) 0%, transparent 55%)", pointerEvents: "none" }} />
          <div className="cx" style={{ position: "relative", zIndex: 2 }}>
            <div ref={rHow.ref} className={`rv${rHow.vis ? " v" : ""}`}>
              <SecHead tag="How It Works" title={<>Ride in <GradWord>3 simple steps</GradWord></>} sub="From booking to destination — fast, safe, effortless." />
              <div className="how-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20, position: "relative" }}>
                {/* Connecting line */}
                <div className="desk-only" style={{ position: "absolute", top: 48, left: "17%", right: "17%", height: 2, overflow: "hidden", zIndex: 0 }}>
                  <div style={{ width: rHow.vis ? "100%" : "0%", height: "100%", background: `linear-gradient(90deg, ${C.violet}40, ${C.roseGlow}40, ${C.softPurple}40)`, transition: "width 1.5s cubic-bezier(.16,1,.3,1) .3s", borderRadius: 2 }} />
                </div>
                {/* Connector dots */}
                {[33, 66].map((pos, di) => (
                  <div key={di} className="desk-only" style={{
                    position: "absolute", top: 44, left: `${pos}%`, width: 10, height: 10, borderRadius: "50%",
                    background: di === 0 ? C.violet : C.roseGlow,
                    border: `2px solid ${C.sectionAlt}`, zIndex: 1,
                    opacity: rHow.vis ? 1 : 0,
                    transform: rHow.vis ? "scale(1)" : "scale(0)",
                    transition: `all .5s cubic-bezier(.16,1,.3,1) ${.6 + di * .3}s`,
                    boxShadow: `0 0 12px ${di === 0 ? C.glowViolet : C.glowRose}`,
                  }} />
                ))}
                {[
                  { n: "01", ic: "📍", t: "Choose destination", d: "Type where you want to go. Instant fare estimates, zero surprises.", c: C.violet },
                  { n: "02", ic: "⚡", t: "Match in seconds", d: "Verified pilot accepts in under 60 seconds. Track arrival live.", c: "#e77dc4" },
                  { n: "03", ic: "🎉", t: "Ride stress-free", d: "Confirm OTP, enjoy the ride. Pay via UPI, card, or wallet.", c: C.softPurple },
                ].map((s, i) => (
                  <div key={i} className="premium-card step-card" style={{ padding: "32px 28px", position: "relative", overflow: "hidden", zIndex: 2 }}>
                    <div style={{ position: "absolute", top: 14, right: 18, fontSize: 60, fontWeight: 900, color: `${s.c}08`, fontFamily: ft, lineHeight: 1, pointerEvents: "none" }}>{s.n}</div>
                    <div style={{
                      width: 56, height: 56, borderRadius: 18,
                      background: `${s.c}0c`, border: `1px solid ${s.c}15`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      marginBottom: 20, fontSize: 26, position: "relative",
                    }}>
                      {s.ic}
                      <div style={{ position: "absolute", inset: -3, borderRadius: 21, border: `1px solid ${s.c}0a`, animation: "jg-pulse 3s infinite" }} />
                    </div>
                    <h3 style={{ fontSize: 18, fontWeight: 800, color: C.heading, fontFamily: ft, marginBottom: 8, letterSpacing: -.3 }}>{s.t}</h3>
                    <p style={{ fontSize: 14, color: C.body, lineHeight: 1.7 }}>{s.d}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ═══ WHY JAGO ═══ */}
        <section id="why" className="sec" style={{ background: C.cream }}>
          <div className="cx">
            <div ref={rWhy.ref} className={`rv${rWhy.vis ? " v" : ""}`}>
              <SecHead tag="Why JAGO" title={<>Built different, <GradWord>built better.</GradWord></>} sub="Everything you need for safe, affordable, and lightning-fast rides." />
              <div className="feature-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
                {[
                  { ic: "⚡", t: "60 sec booking", d: "Matched with a verified pilot in under a minute.", c: C.violet },
                  { ic: "📡", t: "Live GPS tracking", d: "Real-time GPS with family share link.", c: "#e77dc4" },
                  { ic: "🛡️", t: "Verified pilots", d: "Background-checked, KYC verified, trained.", c: "#4ade80" },
                  { ic: "💰", t: "Lowest pricing", d: "No surge. Transparent billing, always.", c: "#f59e0b" },
                  { ic: "🚨", t: "Emergency support", d: "SOS button, ride sharing, 24/7 monitoring.", c: "#ef4444" },
                  { ic: "💎", t: "Wallet cashback", d: "Earn JAGO coins on every ride. Redeem for rewards.", c: C.violet },
                  { ic: "⭐", t: "Ratings system", d: "Highest rated ride app in South India.", c: "#f59e0b" },
                  { ic: "🎧", t: "24/7 help", d: "Round the clock via chat, call, and email.", c: "#60a5fa" },
                ].map((w, i) => (
                  <div key={i} className="premium-card" style={{ padding: "28px 24px", position: "relative", overflow: "hidden" }}>
                    <div style={{
                      width: 54, height: 54, borderRadius: 16,
                      background: `${w.c}0c`, border: `1px solid ${w.c}15`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      marginBottom: 18, fontSize: 26,
                    }}>{w.ic}</div>
                    <h4 style={{ fontSize: 16, fontWeight: 800, color: C.heading, fontFamily: ft, marginBottom: 6, letterSpacing: -.3 }}>{w.t}</h4>
                    <p style={{ fontSize: 13, color: C.body, lineHeight: 1.7 }}>{w.d}</p>
                    <div style={{ position: "absolute", bottom: -8, right: -8, width: 50, height: 50, borderRadius: "50%", background: `${w.c}06`, filter: "blur(20px)", pointerEvents: "none" }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ═══ PILOT EARNINGS ═══ */}
        <section id="earn" className="sec" style={{ background: C.sectionAlt, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, backgroundImage: `radial-gradient(circle at 80% 50%, rgba(182,109,255,.06) 0%, transparent 45%)`, pointerEvents: "none" }} />
          <div className="cx" style={{ position: "relative", zIndex: 2 }}>
            <div ref={rPilot.ref} className={`rv${rPilot.vis ? " v" : ""}`}>
              <div className="pilot-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "center" }}>
                <div>
                  <SecHead tag="Pilot Earnings" title={<>Earn More. <span style={{ color: C.violet }}>Drive Smart.</span></>} sub="Daily payouts, bonuses, zero commission launch benefits. JAGO pilots earn industry-leading pay." align="left" />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 40 }}>
                    {[
                      { v: "₹2,500+", l: "Daily earnings", c: C.violet },
                      { v: "0%", l: "Commission · 90 days", c: "#e77dc4" },
                      { v: "Instant", l: "Daily payouts", c: C.softPurple },
                      { v: "₹8/L", l: "Fuel savings", c: "#4ade80" },
                    ].map((e, i) => (
                      <div key={i} style={{ background: C.white, borderRadius: 20, padding: "24px 18px", border: `1px solid ${C.border}`, boxShadow: "0 4px 20px rgba(182,109,255,.04)" }}>
                        <p style={{ fontSize: 30, fontWeight: 900, color: e.c, fontFamily: ft, margin: "0 0 4px", lineHeight: 1 }}>{e.v}</p>
                        <p style={{ fontSize: 12, color: C.body, margin: 0 }}>{e.l}</p>
                      </div>
                    ))}
                  </div>
                  <a href="/auth" className="btn-primary" style={{
                    display: "inline-flex", alignItems: "center", gap: 10, padding: "16px 36px", borderRadius: 16,
                    background: C.gradViolet, color: "#fff", textDecoration: "none", fontSize: 15,
                    fontWeight: 800, fontFamily: ft, boxShadow: `0 10px 36px ${C.glowViolet}`,
                  }}>
                    Become a Pilot <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                  </a>
                </div>

                {/* Dashboard */}
                <div className="premium-card" style={{ padding: "40px", position: "relative", overflow: "hidden", background: C.white, boxShadow: "0 20px 60px rgba(182,109,255,.08)" }}>
                  <div style={{ marginBottom: 30 }}>
                    <p style={{ fontSize: 12, color: C.bodyLight, margin: "0 0 6px", fontFamily: ft, textTransform: "uppercase", letterSpacing: 2 }}>This Week's Earnings</p>
                    <p style={{ fontSize: 52, fontWeight: 900, color: C.heading, fontFamily: ft, margin: 0, lineHeight: 1, letterSpacing: -2 }}>₹17,500</p>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 10, background: "rgba(74,222,128,.08)", borderRadius: 20, padding: "4px 14px" }}>
                      <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 700 }}>↑ 12%</span>
                      <span style={{ fontSize: 10, color: C.bodyLight }}>vs last week</span>
                    </div>
                  </div>
                  {/* Chart */}
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 130, marginBottom: 28 }}>
                    {[60, 78, 42, 88, 65, 95, 82].map((h, i) => (
                      <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                        <div style={{
                          width: "100%", height: `${h}%`, borderRadius: 8,
                          background: i === 5 ? C.gradViolet : "rgba(182,109,255,.10)",
                          border: i === 5 ? "none" : `1px solid rgba(182,109,255,.06)`,
                          animation: rPilot.vis ? `jg-bar-grow .7s cubic-bezier(.16,1,.3,1) forwards` : "none",
                          animationDelay: `${i * .08}s`, transformOrigin: "bottom",
                        }} />
                        <span style={{ fontSize: 9, color: C.bodyLight, fontFamily: ft, fontWeight: 600 }}>{["M", "T", "W", "T", "F", "S", "S"][i]}</span>
                      </div>
                    ))}
                  </div>
                  {/* Mini stats */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    {[{ v: "42", l: "Rides", ic: "🏍️" }, { v: "₹417", l: "Per ride", ic: "💰" }, { v: "4.9", l: "Rating", ic: "⭐" }].map((s, i) => (
                      <div key={i} style={{ background: C.lavender, borderRadius: 14, padding: "14px 12px", textAlign: "center", border: `1px solid ${C.border}` }}>
                        <span style={{ fontSize: 18, display: "block", marginBottom: 4 }}>{s.ic}</span>
                        <p style={{ fontSize: 20, fontWeight: 900, color: C.heading, fontFamily: ft, margin: "2px 0" }}>{s.v}</p>
                        <p style={{ fontSize: 10, color: C.bodyLight, margin: 0 }}>{s.l}</p>
                      </div>
                    ))}
                  </div>
                  {/* Decorative ring */}
                  <div style={{ position: "absolute", top: -35, right: -35, width: 110, height: 110, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.softPurple, animation: "jg-spin-slow 10s linear infinite", pointerEvents: "none", opacity: .3 }} />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ STATS ═══ */}
        <section className="sec" style={{ background: C.cream, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(182,109,255,.02) 1px, transparent 1px), linear-gradient(90deg, rgba(182,109,255,.02) 1px, transparent 1px)", backgroundSize: "64px 64px", pointerEvents: "none" }} />
          <div className="cx" style={{ position: "relative", zIndex: 2 }}>
            <div ref={rStats.ref} className={`rv${rStats.vis ? " v" : ""}`}>
              <SecHead tag="By The Numbers" title={<>Numbers that <GradWord>speak volumes</GradWord></>} sub="Real performance. Real trust. Growing every day." />
              <div className="stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 18 }}>
                {[
                  { r: cRides.ref, v: `${(cRides.val / 1000).toFixed(0)}K+`, l: "Completed Rides", ic: "🚀", c: C.violet, bg: "rgba(124, 58, 237, 0.04)" },
                  { r: cCities.ref, v: `${cCities.val}+`, l: "Active Cities", ic: "🌍", c: "#e77dc4", bg: "rgba(231, 125, 196, 0.04)" },
                  { r: cPilots.ref, v: `${(cPilots.val / 1000).toFixed(0)}K+`, l: "Verified Pilots", ic: "🏍️", c: C.softPurple, bg: "rgba(182, 109, 255, 0.04)" },
                  { r: cRating.ref, v: `${(cRating.val / 10).toFixed(1)}★`, l: "User Rating", ic: "⭐", c: "#f59e0b", bg: "rgba(245, 158, 11, 0.04)" },
                ].map((s, i) => (
                  <div key={i} ref={s.r} className="premium-card" style={{ 
                    textAlign: "center", padding: "40px 24px", position: "relative", overflow: "hidden",
                    border: "1px solid rgba(182,109,255,0.06)",
                    background: `linear-gradient(135deg, ${C.white} 0%, ${s.bg} 100%)`,
                    display: "flex", flexDirection: "column", alignItems: "center"
                  }}>
                    {/* Background Grid Accent */}
                    <div style={{ position: "absolute", inset: 0, opacity: 0.03, backgroundImage: "radial-gradient(#000 0.5px, transparent 0.5px)", backgroundSize: "10px 10px", pointerEvents: "none" }} />
                    
                    <div style={{
                      width: 60, height: 60, borderRadius: 16,
                      background: `${s.c}10`, border: `1px solid ${s.c}15`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      marginBottom: 16, fontSize: 32,
                      boxShadow: `0 0 30px ${s.c}05`,
                      position: "relative", zIndex: 2
                    }}>{s.ic}</div>
                    
                    <p style={{ 
                      fontSize: 44, fontWeight: 900, color: C.heading, margin: "0 0 6px", 
                      fontFamily: ft, lineHeight: 1, letterSpacing: -1.5, 
                      position: "relative", zIndex: 2,
                    }}>{s.v}</p>
                    
                    <p style={{ 
                      fontSize: 12, color: C.body, fontFamily: ft, fontWeight: 700, 
                      letterSpacing: 0.8, textTransform: "uppercase", opacity: 0.5,
                      position: "relative", zIndex: 2
                    }}>{s.l}</p>
                    
                    {/* Bottom Glow */}
                    <div style={{ position: "absolute", bottom: -15, left: "50%", transform: "translateX(-50%)", width: 100, height: 50, borderRadius: "50%", background: `${s.c}10`, filter: "blur(25px)", pointerEvents: "none", zIndex: 1 }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ═══ TESTIMONIALS ═══ */}
        <section className="sec" style={{ background: C.sectionAlt }}>
          <div className="cx">
            <div ref={rTest.ref} className={`rv${rTest.vis ? " v" : ""}`}>
              <SecHead tag="Social Proof" title={<>Loved by <GradWord>thousands</GradWord></>} sub="Don't just take our word for it. Hear from real riders." />
              <TestimonialSlider />
            </div>
          </div>
        </section>

        {/* ═══ APP DOWNLOAD CTA ═══ */}
        <section id="download" data-testid="download-section" className="sec" style={{ background: C.cream, position: "relative" }}>
          <div className="cx">
            <div ref={rCta.ref} className={`rv${rCta.vis ? " v" : ""}`}>
              <div style={{
                borderRadius: 40, padding: "0",
                background: `linear-gradient(135deg, #7c3aed 0%, #b66dff 45%, #f0f7ff 100%)`,
                position: "relative", overflow: "hidden",
                boxShadow: "0 40px 100px rgba(182,109,255,.25)",
                display: "flex", flexWrap: "wrap",
              }}>
                {/* Visual Blending Overlays */}
                <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 100% 50%, rgba(255,255,255,0.4) 0%, transparent 60%)", zIndex: 1, pointerEvents: "none" }} />
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(124,58,237,0.2) 0%, transparent 50%)", zIndex: 1, pointerEvents: "none" }} />

                <div className="hero-grid" style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", alignItems: "center" }}>
                  {/* TEXT CONTENT */}
                  <div style={{ padding: "80px 64px", position: "relative", zIndex: 5 }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)", padding: "8px 20px", borderRadius: 40, marginBottom: 28, border: "1px solid rgba(255,255,255,0.2)" }}>
                      <span style={{ fontSize: 18 }}>🎁</span>
                      <span style={{ color: "#fff", fontWeight: 700, fontSize: 13, letterSpacing: 1 }}>FESTIVE OFFER ACTIVE</span>
                    </div>

                    <h2 style={{ fontSize: "clamp(34px, 5.5vw, 58px)", fontWeight: 900, color: "#fff", fontFamily: ft, letterSpacing: -2.5, lineHeight: 1.1, marginBottom: 20 }}>
                      Ready to Ride <span style={{ color: "#fcd34d" }}>Better?</span><br />
                      <span style={{ fontSize: "0.55em", fontWeight: 600, opacity: 0.9, display: "block", marginTop: 8, letterSpacing: 0 }}>Experience India's most modern mobility.</span>
                    </h2>

                    <div style={{ 
                        background: "rgba(255,255,255,0.12)", 
                        border: "1px dashed rgba(255,255,255,0.3)", 
                        borderRadius: 20, padding: "24px", marginBottom: 36, 
                        maxWidth: 480, backdropFilter: "blur(20px)",
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        position: "relative",
                        boxShadow: "0 20px 40px rgba(0,0,0,0.1)"
                    }}>
                      {/* Coupon Notches */}
                      <div style={{ position: "absolute", top: "50%", left: -10, width: 20, height: 20, borderRadius: "50%", background: "#b66dff", transform: "translateY(-50%)" }} />
                      <div style={{ position: "absolute", top: "50%", right: -10, width: 20, height: 20, borderRadius: "50%", background: "#f0f7ff", transform: "translateY(-50%)" }} />
                      
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: "0 0 6px", fontSize: 10, color: "rgba(255,255,255,0.7)", fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase" }}>Limited Time Offer</p>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                           <span style={{ fontSize: 28, fontWeight: 900, color: "#fff", fontFamily: ft, letterSpacing: 2 }}>JAGOPRO50</span>
                           <span style={{ fontSize: 11, color: "#fff", fontWeight: 700, background: "#4ade80", padding: "3px 10px", borderRadius: 4 }}>ACTIVATE</span>
                        </div>
                      </div>
                      <div style={{ height: 60, width: 1, borderLeft: "2px dashed rgba(255,255,255,0.2)", margin: "0 24px" }} />
                      <div style={{ textAlign: "right" }}>
                        <p style={{ margin: 0, fontSize: 32, fontWeight: 900, color: "#fcd34d" }}>₹50</p>
                        <p style={{ margin: 0, fontSize: 12, color: "#fff", fontWeight: 600 }}>CASHBACK</p>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 32 }}>
                      {[
                        { l: "Customer App", ic: "📱", desc: "For daily commuters", c: "#fff", bg: "rgba(255,255,255,1)", testId: "download-cta-customer-app" },
                        { l: "Driver App", ic: "🏍️", desc: "Start earning today", c: "#fff", bg: "rgba(255,255,255,0.15)", glass: true, testId: "download-cta-driver-app" },
                        { l: "Become Pilot", ic: "🚀", desc: "Join our elite team", c: "#fff", bg: "rgba(255,255,255,0.15)", glass: true },
                      ].map(d => (
                        <button key={d.l} data-testid={d.testId} type="button" className="btn-primary" onClick={(event) => handleSectionNavigation(event, "#download")} style={{
                          display: "flex", alignItems: "center", gap: 14,
                          background: d.bg, color: d.glass ? "#fff" : C.heading,
                          padding: "14px 24px", borderRadius: 20, textDecoration: "none",
                          fontSize: 14, fontWeight: 800, fontFamily: ft,
                          border: d.glass ? "1px solid rgba(255,255,255,0.3)" : "none",
                          backdropFilter: d.glass ? "blur(12px)" : "none",
                          boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
                          cursor: "pointer",
                        }}>
                          <span style={{ fontSize: 20 }}>{d.ic}</span>
                          <div style={{ textAlign: "left" }}>
                             <p style={{ margin: 0, fontSize: 13 }}>{d.l}</p>
                             <p style={{ margin: 0, fontSize: 9, opacity: 0.7 }}>{d.desc}</p>
                          </div>
                        </button>
                      ))}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                      <div style={{ display: "flex", gap: 4 }}>
                         {[...Array(5)].map((_, j) => <span key={j} style={{ fontSize: 16, color: "#fcd34d" }}>★</span>)}
                      </div>
                      <span style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", fontWeight: 600 }}>4.9/5 Rating · 50K+ Active Users</span>
                    </div>
                  </div>

                  {/* IMAGE CONTENT */}
                  <div className="desk-only" style={{ height: "100%", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at center, rgba(182,109,255,0.4) 0%, transparent 70%)", zIndex: 1 }} />
                    
                    {/* Floating Cards */}
                    <div style={{ position: "absolute", top: "20%", right: "10%", background: "rgba(255,255,255,0.9)", backdropFilter: "blur(12px)", padding: "12px 20px", borderRadius: 16, zIndex: 10, border: "1px solid rgba(255,255,255,0.4)", boxShadow: "0 20px 40px rgba(0,0,0,0.1)", animation: "jg-float 4s ease-in-out infinite" }}>
                       <p style={{ margin: 0, fontSize: 10, color: C.bodyLight, fontWeight: 700, textTransform: "uppercase" }}>Earnings Dist.</p>
                       <p style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 900, color: C.violet }}>₹2.5 Cr+</p>
                    </div>

                    <div style={{ position: "absolute", bottom: "15%", left: "5%", background: "rgba(255,255,255,0.9)", backdropFilter: "blur(12px)", padding: "12px 20px", borderRadius: 16, zIndex: 10, border: "1px solid rgba(255,255,255,0.4)", boxShadow: "0 20px 40px rgba(0,0,0,0.1)", animation: "jg-float 6s ease-in-out infinite 1s" }}>
                       <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 20 }}>🛡️</span>
                          <div>
                             <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: C.heading }}>100% Safe</p>
                             <p style={{ margin: 0, fontSize: 9, color: C.body }}>Verified Pilots</p>
                          </div>
                       </div>
                    </div>

                    <img src="/jago_hero_3d.jpg" alt="JAGO App Mockup" style={{
                      width: "120%", height: "100%", objectFit: "cover", position: "relative", zIndex: 2,
                      transform: "scale(1.05)",
                      filter: "drop-shadow(0 40px 100px rgba(0,0,0,0.2))",
                    }} />

                    {/* Live Match Bubble - Adjusted position for new image */}
                    <div style={{ position: "absolute", bottom: "10%", right: "120%", background: "#fff", borderRadius: 40, padding: "10px 20px", zIndex: 20, display: "flex", alignItems: "center", gap: 10, boxShadow: "0 10px 40px rgba(0,0,0,0.15)", border: "1px solid rgba(182,109,255,0.3)", animation: "jg-float 3.4s infinite", whiteSpace: "nowrap" }}>
                       <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#4ade80", animation: "jg-pulse 1.5s infinite" }} />
                       <span style={{ fontSize: 13, fontWeight: 800, color: C.heading }}>Pilot Matched!</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ═══ FOOTER ═══ */}
        <footer style={{ background: C.white, borderTop: `1px solid ${C.border}`, padding: "72px 0 36px" }}>
          <div className="cx">
            <div className="foot-grid" style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1fr", gap: 48, marginBottom: 56 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
                  <img src="/jago-logo-new.png" alt="JAGO" style={{ height: 44, width: "auto" }} />
                </div>
                <p style={{ fontSize: 14, color: C.body, lineHeight: 1.7, maxWidth: 300 }}>India's smart ride-hailing platform. Book bike taxi, auto, cab, parcel delivery and more. Instantly.</p>
                <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                  {["𝕏", "in", "IG", "YT"].map(s => (
                    <div key={s} style={{
                      width: 38, height: 38, borderRadius: 10,
                      background: C.lavender, border: `1px solid ${C.border}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", transition: "all .3s", fontSize: 12, fontWeight: 700, color: C.body,
                    }}
                      onMouseOver={e => { (e.currentTarget as HTMLElement).style.background = C.violet; (e.currentTarget as HTMLElement).style.color = "#fff"; }}
                      onMouseOut={e => { (e.currentTarget as HTMLElement).style.background = C.lavender; (e.currentTarget as HTMLElement).style.color = C.body; }}
                    >
                      {s}
                    </div>
                  ))}
                </div>
              </div>
              {[
                { t: "Company", links: [["About Us", "/about-us"], ["Contact", "/contact-us"], ["Careers", "#"], ["Blog", "#"]] },
                { t: "Legal", links: [["Privacy Policy", "/privacy"], ["Terms of Service", "/terms"], ["Refund Policy", "/refund-policy"], ["Cookie Policy", "/cookie-policy"]] },
                { t: "Support", links: [["Help Center", "#"], ["Safety", "#"], ["FAQs", "#"], ["Partner Hub", "#"]] },
              ].map(col => (
                <div key={col.t}>
                  <h4 style={{ fontSize: 12, fontWeight: 700, color: C.bodyLight, textTransform: "uppercase", letterSpacing: 2, marginBottom: 20, fontFamily: ft }}>{col.t}</h4>
                  {col.links.map(([l, h]) =>
                    h.startsWith("/") ? (
                      <Link key={l} href={h} style={{ display: "block", fontSize: 14, color: C.body, textDecoration: "none", marginBottom: 14, transition: "color .2s", fontFamily: ft }}
                      onMouseOver={e => ((e.target as HTMLElement).style.color = C.violet)}
                      onMouseOut={e => ((e.target as HTMLElement).style.color = C.body)}
                      >{l}</Link>
                    ) : (
                      <button key={l} type="button" onClick={handlePlaceholderClick} style={{ display: "block", fontSize: 14, color: C.body, textDecoration: "none", marginBottom: 14, transition: "color .2s", fontFamily: ft, background: "none", border: "none", padding: 0, cursor: "default", textAlign: "left" }}
                        onMouseOver={e => ((e.target as HTMLElement).style.color = C.violet)}
                        onMouseOut={e => ((e.target as HTMLElement).style.color = C.body)}
                      >{l}</button>
                    )
                  )}
                </div>
              ))}
            </div>
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
              <p style={{ fontSize: 13, color: C.bodyLight, fontFamily: ft, margin: 0 }}>© 2025 JAGO Mobility Pvt Ltd. All rights reserved.</p>
              <p style={{ fontSize: 13, color: C.bodyLight, fontFamily: ft, margin: 0 }}>Made with 💜 in India</p>
            </div>
          </div>
        </footer>

        {/* MOBILE STICKY CTA */}
        <div className="mob-cta" style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 300,
          padding: "12px 16px", paddingBottom: "max(12px, env(safe-area-inset-bottom))",
          background: "rgba(255,253,249,.95)", backdropFilter: "blur(24px)",
          borderTop: `1px solid ${C.border}`, display: "none",
          boxShadow: "0 -4px 30px rgba(182,109,255,.06)",
        }}>
          <a href="#download" onClick={(event) => handleSectionNavigation(event, "#download")} style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            width: "100%", padding: "16px", borderRadius: 16,
            background: C.gradViolet, color: "#fff", textDecoration: "none",
            fontFamily: ft, fontWeight: 800, fontSize: 15,
            boxShadow: `0 -4px 28px ${C.glowViolet}`,
          }}>
            🚀 Book Ride
          </a>
        </div>
      </div>

      <style>{`
        @media(max-width:960px){
          .mob-cta{display:block!important}
          footer{padding-bottom:84px!important}
        }
      `}</style>
    </>
  );
}
