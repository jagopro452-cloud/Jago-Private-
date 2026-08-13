import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { adminFetch, apiRequest } from "@/lib/queryClient";

declare global {
  interface Window {
    io?: (url?: string, opts?: any) => any;
    RTCPeerConnection?: any;
    RTCSessionDescription?: any;
    RTCIceCandidate?: any;
  }
}

type AdminCallSession = {
  tripId: string;
  targetUserId: string;
  contactName: string;
  isIncoming: boolean;
  callMode: "support";
  callerType?: string;
};

const avatarBg = (name: string) => {
  const c = ["#1a73e8", "#16a34a", "#d97706", "#9333ea", "#0891b2", "#dc2626"];
  return c[(name || "A").charCodeAt(0) % c.length];
};

const fmtTime = (ts: string | number) =>
  new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

function loadAdminSession() {
  try {
    return JSON.parse(localStorage.getItem("jago-admin") || "{}");
  } catch {
    return {};
  }
}

async function ensureSocketIoScript() {
  if (window.io) return;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[data-admin-chat-socket="true"]') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Socket script failed")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "/socket.io/socket.io.js";
    script.async = true;
    script.dataset.adminChatSocket = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Socket script failed"));
    document.body.appendChild(script);
  });
}

export default function ChattingPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<any>(null);
  const [filter, setFilter] = useState("all");
  const [msgInput, setMsgInput] = useState("");
  const [search, setSearch] = useState("");
  const [callSession, setCallSession] = useState<AdminCallSession | null>(null);
  const [callStatus, setCallStatus] = useState<"idle" | "incoming" | "calling" | "connecting" | "connected" | "failed">("idle");
  const [callMuted, setCallMuted] = useState(false);
  const [callError, setCallError] = useState("");
  const [callDurationSec, setCallDurationSec] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const socketRef = useRef<any>(null);
  const peerRef = useRef<any>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingOfferRef = useRef<any>(null);
  const pendingIceRef = useRef<any[]>([]);
  const durationTimerRef = useRef<number | null>(null);
  const callSessionRef = useRef<AdminCallSession | null>(null);

  useEffect(() => {
    callSessionRef.current = callSession;
  }, [callSession]);

  const { data: custData } = useQuery<any>({
    queryKey: ["/api/users", { userType: "customer" }],
    queryFn: () => adminFetch("/api/users?userType=customer&limit=30").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error"); })).then(d => (d && !d.message && !d.error) ? d : { data: [] }),
  });
  const { data: driverData } = useQuery<any>({
    queryKey: ["/api/users", { userType: "driver" }],
    queryFn: () => adminFetch("/api/users?userType=driver&limit=30").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error"); })).then(d => (d && !d.message && !d.error) ? d : { data: [] }),
  });
  const { data: unreadData } = useQuery<any>({
    queryKey: ["/api/support-chat/unread-count"],
    queryFn: () => adminFetch("/api/support-chat/unread-count").then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error"); })).then(d => (d && !d.message && !d.error) ? d : {}),
    refetchInterval: 5000,
  });

  const { data: chatData, isLoading: chatLoading } = useQuery<any>({
    queryKey: ["/api/support-chat", selected?.id],
    queryFn: () => adminFetch(`/api/support-chat?userId=${selected.id}`).then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d?.message || "Error"); })).then(d => (d && !d.message && !d.error) ? d : { messages: [] }),
    enabled: !!selected?.id,
    refetchInterval: 3000,
  });

  const sendMutation = useMutation({
    mutationFn: (msg: string) => apiRequest("POST", "/api/support-chat", { userId: selected.id, message: msg, sender: "admin" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/support-chat", selected?.id] }); },
  });

  const customers = Array.isArray(custData?.data) ? custData.data : [];
  const drivers = Array.isArray(driverData?.data) ? driverData.data : [];
  const allUsers = filter === "customer" ? customers : filter === "driver" ? drivers : [...customers, ...drivers];
  const filtered = search ? allUsers.filter((u: any) => {
    const name = u.fullName || `${u.firstName || ""} ${u.lastName || ""}`.trim();
    return name.toLowerCase().includes(search.toLowerCase()) || (u.phone || "").includes(search);
  }) : allUsers;

  const messages: any[] = chatData?.messages || [];
  const unreadByUser: any[] = unreadData?.unreadByUser || [];
  const getUnread = (id: string) => {
    const found = unreadByUser.find((u: any) => u.userId === id || u.user_id === id);
    return found ? parseInt(found.unread || 0) : 0;
  };

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length]);

  useEffect(() => {
    let mounted = true;
    let cancelled = false;

    const resetCallResources = async () => {
      if (durationTimerRef.current != null) {
        window.clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }
      setCallDurationSec(0);
      pendingOfferRef.current = null;
      pendingIceRef.current = [];
      if (peerRef.current) {
        try { peerRef.current.close(); } catch {}
        peerRef.current = null;
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = null;
      }
      setCallMuted(false);
    };

    const finishCall = async (nextStatus: "idle" | "failed", errorMessage = "") => {
      await resetCallResources();
      setCallStatus(nextStatus);
      setCallError(errorMessage);
      if (nextStatus === "idle") {
        setCallSession(null);
        return;
      }
      window.setTimeout(() => {
        if (!mounted) return;
        setCallStatus("idle");
        setCallError("");
        setCallSession(null);
      }, 1800);
    };

    const flushPendingIce = async () => {
      if (!peerRef.current || !pendingIceRef.current.length) return;
      const PeerIce = window.RTCIceCandidate ?? RTCIceCandidate;
      for (const candidate of pendingIceRef.current) {
        try {
          await peerRef.current.addIceCandidate(new PeerIce(candidate));
        } catch {}
      }
      pendingIceRef.current = [];
    };

    const ensurePeer = async () => {
      if (peerRef.current) return peerRef.current;
      const PeerCtor = window.RTCPeerConnection ?? RTCPeerConnection;
      const peer = new PeerCtor({
        iceServers: [
          { urls: ["stun:stun.l.google.com:19302"] },
          { urls: ["stun:stun1.l.google.com:19302"] },
        ],
      });
      peer.ontrack = (event: any) => {
        const stream = event?.streams?.[0];
        if (remoteAudioRef.current && stream) {
          remoteAudioRef.current.srcObject = stream;
          remoteAudioRef.current.play().catch(() => {});
        }
      };
      peer.onicecandidate = (event: any) => {
        const session = callSessionRef.current;
        if (!event?.candidate || !session || !socketRef.current) return;
        socketRef.current.emit("call:ice", {
          targetUserId: session.targetUserId,
          tripId: session.tripId,
          candidate: {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
          },
        });
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") {
          setCallStatus("connected");
          if (durationTimerRef.current == null) {
            durationTimerRef.current = window.setInterval(() => {
              setCallDurationSec((prev) => prev + 1);
            }, 1000);
          }
        } else if (peer.connectionState === "failed" || peer.connectionState === "closed" || peer.connectionState === "disconnected") {
          void finishCall("idle");
        }
      };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      peerRef.current = peer;
      return peer;
    };

    const handleIncomingOffer = async (data: any) => {
      pendingOfferRef.current = data?.sdp;
      if (!callSessionRef.current) {
        setCallSession({
          tripId: String(data?.tripId || ""),
          targetUserId: String(data?.callerId || ""),
          contactName: "Jago User",
          isIncoming: true,
          callMode: "support",
        });
        setCallStatus("incoming");
      }
    };

    const connectSocket = async () => {
      const admin = loadAdminSession();
      if (!admin?.id || !admin?.token) return;
      await ensureSocketIoScript();
      if (!mounted || cancelled || !window.io) return;
      const socket = window.io(undefined, {
        transports: ["websocket", "polling"],
        query: { userId: admin.id, userType: "admin", token: admin.token },
        autoConnect: true,
        reconnection: true,
      });
      socketRef.current = socket;

      socket.on("call:incoming", (data: any) => {
        if (data?.callMode !== "support") return;
        if (callSessionRef.current) return;
        setCallError("");
        setCallSession({
          tripId: String(data.tripId || ""),
          targetUserId: String(data.callerId || ""),
          contactName: data.callerName || (data.callerType === "driver" ? "Driver" : "Customer"),
          isIncoming: true,
          callerType: data.callerType,
          callMode: "support",
        });
        setCallStatus("incoming");
      });

      socket.on("call:offer", (data: any) => {
        if (data?.callMode !== "support") return;
        void handleIncomingOffer(data);
      });

      socket.on("call:answer", async (data: any) => {
        if (data?.callMode !== "support" || !peerRef.current) return;
        try {
          const SessionDesc = window.RTCSessionDescription ?? RTCSessionDescription;
          await peerRef.current.setRemoteDescription(new SessionDesc(data.sdp));
          await flushPendingIce();
          setCallStatus("connected");
        } catch {
          await finishCall("failed", "Unable to connect support call.");
        }
      });

      socket.on("call:ice", async (data: any) => {
        if (data?.callMode !== "support") return;
        const candidate = data?.candidate;
        if (!candidate) return;
        if (!peerRef.current || !peerRef.current.remoteDescription) {
          pendingIceRef.current.push(candidate);
          return;
        }
        try {
          const PeerIce = window.RTCIceCandidate ?? RTCIceCandidate;
          await peerRef.current.addIceCandidate(new PeerIce(candidate));
        } catch {}
      });

      socket.on("call:ended", () => {
        void finishCall("idle");
      });

      socket.on("call:rejected", () => {
        void finishCall("failed", "Call was declined.");
      });

      socket.on("call:error", (data: any) => {
        void finishCall("failed", String(data?.message || "Call failed."));
      });
    };

    void connectSocket();

    return () => {
      cancelled = true;
      mounted = false;
      void resetCallResources();
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  const sendMsg = () => {
    if (!msgInput.trim() || !selected || sendMutation.isPending) return;
    sendMutation.mutate(msgInput.trim());
    setMsgInput("");
  };

  const selectedName = selected
    ? (selected.fullName || `${selected.firstName || ""} ${selected.lastName || ""}`.trim() || "User")
    : "";

  const startSupportCall = async (user: any) => {
    if (!socketRef.current || callStatus !== "idle") return;
    const name = user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim() || "User";
    const sessionId = `support-admin-${user.id}-${Date.now()}`;
    const session: AdminCallSession = {
      tripId: sessionId,
      targetUserId: user.id,
      contactName: name,
      isIncoming: false,
      callMode: "support",
      callerType: user.userType,
    };
    callSessionRef.current = session;
    setCallSession(session);
    setCallStatus("calling");
    setCallError("");
    try {
      const PeerCtor = window.RTCPeerConnection ?? RTCPeerConnection;
      if (!PeerCtor) throw new Error("WebRTC unavailable");
      const peer = await (async () => {
        if (peerRef.current) return peerRef.current;
        const created = new PeerCtor({
          iceServers: [
            { urls: ["stun:stun.l.google.com:19302"] },
            { urls: ["stun:stun1.l.google.com:19302"] },
          ],
        });
        created.ontrack = (event: any) => {
          const stream = event?.streams?.[0];
          if (remoteAudioRef.current && stream) {
            remoteAudioRef.current.srcObject = stream;
            remoteAudioRef.current.play().catch(() => {});
          }
        };
        created.onicecandidate = (event: any) => {
          const activeSession = callSessionRef.current;
          if (!event?.candidate || !activeSession || !socketRef.current) return;
          socketRef.current.emit("call:ice", {
            targetUserId: activeSession.targetUserId,
            tripId: activeSession.tripId,
            candidate: {
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid,
              sdpMLineIndex: event.candidate.sdpMLineIndex,
            },
          });
        };
        created.onconnectionstatechange = () => {
          if (created.connectionState === "connected") {
            setCallStatus("connected");
            if (durationTimerRef.current == null) {
              durationTimerRef.current = window.setInterval(() => {
                setCallDurationSec((prev) => prev + 1);
              }, 1000);
            }
          } else if (created.connectionState === "failed" || created.connectionState === "closed" || created.connectionState === "disconnected") {
            void endSupportCall(false);
          }
        };
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localStreamRef.current = stream;
        stream.getTracks().forEach((track) => created.addTrack(track, stream));
        peerRef.current = created;
        return created;
      })();
      socketRef.current.emit("call:initiate", {
        targetUserId: user.id,
        tripId: sessionId,
        callerName: "Jago Support",
      });
      const offer = await peer.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
      await peer.setLocalDescription(offer);
      socketRef.current.emit("call:offer", {
        targetUserId: user.id,
        tripId: sessionId,
        sdp: { type: offer.type, sdp: offer.sdp },
      });
    } catch {
      await endSupportCall(false, "Unable to start support call.");
    }
  };

  const acceptIncomingCall = async () => {
    const session = callSessionRef.current;
    if (!session || !socketRef.current) return;
    setCallStatus("connecting");
    setCallError("");
    try {
      const PeerCtor = window.RTCPeerConnection ?? RTCPeerConnection;
      const SessionDesc = window.RTCSessionDescription ?? RTCSessionDescription;
      if (!PeerCtor || !SessionDesc) throw new Error("WebRTC unavailable");
      if (!peerRef.current) {
        const peer = new PeerCtor({
          iceServers: [
            { urls: ["stun:stun.l.google.com:19302"] },
            { urls: ["stun:stun1.l.google.com:19302"] },
          ],
        });
        peer.ontrack = (event: any) => {
          const stream = event?.streams?.[0];
          if (remoteAudioRef.current && stream) {
            remoteAudioRef.current.srcObject = stream;
            remoteAudioRef.current.play().catch(() => {});
          }
        };
        peer.onicecandidate = (event: any) => {
          const activeSession = callSessionRef.current;
          if (!event?.candidate || !activeSession || !socketRef.current) return;
          socketRef.current.emit("call:ice", {
            targetUserId: activeSession.targetUserId,
            tripId: activeSession.tripId,
            candidate: {
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid,
              sdpMLineIndex: event.candidate.sdpMLineIndex,
            },
          });
        };
        peer.onconnectionstatechange = () => {
          if (peer.connectionState === "connected") {
            setCallStatus("connected");
            if (durationTimerRef.current == null) {
              durationTimerRef.current = window.setInterval(() => {
                setCallDurationSec((prev) => prev + 1);
              }, 1000);
            }
          } else if (peer.connectionState === "failed" || peer.connectionState === "closed" || peer.connectionState === "disconnected") {
            void endSupportCall(false);
          }
        };
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localStreamRef.current = stream;
        stream.getTracks().forEach((track) => peer.addTrack(track, stream));
        peerRef.current = peer;
      }
      if (pendingOfferRef.current) {
        await peerRef.current.setRemoteDescription(new SessionDesc(pendingOfferRef.current));
      }
      const answer = await peerRef.current.createAnswer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
      await peerRef.current.setLocalDescription(answer);
      socketRef.current.emit("call:answer", {
        targetUserId: session.targetUserId,
        tripId: session.tripId,
        sdp: { type: answer.type, sdp: answer.sdp },
      });
      const PeerIce = window.RTCIceCandidate ?? RTCIceCandidate;
      for (const candidate of pendingIceRef.current) {
        try {
          await peerRef.current.addIceCandidate(new PeerIce(candidate));
        } catch {}
      }
      pendingIceRef.current = [];
      setCallStatus("connected");
    } catch {
      await endSupportCall(false, "Unable to answer support call.");
    }
  };

  const rejectIncomingCall = async () => {
    const session = callSessionRef.current;
    if (session && socketRef.current) {
      socketRef.current.emit("call:reject", { targetUserId: session.targetUserId, tripId: session.tripId });
    }
    if (durationTimerRef.current != null) {
      window.clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    if (peerRef.current) {
      try { peerRef.current.close(); } catch {}
      peerRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    pendingOfferRef.current = null;
    pendingIceRef.current = [];
    setCallMuted(false);
    setCallDurationSec(0);
    setCallError("");
    setCallStatus("idle");
    setCallSession(null);
    callSessionRef.current = null;
  };

  const endSupportCall = async (notifyRemote = true, errorMessage = "") => {
    const session = callSessionRef.current;
    if (notifyRemote && session && socketRef.current) {
      socketRef.current.emit("call:end", {
        targetUserId: session.targetUserId,
        tripId: session.tripId,
        durationSec: callDurationSec,
      });
    }
    if (durationTimerRef.current != null) {
      window.clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    if (peerRef.current) {
      try { peerRef.current.close(); } catch {}
      peerRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    pendingOfferRef.current = null;
    pendingIceRef.current = [];
    setCallMuted(false);
    setCallDurationSec(0);
    callSessionRef.current = null;
    if (errorMessage) {
      setCallError(errorMessage);
      setCallStatus("failed");
      window.setTimeout(() => {
        setCallStatus("idle");
        setCallError("");
        setCallSession(null);
      }, 1800);
      return;
    }
    setCallStatus("idle");
    setCallError("");
    setCallSession(null);
  };

  const toggleMute = () => {
    const nextMuted = !callMuted;
    setCallMuted(nextMuted);
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
  };

  const callStatusText = () => {
    if (callError) return callError;
    if (callStatus === "incoming") return "Incoming support call";
    if (callStatus === "calling") return "Calling...";
    if (callStatus === "connecting") return "Connecting...";
    if (callStatus === "connected") return `${String(Math.floor(callDurationSec / 60)).padStart(2, "0")}:${String(callDurationSec % 60).padStart(2, "0")}`;
    if (callStatus === "failed") return "Call failed";
    return "Ready";
  };

  return (
    <div className="container-fluid px-0">
      <audio ref={remoteAudioRef} autoPlay hidden />
      {callSession ? (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15,23,42,0.72)",
          zIndex: 1055,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}>
          <div style={{
            width: "100%",
            maxWidth: 420,
            borderRadius: 28,
            background: "linear-gradient(180deg, #0f172a 0%, #1e293b 100%)",
            color: "#fff",
            boxShadow: "0 28px 80px rgba(15,23,42,0.45)",
            padding: 28,
            textAlign: "center",
          }}>
            <div className="mx-auto mb-3 rounded-circle d-flex align-items-center justify-content-center"
              style={{ width: 84, height: 84, background: "rgba(96,165,250,0.18)", border: "2px solid rgba(96,165,250,0.45)" }}>
              <i className="bi bi-headset" style={{ fontSize: 34 }}></i>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{callSession.contactName}</div>
            <div style={{ color: "#cbd5e1", marginTop: 8 }}>{callStatusText()}</div>
            {callSession.callerType ? (
              <div style={{ color: "#94a3b8", marginTop: 6, fontSize: 13, textTransform: "capitalize" }}>{callSession.callerType} support line</div>
            ) : null}
            <div className="d-flex justify-content-center gap-3 mt-4">
              {callStatus === "incoming" ? (
                <>
                  <button className="btn btn-danger rounded-circle d-flex align-items-center justify-content-center" style={{ width: 64, height: 64 }} onClick={() => void rejectIncomingCall()}>
                    <i className="bi bi-telephone-x-fill"></i>
                  </button>
                  <button className="btn btn-success rounded-circle d-flex align-items-center justify-content-center" style={{ width: 64, height: 64 }} onClick={() => void acceptIncomingCall()}>
                    <i className="bi bi-telephone-fill"></i>
                  </button>
                </>
              ) : (
                <>
                  <button className={`btn ${callMuted ? "btn-warning" : "btn-outline-light"} rounded-circle d-flex align-items-center justify-content-center`} style={{ width: 56, height: 56 }} onClick={toggleMute}>
                    <i className={`bi ${callMuted ? "bi-mic-mute-fill" : "bi-mic-fill"}`}></i>
                  </button>
                  <button className="btn btn-danger rounded-circle d-flex align-items-center justify-content-center" style={{ width: 64, height: 64 }} onClick={() => void endSupportCall(true)}>
                    <i className="bi bi-telephone-x-fill"></i>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
      <div className="d-flex" style={{ height: "calc(100vh - 130px)", minHeight: 600 }}>
        <div className="border-end d-flex flex-column" style={{ width: 300, flexShrink: 0 }}>
          <div className="p-3 border-bottom">
            <h6 className="fw-bold mb-2">Support Chats</h6>
            <div className="input-group input-group-sm">
              <span className="input-group-text bg-light border-0"><i className="bi bi-search text-muted"></i></span>
              <input className="form-control border-0 bg-light" placeholder="Search users..." value={search}
                onChange={e => setSearch(e.target.value)} data-testid="input-chat-search" />
            </div>
          </div>
          <div className="px-2 py-2 border-bottom">
            <div className="btn-group btn-group-sm w-100">
              {["all", "customer", "driver"].map(t => (
                <button key={t} className={`btn ${filter === t ? "btn-primary" : "btn-outline-secondary"} text-capitalize`}
                  onClick={() => setFilter(t)} data-testid={`btn-filter-${t}`}>{t}</button>
              ))}
            </div>
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.length === 0 ? (
              <div className="text-center py-5 text-muted">
                <i className="bi bi-chat-left-dots fs-2 d-block mb-2 opacity-25"></i>
                <small>No users found</small>
              </div>
            ) : filtered.map((u: any) => {
              const name = u.fullName || `${u.firstName || ""} ${u.lastName || ""}`.trim() || "User";
              const isSelected = selected?.id === u.id;
              const unread = getUnread(u.id);
              return (
                <div key={u.id} onClick={() => setSelected(u)} data-testid={`chat-user-${u.id}`}
                  className={`d-flex align-items-center gap-3 px-3 py-2 border-bottom ${isSelected ? "bg-primary bg-opacity-10" : ""}`}
                  style={{ cursor: "pointer" }}>
                  <div className="position-relative flex-shrink-0">
                    <div className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                      style={{ width: 40, height: 40, fontSize: "0.9rem", background: avatarBg(name) }}>
                      {name[0]?.toUpperCase()}
                    </div>
                    <span className="position-absolute bottom-0 end-0 rounded-circle border border-white"
                      style={{ width: 10, height: 10, background: "#16a34a" }}></span>
                  </div>
                  <div className="flex-grow-1 min-w-0">
                    <div className="d-flex justify-content-between align-items-center">
                      <span className="fw-semibold text-truncate" style={{ fontSize: "0.85rem" }}>{name}</span>
                      {unread > 0 && (
                        <span className="badge bg-danger rounded-pill" style={{ fontSize: "0.65rem" }}>{unread}</span>
                      )}
                    </div>
                    <small className="text-muted text-truncate d-block">
                      {u.userType === "driver" ? "Driver" : "Customer"} · {u.phone || "-"}
                    </small>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex-grow-1 d-flex flex-column">
          {selected ? (
            <>
              <div className="p-3 border-bottom bg-white d-flex align-items-center justify-content-between">
                <div className="d-flex align-items-center gap-3">
                  <div className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold"
                    style={{ width: 42, height: 42, background: avatarBg(selectedName) }}>
                    {selectedName[0]?.toUpperCase()}
                  </div>
                  <div>
                    <div className="fw-semibold">{selectedName}</div>
                    <small className="text-muted">{selected.phone} · {selected.userType === "driver" ? "Driver" : "Customer"}</small>
                  </div>
                </div>
                <div className="d-flex gap-2">
                  <button
                    className="btn btn-sm btn-outline-primary"
                    title="In-app support call"
                    disabled={callStatus !== "idle"}
                    onClick={() => void startSupportCall(selected)}
                  >
                    <i className="bi bi-telephone-fill"></i>
                  </button>
                  <button className="btn btn-sm btn-outline-secondary" title="Clear" onClick={() => setSelected(null)}>
                    <i className="bi bi-x-lg"></i>
                  </button>
                </div>
              </div>

              <div className="flex-grow-1 p-3 overflow-auto" style={{ background: "#f8fafc" }}>
                {chatLoading ? (
                  <div className="text-center py-5 text-muted">
                    <div className="spinner-border spinner-border-sm me-2"></div>Loading messages...
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-5 text-muted">
                    <i className="bi bi-chat-left-dots fs-2 d-block mb-2 opacity-25"></i>
                    <p className="small">No messages yet. Start the conversation!</p>
                  </div>
                ) : messages.map((msg: any, i: number) => (
                  <div key={i} className={`d-flex mb-3 ${msg.sender === "admin" ? "justify-content-end" : "justify-content-start"}`}>
                    {msg.sender !== "admin" && (
                      <div className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold me-2 flex-shrink-0"
                        style={{ width: 32, height: 32, fontSize: "0.75rem", background: avatarBg(selectedName), alignSelf: "flex-end" }}>
                        {selectedName[0]?.toUpperCase()}
                      </div>
                    )}
                    <div>
                      <div className="px-3 py-2 shadow-sm"
                        style={{
                          maxWidth: 340, fontSize: "0.875rem",
                          background: msg.sender === "admin" ? "#1a73e8" : "#fff",
                          color: msg.sender === "admin" ? "#fff" : "#1e293b",
                          borderRadius: msg.sender === "admin" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                        }}>
                        {msg.message}
                      </div>
                      <div className={`text-muted mt-1 ${msg.sender === "admin" ? "text-end" : ""}`} style={{ fontSize: "0.7rem" }}>
                        {fmtTime(msg.createdAt)}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <div className="p-3 border-top bg-white">
                <div className="input-group">
                  <input className="form-control border-0 bg-light rounded-start-3"
                    placeholder="Type a message..." value={msgInput}
                    onChange={e => setMsgInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && sendMsg()}
                    data-testid="input-chat-message" />
                  <button className="btn btn-primary px-4" onClick={sendMsg}
                    disabled={sendMutation.isPending} data-testid="btn-send-message">
                    {sendMutation.isPending
                      ? <span className="spinner-border spinner-border-sm"></span>
                      : <i className="bi bi-send-fill"></i>}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-grow-1 d-flex align-items-center justify-content-center text-muted">
              <div className="text-center">
                <i className="bi bi-chat-left-dots fs-1 d-block mb-3 opacity-25"></i>
                <h5 className="fw-semibold">Select a conversation</h5>
                <p className="mb-0 small">Choose a user from the left to start chatting</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
