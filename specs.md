# Plant Analysis Index And Leaf-Level Detection Spec

## 1. Current Codebase Index

### App structure

- `app/_layout.tsx`
  - Wraps the app with Clerk authentication provider.
  - Uses a hardcoded Clerk publishable key.
- `app/(auth)/_layout.tsx`
  - Redirects signed-in users to `/`.
- `app/(auth)/sign-in.tsx`
  - Sign-in screen using Clerk + `react-hook-form`.
- `app/(auth)/sign-up.tsx`
  - Sign-up and email verification flow.
- `app/(home)/index.tsx`
  - Main authenticated landing page.
  - Renders the plant analyzer screen from `app/imagePicker.tsx/imagepicker.tsx`.
- `app/imagePicker.tsx/imagepicker.tsx`
  - Main product logic.
  - Image pick/camera flow.
  - Plant validation.
  - Plant analysis.
  - Suggestions generation.
  - Chat assistant.

### Where the actual plant detection logic lives

All meaningful plant-analysis behavior is inside:

- `app/imagePicker.tsx/imagepicker.tsx`

Important sections in that file:

- `processFile` around line 164
  - Loads selected image.
  - Calls Gemini as a bio-filter to check whether the image is a plant.
- `analyzePlantGrowth` around line 426
  - Sends the full image to Gemini.
  - Asks for one JSON result for the whole image.
- `getSuggestions` around line 306
  - Uses the same image + report to generate care suggestions.
- `handleSendChat` around line 544
  - Uses the single plant report as context for chat.

## 2. What The Current App Is Actually Doing

Right now the app is **not doing true computer vision detection of each leaf**.

It is doing this:

1. User selects one image.
2. App converts the full image to base64.
3. App sends the full image directly to Gemini.
4. Gemini is prompted to return one summary JSON for the whole plant image.
5. UI shows one `Growth Report`.

The current main prompt in `analyzePlantGrowth` is effectively asking:

- growth stage of the plant
- overall vitality
- one metrics string
- one overall condition

That means the system is designed for:

- **whole-image inference**
- **whole-plant summary**
- **single report output**

It is not designed for:

- leaf counting
- leaf localization
- leaf segmentation
- leaf-wise disease classification
- showing condition per leaf

## 3. Why It Is Detecting The Whole Plant Instead Of Each Leaf

This is the main issue:

### Issue 1: The prompt asks for one plant summary, not per-leaf output

In `analyzePlantGrowth`, the prompt says:

- analyze this plant image
- return one JSON object
- include one stage
- include one vitality
- include one metrics string

So the model has no instruction to:

- find all leaves
- create multiple regions
- inspect each leaf separately

### Issue 2: There is no localization step

Leaf-level analysis needs at least one of these:

- object detection bounding boxes
- instance segmentation masks
- contour extraction after segmentation
- manual region selection by user

Your current app has none of these steps.

So even if the image contains 10 leaves, the system still sees one full image and returns one global answer.

### Issue 3: Gemini is being used like a detector, but no structured detector exists

Gemini can describe an image, but it is not a reliable replacement for:

- YOLO detection
- Mask R-CNN / segmentation
- leaf instance segmentation
- disease classifier per crop

Without a dedicated localization stage, per-leaf analysis will remain weak and inconsistent.

### Issue 4: Output schema only supports one result

Current parsed output:

- `stage`
- `vitality`
- `metrics`

This schema cannot represent:

- leaf 1 healthy
- leaf 2 yellowing
- leaf 3 fungal spots
- leaf 4 pest damage

### Issue 5: UI only has a single `Growth Report` card

The UI currently renders:

- one summary card
- one suggestions block
- one chat context

There is no list/grid/map for:

- leaf IDs
- leaf boxes
- leaf thumbnails
- leaf condition labels
- severity per leaf

## 4. The Real Requirement You Want

You want the app to do this instead:

1. User uploads a plant image.
2. System finds all visible leaves in the image.
3. Each leaf is isolated as its own region.
4. Each leaf is analyzed separately.
5. App returns a list like:
   - Leaf 1: healthy
   - Leaf 2: yellowing, moderate
   - Leaf 3: brown spots, severe
   - Leaf 4: possible pest damage
6. UI shows each leaf and its condition.
7. Overall plant summary is generated from all leaf results.

This is a different pipeline from the current one.

## 5. Recommended Technical Direction

### Best approach: 2-stage pipeline

Use:

1. **Leaf localization**
   - detect or segment each leaf first
2. **Leaf condition classification**
   - classify each extracted leaf separately

This is the correct architecture.

### Stage A: Leaf localization

Possible options:

#### Option A1: Instance segmentation model

Best option if you want proper per-leaf results.

Use a model such as:

- YOLOv8-seg / YOLO11-seg trained for leaf instances
- Mask R-CNN
- Detectron2 instance segmentation

Output:

- one mask per leaf
- one bounding box per leaf
- confidence score

This is ideal because overlapping leaves can still be separated better than plain object detection.

#### Option A2: Object detection model

Simpler than segmentation.

Use:

- YOLOv8 / YOLO11 object detection for `leaf`

Output:

- bounding box per leaf

This is easier to implement, but weaker when leaves overlap heavily.

#### Option A3: Classical CV fallback

Possible only if images are simple:

- plain background
- one plant
- visible leaf edges

Method:

- background removal
- color thresholding
- edge detection
- contour detection

This is cheaper but unreliable in real-world mobile photos.

### Stage B: Per-leaf condition analysis

After getting each leaf crop:

- send each crop to a disease/condition classifier
- or send each crop to Gemini with a strict leaf-level prompt

Recommended output per leaf:

```json
{
  "leafId": "leaf_1",
  "bbox": { "x": 120, "y": 80, "width": 160, "height": 210 },
  "condition": "yellowing",
  "severity": "moderate",
  "confidence": 0.88,
  "observations": [
    "chlorosis near edges",
    "minor brown spotting"
  ],
  "recommendation": "check nitrogen balance and watering stress"
}
```

### Stage C: Aggregate plant summary

After all leaf results are available, generate:

- total leaves detected
- healthy leaves count
- affected leaves count
- dominant issue
- overall severity
- action plan

Example:

```json
{
  "plantSummary": {
    "totalLeaves": 12,
    "healthyLeaves": 8,
    "affectedLeaves": 4,
    "dominantIssue": "yellowing",
    "overallRisk": "medium"
  }
}
```

## 6. What Should Change In Your Current App

### Current architecture

Right now:

- Expo app talks directly to Gemini
- Gemini returns one summary JSON
- frontend renders one report

### Needed architecture

Recommended:

1. Mobile app uploads image to a backend.
2. Backend runs leaf detection/segmentation.
3. Backend crops each leaf.
4. Backend runs per-leaf classification.
5. Backend returns structured leaf array + overall summary.
6. Mobile app renders leaf cards and overlay boxes.

### Why backend is recommended

Because leaf-level analysis requires:

- image processing
- multiple crops per image
- model inference loops
- possibly heavier ML models

Doing all this only inside Expo client is not the right long-term design.

## 7. Minimum Viable Upgrade Path

If you want to improve the app in practical steps:

### Phase 1: Improve prompt and schema only

This is the fastest but least reliable.

Change from one global JSON to:

```json
{
  "leafCountEstimate": 5,
  "leaves": [
    {
      "leafId": "leaf_1",
      "condition": "healthy",
      "severity": "none",
      "notes": "green and intact"
    },
    {
      "leafId": "leaf_2",
      "condition": "yellowing",
      "severity": "mild",
      "notes": "edge yellowing visible"
    }
  ],
  "overallSummary": "Some leaves show mild stress."
}
```

But note:

- this still does not truly detect each leaf
- it is only a visual estimate by Gemini
- no exact boxes or masks

Use this only as a temporary prototype.

### Phase 2: Add manual leaf selection in the UI

Before building ML detection, let the user tap or crop one leaf at a time.

Flow:

1. User uploads plant image.
2. User taps `Add Leaf Region`.
3. User draws rectangle around a leaf.
4. App crops that region.
5. App analyzes that crop separately.
6. Repeat for multiple leaves.

Benefits:

- no ML detector needed initially
- much more accurate than whole-plant prompting
- easy to integrate into current app

This is the best short-term upgrade if speed matters.

### Phase 3: Add automatic leaf detector

Replace manual region selection with:

- trained detector / segmentation model

This is the real scalable solution.

## 8. Exact Problems In The Current Code

### Problem A: Hardcoded secrets in the client

In the current code:

- Clerk publishable key is hardcoded in `app/_layout.tsx`
- Gemini API key is hardcoded in `app/imagePicker.tsx/imagepicker.tsx`

This is risky and should be moved to environment config or backend.

### Problem B: The app fetches model list repeatedly

The code calls:

- `GET /v1/models`

multiple times before each generation request.

This adds:

- latency
- repeated network cost
- unnecessary complexity

It should be cached or removed.

### Problem C: One giant screen file contains all business logic

`app/imagePicker.tsx/imagepicker.tsx` currently handles:

- permission logic
- image picking
- file processing
- validation
- Gemini prompting
- suggestions
- chat
- UI rendering
- styles

This makes future leaf-level work harder.

### Problem D: Analysis output is plain string JSON

The app stores:

- `analysisResult` as `string | null`

Better design:

- parse and store typed object
- use TypeScript interfaces for report schema

### Problem E: No image coordinate system exists

Leaf-level detection needs:

- original image dimensions
- preview dimensions
- coordinate mapping
- overlay rendering

The current implementation has no image-region model.

## 9. Proposed New Data Contracts

### Frontend types

```ts
type LeafCondition =
  | 'healthy'
  | 'yellowing'
  | 'brown_spots'
  | 'wilting'
  | 'pest_damage'
  | 'fungal_suspected'
  | 'unknown';

interface LeafDetection {
  leafId: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
}

interface LeafAnalysis {
  leafId: string;
  condition: LeafCondition;
  severity: 'none' | 'mild' | 'moderate' | 'severe';
  confidence: number;
  observations: string[];
  recommendation: string;
}

interface PlantAnalysisResponse {
  imageId: string;
  totalLeaves: number;
  detections: LeafDetection[];
  analyses: LeafAnalysis[];
  summary: {
    healthyLeaves: number;
    affectedLeaves: number;
    dominantIssue: string;
    overallRisk: 'low' | 'medium' | 'high';
  };
}
```

## 10. Proposed UI Changes

### Replace current single report card with:

1. Image preview with boxes/masks on leaves
2. Summary strip
3. Leaf results list
4. Leaf detail modal

### Example UI sections

- `Detected Leaves: 12`
- `Affected Leaves: 4`
- `Overall Risk: Medium`

Then show:

- Leaf 1
  - Healthy
  - Confidence 92%
- Leaf 2
  - Yellowing
  - Severity moderate
- Leaf 3
  - Brown spots
  - Severity severe

### Important interaction

When user taps a leaf card:

- highlight its box on the image
- open observations and recommendation

## 11. Recommended File Refactor

To support this cleanly, split `app/imagePicker.tsx/imagepicker.tsx` into:

- `features/plant-analysis/screens/PlantAnalyzerScreen.tsx`
- `features/plant-analysis/services/gemini.ts`
- `features/plant-analysis/services/leafDetectionApi.ts`
- `features/plant-analysis/components/ImageOverlay.tsx`
- `features/plant-analysis/components/LeafResultCard.tsx`
- `features/plant-analysis/types.ts`
- `features/plant-analysis/utils/image.ts`

This will make leaf-level work much easier.

## 12. Best Implementation Options

### Option 1: Fastest prototype

- Keep Expo frontend
- Add manual crop selection
- Analyze each selected crop with Gemini

Pros:

- fast to build
- low ML complexity

Cons:

- user effort required
- not automatic

### Option 2: Balanced production path

- Keep Expo frontend
- Add backend API
- Use YOLO detector for leaves
- Use Gemini or classifier for each leaf crop

Pros:

- practical
- scalable
- much better than whole-image analysis

Cons:

- backend required
- model hosting required

### Option 3: Full ML pipeline

- backend with segmentation model
- disease classifier trained on leaf datasets
- expert-labeled taxonomy

Pros:

- best accuracy ceiling
- best localization

Cons:

- largest effort
- dataset and training work needed

## 13. Recommendation For Your Case

For your current codebase, the most practical path is:

1. Short term:
   - add manual per-leaf crop analysis first
2. Medium term:
   - add backend leaf detector
3. Long term:
   - move to segmentation + dedicated disease classifier

Reason:

- your current app is frontend-heavy
- there is no existing backend ML pipeline
- moving directly from whole-plant Gemini prompt to full automatic per-leaf detection is too big in one step

## 14. Suggested Backend API Shape

### Endpoint

`POST /api/plant/analyze-leaves`

### Request

- multipart image upload

### Response

```json
{
  "imageId": "img_123",
  "totalLeaves": 4,
  "detections": [
    { "leafId": "leaf_1", "bbox": { "x": 20, "y": 30, "width": 90, "height": 140 }, "confidence": 0.95 },
    { "leafId": "leaf_2", "bbox": { "x": 120, "y": 50, "width": 100, "height": 150 }, "confidence": 0.91 }
  ],
  "analyses": [
    {
      "leafId": "leaf_1",
      "condition": "healthy",
      "severity": "none",
      "confidence": 0.93,
      "observations": ["uniform green tone"],
      "recommendation": "no action needed"
    },
    {
      "leafId": "leaf_2",
      "condition": "yellowing",
      "severity": "moderate",
      "confidence": 0.87,
      "observations": ["edge chlorosis", "mild browning"],
      "recommendation": "check water stress and nutrient deficiency"
    }
  ],
  "summary": {
    "healthyLeaves": 1,
    "affectedLeaves": 1,
    "dominantIssue": "yellowing",
    "overallRisk": "medium"
  }
}
```

## 15. How To Adapt The Existing Gemini Prompt If You Want A Temporary Upgrade

If you still want to stay on Gemini for now, change the prompt from:

- one global plant report

to:

- estimate visible leaves
- return an array of leaf assessments
- do not provide one combined metrics string only

Example prompt:

```txt
Act as a plant-vision assistant. Analyze the uploaded image and estimate each clearly visible leaf separately.

Return only valid JSON in this shape:
{
  "totalVisibleLeaves": number,
  "leaves": [
    {
      "leafId": "leaf_1",
      "condition": "healthy | yellowing | brown_spots | wilting | pest_damage | fungal_suspected | unknown",
      "severity": "none | mild | moderate | severe",
      "confidence": 0.0,
      "observations": ["short note"],
      "recommendation": "short action"
    }
  ],
  "summary": {
    "dominantIssue": "string",
    "overallRisk": "low | medium | high"
  }
}

Important:
- Assess leaves individually, not the whole plant as one object.
- If leaf boundaries are unclear, mark confidence lower.
- Do not return markdown.
```

This can improve the output structure, but it still will not become true per-leaf detection unless you add localization.

## 16. Final Conclusion

The current app is working as a **single-image plant summarizer**, not a **leaf-by-leaf detector**.

The core reason is not just the prompt. The deeper reason is that the system has:

- no leaf detection stage
- no segmentation stage
- no per-leaf crop analysis stage
- no per-leaf UI or schema

If you want correct leaf condition per leaf, the right solution is:

1. detect each leaf
2. crop each leaf
3. analyze each crop
4. show structured per-leaf results in the UI

For your current project, the best next implementation step is:

- first add **manual leaf region analysis**
- then move to **automatic leaf detection via backend**

## 17. Professional Best Solution Implementation

This section explains how to implement the **actual best solution** you described:

1. **Localization with YOLO**
2. **Per-leaf classification**
3. **Backend-driven pipeline**

This is the right architecture for an FYP if you want a more professional and defensible system.

## 18. Target Architecture

### Final system flow

The production flow should be:

1. User captures/uploads plant image from Expo app.
2. Expo app uploads image to backend API.
3. Backend stores the image temporarily.
4. Backend runs a **leaf detection model** on the full image.
5. Backend gets bounding boxes for each leaf.
6. Backend crops each detected leaf.
7. Backend runs a **leaf condition classifier** on each crop.
8. Backend aggregates all leaf results.
9. Backend returns:
   - detected leaves
   - condition per leaf
   - overall plant summary
10. Expo app renders:
   - image overlays
   - per-leaf cards
   - summary

### Why this is the best solution

Because it separates two different tasks:

- **Where is the leaf?**
- **What is the condition of the leaf?**

This is better than asking one general-purpose model to do everything in one prompt.

## 19. Recommended Tech Stack

### Mobile frontend

- Expo React Native
- Image picker / camera
- Upload to backend via `multipart/form-data`

### Backend

Recommended backend stack:

- Python
- FastAPI
- Uvicorn
- OpenCV
- Ultralytics YOLO
- PyTorch

Reason:

- best ecosystem for CV/ML
- easier model integration
- easier image cropping and preprocessing

### Models

#### Model 1: Leaf localization

Use:

- YOLOv8 or YOLO11 detection model

Task:

- detect every visible leaf

Output:

- bounding boxes
- confidence

#### Model 2: Leaf condition classification

Use one of these:

- custom CNN classifier
- EfficientNet / MobileNet classifier
- ResNet classifier
- Gemini only as a temporary fallback

Task:

- classify each cropped leaf into condition classes

Example classes:

- healthy
- yellowing
- brown_spots
- fungal
- pest_damage
- wilted
- nutrient_deficiency
- unknown

## 20. Folder Structure For The New Solution

Recommended repo structure:

```txt
my-app/
  app/
  specs.md
  backend/
    app/
      main.py
      api/
        routes/
          analyze.py
      core/
        config.py
      services/
        detector.py
        classifier.py
        image_processing.py
        summarizer.py
      schemas/
        analysis.py
      models/
        leaf_detector.pt
        leaf_classifier.pt
      storage/
        uploads/
```

### Responsibility of each backend file

- `backend/app/main.py`
  - FastAPI app bootstrap
- `backend/app/api/routes/analyze.py`
  - API endpoints for image upload and analysis
- `backend/app/services/detector.py`
  - YOLO inference for leaf detection
- `backend/app/services/classifier.py`
  - leaf condition classifier inference
- `backend/app/services/image_processing.py`
  - crop extraction, resizing, normalization
- `backend/app/services/summarizer.py`
  - converts leaf-level output into plant summary
- `backend/app/schemas/analysis.py`
  - request/response models

## 21. Step 1: Implement Leaf Localization With YOLO

### Goal

Detect each visible leaf in the uploaded image.

### What to train YOLO on

You need a dataset where:

- each leaf is annotated separately
- each leaf has a bounding box

If your dataset is not ready, then:

1. collect plant images
2. annotate each visible leaf
3. export labels in YOLO format

### Annotation tools

Use one of:

- CVAT
- Roboflow
- LabelImg

### YOLO label format

For each image, labels look like:

```txt
0 0.512 0.433 0.214 0.381
0 0.731 0.402 0.192 0.344
```

Where:

- first number = class id (`leaf`)
- remaining values = normalized bbox

### Single-class detector

For localization, one class is enough:

- `leaf`

That means YOLO only needs to answer:

- is there a leaf here?

### Training command example

```bash
yolo detect train data=leaf_dataset.yaml model=yolov8n.pt epochs=100 imgsz=640
```

### Result

After training, you get a model like:

- `leaf_detector.pt`

This model will detect all leaf boxes in a new image.

## 22. Step 2: Crop Each Detected Leaf

After YOLO returns detections, backend should:

1. read the full image with OpenCV
2. loop through each bounding box
3. crop the leaf region
4. optionally add small padding
5. resize crop for classifier input
6. save or keep in memory

### Why cropping matters

Because the classifier should focus on one leaf only.

If you classify the full image, condition labels get mixed across multiple leaves.

### Recommended crop logic

- clip bbox inside image boundary
- reject tiny detections
- apply 5% to 10% padding
- resize to model input, for example `224 x 224`

## 23. Step 3: Classify Each Leaf Crop

### Goal

Each leaf crop should get its own condition label.

### Classifier input

Each cropped image goes into the classifier separately.

### Classifier output

Example:

```json
{
  "condition": "brown_spots",
  "severity": "moderate",
  "confidence": 0.91
}
```

### How to train classifier

You need leaf crop datasets grouped by class.

Example folder layout:

```txt
dataset/
  train/
    healthy/
    yellowing/
    brown_spots/
    pest_damage/
  val/
    healthy/
    yellowing/
    brown_spots/
    pest_damage/
```

### Training options

You can train using:

- PyTorch custom training
- TensorFlow / Keras
- Ultralytics classification mode

### Practical recommendation

For FYP, use:

- EfficientNet-B0 or MobileNetV3

Reason:

- simpler
- lighter
- good enough for mobile agriculture datasets

## 24. Step 4: Build Backend API

### Main endpoint

Create:

- `POST /api/analyze-plant`

### Input

- image file upload

### Output

- leaf detections
- leaf classifications
- plant summary

### Backend pipeline inside this endpoint

1. save uploaded image
2. run detector
3. extract leaf crops
4. run classifier for each crop
5. aggregate results
6. return JSON response

### Example response

```json
{
  "imageId": "img_001",
  "totalLeaves": 3,
  "detections": [
    {
      "leafId": "leaf_1",
      "bbox": { "x": 33, "y": 41, "width": 104, "height": 188 },
      "confidence": 0.96
    },
    {
      "leafId": "leaf_2",
      "bbox": { "x": 162, "y": 58, "width": 97, "height": 176 },
      "confidence": 0.92
    }
  ],
  "analyses": [
    {
      "leafId": "leaf_1",
      "condition": "healthy",
      "severity": "none",
      "confidence": 0.95,
      "observations": ["uniform green color"],
      "recommendation": "no urgent action"
    },
    {
      "leafId": "leaf_2",
      "condition": "yellowing",
      "severity": "moderate",
      "confidence": 0.87,
      "observations": ["yellow edges", "slight chlorosis"],
      "recommendation": "check nutrients and watering pattern"
    }
  ],
  "summary": {
    "healthyLeaves": 1,
    "affectedLeaves": 1,
    "dominantIssue": "yellowing",
    "overallRisk": "medium"
  }
}
```

## 25. Recommended Backend Logic

### `detector.py`

Responsibilities:

- load YOLO model once at startup
- run detection on image path
- filter low-confidence boxes
- return list of detections

Pseudo-flow:

```py
model = YOLO("models/leaf_detector.pt")

def detect_leaves(image_path: str):
    results = model(image_path)
    detections = []
    for box in results[0].boxes:
        detections.append(...)
    return detections
```

### `image_processing.py`

Responsibilities:

- load image
- crop bbox region
- add padding
- resize
- convert color format

### `classifier.py`

Responsibilities:

- load classifier model once
- preprocess crop
- predict class probabilities
- map class index to label
- derive severity if needed

### `summarizer.py`

Responsibilities:

- count healthy vs affected leaves
- identify dominant issue
- compute overall risk
- optionally generate care suggestions

## 26. Severity Logic

Classifier can output condition class, but severity may be derived in two ways:

### Option 1: Separate severity class

Classifier predicts:

- healthy
- yellowing_mild
- yellowing_moderate
- yellowing_severe

Pros:

- simple output

Cons:

- many classes

### Option 2: Rule-based severity

Predict condition first, then derive severity using:

- classifier confidence
- % affected area
- color damage estimate

This is often better for FYP explanation.

### Recommended FYP approach

Use:

- condition classifier
- simple rule-based severity

Example:

- damage area < 15% -> mild
- damage area 15% to 40% -> moderate
- damage area > 40% -> severe

## 27. Expo App Changes Needed

Your current Expo app must be changed from:

- local Gemini-only analysis

to:

- upload image to backend
- display returned structured analysis

### Frontend flow

1. user picks image
2. app previews image
3. app calls backend endpoint
4. backend returns detections and results
5. app renders overlays + leaf list

### UI components you need

- `ImageOverlay`
  - shows bounding boxes on image
- `LeafList`
  - shows one card per leaf
- `LeafDetailModal`
  - detailed condition and recommendation
- `SummaryCard`
  - overall plant risk

### State shape

Instead of storing one `analysisResult` string, store:

```ts
interface PlantAnalysisResponse {
  imageId: string;
  totalLeaves: number;
  detections: LeafDetection[];
  analyses: LeafAnalysis[];
  summary: {
    healthyLeaves: number;
    affectedLeaves: number;
    dominantIssue: string;
    overallRisk: 'low' | 'medium' | 'high';
  };
}
```

## 28. API Contract Between Expo And Backend

### Request

Use `multipart/form-data`

Fields:

- `image`

### Example frontend request flow

- create `FormData`
- append image URI/file
- `fetch('/api/analyze-plant', { method: 'POST', body: formData })`

### Important

Do not send base64 for large production images unless necessary.

Prefer file upload because:

- smaller overhead
- better backend compatibility
- easier image handling

## 29. Suggested Development Plan

### Phase 1: Backend prototype

Build first:

- FastAPI server
- dummy upload endpoint
- dummy JSON response

Goal:

- make Expo app talk to backend first

### Phase 2: Integrate YOLO detector

Add:

- model loading
- leaf detection
- bbox response

Goal:

- see boxes in frontend

### Phase 3: Add crop classifier

Add:

- crop extraction
- classifier inference
- per-leaf condition

Goal:

- full 2-step pipeline works

### Phase 4: Improve quality

Add:

- confidence threshold tuning
- NMS tuning
- tiny leaf filtering
- better UI overlays
- caching

### Phase 5: Evaluation for FYP

Measure:

- detector mAP
- classifier accuracy
- precision
- recall
- confusion matrix
- inference time per image

This is important because your FYP should not only show the app, it should also show measurable system performance.

## 30. Dataset Advice

For a strong FYP, dataset quality matters more than UI polish.

You need:

- images with multiple visible leaves
- different lighting conditions
- different angles
- healthy and diseased examples
- annotations for both localization and classification

### Best dataset strategy

Create two linked datasets:

#### Dataset A: Detection dataset

- full plant images
- leaf bounding boxes

#### Dataset B: Classification dataset

- leaf crops
- leaf condition label

This is much cleaner than forcing one dataset to do everything.

## 31. Deployment Recommendation

### For local development

- run Expo app locally
- run FastAPI backend locally
- use local IP for API calls

### For demo / FYP presentation

Deploy backend on:

- Render
- Railway
- Azure
- AWS EC2

If GPU is unavailable, use:

- small YOLO model
- optimized classifier

### Practical note

Heavy models on free hosting may be slow.

For demo stability, keep:

- smaller model size
- cached model loading
- limited image size

## 32. Risks And Practical Constraints

### Risk 1: Leaf overlap

If leaves overlap heavily, plain object detection may merge them.

Mitigation:

- later move to segmentation

### Risk 2: Weak dataset

If training data is weak, model quality will be weak.

Mitigation:

- improve annotations
- use augmentation
- collect real mobile images

### Risk 3: Small disease spots

Bounding-box crop classification may miss very tiny lesions.

Mitigation:

- higher input resolution
- segmentation in next version

### Risk 4: Latency

Two models on backend add response time.

Mitigation:

- resize input
- batch crop inference
- load models once at startup

## 33. Final Recommendation For Implementation

If you want to build this properly, do it in this order:

1. Create backend in Python FastAPI.
2. Add `POST /api/analyze-plant`.
3. Integrate YOLO leaf detector.
4. Crop each detected leaf with OpenCV.
5. Run classifier on each crop.
6. Aggregate all leaf results into one JSON response.
7. Update Expo app to upload image and render boxes/cards.
8. Measure detector and classifier performance for FYP reporting.

This is the professional and technically correct implementation path for your plant monitoring system.
