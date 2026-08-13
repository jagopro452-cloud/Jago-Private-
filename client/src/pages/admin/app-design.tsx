import { useState } from "react";
import { Logo } from "@/components/Logo";

type AppTab = "customer" | "driver";

// ─── PHONE FRAME ──────────────────────────────────────────────────────────────
function Phone({ children, bg = "#fff", dark = false }: {
  children: React.ReactNode; bg?: string; dark?: boolean;
}) {
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      {/* Side buttons */}
      <div style={{ position: "absolute", right: -7, top: 110, width: 3.5, height: 54, background: "#0a0a0a", borderRadius: "0 3px 3px 0", zIndex: 5 }} />
      <div style={{ position: "absolute", left: -7, top: 96, width: 3.5, height: 30, background: "#0a0a0a", borderRadius: "3px 0 0 3px", zIndex: 5 }} />
      <div style={{ position: "absolute", left: -7, top: 140, width: 3.5, height: 54, background: "#0a0a0a", borderRadius: "3px 0 0 3px", zIndex: 5 }} />

      <div style={{
        width: 252, height: 524,
        background: bg,
        borderRadius: 50,
        border: "7px solid #0d0d0d",
        boxShadow: dark
          ? "0 60px 100px rgba(0,0,0,0.7), 0 30px 50px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04), inset 0 0 0 1px rgba(255,255,255,0.04)"
          : "0 50px 90px rgba(0,0,0,0.25), 0 20px 40px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.08), inset 0 0 0 1px rgba(255,255,255,0.8)",
        overflow: "hidden", position: "relative",
      }}>
        {/* Status bar */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 50, zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "0 22px 8px" }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: dark ? "white" : "white", opacity: dark ? 0.85 : 1 }}>9:41</span>
          <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 110, height: 34, background: "#000", borderRadius: "0 0 24px 24px" }} />
          <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
            {/* Signal */}
            <svg width="16" height="12" viewBox="0 0 16 12"><rect x="0" y="5" width="3" height="7" rx="0.8" fill="white" opacity="0.9"/><rect x="4.5" y="3" width="3" height="9" rx="0.8" fill="white" opacity="0.9"/><rect x="9" y="1" width="3" height="11" rx="0.8" fill="white" opacity="0.9"/><rect x="13.5" y="0" width="2.5" height="12" rx="0.8" fill="white" opacity="0.35"/></svg>
            {/* Wifi */}
            <svg width="15" height="12" viewBox="0 0 15 12"><path d="M7.5 10a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" fill="white"/><path d="M4.5 7.5C5.5 6.5 6.4 6 7.5 6s2 .5 3 1.5" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/><path d="M1.5 4.5C3.2 2.8 5.2 2 7.5 2s4.3.8 6 2.5" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.6"/></svg>
            {/* Battery */}
            <div style={{ display: "flex", alignItems: "center", gap: 1 }}>
              <div style={{ width: 22, height: 11, border: "1.5px solid rgba(255,255,255,0.7)", borderRadius: 3, display: "flex", alignItems: "center", padding: "1.5px" }}>
                <div style={{ width: "78%", height: "100%", background: "#34D399", borderRadius: 1.5 }} />
              </div>
              <div style={{ width: 1.5, height: 5, background: "rgba(255,255,255,0.5)", borderRadius: 1 }} />
            </div>
          </div>
        </div>
        {/* Home indicator */}
        <div style={{ position: "absolute", bottom: 7, left: "50%", transform: "translateX(-50%)", width: 110, height: 4, background: dark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.18)", borderRadius: 3, zIndex: 200 }} />
        {/* Content */}
        <div style={{ paddingTop: 50, height: "calc(100% - 18px)", overflow: "hidden" }}>{children}</div>
      </div>
    </div>
  );
}

// ─── MAP BACKGROUND ───────────────────────────────────────────────────────────
function MapBg({ dark = false }: { dark?: boolean }) {
  const bg = dark ? "#08122a" : "#dce9fc";
  return (
    <div style={{ position: "absolute", inset: 0, background: bg, overflow: "hidden" }}>
      <svg width="100%" height="100%" style={{ position: "absolute", opacity: dark ? 1 : 0.8 }}>
        {[0,1,2,3,4,5,6,7].map(r=>[0,1,2,3].map(c=>(
          <rect key={`b${r}${c}`} x={c*64+3} y={r*56+3} width={57} height={49} fill={dark?"rgba(13,27,62,0.8)":"rgba(255,255,255,0.6)"} rx="4"/>
        )))}
        {[0,56,112,168,224,280,336].map((y,i)=><rect key={`rh${i}`} x="0" y={y} width="252" height="5" fill={dark?"rgba(255,255,255,0.05)":"rgba(255,255,255,0.9)"}/>)}
        {[0,64,128,192,256].map((x,i)=><rect key={`rv${i}`} x={x} y="0" width="5" height="600" fill={dark?"rgba(255,255,255,0.05)":"rgba(255,255,255,0.9)"}/>)}
        <path d="M0,170 Q60,145 130,155 Q200,165 252,190" stroke={dark?"rgba(255,255,255,0.12)":"rgba(255,255,255,0.95)"} strokeWidth="9" fill="none" strokeLinecap="round"/>
        <path d="M0,170 Q60,145 130,155 Q200,165 252,190" stroke={dark?"rgba(37,99,235,0.4)":"#BFDBFE"} strokeWidth="5" fill="none" strokeLinecap="round"/>
        <path d="M40,0 Q50,100 80,200 Q110,310 90,450" stroke={dark?"rgba(255,255,255,0.08)":"rgba(255,255,255,0.9)"} strokeWidth="7" fill="none" strokeLinecap="round"/>
        {[[24,80],[60,130],[140,65],[180,130],[60,200],[200,200]].map(([x,y],i)=>(
          <circle key={`t${i}`} cx={x} cy={y} r={5} fill={dark?"rgba(34,197,94,0.25)":"rgba(34,197,94,0.5)"}/>
        ))}
      </svg>
      <div style={{ position: "absolute", inset: 0, background: dark ? "linear-gradient(to top, rgba(6,13,30,0.9) 0%, transparent 60%)" : "linear-gradient(to top, rgba(248,250,255,0.95) 0%, transparent 55%)" }}/>
    </div>
  );
}

function ScreenLabel({ title, sub, color }: { title: string; sub: string; color: string }) {
  return (
    <div style={{ textAlign: "center", marginTop: 16, maxWidth: 252 }}>
      <div style={{ fontWeight: 800, fontSize: 14, color: "#0f172a", letterSpacing: -0.2 }}>{title}</div>
      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3, lineHeight: 1.4 }}>{sub}</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CUSTOMER APP SCREENS — 6 screens
// ══════════════════════════════════════════════════════════════════════════════

function C1_Splash() {
  return (
    <Phone bg="#1E5FCC" dark>
      <div style={{ height: "100%", background: "linear-gradient(160deg,#071a4a 0%,#0d3b99 40%,#1565c0 75%,#1e88e5 100%)", display: "flex", flexDirection: "column", alignItems: "center", position: "relative", overflow: "hidden" }}>
        {/* Circles */}
        {[380,290,210,140,80].map((s,i)=>(
          <div key={i} style={{ position: "absolute", top: "45%", left: "50%", transform: "translate(-50%,-50%)", width: s, height: s, borderRadius: "50%", border: `1px solid rgba(255,255,255,${0.04+i*0.01})` }}/>
        ))}
        <div style={{ position: "absolute", top: -80, right: -60, width: 260, height: 260, borderRadius: "50%", background: "rgba(255,255,255,0.04)" }}/>
        <div style={{ position: "absolute", bottom: -40, left: -40, width: 180, height: 180, borderRadius: "50%", background: "rgba(255,255,255,0.03)" }}/>

        <div style={{ flex: 1.4 }} />
        <div style={{ width: 120, height: 120, background: "white", borderRadius: 34, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 30px 70px rgba(0,0,0,0.3), 0 10px 30px rgba(0,0,0,0.2), 0 0 0 1px rgba(255,255,255,0.2)" }}>
          <Logo variant="blue" size="xxl" />
        </div>
        <div style={{ marginTop: 32, textAlign: "center" }}>
          <div style={{ fontSize: 48, fontWeight: 900, color: "white", letterSpacing: 10, lineHeight: 1, textShadow: "0 2px 20px rgba(0,0,0,0.3)" }}>JAGO</div>
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
            <div style={{ height: 1, width: 30, background: "rgba(255,255,255,0.2)" }}/>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", letterSpacing: 3, fontWeight: 500 }}>MOVE SMARTER</div>
            <div style={{ height: 1, width: 30, background: "rgba(255,255,255,0.2)" }}/>
          </div>
        </div>
        <div style={{ flex: 2 }} />
        <div style={{ marginBottom: 44, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", gap: 7 }}>
            {[1, 0.35, 0.35].map((o, i) => (
              <div key={i} style={{ width: i === 0 ? 20 : 6, height: 6, borderRadius: 3, background: `rgba(255,255,255,${o})` }}/>
            ))}
          </div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", letterSpacing: 1.5, fontWeight: 600, textTransform: "uppercase" }}>MindWhile IT Solutions</div>
        </div>
      </div>
    </Phone>
  );
}

function C2_Login() {
  return (
    <Phone bg="#F0F5FF">
      <div style={{ height: "100%", background: "#F0F5FF", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ background: "linear-gradient(155deg,#1E5FCC,#4FA9FF,#4FA9FF)", padding: "16px 22px 40px", borderRadius: "0 0 36px 36px", position: "relative", overflow: "hidden", flexShrink: 0 }}>
          <div style={{ position: "absolute", top: -50, right: -50, width: 180, height: 180, borderRadius: "50%", background: "rgba(255,255,255,0.06)" }}/>
          <div style={{ position: "absolute", bottom: -30, left: -20, width: 130, height: 130, borderRadius: "50%", background: "rgba(255,255,255,0.04)" }}/>
          <div style={{ height: 24, marginBottom: 22, position: "relative" }}><Logo variant="white" size="sm" /></div>
          <div style={{ fontSize: 26, fontWeight: 900, color: "white", lineHeight: 1.25, position: "relative" }}>Welcome Back<br/><span style={{ opacity: 0.9 }}>to JAGO 👋</span></div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 7, position: "relative" }}>Hyderabad &amp; Andhra Pradesh</div>
        </div>

        <div style={{ padding: "22px 20px 0", flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 7, textTransform: "uppercase", letterSpacing: 0.5 }}>Mobile Number</div>
          <div style={{ background: "white", borderRadius: 16, border: "1.5px solid #E2E8F0", display: "flex", alignItems: "center", boxShadow: "0 2px 10px rgba(0,0,0,0.06)", marginBottom: 14, overflow: "hidden" }}>
            <div style={{ padding: "0 14px", borderRight: "1.5px solid #F1F5F9", height: 52, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <span style={{ fontSize: 17 }}>🇮🇳</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: "#1e293b" }}>+91</span>
              <svg width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="#94A3B8" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>
            </div>
            <div style={{ padding: "0 15px", fontSize: 15, color: "#CBD5E1", letterSpacing: 2 }}>98765 43210</div>
          </div>

          <div style={{ background: "linear-gradient(135deg,#2F7BFF,#1E5FCC)", borderRadius: 16, height: 52, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 14, fontWeight: 800, boxShadow: "0 8px 24px rgba(47,123,255,0.4)", marginBottom: 16, gap: 8 }}>
            <span>Send OTP</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M12 5l7 7-7 7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1, height: 1, background: "#E2E8F0" }}/>
            <span style={{ fontSize: 11, color: "#94A3B8", fontWeight: 600 }}>OR</span>
            <div style={{ flex: 1, height: 1, background: "#E2E8F0" }}/>
          </div>

          <div style={{ background: "white", borderRadius: 16, height: 48, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, border: "1.5px solid #E2E8F0", boxShadow: "0 2px 6px rgba(0,0,0,0.05)", marginBottom: 20 }}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66 2.84-.66-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Continue with Google</span>
          </div>

          <div style={{ fontSize: 10, color: "#94A3B8", textAlign: "center", lineHeight: 1.5 }}>
            By continuing, you agree to JAGO's<br/><span style={{ color: "#4FA9FF", fontWeight: 600 }}>Terms of Service</span> &amp; <span style={{ color: "#4FA9FF", fontWeight: 600 }}>Privacy Policy</span>
          </div>
        </div>
      </div>
    </Phone>
  );
}

function C3_Home() {
  return (
    <Phone bg="#EFF6FF">
      <div style={{ height: "100%", position: "relative", display: "flex", flexDirection: "column" }}>
        <MapBg dark={false}/>

        {/* Top bar */}
        <div style={{ position: "relative", zIndex: 10, padding: "8px 12px 0" }}>
          <div style={{ background: "white", borderRadius: 18, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }}>
            <div style={{ width: 36, height: 36, borderRadius: 11, background: "#EFF6FF", border: "1.5px solid #BFDBFE", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="16" height="14" viewBox="0 0 16 14"><rect width="16" height="2.5" rx="1.2" fill="#4FA9FF"/><rect y="5.5" width="12" height="2.5" rx="1.2" fill="#4FA9FF"/><rect y="11" width="8" height="2.5" rx="1.2" fill="#4FA9FF"/></svg>
            </div>
            <div style={{ height: 17 }}><Logo variant="blue" size="xs" /></div>
            <div style={{ flex: 1 }}/>
            <div style={{ position: "relative" }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg,#4FA9FF,#1E5FCC)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 900, color: "white" }}>R</div>
              <div style={{ position: "absolute", top: 0, right: 0, width: 10, height: 10, borderRadius: "50%", background: "#EF4444", border: "1.5px solid white" }}/>
            </div>
          </div>
        </div>

        {/* Map center dot */}
        <div style={{ position: "absolute", top: "35%", left: "46%", zIndex: 5 }}>
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#2F7BFF", border: "2.5px solid white", boxShadow: "0 0 0 8px rgba(47,123,255,0.12), 0 4px 10px rgba(0,0,0,0.2)" }}/>
        </div>

        {/* Greeting */}
        <div style={{ position: "absolute", top: 76, left: 20, zIndex: 6, background: "white", borderRadius: 14, padding: "8px 14px", boxShadow: "0 4px 14px rgba(0,0,0,0.1)", border: "1px solid #F1F5F9" }}>
          <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 500 }}>Good morning</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#0F172A" }}>Ravi Kumar 👋</div>
        </div>

        <div style={{ flex: 1 }} />

        {/* Bottom sheet */}
        <div style={{ position: "relative", zIndex: 10, background: "white", borderRadius: "30px 30px 0 0", boxShadow: "0 -10px 50px rgba(0,0,0,0.12)", padding: "8px 16px 12px" }}>
          <div style={{ width: 44, height: 4, background: "#E2E8F0", borderRadius: 2, margin: "6px auto 16px" }}/>
          <div style={{ fontSize: 18, fontWeight: 900, color: "#0F172A", marginBottom: 14, letterSpacing: -0.3 }}>Where to?</div>

          <div style={{ background: "#F8FAFF", borderRadius: 18, border: "1.5px solid #E8EEFF", marginBottom: 16, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid #F1F5F9" }}>
              <div style={{ width: 9, height: 9, borderRadius: "50%", border: "2.5px solid #4FA9FF", flexShrink: 0 }}/>
              <span style={{ fontSize: 13, color: "#4FA9FF", fontWeight: 600 }}>Hitech City, Hyderabad</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px" }}>
              <div style={{ width: 9, height: 9, borderRadius: "2px", background: "#EF4444", flexShrink: 0 }}/>
              <span style={{ fontSize: 13, color: "#94A3B8" }}>Search destination...</span>
              <div style={{ marginLeft: "auto", width: 26, height: 26, background: "#EFF6FF", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #BFDBFE" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="#4FA9FF" strokeWidth="2"/><path d="M21 21L16.65 16.65" stroke="#4FA9FF" strokeWidth="2" strokeLinecap="round"/></svg>
              </div>
            </div>
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Choose ride type</div>
          <div style={{ display: "flex", gap: 7, marginBottom: 14 }}>
            {[{e:"🏍",n:"Bike",f:"₹20+",s:true},{e:"🛺",n:"Auto",f:"₹38+",s:false},{e:"📦",n:"Parcel",f:"₹28+",s:false},{e:"🚛",n:"Cargo",f:"₹220+",s:false}].map((v,i)=>(
              <div key={i} style={{ flex: 1, background: v.s ? "linear-gradient(150deg,#2F7BFF,#1E5FCC)" : "white", borderRadius: 14, border: `1.5px solid ${v.s?"#2F7BFF":"#E8EEFF"}`, padding: "10px 3px", textAlign: "center", boxShadow: v.s ? "0 8px 22px rgba(47,123,255,0.38)" : "0 2px 6px rgba(0,0,0,0.04)" }}>
                <div style={{ fontSize: 19, marginBottom: 3 }}>{v.e}</div>
                <div style={{ fontSize: 9, fontWeight: 800, color: v.s ? "white" : "#374151" }}>{v.n}</div>
                <div style={{ fontSize: 8, fontWeight: 700, color: v.s ? "rgba(255,255,255,0.75)" : "#4FA9FF", marginTop: 1 }}>{v.f}</div>
              </div>
            ))}
          </div>

          <div style={{ background: "linear-gradient(135deg,#2F7BFF,#1E5FCC)", borderRadius: 18, height: 52, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 15, fontWeight: 800, boxShadow: "0 10px 28px rgba(47,123,255,0.42)", gap: 8 }}>
            <span>Find Bike · ₹20+</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M12 5l7 7-7 7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
        </div>
      </div>
    </Phone>
  );
}

function C4_Tracking() {
  return (
    <Phone bg="#F0F5FF">
      <div style={{ height: "100%", position: "relative", display: "flex", flexDirection: "column" }}>
        <MapBg dark={false}/>

        {/* Route visualization */}
        <div style={{ position: "absolute", top: "18%", left: "36%", zIndex: 5 }}>
          <div style={{ width: 11, height: 11, borderRadius: "50%", background: "#4FA9FF", border: "2.5px solid white", boxShadow: "0 0 0 5px rgba(25,118,210,0.18)" }}/>
          <svg width="22" height="65" viewBox="0 0 22 65" style={{ marginLeft: -5.5 }}>
            <path d="M11,0 L11,65" stroke="url(#cg)" strokeWidth="2.5" fill="none" strokeDasharray="5,4"/>
            <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4FA9FF"/><stop offset="100%" stopColor="#4FA9FF" stopOpacity="0.4"/></linearGradient></defs>
          </svg>
          <div style={{ width: 26, height: 26, borderRadius: "50%", background: "white", border: "2.5px solid #4FA9FF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, marginLeft: -7.5, boxShadow: "0 4px 12px rgba(25,118,210,0.3)" }}>🏍</div>
          <svg width="22" height="45" viewBox="0 0 22 45" style={{ marginLeft: -5.5 }}>
            <path d="M11,0 L11,45" stroke="#EF4444" strokeWidth="2.5" fill="none" strokeDasharray="5,4" opacity="0.6"/>
          </svg>
          <div style={{ width: 11, height: 11, borderRadius: "50%", background: "#EF4444", border: "2.5px solid white", boxShadow: "0 0 0 5px rgba(239,68,68,0.18)", marginLeft: 0 }}/>
        </div>

        <div style={{ flex: 1 }} />

        {/* Bottom sheet */}
        <div style={{ position: "relative", zIndex: 10, background: "white", borderRadius: "30px 30px 0 0", boxShadow: "0 -10px 50px rgba(0,0,0,0.12)", padding: "8px 16px 14px" }}>
          <div style={{ width: 44, height: 4, background: "#E2E8F0", borderRadius: 2, margin: "6px auto 14px" }}/>

          <div style={{ background: "linear-gradient(135deg,#EFF6FF,#DBEAFE)", borderRadius: 18, padding: "13px 14px", display: "flex", alignItems: "center", gap: 12, border: "1px solid #BFDBFE", marginBottom: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#DBEAFE", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>🏍</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: "#1E5FCC" }}>Pilot వస్తున్నాడు!</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#22C55E", boxShadow: "0 0 6px rgba(34,197,94,0.6)" }}/>
                <span style={{ fontSize: 11, color: "#4FA9FF", fontWeight: 600 }}>~4 min away · Live</span>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: "#1E5FCC" }}>4:23</div>
              <div style={{ fontSize: 9, color: "#94A3B8", fontWeight: 600 }}>min away</div>
            </div>
          </div>

          <div style={{ background: "#F8FAFC", borderRadius: 16, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, border: "1px solid #F1F5F9", marginBottom: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", background: "linear-gradient(135deg,#4FA9FF,#1E5FCC)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 18, color: "white", flexShrink: 0 }}>A</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>Arjun Kumar</div>
              <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>⭐ 4.92 · TG09AB1234 · Bike</div>
            </div>
            <div style={{ display: "flex", gap: 7 }}>
              <div style={{ width: 38, height: 38, borderRadius: 12, background: "#EFF6FF", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #BFDBFE" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" fill="#4FA9FF"/></svg>
              </div>
            </div>
          </div>

          <div style={{ background: "#FFFBEB", borderRadius: 16, padding: "12px 16px", display: "flex", alignItems: "center", gap: 14, border: "1.5px solid #FDE68A", marginBottom: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "#FEF3C7", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 18 }}>🔐</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#D97706", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>Trip OTP — Share with Pilot</div>
              <div style={{ fontSize: 30, fontWeight: 900, color: "#0F172A", letterSpacing: 10, lineHeight: 1 }}>4829</div>
            </div>
          </div>

          <div style={{ border: "1.5px solid #FECACA", borderRadius: 14, height: 42, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#EF4444" }}>
            Cancel Ride
          </div>
        </div>
      </div>
    </Phone>
  );
}

function C5_Rating() {
  const stars = [1,2,3,4,5];
  return (
    <Phone bg="white">
      <div style={{ height: "100%", background: "white", display: "flex", flexDirection: "column", padding: "0 20px" }}>
        <div style={{ textAlign: "center", marginTop: 16, marginBottom: 20 }}>
          <div style={{ width: 70, height: 70, borderRadius: "50%", background: "linear-gradient(135deg,#D4EDDA,#C3E6CB)", margin: "0 auto 14px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>✅</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#0F172A", marginBottom: 5 }}>Trip Completed!</div>
          <div style={{ fontSize: 13, color: "#64748B" }}>Hitech City → Banjara Hills</div>
        </div>

        <div style={{ background: "#F8FAFC", borderRadius: 20, padding: "16px 18px", marginBottom: 18, border: "1px solid #F1F5F9" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 13, color: "#64748B", fontWeight: 600 }}>Trip Fare</span>
            <span style={{ fontSize: 22, fontWeight: 900, color: "#0F172A" }}>₹68</span>
          </div>
          {[["Duration","12 mins"],["Distance","4.2 km"],["Payment","UPI ✓"]].map(([l,v],i)=>(
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 8, borderTop: i===0?"1px solid #F1F5F9":"none" }}>
              <span style={{ fontSize: 12, color: "#94A3B8" }}>{l}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>{v}</span>
            </div>
          ))}
        </div>

        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", marginBottom: 5 }}>Rate your Pilot</div>
          <div style={{ fontSize: 12, color: "#94A3B8", marginBottom: 14 }}>Arjun Kumar · ⭐ 4.92</div>
          <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
            {stars.map(s => (
              <div key={s} style={{ fontSize: 30, filter: s <= 4 ? "none" : "grayscale(100%) opacity(0.3)" }}>⭐</div>
            ))}
          </div>
        </div>

        <div style={{ background: "#F8FAFC", borderRadius: 16, padding: "12px 14px", marginBottom: 16, border: "1px solid #F1F5F9" }}>
          <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 8 }}>Leave a comment (optional)</div>
          <div style={{ fontSize: 13, color: "#CBD5E1", fontStyle: "italic" }}>Great ride! Very punctual...</div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1, background: "#F8FAFC", border: "1.5px solid #E2E8F0", borderRadius: 14, height: 48, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#64748B" }}>Skip</div>
          <div style={{ flex: 2, background: "linear-gradient(135deg,#2F7BFF,#1E5FCC)", borderRadius: 14, height: 48, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: "white", boxShadow: "0 8px 22px rgba(47,123,255,0.4)" }}>Submit Rating</div>
        </div>
      </div>
    </Phone>
  );
}

function C6_Wallet() {
  return (
    <Phone bg="#F0F5FF">
      <div style={{ height: "100%", background: "#F0F5FF", overflow: "hidden" }}>
        <div style={{ background: "linear-gradient(155deg,#1E5FCC,#4FA9FF,#2F7BFF)", padding: "14px 20px 28px", borderRadius: "0 0 32px 32px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -40, right: -30, width: 150, height: 150, borderRadius: "50%", background: "rgba(255,255,255,0.06)" }}/>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, position: "relative" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "white" }}>My Wallet</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.08)", padding: "4px 10px", borderRadius: 8 }}>JAGO Pay</div>
          </div>
          <div style={{ position: "relative" }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontWeight: 600, marginBottom: 4 }}>Available Balance</div>
            <div style={{ fontSize: 38, fontWeight: 900, color: "white", lineHeight: 1 }}>₹1,250<span style={{ fontSize: 16, fontWeight: 600, opacity: 0.6 }}>.00</span></div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 20, position: "relative" }}>
            {[["Add Money","➕"],["Send","📤"],["History","📋"]].map(([l,e],i)=>(
              <div key={i} style={{ flex: 1, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 14, padding: "10px 0", textAlign: "center" }}>
                <div style={{ fontSize: 18, marginBottom: 4 }}>{e}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: "16px 18px 0" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#0F172A", marginBottom: 12 }}>Recent Transactions</div>
          {[
            { icon:"🏍", title:"Bike Ride", sub:"Hitech City → Banjara Hills", amount:"-₹68", color:"#EF4444", date:"Today" },
            { icon:"💰", title:"Wallet Top-up", sub:"UPI · PhonePe", amount:"+₹500", color:"#22C55E", date:"Yesterday" },
            { icon:"🛺", title:"Auto Ride", sub:"Ameerpet → Secunderabad", amount:"-₹92", color:"#EF4444", date:"2 days ago" },
            { icon:"🎁", title:"Referral Bonus", sub:"Friend joined JAGO", amount:"+₹100", color:"#22C55E", date:"3 days ago" },
          ].map((t,i)=>(
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 12, borderBottom: i<3?"1px solid #F1F5F9":"none", marginBottom: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 13, background: "#EFF6FF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0, border: "1px solid #DBEAFE" }}>{t.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>{t.title}</div>
                <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 2 }}>{t.sub}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: t.color }}>{t.amount}</div>
                <div style={{ fontSize: 9, color: "#CBD5E1", marginTop: 2 }}>{t.date}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Phone>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// DRIVER APP SCREENS — 6 screens
// ══════════════════════════════════════════════════════════════════════════════

function D1_Splash() {
  return (
    <Phone bg="#060D1E" dark>
      <div style={{ height: "100%", background: "#060D1E", display: "flex", flexDirection: "column", alignItems: "center", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "38%", left: "50%", transform: "translate(-50%,-50%)", width: 380, height: 380, borderRadius: "50%", background: "radial-gradient(circle,rgba(37,99,235,0.18) 0%,transparent 70%)" }}/>
        <svg style={{ position: "absolute", inset: 0, opacity: 0.03 }} width="100%" height="100%">
          {Array.from({length:16},(_,i)=><line key={`v${i}`} x1={i*16} y1="0" x2={i*16} y2="520" stroke="white" strokeWidth=".5"/>)}
          {Array.from({length:36},(_,i)=><line key={`h${i}`} x1="0" y1={i*16} x2="252" y2={i*16} stroke="white" strokeWidth=".5"/>)}
        </svg>
        {[220,170,120,76].map((s,i)=>(
          <div key={i} style={{ position: "absolute", top: "38%", left: "50%", transform: "translate(-50%,-50%)", width: s, height: s, borderRadius: "50%", border: `1px solid rgba(37,99,235,${0.08+i*0.04})` }}/>
        ))}

        <div style={{ flex: 1.6 }}/>
        <div style={{ width: 130, height: 130, background: "#0D1B3E", borderRadius: 36, border: "1.5px solid rgba(37,99,235,0.35)", boxShadow: "0 0 80px rgba(37,99,235,0.28), 0 30px 60px rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
          <div style={{ position: "absolute", inset: 0, borderRadius: 36, background: "linear-gradient(135deg,rgba(37,99,235,0.12),transparent)" }}/>
          <Logo variant="pilot" size="xxl" />
        </div>

        <div style={{ marginTop: 32, textAlign: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(37,99,235,0.1)", border: "1px solid rgba(37,99,235,0.2)", borderRadius: 20, padding: "6px 18px" }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#22C55E" }}/>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", letterSpacing: 2 }}>DRIVE. EARN. GROW.</span>
          </div>
        </div>

        <div style={{ flex: 2 }}/>
        <div style={{ marginBottom: 44, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <div style={{ width: 24, height: 24, borderRadius: "50%", border: "2px solid rgba(37,99,235,0.12)", borderTop: "2px solid rgba(37,99,235,0.55)" }}/>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.15)", letterSpacing: 1.5, textTransform: "uppercase" }}>MindWhile IT Solutions</div>
        </div>
      </div>
    </Phone>
  );
}

function D2_Login() {
  return (
    <Phone bg="#060D1E" dark>
      <div style={{ height: "100%", background: "#060D1E", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -100, right: -80, width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle,rgba(37,99,235,0.14) 0%,transparent 70%)" }}/>
        <div style={{ padding: "14px 20px 0", position: "relative" }}>
          <div style={{ height: 30, marginBottom: 28 }}><Logo variant="pilot" size="lg" /></div>
          <div style={{ fontSize: 28, fontWeight: 900, color: "white", lineHeight: 1.2, letterSpacing: -0.5, marginBottom: 6 }}>Pilot గా<br/>Login చేయండి 🏍️</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginBottom: 26 }}>ప్రతి trip తో earn చేయండి</div>

          <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.35)", marginBottom: 7, textTransform: "uppercase", letterSpacing: 0.5 }}>Mobile Number</div>
          <div style={{ background: "#0D1B3E", borderRadius: 16, border: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", overflow: "hidden", marginBottom: 18 }}>
            <div style={{ padding: "0 14px", height: 52, borderRight: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <span style={{ fontSize: 17 }}>🇮🇳</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: "white" }}>+91</span>
            </div>
            <div style={{ padding: "0 14px", fontSize: 15, color: "rgba(255,255,255,0.18)", letterSpacing: 2 }}>98765 43210</div>
          </div>

          <div style={{ background: "linear-gradient(135deg,#2F7BFF,#1E5FCC)", borderRadius: 16, height: 52, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 14, fontWeight: 800, boxShadow: "0 12px 32px rgba(37,99,235,0.45)", marginBottom: 12, gap: 8 }}>
            <span>Get OTP</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M12 5l7 7-7 7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>

          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 5, marginBottom: 22 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="rgba(255,255,255,0.25)" strokeWidth="2"/></svg>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>Secure &amp; Verified Platform</span>
          </div>

          <div style={{ background: "#0D1B3E", borderRadius: 18, border: "1px solid rgba(37,99,235,0.15)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 44, height: 44, background: "rgba(37,99,235,0.15)", borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M23 6l-9.5 9.5-5-5L1 18" stroke="#2F7BFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M17 6h6v6" stroke="#2F7BFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 900, color: "white" }}>₹800 – ₹1,500<span style={{ fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,0.4)" }}>/day</span></div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>Average Pilot Earnings</div>
            </div>
          </div>
        </div>
      </div>
    </Phone>
  );
}

function D3_Home() {
  return (
    <Phone bg="#060D1E" dark>
      <div style={{ height: "100%", background: "#060D1E", position: "relative", display: "flex", flexDirection: "column" }}>
        <MapBg dark/>
        <div style={{ position: "absolute", top: "34%", left: "45%", zIndex: 5 }}>
          <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#2F7BFF", border: "2.5px solid white", boxShadow: "0 0 0 10px rgba(37,99,235,0.12), 0 0 0 20px rgba(37,99,235,0.06)" }}/>
        </div>

        <div style={{ position: "relative", zIndex: 10, padding: "8px 12px 0" }}>
          <div style={{ background: "rgba(13,27,62,0.9)", borderRadius: 18, padding: "10px 14px", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 6px 20px rgba(0,0,0,0.4)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22C55E", boxShadow: "0 0 10px rgba(34,197,94,0.8)" }}/>
              <Logo variant="pilot" size="xs" />
            </div>
            <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.08)" }}/>
            <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>Online — Ready ✓</span>
            <div style={{ flex: 1 }}/>
            <div style={{ width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg,#2F7BFF,#1E5FCC)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 900, color: "white" }}>R</div>
          </div>
        </div>

        <div style={{ flex: 1 }}/>

        <div style={{ position: "relative", zIndex: 10, background: "#060D1E", borderRadius: "28px 28px 0 0", padding: "6px 14px 14px", boxShadow: "0 -6px 40px rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.04)", borderBottom: "none" }}>
          <div style={{ width: 38, height: 4, background: "rgba(255,255,255,0.07)", borderRadius: 2, margin: "8px auto 16px" }}/>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {[{e:"💰",l:"Today's Earn",v:"₹1,240",c:"#22C55E",bg:"rgba(34,197,94,0.08)",br:"rgba(34,197,94,0.15)"},{e:"🛺",l:"Trips Done",v:"8",c:"#4FA9FF",bg:"rgba(79,169,255,0.08)",br:"rgba(79,169,255,0.15)"},{e:"👛",l:"Wallet",v:"₹340",c:"#F59E0B",bg:"rgba(245,158,11,0.08)",br:"rgba(245,158,11,0.15)"}].map((s,i)=>(
              <div key={i} style={{ flex: 1, background: s.bg, border: `1px solid ${s.br}`, borderRadius: 16, padding: "12px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>{s.e}</div>
                <div style={{ fontSize: 15, fontWeight: 900, color: "white" }}>{s.v}</div>
                <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", marginTop: 2, fontWeight: 600 }}>{s.l}</div>
              </div>
            ))}
          </div>
          <div style={{ background: "linear-gradient(135deg,#16A34A,#15803D)", borderRadius: 18, height: 52, display: "flex", alignItems: "center", justifyContent: "center", gap: 9, color: "white", fontSize: 14, fontWeight: 800, boxShadow: "0 10px 28px rgba(22,163,74,0.45)", marginBottom: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "rgba(255,255,255,0.7)" }}/>
            Online — Trip కోసం Ready ✓
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {[{e:"☕",l:"Break",c:"#F59E0B",bg:"rgba(245,158,11,0.08)",br:"rgba(245,158,11,0.15)"},{e:"💳",l:"Wallet",c:"#22C55E",bg:"rgba(34,197,94,0.08)",br:"rgba(34,197,94,0.15)"},{e:"📋",l:"History",c:"#4FA9FF",bg:"rgba(79,169,255,0.08)",br:"rgba(79,169,255,0.15)"}].map((a,i)=>(
              <div key={i} style={{ flex: 1, background: a.bg, border: `1px solid ${a.br}`, borderRadius: 14, padding: "10px 0", textAlign: "center" }}>
                <div style={{ fontSize: 17, marginBottom: 3 }}>{a.e}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: a.c }}>{a.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Phone>
  );
}

function D4_Incoming() {
  return (
    <Phone bg="#060D1E" dark>
      <div style={{ height: "100%", background: "#060D1E", position: "relative", display: "flex", flexDirection: "column" }}>
        <MapBg dark/>
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.62)", zIndex: 2 }}/>

        <div style={{ position: "absolute", top: "18%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 3 }}>
          {[160,120,84].map((s,i)=>(
            <div key={i} style={{ position: "absolute", width: s, height: s, borderRadius: "50%", border: `1px solid rgba(37,99,235,${0.14-i*0.04})`, top: -(s-52)/2, left: -(s-52)/2 }}/>
          ))}
          <div style={{ width: 52, height: 52, borderRadius: "50%", background: "linear-gradient(135deg,#2F7BFF,#1E5FCC)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 50px rgba(37,99,235,0.7), 0 0 100px rgba(37,99,235,0.3)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>
          </div>
        </div>

        <div style={{ flex: 1, zIndex: 3 }}/>

        <div style={{ position: "relative", zIndex: 4, margin: "0 10px 10px", background: "#0D1B3E", borderRadius: 28, border: "1px solid rgba(37,99,235,0.2)", boxShadow: "0 0 60px rgba(37,99,235,0.18), 0 50px 90px rgba(0,0,0,0.7)" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#4FA9FF", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 3 }}>🔔 New Trip Request</div>
              <div style={{ fontSize: 17, fontWeight: 900, color: "white" }}>Accept చేయండి!</div>
            </div>
            <div style={{ width: 52, height: 52, borderRadius: "50%", position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="52" height="52" viewBox="0 0 52 52" style={{ position: "absolute", transform: "rotate(-90deg)" }}>
                <circle cx="26" cy="26" r="22" fill="none" stroke="rgba(37,99,235,0.12)" strokeWidth="3"/>
                <circle cx="26" cy="26" r="22" fill="none" stroke="#2F7BFF" strokeWidth="3" strokeDasharray={`${138*0.58} ${138}`} strokeLinecap="round"/>
              </svg>
              <span style={{ fontSize: 15, fontWeight: 900, color: "white" }}>22</span>
            </div>
          </div>

          <div style={{ margin: "12px 14px", background: "#060D1E", borderRadius: 18, padding: "13px 14px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 3, gap: 2 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#2F7BFF", boxShadow: "0 0 10px rgba(37,99,235,0.6)" }}/>
                <div style={{ width: 1.5, height: 20, background: "linear-gradient(to bottom,rgba(37,99,235,0.5),rgba(245,158,11,0.4))" }}/>
                <div style={{ width: 10, height: 10, borderRadius: "2px", background: "#F59E0B", boxShadow: "0 0 8px rgba(245,158,11,0.5)" }}/>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#4FA9FF", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Pickup</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "white", marginBottom: 14 }}>MGBS Bus Stand, Hyd</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#FCD34D", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Destination</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.7)" }}>Banjara Hills Rd No. 12</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              {[{ic:"🛣️",v:"7.2 km",c:"#4FA9FF"},{ic:"⏱",v:"~8 min",c:"#22C55E"},{ic:"💰",v:"₹185",c:"#F59E0B"}].map((s,i)=>(
                <div key={i} style={{ flex: 1, textAlign: "center", padding: "6px 0", background: "rgba(255,255,255,0.03)", borderRadius: 10 }}>
                  <div style={{ fontSize: 12, marginBottom: 2 }}>{s.ic}</div>
                  <div style={{ fontSize: 13, fontWeight: 900, color: s.c }}>{s.v}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, margin: "0 14px 16px" }}>
            <div style={{ flex: 1, background: "rgba(239,68,68,0.07)", borderRadius: 16, height: 50, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(239,68,68,0.18)", fontSize: 13, fontWeight: 700, color: "#F87171" }}>Reject</div>
            <div style={{ flex: 2.2, background: "linear-gradient(135deg,#16A34A,#15803D)", borderRadius: 16, height: 50, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 900, color: "white", boxShadow: "0 10px 26px rgba(22,163,74,0.5)", gap: 7 }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Accept Trip
            </div>
          </div>
        </div>
      </div>
    </Phone>
  );
}

function D5_OnTrip() {
  return (
    <Phone bg="#060D1E" dark>
      <div style={{ height: "100%", background: "#060D1E", position: "relative", display: "flex", flexDirection: "column" }}>
        <MapBg dark/>
        <div style={{ position: "absolute", top: "18%", left: "38%", zIndex: 5 }}>
          <div style={{ width: 11, height: 11, borderRadius: "50%", background: "#22C55E", border: "2.5px solid white", boxShadow: "0 0 12px rgba(34,197,94,0.7)" }}/>
          <svg width="22" height="60" viewBox="0 0 22 60" style={{ marginLeft: -5.5 }}><path d="M11,0 L11,60" stroke="url(#dg)" strokeWidth="2.5" fill="none" strokeDasharray="5,4"/><defs><linearGradient id="dg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22C55E"/><stop offset="100%" stopColor="#2F7BFF"/></linearGradient></defs></svg>
          <div style={{ width: 24, height: 24, borderRadius: "50%", background: "linear-gradient(135deg,#2F7BFF,#1E5FCC)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, boxShadow: "0 0 0 5px rgba(37,99,235,0.18)", marginLeft: -6.5 }}>🏍</div>
          <svg width="22" height="45" viewBox="0 0 22 45" style={{ marginLeft: -5.5 }}><path d="M11,0 L11,45" stroke="url(#dg2)" strokeWidth="2.5" fill="none" strokeDasharray="5,4"/><defs><linearGradient id="dg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2F7BFF"/><stop offset="100%" stopColor="#EF4444"/></linearGradient></defs></svg>
          <div style={{ width: 11, height: 11, borderRadius: "50%", background: "#EF4444", border: "2.5px solid white", boxShadow: "0 0 12px rgba(239,68,68,0.7)" }}/>
        </div>

        <div style={{ flex: 1 }}/>
        <div style={{ position: "relative", zIndex: 10, background: "#060D1E", borderRadius: "28px 28px 0 0", padding: "6px 14px 14px", boxShadow: "0 -6px 40px rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.04)", borderBottom: "none" }}>
          <div style={{ width: 38, height: 4, background: "rgba(255,255,255,0.07)", borderRadius: 2, margin: "8px auto 13px" }}/>
          <div style={{ background: "rgba(22,163,74,0.08)", border: "1px solid rgba(22,163,74,0.18)", borderRadius: 16, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div style={{ width: 38, height: 38, background: "rgba(22,163,74,0.14)", borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>🛣️</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#22C55E" }}>On Trip — In Progress</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>Banjara Hills Rd No. 12 · ~12 min</div>
            </div>
          </div>

          <div style={{ background: "#0D1B3E", borderRadius: 16, border: "1px solid rgba(255,255,255,0.05)", padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", background: "linear-gradient(135deg,#2F7BFF,#1E5FCC)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 17, color: "white", flexShrink: 0 }}>A</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "white" }}>Arjun Reddy</div>
              <div style={{ display: "flex", gap: 6, marginTop: 5 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#22C55E", background: "rgba(34,197,94,0.1)", borderRadius: 6, padding: "2px 8px" }}>₹185</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#4FA9FF", background: "rgba(79,169,255,0.1)", borderRadius: 6, padding: "2px 8px" }}>7.2 km</span>
              </div>
            </div>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: "rgba(37,99,235,0.1)", border: "1px solid rgba(37,99,235,0.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" fill="#2F7BFF"/></svg>
            </div>
          </div>

          <div style={{ background: "linear-gradient(135deg,#16A34A,#15803D)", borderRadius: 16, height: 52, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "white", fontSize: 14, fontWeight: 900, boxShadow: "0 10px 28px rgba(22,163,74,0.48)", marginBottom: 10 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Complete Trip
          </div>

          <div style={{ display: "flex", justifyContent: "center", gap: 20 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#2F7BFF" }}>📞 Call Customer</span>
            <span style={{ color: "rgba(255,255,255,0.08)" }}>|</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#F87171" }}>SOS</span>
          </div>
        </div>
      </div>
    </Phone>
  );
}

function D6_Earnings() {
  const bars = [55, 80, 45, 95, 70, 88, 62];
  const days = ["M","T","W","T","F","S","S"];
  return (
    <Phone bg="#060D1E" dark>
      <div style={{ height: "100%", background: "#060D1E", overflow: "hidden" }}>
        <div style={{ background: "linear-gradient(155deg,#040c1a,#071232,#0a1844)", padding: "13px 18px 22px", borderRadius: "0 0 30px 30px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -40, right: -30, width: 140, height: 140, borderRadius: "50%", background: "radial-gradient(circle,rgba(37,99,235,0.2) 0%,transparent 70%)" }}/>
          <div style={{ fontSize: 14, fontWeight: 800, color: "rgba(255,255,255,0.7)", marginBottom: 14, position: "relative" }}>My Earnings</div>
          <div style={{ position: "relative" }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 700, marginBottom: 3, letterSpacing: 0.5 }}>THIS MONTH</div>
            <div style={{ fontSize: 36, fontWeight: 900, color: "white", lineHeight: 1 }}>₹32,400</div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6 }}>
              <div style={{ background: "rgba(34,197,94,0.15)", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700, color: "#22C55E" }}>↑ +18%</div>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>vs last month</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 16, position: "relative" }}>
            {[["186","Trips"],["4.91","Rating"],["₹174","Per Trip"]].map(([v,l],i)=>(
              <div key={i} style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 13, padding: "10px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 900, color: "white" }}>{v}</div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: "16px 18px 0" }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.7)", marginBottom: 14 }}>This Week</div>
          <div style={{ display: "flex", gap: 7, alignItems: "flex-end", height: 80, marginBottom: 6 }}>
            {bars.map((h, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <div style={{ width: "100%", height: `${h}%`, background: i === 4 ? "linear-gradient(to top,#2F7BFF,#4FA9FF)" : "rgba(37,99,235,0.25)", borderRadius: "4px 4px 2px 2px" }}/>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 7 }}>
            {days.map((d, i) => (
              <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 9, fontWeight: 700, color: i === 4 ? "#4FA9FF" : "rgba(255,255,255,0.2)" }}>{d}</div>
            ))}
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.7)", marginBottom: 10 }}>Today's Breakdown</div>
            {[{t:"08:30 AM",r:"Hitech → Gachibowli",a:"₹145"},{t:"10:15 AM",r:"Ameerpet → Begumpet",a:"₹92"},{t:"12:40 PM",r:"MGBS → Banjara Hills",a:"₹185"}].map((e,i)=>(
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 10, borderBottom: i<2?"1px solid rgba(255,255,255,0.04)":"none", marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.25)", width: 40, flexShrink: 0 }}>{e.t}</div>
                <div style={{ flex: 1, fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>{e.r}</div>
                <div style={{ fontSize: 13, fontWeight: 900, color: "#22C55E" }}>{e.a}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Phone>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════════
export default function AppDesignPage() {
  const [tab, setTab] = useState<AppTab>("customer");
  const isDriver = tab === "driver";
  const accent = isDriver ? "#2F7BFF" : "#2F7BFF";
  const grad = isDriver ? "linear-gradient(135deg,#1E5FCC,#2F7BFF)" : "linear-gradient(135deg,#1E5FCC,#2F7BFF)";

  const customerScreens = [
    { c: <C1_Splash/>, title: "Splash Screen",   sub: "Animated entry · Blue gradient" },
    { c: <C2_Login/>,  title: "Login",            sub: "Phone OTP · Google sign-in" },
    { c: <C3_Home/>,   title: "Home",             sub: "Map + vehicle selector" },
    { c: <C4_Tracking/>, title: "Live Tracking",  sub: "Pilot ETA · OTP · Call" },
    { c: <C5_Rating/>, title: "Trip Rating",      sub: "5-star · Fare summary" },
    { c: <C6_Wallet/>, title: "JAGO Pro Wallet",      sub: "Balance · Transactions" },
  ];
  const driverScreens = [
    { c: <D1_Splash/>,   title: "Splash Screen",  sub: "Dark navy · Glow rings" },
    { c: <D2_Login/>,    title: "Pilot Login",    sub: "OTP · Earnings banner" },
    { c: <D3_Home/>,     title: "Driver Home",    sub: "Stats · Online toggle" },
    { c: <D4_Incoming/>, title: "Incoming Trip",  sub: "Countdown · Accept/Reject" },
    { c: <D5_OnTrip/>,   title: "On Trip",        sub: "Route map · Complete" },
    { c: <D6_Earnings/>, title: "Earnings",       sub: "₹32,400/month · Chart" },
  ];
  const screens = isDriver ? driverScreens : customerScreens;

  return (
    <div style={{ padding: "24px", background: "#F1F5F9", minHeight: "100vh", fontFamily: "'Inter',-apple-system,sans-serif" }}>

      {/* Header */}
      <div style={{ background: "white", borderRadius: 24, padding: "22px 26px 20px", boxShadow: "0 2px 20px rgba(0,0,0,0.06)", border: "1px solid #F1F5F9", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 14, marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 56, height: 56, background: grad, borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 10px 30px ${accent}40` }}>
              <Logo variant={isDriver ? "pilot" : "white"} height={isDriver ? 34 : 38} />
            </div>
            <div>
              <div style={{ fontWeight: 900, fontSize: 22, color: "#0F172A", letterSpacing: -0.5 }}>
                {isDriver ? "JAGO Pro Pilot" : "JAGO Pro"}&nbsp;
                <span style={{ background: grad, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>App Screens</span>
              </div>
              <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 3 }}>
                {isDriver ? "Driver App · Dark Navy Theme · Android" : "Customer App · Blue & White · Android + iOS"}&nbsp;·&nbsp;Flutter 3.27
              </div>
            </div>
          </div>

          <div style={{ display: "flex", background: "#F1F5F9", borderRadius: 16, padding: 4, gap: 3 }}>
            {(["customer","driver"] as AppTab[]).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: "10px 22px", borderRadius: 13, border: "none", cursor: "pointer",
                fontSize: 13, fontWeight: 700, transition: "all 0.2s",
                background: tab === t ? (t === "driver" ? "linear-gradient(135deg,#1E5FCC,#2F7BFF)" : "linear-gradient(135deg,#1E5FCC,#2F7BFF)") : "transparent",
                color: tab === t ? "white" : "#64748B",
                boxShadow: tab === t ? "0 4px 20px rgba(0,0,0,0.2)" : "none",
              }}>
                {t === "driver" ? "🏍 JAGO Pilot" : "📱 JAGO Customer"}
              </button>
            ))}
          </div>
        </div>

        {/* Color system */}
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 1, marginRight: 4 }}>Color System</span>
          {(isDriver
            ? [{c:"#060D1E",n:"Background"},{c:"#0D1B3E",n:"Surface"},{c:"#2F7BFF",n:"Primary"},{c:"#22C55E",n:"Online"},{c:"#F59E0B",n:"Earning"},{c:"#EF4444",n:"Alert"}]
            : [{c:"#1E5FCC",n:"Deep Blue"},{c:"#2F7BFF",n:"Primary"},{c:"#42A5F5",n:"Light"},{c:"#F0F5FF",n:"Surface"},{c:"#EF4444",n:"Dest"},{c:"#F59E0B",n:"OTP"}]
          ).map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, background: "#F8FAFC", borderRadius: 9, padding: "4px 10px", border: "1px solid #F1F5F9" }}>
              <div style={{ width: 14, height: 14, background: p.c, borderRadius: 3, border: "1px solid rgba(0,0,0,0.08)", flexShrink: 0 }}/>
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#1E293B" }}>{p.n}</div>
                <div style={{ fontSize: 8, color: "#94A3B8", fontFamily: "monospace" }}>{p.c}</div>
              </div>
            </div>
          ))}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, background: "#F0FDF4", borderRadius: 10, padding: "6px 14px", border: "1px solid #BBF7D0" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#16A34A" }}/>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#16A34A" }}>GitHub Synced ✓</span>
          </div>
        </div>
      </div>

      {/* Info strip */}
      <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
        {[
          { l: "Framework",  v: "Flutter 3.27.1" },
          { l: "CI/CD",      v: "GitHub Actions" },
          { l: "Theme",      v: isDriver ? "Dark #060D1E" : "Blue #2F7BFF" },
          { l: "Screens",    v: `${screens.length} screens` },
          { l: "APK",        v: isDriver ? "~25.5 MB" : "~26 MB" },
          { l: "Maps",       v: "Google Maps SDK" },
        ].map((info, i) => (
          <div key={i} style={{ background: "white", borderRadius: 14, padding: "10px 18px", border: "1px solid #F1F5F9", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: 9, color: "#94A3B8", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{info.l}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1E293B", marginTop: 2 }}>{info.v}</div>
          </div>
        ))}
      </div>

      {/* Screen showcase */}
      <div style={{ background: "white", borderRadius: 24, padding: "28px 28px 32px", boxShadow: "0 2px 20px rgba(0,0,0,0.06)", border: "1px solid #F1F5F9", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
          <div style={{ width: 40, height: 40, background: grad, borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="5" y="2" width="14" height="20" rx="3" stroke="white" strokeWidth="2"/><circle cx="12" cy="18" r="1" fill="white"/></svg>
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: "#0F172A" }}>Screen Showcase — {screens.length} Screens</div>
            <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>Complete UI journey · {isDriver ? "Driver experience" : "Customer experience"}</div>
          </div>
        </div>

        <div style={{ overflowX: "auto", paddingBottom: 12 }}>
          <div style={{ display: "flex", gap: 32, minWidth: "max-content", padding: "4px 4px 8px" }}>
            {screens.map((s, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: grad, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900, color: "white", boxShadow: `0 4px 14px ${accent}40` }}>{i+1}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>{s.title}</div>
                </div>
                {s.c}
                <ScreenLabel title={s.title} sub={s.sub} color={accent}/>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ background: "white", borderRadius: 22, padding: "20px 22px", boxShadow: "0 2px 10px rgba(0,0,0,0.05)", border: "1px solid #F1F5F9" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>📦 Dependencies</div>
          <div style={{ background: "#0F172A", borderRadius: 14, padding: "16px 18px", fontFamily: "monospace", fontSize: 10, lineHeight: 2.1 }}>
            {[["google_maps_flutter","^2.5.0"],["dio","^5.0.0"],["get","^4.6.6"],["geolocator","^11.0.0"],["firebase_messaging","^14.7.0"],["pin_code_fields","^8.0.1"],["socket_io_client","^2.0.0"]].map(([k,v],i)=>(
              <div key={i}><span style={{ color: "#4FA9FF" }}>{k}:</span> <span style={{ color: "#86EFAC" }}>{v}</span></div>
            ))}
          </div>
        </div>
        <div style={{ background: "white", borderRadius: 22, padding: "20px 22px", boxShadow: "0 2px 10px rgba(0,0,0,0.05)", border: "1px solid #F1F5F9" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>🔗 API Endpoints</div>
          {[
            { env: "Production", url: "https://jagopro.org",         c: "#7C3AED", bg: "#F5F3FF", status: "✓ Live" },
            { env: "Staging",    url: "https://staging.jagopro.org", c: "#2F7BFF", bg: "#EFF6FF", status: "Standby" },
            { env: "Local Dev",  url: "http://localhost:5000",        c: "#16A34A", bg: "#F0FDF4", status: "Dev" },
          ].map((e, i) => (
            <div key={i} style={{ background: "#F8FAFC", borderRadius: 13, padding: "11px 14px", marginBottom: 8, border: "1px solid #F1F5F9" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#1E293B" }}>{e.env}</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: e.c, background: e.bg, padding: "2px 8px", borderRadius: 6 }}>{e.status}</div>
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 10, color: "#64748B", background: "white", padding: "5px 10px", borderRadius: 8, border: "1px solid #E2E8F0" }}>{e.url}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
