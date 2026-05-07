# Backend Setup Guide - Plant Doctor App

## ✅ Quick Setup Checklist

Follow these steps to fix the backend connection issue:

---

### Step 1: Get Gemini API Key (Required)

1. Visit: https://aistudio.google.com/app/apikey
2. Click **Create API Key**
3. Copy the key (starts with `AIzaSy...`)
4. Open `backend\.env`
5. Replace `YOUR_REAL_GEMINI_API_KEY_HERE` with your actual key

```env
GEMINI_API_KEY=AIzaSyYourActualKeyHere
```

---

### Step 2: Verify Model File Exists

Check that the YOLO model exists at:
```
backend/app/models/leaf_detector.pt
```

✅ Already exists - No action needed

---

### Step 3: Update Frontend `.env` (If Needed)

Your current IP: `192.168.10.62`

Open `.env` in the project root and verify:
```env
EXPO_PUBLIC_API_BASE_URL=http://192.168.10.62:8000
```

**Important:** If your IP changes, update this value.

To find your IP:
```bash
ipconfig | findstr /i "IPv4"
```

---

### Step 4: Install Backend Dependencies

```bash
cd backend
pip install -r requirements.txt
```

---

### Step 5: Run the Backend

From project root:
```bash
npm run backend
```

Or from backend folder:
```bash
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

---

### Step 6: Verify Backend is Running

Open browser or use curl:
```bash
curl http://192.168.10.62:8000/health
```

Expected response:
```json
{
  "status": "ok",
  "modelReady": true,
  "modelPath": "backend/app/models/leaf_detector.pt"
}
```

---

### Step 7: Test on Mobile Device

**Requirements:**
- ✅ Phone and PC on same Wi-Fi network
- ✅ Backend running on PC
- ✅ Correct IP in `.env`
- ✅ Firewall allows port 8000

**If connection fails:**

1. **Check Windows Firewall:**
   - Allow Python through firewall
   - Or temporarily disable firewall for testing

2. **Restart Expo Dev Server:**
   ```bash
   npm start
   ```

3. **Clear Expo Cache:**
   ```bash
   npm start --clear
   ```

---

## 🔧 Troubleshooting

### Error: "Backend se connection nahi ho saka"

**Causes:**
1. Backend not running → Run `npm run backend`
2. Wrong IP → Check `ipconfig` and update `.env`
3. Different Wi-Fi → Ensure phone and PC on same network
4. Firewall blocking → Allow port 8000

### Error: "Model not found"

**Solution:**
```bash
# Verify model path in backend/.env
LEAF_DETECTOR_MODEL_PATH=backend/app/models/leaf_detector.pt

# Check file exists
dir backend\app\models\leaf_detector.pt
```

### Error: "Gemini API error"

**Solution:**
- Verify API key is correct in `backend\.env`
- Check key starts with `AIzaSy`
- Ensure no quotes around the key
- Verify internet connection

---

## 📋 Configuration Summary

| Setting | Value | Status |
|---------|-------|--------|
| Backend Port | 8000 | ✅ |
| PC IP Address | 192.168.10.62 | ✅ |
| Model File | Exists | ✅ |
| Gemini Key | Not Set | ⚠️ **Action Required** |

---

##  Network Setup

**For Local Development:**
- PC IP: `192.168.10.62`
- Backend URL: `http://192.168.10.62:8000`
- Port: `8000`

**For Production:**
- Deploy backend to cloud (Render, Railway, etc.)
- Update `EXPO_PUBLIC_API_BASE_URL` to production URL

---

## 📞 Need Help?

1. Check backend logs for errors
2. Verify all steps above
3. Test health endpoint: `http://192.168.10.62:8000/health`
4. Ensure same Wi-Fi network
