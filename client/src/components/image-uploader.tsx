import { useState, useRef } from "react";

export function ImageUploader({ label, value, onChange, testId, height = 130 }: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  testId: string;
  height?: number;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (data.url) onChange(data.url);
    } catch {}
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#374151" }}>{label}</div>
      <div
        style={{
          border: `2px dashed ${value && !uploading ? "#16a34a" : "#e2e8f0"}`,
          borderRadius: 12,
          background: value && !uploading ? "#f0fdf4" : "#fafafa",
          minHeight: height,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          cursor: "pointer",
          transition: "all 0.2s",
          overflow: "hidden",
          position: "relative",
        }}
        onClick={() => !uploading && inputRef.current?.click()}
        data-testid={`img-upload-area-${testId}`}
      >
        {uploading ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <div className="spinner-border spinner-border-sm text-primary" role="status" />
            <div style={{ fontSize: 11, color: "#94a3b8" }}>Uploading…</div>
          </div>
        ) : value ? (
          <>
            <img
              src={value}
              alt={label}
              style={{ width: "100%", height, objectFit: "cover", borderRadius: 10 }}
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(0,0,0,0)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: 0,
                transition: "all 0.2s",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,0,0,0.35)", e.currentTarget.style.opacity = "1")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(0,0,0,0)", e.currentTarget.style.opacity = "0")}
            >
              <span style={{ background: "rgba(0,0,0,0.65)", color: "white", padding: "5px 12px", borderRadius: 20, fontSize: 12 }}>
                <i className="bi bi-pencil me-1"></i>Change
              </span>
            </div>
          </>
        ) : (
          <>
            <i className="bi bi-cloud-upload" style={{ fontSize: 24, color: "#94a3b8" }}></i>
            <div style={{ fontSize: 11, color: "#94a3b8", textAlign: "center", lineHeight: 1.4 }}>
              Click to upload<br />
              <span style={{ fontSize: 10 }}>JPG, PNG, PDF — max 8MB</span>
            </div>
          </>
        )}
      </div>
      {value && !uploading && (
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            style={{ flex: 1, fontSize: 10, padding: "4px 8px", borderRadius: 6, background: "#f1f5f9", border: "1px solid #e2e8f0", cursor: "pointer", color: "#64748b" }}
            onClick={() => inputRef.current?.click()}
          >
            <i className="bi bi-arrow-repeat me-1"></i>Replace
          </button>
          <button
            type="button"
            style={{ fontSize: 10, padding: "4px 8px", borderRadius: 6, background: "#fee2e2", border: "1px solid #fca5a5", cursor: "pointer", color: "#dc2626" }}
            onClick={e => { e.stopPropagation(); onChange(""); }}
          >
            <i className="bi bi-trash"></i>
          </button>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.pdf"
        style={{ display: "none" }}
        onChange={handleFile}
        data-testid={`input-upload-${testId}`}
      />
    </div>
  );
}
