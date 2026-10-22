const socket = io();

let screenStream = null;
let streamInterval = null;

const localVideo = document.getElementById('localVideo');
const shareScreenBtn = document.getElementById('shareScreenBtn');
const deviceNameInput = document.getElementById('deviceNameInput');
const lockOverlay = document.getElementById('lockOverlay');
const msgAlert = document.getElementById('msgAlert');
const msgAlertText = document.getElementById('msgAlertText');

// 1. ተማሪውን ወደ ሰርቨሩ ማስተዋወቅ (ትክክለኛው 'device:register')
socket.on('connect', () => {
    console.log("[✓] ከሰርቨር ጋር ተገናኝቷል! ID:", socket.id);
    registerCurrentDevice();
});

function registerCurrentDevice() {
    const name = deviceNameInput && deviceNameInput.value.trim() !== "" 
                 ? deviceNameInput.value.trim() 
                 : "የዮሐንስ ኮምፒውተር";
    const osType = navigator.userAgent.includes("Windows") ? "Windows" : 
                   navigator.userAgent.includes("Android") ? "Android" : "Windows";

    // ሰርቨሩ የሚጠብቀው ትክክለኛ መረጃ
    const deviceInfo = {
        name: name,
        os: osType,
        battery: 95,
        deviceId: socket.id
    };

    // ዋናው የሰርቨርህ Event ስም 'device:register' ነው!
    socket.emit('device:register', deviceInfo);
    console.log("[*] መሣሪያው ተመዝግቧል:", deviceInfo);
}

// የስም ማደሻ በተን ሲነካ
function updateDeviceName() {
    registerCurrentDevice();
    alert("የመሳሪያው ስም ተቀይሯል! ✅");
}

// 2. ስክሪን ማንሳትና ማስተላለፍ (Screen Streaming)
async function startScreenShare() {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: "always",
                frameRate: { ideal: 10, max: 15 }
            },
            audio: false
        });

        if (localVideo) {
            localVideo.srcObject = screenStream;
            localVideo.play();
        }

        if (shareScreenBtn) {
            shareScreenBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> ስክሪን እየተጋራ ነው (Active)';
            shareScreenBtn.style.background = "#15803d";
        }

        // በየ 300ms ፍሬም ወደ ዳሽቦርዱ መላክ
        if (streamInterval) clearInterval(streamInterval);
        streamInterval = setInterval(captureAndSendRealFrame, 300);

        screenStream.getVideoTracks()[0].onended = () => {
            if (shareScreenBtn) {
                shareScreenBtn.innerHTML = '<i class="fa-solid fa-desktop"></i> እውነተኛ ስክሪን አጋራ (Start Screen Share)';
                shareScreenBtn.style.background = "#16a34a";
            }
            clearInterval(streamInterval);
        };

    } catch (err) {
        console.error("Screen Share ስህተት:", err);
    }
}

function captureAndSendRealFrame() {
    if (!screenStream || !localVideo || localVideo.readyState < 2) return;

    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 270;
    const ctx = canvas.getContext('2d');

    // ምስሉን ከቪዲዮው ገልብጦ ማንሳት
    ctx.drawImage(localVideo, 0, 0, canvas.width, canvas.height);

    // ወደ Base64 ቀይሮ መላክ
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.5);

    // ሰርቨሩ መስመር 80 ላይ የሚጠብቀው 'client:stream-frame' ነው
    socket.emit('client:stream-frame', {
        socketId: socket.id,
        imageBase64: imageBase64
    });
}

// 3. ከ Master Dashboard የሚመጡ ትዕዛዞችን ማዳመጥ ('client:execute-command')
socket.on('client:execute-command', (data) => {
    const { command, payload } = data;
    console.log("[*] ትዕዛዝ ደርሷል:", command, payload);
    const upperCmd = (command || "").toUpperCase();

    // ሀ. ስክሪን መቆለፍ (LOCK)
    if (upperCmd === 'LOCK') {
        if (lockOverlay) lockOverlay.style.display = 'flex';
        socket.emit('client:command-result', { command: 'LOCK', status: 'success' });
    } 
    // ለ. ስክሪን መልቀቅ (UNLOCK)
    else if (upperCmd === 'UNLOCK') {
        if (lockOverlay) lockOverlay.style.display = 'none';
        socket.emit('client:command-result', { command: 'UNLOCK', status: 'success' });
    } 
    // ሐ. መልዕክት መቀበል (MESSAGE)
    else if (upperCmd === 'MESSAGE') {
        const text = (payload && (payload.message || payload.text)) 
                     ? (payload.message || payload.text) 
                     : "ማሳሰቢያ ከአስተማሪ!";
        
        if (msgAlert && msgAlertText) {
            msgAlertText.innerText = text;
            msgAlert.style.display = 'block';

            setTimeout(() => {
                msgAlert.style.display = 'none';
            }, 6000);
        } else {
            alert(text);
        }
        socket.emit('client:command-result', { command: 'MESSAGE', status: 'success' });
    } 
    // መ. ሪስታርት / ማጥፋት (REBOOT / POWEROFF)
    else if (upperCmd === 'REBOOT' || upperCmd === 'POWEROFF') {
        document.body.innerHTML = `
            <div style="background:#020617; color:#ef4444; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif;">
                <i class="fa-solid fa-power-off" style="font-size:70px; margin-bottom:20px;"></i>
                <h1 style="font-size:28px;">ኮምፒውተሩ እየጠፋ ነው...</h1>
            </div>
        `;
        socket.emit('client:command-result', { command: upperCmd, status: 'success' });
        setTimeout(() => location.reload(), 5000);
    }
});

// ==========================================
// 4. የአስተማሪውን Demonstration ስክሪን ማሳያ
// ==========================================
function getOrCreateBroadcastOverlay() {
  let overlay = document.getElementById('broadcastOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'broadcastOverlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: #020617;
      z-index: 999998;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 10px;
      box-sizing: border-box;
    `;
    overlay.innerHTML = `
      <div style="background: #0284c7; color: white; padding: 8px 20px; border-radius: 20px; font-weight: bold; font-size: 15px; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">
        <i class="fa-solid fa-chalkboard-user"></i> የአስተማሪው ገለጻ በቀጥታ (Live Demonstration)
      </div>
      <img id="broadcastViewImg" style="width: 95vw; height: 85vh; object-fit: contain; border: 2px solid #38bdf8; border-radius: 8px; background: #000;" />
    `;
    document.body.appendChild(overlay);
  }
  return overlay;
}

socket.on('master:broadcast-frame', (data) => {
  const overlay = getOrCreateBroadcastOverlay();
  overlay.style.display = 'flex';
  const img = document.getElementById('broadcastViewImg');
  if (img && data && data.imageBase64) {
    img.src = data.imageBase64;
  }
});

socket.on('client:execute-command', (data) => {
  if (data.command === 'START_BROADCAST') {
    const overlay = getOrCreateBroadcastOverlay();
    overlay.style.display = 'flex';
  } else if (data.command === 'STOP_BROADCAST') {
    const overlay = document.getElementById('broadcastOverlay');
    if (overlay) overlay.style.display = 'none';
  }
});