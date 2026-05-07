# YOLO Leaf Detector Training

This folder helps you train the missing `leaf_detector.pt` file required by the backend.

## 1. Dataset structure

Your YOLO detection dataset should look like this:

```txt
backend/training/datasets/leaf_detection/
  images/
    train/
    val/
    test/
  labels/
    train/
    val/
    test/
```

Each label file must contain YOLO-format bounding boxes for the `leaf` class.

Example label line:

```txt
0 0.512 0.433 0.214 0.381
```

## 2. Update dataset config

Edit:

`backend/training/data/leaf_dataset.yaml`

Set the correct absolute or relative paths if needed.

## 3. Install backend dependencies

From repo root:

```bash
pip install -r backend/requirements.txt
```

## 4. Start training

From repo root:

```bash
python backend/training/train_yolo.py
```

## 5. Copy best model

After training, copy the best weights to:

`backend/app/models/leaf_detector.pt`

Usually Ultralytics saves best weights under a path like:

```txt
runs/detect/leaf_detector/weights/best.pt
```

## 6. Run backend

```bash
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

## 7. Verify backend

```bash
curl http://127.0.0.1:8000/health
```

Expected:

```json
{
  "status": "ok",
  "modelReady": true,
  "modelPath": "backend/app/models/leaf_detector.pt"
}
```

## Notes

- This project expects a custom-trained leaf detection model.
- There is no accurate fallback if the detector is missing.
- If your dataset is weak, detection quality will remain weak.
