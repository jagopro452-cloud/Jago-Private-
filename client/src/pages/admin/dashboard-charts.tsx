import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

const customLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
  if (percent < 0.06) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={700}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

export function DashboardRevenueChart({ data }: { data: any[] }) {
  if (!data.length) {
    return (
      <div className="jd-empty-chart">
        <svg width="120" height="70" viewBox="0 0 120 70" fill="none" style={{ opacity: 0.15 }}>
          <path d="M8 60 Q20 20 35 35 Q50 50 65 20 Q80 -10 95 30 Q105 55 112 40" stroke="#2F7BFF" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
          <path d="M8 62 Q20 22 35 37 Q50 52 65 22 Q80 -8 95 32 Q105 57 112 42 L112 65 L8 65Z" fill="#2F7BFF" fillOpacity="0.1"/>
          <path d="M8 60 Q25 50 40 55 Q55 60 70 45 Q85 30 112 55" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 3" fill="none"/>
        </svg>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#64748B", marginBottom: 4 }}>No analytics yet</div>
        <div style={{ fontSize: 11, color: "#94a3b8", maxWidth: 220, lineHeight: 1.5, textAlign: "center" }}>Data will appear once trips are completed on the platform</div>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={210}>
      <AreaChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="gradRev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2F7BFF" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#2F7BFF" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradTrips" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#16a34a" stopOpacity={0.18} />
            <stop offset="100%" stopColor="#16a34a" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="day" tick={{ fontSize: 10.5, fill: "#94a3b8", fontWeight: 500 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10.5, fill: "#94a3b8", fontWeight: 500 }} axisLine={false} tickLine={false} width={42} />
        <Tooltip
          contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", boxShadow: "0 8px 32px rgba(0,0,0,0.08)", fontSize: 12, padding: "10px 14px" }}
          formatter={(val: any, name: string) => [name === "revenue" ? `₹${val}` : val, name === "revenue" ? "Revenue" : "Trips"]}
        />
        <Area type="monotone" dataKey="revenue" stroke="#2F7BFF" strokeWidth={2.5} fill="url(#gradRev)" dot={false} activeDot={{ r: 5, fill: "#2F7BFF", stroke: "#fff", strokeWidth: 2 }} />
        <Area type="monotone" dataKey="trips" stroke="#16a34a" strokeWidth={2} fill="url(#gradTrips)" dot={false} activeDot={{ r: 4, fill: "#16a34a", stroke: "#fff", strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DashboardTripDistributionChart({ data }: { data: any[] }) {
  if (!data.length) {
    return (
      <div className="d-flex flex-column align-items-center justify-content-center" style={{ height: 210, color: "#cbd5e1" }}>
        <i className="bi bi-pie-chart fs-1 mb-2" style={{ opacity: 0.3 }}></i>
        <span style={{ fontSize: 12, fontWeight: 500 }}>No trip data yet</span>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={210}>
      <PieChart>
        <Pie data={data} cx="50%" cy="45%" innerRadius={52} outerRadius={80} paddingAngle={3} dataKey="value" labelLine={false} label={customLabel}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip formatter={(val: any, name: string) => [`${val} trips`, name]} contentStyle={{ borderRadius: 10, fontSize: 12, border: "1px solid #e2e8f0" }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 4, fontWeight: 500 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
