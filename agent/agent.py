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
# የ Codespaces የሰርቨርህ ዩአርኤል (URL)
SERVER_URL = "https://symmetrical-fiesta-x56wx76jjjp5cp65g-3000.app.github.dev"
DEVICE_NAME = "Windows Student PC"
# -------------------------------------------------------

sio = socketio.Client(reconnection=True, reconnection_attempts=0, reconnection_delay=2)

def execute_system_command(command, payload=None):
    """ከ Master Dashboard የሚመጡ ትዕዛዞችን በዊንዶውስ ላይ መፈጸሚያ"""
    print(f"[*] ትዕዛዝ ደርሷል: {command}")
    
    if command == "lock":
        ctypes.windll.user32.LockWorkStation()
        
    elif command == "reboot":
        os.system("shutdown /r /t 5")
        
    elif command == "poweroff" or command == "shutdown":
        os.system("shutdown /s /t 5")
        
    elif command == "message":
        msg = payload.get("text", "ከአስተማሪ የተላከ መልዕክት") if payload else "ማሳሰቢያ ከአስተማሪ!"
        threading.Thread(target=lambda: ctypes.windll.user32.MessageBoxW(0, msg, "Cloud-Veyon ማሳሰቢያ", 0x40 | 0x1)).start()

@sio.event
def connect():
    print("[✓] ከ Cloud-Veyon Dashboard ጋር በተሳካ ሁኔታ ተገናኝቷል!")
    sio.emit('register-device', {
        'name': DEVICE_NAME,
        'os': 'Windows',
        'battery': 100
    })

@sio.event
def disconnect():
    print("[!] ግንኙነት ተቋርጧል! እንደገና በመሞከር ላይ...")

@sio.on('client:execute-command')
def on_command(data):
    cmd = data.get('command')
    payload = data.get('payload', {})
    execute_system_command(cmd, payload)

def stream_screen_worker():
    """ስክሪኑን ያለማቋረጥ ፎቶ እያነሳ በጀርባ ለሰርቨሩ የሚልክ ተግባር"""
    with mss.mss() as sct:
        monitor = sct.monitors[1]  # ዋናው ስክሪን
        while True:
            if sio.connected:
                try:
                    sct_img = sct.grab(monitor)
                    img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
                    img.thumbnail((800, 450))
                    buffer = io.BytesIO()
                    img.save(buffer, format="JPEG", quality=50)
                    
                    img_str = base64.b64encode(buffer.getvalue()).decode('utf-8')
                    formatted_base64 = f"data:image/jpeg;base64,{img_str}"
                    
                    sio.emit('client:stream-frame', {
                        'socketId': sio.sid,
                        'imageBase64': formatted_base64
                    })
                except Exception as e:
                    pass
            time.sleep(0.3)

if __name__ == "__main__":
    stream_thread = threading.Thread(target=stream_screen_worker, daemon=True)
    stream_thread.start()
    
    while True:
        try:
            sio.connect(SERVER_URL)
            sio.wait()
        except Exception:
            time.sleep(3)
