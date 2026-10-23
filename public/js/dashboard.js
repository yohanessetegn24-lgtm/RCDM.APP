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

// ==========================================
// CRUD OPERATIONS (USERS & DEVICES)
// ==========================================

// --- USERS MODAL CONTROLS ---
async function openUsersModal() {
  document.getElementById('usersModal').style.display = 'flex';
  await loadUsersList();
}
function closeUsersModal() {
  document.getElementById('usersModal').style.display = 'none';
}

async function loadUsersList() {
  const tbody = document.getElementById('usersTableBody');
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">በመጫን ላይ...</td></tr>';
  try {
    const res = await fetch('/api/users');
    const users = await res.json();
    tbody.innerHTML = '';
    users.forEach(u => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><b>${u.full_name}</b></td>
        <td>${u.email}</td>
        <td><span class="badge-role role-${u.role}">${u.role.toUpperCase()}</span></td>
        <td><button class="btn-delete" onclick="deleteUser('${u.id}')"><i class="fa-solid fa-trash"></i> አጥፋ</button></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:red; text-align:center;">መጫን አልተቻለም!</td></tr>';
  }
}

async function handleCreateUser(e) {
  e.preventDefault();
  const full_name = document.getElementById('userFullName').value.trim();
  const email = document.getElementById('userEmail').value.trim();
  const password = document.getElementById('userPassword').value.trim();
  const role = document.getElementById('userRole').value;

  const res = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name, email, password, role })
  });

  if (res.ok) {
    alert("ተጠቃሚው በተሳካ ሁኔታ ተመዝግቧል! ✅");
    document.getElementById('addUserForm').reset();
    await loadUsersList();
  } else {
    alert("ተጠቃሚውን መመዝገብ አልተቻለም!");
  }
}

async function deleteUser(id) {
  if (!confirm("እርግጠኛ ነዎት ይህን ተጠቃሚ ማጥፋት ይፈልጋሉ?")) return;
  await fetch(`/api/users/${id}`, { method: 'DELETE' });
  await loadUsersList();
}

// --- DEVICES MODAL CONTROLS ---
async function openDevicesModal() {
  document.getElementById('devicesModal').style.display = 'flex';
  await loadDevicesList();
}
function closeDevicesModal() {
  document.getElementById('devicesModal').style.display = 'none';
}

async function loadDevicesList() {
  const tbody = document.getElementById('devicesTableBody');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">በመጫን ላይ...</td></tr>';
  try {
    const res = await fetch('/api/devices');
    const devs = await res.json();
    tbody.innerHTML = '';
    if (devs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#94a3b8;">ምንም የተመዘገበ መሳሪያ የለም።</td></tr>';
      return;
    }
    devs.forEach(d => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><b>${d.device_name}</b></td>
        <td><i class="fa-brands fa-${(d.os_type||'').toLowerCase()}"></i> ${d.os_type || 'Windows'}</td>
        <td>${d.ip_address || '-'}</td>
        <td><code>${d.mac_address || '-'}</code></td>
        <td>${d.assigned_room || 'Main Lab'}</td>
        <td><span style="color:${d.status==='online'?'#34d399':'#94a3b8'};">● ${d.status}</span></td>
        <td><button class="btn-delete" onclick="deleteDevice('${d.id}')"><i class="fa-solid fa-trash"></i> አጥፋ</button></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:red; text-align:center;">መጫን አልተቻለም!</td></tr>';
  }
}

async function handleCreateDevice(e) {
  e.preventDefault();
  const device_name = document.getElementById('devName').value.trim();
  const mac_address = document.getElementById('devMac').value.trim();
  const ip_address = document.getElementById('devIp').value.trim();
  const serial_number = document.getElementById('devSerial').value.trim();
  const os_type = document.getElementById('devOs').value;
  const assigned_room = document.getElementById('devRoom').value.trim();

  const res = await fetch('/api/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_name, mac_address, ip_address, serial_number, os_type, assigned_room })
  });

  if (res.ok) {
    alert("መሳሪያው በተሳካ ሁኔታ ተመዝግቧል! ✅");
    document.getElementById('addDeviceForm').reset();
    await loadDevicesList();
  } else {
    alert("መሳሪያውን መመዝገብ አልተቻለም!");
  }
}

async function deleteDevice(id) {
  if (!confirm("ይህንን መሣሪያ ከሲስተሙ ማጥፋት ይፈልጋሉ?")) return;
  await fetch(`/api/devices/${id}`, { method: 'DELETE' });
  await loadDevicesList();
}

// ==========================================
// FILE TRANSFER CONTROLS
// ==========================================
function openFileTransferModal() {
  document.getElementById('fileTransferModal').style.display = 'flex';
}
function closeFileTransferModal() {
  document.getElementById('fileTransferModal').style.display = 'none';
  document.getElementById('fileToSend').value = '';
}

function sendFileToStudents() {
  const fileInput = document.getElementById('fileToSend');
  if (!fileInput.files || fileInput.files.length === 0) {
    return alert("እባክዎ መጀመሪያ ፋይል ይምረጡ!");
  }

  const file = fileInput.files[0];
  const reader = new FileReader();

  reader.onload = function(e) {
    socket.emit('master:send-command', {
      command: 'RECEIVE_FILE',
      payload: {
        fileName: file.name,
        fileType: file.type,
        fileBase64: e.target.result
      }
    });

    alert(`[✓] ፋይሉ ("${file.name}") ለሁሉም ተማሪዎች ተልኳል!`);
    closeFileTransferModal();
  };

  reader.readAsDataURL(file);
}

// ==========================================
// ADMIN: TEACHERS LIST, SEARCH & REAL-TIME STATUS
// ==========================================
let allTeachersData = [];

// አድሚኑ ገጹን ሲከፍት መምህራንን ከዳታቤዝ ማምጣት
document.addEventListener("DOMContentLoaded", () => {
  const user = JSON.parse(localStorage.getItem('currentUser') || '{}');
  if (user.role === 'admin') {
    loadTeachersList();
  }
});

async function loadTeachersList() {
  const grid = document.getElementById('teachersGrid');
  const countEl = document.getElementById('teachers-count');
  if (!grid) return;

  grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #94a3b8; padding: 40px;">የመምህራን ዝርዝር በመጫን ላይ...</div>';

  try {
    const res = await fetch('/api/users');
    const users = await res.json();
    
    // መምህራንን ብቻ መለየት (Filter Teachers)
    allTeachersData = users.filter(u => u.role === 'teacher');
    if (countEl) countEl.innerText = `የተመዘገቡ መምህራን፡ ${allTeachersData.length}`;

    renderTeachersGrid(allTeachersData);
  } catch (err) {
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: red;">መምህራንን መጫን አልተቻለም!</div>';
  }
}

function renderTeachersGrid(teachers) {
  const grid = document.getElementById('teachersGrid');
  if (!grid) return;
  grid.innerHTML = '';

  if (teachers.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 60px; color: #64748b;">
        <i class="fa-solid fa-user-slash" style="font-size: 48px; margin-bottom: 12px; display:block;"></i>
        <h3>ምንም መምህር አልተገኘም</h3>
      </div>
    `;
    return;
  }

  teachers.forEach(t => {
    // የመምህሩ አምሳያ ፎቶ በራስ-ሰር ማመንጨት
    const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(t.full_name)}`;
    
    // በሰርቨሩ ውስጥ መምህሩ Online መሆኑን ማረጋገጥ (የጊዜያዊ ሲሙሌሽን ማሳያ)
    const isOnline = t.isOnline || false; 

    const card = document.createElement('div');
    card.className = 'device-card';
    card.style.cssText = 'background: #1e293b; border-radius: 14px; border: 1px solid #334155; padding: 18px; box-shadow: 0 10px 25px rgba(0,0,0,0.4); display: flex; flex-direction: column; justify-content: space-between;';

    card.innerHTML = `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <img src="${avatarUrl}" style="width: 50px; height: 50px; border-radius: 50%; background: #0f172a; border: 2px solid #38bdf8;">
            <div>
              <h3 style="margin: 0; font-size: 16px; color: white;">${t.full_name}</h3>
              <p style="margin: 3px 0 0; font-size: 12px; color: #94a3b8;">${t.email}</p>
            </div>
          </div>
        </div>

        <div style="background: #0f172a; padding: 10px 14px; border-radius: 8px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 12px; color: #94a3b8;">ሁኔታ (Status):</span>
          <span style="font-size: 12px; font-weight: bold; display: flex; align-items: center; gap: 6px; color: ${isOnline ? '#22c55e' : '#ef4444'};">
            <span style="width: 8px; height: 8px; border-radius: 50%; background: ${isOnline ? '#22c55e' : '#ef4444'}; display: inline-block;"></span>
            ${isOnline ? 'Online (ክፍል ውስጥ ናቸው)' : 'Offline (Last seen recently)'}
          </span>
        </div>
      </div>

      <!-- አድሚኑ የመምህሩን ክፍል ለመቆጣጠር የሚነካው አዝራር -->
      <button onclick="inspectTeacherClassroom('${t.id}', '${t.full_name}')" 
              style="width: 100%; padding: 10px; background: linear-gradient(135deg, #0284c7, #2563eb); color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: 0.2s;">
        <i class="fa-solid fa-door-open"></i> ክፍሉን ተቆጣጠር (Inspect Lab)
      </button>
    `;

    grid.appendChild(card);
  });
}

// መምህራንን በ Search Bar መፈለጊያ
function filterTeachers() {
  const query = document.getElementById('teacherSearchInput').value.toLowerCase();
  const filtered = allTeachersData.filter(t => 
    t.full_name.toLowerCase().includes(query) || 
    t.email.toLowerCase().includes(query)
  );
  renderTeachersGrid(filtered);
}

// አድሚኑ የአንድን መምህር ክፍል ጠቅ አድርጎ ሲገባ
function inspectTeacherClassroom(teacherId, teacherName) {
  // አድሚኑ የመረጠውን መምህር መረጃ ይዞ ወደ teacher.html ገብቶ ይቆጣጠራል!
  const adminInspector = {
    id: teacherId,
    name: `${teacherName} (Admin Inspector)`,
    role: 'teacher'
  };
  localStorage.setItem('currentUser', JSON.stringify(adminInspector));
  window.location.href = '/teacher.html';
}