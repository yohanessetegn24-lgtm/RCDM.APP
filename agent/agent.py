import time
import base64
import io
import os
import ctypes
import threading
import socketio
import mss
from PIL import Image

# ----------------- ማስተካከያ (SETTINGS) -----------------
SERVER_URL = "https://symmetrical-fiesta-x56wx76jjjp5cp65g-3000.app.github.dev"
DEVICE_NAME = "Lab-1 Student PC"
# -------------------------------------------------------

sio = socketio.Client(reconnection=True, reconnection_attempts=0, reconnection_delay=2)

def execute_system_command(command, payload=None):
    """ከ Master Dashboard የሚመጡ አስተዳደራዊ ትዕዛዞችን ማስተናገጃ"""
    print(f"[*] ትዕዛዝ ደርሷል: {command}")
    cmd = (command or "").upper()
    
    if cmd == "LOCK":
        # ስክሪን መቆለፍ
        ctypes.windll.user32.LockWorkStation()
        
    elif cmd == "REBOOT":
        os.system("shutdown /r /t 5")
        
    elif cmd == "POWER_OFF" or cmd == "POWEROFF":
        os.system("shutdown /s /t 5")
        
    elif cmd == "MESSAGE":
        msg = payload.get("message") or payload.get("text") or "ማሳሰቢያ ከአስተማሪ!"
        # ለተጠቃሚው ግልጽ ማስታወሻ ማሳየት
        threading.Thread(
            target=lambda: ctypes.windll.user32.MessageBoxW(0, msg, "Cloud-Veyon Lab Alert", 0x40 | 0x1)
        ).start()

@sio.event
def connect():
    print("[✓] ከ Cloud-Veyon Dashboard ጋር ተገናኝቷል!")
    # በ server.js ውስጥ ካለው 'device:register' ጋር የተጣጣመ
    sio.emit('device:register', {
        'deviceId': sio.sid,
        'name': DEVICE_NAME,
        'os': 'Windows',
        'battery': 100
    })

@sio.event
def disconnect():
    print("[!] ግንኙነት ተቋርጧል!")

@sio.on('client:execute-command')
def on_command(data):
    cmd = data.get('command')
    payload = data.get('payload', {})
    execute_system_command(cmd, payload)

def stream_screen_worker():
    """የስክሪን ፍሬም በየሰከንዱ መላኪያ"""
    with mss.mss() as sct:
        monitor = sct.monitors[1]
        while True:
            if sio.connected:
                try:
                    sct_img = sct.grab(monitor)
                    img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
                    img.thumbnail((640, 360))
                    
                    buffer = io.BytesIO()
                    img.save(buffer, format="JPEG", quality=50)
                    
                    img_str = base64.b64encode(buffer.getvalue()).decode('utf-8')
                    formatted_base64 = f"data:image/jpeg;base64,{img_str}"
                    
                    # ወደ ዳሽቦርዱ መላክ
                    sio.emit('client:stream-frame', {
                        'socketId': sio.sid,
                        'imageBase64': formatted_base64
                    })
                except Exception as e:
                    pass
            time.sleep(0.3)

if __name__ == "__main__":
    print(f"--- Cloud-Veyon Student Service እየሰራ ነው ({DEVICE_NAME}) ---")
    stream_thread = threading.Thread(target=stream_screen_worker, daemon=True)
    stream_thread.start()
    
    while True:
        try:
            sio.connect(SERVER_URL)
            sio.wait()
        except Exception:
            time.sleep(3)