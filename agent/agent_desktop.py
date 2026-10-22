import time
import base64
import io
import os
import ctypes
import threading
import tkinter as tk
from tkinter import messagebox
import socketio
import mss
from PIL import Image

# ----------------- ማስተካከያ (CONFIGURATION) -----------------
SERVER_URL = "https://symmetrical-fiesta-x56wx76jjjp5cp65g-3000.app.github.dev"
DEVICE_NAME = "Lab-1 Student PC"
# -------------------------------------------------------------

sio = socketio.Client(reconnection=True, reconnection_attempts=0, reconnection_delay=2)

def execute_system_command(command, payload=None):
    """ከ Master Dashboard የሚመጡ አስተዳደራዊ ትዕዛዞች"""
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
        monitor = sct.monitors[1]  # ዋናው ስክሪን
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
                    
                    sio.emit('client:stream-frame', {
                        'socketId': sio.sid,
                        'imageBase64': formatted_base64
                    })
                except Exception:
                    pass
            time.sleep(0.3)

def start_socket():
    """ከ Socket.IO ሰርቨር ጋር ግንኙነት መፍጠር"""
    while True:
        try:
            sio.connect(SERVER_URL)
            sio.wait()
        except Exception:
            time.sleep(3)

# ----------------- የተማሪው የማሳሰቢያ መስኮት (GUI) -----------------
def create_status_ui():
    """ተማሪው ክትትል እየተደረገበት መሆኑን የሚያሳይ አነስተኛ መስኮት"""
    root = tk.Tk()
    root.title("Cloud-Veyon Client")
    root.geometry("320x130")
    root.configure(bg="#0f172a")
    root.resizable(False, False)

    lbl_title = tk.Label(
        root, text="🖥️ Cloud-Veyon Lab Client", 
        font=("Segoe UI", 12, "bold"), fg="#38bdf8", bg="#0f172a"
    )
    lbl_title.pack(pady=10)

    lbl_status = tk.Label(
        root, text="● ከላብራቶሪ አስተማሪ ጋር ተገናኝቷል", 
        font=("Segoe UI", 10), fg="#34d399", bg="#0f172a"
    )
    lbl_status.pack(pady=5)

    lbl_info = tk.Label(
        root, text="ትምህርቱን በትኩረት ይከታተሉ።", 
        font=("Segoe UI", 9), fg="#94a3b8", bg="#0f172a"
    )
    lbl_info.pack(pady=5)

    root.mainloop()

if __name__ == "__main__":
    # 1. የኔትወርክ ግንኙነት እና ስክሪን መላኪያ በጀርባ Thread ማስጀመር
    threading.Thread(target=start_socket, daemon=True).start()
    threading.Thread(target=stream_screen_worker, daemon=True).start()

    # 2. የተማሪውን ማሳወቂያ መስኮት ማስነሳት
    create_status_ui()