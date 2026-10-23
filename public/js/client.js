const socket = io();

let screenStream = null;
let streamInterval = null;

const localVideo = document.getElementById('localVideo');
const shareScreenBtn = document.getElementById('shareScreenBtn');
const lockOverlay = document.getElementById('lockOverlay');
const msgAlert = document.getElementById('msgAlert');
const msgAlertText = document.getElementById('msgAlertText');

// የተማሪውን መረጃ ከ Login ማምጣት
const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');

document.addEventListener("DOMContentLoaded", () => {
    // 1. የተማሪውን ስም እና Avatar በ Navbar ላይ ማሳየት
    if (currentUser && currentUser.name) {
        document.getElementById('studentDisplayName').innerText = currentUser.name;
        document.getElementById('studentAvatarImg').src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(currentUser.name)}`;
    }
});

// 2. ተማሪውን ወደ ሰርቨሩ ማስተዋወቅ
socket.on('connect', () => {
    console.log("[✓] ተማሪ ከሰርቨር ጋር ተገናኘ ID:", socket.id);
    registerCurrentDevice();
});

function registerCurrentDevice() {
    const name = currentUser.name || "ተማሪ";
    const osType = navigator.userAgent.includes("Windows") ? "Windows" : "Target Device";
    
    // የተማሪው መምህር ID (ከሌለው በነባሪ ለመምህሩ እንሰጠዋለን)
    const teacherId = currentUser.teacherId || 'default_teacher';

    const deviceInfo = {
        name: name,
        os: osType,
        battery: 100,
        deviceId: socket.id,
        teacherId: teacherId
    };

    socket.emit('device:register', deviceInfo);
    console.log("[*] ተማሪው ወደ መምህሩ ክፍል ተመዝግቧል:", deviceInfo);
}

// 3. ስክሪን ማንሳትና ማስተላለፍ (Navbar Button)
async function startScreenShare() {
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: "always", frameRate: { ideal: 10, max: 15 } },
            audio: false
        });

        if (localVideo) {
            localVideo.srcObject = screenStream;
            localVideo.play();
        }

        if (shareScreenBtn) {
            shareScreenBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> <span>ስክሪን እየተጋራ ነው</span>';
            shareScreenBtn.style.background = "#15803d";
        }

        if (streamInterval) clearInterval(streamInterval);
        streamInterval = setInterval(captureAndSendRealFrame, 300);

        screenStream.getVideoTracks()[0].onended = () => {
            if (shareScreenBtn) {
                shareScreenBtn.innerHTML = '<i class="fa-solid fa-desktop"></i> <span>ስክሪን አጋራ (Start Screen)</span>';
                shareScreenBtn.style.background = "linear-gradient(135deg, #10b981, #059669)";
            }
            clearInterval(streamInterval);
        };
    } catch (err) {
        console.error("Screen Share Error: ", err);
    }
}

function captureAndSendRealFrame() {
    if (!screenStream || !localVideo || localVideo.readyState < 2) return;

    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 270;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(localVideo, 0, 0, canvas.width, canvas.height);

    const imageBase64 = canvas.toDataURL('image/jpeg', 0.5);
    socket.emit('client:stream-frame', {
        socketId: socket.id,
        imageBase64: imageBase64
    });
}

// 4. ከ Dashboard የሚመጡ ትዕዛዞች ማስተናገጃ
socket.on('client:execute-command', (data) => {
    const { command, payload } = data;
    const upperCmd = (command || "").toUpperCase();

    if (upperCmd === 'LOCK') {
        if (lockOverlay) lockOverlay.style.display = 'flex';
    } 
    else if (upperCmd === 'UNLOCK') {
        if (lockOverlay) lockOverlay.style.display = 'none';
    } 
    else if (upperCmd === 'MESSAGE') {
        const text = (payload && (payload.message || payload.text)) ? (payload.message || payload.text) : "ማሳሰቢያ ከአስተማሪ!";
        if (msgAlert && msgAlertText) {
            msgAlertText.innerText = text;
            msgAlert.style.display = 'block';
            setTimeout(() => { msgAlert.style.display = 'none'; }, 7000);
        } else {
            alert(text);
        }
    }
    else if (upperCmd === 'RECEIVE_FILE') {
        if (payload && payload.fileBase64) {
            const downloadLink = document.createElement('a');
            downloadLink.href = payload.fileBase64;
            downloadLink.download = payload.fileName || 'file';
            document.body.appendChild(downloadLink);
            downloadLink.click();
            downloadLink.remove();
            alert(`📁 ከአስተማሪው አዲስ ፋይል ደርሶዎታል፦ "${payload.fileName}"`);
        }
    }
    else if (upperCmd === 'START_BROADCAST') {
        const overlay = getOrCreateBroadcastOverlay();
        overlay.style.display = 'flex';
    } 
    else if (upperCmd === 'STOP_BROADCAST') {
        const overlay = document.getElementById('broadcastOverlay');
        if (overlay) overlay.style.display = 'none';
    }
    else if (upperCmd === 'REBOOT') {
        location.reload();
    }
    else if (upperCmd === 'POWER_OFF' || upperCmd === 'POWEROFF') {
        document.body.innerHTML = `
            <div style="background:#000; color:#334155; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center;">
                <i class="fa-solid fa-power-off" style="font-size:70px; margin-bottom:20px;"></i>
                <h2>Power Off</h2>
            </div>
        `;
    }
});

function getOrCreateBroadcastOverlay() {
  let overlay = document.getElementById('broadcastOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'broadcastOverlay';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:#020617; z-index:999998; display:flex; flex-direction:column; align-items:center; justify-content:center;';
    overlay.innerHTML = `
      <div style="background:#0284c7; color:white; padding:8px 20px; border-radius:20px; margin-bottom:12px; font-weight:bold;">
        📡 የአስተማሪው ገለጻ በቀጥታ (Demonstration Mode)
      </div>
      <img id="broadcastViewImg" style="max-width:96vw; max-height:86vh; border:2px solid #38bdf8; border-radius:8px;" />
    `;
    document.body.appendChild(overlay);
  }
  return overlay;
}

socket.on('master:broadcast-frame', (data) => {
  const overlay = getOrCreateBroadcastOverlay();
  overlay.style.display = 'flex';
  const img = document.getElementById('broadcastViewImg');
  if (img) img.src = data.imageBase64;
});