# Backend Setup

## 1. Install dependencies

```bash
pip install -r requirements.txt
```

## 2. Configure environment

Create `backend/.env` from `backend/.env.example`.

Minimum required values:

```env
GEMINI_API_KEY=your_real_gemini_key
LEAF_DETECTOR_MODEL_PATH=backend/app/models/leaf_detector.pt
```

## 3. Add your trained YOLO model

Place your trained leaf detector at:

`backend/app/models/leaf_detector.pt`

If the filename is different, update `LEAF_DETECTOR_MODEL_PATH` in `backend/.env`.

If you do not have a trained model yet, use:

`backend/training/README.md`

to train and export `leaf_detector.pt`.

## 4. Run the backend

From the repo root:

```bash
npm run backend
```

Or from inside `backend`:

```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## MongoDB for scan history (Docker)

From repo root:

```bash
docker compose -f docker-compose.mongo.yml up -d
```

Set in `backend/.env`:

```env
MONGO_URI=mongodb://root:rootpass@localhost:27017
MONGO_DB_NAME=plant_scanner
```

Mongo Express UI:

`http://localhost:8081`

## 5. Verify backend health

```bash
curl http://127.0.0.1:8000/health
```

Example response:

```json
{
  "status": "ok",
  "modelReady": true,
  "modelPath": "backend/app/models/leaf_detector.pt"
}
```
