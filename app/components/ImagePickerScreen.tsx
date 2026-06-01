import { useClerk, useUser } from '@clerk/clerk-expo';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import * as ExpoLinking from 'expo-linking';
import * as Print from 'expo-print';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Linking,
  Modal,
  Platform,
  SafeAreaView,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import OpenAI from 'openai';
import Animated, { FadeInDown, FadeInUp, FadeOut, LinearTransition } from 'react-native-reanimated';
import { G, Svg, Polygon as SvgPolygon } from 'react-native-svg';

// Types for Chat
interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'bot';
}

interface PolygonPoint {
  x: number;
  y: number;
}

interface LeafSegment {
  contour: PolygonPoint[];
  bbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LeafDetection {
  leafId: string;
  bbox?: BoundingBox | null;
  segmentation: LeafSegment;
  confidence: number;
  cropPath: string;
}

interface LeafAnalysis {
  leafId: string;
  condition: string;
  severity: string;
  confidence: number;
  observations: string[];
  recommendation: string | null;
}

interface ParsedLeafReport {
  imageId: string;
  detections: LeafDetection[];
  analyses: LeafAnalysis[];
  summary: {
    totalLeaves: number;
    healthyLeaves: number;
    affectedLeaves: number;
    dominantIssue: string;
    overallRisk: string;
    note: string;
  };
}

interface BackendLeafResult {
  leafId?: string;
  polygon?: unknown;
  report?: {
    status?: string;
    diseaseName?: string;
    details?: string;
    remedy?: string;
  } | null;
}

interface PlantScanEntry {
  id: string;
  plantId: string;
  scannedAt: string;
  damageScore: number;
  recoveryScore: number;
  trend: 'better' | 'worse' | 'stable';
  issue: string;
}

const parseJsonText = (value: string) => {
  try {
    return JSON.parse(value);
  } catch {
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(value.slice(start, end + 1));
    }
    throw new Error('Invalid JSON');
  }
};

const getLeafMarkerColors = (condition: string, severity: string) => {
  const normalizedCondition = condition.toLowerCase();
  const normalizedSeverity = severity.toLowerCase();

  if (normalizedCondition.includes('healthy') || normalizedSeverity === 'none') {
    return {
      borderColor: '#10b981',
      fillColor: 'rgba(16, 185, 129, 0.20)',
      textColor: '#065f46',
      badgeColor: 'rgba(255,255,255,0.94)',
    };
  }

  if (
    normalizedSeverity === 'severe' ||
    normalizedCondition.includes('fungal') ||
    normalizedCondition.includes('brown')
  ) {
    return {
      borderColor: '#ef4444',
      fillColor: 'rgba(239, 68, 68, 0.20)',
      textColor: '#7f1d1d',
      badgeColor: 'rgba(255,255,255,0.94)',
    };
  }

  if (
    normalizedSeverity === 'moderate' ||
    normalizedCondition.includes('yellow') ||
    normalizedCondition.includes('pest')
  ) {
    return {
      borderColor: '#f59e0b',
      fillColor: 'rgba(245, 158, 11, 0.22)',
      textColor: '#78350f',
      badgeColor: 'rgba(255,255,255,0.94)',
    };
  }

  return {
    borderColor: '#3b82f6',
    fillColor: 'rgba(59, 130, 246, 0.18)',
    textColor: '#1e3a8a',
    badgeColor: 'rgba(255,255,255,0.94)',
  };
};

const getConfidenceValue = (confidence?: number | string | null) => {
  if (typeof confidence === 'number') return confidence;
  if (typeof confidence === 'string') {
    const parsed = Number.parseFloat(confidence);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const formatConfidence = (confidence?: number | string | null) => {
  const value = getConfidenceValue(confidence);
  if (value === null) return null;
  const normalized = value <= 1 ? value * 100 : value;
  return `${Math.round(normalized)}%`;
};

const SCORE_WEIGHTS: Record<string, number> = {
  healthy: 0,
  low: 30,
  mild: 30,
  medium: 60,
  moderate: 60,
  high: 90,
  severe: 90,
  unknown: 45,
};

const getSeverityWeight = (severity: string) => {
  const key = severity.toLowerCase().trim();
  return SCORE_WEIGHTS[key] ?? SCORE_WEIGHTS.unknown;
};

const formatScanDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

/**
 * Calculate the centroid (center point) of a polygon contour.
 */
const calculatePolygonCentroid = (contour: PolygonPoint[]): { x: number; y: number } => {
  if (!contour || contour.length === 0) {
    return { x: 0, y: 0 };
  }

  let sumX = 0;
  let sumY = 0;

  for (const point of contour) {
    sumX += point.x;
    sumY += point.y;
  }

  return {
    x: sumX / contour.length,
    y: sumY / contour.length,
  };
};

/**
 * Scale polygon coordinates from original image resolution to display dimensions.
 * 
 * @param contour - Array of polygon points in original image coordinates
 * @param originalImageSize - The original image dimensions { width, height }
 * @param displaySize - The displayed image dimensions { width, height }
 * @returns Scaled polygon points for display
 */
const scalePolygonToDisplay = (
  contour: PolygonPoint[],
  originalImageSize: { width: number; height: number },
  displaySize: { width: number; height: number }
): PolygonPoint[] => {
  if (!contour || contour.length === 0) {
    return [];
  }

  const scaleX = displaySize.width / originalImageSize.width;
  const scaleY = displaySize.height / originalImageSize.height;

  return contour.map((point) => ({
    x: point.x * scaleX,
    y: point.y * scaleY,
  }));
};

/**
 * Convert polygon points to SVG path data string.
 */
const polygonToSvgPath = (contour: PolygonPoint[]): string => {
  if (!contour || contour.length === 0) {
    return '';
  }

  const pathData = contour.map((point, index) => {
    if (index === 0) {
      return `M ${point.x} ${point.y}`;
    }
    return `L ${point.x} ${point.y}`;
  });

  // Close the path
  pathData.push('Z');

  return pathData.join(' ');
};

/**
 * Convert image URI to base64 string
 */
const imageUriToBase64 = async (uri: string): Promise<string> => {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    const blob = await response.blob();

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  return await FileSystem.readAsStringAsync(uri, {
    encoding: 'base64' as any,
  });
};

type PlantIssue = {
  issue: string;
  severity: 'low' | 'medium' | 'high' | 'unknown' | string;
  evidence?: string;
  action?: string;
};

type PlantCarePlan = {
  watering?: string;
  light?: string;
  soil?: string;
  fertilizer?: string;
  pestControl?: string;
};

type ParsedPlantReport = {
  plantTypeGuess: string;
  healthSummary?: string;
  overallHealth: 'healthy' | 'mild_issue' | 'moderate_issue' | 'severe_issue' | 'unknown' | string;
  confidence: number;
  issues: PlantIssue[];
  carePlan: PlantCarePlan;
};

// ---------------------------------------------------------------------------
// OpenAI Client — fully .env driven
// ---------------------------------------------------------------------------
const aiClient = new OpenAI({
  apiKey: process.env.EXPO_PUBLIC_AI_API_KEY ?? '',
  baseURL: process.env.EXPO_PUBLIC_AI_BASE_URL ?? 'https://api.openai.com/v1',
  maxRetries: parseInt(process.env.EXPO_PUBLIC_AI_MAX_RETRIES ?? '3', 10),
  timeout: parseInt(process.env.EXPO_PUBLIC_AI_TIMEOUT_MS ?? '30000', 10),
  dangerouslyAllowBrowser: true,
});

const AI_MODEL = process.env.EXPO_PUBLIC_AI_MODEL ?? 'gpt-4.1';
const HISTORY_API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || 'http://127.0.0.1:8000';

const callAI = async ({
  systemPrompt,
  userText,
  imageBase64,
  maxTokens = 900,
  temperature = 0,
}: {
  systemPrompt?: string;
  userText: string;
  imageBase64?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> => {
  const userContent: OpenAI.ChatCompletionContentPart[] = [];

  if (imageBase64) {
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'high' },
    });
  }
  userContent.push({ type: 'text', text: userText });

  const messages: OpenAI.ChatCompletionMessageParam[] = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userContent });

  const response = await aiClient.chat.completions.create({
    model: AI_MODEL,
    max_tokens: maxTokens,
    temperature,
    messages,
  });

  const content = response.choices[0]?.message?.content?.trim() ?? '';
  if (!content) throw new Error('AI returned empty content.');
  return content;
};

export default function App() {
  const { user } = useUser();
  const { signOut } = useClerk();

  // --- EXISTING STATES ---
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [suggestionText, setSuggestionText] = useState<string | null>(null);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [hasRequestedSuggestions, setHasRequestedSuggestions] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isPlantValid, setIsPlantValid] = useState<boolean | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [imageOverlaySize, setImageOverlaySize] = useState({ width: 0, height: 0 });
  const [originalImageSize, setOriginalImageSize] = useState({ width: 0, height: 0 });
  const [plantIdInput, setPlantIdInput] = useState('My Plant');
  const [activePlantId, setActivePlantId] = useState('My Plant');
  const [scanHistory, setScanHistory] = useState<PlantScanEntry[]>([]);
  const [latestAlert, setLatestAlert] = useState<string | null>(null);
  const [lastTrackedSignature, setLastTrackedSignature] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  // --- NEW CHAT STATES ---
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { id: '1', text: 'Hey there! I am Dr. Leaf 🌿 — your personal plant doctor. I have had a look at your plant. What is on your mind?', sender: 'bot' }
  ]);
  const flatListRef = useRef<FlatList>(null);

  const parsedReport = (() => {
    if (!analysisResult) return null;
    try {
      const obj = parseJsonText(analysisResult);
      if (!obj || typeof obj !== 'object') return null;

      if (
        typeof (obj as any).overallHealth === 'string' ||
        typeof (obj as any).plantTypeGuess === 'string' ||
        Array.isArray((obj as any).issues)
      ) {
        const issues = Array.isArray((obj as any).issues)
          ? (obj as any).issues
            .filter((item: any) => item && typeof item === 'object')
            .map((item: any) => ({
              issue: typeof item.issue === 'string' ? item.issue.trim() : 'Unknown',
              severity: typeof item.severity === 'string' ? item.severity.trim() : 'unknown',
              evidence: typeof item.evidence === 'string' ? item.evidence.trim() : undefined,
              action: typeof item.action === 'string' ? item.action.trim() : undefined,
            }))
          : [];

        const carePlan =
          (obj as any).carePlan && typeof (obj as any).carePlan === 'object'
            ? {
              watering:
                typeof (obj as any).carePlan.watering === 'string'
                  ? (obj as any).carePlan.watering.trim()
                  : undefined,
              light:
                typeof (obj as any).carePlan.light === 'string'
                  ? (obj as any).carePlan.light.trim()
                  : undefined,
              soil:
                typeof (obj as any).carePlan.soil === 'string'
                  ? (obj as any).carePlan.soil.trim()
                  : undefined,
              fertilizer:
                typeof (obj as any).carePlan.fertilizer === 'string'
                  ? (obj as any).carePlan.fertilizer.trim()
                  : undefined,
              pestControl:
                typeof (obj as any).carePlan.pestControl === 'string'
                  ? (obj as any).carePlan.pestControl.trim()
                  : undefined,
            }
            : {};

        const confidenceRaw = (obj as any).confidence;
        const confidence =
          typeof confidenceRaw === 'number'
            ? confidenceRaw
            : typeof confidenceRaw === 'string'
              ? Number(confidenceRaw)
              : 0;

        return {
          plantTypeGuess:
            typeof (obj as any).plantTypeGuess === 'string' && (obj as any).plantTypeGuess.trim()
              ? (obj as any).plantTypeGuess.trim()
              : 'unknown',
          healthSummary:
            typeof (obj as any).healthSummary === 'string' ? (obj as any).healthSummary.trim() : undefined,
          overallHealth:
            typeof (obj as any).overallHealth === 'string' && (obj as any).overallHealth.trim()
              ? (obj as any).overallHealth.trim()
              : 'unknown',
          confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(confidence, 1)) : 0,
          issues,
          carePlan,
        } as ParsedPlantReport;
      }

      if (Array.isArray((obj as any).leaves)) {
        const leaves = ((obj as any).leaves as BackendLeafResult[])
          .filter((item) => item && typeof item === 'object')
          .map((item, index) => {
            const contour = Array.isArray(item.polygon)
              ? item.polygon
                .filter((point) => Array.isArray(point) && point.length >= 2)
                .map((point: any) => ({
                  x: typeof point?.[0] === 'number' ? point[0] : 0,
                  y: typeof point?.[1] === 'number' ? point[1] : 0,
                }))
              : [];

            const xs = contour.map((point) => point.x);
            const ys = contour.map((point) => point.y);
            const minX = xs.length ? Math.min(...xs) : 0;
            const maxX = xs.length ? Math.max(...xs) : 0;
            const minY = ys.length ? Math.min(...ys) : 0;
            const maxY = ys.length ? Math.max(...ys) : 0;

            const report = item.report || {};
            const status = typeof report.status === 'string' ? report.status.trim() : 'Unknown';
            const diseaseName =
              typeof report.diseaseName === 'string' ? report.diseaseName.trim() : 'Unknown';
            const details = typeof report.details === 'string' ? report.details.trim() : '';
            const remedy = typeof report.remedy === 'string' ? report.remedy.trim() : '';
            const isHealthy = status.toLowerCase() === 'healthy';
            const aiWarning =
              typeof (obj as any).aiWarning === 'string' ? (obj as any).aiWarning.trim() : '';

            return {
              detection: {
                leafId:
                  typeof item.leafId === 'string' && item.leafId.trim()
                    ? item.leafId.trim()
                    : `leaf_${index + 1}`,
                bbox: {
                  x: minX,
                  y: minY,
                  width: Math.max(maxX - minX, 0),
                  height: Math.max(maxY - minY, 0),
                },
                segmentation: {
                  contour,
                  bbox: null,
                },
                confidence: isHealthy ? 0.92 : 0.88,
                cropPath: '',
              },
              analysis: {
                leafId:
                  typeof item.leafId === 'string' && item.leafId.trim()
                    ? item.leafId.trim()
                    : `leaf_${index + 1}`,
                condition: diseaseName || (isHealthy ? 'Healthy' : 'Unknown'),
                severity: status || 'Unknown',
                confidence:
                  status.toLowerCase() === 'unknown'
                    ? 0.45
                    : isHealthy
                      ? 0.9
                      : 0.84,
                observations: [details, aiWarning].filter(Boolean),
                recommendation: remedy || null,
              },
            };
          });

        if (!leaves.length) return null;

        const healthyLeaves = leaves.filter(
          (item) => item.analysis.severity.toLowerCase() === 'healthy'
        ).length;
        const affectedLeaves = leaves.length - healthyLeaves;
        const issueCounts = new Map<string, number>();
        for (const leaf of leaves) {
          const key = leaf.analysis.condition || 'Unknown';
          issueCounts.set(key, (issueCounts.get(key) || 0) + 1);
        }
        const dominantIssue =
          [...issueCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';
        const aiWarning =
          typeof (obj as any).aiWarning === 'string' ? (obj as any).aiWarning.trim() : '';

        return {
          imageId: typeof (obj as any).imageId === 'string' ? (obj as any).imageId : 'unknown',
          detections: leaves.map((item) => item.detection),
          analyses: leaves.map((item) => item.analysis),
          summary: {
            totalLeaves: leaves.length,
            healthyLeaves,
            affectedLeaves,
            dominantIssue,
            overallRisk: affectedLeaves > 0 ? 'medium' : 'low',
            note: aiWarning || 'Leaf polygons and AI reports were generated from the backend batch pipeline.',
          },
        } as ParsedLeafReport;
      }

      const detections = Array.isArray((obj as any).detections)
        ? (obj as any).detections
          .filter((item: any) => item && typeof item === 'object')
          .map((item: any, index: number) => {
            // Parse segmentation data (new format)
            const segmentation = item.segmentation
              ? {
                contour: Array.isArray(item.segmentation.contour)
                  ? item.segmentation.contour.map((p: any) => ({
                    x: typeof p?.x === 'number' ? p.x : 0,
                    y: typeof p?.y === 'number' ? p.y : 0,
                  }))
                  : [],
                bbox: item.segmentation.bbox || null,
              }
              : {
                // Fallback: create segmentation from bbox (legacy format)
                contour: item.bbox
                  ? [
                    { x: item.bbox.x, y: item.bbox.y },
                    { x: item.bbox.x + item.bbox.width, y: item.bbox.y },
                    { x: item.bbox.x + item.bbox.width, y: item.bbox.y + item.bbox.height },
                    { x: item.bbox.x, y: item.bbox.y + item.bbox.height },
                  ]
                  : [],
                bbox: item.bbox || null,
              };

            return {
              leafId:
                typeof item.leafId === 'string' && item.leafId.trim()
                  ? item.leafId.trim()
                  : `leaf_${index + 1}`,
              bbox: {
                x: typeof item.bbox?.x === 'number' ? item.bbox.x : 0,
                y: typeof item.bbox?.y === 'number' ? item.bbox.y : 0,
                width: typeof item.bbox?.width === 'number' ? item.bbox.width : 0,
                height: typeof item.bbox?.height === 'number' ? item.bbox.height : 0,
              },
              segmentation,
              confidence: typeof item.confidence === 'number' ? item.confidence : 0,
              cropPath: typeof item.cropPath === 'string' ? item.cropPath : '',
            };
          })
        : [];
      const analyses = Array.isArray((obj as any).analyses)
        ? (obj as any).analyses
          .filter((item: any) => item && typeof item === 'object')
          .map((item: any, index: number) => ({
            leafId:
              typeof item.leafId === 'string' && item.leafId.trim()
                ? item.leafId.trim()
                : `leaf_${index + 1}`,
            condition:
              typeof item.condition === 'string' && item.condition.trim()
                ? item.condition.trim()
                : 'unknown',
            severity:
              typeof item.severity === 'string' && item.severity.trim()
                ? item.severity.trim()
                : 'unknown',
            confidence: typeof item.confidence === 'number' ? item.confidence : 0,
            observations: Array.isArray(item.observations)
              ? item.observations.map((value: unknown) => String(value).trim()).filter(Boolean)
              : [],
            recommendation:
              typeof item.recommendation === 'string' ? item.recommendation.trim() : null,
          }))
        : [];
      const summary =
        (obj as any).summary && typeof (obj as any).summary === 'object'
          ? {
            totalLeaves:
              typeof (obj as any).summary.totalLeaves === 'number'
                ? (obj as any).summary.totalLeaves
                : detections.length,
            healthyLeaves:
              typeof (obj as any).summary.healthyLeaves === 'number'
                ? (obj as any).summary.healthyLeaves
                : 0,
            affectedLeaves:
              typeof (obj as any).summary.affectedLeaves === 'number'
                ? (obj as any).summary.affectedLeaves
                : 0,
            dominantIssue:
              typeof (obj as any).summary.dominantIssue === 'string'
                ? (obj as any).summary.dominantIssue
                : 'unknown',
            overallRisk:
              typeof (obj as any).summary.overallRisk === 'string'
                ? (obj as any).summary.overallRisk
                : 'unknown',
            note:
              typeof (obj as any).summary.note === 'string'
                ? (obj as any).summary.note
                : '',
          }
          : null;
      if (!detections.length || !analyses.length || !summary) return null;
      return {
        imageId: typeof (obj as any).imageId === 'string' ? (obj as any).imageId : 'unknown',
        detections,
        analyses,
        summary,
      } as ParsedLeafReport;
    } catch {
      return null;
    }
  })();

  const formattedSuggestions = (() => {
    if (!suggestionText) return null;
    const raw = String(suggestionText).trim();
    if (!raw) return null;
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.replace(/^[-*•\d.\)\s]+/, '').trim())
      // strip any remaining ** markdown
      .map((l) => l.replace(/\*\*/g, ''))
      .filter(Boolean);
    return lines.length ? lines : [raw];
  })();

  // Renders "Label: rest of text" with label bold
  const renderSuggestionLine = (text: string, idx: number) => {
    const colonIdx = text.indexOf(':');
    if (colonIdx > 0 && colonIdx < 30) {
      const label = text.slice(0, colonIdx).trim();
      const body = text.slice(colonIdx + 1).trim();
      return (
        <View key={`s-${idx}`} style={styles.suggestionItem}>
          <View style={styles.suggestionDot} />
          <Text style={styles.suggestionText}>
            <Text style={styles.suggestionLabel}>{label}: </Text>
            {body}
          </Text>
        </View>
      );
    }
    return (
      <View key={`s-${idx}`} style={styles.suggestionItem}>
        <View style={styles.suggestionDot} />
        <Text style={styles.suggestionText}>{text}</Text>
      </View>
    );
  };

  const overallHealthDetail = (() => {
    if (!parsedReport || Array.isArray((parsedReport as any).detections)) return null;
    const report = parsedReport as ParsedPlantReport;
    // Use AI-generated detailed summary if available
    const aiSummary = typeof (report as any).healthSummary === 'string'
      ? (report as any).healthSummary.trim()
      : null;
    if (aiSummary) return aiSummary;
    // Fallback
    const healthMap: Record<string, string> = {
      healthy: 'The plant appears overall stable with no major visible stress signs.',
      mild_issue: 'Minor stress signs detected; early care adjustments are recommended.',
      moderate_issue: 'Multiple moderate stress signs present; routine care improvements needed.',
      severe_issue: 'Severe stress indicators detected. Immediate intervention recommended.',
      unknown: 'Model could not determine a clear health classification.',
    };
    const confidence = Math.round((report.confidence || 0) * 100);
    return `${healthMap[report.overallHealth] || `Health class: ${report.overallHealth}.`} Confidence ${confidence}%.`;
  })();

  const handleImageLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setImageOverlaySize({ width, height });
  };

  useEffect(() => {
    if (!selectedImage) {
      setOriginalImageSize({ width: 0, height: 0 });
      return;
    }

    Image.getSize(
      selectedImage,
      (width, height) => {
        if (width > 0 && height > 0) {
          setOriginalImageSize({ width, height });
        }
      },
      () => {
        // Final fallback: if intrinsic size is unavailable, use rendered frame size.
        if (imageOverlaySize.width > 0 && imageOverlaySize.height > 0) {
          setOriginalImageSize({
            width: imageOverlaySize.width,
            height: imageOverlaySize.height,
          });
        }
      }
    );
  }, [selectedImage, imageOverlaySize.width, imageOverlaySize.height]);

  const analyzedLeaves =
    parsedReport && Array.isArray((parsedReport as any).detections)
      ? ((parsedReport as ParsedLeafReport).detections || []).map((detection) => {
          const analysis =
            (parsedReport as ParsedLeafReport).analyses.find(
              (item) => item.leafId === detection.leafId
            ) || null;
          return {
            detection,
            analysis,
            combinedConfidence:
              analysis && typeof analysis.confidence === 'number'
                ? Math.min(detection.confidence, analysis.confidence)
                : detection.confidence,
          };
        })
      : [];

  const normalizedPlantId =
    activePlantId.trim() ||
    (parsedReport && !Array.isArray((parsedReport as any).detections)
      ? (parsedReport as ParsedPlantReport).plantTypeGuess
      : 'My Plant');

  const saveTrackerName = () => {
    const next = plantIdInput.trim();
    if (!next) {
      Alert.alert('Tracker Name Required', 'Please enter a plant tracker name first.');
      return;
    }
    setActivePlantId(next);
    setLatestAlert(null);
    Alert.alert('Saved', `Tracker name saved as "${next}".`);
  };

  const historyFilePath = `${FileSystem.documentDirectory}plant-scan-history-${user?.id || 'guest'}.json`;

  const calculateDamageScore = () => {
    if (analyzedLeaves.length > 0) {
      const total = analyzedLeaves.reduce((sum, leaf) => {
        const severity = leaf.analysis?.severity || 'unknown';
        return sum + getSeverityWeight(severity);
      }, 0);
      return Math.round(total / analyzedLeaves.length);
    }

    if (parsedReport && !Array.isArray((parsedReport as any).detections)) {
      const report = parsedReport as ParsedPlantReport;
      if (!report.issues.length && report.overallHealth === 'healthy') return 0;
      if (report.issues.length) {
        const total = report.issues.reduce((sum, issue) => sum + getSeverityWeight(issue.severity), 0);
        return Math.round(total / report.issues.length);
      }
      return getSeverityWeight(report.overallHealth);
    }

    return null;
  };

  useEffect(() => {
    const loadHistory = async () => {
      try {
        if (user?.id) {
          const response = await fetch(
            `${HISTORY_API_BASE_URL}/api/history/${encodeURIComponent(user.id)}/${encodeURIComponent(normalizedPlantId)}`
          );
          if (response.ok) {
            const serverHistory = (await response.json()) as PlantScanEntry[];
            if (Array.isArray(serverHistory) && serverHistory.length) {
              setScanHistory((prev) => {
                const map = new Map(prev.map((item) => [item.id, item]));
                for (const row of serverHistory) {
                  if (row && typeof row === 'object') {
                    map.set(String(row.id), row);
                  }
                }
                return [...map.values()];
              });
            }
          }
        }

        const fileInfo = await FileSystem.getInfoAsync(historyFilePath);
        if (!fileInfo.exists) return;
        const raw = await FileSystem.readAsStringAsync(historyFilePath);
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setScanHistory((prev) => {
            const map = new Map(prev.map((item) => [item.id, item]));
            for (const row of parsed) {
              if (row && typeof row === 'object') {
                map.set(String((row as any).id), row as PlantScanEntry);
              }
            }
            return [...map.values()];
          });
        }
      } catch {
        // Keep existing in-memory history if fetch/file read fails.
      }
    };
    loadHistory();
  }, [historyFilePath, user?.id, normalizedPlantId]);

  useEffect(() => {
    FileSystem.writeAsStringAsync(historyFilePath, JSON.stringify(scanHistory)).catch(() => {});
  }, [historyFilePath, scanHistory]);

  useEffect(() => {
    const damageScore = calculateDamageScore();
    if (!analysisResult || damageScore === null) return;

    const signature = `${normalizedPlantId}|${analysisResult}`;
    if (lastTrackedSignature === signature) return;

    setScanHistory((prev) => {
      const plantScans = prev.filter((item) => item.plantId === normalizedPlantId);
      const previous = plantScans[plantScans.length - 1];
      const baseline = plantScans[0]?.damageScore ?? damageScore;
      const diff = previous ? damageScore - previous.damageScore : 0;
      const trend: 'better' | 'worse' | 'stable' =
        Math.abs(diff) < 3 ? 'stable' : diff > 0 ? 'worse' : 'better';
      const recoveryScore = Math.max(0, Math.min(100, Math.round(50 + (baseline - damageScore))));
      const issue =
        parsedReport && Array.isArray((parsedReport as any).detections)
          ? (parsedReport as ParsedLeafReport).summary?.dominantIssue || 'Unknown'
          : parsedReport && !Array.isArray((parsedReport as any).detections)
            ? (parsedReport as ParsedPlantReport).issues?.[0]?.issue || 'General stress'
            : 'Unknown';

      const nextEntry: PlantScanEntry = {
        id: `${Date.now()}`,
        plantId: normalizedPlantId,
        scannedAt: new Date().toISOString(),
        damageScore,
        recoveryScore,
        trend,
        issue,
      };

      if (user?.id) {
        fetch(`${HISTORY_API_BASE_URL}/api/history/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.id,
            plantId: normalizedPlantId,
            damageScore,
            recoveryScore,
            trend,
            issue,
            scannedAt: nextEntry.scannedAt,
          }),
        }).catch(() => {});
      }

      if (previous && previous.damageScore > 0) {
        const pct = Math.round(((damageScore - previous.damageScore) / previous.damageScore) * 100);
        const since = formatScanDate(previous.scannedAt);
        if (pct >= 15) {
          const alertText = `Condition ${pct}% worse since ${since}`;
          setLatestAlert(alertText);
          Alert.alert('Plant Health Alert', alertText);
        } else if (pct <= -10) {
          const alertText = `Great: condition improved ${Math.abs(pct)}% since ${since}`;
          setLatestAlert(alertText);
        }
      }

      return [...prev, nextEntry];
    });
    setLastTrackedSignature(signature);
  }, [analysisResult, normalizedPlantId, lastTrackedSignature, parsedReport, analyzedLeaves, calculateDamageScore, user?.id]);

  // --- Gallery Se Image Lena ---
  const pickImage = async () => {
    const existing = await ImagePicker.getMediaLibraryPermissionsAsync();
    const finalPermission = existing.granted
      ? existing
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!finalPermission.granted) {
      if (finalPermission.canAskAgain === false) {
        Alert.alert(
          'Permission Denied',
          'Gallery permission is disabled. Please go to Settings and allow Photos/Media access.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
      } else {
        Alert.alert('Permission Denied', 'Gallery access is required to select a photo.');
      }
      return;
    }

    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
    });

    if (!result.canceled && result.assets?.length) {
      await processFile(result.assets[0].uri);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      setIsSidebarOpen(false);
      ExpoLinking.openURL(ExpoLinking.createURL('/'));
    } catch (e: any) {
      Alert.alert('Sign out failed', e?.message || 'Unable to sign out.');
    }
  };

  // --- Camera Se Photo Lena ---
  const takePhoto = async () => {
    const existing = await ImagePicker.getCameraPermissionsAsync();
    const finalPermission = existing.granted ? existing : await ImagePicker.requestCameraPermissionsAsync();

    if (!finalPermission.granted) {
      if (finalPermission.canAskAgain === false) {
        Alert.alert(
          'Permission Denied',
          'Camera permission is disabled. Please go to Settings and allow Camera access.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
      } else {
        Alert.alert('Permission Denied', 'Camera access is required to take a photo.');
      }
      return;
    }

    let result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 1,
    });

    if (!result.canceled && result.assets?.length) {
      await processFile(result.assets[0].uri);
    }
  };

  // --- Processing Simulation ---
  const processFile = async (uri: string) => {
    setSelectedImage(uri);
    setAnalysisResult(null);
    setAnalysisError(null);
    setSuggestionText(null);
    setHasRequestedSuggestions(false);
    setIsPlantValid(null);
    setIsChatOpen(false);
    setChatInput('');
    setChatMessages([
      {
        id: '1',
        text: 'Hey there! I am Dr. Leaf 🌿 — your personal plant doctor. I have had a look at your plant. What is on your mind?',
        sender: 'bot',
      },
    ]);

    try {
      setIsValidating(true);

      const base64 = await imageUriToBase64(uri);

      const text = await callAI({
        userText: 'You are a strict bio-filter. Return ONLY raw JSON (no markdown): {"isPlant": true/false, "reason": "short reason"}. Determine if the image contains a real plant/leaf as the main subject.',
        imageBase64: base64,
        maxTokens: 200,
      });

      let parsed: any = null;
      try {
        parsed = parseJsonText(String(text).trim());
      } catch {
        parsed = null;
      }

      const isPlant = Boolean(parsed?.isPlant);
      setIsPlantValid(isPlant);
      if (!isPlant) {
        setAnalysisError('Image must be a plant.');
      }
    } finally {
      setIsValidating(false);
    }
  };

  const removeImage = () => {
    setSelectedImage(null);
    setAnalysisResult(null);
    setAnalysisError(null);
    setSuggestionText(null);
    setHasRequestedSuggestions(false);
    setIsChatOpen(false);
    setChatInput('');
    setChatMessages([
      {
        id: '1',
        text: 'Hey there! I am Dr. Leaf 🌿 — your personal plant doctor. I have had a look at your plant. What is on your mind?',
        sender: 'bot',
      },
    ]);
  };

  const getSuggestions = async () => {
    if (!selectedImage) {
      Alert.alert('No Image', 'Please select a photo first.');
      return;
    }

    if (!analysisResult) {
      Alert.alert('No Report', 'Please run Analyze Leaf Conditions first.');
      return;
    }

    try {
      setHasRequestedSuggestions(true);
      setIsSuggesting(true);
      setSuggestionText(null);

      const base64 = await imageUriToBase64(selectedImage);

      const text = await callAI({
        systemPrompt: 'You are a plant emergency advisor. Give IMMEDIATE actionable steps — things the owner should do TODAY or THIS WEEK to improve the plant. Never use markdown, asterisks, or bold formatting. Plain text only.',
        userText:
          'Based on this plant image and the health report below, give IMMEDIATE action steps — things to do right now, not routine care (routine care is already in the care plan).\n\n' +
          'Rules:\n' +
          '- Each line starts with the action topic followed by a colon. Example: "Check roots: Gently remove from pot and inspect for root rot."\n' +
          '- Focus on: urgent problems, disease treatment, pest removal, environment fixes, rescue steps.\n' +
          '- Do NOT repeat routine care (watering schedule, fertilizer, soil type) — that is already shown.\n' +
          '- Max 7 steps. Plain text only. No asterisks, no markdown.\n\n' +
          'Plant Health Report:\n' + analysisResult,
        imageBase64: base64,
        maxTokens: 500,
        temperature: 0.3,
      });
      setSuggestionText(String(text).trim());
    } catch (e: any) {
      setSuggestionText(e?.message || 'Something went wrong while generating suggestions.');
    } finally {
      setIsSuggesting(false);
    }
  };

  const analyzePlantGrowth = async () => {
    if (!selectedImage) {
      Alert.alert('No Image', 'Please select a photo first.');
      return;
    }
    if (!plantIdInput.trim()) {
      Alert.alert('Tracker Name Required', 'Please enter and save a plant tracker name first.');
      return;
    }
    if (activePlantId.trim() !== plantIdInput.trim()) {
      setActivePlantId(plantIdInput.trim());
    }

    try {
      setIsAnalyzing(true);
      setAnalysisError(null);
      setAnalysisResult(null);
      setSuggestionText(null);
      setHasRequestedSuggestions(false);

      const base64 = await imageUriToBase64(selectedImage);

      const text = await callAI({
        systemPrompt: 'You are an expert botanist and plant pathologist. Analyze plant images with high accuracy. Return ONLY raw JSON — no markdown, no extra text, no code fences.',
        userText:
          'Carefully examine this plant image. Identify the species and provide a thorough health assessment.\n\n' +
          'Rules:\n' +
          '- "plantTypeGuess": common name (e.g. "Monstera Deliciosa", "Peace Lily", "Fiddle Leaf Fig"). NEVER return "unknown" — always make your best identification from leaf shape, color, texture, growth pattern.\n' +
          '- "healthSummary": 2-3 sentence detailed clinical description of what you visually observe — leaf color, texture, any spots/yellowing/wilting, stem condition, soil appearance. Be specific.\n' +
          '- "overallHealth": one of healthy|mild_issue|moderate_issue|severe_issue|unknown\n' +
          '- "confidence": 0.0 to 1.0\n' +
          '- "issues": observed problems with severity and specific evidence from the image\n' +
          '- "carePlan": specific ongoing care routines for THIS plant species (not generic advice)\n\n' +
          'Return ONLY this JSON:\n' +
          '{"plantTypeGuess":"string","healthSummary":"detailed 2-3 sentence observation","overallHealth":"healthy|mild_issue|moderate_issue|severe_issue|unknown","confidence":0.0,"issues":[{"issue":"string","severity":"low|medium|high","evidence":"specific visual evidence","action":"specific step"}],"carePlan":{"watering":"specific schedule","light":"specific requirement","soil":"soil type","fertilizer":"type and frequency","pestControl":"prevention or treatment"}}',
        imageBase64: base64,
        maxTokens: 900,
      });

      const normalized = String(text).trim();
      setAnalysisResult(normalized);
    } catch (e: any) {
      setAnalysisError(e?.message || 'Something went wrong while analyzing.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSendChat = async () => {
    if (!chatInput.trim()) return;

    if (!analysisResult) {
      return;
    }

    const userMsg: ChatMessage = { id: Date.now().toString(), text: chatInput, sender: 'user' };

    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const history = chatMessages
        .filter((m) => m.text.trim().length > 0)
        .slice(-10)
        .map((m) => ({
          role: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: m.text,
        }));

      const response = await aiClient.chat.completions.create({
        model: AI_MODEL,
        max_tokens: 700,
        temperature: 0.5,
        messages: [
          {
            role: 'system',
            content:
              `You are Dr. Leaf — a warm, knowledgeable plant doctor with 20 years of experience. You speak like a real doctor having a consultation with a patient about their plant.

Personality:
- Conversational and warm, not robotic
- Ask follow-up questions when needed ("How long has it been like this?", "Is it near a window?")
- Give detailed, thoughtful answers — not just bullet points
- Reference the plant by name (${parsedReport && !Array.isArray((parsedReport as any).detections) ? (parsedReport as ParsedPlantReport).plantTypeGuess : 'this plant'})
- If the user greets you, greet back naturally and ask how you can help their plant today
- Never dump a list of suggestions unless specifically asked — have a real conversation first

Rules:
- NEVER say "Based on the analysis" or "According to the report" — just talk naturally
- Do NOT repeat the care plan or suggestions unless the user asks
- If someone says "hi" or "hello", respond warmly and ask what's going on with their plant
- Keep responses 2-4 sentences unless a detailed answer is needed
- Use the plant context silently — don't mention you have a report

Plant context (use silently, do not quote):
${analysisResult}
${suggestionText ? '\nImmediate actions context:\n' + suggestionText : ''}`,
          },
          ...history,
          { role: 'user', content: chatInput },
        ],
      });

      const finalText =
        response.choices[0]?.message?.content?.trim() ||
        "I couldn't generate a reply. Try rephrasing your question.";

      const botMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: finalText,
        sender: 'bot',
      };
      setChatMessages(prev => [...prev, botMsg]);
    } catch (error) {
      const errMsg: ChatMessage = {
        id: Date.now().toString(),
        text: error instanceof Error ? error.message : "Network error. Please check internet.",
        sender: 'bot',
      };
      setChatMessages(prev => [...prev, errMsg]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const currentPlantScans = scanHistory.filter((item) => item.plantId === normalizedPlantId);
  const latestScan = currentPlantScans[currentPlantScans.length - 1] || null;
  const previousScan =
    currentPlantScans.length > 1 ? currentPlantScans[currentPlantScans.length - 2] : null;
  const historyRows = [...scanHistory].sort(
    (a, b) => new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime()
  );

  const exportPdfReport = async () => {
    if (!analysisResult) {
      Alert.alert('No Report', 'Please analyze a plant first.');
      return;
    }
    try {
      setIsExportingPdf(true);
      const safePlantName = normalizedPlantId || 'My Plant';
      const timelineRows = currentPlantScans
        .slice(-10)
        .map(
          (scan) => `
            <tr>
              <td>${new Date(scan.scannedAt).toLocaleString()}</td>
              <td>${scan.damageScore}</td>
              <td>${scan.recoveryScore}</td>
              <td>${scan.trend}</td>
              <td>${scan.issue}</td>
            </tr>
          `
        )
        .join('');

      const carePlan =
        parsedReport && !Array.isArray((parsedReport as any).detections)
          ? (parsedReport as ParsedPlantReport).carePlan
          : null;
      const plantCondition =
        parsedReport && !Array.isArray((parsedReport as any).detections)
          ? (parsedReport as ParsedPlantReport).overallHealth.replace(/_/g, ' ')
          : latestScan?.trend || 'stable';
      const healthDetails = overallHealthDetail || 'N/A';

      const html = `
        <html>
          <head>
            <meta charset="utf-8" />
            <style>
              body { font-family: Arial, sans-serif; padding: 20px; color: #0f172a; }
              h1 { margin: 0 0 6px 0; color: #1d4ed8; }
              h2 { margin: 18px 0 8px 0; color: #0f172a; }
              .meta { color: #334155; margin-bottom: 8px; }
              .card { border: 1px solid #cbd5e1; border-radius: 10px; padding: 12px; margin-top: 8px; }
              .row { margin: 4px 0; }
              .label { font-weight: bold; }
              table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
              th, td { border: 1px solid #cbd5e1; padding: 6px; text-align: left; vertical-align: top; }
              th { background: #e2e8f0; }
              .small { font-size: 11px; color: #475569; }
            </style>
          </head>
          <body>
            <h1>Plant Health Report</h1>
            <div class="meta">Generated: ${new Date().toLocaleString()}</div>
            <div class="meta">Tracker: ${safePlantName}</div>

            <h2>Condition Summary</h2>
            <div class="card">
              <div class="row"><span class="label">Current Condition:</span> ${plantCondition}</div>
              <div class="row"><span class="label">Health Details:</span> ${healthDetails}</div>
              <div class="row"><span class="label">Recovery Score:</span> ${latestScan?.recoveryScore ?? 'N/A'}</div>
            </div>

            <h2>Care Plan</h2>
            <div class="card">
              <div class="row"><span class="label">Watering:</span> ${carePlan?.watering || 'N/A'}</div>
              <div class="row"><span class="label">Light:</span> ${carePlan?.light || 'N/A'}</div>
              <div class="row"><span class="label">Soil:</span> ${carePlan?.soil || 'N/A'}</div>
              <div class="row"><span class="label">Fertilizer:</span> ${carePlan?.fertilizer || 'N/A'}</div>
              <div class="row"><span class="label">Pest Control:</span> ${carePlan?.pestControl || 'N/A'}</div>
            </div>

            <h2>Timeline</h2>
            <div class="card">
              <div class="small">Last ${Math.min(currentPlantScans.length, 10)} scans for this tracker</div>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Damage</th>
                    <th>Recovery</th>
                    <th>Trend</th>
                    <th>Issue</th>
                  </tr>
                </thead>
                <tbody>
                  ${
                    timelineRows ||
                    '<tr><td colspan="5">No timeline entries available yet.</td></tr>'
                  }
                </tbody>
              </table>
            </div>
          </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({
        html,
        base64: false,
      });

      await Share.share({
        title: 'Plant Health Report',
        message: Platform.OS === 'android' ? `Plant Health Report\n${uri}` : 'Plant Health Report',
        url: uri,
      });
    } catch (error: any) {
      Alert.alert('Export Failed', error?.message || 'Unable to export PDF report.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <LinearGradient
      colors={['#0b1020', '#16213a', '#1f3a5f']}
      style={styles.container}
    >
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeArea}>

        {/* Header */}
        <Animated.View
          style={styles.header}
          entering={FadeInDown.duration(350)}
          layout={LinearTransition}
        >
          <TouchableOpacity
            onPress={() => setIsSidebarOpen(true)}
            style={styles.headerIconButton}
            accessibilityLabel="Open menu"
          >
            <Ionicons name="menu" size={24} color="#e2e8f0" />
          </TouchableOpacity>

          <View>
            <View style={styles.titleRow}>
              <Ionicons name="leaf-outline" size={24} color="#5eead4" />
              <Text style={styles.title}>Plant Doctor</Text>
            </View>
            <Text style={styles.subtitle}>Disease Detection Scanner</Text>
          </View>

          <View style={styles.headerRight}>
            <Ionicons name="leaf-outline" size={24} color="#5eead4" />
          </View>
        </Animated.View>

        <Modal
          transparent
          visible={isSidebarOpen}
          animationType="slide"
          onRequestClose={() => setIsSidebarOpen(false)}
        >
          <View style={styles.sidebarOverlay}>
            <TouchableOpacity
              style={styles.sidebarBackdrop}
              onPress={() => setIsSidebarOpen(false)}
              activeOpacity={1}
            />
            <View style={styles.sidebar}>
              <View style={styles.sidebarHeader}>
                <Text style={styles.sidebarTitle}>Account</Text>
                <TouchableOpacity
                  onPress={() => setIsSidebarOpen(false)}
                  style={styles.headerIconButton}
                  accessibilityLabel="Close menu"
                >
                  <Ionicons name="close" size={24} color="#e2e8f0" />
                </TouchableOpacity>
              </View>

              <View style={styles.sidebarUserCard}>
                <Text style={styles.sidebarUserName}>
                  {user?.fullName || user?.username || 'User'}
                </Text>
                <Text style={styles.sidebarUserEmail}>
                  {user?.primaryEmailAddress?.emailAddress || 'No email'}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.sidebarSignOutButton}
                onPress={handleSignOut}
              >
                <Ionicons name="log-out-outline" size={20} color="white" />
                <Text style={styles.sidebarSignOutText}>Sign out</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <ScrollView contentContainerStyle={[styles.content, selectedImage && styles.contentImageMode]}>
          {!selectedImage && (
            <Animated.View
              style={styles.instructionContainer}
              entering={FadeInUp.duration(350).delay(100)}
              layout={LinearTransition}
            >
              <Text style={styles.instructionTitle}>Upload Plant Photo</Text>
              <Text style={styles.instructionText}>
                Upload a clear photo of your plant. The app will analyze the full image.
              </Text>
            </Animated.View>
          )}

          <View style={styles.plantIdCard}>
            <Text style={styles.plantIdLabel}>Plant Tracker Name</Text>
            <TextInput
              value={plantIdInput}
              onChangeText={setPlantIdInput}
              placeholder="e.g. Balcony Monstera"
              placeholderTextColor="#94a3b8"
              style={styles.plantIdInput}
            />
            <View style={styles.trackerActionsRow}>
              <Text style={styles.activeTrackerText}>Tracking: {normalizedPlantId}</Text>
              <TouchableOpacity style={styles.saveTrackerButton} onPress={saveTrackerName}>
                <Text style={styles.saveTrackerButtonText}>Save Tracker</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Image Preview Area */}
          <Animated.View
            style={styles.previewContainer}
            entering={FadeInUp.duration(350).delay(180)}
            layout={LinearTransition}
          >
            {isAnalyzing ? (
              <View style={styles.loadingState}>
                <Ionicons name="scan-outline" size={64} color="#38bdf8" />
                <Text style={styles.loadingText}>Analyzing Image...</Text>
              </View>
            ) : selectedImage ? (
              <Animated.View
                style={styles.imageWrapper}
                entering={FadeInUp.duration(250)}
                exiting={FadeOut.duration(150)}
                layout={LinearTransition}
              >
                <View style={styles.imageFrame} onLayout={handleImageLayout}>
                  <Image
                    source={{ uri: selectedImage }}
                    style={styles.image}
                    resizeMode="contain"
                    onLoad={(event) => {
                      const source = (event as any)?.nativeEvent?.source;
                      if (source?.width > 0 && source?.height > 0) {
                        setOriginalImageSize({
                          width: source.width,
                          height: source.height,
                        });
                      }
                    }}
                  />
                  {analyzedLeaves.length > 0 && imageOverlaySize.width > 0 && imageOverlaySize.height > 0 && originalImageSize.width > 0 && originalImageSize.height > 0 ? (
                    <Svg pointerEvents="none" style={styles.svgOverlayLayer} width={imageOverlaySize.width} height={imageOverlaySize.height}>
                      {analyzedLeaves.map(({ detection, analysis, combinedConfidence }) => {
                        const colors = getLeafMarkerColors(
                          analysis?.condition || 'unknown',
                          analysis?.severity || 'unknown'
                        );
                        const confidenceValue = getConfidenceValue(combinedConfidence);
                        const isLowConfidence = confidenceValue !== null && confidenceValue < 0.65;

                        // Get the contour from segmentation (in original image pixel coordinates)
                        const originalContour = detection.segmentation?.contour || [];

                        // Scale contour from original image size to display size
                        const displayContour = scalePolygonToDisplay(
                          originalContour,
                          originalImageSize,
                          imageOverlaySize
                        );

                        // Only render true polygon masks; rectangle fallback is intentionally disabled.
                        const hasValidContour = displayContour.length >= 3;
                        const pointsString = hasValidContour
                          ? displayContour.map(p => `${p.x},${p.y}`).join(' ')
                          : '';

                        if (!hasValidContour) return null;

                        // Calculate centroid for label positioning
                        const centroid = calculatePolygonCentroid(displayContour);

                        return (
                          <G key={`${detection.leafId}-marker`}>
                            <SvgPolygon
                              points={pointsString}
                              fill={colors.fillColor}
                              stroke={colors.borderColor}
                              strokeWidth={isLowConfidence ? 2 : 3}
                              strokeDasharray={isLowConfidence ? '5,5' : '0'}
                              opacity={isLowConfidence ? 0.72 : 1}
                            />
                            {/* Label badge with leaf number */}
                            <View
                              style={[
                                styles.svgLabelBadge,
                                {
                                  left: centroid.x - 15,
                                  top: centroid.y - 12,
                                  backgroundColor: colors.badgeColor,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.leafMarkerText,
                                  { color: colors.textColor },
                                ]}
                              >
                                {detection.leafId.replace('leaf_', '')}
                              </Text>
                            </View>
                            {isLowConfidence ? (
                              <View
                                style={[
                                  styles.svgLowConfidenceBadge,
                                  {
                                    left: centroid.x - 12,
                                    top: centroid.y + 10,
                                  },
                                ]}
                              >
                                <Text style={styles.lowConfidenceTextSmall}>Low</Text>
                              </View>
                            ) : null}
                          </G>
                        );
                      })}
                    </Svg>
                  ) : null}
                </View>

                <View style={styles.postImageContent}>
                {/* Action Row */}
                {!analysisResult ? (
                  <View style={styles.imageActionRow}>
                    <TouchableOpacity onPress={removeImage} style={styles.retakeButton}>
                      <Ionicons name="trash-outline" size={16} color="white" />
                      <Text style={styles.retakeText}>Retake</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.analyzeButton,
                        isAnalyzing || isValidating || isPlantValid === false ? { opacity: 0.55 } : { opacity: 1 }
                      ]}
                      onPress={analyzePlantGrowth}
                      disabled={isAnalyzing || isValidating || isPlantValid === false}
                    >
                      <Ionicons name="scan-outline" size={16} color="white" />
                      <Text style={styles.analyzeText}>Analyze Plant</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity onPress={removeImage} style={styles.retakeButtonCentered}>
                    <Ionicons name="trash-outline" size={16} color="white" />
                    <Text style={styles.retakeText}>Retake Photo</Text>
                  </TouchableOpacity>
                )}

                {isValidating ? (
                  <Text style={styles.validationText}>Validating image...</Text>
                ) : isPlantValid === false ? (
                  <Text style={styles.validationErrorText}>Image must be a plant.</Text>
                ) : null}

                {analysisError ? <Text style={styles.errorText}>{analysisError}</Text> : null}
                {analysisResult ? (
                  <Animated.View
                    style={styles.resultCard}
                    entering={FadeInUp.duration(300)}
                    exiting={FadeOut.duration(150)}
                    layout={LinearTransition}
                  >
                    <Text style={styles.resultTitle}>Plant Report</Text>
                    {parsedReport && !Array.isArray((parsedReport as any).detections) ? (
                      <View style={styles.resultBody}>
                        <View style={styles.resultRow}>
                          <Text style={styles.resultLabel}>Plant</Text>
                          <Text style={styles.resultValue}>
                            {(parsedReport as ParsedPlantReport).plantTypeGuess === 'unknown'
                              ? 'Unidentified Plant'
                              : (parsedReport as ParsedPlantReport).plantTypeGuess}
                          </Text>
                        </View>
                        <View style={styles.resultRow}>
                          <Text style={styles.resultLabel}>Overall Health</Text>
                          <Text style={styles.resultValue}>
                            {(parsedReport as ParsedPlantReport).overallHealth
                              .replace(/_/g, ' ')
                              .replace(/\b\w/g, (c) => c.toUpperCase())}
                          </Text>
                        </View>
                        {overallHealthDetail ? (
                          <View style={styles.resultRowColumn}>
                            <Text style={styles.resultLabel}>Health Details</Text>
                            <Text style={styles.metricsText}>{overallHealthDetail}</Text>
                          </View>
                        ) : null}
                        <View style={styles.resultRow}>
                          <Text style={styles.resultLabel}>Confidence</Text>
                          <Text style={styles.resultValue}>
                            {Math.round((parsedReport as ParsedPlantReport).confidence * 100)}%
                          </Text>
                        </View>

                        {(parsedReport as ParsedPlantReport).issues?.length ? (
                          <View style={styles.leafList}>
                            {(parsedReport as ParsedPlantReport).issues.map((item, idx) => (
                              <View key={`${idx}-${item.issue}`} style={styles.leafCard}>
                                <View style={styles.leafCardHeader}>
                                  <Text style={styles.leafCardTitle}>{item.issue}</Text>
                                  <Text style={styles.leafCardSeverity}>{item.severity}</Text>
                                </View>
                                {item.evidence ? (
                                  <View style={styles.resultRowColumn}>
                                    <Text style={styles.resultLabel}>Evidence</Text>
                                    <Text style={styles.metricsText}>{item.evidence}</Text>
                                  </View>
                                ) : null}
                                {item.action ? (
                                  <View style={styles.resultRowColumn}>
                                    <Text style={styles.resultLabel}>Action</Text>
                                    <Text style={styles.metricsText}>{item.action}</Text>
                                  </View>
                                ) : null}
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    ) : parsedReport ? (
                      <View style={styles.resultBody}>
                        {analyzedLeaves.length ? (
                          <View style={styles.leafList}>
                            {analyzedLeaves.map(({ detection, analysis, combinedConfidence }) => (
                              <View
                                key={detection.leafId}
                                style={[
                                  styles.leafCard,
                                  getConfidenceValue(combinedConfidence) !== null &&
                                    getConfidenceValue(combinedConfidence)! < 0.65
                                    ? styles.leafCardLowConfidence
                                    : null,
                                ]}
                              >
                                <View style={styles.leafCardHeader}>
                                  <Text style={styles.leafCardTitle}>{detection.leafId.replace('_', ' ').toUpperCase()}</Text>
                                  <Text style={styles.leafCardSeverity}>{analysis?.severity || 'unknown'}</Text>
                                </View>
                                <View style={styles.resultRow}>
                                  <Text style={styles.resultLabel}>Disease</Text>
                                  <Text style={styles.resultValue}>{analysis?.condition || 'unknown'}</Text>
                                </View>
                                {getConfidenceValue(combinedConfidence) !== null &&
                                  getConfidenceValue(combinedConfidence)! < 0.65 ? (
                                  <Text style={styles.lowConfidenceText}>
                                    Low confidence result: detection or crop analysis is uncertain.
                                  </Text>
                                ) : null}
                                {analysis?.observations?.length ? (
                                  <View style={styles.resultRowColumn}>
                                    <Text style={styles.resultLabel}>Observed</Text>
                                    <Text style={styles.metricsText}>{analysis.observations.join(', ')}</Text>
                                  </View>
                                ) : null}
                                {analysis?.recommendation ? (
                                  <View style={styles.resultRowColumn}>
                                    <Text style={styles.resultLabel}>Action</Text>
                                    <Text style={styles.metricsText}>{analysis.recommendation}</Text>
                                  </View>
                                ) : null}
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    ) : (
                      <Text style={styles.resultText}>{analysisResult}</Text>
                    )}

                    {parsedReport &&
                    !Array.isArray((parsedReport as any).detections) &&
                    (parsedReport as ParsedPlantReport).carePlan ? (
                      <View style={styles.leafCard}>
                        <Text style={styles.leafCardTitle}>Care Plan</Text>
                        {(parsedReport as ParsedPlantReport).carePlan.watering ? (
                          <View style={styles.resultRowColumn}>
                            <Text style={styles.resultLabel}>Watering</Text>
                            <Text style={styles.metricsText}>
                              {(parsedReport as ParsedPlantReport).carePlan.watering}
                            </Text>
                          </View>
                        ) : null}
                        {(parsedReport as ParsedPlantReport).carePlan.light ? (
                          <View style={styles.resultRowColumn}>
                            <Text style={styles.resultLabel}>Light</Text>
                            <Text style={styles.metricsText}>
                              {(parsedReport as ParsedPlantReport).carePlan.light}
                            </Text>
                          </View>
                        ) : null}
                        {(parsedReport as ParsedPlantReport).carePlan.soil ? (
                          <View style={styles.resultRowColumn}>
                            <Text style={styles.resultLabel}>Soil</Text>
                            <Text style={styles.metricsText}>
                              {(parsedReport as ParsedPlantReport).carePlan.soil}
                            </Text>
                          </View>
                        ) : null}
                        {(parsedReport as ParsedPlantReport).carePlan.fertilizer ? (
                          <View style={styles.resultRowColumn}>
                            <Text style={styles.resultLabel}>Fertilizer</Text>
                            <Text style={styles.metricsText}>
                              {(parsedReport as ParsedPlantReport).carePlan.fertilizer}
                            </Text>
                          </View>
                        ) : null}
                        {(parsedReport as ParsedPlantReport).carePlan.pestControl ? (
                          <View style={styles.resultRowColumn}>
                            <Text style={styles.resultLabel}>Pest Control</Text>
                            <Text style={styles.metricsText}>
                              {(parsedReport as ParsedPlantReport).carePlan.pestControl}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    ) : null}

                    {isSuggesting ? (
                      <Text style={styles.suggestionLoadingText}>Generating suggestions...</Text>
                    ) : suggestionText ? (
                      <Animated.View
                        style={styles.suggestionCard}
                        entering={FadeInUp.duration(250)}
                        exiting={FadeOut.duration(150)}
                        layout={LinearTransition}
                      >
                        <Text style={styles.suggestionTitle}>Suggestions</Text>
                        {formattedSuggestions ? (
                          <View style={styles.suggestionList}>
                            {formattedSuggestions.map((item, idx) => renderSuggestionLine(item, idx))}
                          </View>
                        ) : (
                          <Text style={styles.suggestionText}>{suggestionText?.replace(/\*\*/g, '')}</Text>
                        )}
                      </Animated.View>
                    ) : null}

                    <TouchableOpacity
                      style={[styles.exportPdfButton, isExportingPdf && styles.buttonDisabled]}
                      disabled={isExportingPdf}
                      onPress={exportPdfReport}
                    >
                      <Ionicons name="download-outline" size={16} color="#ffffff" />
                      <Text style={styles.exportPdfButtonText}>
                        {isExportingPdf ? 'Exporting PDF...' : 'Export PDF Report'}
                      </Text>
                    </TouchableOpacity>

                  </Animated.View>
                ) : null}
                </View>
              </Animated.View>
            ) : (
              <Animated.View
                entering={FadeInUp.duration(250)}
                exiting={FadeOut.duration(150)}
                layout={LinearTransition}
              >
                <TouchableOpacity onPress={pickImage} style={styles.placeholder}>
                  <View style={styles.iconCircle}>
                    <Ionicons name="leaf-outline" size={48} color="#0ea5e9" />
                  </View>
                  <Text style={styles.placeholderText}>Tap to select a plant photo</Text>
                </TouchableOpacity>
              </Animated.View>
            )}
          </Animated.View>

          <View style={styles.timelineCard}>
            <View style={styles.timelineHeader}>
              <Text style={styles.timelineTitle}>Leaf Timeline</Text>
              <View style={styles.timelineHeaderRight}>
                <Text style={styles.timelineMeta}>{currentPlantScans.length} scans</Text>
                <TouchableOpacity
                  style={styles.historyButton}
                  onPress={() => setIsHistoryOpen(true)}
                >
                  <Text style={styles.historyButtonText}>History</Text>
                </TouchableOpacity>
              </View>
            </View>
            {currentPlantScans.length ? (
              <>
                <Text style={styles.timelineSubtext}>
                  Trend: {latestScan?.trend || 'stable'} | Recovery Score:{' '}
                  {latestScan?.recoveryScore ?? '--'}
                </Text>
                {latestAlert ? <Text style={styles.alertText}>{latestAlert}</Text> : null}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.graphRow}>
                  {currentPlantScans.slice(-8).map((scan) => (
                    <View key={scan.id} style={styles.graphBarWrap}>
                      <View
                        style={[
                          styles.graphBar,
                          {
                            height: Math.max(10, scan.damageScore),
                            backgroundColor:
                              scan.trend === 'worse'
                                ? '#ef4444'
                                : scan.trend === 'better'
                                  ? '#22c55e'
                                  : '#f59e0b',
                          },
                        ]}
                      />
                      <Text style={styles.graphLabel}>
                        {new Date(scan.scannedAt).toLocaleDateString(undefined, {
                          month: 'numeric',
                          day: 'numeric',
                        })}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
                {latestScan && previousScan ? (
                  <Text style={styles.timelineSubtext}>
                    Damage Score: {previousScan.damageScore}{' -> '}{latestScan.damageScore}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text style={styles.timelineSubtext}>
                No history yet. First analysis ke baad graph yahin show hoga.
              </Text>
            )}
          </View>
        </ScrollView>

        {/* Bottom Actions */}
        <Animated.View
          style={styles.bottomBar}
          entering={FadeInUp.duration(350).delay(120)}
          layout={LinearTransition}
        >
          <View style={styles.buttonGrid}>

            {/* Gallery Button */}
            <TouchableOpacity onPress={pickImage} style={styles.galleryButton}>
              <Ionicons name="images-outline" size={28} color="#7dd3fc" />
              <Text style={styles.galleryButtonText}>Gallery</Text>
            </TouchableOpacity>

            {/* Camera Button */}
            <TouchableOpacity onPress={takePhoto} style={styles.cameraButton}>
              <Ionicons name="camera" size={28} color="white" />
              <Text style={styles.cameraButtonText}>Open Camera</Text>
            </TouchableOpacity>

          </View>

          {analysisResult ? null : null}
        </Animated.View>

        {analysisResult ? null : null}

        <Modal
          transparent
          visible={isHistoryOpen}
          animationType="slide"
          onRequestClose={() => setIsHistoryOpen(false)}
        >
          <View style={styles.historyOverlay}>
            <View style={styles.historySheet}>
              <View style={styles.historyHeader}>
                <Text style={styles.historyTitle}>Scan History (All Plants)</Text>
                <TouchableOpacity onPress={() => setIsHistoryOpen(false)} style={styles.historyCloseButton}>
                  <Ionicons name="close" size={20} color="#e2e8f0" />
                </TouchableOpacity>
              </View>
              {historyRows.length ? (
                <FlatList
                  data={historyRows}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <View style={styles.historyItem}>
                      <Text style={styles.historyDate}>
                        {new Date(item.scannedAt).toLocaleString()}
                      </Text>
                      <Text style={styles.historyPlant}>Plant: {item.plantId}</Text>
                      <Text style={styles.historyText}>
                        Damage: {item.damageScore} | Recovery: {item.recoveryScore} | Trend: {item.trend}
                      </Text>
                      <Text style={styles.historyIssue}>Issue: {item.issue}</Text>
                    </View>
                  )}
                />
              ) : (
                <Text style={styles.timelineSubtext}>No history yet.</Text>
              )}
            </View>
          </View>
        </Modal>

      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(125, 211, 252, 0.35)',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(125, 211, 252, 0.32)',
  },
  headerRight: {
    width: 40,
    alignItems: 'flex-end',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#f8fafc',
  },
  subtitle: {
    fontSize: 12,
    color: '#7dd3fc',
    marginTop: 2,
  },
  content: {
    padding: 16,
    flexGrow: 1,
  },
  contentImageMode: {
    padding: 16,
    flexGrow: 0,
  },
  instructionContainer: {
    marginBottom: 30,
    alignItems: 'center',
  },
  instructionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#065f46',
    marginBottom: 8,
  },
  instructionText: {
    color: '#cbd5e1',
    textAlign: 'center',
    fontSize: 14,
  },
  plantIdCard: {
    marginBottom: 14,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(125, 211, 252, 0.32)',
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  plantIdLabel: {
    color: '#cbd5e1',
    fontWeight: '700',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  plantIdInput: {
    borderWidth: 1,
    borderColor: 'rgba(125, 211, 252, 0.32)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f8fafc',
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    fontSize: 15,
  },
  trackerActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
    gap: 8,
  },
  activeTrackerText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  saveTrackerButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#2563eb',
  },
  saveTrackerButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  previewContainer: {
    alignItems: 'center',
  },
  loadingState: {
    marginTop: 40,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    color: '#047857',
    fontWeight: '500',
  },
  imageWrapper: {
    width: '100%',
    alignItems: 'center',
  },
  imageFrame: {
    width: '100%',
    height: 260,
    position: 'relative',
    backgroundColor: '#0b1a2e',
    borderRadius: 20,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: 20,
  },
  svgOverlayLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  svgLabelBadge: {
    position: 'absolute',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    minWidth: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  svgLowConfidenceBadge: {
    position: 'absolute',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fdba74',
    minWidth: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lowConfidenceTextSmall: {
    color: '#9a3412',
    fontWeight: '800',
    fontSize: 9,
  },
  leafMarkerText: {
    fontWeight: '800',
    fontSize: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  lowConfidenceMarker: {
    position: 'absolute',
    bottom: -10,
    backgroundColor: '#fff7ed',
    color: '#9a3412',
    fontWeight: '800',
    fontSize: 10,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#fdba74',
  },
  postImageContent: {
    width: '100%',
    paddingTop: 10,
    gap: 8,
  },
  imageActionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  retakeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ef4444',
    paddingVertical: 12,
    borderRadius: 14,
    gap: 6,
    elevation: 2,
  },
  retakeButtonCentered: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ef4444',
    paddingVertical: 10,
    paddingHorizontal: 28,
    borderRadius: 14,
    gap: 6,
    elevation: 2,
  },
  retakeText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 14,
  },
  analyzeButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundcolor: '#7dd3fc',
    paddingVertical: 12,
    borderRadius: 14,
    gap: 6,
    elevation: 2,
  },
  analyzeText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 14,
  },
  resultBody: {
    marginTop: 10,
    gap: 10,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  resultRowColumn: {
    gap: 8,
  },
  resultLabel: {
    color: '#065f46',
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 0.2,
    width: 90,
  },
  resultValue: {
    flex: 1,
    color: '#f8fafc',
    fontWeight: '600',
    textAlign: 'right',
  },
  metricsText: {
    color: '#f8fafc',
    fontWeight: '500',
    lineHeight: 20,
    fontFamily: 'monospace',
  },
  errorText: {
    color: '#b91c1c',
    marginTop: 12,
    textAlign: 'center',
  },
  validationText: {
    marginTop: 12,
    color: '#047857',
    fontWeight: '600',
    textAlign: 'center',
  },
  validationErrorText: {
    marginTop: 12,
    color: '#b91c1c',
    fontWeight: '700',
    textAlign: 'center',
  },
  resultCard: {
    width: '100%',
    marginTop: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(125, 211, 252, 0.32)',
  },
  resultTitle: {
    color: '#f8fafc',
    fontWeight: 'bold',
    marginBottom: 8,
    fontSize: 16,
  },
  resultText: {
    color: '#cbd5e1',
    lineHeight: 20,
  },
  leafList: {
    marginTop: 8,
    gap: 12,
  },
  leafCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(125, 211, 252, 0.32)',
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  leafCardLowConfidence: {
    borderColor: '#f59e0b',
    borderStyle: 'dashed',
    backgroundColor: '#fffaf0',
  },
  leafCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  leafCardTitle: {
    color: '#065f46',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.4,
  },
  leafCardSeverity: {
    color: '#047857',
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  lowConfidenceText: {
    color: '#92400e',
    fontWeight: '600',
    fontSize: 12,
  },
  placeholder: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 20,
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    borderWidth: 3,
    borderStyle: 'dashed',
    borderColor: '#38bdf8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    backgroundColor: 'white',
    padding: 24,
    borderRadius: 50,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  placeholderText: {
    color: '#7dd3fc',
    fontWeight: '500',
  },
  bottomBar: {
    padding: 24,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 10,
  },
  buttonGrid: {
    flexDirection: 'row',
    gap: 16,
  },
  galleryButton: {
    flex: 1,
    backgroundColor: '#0b1a2e',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#38bdf8',
    gap: 8,
  },
  galleryButtonText: {
    color: '#047857',
    fontWeight: 'bold',
    fontSize: 14,
  },
  cameraButton: {
    flex: 1,
    backgroundcolor: '#7dd3fc',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    gap: 8,
    shadowcolor: '#7dd3fc',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  cameraButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },
  suggestionButton: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: '#10233c',
    borderWidth: 1,
    borderColor: '#38bdf8',
  },
  suggestionButtonText: {
    color: '#f8fafc',
    fontWeight: '800',
    fontSize: 14,
  },
  suggestionLoadingText: {
    marginTop: 12,
    color: '#047857',
    fontWeight: '600',
    textAlign: 'center',
  },
  suggestionCard: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#d1fae5',
  },
  suggestionTitle: {
    color: '#065f46',
    fontWeight: '800',
    fontSize: 14,
    marginBottom: 6,
  },
  suggestionLabel: {
    color: '#065f46',
    fontWeight: '800',
    fontSize: 14,
  },
  suggestionText: {
    flex: 1,
    color: '#1a3d2b',
    lineHeight: 22,
    fontSize: 14,
  },
  suggestionList: {
    marginTop: 8,
    gap: 10,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  suggestionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#0ea5e9',
    marginTop: 6,
  },
  exportPdfButton: {
    marginTop: 12,
    backgroundColor: '#0f766e',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  exportPdfButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  timelineCard: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(125, 211, 252, 0.25)',
    paddingTop: 12,
    gap: 8,
  },
  timelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timelineHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timelineTitle: {
    color: '#e2e8f0',
    fontWeight: '800',
    fontSize: 15,
  },
  timelineMeta: {
    color: '#7dd3fc',
    fontWeight: '700',
    fontSize: 12,
  },
  timelineSubtext: {
    color: '#cbd5e1',
    fontSize: 13,
  },
  alertText: {
    color: '#fca5a5',
    fontWeight: '700',
    fontSize: 13,
  },
  graphRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    height: 120,
    marginTop: 6,
    paddingRight: 8,
  },
  graphBarWrap: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  graphBar: {
    width: 28,
    borderRadius: 8,
    minHeight: 10,
  },
  graphLabel: {
    color: '#94a3b8',
    fontSize: 10,
  },
  historyButton: {
    backgroundColor: '#1d4ed8',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  historyButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 11,
  },
  historyOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.75)',
    justifyContent: 'flex-end',
  },
  historySheet: {
    maxHeight: '75%',
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 14,
    borderTopWidth: 1,
    borderColor: 'rgba(125, 211, 252, 0.35)',
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  historyTitle: {
    color: '#e2e8f0',
    fontWeight: '800',
    fontSize: 15,
    flex: 1,
    paddingRight: 10,
  },
  historyCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(125, 211, 252, 0.35)',
  },
  historyItem: {
    borderWidth: 1,
    borderColor: 'rgba(125, 211, 252, 0.28)',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
  },
  historyDate: {
    color: '#7dd3fc',
    fontWeight: '700',
    marginBottom: 4,
  },
  historyText: {
    color: '#e2e8f0',
    fontSize: 13,
  },
  historyPlant: {
    color: '#86efac',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 3,
  },
  historyIssue: {
    color: '#cbd5e1',
    fontSize: 12,
    marginTop: 2,
  },
  sidebarOverlay: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebarBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sidebar: {
    width: 300,
    backgroundColor: 'rgba(15, 23, 42, 0.97)',
    padding: 18,
    borderLeftWidth: 1,
    borderLeftColor: '#d1fae5',
  },
  sidebarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sidebarTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#f8fafc',
  },
  sidebarUserCard: {
    backgroundColor: '#0b1a2e',
    borderWidth: 1,
    borderColor: '#38bdf8',
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
  },
  sidebarUserName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#f8fafc',
    marginBottom: 4,
  },
  sidebarUserEmail: {
    fontSize: 13,
    color: '#047857',
    fontWeight: '600',
  },
  sidebarSignOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#ef4444',
    paddingVertical: 14,
    borderRadius: 16,
  },
  sidebarSignOutText: {
    color: 'white',
    fontWeight: '900',
    fontSize: 14,
  },
  // --- NEW CHAT STYLES ---
  fab: {
    position: 'absolute',
    bottom: 200, // Above bottom bar
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundcolor: '#7dd3fc',
    alignItems: 'center',
    justifyContent: 'center',
    shadowcolor: '#7dd3fc',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  chatModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  chatContainer: {
    backgroundColor: '#f0fdfa',
    height: '80%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(125, 211, 252, 0.35)',
  },
  chatHeaderTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#f8fafc',
  },
  chatBubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 16,
    marginBottom: 10,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundcolor: '#7dd3fc',
    borderBottomRightRadius: 2,
  },
  botBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderBottomLeftRadius: 2,
    borderWidth: 1,
    borderColor: 'rgba(125, 211, 252, 0.32)',
  },
  chatText: {
    fontSize: 15,
    lineHeight: 22,
  },
  userChatText: {
    color: '#fff',
  },
  botChatText: {
    color: '#cbd5e1',
  },
  chatInputContainer: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#d1fae5',
    gap: 10,
  },
  chatInput: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    color: '#cbd5e1',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundcolor: '#7dd3fc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  typingText: {
    marginLeft: 20,
    marginBottom: 10,
    color: '#7dd3fc',
    fontStyle: 'italic',
    fontSize: 12,
  },
});




