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
  cors: { origin: "*" }
});

// 1. Supabase Setup (ከ API በፊተ መሆን አለበት)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLIC_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 2. Middlewares
app.use(cors());
app.use(express.json());

// ==========================================
// 3. መጀመሪያ ሲከፈት በግዴታ LOGIN PAGE እንዲመጣ ማድረግ
// (index: false በማድረግ index.html እንዳይቀድም እንከለክለዋለን)
// ==========================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// static files (ያለ auto-index)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ==========================================
// 4. የተጠቃሚዎች LOGIN ማረጋገጫ API
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

    // ሚናውን (Role) መሰረት አድርጎ መምራት
    let redirectUrl = '/index.html'; // ለ Admin እና Teacher
    if (user.role === 'student') {
      redirectUrl = '/client.html';
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.full_name,
        email: user.email,
        role: user.role
      },
      redirectUrl: redirectUrl
    });

  } catch (err) {
    res.status(500).json({ success: false, message: 'የሰርቨር ችግር አጋጥሟል' });
  }
});


// ==========================================
// CRUD APIS (USERS & DEVICES)
// ==========================================

// 1. Users CRUD
app.get('/api/users', async (req, res) => {
  const { data, error } = await supabase.from('users').select('id, full_name, email, role, created_at');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/users', async (req, res) => {
  const { full_name, email, password, role } = req.body;
  const { data, error } = await supabase.from('users').insert([{ full_name, email, password, role }]).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

app.delete('/api/users/:id', async (req, res) => {
  const { error } = await supabase.from('users').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// 2. Devices CRUD
app.get('/api/devices', async (req, res) => {
  const { data, error } = await supabase.from('devices').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/devices', async (req, res) => {
  const { device_name, mac_address, ip_address, serial_number, os_type, assigned_room } = req.body;
  const { data, error } = await supabase.from('devices').insert([{
    device_name, mac_address, ip_address, serial_number, os_type, assigned_room, status: 'offline'
  }]).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

app.delete('/api/devices/:id', async (req, res) => {
  const { error } = await supabase.from('devices').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ==========================================
// 5. WEBSOCKET LOGIC (SOCKET.IO)
// ==========================================
const connectedDevices = new Map(); // socketId -> deviceData

io.on('connection', (socket) => {
  console.log(`🔌 አዲስ ግንኙነት ተፈጠረ: ${socket.id}`);

  // 1. Master Dashboard ሲገናኝ
  socket.on('master:join', () => {
    socket.join('master-room');
    console.log('👑 Master Dashboard ተገናኝቷል');
    const devicesList = Array.from(connectedDevices.values());
    socket.emit('master:devices-list', devicesList);
  });

  // 2. ስልክ ወይም ተማሪ ኮምፒውተር ራሱን ሲያስመዘግብ
  socket.on('device:register', async (deviceData) => {
    socket.join('clients-room');
    const fullDeviceData = {
      socketId: socket.id,
      deviceId: deviceData.deviceId || socket.id,
      name: deviceData.name || 'ያልታወቀ መሳሪያ',
      os: deviceData.os || 'Web',
      battery: deviceData.battery || 100,
      isLocked: false,
      status: 'online'
    };

    connectedDevices.set(socket.id, fullDeviceData);
    console.log(`📱 አዲስ መሳሪያ ተመዘገበ: ${fullDeviceData.name} (${socket.id})`);

    try {
      await supabase.from('devices').upsert({
        id: fullDeviceData.deviceId,
        device_name: fullDeviceData.name,
        os_type: fullDeviceData.os,
        battery_level: fullDeviceData.battery,
        status: 'online',
        last_seen: new Date().toISOString()
      });
    } catch (e) {
      console.log('DB sync notice:', e.message);
    }

    io.to('master-room').emit('master:device-connected', fullDeviceData);
  });

  // 3. ከ Master Dashboard ወደ መሳሪያ የሚላኩ ትዕዛዞች
  socket.on('master:send-command', (data) => {
    const { targetSocketId, command, payload } = data;
    console.log(`⚡ ትዕዛዝ ተልኳል [${command}] ወደ መሳሪያ: ${targetSocketId || 'ALL'}`);

    if (targetSocketId) {
      io.to(targetSocketId).emit('client:execute-command', { command, payload });
    } else {
      socket.to('clients-room').emit('client:execute-command', { command, payload });
    }
  });

  // 4. መሳሪያው ለተላከው ትዕዛዝ ውጤት ሲመልስ
  socket.on('client:command-result', (result) => {
    console.log(`✅ የስራ ውጤት ደርሷል:`, result);
    io.to('master-room').emit('master:command-ack', result);
  });

  // 5. ተማሪው ለ CCTV ክትትል የስክሪን ምስል በየሰከንዱ ሲልክ
  socket.on('client:stream-frame', (frameData) => {
    io.to('master-room').emit('master:device-frame', frameData);
  });

  // 6. የአስተማሪውን ስክሪን ለሁሉም ተማሪዎች ማስተላለፍ (Live Demonstration)
  socket.on('master:broadcast-frame', (frameData) => {
    socket.to('clients-room').emit('master:broadcast-frame', frameData);
  });

  // 7. መሳሪያው ሲቋረጥ
  socket.on('disconnect', async () => {
    const device = connectedDevices.get(socket.id);
    if (device) {
      console.log(`❌ መሳሪያ ተቋረጠ: ${device.name}`);
      connectedDevices.delete(socket.id);
      
      io.to('master-room').emit('master:device-disconnected', socket.id);

      try {
        await supabase.from('devices').update({ status: 'offline' }).eq('id', device.deviceId);
      } catch (e) {}
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🚀 Cloud-Veyon Server እየሰራ ነው በ Port: ${PORT}`);
  console.log(`🌐 Login Page: http://localhost:${PORT}`);
  console.log(`===============================================`);
});