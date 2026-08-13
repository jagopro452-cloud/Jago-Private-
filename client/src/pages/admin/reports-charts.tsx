import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
  BarChart,
  Bar,
} from "recharts";

const fmtCur = (v: any) => `₹${parseFloat(v || 0).toFixed(2)}`;

export function EarningsTrendChart({ data }: { data: any[] }) {
  if (!data.length) {
    return <div className="h-100 d-flex align-items-center justify-content-center text-muted">No chart data</div>;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="earnRev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2F7BFF" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#2F7BFF" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="earnAdmin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#16a34a" stopOpacity={0.22} />
            <stop offset="100%" stopColor="#16a34a" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={50} />
        <Tooltip formatter={(v: any) => fmtCur(v)} />
        <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#2F7BFF" fill="url(#earnRev)" strokeWidth={2.4} />
        <Area type="monotone" dataKey="admin" name="Admin Earning" stroke="#16a34a" fill="url(#earnAdmin)" strokeWidth={2.4} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function RevenueCompositionChart({ data }: { data: any[] }) {
  if (!data.length) {
    return <div className="h-100 d-flex align-items-center justify-content-center text-muted">No chart data</div>;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={54} outerRadius={84} paddingAngle={3}>
          {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
        </Pie>
        <Tooltip formatter={(v: any) => fmtCur(v)} />
        <Legend iconType="circle" iconSize={8} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function TripStatusChart({ data }: { data: any[] }) {
  if (!data.length) {
    return <div className="h-100 d-flex align-items-center justify-content-center text-muted">No chart data</div>;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={48} outerRadius={80} paddingAngle={3}>
          {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
        </Pie>
        <Tooltip />
        <Legend iconType="circle" iconSize={8} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function PaymentDistributionChart({ data }: { data: any[] }) {
  if (!data.length) {
    return <div className="h-100 d-flex align-items-center justify-content-center text-muted">No chart data</div>;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={36} />
        <Tooltip />
        <Bar dataKey="value" radius={[8, 8, 0, 0]}>
          {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
