import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useEffect, useMemo, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

/* ── helpers ─────────────────────────────────────────────── */
function avatarBg(name: string) {
  const c = ["#2563EB","#16a34a","#d97706","#9333ea","#0891b2","#dc2626"];
  return c[(name||"A").charCodeAt(0) % c.length];
}
function initials(name: string) {
  return (name||"?").split(" ").map(p=>p[0]).join("").substring(0,2).toUpperCase();
}
function money(v: number|string|null|undefined) {
  return `₹${Number(v||0).toLocaleString("en-IN",{maximumFractionDigits:0})}`;
}
function fmtDate(d: Date) {
  return d.toLocaleDateString("en-IN",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
}
function timeAgo(v?: string) {
  if (!v) return "";
  const s = Math.max(0,Math.floor((Date.now()-new Date(v).getTime())/1000));
  if (s<60) return `${s}s ago`;
  if (s<3600) return `${Math.floor(s/60)}m ago`;
  if (s<86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}
function customLabel({ cx,cy,midAngle,innerRadius,outerRadius,percent }: any) {
  if (percent<0.06) return null;
  const r=Math.PI/180, rad=innerRadius+(outerRadius-innerRadius)*0.5;
  return <text x={cx+rad*Math.cos(-midAngle*r)} y={cy+rad*Math.sin(-midAngle*r)} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={700}>{`${(percent*100).toFixed(0)}%`}</text>;
}

const STATUS_MAP: Record<string,{bg:string;color:string;label:string}> = {
  completed: { bg:"#D1FAE5", color:"#065F46", label:"Completed" },
  ongoing:   { bg:"#DBEAFE", color:"#1E40AF", label:"Ongoing" },
  pending:   { bg:"#FEF3C7", color:"#92400E", label:"Pending" },
  cancelled: { bg:"#FEE2E2", color:"#991B1B", label:"Cancelled" },
  accepted:  { bg:"#EDE9FE", color:"#5B21B6", label:"Accepted" },
};

const NOTIF_ICONS: Record<string,{icon:string;color:string;bg:string}> = {
  trip:    { icon:"bi-car-front-fill",     color:"#2563EB", bg:"#EFF6FF" },
  driver:  { icon:"bi-person-badge-fill",  color:"#16a34a", bg:"#F0FDF4" },
  payment: { icon:"bi-cash-stack",         color:"#d97706", bg:"#FFFBEB" },
  alert:   { icon:"bi-exclamation-triangle-fill", color:"#dc2626", bg:"#FEF2F2" },
  user:    { icon:"bi-person-plus-fill",   color:"#7c3aed", bg:"#F5F3FF" },
  withdraw:{ icon:"bi-wallet2",            color:"#0891b2", bg:"#ECFEFF" },
};

/* ── LiveClock ───────────────────────────────────────────── */
function LiveClock() {
  const [now,setNow]=useState(new Date());
  useEffect(()=>{ const t=setInterval(()=>setNow(new Date()),1000); return ()=>clearInterval(t); },[]);
  const h=now.getHours()%12||12, m=now.getMinutes().toString().padStart(2,"0");
  const s=now.getSeconds().toString().padStart(2,"0"), ap=now.getHours()>=12?"PM":"AM";
  return (
    <div style={{background:"linear-gradient(145deg,#0B1120,#111C3A,#162554)",borderRadius:20,padding:"22px 20px",color:"#fff",textAlign:"center",marginBottom:14,border:"1px solid rgba(99,130,255,0.18)",boxShadow:"0 8px 32px rgba(0,0,0,0.35)"}}>
      <div style={{fontSize:9,letterSpacing:3,color:"rgba(255,255,255,0.35)",textTransform:"uppercase",marginBottom:10,fontWeight:700}}>Local Time</div>
      <div style={{display:"flex",alignItems:"baseline",justifyContent:"center",gap:2}}>
        <span style={{fontSize:42,fontWeight:900,fontFamily:"'Inter',monospace",lineHeight:1,color:"#fff",letterSpacing:-1}}>{h}:{m}</span>
        <span style={{fontSize:20,opacity:0.35,fontWeight:400}}>:{s}</span>
        <span style={{fontSize:11,marginLeft:6,fontWeight:700,color:"rgba(147,197,253,0.75)"}}>{ap}</span>
      </div>
      <div style={{fontSize:11,color:"rgba(255,255,255,0.35)",marginTop:10,fontWeight:500}}>{fmtDate(now)}</div>
    </div>
  );
}

/* ── KpiPill (banner row) ────────────────────────────────── */
function KpiPill({label,value}:{label:string;value:string|number}) {
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"10px 16px",background:"rgba(255,255,255,0.09)",borderRadius:14,backdropFilter:"blur(8px)",border:"1px solid rgba(255,255,255,0.12)",minWidth:100}}>
      <span style={{fontSize:"1.05rem",fontWeight:800,color:"#fff",lineHeight:1}}>{value}</span>
      <span style={{fontSize:"0.62rem",color:"rgba(255,255,255,0.5)",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em"}}>{label}</span>
    </div>
  );
}

/* ── StatCard ────────────────────────────────────────────── */
function StatCard({label,value,icon,color,bg,href,trend}:any) {
  return (
    <Link href={href}>
      <div style={{background:"#fff",borderRadius:20,border:"1px solid #F1F5F9",boxShadow:"0 1px 4px rgba(0,0,0,0.04),0 6px 24px rgba(0,0,0,0.04)",padding:"20px 20px 18px",display:"flex",alignItems:"center",gap:14,cursor:"pointer",transition:"transform .2s ease,box-shadow .2s ease",textDecoration:"none",position:"relative",overflow:"hidden"}}
        onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.transform="translateY(-4px)";(e.currentTarget as HTMLElement).style.boxShadow=`0 12px 36px ${color}18,0 2px 8px rgba(0,0,0,0.06)`}}
        onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.transform="translateY(0)";(e.currentTarget as HTMLElement).style.boxShadow="0 1px 4px rgba(0,0,0,0.04),0 6px 24px rgba(0,0,0,0.04)"}}>
        {/* accent dot top-right */}
        <div style={{position:"absolute",top:-24,right:-24,width:80,height:80,borderRadius:"50%",background:color,opacity:0.06}}/>
        <div style={{width:52,height:52,borderRadius:15,background:bg,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <i className={`bi ${icon}`} style={{color,fontSize:"1.2rem"}}/>
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:"0.68rem",fontWeight:700,color:"#94A3B8",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:5}}>{label}</div>
          <div style={{fontSize:"1.75rem",fontWeight:900,color:"#0F172A",lineHeight:1,letterSpacing:"-0.03em"}}>{value}</div>
        </div>
        {trend && <span style={{fontSize:"0.7rem",fontWeight:700,background:"#F0FDF4",color:"#16a34a",borderRadius:8,padding:"3px 8px",flexShrink:0}}>{trend}</span>}
        <i className="bi bi-chevron-right" style={{color:"#E2E8F0",fontSize:"0.7rem",flexShrink:0}}/>
      </div>
    </Link>
  );
}

/* ── ServiceCard ─────────────────────────────────────────── */
function ServiceCard({label,icon,color,bg,trips,revenue,model,href}:any) {
  return (
    <Link href={href}>
      <div style={{background:"#fff",borderRadius:16,border:"1px solid #F1F5F9",boxShadow:"0 1px 3px rgba(0,0,0,0.04)",padding:"16px",cursor:"pointer",transition:"transform .18s ease,box-shadow .18s ease",textDecoration:"none"}}
        onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.transform="translateY(-3px)";(e.currentTarget as HTMLElement).style.boxShadow=`0 8px 24px ${color}15`}}
        onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.transform="translateY(0)";(e.currentTarget as HTMLElement).style.boxShadow="0 1px 3px rgba(0,0,0,0.04)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
          <div style={{width:36,height:36,borderRadius:10,background:bg,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <i className={`bi ${icon}`} style={{color,fontSize:14}}/>
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:12.5,fontWeight:700,color:"#0F172A",lineHeight:1.2}}>{label}</div>
            <div style={{fontSize:10,color,fontWeight:600,textTransform:"capitalize",marginTop:2}}>{model}</div>
          </div>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
          <div>
            <div style={{fontSize:22,fontWeight:900,color,lineHeight:1}}>{Number(trips||0).toLocaleString()}</div>
            <div style={{fontSize:9,color:"#94A3B8",marginTop:3,fontWeight:700,textTransform:"uppercase",letterSpacing:0.6}}>Trips</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:14,fontWeight:700,color:"#0F172A",lineHeight:1}}>{money(revenue)}</div>
            <div style={{fontSize:9,color:"#94A3B8",marginTop:3,fontWeight:700,textTransform:"uppercase",letterSpacing:0.6}}>Revenue</div>
          </div>
        </div>
      </div>
    </Link>
  );
}

/* ── QuickStatMini ───────────────────────────────────────── */
function QuickStatMini({label,value,icon,color,bg}:any) {
  return (
    <div style={{background:"#fff",borderRadius:14,border:"1px solid #F1F5F9",boxShadow:"0 1px 3px rgba(0,0,0,0.03)",padding:"14px 14px",display:"flex",alignItems:"center",gap:10}}>
      <div style={{width:34,height:34,borderRadius:10,background:bg,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
        <i className={`bi ${icon}`} style={{color,fontSize:13}}/>
      </div>
      <div>
        <div style={{fontSize:18,fontWeight:800,color,lineHeight:1}}>{value}</div>
        <div style={{fontSize:10,color:"#94A3B8",marginTop:2,fontWeight:600}}>{label}</div>
      </div>
    </div>
  );
}

/* ── Main Dashboard ──────────────────────────────────────── */
export default function Dashboard() {
  const { data: stats, isLoading } = useQuery<any>({ queryKey: ["/api/dashboard/stats"] });
  const { data: serviceData } = useQuery<any>({ queryKey: ["/api/admin/dashboard"], staleTime: 30000 });
  const { data: chart = [] } = useQuery<any[]>({ queryKey: ["/api/dashboard/chart"] });
  const { data: notifications = [] } = useQuery<any[]>({ queryKey: ["/api/notifications"] });
  const { data: liveKpis } = useQuery<any>({ queryKey: ["/api/admin/live-kpis"], refetchInterval: 15000 });

  // Pricing Health — reuses the same queries/endpoints already used on their own pages.
  const { data: pricingFares } = useQuery<any[]>({ queryKey: ["/api/fares"] });
  const { data: pricingParcelFares } = useQuery<any[]>({ queryKey: ["/api/parcel-fares"] });
  const { data: pricingZones } = useQuery<any[]>({ queryKey: ["/api/zones"] });
  const { data: pricingSurges } = useQuery<any[]>({ queryKey: ["/api/surge-pricing"] });
  const { data: pricingLocalPool } = useQuery<any>({ queryKey: ["/api/admin/local-pool/settings"] });
  const { data: pricingOutstation } = useQuery<any>({ queryKey: ["/api/admin/outstation-pool/pricing"] });
  const { data: pricingRevenue } = useQuery<any>({ queryKey: ["/api/admin/module-revenue"] });

  const pricingWarnings = useMemo(() => {
    const warnings: { label: string; href: string }[] = [];
    if (Array.isArray(pricingFares) && pricingFares.length === 0) warnings.push({ label: "No Ride Fare Configured", href: "/admin/fares" });
    if (Array.isArray(pricingParcelFares) && pricingParcelFares.length === 0) warnings.push({ label: "Parcel Pricing Missing", href: "/admin/parcel-fares" });
    const lp = pricingLocalPool?.settings || {};
    if (pricingLocalPool !== undefined && !(Number(lp.base_fare_per_seat) > 0 && Number(lp.fare_per_km_per_seat) > 0)) {
      warnings.push({ label: "Local Pool Pricing Incomplete", href: "/admin/local-pool?openSettings=1" });
    }
    if (pricingOutstation !== undefined && !(Number(pricingOutstation?.min_price_per_km_per_seat) > 0 && Number(pricingOutstation?.max_price_per_km_per_seat) > 0)) {
      warnings.push({ label: "Outstation Pricing Not Configured", href: "/admin/outstation-pool?tab=settings" });
    }
    if (Array.isArray(pricingSurges) && !pricingSurges.some((s: any) => s.isActive)) warnings.push({ label: "Surge Rules Disabled", href: "/admin/surge-pricing" });
    const modules = Array.isArray(pricingRevenue?.modules) ? pricingRevenue.modules : [];
    if (pricingRevenue !== undefined && modules.length === 0) warnings.push({ label: "Commission Rules Missing", href: "/admin/revenue-model" });
    if (Array.isArray(pricingZones) && !pricingZones.some((z: any) => z.isActive)) warnings.push({ label: "No Active Fare Zone", href: "/admin/zones" });
    return warnings;
  }, [pricingFares, pricingParcelFares, pricingZones, pricingSurges, pricingLocalPool, pricingOutstation, pricingRevenue]);

  const adminName = useMemo(()=>{ try { return JSON.parse(localStorage.getItem("jago-admin")||"{}").name||"Admin"; } catch { return "Admin"; } },[]);
  const now = new Date();
  const greeting = now.getHours()<12?"Good morning":now.getHours()<17?"Good afternoon":"Good evening";

  const topStats = [
    { label:"Total Customers", value:Number(stats?.totalCustomers||0).toLocaleString(), icon:"bi-people-fill",       color:"#2563EB", bg:"#EFF6FF", href:"/admin/customers",  trend:"+12%" },
    { label:"Total Drivers",   value:Number(stats?.totalDrivers||0).toLocaleString(),   icon:"bi-person-badge-fill", color:"#16a34a", bg:"#F0FDF4", href:"/admin/drivers",    trend:"+5%" },
    { label:"Total Revenue",   value:money(stats?.totalRevenue),                         icon:"bi-currency-rupee",    color:"#b45309", bg:"#FFFBEB", href:"/admin/reports",    trend:"+18%" },
    { label:"Total Trips",     value:Number(stats?.totalTrips||0).toLocaleString(),      icon:"bi-car-front-fill",    color:"#7e22ce", bg:"#F5F3FF", href:"/admin/trips",      trend:"+8%" },
  ];

  const services = [
    { label:"City Rides",     icon:"bi-car-front-fill",   color:"#2563EB", bg:"#EFF6FF", trips:serviceData?.services?.rides?.trips??0,              revenue:serviceData?.services?.rides?.revenue??0,            model:serviceData?.services?.rides?.model??"Commission",    href:"/admin/trips" },
    { label:"Parcels",        icon:"bi-box-seam-fill",    color:"#16a34a", bg:"#F0FDF4", trips:serviceData?.services?.parcels?.trips??0,            revenue:serviceData?.services?.parcels?.revenue??0,          model:serviceData?.services?.parcels?.model??"Commission",  href:"/admin/parcel-orders" },
    { label:"Intercity Pool", icon:"bi-people-fill",      color:"#7c3aed", bg:"#F5F3FF", trips:serviceData?.services?.carpool?.trips??0,            revenue:serviceData?.services?.carpool?.revenue??0,          model:serviceData?.services?.carpool?.model??"Commission",  href:"/admin/intercity-carsharing" },
    { label:"Outstation Pool",icon:"bi-signpost-2-fill",  color:"#d97706", bg:"#FFFBEB", trips:serviceData?.services?.outstationPool?.bookings??0,  revenue:serviceData?.services?.outstationPool?.revenue??0,   model:serviceData?.services?.outstationPool?.mode==="on"?"Active":"Inactive", href:"/admin/outstation-pool" },
  ];

  const quickStats = [
    { label:"Completed",   value:stats?.completedTrips??0,     color:"#10b981", bg:"#F0FDF4", icon:"bi-check-circle-fill" },
    { label:"Ongoing",     value:stats?.ongoingTrips??0,       color:"#2563EB", bg:"#EFF6FF", icon:"bi-broadcast-pin" },
    { label:"Cancelled",   value:stats?.cancelledTrips??0,     color:"#ef4444", bg:"#FEF2F2", icon:"bi-x-circle-fill" },
    { label:"Withdrawals", value:stats?.pendingWithdrawals??0, color:"#f59e0b", bg:"#FFFBEB", icon:"bi-clock-history" },
    { label:"Reviews",     value:stats?.totalReviews??0,       color:"#f59e0b", bg:"#FFFBEB", icon:"bi-star-fill" },
    { label:"Zones",       value:stats?.totalZones??0,         color:"#7c3aed", bg:"#F5F3FF", icon:"bi-map-fill" },
  ];

  const quickLinks = [
    { label:"All Trips",    icon:"bi-car-front",   href:"/admin/trips",       color:"#2563EB" },
    { label:"Drivers",      icon:"bi-person-badge",href:"/admin/drivers",     color:"#16a34a" },
    { label:"Withdrawals",  icon:"bi-cash-coin",   href:"/admin/withdrawals", color:"#d97706" },
    { label:"Reports",      icon:"bi-graph-up",    href:"/admin/reports",     color:"#7c3aed" },
  ];

  const pieData = [
    { name:"Completed", value:stats?.completedTrips||0,  color:"#10b981" },
    { name:"Ongoing",   value:stats?.ongoingTrips||0,    color:"#2563EB" },
    { name:"Cancelled", value:stats?.cancelledTrips||0,  color:"#ef4444" },
    { name:"Other",     value:Math.max(0,(stats?.totalTrips||0)-(stats?.completedTrips||0)-(stats?.ongoingTrips||0)-(stats?.cancelledTrips||0)), color:"#e2e8f0" },
  ].filter(d=>d.value>0);

  const liveItems = liveKpis ? [
    { label:"Searching",      value:liveKpis.live?.searching??0,           color:"#f59e0b", bg:"#FFFBEB", icon:"bi-search" },
    { label:"Dispatching",    value:liveKpis.live?.dispatching??0,         color:"#2563EB", bg:"#EFF6FF", icon:"bi-lightning-charge-fill" },
    { label:"In Progress",    value:liveKpis.live?.inProgress??0,          color:"#16a34a", bg:"#F0FDF4", icon:"bi-car-front-fill" },
    { label:"Done (1h)",      value:liveKpis.live?.completedLastHour??0,   color:"#0891b2", bg:"#ECFEFF", icon:"bi-check-circle-fill" },
    { label:"Cancelled (1h)", value:liveKpis.live?.cancelledLastHour??0,   color:"#dc2626", bg:"#FEF2F2", icon:"bi-x-circle-fill" },
    { label:"Avg Wait",       value:`${liveKpis.live?.avgPickupWaitMin??0}m`, color:"#7c3aed", bg:"#F5F3FF", icon:"bi-clock-fill" },
  ] : [];

  const recentTrips  = Array.isArray(stats?.recentTrips) ? stats.recentTrips.filter((i:any)=>i?.trip).slice(0,6) : [];
  const notifs       = Array.isArray(notifications) ? notifications.slice(0,8) : [];
  const pendingComm  = serviceData?.drivers?.totalPendingCommission??0;

  return (
    <div style={{padding:"24px 28px",maxWidth:1400,fontFamily:"'Inter','Segoe UI',sans-serif"}}>

      {/* ── Banner ────────────────────────────────────────── */}
      <div data-testid="dashboard-banner" style={{background:"linear-gradient(135deg,#0F172A 0%,#1E3A8A 55%,#1D4ED8 100%)",borderRadius:24,padding:"28px 32px",marginBottom:24,position:"relative",overflow:"hidden",boxShadow:"0 16px 48px rgba(15,23,42,0.35)"}}>
        {/* decorative orbs */}
        <div style={{position:"absolute",top:-60,right:-40,width:220,height:220,borderRadius:"50%",background:"rgba(255,255,255,0.04)",pointerEvents:"none"}}/>
        <div style={{position:"absolute",bottom:-50,right:160,width:160,height:160,borderRadius:"50%",background:"rgba(255,255,255,0.03)",pointerEvents:"none"}}/>

        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:16,marginBottom:22,position:"relative",zIndex:1}}>
          <div style={{display:"flex",alignItems:"center",gap:16}}>
            <div style={{width:52,height:52,borderRadius:16,background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.5rem",flexShrink:0}}>
              🌅
            </div>
            <div>
              <h3 style={{margin:0,fontWeight:800,fontSize:"1.35rem",color:"#fff",letterSpacing:-0.3}}>{greeting}, {adminName}!</h3>
              <p style={{margin:0,fontSize:13,color:"rgba(255,255,255,0.55)"}}>Here is your platform overview for today</p>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:12,padding:"8px 14px",backdropFilter:"blur(8px)",flexShrink:0}}>
            <i className="bi bi-calendar3" style={{color:"rgba(255,255,255,0.6)",fontSize:12}}/>
            <span style={{fontSize:12.5,color:"rgba(255,255,255,0.85)",fontWeight:600}}>{fmtDate(now)}</span>
          </div>
        </div>

        {/* KPI pills — no separator lines */}
        <div style={{display:"flex",gap:10,flexWrap:"wrap",position:"relative",zIndex:1}}>
          <KpiPill label="Live Trips"     value={liveKpis?.live?.inProgress??stats?.ongoingTrips??0} />
          <KpiPill label="Online Pilots"  value={serviceData?.drivers?.online??Math.round((stats?.totalDrivers??0)*0.7)} />
          <KpiPill label="Total Revenue"  value={money(stats?.totalRevenue)} />
          <KpiPill label="Active Zones"   value={stats?.totalZones??0} />
        </div>
      </div>

      {/* ── Pricing Health ───────────────────────────────── */}
      {pricingWarnings.length > 0 ? (
        <div style={{background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:16,padding:"14px 18px",marginBottom:22,display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}} data-testid="pricing-health-warnings">
          <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
            <i className="bi bi-exclamation-triangle-fill" style={{color:"#d97706",fontSize:16}}/>
            <span style={{fontSize:12.5,fontWeight:800,color:"#92400E"}}>Pricing Health</span>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",flex:1}}>
            {pricingWarnings.map(w=>(
              <a key={w.label} href={w.href} style={{fontSize:11.5,fontWeight:600,color:"#92400E",background:"#FEF3C7",border:"1px solid #FDE68A",borderRadius:20,padding:"4px 12px",textDecoration:"none",whiteSpace:"nowrap"}}>
                ⚠ {w.label}
              </a>
            ))}
          </div>
          <a href="/admin/fare-management" style={{fontSize:11.5,fontWeight:700,color:"#1D4ED8",textDecoration:"none",flexShrink:0}}>Open Fare Management →</a>
        </div>
      ) : (
        <div style={{background:"#F0FDF4",border:"1px solid #BBF7D0",borderRadius:16,padding:"12px 18px",marginBottom:22,display:"flex",alignItems:"center",gap:10}} data-testid="pricing-health-ok">
          <i className="bi bi-check-circle-fill" style={{color:"#16a34a",fontSize:15}}/>
          <span style={{fontSize:12.5,fontWeight:700,color:"#166534"}}>All pricing modules configured</span>
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 320px",gap:20,alignItems:"start"}}>

        {/* LEFT COLUMN */}
        <div style={{minWidth:0}}>

          {/* Stat cards */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:14,marginBottom:22}}>
            {topStats.map(c=><StatCard key={c.label} {...c}/>)}
          </div>

          {/* Services Overview */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <span style={{fontSize:11,fontWeight:700,color:"#94A3B8",textTransform:"uppercase",letterSpacing:"0.08em"}}>Services Overview</span>
            {pendingComm>0 && <span style={{fontSize:10.5,background:"#FEF2F2",color:"#DC2626",border:"1px solid #FECACA",borderRadius:20,padding:"3px 10px",fontWeight:700}}>{money(pendingComm)} pending commission</span>}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:22}}>
            {services.map(s=><ServiceCard key={s.label} {...s}/>)}
          </div>

          {/* Live Ops */}
          {liveItems.length>0 && (
            <div style={{marginBottom:22}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
                <span style={{fontSize:11,fontWeight:700,color:"#94A3B8",textTransform:"uppercase",letterSpacing:"0.08em"}}>Live Operations</span>
                <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:10,color:"#16a34a",fontWeight:600}}>
                  <span style={{width:6,height:6,borderRadius:"50%",background:"#16a34a",display:"inline-block",animation:"pulse 1.8s infinite"}}/>
                  Live · refreshes every 15s
                </span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
                {liveItems.map(i=>(
                  <div key={i.label} style={{background:"#fff",borderRadius:14,border:"1px solid #F1F5F9",boxShadow:"0 1px 3px rgba(0,0,0,0.03)",padding:"14px 14px",display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:32,height:32,borderRadius:9,background:i.bg,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      <i className={`bi ${i.icon}`} style={{color:i.color,fontSize:12}}/>
                    </div>
                    <div>
                      <div style={{fontSize:18,fontWeight:800,color:i.color,lineHeight:1}}>{i.value}</div>
                      <div style={{fontSize:10,color:"#94A3B8",marginTop:2,fontWeight:600}}>{i.label}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Charts row */}
          <div style={{display:"grid",gridTemplateColumns:"1.5fr 1fr",gap:16,marginBottom:22}}>

            {/* Revenue chart */}
            <div style={{background:"#fff",borderRadius:20,border:"1px solid #F1F5F9",boxShadow:"0 1px 4px rgba(0,0,0,0.04)",overflow:"hidden"}}>
              <div style={{padding:"18px 20px 10px",display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontSize:14,fontWeight:700,color:"#0F172A",letterSpacing:-0.2}}>Weekly Revenue</div>
                  <div style={{fontSize:11.5,color:"#94A3B8",marginTop:2}}>Revenue & trips — last 7 days</div>
                </div>
              </div>
              <div style={{padding:"0 16px 18px"}}>
                {chart.length>0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={chart} margin={{top:6,right:8,bottom:0,left:0}}>
                      <defs>
                        <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#2563EB" stopOpacity={0.18}/>
                          <stop offset="100%" stopColor="#2563EB" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="gTrips" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#16a34a" stopOpacity={0.14}/>
                          <stop offset="100%" stopColor="#16a34a" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false}/>
                      <XAxis dataKey="day" tick={{fontSize:10,fill:"#94A3B8",fontWeight:500}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fontSize:10,fill:"#94A3B8",fontWeight:500}} axisLine={false} tickLine={false} width={38}/>
                      <Tooltip contentStyle={{borderRadius:12,border:"1px solid #E2E8F0",boxShadow:"0 8px 24px rgba(0,0,0,0.08)",fontSize:12,padding:"10px 14px"}} formatter={(v:any,name:string)=>[name==="revenue"?money(v):v,name==="revenue"?"Revenue":"Trips"]}/>
                      <Area type="monotone" dataKey="revenue" stroke="#2563EB" strokeWidth={2.5} fill="url(#gRev)" dot={false}/>
                      <Area type="monotone" dataKey="trips"   stroke="#16a34a" strokeWidth={2}   fill="url(#gTrips)" dot={false}/>
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{height:200,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:"#CBD5E1"}}>
                    <i className="bi bi-bar-chart-line" style={{fontSize:36,marginBottom:10,opacity:0.3}}/>
                    <div style={{fontSize:13,fontWeight:700,color:"#94A3B8"}}>No analytics yet</div>
                    <div style={{fontSize:11,color:"#CBD5E1",maxWidth:200,textAlign:"center",marginTop:4,lineHeight:1.5}}>Data appears once trips are completed</div>
                  </div>
                )}
              </div>
            </div>

            {/* Pie chart */}
            <div style={{background:"#fff",borderRadius:20,border:"1px solid #F1F5F9",boxShadow:"0 1px 4px rgba(0,0,0,0.04)",overflow:"hidden"}}>
              <div style={{padding:"18px 20px 10px"}}>
                <div style={{fontSize:14,fontWeight:700,color:"#0F172A",letterSpacing:-0.2}}>Trip Distribution</div>
                <div style={{fontSize:11.5,color:"#94A3B8",marginTop:2}}>Status breakdown</div>
              </div>
              <div style={{padding:"0 12px 12px",display:"flex",flexDirection:"column",alignItems:"center"}}>
                {pieData.length>0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="44%" innerRadius={50} outerRadius={76} paddingAngle={3} dataKey="value" labelLine={false} label={customLabel}>
                        {pieData.map((e,i)=><Cell key={i} fill={e.color}/>)}
                      </Pie>
                      <Tooltip formatter={(v:any,n:string)=>[`${v} trips`,n]} contentStyle={{borderRadius:10,fontSize:12,border:"1px solid #E2E8F0"}}/>
                      <Legend iconType="circle" iconSize={7} wrapperStyle={{fontSize:10.5,paddingTop:2,fontWeight:500}}/>
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{height:200,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:"#CBD5E1"}}>
                    <i className="bi bi-pie-chart" style={{fontSize:36,opacity:0.3,marginBottom:8}}/>
                    <span style={{fontSize:12,fontWeight:500,color:"#94A3B8"}}>No trip data yet</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Recent Trips table */}
          <div style={{background:"#fff",borderRadius:20,border:"1px solid #F1F5F9",boxShadow:"0 1px 4px rgba(0,0,0,0.04)",overflow:"hidden",marginBottom:4}}>
            <div style={{padding:"18px 22px 14px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:"#0F172A",letterSpacing:-0.2}}>Recent Trips</div>
                <div style={{fontSize:11.5,color:"#94A3B8",marginTop:2}}>Latest platform activity</div>
              </div>
              <Link href="/admin/trips">
                <span style={{fontSize:12,fontWeight:700,color:"#2563EB",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:5}}>
                  View All <i className="bi bi-arrow-right"/>
                </span>
              </Link>
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5}}>
                <thead>
                  <tr style={{borderBottom:"1px solid #F8FAFC"}}>
                    {["Trip ID","Customer","Vehicle","Type","Fare","Payment","Status","Date"].map((h,i)=>(
                      <th key={h} style={{padding:`10px ${i===0?"22px":"12px"} 10px`,textAlign:"left",fontSize:10.5,fontWeight:700,color:"#94A3B8",textTransform:"uppercase",letterSpacing:"0.06em",background:"#FAFBFC",whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({length:5}).map((_,ri)=>(
                      <tr key={ri}>
                        {Array.from({length:8}).map((__,ci)=>(
                          <td key={ci} style={{padding:"12px",paddingLeft:ci===0?"22px":"12px"}}>
                            <div style={{height:10,borderRadius:5,background:"linear-gradient(90deg,#F1F5F9 25%,#E2E8F0 50%,#F1F5F9 75%)",backgroundSize:"200% 100%",animation:"shimmer 1.4s infinite",width:ci===0?70:"75%"}}/>
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : recentTrips.length>0 ? (
                    recentTrips.map((item:any,idx:number)=>{
                      const st = item.trip?.currentStatus||"pending";
                      const badge = STATUS_MAP[st]||{bg:"#F1F5F9",color:"#64748B",label:st};
                      const name  = item.customer?.fullName||"-";
                      return (
                        <tr key={item.trip?.id} style={{borderBottom:idx<recentTrips.length-1?"1px solid #F8FAFC":"none",transition:"background .15s"}}
                          onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background="#F8FBFF"}
                          onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background="transparent"}>
                          <td style={{padding:"13px 12px 13px 22px"}}>
                            <span style={{fontSize:11.5,color:"#2563EB",fontFamily:"'Inter',monospace",fontWeight:700}}>{item.trip?.refId||"-"}</span>
                          </td>
                          <td style={{padding:"13px 12px"}}>
                            <div style={{display:"flex",alignItems:"center",gap:8}}>
                              <div style={{width:28,height:28,borderRadius:"50%",background:avatarBg(name),display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"#fff",flexShrink:0}}>{initials(name)}</div>
                              <span style={{fontWeight:500,color:"#1E293B"}}>{name}</span>
                            </div>
                          </td>
                          <td style={{padding:"13px 12px",color:"#64748B"}}>{item.vehicleCategory?.name||"-"}</td>
                          <td style={{padding:"13px 12px"}}>
                            <span style={{padding:"3px 8px",borderRadius:6,fontSize:10.5,fontWeight:700,background:item.trip?.type==="parcel"?"#F0FDF4":"#EFF6FF",color:item.trip?.type==="parcel"?"#16a34a":"#1E40AF"}}>{item.trip?.type==="parcel"?"Parcel":"Ride"}</span>
                          </td>
                          <td style={{padding:"13px 12px",fontWeight:700,color:"#0F172A"}}>{money(item.trip?.actualFare||item.trip?.estimatedFare||0)}</td>
                          <td style={{padding:"13px 12px"}}>
                            <span style={{padding:"3px 8px",borderRadius:6,fontSize:10,fontWeight:700,background:item.trip?.paymentStatus==="paid"?"#D1FAE5":"#FEF3C7",color:item.trip?.paymentStatus==="paid"?"#065F46":"#92400E"}}>
                              {item.trip?.paymentStatus==="paid"?"Paid":"Unpaid"}
                            </span>
                          </td>
                          <td style={{padding:"13px 12px"}}>
                            <span style={{padding:"3px 8px",borderRadius:6,fontSize:10,fontWeight:700,background:badge.bg,color:badge.color}}>{badge.label}</span>
                          </td>
                          <td style={{padding:"13px 12px",color:"#94A3B8",fontSize:11.5,whiteSpace:"nowrap"}}>{item.trip?.createdAt?new Date(item.trip.createdAt).toLocaleDateString("en-IN"):"-"}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={8}>
                        <div style={{textAlign:"center",padding:"48px 20px"}}>
                          <div style={{width:56,height:56,borderRadius:"50%",background:"#EFF6FF",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px"}}>
                            <i className="bi bi-car-front" style={{fontSize:24,color:"#93C5FD"}}/>
                          </div>
                          <div style={{fontWeight:700,color:"#0F172A",fontSize:14,marginBottom:4}}>No Trips Yet</div>
                          <p style={{fontSize:12,color:"#94A3B8",maxWidth:260,margin:"0 auto",lineHeight:1.6}}>Trips appear here once customers start booking through the JAGO app.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div>
          <LiveClock/>

          {/* Quick Stats */}
          <div style={{background:"#fff",borderRadius:20,border:"1px solid #F1F5F9",boxShadow:"0 1px 4px rgba(0,0,0,0.04)",padding:"18px 18px 14px",marginBottom:14}}>
            <div style={{fontSize:10.5,fontWeight:700,color:"#94A3B8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:14}}>Quick Stats</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              {quickStats.map(i=><QuickStatMini key={i.label} {...i} value={isLoading?"-":i.value}/>)}
            </div>
          </div>

          {/* Quick Actions */}
          <div style={{background:"#fff",borderRadius:20,border:"1px solid #F1F5F9",boxShadow:"0 1px 4px rgba(0,0,0,0.04)",padding:"18px 18px 14px",marginBottom:14}}>
            <div style={{fontSize:10.5,fontWeight:700,color:"#94A3B8",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:14}}>Quick Actions</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              {quickLinks.map(item=>(
                <Link key={item.label} href={item.href}>
                  <div style={{padding:"12px 12px",borderRadius:14,border:"1px solid #F1F5F9",display:"flex",alignItems:"center",gap:9,cursor:"pointer",transition:"background .15s,transform .15s",textDecoration:"none"}}
                    onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background=`${item.color}08`;(e.currentTarget as HTMLElement).style.transform="translateY(-1px)"}}
                    onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background="transparent";(e.currentTarget as HTMLElement).style.transform="translateY(0)"}}>
                    <div style={{width:30,height:30,borderRadius:9,background:`${item.color}12`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      <i className={`bi ${item.icon}`} style={{color:item.color,fontSize:12}}/>
                    </div>
                    <span style={{fontSize:12,fontWeight:600,color:"#1E293B"}}>{item.label}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Notifications */}
          <div style={{background:"#fff",borderRadius:20,border:"1px solid #F1F5F9",boxShadow:"0 1px 4px rgba(0,0,0,0.04)",overflow:"hidden"}}>
            <div style={{padding:"18px 18px 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <i className="bi bi-bell-fill" style={{color:"#2563EB",fontSize:13}}/>
                <span style={{fontSize:13,fontWeight:700,color:"#0F172A"}}>Notifications</span>
              </div>
              <Link href="/admin/notifications">
                <span style={{fontSize:11,color:"#2563EB",cursor:"pointer",fontWeight:700}}>View all</span>
              </Link>
            </div>
            <div style={{maxHeight:380,overflowY:"auto"}}>
              {notifs.length===0 ? (
                <div style={{textAlign:"center",padding:"36px 20px",color:"#CBD5E1"}}>
                  <i className="bi bi-bell-slash" style={{fontSize:28,opacity:0.25,display:"block",marginBottom:8}}/>
                  <span style={{fontSize:12,fontWeight:500,color:"#94A3B8"}}>No notifications yet</span>
                </div>
              ) : notifs.map((n:any,idx:number)=>{
                const style=NOTIF_ICONS[n.type||"trip"]||NOTIF_ICONS.trip;
                return (
                  <div key={n.id||idx} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"12px 18px",background:n.isRead===false?"#F8FBFF":"transparent",borderBottom:idx<notifs.length-1?"1px solid #F8FAFC":"none"}}>
                    <div style={{width:32,height:32,borderRadius:9,background:style.bg,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>
                      <i className={`bi ${style.icon}`} style={{color:style.color,fontSize:12}}/>
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,color:"#1E293B",lineHeight:1.3}}>{n.title||"Notification"}</div>
                      <div style={{fontSize:11,color:"#94A3B8",marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{n.message||n.body||""}</div>
                    </div>
                    <div style={{fontSize:9.5,color:"#CBD5E1",whiteSpace:"nowrap",marginTop:2,fontWeight:500}}>{timeAgo(n.createdAt)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <style>{`@keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </div>
  );
}
