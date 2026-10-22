const socket = io();

// Master Dashboard ራሱን ለሰርቨሩ ያስተዋውቃል
socket.emit('master:join');

const devicesGrid = document.getElementById('devicesGrid');
const noDevicesEl = document.getElementById('no-devices');
const countEl = document.getElementById('devices-count');

// የተገናኙ መሳሪያዎችን ማከማቻ Map
const devices = new Map();

// 1. መጀመሪያ ሲከፈት የነበሩ መሳሪያዎችን መቀበል
socket.on('master:devices-list', (list) => {
  list.forEach(dev => devices.set(dev.socketId, dev));
  renderGrid();
});

// 2. አዲስ መሳሪያ ሲገባ (Device Connected)
socket.on('master:device-connected', (device) => {
  devices.set(device.socketId, device);
  renderGrid();
});

// 3. መሳሪያ ሲቋረጥ (Device Disconnected)
socket.on('master:device-disconnected', (socketId) => {
  devices.delete(socketId);
  renderGrid();
});

// 4. ከመሳሪያው የቀጥታ CCTV ስክሪን ምስል ሲመጣ
socket.on('master:device-frame', (data) => {
  const imgEl = document.getElementById(`screen-${data.socketId}`);
  if (imgEl) {
    imgEl.src = data.imageBase64;
  }
});

// ግሪዱን በአዲስ መልክ ማሳያ ፈንክሽን (Render Function)
function renderGrid() {
  countEl.innerText = `የተገኙ መሳሪያዎች፡ ${devices.size}`;

  if (devices.size === 0) {
    devicesGrid.innerHTML = '';
    devicesGrid.appendChild(noDevicesEl);
    noDevicesEl.style.display = 'block';
    return;
  }

  noDevicesEl.style.display = 'none';
  devicesGrid.innerHTML = '';

  devices.forEach(dev => {
    const card = document.createElement('div');
    card.className = `device-card ${dev.isLocked ? 'locked' : ''}`;
    card.id = `card-${dev.socketId}`;

    card.innerHTML = `
      <div class="card-header">
        <div class="device-info">
          <div class="status-dot"></div>
          <span class="device-name">${dev.name}</span>
        </div>
        <div class="device-meta">
          <span><i class="fa-solid fa-battery-half"></i> ${dev.battery}%</span>
          <span><i class="fa-brands fa-${dev.os.toLowerCase() === 'android' ? 'android' : 'windows'}"></i> ${dev.os}</span>
        </div>
      </div>

      <div class="screen-preview">
        <img id="screen-${dev.socketId}" src="https://via.placeholder.com/320x180/0f172a/38bdf8?text=CCTV+Screen" alt="Live Preview">
        <div class="lock-overlay">
          <i class="fa-solid fa-lock" style="font-size: 32px; margin-bottom: 8px;"></i>
          <span>ስክሪኑ ተቆልፏል</span>
        </div>
      </div>

      <div class="card-actions">
        <button class="btn-mini" onclick="toggleLock('${dev.socketId}')">
          <i class="fa-solid fa-${dev.isLocked ? 'lock-open' : 'lock'}"></i> ${dev.isLocked ? 'Unlock' : 'Lock'}
        </button>
        <button class="btn-mini" onclick="openDirectMessage('${dev.socketId}')">
          <i class="fa-solid fa-comment"></i> መልእክት
        </button>
      </div>
    `;

    devicesGrid.appendChild(card);
  });
}

// ለሁሉም መሳሪያዎች ትዕዛዝ መላኪያ (Broadcast)
function triggerBroadcast(cmd) {
  socket.emit('master:send-command', {
    command: cmd,
    payload: {}
  });

  if (cmd === 'LOCK') {
    devices.forEach(d => d.isLocked = true);
    renderGrid();
  } else if (cmd === 'UNLOCK') {
    devices.forEach(d => d.isLocked = false);
    renderGrid();
  }
}

// ለአንድ መሳሪያ ብቻ ቆልፍ/ክፈት
function toggleLock(socketId) {
  const dev = devices.get(socketId);
  if (!dev) return;

  const newLockState = !dev.isLocked;
  dev.isLocked = newLockState;

  socket.emit('master:send-command', {
    targetSocketId: socketId,
    command: newLockState ? 'LOCK' : 'UNLOCK',
    payload: {}
  });

  renderGrid();
}

// የሜሴጅ ሞዳል መቆጣጠሪያዎች
let currentTargetSocketId = null;

function openMessageModal() {
  currentTargetSocketId = null; // ለሁሉም
  document.getElementById('msgModal').style.display = 'flex';
}

function openDirectMessage(socketId) {
  currentTargetSocketId = socketId; // ለአንድ ሰው
  document.getElementById('msgModal').style.display = 'flex';
}

function closeMessageModal() {
  document.getElementById('msgModal').style.display = 'none';
  document.getElementById('msgInput').value = '';
}

function sendMessageBroadcast() {
  const text = document.getElementById('msgInput').value.trim();
  if (!text) return alert("እባክዎ መልእክት ያስገቡ!");

  socket.emit('master:send-command', {
    targetSocketId: currentTargetSocketId,
    command: 'MESSAGE',
    payload: { message: text }
  });

  alert("መልእክቱ ተልኳል! ✅");
  closeMessageModal();
}

// ==========================================
// 5. የአስተማሪ ስክሪን ማስተላለፊያ (DEMONSTRATION)
// ==========================================
let teacherStream = null;
let broadcastInterval = null;

async function startTeacherBroadcast() {
  try {
    teacherStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "always", frameRate: { ideal: 10, max: 15 } },
      audio: false
    });

    const teacherVideo = document.createElement('video');
    teacherVideo.srcObject = teacherStream;
    teacherVideo.muted = true;
    teacherVideo.playsInline = true;
    await teacherVideo.play();

    // ለተማሪዎች ዝግጁ ሁኑ በል
    socket.emit('master:send-command', {
      command: 'START_BROADCAST',
      payload: {}
    });

    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');

    if (broadcastInterval) clearInterval(broadcastInterval);
    
    // በየ 250ms ምስሉን አንስቶ መላክ
    broadcastInterval = setInterval(() => {
      if (teacherVideo && teacherVideo.readyState >= 2) {
        ctx.drawImage(teacherVideo, 0, 0, canvas.width, canvas.height);
        const frameBase64 = canvas.toDataURL('image/jpeg', 0.6);
        socket.emit('master:broadcast-frame', { imageBase64: frameBase64 });
      }
    }, 250);

    teacherStream.getVideoTracks()[0].onended = () => {
      clearInterval(broadcastInterval);
      socket.emit('master:send-command', {
        command: 'STOP_BROADCAST',
        payload: {}
      });
      alert("ስርጭት ተጠናቋል!");
    };

  } catch (err) {
    console.error("Broadcast Error:", err);
  }
}