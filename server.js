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

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Supabase Setup
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLIC_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// በመስመር ላይ ያሉ መሳሪያዎች (In-Memory Connected Devices Map)
const connectedDevices = new Map(); // socketId -> deviceData

io.on('connection', (socket) => {
  console.log(`🔌 አዲስ ግንኙነት ተፈጠረ: ${socket.id}`);

  // 1. ተቆጣጣሪው (Master Dashboard) ሲገናኝ
  socket.on('master:join', () => {
    socket.join('master-room');
    console.log('👑 Master Dashboard ተገናኝቷል');
    // ያሉትን የተገናኙ መሳሪያዎች ዝርዝር ላክለት
    const devicesList = Array.from(connectedDevices.values());
    socket.emit('master:devices-list', devicesList);
  });

  // 2. ስልክ ወይም ተማሪ ኮምፒውተር (Client Device) ራሱን ሲያስመዘግብ
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

    // ዳታቤዝ ላይ Update ማድረግ
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

    // ለ Master Dashboard አዲሱን ስልክ አሳውቀው
    io.to('master-room').emit('master:device-connected', fullDeviceData);
  });

  // 3. ከ Master Dashboard ወደ መሳሪያ የሚላኩ ትዕዛዞች (Lock, Message, Screenshot...)
  socket.on('master:send-command', (data) => {
    const { targetSocketId, command, payload } = data;
    console.log(`⚡ ትዕዛዝ ተልኳል [${command}] ወደ መሳሪያ: ${targetSocketId || 'ALL'}`);

    if (targetSocketId) {
      // ለአንድ መሳሪያ ብቻ መላክ
      io.to(targetSocketId).emit('client:execute-command', { command, payload });
    } else {
      // ለሁሉም መሳሪያዎች በአንድ ጊዜ መላክ (Broadcast)
      socket.to('clients-room').emit('client:execute-command', { command, payload });
    }
  });

  // 4. መሳሪያው ለተላከው ትዕዛዝ ውጤት ሲመልስ
  socket.on('client:command-result', (result) => {
    console.log(`✅ የስራ ውጤት ደርሷል:`, result);
    io.to('master-room').emit('master:command-ack', result);
  });

  // 5. መሳሪያው ለ CCTV ክትትል የስክሪን ምስል በየሰከንዱ ሲልክ (Live Monitoring Stream)
  socket.on('client:stream-frame', (frameData) => {
    // frameData = { socketId, imageBase64 }
    io.to('master-room').emit('master:device-frame', frameData);
  });

  // 6. መሳሪያው ሲቋረጥ (Disconnect)
  socket.on('disconnect', async () => {
    const device = connectedDevices.get(socket.id);
    if (device) {
      console.log(`❌ መሳሪያ ተቋረጠ: ${device.name}`);
      connectedDevices.delete(socket.id);
      
      // ለ Master አሳውቅ
      io.to('master-room').emit('master:device-disconnected', socket.id);

      // ዳታቤዝ ላይ Offline አድርገው
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
  console.log(`🌐 Dashboard: http://localhost:${PORT}/index.html`);
  console.log(`📱 Client Simulator: http://localhost:${PORT}/client.html`);
  console.log(`===============================================`);
});
socket.on('master:broadcast-frame', (frameData) => {
  // የአስተማሪውን ምስል ለሁሉም ተማሪዎች ላክ
  socket.to('clients-room').emit('master:broadcast-frame', frameData);
});