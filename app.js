(() => {
  const STORAGE_KEY_API = "lumina_gemini_api_key";
  const STORAGE_KEY_NOTES = "lumina_saved_notes_v1";
  const MODEL = "models/gemini-3.8-live";

  const SYSTEM_INSTRUCTION = `คุณคือ "ลูมิน่า" (Lumina) เลขาส่วนตัว AI ของผู้ใช้ สำหรับโทรคุยและช่วยสรุปงานผ่านมือถือ
พูดภาษาไทยที่เป็นธรรมชาติ สุภาพ อบอุ่น กระชับ และคล่องแคล่ว (ลงท้าย "ค่ะ")

หน้าที่หลักของลูมิน่า:
1. รับฟังเรื่องงาน ประชุม หรือไอเดียที่ผู้ใช้เล่าให้ฟังอย่างตั้งใจ ช่วยถามต่อสั้นๆ หรือช่วยจัดลำดับความสำคัญ
2. เมื่อผู้ใช้บอกให้จดไอเดีย สรุปงาน หรือเล่าเรื่องสำคัญเสร็จ ให้เรียกใช้เครื่องมือ save_idea ทันที โดยจัดระเบียบ title และ content ให้ชัดเจน (ประเด็นสำคัญ / สิ่งที่ทำแล้ว / งานที่ต้องทำต่อ)
3. หลังบันทึกเสร็จ ให้แจ้งผู้ใช้สั้นๆ ว่าบันทึกเก็บไว้เรียบร้อยแล้ว
4. พูดสั้น กระชับ เหมือนคุยโทรศัพท์จริงๆ ไม่ต้องอ่านสัญลักษณ์ markdown`;

  const callBtn = document.getElementById("callBtn");
  const muteBtn = document.getElementById("muteBtn");
  const keyBtn = document.getElementById("keyBtn");
  const keyBox = document.getElementById("keyBox");
  const keyInput = document.getElementById("keyInput");
  const saveKeyBtn = document.getElementById("saveKeyBtn");
  const orb = document.getElementById("orb");
  const statusText = document.getElementById("statusText");
  const subStatus = document.getElementById("subStatus");
  const logList = document.getElementById("logList");
  const textForm = document.getElementById("textForm");
  const textInput = document.getElementById("textInput");
  const sendBtn = document.getElementById("sendBtn");
  const tabCall = document.getElementById("tabCall");
  const tabNotes = document.getElementById("tabNotes");
  const panelCall = document.getElementById("panelCall");
  const panelNotes = document.getElementById("panelNotes");
  const notesList = document.getElementById("notesList");
  const notesCount = document.getElementById("notesCount");

  let ws = null;
  let audioCtx = null;
  let playCtx = null;
  let mediaStream = null;
  let workletNode = null;
  let isCalling = false;
  let isMuted = false;
  let nextPlayTime = 0;
  let activeSources = [];
  let lastBubble = { role: null, el: null };
  let transcriptTurns = [];
  let savedIdeasInCall = [];

  function getApiKey() {
    return (localStorage.getItem(STORAGE_KEY_API) || "").trim();
  }

  // รองรับลิงก์ตั้งค่าครั้งเดียวแบบ #key=... (ทำงานเฉพาะในเครื่อง ไม่ส่งขึ้นเซิร์ฟเวอร์ แล้วลบออกจาก URL ทันที)
  if (location.hash && location.hash.startsWith("#key=")) {
    const hashKey = decodeURIComponent(location.hash.slice(5)).replace(/\\+$/, "").trim();
    if (hashKey) {
      localStorage.setItem(STORAGE_KEY_API, hashKey);
    }
    history.replaceState(null, "", location.pathname + location.search);
  }

  function updateKeyBadge() {
    const hasKey = Boolean(getApiKey());
    keyBtn.textContent = hasKey ? "🔑 API Key พร้อม" : "🔑 ใส่ API Key ก่อนโทร";
    if (!hasKey) {
      keyBox.classList.add("open");
    }
  }

  function toggleKeyBox(forceOpen) {
    if (forceOpen === true) keyBox.classList.add("open");
    else keyBox.classList.toggle("open");
    if (keyBox.classList.contains("open")) {
      keyInput.value = getApiKey();
      keyInput.focus();
    }
  }

  keyBtn.addEventListener("click", () => toggleKeyBox());
  saveKeyBtn.addEventListener("click", () => {
    const cleaned = keyInput.value.replace(/\\+$/, "").trim();
    if (!cleaned) {
      addLog("error", "กรุณาวาง Gemini API Key ก่อนกดบันทึก");
      return;
    }
    localStorage.setItem(STORAGE_KEY_API, cleaned);
    keyBox.classList.remove("open");
    updateKeyBadge();
    addLog("tool", "✅ บันทึก API Key เรียบร้อยแล้ว กด '📞 โทรหาลูมิน่า' ได้เลยค่ะ!");
  });

  // Tabs
  tabCall.addEventListener("click", () => {
    tabCall.classList.add("active");
    tabNotes.classList.remove("active");
    panelCall.classList.add("active");
    panelNotes.classList.remove("active");
  });
  tabNotes.addEventListener("click", () => {
    tabNotes.classList.add("active");
    tabCall.classList.remove("active");
    panelNotes.classList.add("active");
    panelCall.classList.remove("active");
    renderNotes();
  });

  // Notes Storage
  function loadNotes() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY_NOTES) || "[]");
    } catch {
      return [];
    }
  }

  function saveNoteRecord(note) {
    const notes = loadNotes();
    notes.unshift({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      createdAt: new Date().toLocaleString("th-TH"),
      ...note,
    });
    localStorage.setItem(STORAGE_KEY_NOTES, JSON.stringify(notes));
    notesCount.textContent = String(notes.length);
  }

  function renderNotes() {
    const notes = loadNotes();
    notesCount.textContent = String(notes.length);
    notesList.innerHTML = "";
    if (!notes.length) {
      notesList.innerHTML = '<div class="empty">ยังไม่มีบันทึกค่ะ ลองโทรคุยหรือฝากสรุปงานกับลูมิน่าได้เลย</div>';
      return;
    }
    for (const n of notes) {
      const card = document.createElement("div");
      card.className = "note-card";
      const mdText = `# ${n.title}\n\n- หมวดหมู่: ${n.category || "note"}\n- วันที่: ${n.createdAt}\n\n${n.content}\n`;

      card.innerHTML = `
        <h3>${escapeHtml(n.title)}</h3>
        <div class="note-meta">${escapeHtml(n.category || "note")} • ${escapeHtml(n.createdAt)}</div>
        <div class="note-body">${escapeHtml(n.content)}</div>
        <div class="note-actions">
          <button class="primary btn-share">📤 แชร์ไป Drive / Notion</button>
          <button class="btn-copy">📋 คัดลอก</button>
          <button class="btn-dl">💾 โหลด .md</button>
          <button class="danger btn-del">ลบ</button>
        </div>
      `;

      card.querySelector(".btn-copy").onclick = async () => {
        await navigator.clipboard.writeText(mdText);
        alert("คัดลอกเรียบร้อยแล้วค่ะ!");
      };
      card.querySelector(".btn-share").onclick = async () => {
        if (navigator.share) {
          try {
            await navigator.share({ title: n.title, text: mdText });
          } catch {}
        } else {
          await navigator.clipboard.writeText(mdText);
          alert("คัดลอกข้อความให้แล้ว นำไปวางใน Drive / Notion ได้เลยค่ะ");
        }
      };
      card.querySelector(".btn-dl").onclick = () => {
        const blob = new Blob([mdText], { type: "text/markdown;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${n.title.replace(/[\\/:*?"<>|]/g, "_")}.md`;
        a.click();
      };
      card.querySelector(".btn-del").onclick = () => {
        const updated = loadNotes().filter((x) => x.id !== n.id);
        localStorage.setItem(STORAGE_KEY_NOTES, JSON.stringify(updated));
        renderNotes();
      };
      notesList.appendChild(card);
    }
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function addLog(type, text) {
    lastBubble = { role: null, el: null };
    const div = document.createElement("div");
    div.className = `msg ${type}`;
    div.textContent = text;
    logList.appendChild(div);
    logList.scrollTop = logList.scrollHeight;
  }

  function appendTranscript(role, chunk) {
    if (!chunk) return;
    if (transcriptTurns.length && transcriptTurns[transcriptTurns.length - 1].role === role) {
      transcriptTurns[transcriptTurns.length - 1].text += chunk;
    } else {
      transcriptTurns.push({ role, text: chunk });
    }
    if (lastBubble.role === role && lastBubble.el) {
      lastBubble.el.textContent += chunk;
    } else {
      const div = document.createElement("div");
      div.className = `msg ${role}`;
      div.textContent = chunk;
      logList.appendChild(div);
      lastBubble = { role, el: div };
    }
    logList.scrollTop = logList.scrollHeight;
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  function base64ToArrayBuffer(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function stopAllPlayback() {
    for (const src of activeSources) {
      try { src.stop(); } catch {}
    }
    activeSources = [];
    if (playCtx) nextPlayTime = playCtx.currentTime;
  }

  function playPcm24k(arrayBuffer) {
    if (!playCtx) playCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    if (playCtx.state === "suspended") playCtx.resume();

    const pcm16 = new Int16Array(arrayBuffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768;

    const buffer = playCtx.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32, 0);

    const src = playCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(playCtx.destination);

    const now = playCtx.currentTime;
    if (nextPlayTime < now) nextPlayTime = now + 0.02;
    src.start(nextPlayTime);
    nextPlayTime += buffer.duration;

    activeSources.push(src);
    src.onended = () => { activeSources = activeSources.filter((s) => s !== src); };
  }

  async function startCall() {
    if (isCalling) return;
    const apiKey = getApiKey();
    if (!apiKey) {
      toggleKeyBox(true);
      addLog("error", "กรุณาวาง Gemini API Key ในช่องด้านบนแล้วกด 'บันทึก' ก่อนโทรค่ะ");
      return;
    }

    isCalling = true;
    isMuted = false;
    transcriptTurns = [];
    savedIdeasInCall = [];

    callBtn.textContent = "กำลังโทรออก...";
    callBtn.disabled = true;
    statusText.textContent = "กำลังโทรหาลูมิน่า...";
    subStatus.textContent = "เชื่อมต่อตรงไปยัง Gemini 3.8 Live...";

    try {
      playCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      if (playCtx.state === "suspended") await playCtx.resume();
      nextPlayTime = playCtx.currentTime;

      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });

      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") await audioCtx.resume();
      await audioCtx.audioWorklet.addModule("./pcm-processor.js");

      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        ws.send(JSON.stringify({
          setup: {
            model: MODEL,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } },
            },
            systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            tools: [{
              functionDeclarations: [{
                name: "save_idea",
                description: "บันทึกไอเดีย โน้ต หรือสรุปงานเก็บไว้ให้ผู้ใช้",
                behavior: "NON_BLOCKING",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    title: { type: "STRING", description: "หัวข้อสั้นๆ" },
                    content: { type: "STRING", description: "รายละเอียดหรือสรุปงาน" },
                    category: { type: "STRING", description: "หมวดหมู่ เช่น work_summary, idea, task, meeting_note" },
                  },
                  required: ["title", "content"],
                },
              }],
            }],
          },
        }));
      };

      ws.onmessage = async (event) => {
        const rawText = event.data instanceof Blob ? await event.data.text() : event.data;
        const msg = JSON.parse(rawText);

        if (msg.setupComplete) {
          orb.classList.add("calling");
          statusText.textContent = "กำลังคุยกับลูมิน่า";
          subStatus.textContent = "เล่าเรื่องงานหรือฝากไอเดียได้เลยค่ะ (บันทึกอัตโนมัติ)";
          callBtn.textContent = "🔴 วางสาย";
          callBtn.className = "btn-hangup";
          callBtn.disabled = false;
          muteBtn.style.display = "inline-block";
          textInput.disabled = false;
          sendBtn.disabled = false;

          // เริ่มส่งเสียงไมค์
          const source = audioCtx.createMediaStreamSource(mediaStream);
          workletNode = new AudioWorkletNode(audioCtx, "pcm-processor");
          workletNode.port.onmessage = (ev) => {
            if (!isMuted && ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                realtimeInput: {
                  audio: { mimeType: "audio/pcm;rate=16000", data: arrayBufferToBase64(ev.data) },
                },
              }));
            }
          };
          const silentGain = audioCtx.createGain();
          silentGain.gain.value = 0;
          source.connect(workletNode);
          workletNode.connect(silentGain);
          silentGain.connect(audioCtx.destination);

          // ทักทายรับสาย
          ws.send(JSON.stringify({
            realtimeInput: { text: "(ผู้ใช้เพิ่งโทรเข้ามา ทักทายสั้นๆ 1 ประโยคว่าลูมิน่าพร้อมรับสายแล้ว)" },
          }));
          return;
        }

        // Tool Call: save_idea
        if (msg.toolCall?.functionCalls) {
          for (const call of msg.toolCall.functionCalls) {
            if (call.name === "save_idea") {
              const title = call.args?.title || "สรุปงาน / ไอเดียใหม่";
              const content = call.args?.content || "";
              const category = call.args?.category || "work_summary";
              saveNoteRecord({ title, content, category });
              savedIdeasInCall.push(title);
              addLog("tool", `✅ บันทึกแล้ว: "${title}" (ดูได้ที่แท็บ บันทึกที่เก็บไว้)`);
              ws.send(JSON.stringify({
                toolResponse: {
                  functionResponses: [{
                    id: call.id,
                    name: call.name,
                    response: { status: "saved", message: "บันทึกสรุปงาน/ไอเดียเก็บไว้เรียบร้อยแล้ว" },
                  }],
                },
              }));
            }
          }
        }

        const sc = msg.serverContent;
        if (!sc) return;
        if (sc.interrupted) {
          stopAllPlayback();
          lastBubble = { role: null, el: null };
        }
        if (sc.modelTurn?.parts) {
          for (const part of sc.modelTurn.parts) {
            if (part.inlineData?.data) playPcm24k(base64ToArrayBuffer(part.inlineData.data));
          }
        }
        if (sc.inputTranscription?.text) appendTranscript("user", sc.inputTranscription.text);
        if (sc.outputTranscription?.text) appendTranscript("assistant", sc.outputTranscription.text);
        if (sc.turnComplete) lastBubble = { role: null, el: null };
      };

      ws.onclose = (ev) => {
        if (ev.code !== 1000 && ev.code !== 1005) {
          addLog("error", `สายหลุด (code ${ev.code}${ev.reason ? ": " + ev.reason : ""})`);
        }
        endCall();
      };
      ws.onerror = () => addLog("error", "เชื่อมต่อ Gemini ไม่สำเร็จ กรุณาตรวจสอบ API Key หรืออินเทอร์เน็ต");
    } catch (err) {
      addLog("error", `เปิดไมโครโฟนหรือเชื่อมต่อไม่สำเร็จ: ${err.message}`);
      endCall();
    }
  }

  function endCall() {
    if (transcriptTurns.length > 0) {
      const lines = [];
      if (savedIdeasInCall.length) {
        lines.push("## สรุปงาน/ไอเดียในสายนี้");
        savedIdeasInCall.forEach((t) => lines.push(`- ${t}`));
        lines.push("");
      }
      lines.push("## บทสนทนาทั้งหมด");
      transcriptTurns.forEach((t) => {
        lines.push(`- ${t.role === "user" ? "คุณ" : "ลูมิน่า"}: ${t.text.trim()}`);
      });
      saveNoteRecord({
        title: `บันทึกการคุยกับลูมิน่า (${new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })})`,
        category: "call_log",
        content: lines.join("\n"),
      });
      addLog("tool", "📝 บันทึกบทสนทนาทั้งหมดเก็บไว้ในแท็บ 'บันทึกที่เก็บไว้' แล้วค่ะ");
      transcriptTurns = [];
    }

    isCalling = false;
    isMuted = false;
    stopAllPlayback();

    if (ws) { try { ws.close(); } catch {} ws = null; }
    if (workletNode) { try { workletNode.disconnect(); } catch {} workletNode = null; }
    if (audioCtx) { try { audioCtx.close(); } catch {} audioCtx = null; }
    if (playCtx) { try { playCtx.close(); } catch {} playCtx = null; }
    if (mediaStream) { mediaStream.getTracks().forEach((t) => t.stop()); mediaStream = null; }

    orb.classList.remove("calling");
    statusText.textContent = "ลูมิน่าพร้อมรับสายค่ะ";
    subStatus.textContent = "โทรคุยและสรุปงานได้ตลอด 24 ชม. แม้ปิดคอม";
    callBtn.textContent = "📞 โทรหาลูมิน่า";
    callBtn.className = "btn-call";
    callBtn.disabled = false;
    muteBtn.style.display = "none";
    muteBtn.textContent = "🔇 ปิดไมค์";
    muteBtn.classList.remove("muted");
    textInput.disabled = true;
    sendBtn.disabled = true;
    notesCount.textContent = String(loadNotes().length);
  }

  callBtn.addEventListener("click", () => (isCalling ? endCall() : startCall()));
  muteBtn.addEventListener("click", () => {
    isMuted = !isMuted;
    muteBtn.textContent = isMuted ? "🎙️ เปิดไมค์" : "🔇 ปิดไมค์";
    muteBtn.classList.toggle("muted", isMuted);
    if (isMuted && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
    }
  });

  textForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = textInput.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ realtimeInput: { text } }));
    appendTranscript("user", text);
    textInput.value = "";
  });

  updateKeyBadge();
  notesCount.textContent = String(loadNotes().length);
})();
