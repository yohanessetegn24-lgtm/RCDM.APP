require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e8 // እስከ 100MB ፋይል እንዲያሳልፍ
});

// 1. Supabase Setup
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLIC_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 2. Middlewares
app.use(cors());
app.use(express.json());

// 3. Password Strength Validation (ፊደል፣ ቁጥር እና ምልክት ማረጋገጫ)
function isStrongPassword(password) {
  if (!password || password.length < 6) return false;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbol = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
  return hasLetter && hasNumber && hasSymbol;
}

// ==========================================
// 4. መጀመሪያ ሲከፈት በግዴታ LOGIN PAGE እንዲመጣ ማድረግ
// ==========================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// static files (ያለ auto-index)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ==========================================
// 5. የተጠቃሚዎች LOGIN ማረጋገጫ API
// ==========================================
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .eq('password', password)
      .single();

    if (error || !user) {
      return res.status(401).json({ success: false, message: 'ኢሜይል ወይም የይለፍ ቃል የተሳሳተ ነው!' });
    }

    let redirectUrl = '/teacher.html';
    if (user.role === 'admin') {
      redirectUrl = '/index.html';
    } else if (user.role === 'student') {
      redirectUrl = '/client.html';
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.full_name,
        email: user.email,
        role: user.role,
        teacherId: user.teacher_id || null
      },
      redirectUrl: redirectUrl
    });

  } catch (err) {
    res.status(500).json({ success: false, message: 'የሰርቨር ችግር አጋጥሟል' });
  }
});

// ==========================================
// 6. TEACHER ONLY: STUDENTS FULL CRUD APIS
// ==========================================
// READ: መምህሩ የራሱን ተማሪዎች ብቻ ማምጫ
app.get('/api/teacher/students/:teacherId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, email, role, created_at')
      .eq('teacher_id', req.params.teacherId)
      .eq('role', 'student')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// CREATE: መምህሩ አዲስ ተማሪ መመዝገቢያ (ከነ Password ማጣሪያ)
app.post('/api/teacher/students', async (req, res) => {
  const { full_name, email, password, teacher_id } = req.body;

  if (!isStrongPassword(password)) {
    return res.status(400).json({ 
      error: 'የይለፍ ቃል ቢያንስ 6 ሆሄያት ሆኖ ፊደል፣ ቁጥር እና ልዩ ምልክት (!@#$%^&*) ማካተት አለበት!' 
    });
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .insert([{
        full_name,
        email,
        password,
        role: 'student',
        teacher_id: teacher_id
      }])
      .select();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// UPDATE: መምህሩ የተማሪውን መረጃ ማስተካከያ (Edit Student)
app.put('/api/teacher/students/:id', async (req, res) => {
  const { full_name, email, password } = req.body;
  const updateData = { full_name, email };
  
  if (password && password.trim() !== "") {
    if (!isStrongPassword(password)) {
      return res.status(400).json({ 
        error: 'አዲሱ የይለፍ ቃል ቢያንስ 6 ሆሄያት ሆኖ ፊደል፣ ቁጥር እና ልዩ ምልክት ማካተት አለበት!' 
      });
    }
    updateData.password = password;
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', req.params.id)
      .select();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE: መምህሩ ተማሪን ከክፍሉ ማጥፊያ (Delete Student)
app.delete('/api/teacher/students/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', req.params.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================================
// 7. ADMIN CRUD APIS (ተማሪዎችን ያገለለ!)
// ==========================================
const activeTeachers = new Set();

// Users List (ተማሪዎችን ሳያካትት መምህራን እና አድሚኖችን ብቻ ማሳያ)
app.get('/api/users', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, email, role, created_at')
      .neq('role', 'student') // ተማሪዎችን ለአድሚን አታሳይ!
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    const usersWithStatus = data.map(u => ({
      ...u,
      isOnline: activeTeachers.has(u.id)
    }));

    res.json(usersWithStatus);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/users', async (req, res) => {
  const { full_name, email, password, role } = req.body;

  if (!isStrongPassword(password)) {
    return res.status(400).json({ 
      error: 'የይለፍ ቃል ቢያንስ 6 ሆሄያት ሆኖ ፊደል፣ ቁጥር እና ልዩ ምልክት ማካተት አለበት!' 
    });
  }

  try {
    const { data, error } = await supabase.from('users').insert([{ full_name, email, password, role }]).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  const { error } = await supabase.from('users').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Devices CRUD (Fail-Safe Fallback)
let localDevicesList = [
  {
    id: "dev-01",
    device_name: "Lab-1 PC-01",
    os_type: "Windows",
    ip_address: "192.168.1.50",
    mac_address: "00:1A:2B:3C:4D:5E",
    serial_number: "SN-9823472",
    assigned_room: "Main Lab",
    status: "offline"
  }
];

app.get('/api/devices', async (req, res) => {
  try {
    const { data, error } = await supabase.from('devices').select('*').order('last_seen', { ascending: false });
    if (!error && data && data.length > 0) return res.json(data);
  } catch (e) {}
  res.json(localDevicesList);
});

app.post('/api/devices', async (req, res) => {
  const { device_name, os_type, ip_address, mac_address, serial_number, assigned_room } = req.body;
  const newDevice = {
    id: "dev-" + Date.now(),
    device_name: device_name || 'Lab PC',
    os_type: os_type || 'Windows',
    ip_address: ip_address || '-',
    mac_address: mac_address || '-',
    serial_number: serial_number || '-',
    assigned_room: assigned_room || 'Main Lab',
    status: 'offline'
  };

  try {
    const { data, error } = await supabase.from('devices').insert([newDevice]).select();
    if (!error && data) {
      localDevicesList.unshift(data[0]);
      return res.json(data[0]);
    }
  } catch (e) {}

  localDevicesList.unshift(newDevice);
  res.json(newDevice);
});

app.delete('/api/devices/:id', async (req, res) => {
  const id = req.params.id;
  try { await supabase.from('devices').delete().eq('id', id); } catch (e) {}
  localDevicesList = localDevicesList.filter(d => d.id !== id);
  res.json({ success: true });
});

// ==========================================
// 8. WEBSOCKET LOGIC (ROOM ISOLATION & CCTV)
// ==========================================
const connectedDevices = new Map(); // socketId -> deviceData

io.on('connection', (socket) => {
  console.log(`🔌 አዲስ ግንኙነት ተፈጠረ: ${socket.id}`);

  // 1. መምህሩ ሲገናኝ
  socket.on('master:join', (data) => {
    const teacherId = data && data.teacherId ? data.teacherId : null;
    
    if (teacherId) {
      activeTeachers.add(teacherId);
      socket.teacherId = teacherId;
      socket.join(`room_${teacherId}`);
      socket.myRoom = `room_${teacherId}`;
      console.log(`🟢 መምህር Online ሆነ: ${teacherId}`);

      // ለመምህሩ የራሱን ተማሪዎች ብቻ ልክለት
      const myStudents = Array.from(connectedDevices.values()).filter(d => d.teacherId === teacherId);
      socket.emit('master:devices-list', myStudents);
    } else {
      socket.join('admin_isolated_room');
      socket.myRoom = 'admin_isolated_room';
    }
  });

  // 2. ተማሪ ኮምፒውተር ራሱን ሲያስመዘግብ
  socket.on('device:register', async (deviceData) => {
    const teacherId = deviceData.teacherId || 'default_room';
    socket.join(`room_${teacherId}`);

    const fullDeviceData = {
      socketId: socket.id,
      deviceId: deviceData.deviceId || socket.id,
      name: deviceData.name || 'ያልታወቀ ተማሪ',
      os: deviceData.os || 'Windows',
      battery: 100,
      teacherId: teacherId,
      isLocked: false,
      status: 'online'
    };

    connectedDevices.set(socket.id, fullDeviceData);
    console.log(`🎓 ተማሪ (${fullDeviceData.name}) ወደ መምህሩ ክፍል ገባ: room_${teacherId}`);

    io.to(`room_${teacherId}`).emit('master:device-connected', fullDeviceData);
  });

  // 3. ከ Dashboard የሚላኩ ትዕዛዞች
  socket.on('master:send-command', (data) => {
    const { targetSocketId, command, payload } = data;
    if (targetSocketId) {
      io.to(targetSocketId).emit('client:execute-command', { command, payload });
    } else if (socket.myRoom) {
      socket.to(socket.myRoom).emit('client:execute-command', { command, payload });
    }
  });

  // 4. የተማሪው ስክሪን ምስል (CCTV Frame ለመምህሩ ብቻ)
  socket.on('client:stream-frame', (frameData) => {
    const dev = connectedDevices.get(socket.id);
    if (dev && dev.teacherId) {
      io.to(`room_${dev.teacherId}`).emit('master:device-frame', frameData);
    }
  });

  // 5. የአስተማሪው Demonstration ስክሪን
  socket.on('master:broadcast-frame', (frameData) => {
    if (socket.myRoom) {
      socket.to(socket.myRoom).emit('master:broadcast-frame', frameData);
    }
  });

  // 6. ግንኙነት ሲቋረጥ
  socket.on('disconnect', () => {
    if (socket.teacherId) {
      activeTeachers.delete(socket.teacherId);
      console.log(`🔴 መምህር Offline ሆነ: ${socket.teacherId}`);
    }

    const device = connectedDevices.get(socket.id);
    if (device) {
      connectedDevices.delete(socket.id);
      io.to(`room_${device.teacherId}`).emit('master:device-disconnected', socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🚀 Secure Cloud-Veyon Server እየሰራ ነው በ Port: ${PORT}`);
  console.log(`🌐 Login Page: http://localhost:${PORT}`);
  console.log(`===============================================`);
});