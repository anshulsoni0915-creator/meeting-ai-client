const API_BASE = import.meta.env.VITE_API_URL || `${API_BASE}`;
import { useState, useEffect, useRef } from "react";

export default function AudioUpload() {
  const [file, setFile] = useState(null);
  const [targetLanguage, setTargetLanguage] = useState("Original");
  const [uploadPin, setUploadPin] = useState("");
  const [status, setStatus] = useState("Idle");
  const [loading, setLoading] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  const [currentMeeting, setCurrentMeeting] = useState(null);
  const [savedMeetings, setSavedMeetings] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("summary");

  const [editingSpeaker, setEditingSpeaker] = useState(null);
  const [newSpeakerName, setNewSpeakerName] = useState("");

  const [question, setQuestion] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [askingAi, setAskingAi] = useState(false);

  const [sessionPin, setSessionPin] = useState("");

  const fetchMeetings = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/meetings`);
      const data = await res.json();
      if (data.success) {
        setSavedMeetings(data.meetings);
      }
    } catch (err) {
      console.error("Failed to fetch saved meetings:", err);
    }
  };

  useEffect(() => {
    fetchMeetings();
  }, []);

  const uploadMediaBlob = async (mediaFile, customLanguage = targetLanguage) => {
    const formData = new FormData();
    formData.append("audio", mediaFile);
    formData.append("targetLanguage", customLanguage);
    if (uploadPin.trim()) formData.append("accessPin", uploadPin.trim());

    setLoading(true);
    setStatus("Transcribing, translating, identifying speakers & summarizing...");

    try {
      const response = await fetch(`${API_BASE}/api/meetings/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      if (response.ok && data.success) {
        setStatus("Complete!");
        setCurrentMeeting(data.meeting);
        setChatHistory([]);
        setActiveTab("summary");
        fetchMeetings();
      } else {
        setStatus(`Error: ${data.error || "Processing failed"}`);
      }
    } catch (err) {
      console.error(err);
      setStatus("Failed to connect to the backend server (check file size <= 25MB).");
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!file) return alert("Please select an audio or video file.");
    await uploadMediaBlob(file);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const recordedFile = new File([blob], `Live_Recording_${Date.now()}.webm`, {
          type: "audio/webm",
        });
        await uploadMediaBlob(recordedFile);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSeconds(0);
      setStatus("Recording live microphone audio...");

      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      alert("Microphone access denied or unavailable in this browser.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(timerRef.current);
    }
  };

  const handleDeleteMeeting = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm("Delete this meeting permanently?")) return;

    try {
      const res = await fetch(`${API_BASE}/api/meetings/${id}`, {
        method: "DELETE",
        headers: { "x-access-pin": sessionPin },
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || "Delete failed");

      if (currentMeeting?._id === id) setCurrentMeeting(null);
      fetchMeetings();
    } catch (err) {
      alert("Failed to delete meeting.");
    }
  };

  const handleRenameSpeaker = async (oldName) => {
    if (!newSpeakerName.trim() || newSpeakerName.trim() === oldName) {
      setEditingSpeaker(null);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/meetings/${currentMeeting._id}/speakers`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-access-pin": sessionPin,
        },
        body: JSON.stringify({ oldName, newName: newSpeakerName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || "Failed to rename speaker");

      setCurrentMeeting(data.meeting);
      setEditingSpeaker(null);
      fetchMeetings();
    } catch (err) {
      alert("Error updating speaker name.");
    }
  };

  const handleAskQuestion = async (e) => {
    e.preventDefault();
    if (!question.trim() || !currentMeeting) return;

    const userQ = question.trim();
    setQuestion("");
    setAskingAi(true);
    setChatHistory((prev) => [...prev, { role: "user", text: userQ }]);

    try {
      const res = await fetch(`${API_BASE}/api/meetings/${currentMeeting._id}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: userQ }),
      });
      const data = await res.json();
      setChatHistory((prev) => [
        ...prev,
        { role: "ai", text: data.success ? data.answer : `Error: ${data.error}` },
      ]);
    } catch (err) {
      setChatHistory((prev) => [...prev, { role: "ai", text: "Failed to reach AI assistant." }]);
    } finally {
      setAskingAi(false);
    }
  };

  const handleTogglePinLock = async () => {
    const newPin = prompt(
      currentMeeting.accessPin
        ? "Enter a new 4-digit PIN (or leave blank to unlock):"
        : "Set an optional 4-digit Access PIN to protect edits/deletion:"
    );
    if (newPin === null) return;

    try {
      const res = await fetch(`${API_BASE}/api/meetings/${currentMeeting._id}/access`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-access-pin": sessionPin,
        },
        body: JSON.stringify({ accessPin: newPin }),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || "PIN update failed");

      setSessionPin(newPin.trim());
      setCurrentMeeting(data.meeting);
      fetchMeetings();
    } catch (err) {
      alert("Failed to update access policy.");
    }
  };

  const filteredMeetings = savedMeetings.filter(
    (m) =>
      m.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.detectedLanguage?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.targetLanguage?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Aggregate research paper metrics across all processed meetings
  const benchmarked = savedMeetings.filter((m) => m.metrics?.processingTimeMs > 0);
  const avgLatencySec =
    benchmarked.length > 0
      ? (
          benchmarked.reduce((acc, m) => acc + m.metrics.processingTimeMs, 0) /
          benchmarked.length /
          1000
        ).toFixed(2)
      : "N/A";
  const avgRtf =
    benchmarked.length > 0
      ? (
          benchmarked.reduce((acc, m) => acc + (m.metrics.realTimeFactor || 0), 0) /
          benchmarked.length
        ).toFixed(3)
      : "N/A";

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "system-ui, sans-serif", backgroundColor: "#f8fafc", color: "#0f172a" }}>
      {/* Left Sidebar: Searchable Saved Meetings + Delete */}
      <div style={{ width: "290px", backgroundColor: "#0f172a", color: "#f8fafc", padding: "1.25rem", borderRight: "1px solid #1e293b", display: "flex", flexDirection: "column" }}>
        <h3 style={{ marginTop: 0, marginBottom: "0.75rem" }}>
          Saved Meetings ({savedMeetings.length})
        </h3>

        <input
          type="text"
          placeholder="Search title or language..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            padding: "0.5rem 0.65rem",
            borderRadius: "6px",
            border: "1px solid #334155",
            backgroundColor: "#1e293b",
            color: "#f8fafc",
            marginBottom: "0.75rem",
            fontSize: "0.85rem",
          }}
        />

        <input
          type="password"
          placeholder="Session Access PIN (if locked)"
          value={sessionPin}
          onChange={(e) => setSessionPin(e.target.value)}
          style={{
            padding: "0.4rem 0.65rem",
            borderRadius: "6px",
            border: "1px solid #334155",
            backgroundColor: "#1e293b",
            color: "#cbd5e1",
            marginBottom: "1rem",
            fontSize: "0.8rem",
          }}
        />

        {filteredMeetings.length === 0 ? (
          <p style={{ fontSize: "0.9rem", color: "#94a3b8" }}>No matching meetings.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", overflowY: "auto" }}>
            {filteredMeetings.map((m) => (
              <div
                key={m._id}
                onClick={() => {
                  setCurrentMeeting(m);
                  setChatHistory([]);
                  setActiveTab("summary");
                }}
                style={{
                  padding: "0.75rem",
                  borderRadius: "6px",
                  cursor: "pointer",
                  backgroundColor: currentMeeting?._id === m._id ? "#2563eb" : "#1e293b",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "0.5rem",
                }}
              >
                <div>
                  <div style={{ fontWeight: "600", fontSize: "0.9rem" }}>
                    {m.accessPin ? "🔒 " : ""}
                    {m.title}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#cbd5e1", marginTop: "0.25rem" }}>
                    {m.detectedLanguage?.toUpperCase()} → {m.targetLanguage}
                  </div>
                </div>
                <button
                  onClick={(e) => handleDeleteMeeting(e, m._id)}
                  title="Delete meeting"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#fca5a5",
                    cursor: "pointer",
                    fontWeight: "bold",
                    fontSize: "0.9rem",
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, padding: "2rem", maxWidth: "940px", margin: "0 auto" }}>
        <h1 style={{ marginTop: 0, color: "#0f172a", fontSize: "2rem", lineHeight: 1.25 }}>
          AI Multilingual Meeting Summarizer
        </h1>

        {/* Research Paper Live Benchmark Bar */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem", marginBottom: "1.25rem" }}>
          <div style={{ backgroundColor: "#fff", padding: "0.85rem", borderRadius: "8px", boxShadow: "0 1px 2px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: "0.75rem", color: "#64748b" }}>Evaluated Samples (N)</div>
            <div style={{ fontSize: "1.25rem", fontWeight: "700", color: "#0f172a" }}>{savedMeetings.length}</div>
          </div>
          <div style={{ backgroundColor: "#fff", padding: "0.85rem", borderRadius: "8px", boxShadow: "0 1px 2px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: "0.75rem", color: "#64748b" }}>Avg End-to-End Latency</div>
            <div style={{ fontSize: "1.25rem", fontWeight: "700", color: "#2563eb" }}>{avgLatencySec}s</div>
          </div>
          <div style={{ backgroundColor: "#fff", padding: "0.85rem", borderRadius: "8px", boxShadow: "0 1px 2px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: "0.75rem", color: "#64748b" }}>Avg Real-Time Factor</div>
            <div style={{ fontSize: "1.25rem", fontWeight: "700", color: "#059669" }}>{avgRtf}x</div>
          </div>
          <div style={{ backgroundColor: "#fff", padding: "0.85rem", borderRadius: "8px", boxShadow: "0 1px 2px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: "0.75rem", color: "#64748b" }}>ASR + LLM Pipeline</div>
            <div style={{ fontSize: "0.95rem", fontWeight: "700", color: "#0f172a", marginTop: "0.2rem" }}>Whisper-v3 + Llama</div>
          </div>
        </div>

        {/* Upload, Live Mic Recording & Language Controls */}
        <div style={{ backgroundColor: "#fff", padding: "1.5rem", borderRadius: "10px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.85rem", alignItems: "center" }}>
            <input
              type="file"
              accept="audio/*,video/mp4,video/webm,video/mpeg,video/quicktime,.mp4,.webm,.mkv,.mp3,.wav,.ogg,.m4a"
              style={{ color: "#1e293b" }}
              onChange={(e) => setFile(e.target.files[0])}
            />

            <div>
              <label style={{ fontWeight: "600", marginRight: "0.4rem", color: "#1e293b", fontSize: "0.9rem" }}>Output:</label>
              <select
                value={targetLanguage}
                onChange={(e) => setTargetLanguage(e.target.value)}
                style={{ padding: "0.45rem", borderRadius: "6px", border: "1px solid #cbd5e1" }}
              >
                <option value="Original">Keep Original Language</option>
                <option value="English">English</option>
                <option value="Hindi">Hindi</option>
                <option value="Spanish">Spanish</option>
                <option value="French">French</option>
                <option value="German">German</option>
                <option value="Japanese">Japanese</option>
              </select>
            </div>

            <input
              type="password"
              placeholder="Optional PIN"
              value={uploadPin}
              onChange={(e) => setUploadPin(e.target.value)}
              style={{ width: "110px", padding: "0.45rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.85rem" }}
            />

            <button
              onClick={handleUpload}
              disabled={loading || isRecording}
              style={{
                padding: "0.55rem 1.1rem",
                backgroundColor: loading ? "#94a3b8" : "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight: "600",
              }}
            >
              {loading ? "Processing..." : "Upload & Analyze"}
            </button>

            {!isRecording ? (
              <button
                onClick={startRecording}
                disabled={loading}
                style={{
                  padding: "0.55rem 1.1rem",
                  backgroundColor: "#059669",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: "600",
                }}
              >
                🎙️ Record Live Mic
              </button>
            ) : (
              <button
                onClick={stopRecording}
                style={{
                  padding: "0.55rem 1.1rem",
                  backgroundColor: "#dc2626",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: "600",
                }}
              >
                ⏹️ Stop & Analyze ({recordingSeconds}s)
              </button>
            )}
          </div>
          <p style={{ marginBottom: 0, marginTop: "0.75rem", fontSize: "0.9rem", color: "#475569" }}>
            <strong>Status:</strong> {status}
          </p>
        </div>

        {/* Results Dashboard */}
        {currentMeeting && (
          <div style={{ backgroundColor: "#fff", padding: "1.5rem", borderRadius: "10px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
            <div style={{ borderBottom: "1px solid #e2e8f0", paddingBottom: "1rem", marginBottom: "1rem" }}>
              <h2 style={{ margin: 0, color: "#0f172a" }}>{currentMeeting.title}</h2>
              <div style={{ fontSize: "0.85rem", color: "#64748b", marginTop: "0.25rem" }}>
                File: {currentMeeting.originalFileName} | Detected: <strong>{currentMeeting.detectedLanguage}</strong> | Output: <strong>{currentMeeting.targetLanguage}</strong>
              </div>

              {currentMeeting.metrics?.processingTimeMs > 0 && (
                <div style={{ fontSize: "0.8rem", color: "#0f766e", backgroundColor: "#f0fdfa", padding: "0.4rem 0.75rem", borderRadius: "6px", marginTop: "0.5rem", display: "inline-block" }}>
                  <strong>Paper Metrics:</strong> Audio Duration: {currentMeeting.metrics.audioDurationSec}s | Latency: {(currentMeeting.metrics.processingTimeMs / 1000).toFixed(2)}s | RTF: {currentMeeting.metrics.realTimeFactor}x | Words: {currentMeeting.metrics.wordCount} | Speakers: {currentMeeting.metrics.speakerCount}
                </div>
              )}

              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", marginTop: "0.75rem" }}>
                <a
                  href={`${API_BASE}/api/meetings/${currentMeeting._id}/export/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ padding: "0.4rem 0.85rem", backgroundColor: "#dc2626", color: "#fff", borderRadius: "6px", textDecoration: "none", fontSize: "0.85rem", fontWeight: "600" }}
                >
                  Download PDF
                </a>
                <a
                  href={`${API_BASE}/api/meetings/${currentMeeting._id}/export/docx`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ padding: "0.4rem 0.85rem", backgroundColor: "#0284c7", color: "#fff", borderRadius: "6px", textDecoration: "none", fontSize: "0.85rem", fontWeight: "600" }}
                >
                  Download Word (.docx)
                </a>
                <button
                  onClick={handleTogglePinLock}
                  style={{ padding: "0.4rem 0.85rem", backgroundColor: "#475569", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontSize: "0.85rem", fontWeight: "600" }}
                >
                  {currentMeeting.accessPin ? "🔒 Update/Unlock PIN" : "🔓 Set Access PIN"}
                </button>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1.25rem" }}>
              {[
                { id: "summary", label: "AI Summary & Action Items" },
                { id: "diarization", label: "Speaker Diarization (Click to Rename)" },
                { id: "transcript", label: "Original & Translated Text" },
                { id: "chat", label: "💬 Ask Your Meeting (AI Chat)" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: "6px",
                    border: "none",
                    cursor: "pointer",
                    fontWeight: "600",
                    backgroundColor: activeTab === tab.id ? "#2563eb" : "#e2e8f0",
                    color: activeTab === tab.id ? "#fff" : "#1e293b",
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab 1: Summary & Action Items */}
            {activeTab === "summary" && (
              <div>
                <h3>Executive Summary</h3>
                <p style={{ lineHeight: 1.6 }}>{currentMeeting.summary?.executiveSummary}</p>

                <h3>Key Discussion Points</h3>
                <ul>
                  {currentMeeting.summary?.keyPoints?.map((pt, idx) => (
                    <li key={idx} style={{ marginBottom: "0.4rem" }}>{pt}</li>
                  ))}
                </ul>

                <h3>Action Items</h3>
                {currentMeeting.summary?.actionItems?.length > 0 ? (
                  <ul>
                    {currentMeeting.summary.actionItems.map((item, idx) => (
                      <li key={idx} style={{ marginBottom: "0.4rem" }}>
                        <strong>[{item.owner}]</strong>: {item.task}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ color: "#64748b" }}>No specific action items detected.</p>
                )}
              </div>
            )}

            {/* Tab 2: Interactive Speaker Diarization with Inline Renaming */}
            {activeTab === "diarization" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <p style={{ margin: 0, fontSize: "0.85rem", color: "#64748b" }}>
                  Tip: Click any speaker name to rename them across the entire meeting and action items.
                </p>
                {currentMeeting.diarizedSegments?.map((seg, idx) => (
                  <div key={idx} style={{ padding: "0.75rem", backgroundColor: "#f8fafc", borderLeft: "4px solid #2563eb", borderRadius: "4px" }}>
                    <div style={{ fontSize: "0.85rem", fontWeight: "700", color: "#2563eb", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      {editingSpeaker === `${idx}-${seg.speaker}` ? (
                        <>
                          <input
                            type="text"
                            value={newSpeakerName}
                            onChange={(e) => setNewSpeakerName(e.target.value)}
                            style={{ padding: "0.2rem 0.4rem", borderRadius: "4px", border: "1px solid #2563eb" }}
                          />
                          <button
                            onClick={() => handleRenameSpeaker(seg.speaker)}
                            style={{ padding: "0.2rem 0.5rem", backgroundColor: "#2563eb", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem" }}
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingSpeaker(null)}
                            style={{ padding: "0.2rem 0.5rem", backgroundColor: "#cbd5e1", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem" }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <span
                          onClick={() => {
                            setEditingSpeaker(`${idx}-${seg.speaker}`);
                            setNewSpeakerName(seg.speaker);
                          }}
                          title="Click to rename speaker"
                          style={{ cursor: "pointer", textDecoration: "underline dotted" }}
                        >
                          {seg.speaker} ✎
                        </span>
                      )}
                      <span style={{ color: "#64748b", fontWeight: "400" }}>({seg.start}s - {seg.end}s)</span>
                    </div>
                    <div style={{ marginTop: "0.3rem" }}>{seg.text}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Tab 3: Raw vs Translated Transcript */}
            {activeTab === "transcript" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                <div>
                  <h4>Original Transcript ({currentMeeting.detectedLanguage})</h4>
                  <div style={{ padding: "1rem", backgroundColor: "#f8fafc", borderRadius: "6px", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                    {currentMeeting.rawTranscript}
                  </div>
                </div>
                <div>
                  <h4>Translated Transcript ({currentMeeting.targetLanguage})</h4>
                  <div style={{ padding: "1rem", backgroundColor: "#f0fdf4", borderRadius: "6px", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                    {currentMeeting.translatedTranscript}
                  </div>
                </div>
              </div>
            )}

            {/* Tab 4: Interactive "Ask Your Meeting" AI Chat */}
            {activeTab === "chat" && (
              <div>
                <div style={{ minHeight: "180px", maxHeight: "320px", overflowY: "auto", backgroundColor: "#f8fafc", padding: "1rem", borderRadius: "8px", marginBottom: "0.75rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                  {chatHistory.length === 0 ? (
                    <p style={{ color: "#64748b", margin: 0, fontSize: "0.9rem" }}>
                      Ask anything about this meeting — e.g., <em>"What were the main decisions?"</em> or <em>"Draft a follow-up email summarizing action items."</em>
                    </p>
                  ) : (
                    chatHistory.map((msg, i) => (
                      <div
                        key={i}
                        style={{
                          alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                          backgroundColor: msg.role === "user" ? "#2563eb" : "#fff",
                          color: msg.role === "user" ? "#fff" : "#0f172a",
                          padding: "0.65rem 0.9rem",
                          borderRadius: "8px",
                          maxWidth: "80%",
                          boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                          whiteSpace: "pre-wrap",
                          fontSize: "0.9rem",
                        }}
                      >
                        <strong>{msg.role === "user" ? "You: " : "Meeting AI: "}</strong>
                        {msg.text}
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={handleAskQuestion} style={{ display: "flex", gap: "0.5rem" }}>
                  <input
                    type="text"
                    placeholder="Ask a question about this meeting..."
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    style={{ flex: 1, padding: "0.6rem", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                  />
                  <button
                    type="submit"
                    disabled={askingAi}
                    style={{ padding: "0.6rem 1.2rem", backgroundColor: "#2563eb", color: "#fff", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "600" }}
                  >
                    {askingAi ? "Thinking..." : "Ask AI"}
                  </button>
                </form>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

