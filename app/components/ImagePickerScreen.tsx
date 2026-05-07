import { useClerk, useUser } from '@clerk/clerk-expo';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import * as ExpoLinking from 'expo-linking';
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
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import Animated, { FadeInDown, FadeInUp, FadeOut, Layout } from 'react-native-reanimated';
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
  overallHealth: 'healthy' | 'mild_issue' | 'moderate_issue' | 'severe_issue' | 'unknown' | string;
  confidence: number;
  issues: PlantIssue[];
  carePlan: PlantCarePlan;
};

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY?.trim();
const GEMINI_VISION_MODEL =
  process.env.EXPO_PUBLIC_GEMINI_VISION_MODEL?.trim() || 'gemini-2.5-flash';
const GEMINI_TEXT_MODEL =
  process.env.EXPO_PUBLIC_GEMINI_TEXT_MODEL?.trim() || 'gemini-2.5-flash';

const callGeminiGenerate = async ({
  contents,
  model,
  maxOutputTokens = 900,
}: {
  contents: any[];
  model: string;
  maxOutputTokens?: number;
}) => {
  if (!GEMINI_API_KEY) {
    throw new Error('EXPO_PUBLIC_GEMINI_API_KEY missing.');
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens,
      },
    }),
  });

  const json: any = await res.json();
  if (!res.ok) {
    const msg =
      json?.error?.message ||
      json?.message ||
      `Gemini request failed with status ${res.status}`;
    throw new Error(String(msg));
  }

  const content = Array.isArray(json?.candidates?.[0]?.content?.parts)
    ? json.candidates[0].content.parts
      .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
      .join('\n')
      .trim()
    : '';
  if (!content || typeof content !== 'string') {
    throw new Error('Gemini returned empty content.');
  }
  return content.trim();
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

  // --- NEW CHAT STATES ---
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { id: '1', text: 'Hello! I am your Plant  Assistant. Ask me anything about plant health, watering, or pests!', sender: 'bot' }
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
      .filter(Boolean);
    return lines.length ? lines : [raw];
  })();

  const overallHealthDetail = (() => {
    if (!parsedReport || Array.isArray((parsedReport as any).detections)) return null;
    const report = parsedReport as ParsedPlantReport;

    const healthMap: Record<string, string> = {
      healthy: 'The plant appears overall stable with no major visible stress signs.',
      mild_issue: 'Minor stress signs detected; early care adjustments are recommended.',
      moderate_issue: 'Multiple moderate stress signs present; routine care improvements needed.',
      severe_issue: 'Severe stress indicators detected. Immediate intervention recommended.',
      unknown: 'Model could not determine a clear health classification.',
    };

    const issues = (report.issues || [])
      .map((item) => `${item.issue} (${item.severity})`)
      .slice(0, 3);

    const confidence = Math.round((report.confidence || 0) * 100);
    const healthBase = healthMap[report.overallHealth] || `Health class: ${report.overallHealth}.`;
    const issuesText = issues.length ? ` Key findings: ${issues.join(', ')}.` : '';

    return `${healthBase} Confidence ${confidence}%.${issuesText}`;
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
        text: 'Hello! I am your Plant   Assistant. Ask me anything about plant health, watering, or pests!',
        sender: 'bot',
      },
    ]);

    if (!GEMINI_API_KEY) return;

    try {
      setIsValidating(true);

      // Web-compatible base64 conversion
      const base64 = await imageUriToBase64(uri);

      const text = await callGeminiGenerate({
        model: GEMINI_VISION_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text:
                  'You are a strict bio-filter. Return ONLY raw JSON (no markdown): {"isPlant": true/false, "reason": "short reason"}. Determine if the image contains a real plant/leaf as the main subject.',
              },
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: base64,
                },
              },
            ],
          },
        ],
        maxOutputTokens: 200,
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
        text: 'Hello! I am your Plant Doctor Assistant. Ask me anything about plant health, watering, or pests!',
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

    if (!GEMINI_API_KEY) {
      Alert.alert(
        'Missing API Key',
        'EXPO_PUBLIC_GEMINI_API_KEY is not set. Add it to your .env file and restart the app.'
      );
      return;
    }

    try {
      setHasRequestedSuggestions(true);
      setIsSuggesting(true);
      setSuggestionText(null);

      // Web-compatible base64 conversion
      const base64 = await imageUriToBase64(selectedImage);

      const suggestionPrompt =
        'You are an agronomy assistant. Based on the provided plant image and the JSON plant health report, give concise actionable suggestions in English.\n\nRules:\n- Use short bullet points (max 8).\n- Mention the most important issues first.\n- Cover immediate steps, watering, light, nutrition, and when to seek expert help.\n- Do not repeat the JSON.\n\nJSON Report:\n' +
        analysisResult;

      const text = await callGeminiGenerate({
        model: GEMINI_VISION_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text:
                  'You are an agronomy assistant. Be concise, practical, and safety-focused.\n\n' +
                  suggestionPrompt,
              },
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: base64,
                },
              },
            ],
          },
        ],
        maxOutputTokens: 500,
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

    try {
      setIsAnalyzing(true);
      setAnalysisError(null);
      setAnalysisResult(null);
      setSuggestionText(null);
      setHasRequestedSuggestions(false);

      const base64 = await imageUriToBase64(selectedImage);

      const text = await callGeminiGenerate({
        model: GEMINI_VISION_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text:
                  'You are an agronomy assistant. Analyze the entire plant image (not individual leaf crops). Return ONLY raw JSON (no markdown, no extra text) with this exact shape:\n' +
                  '{"plantTypeGuess":"string|unknown","overallHealth":"healthy|mild_issue|moderate_issue|severe_issue|unknown","confidence":0.0,"issues":[{"issue":"string","severity":"low|medium|high|unknown","evidence":"short","action":"short"}],"carePlan":{"watering":"short","light":"short","soil":"short","fertilizer":"short","pestControl":"short"}}',
              },
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: base64,
                },
              },
            ],
          },
        ],
        maxOutputTokens: 700,
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
      const systemPrompt =
        'You are a friendly expert botanist. Answer questions about plant health and care briefly, clearly, and professionally. If the provided analysis report indicates disease or stress, give cautious and actionable advice. If unsure, ask 1 clarifying question.';

      const userPrompt =
        `Context: The user has analyzed a plant image. Here is the JSON report from the analysis:\n${analysisResult}\n\nUser question: ${chatInput}`;

      const historyMessages = chatMessages
        .filter((m) => m.sender === 'user' || m.sender === 'bot')
        .filter((m) => m.text && m.text.trim().length > 0)
        .slice(-10)
        .map((m) => ({
          role: m.sender === 'user' ? 'user' : 'model',
          parts: [{ text: m.text }],
        }));

      const finalUserText = `${systemPrompt}\n\n${userPrompt}`;
      const botReply = await callGeminiGenerate({
        model: GEMINI_TEXT_MODEL,
        contents: [
          ...historyMessages,
          { role: 'user', parts: [{ text: finalUserText }] },
        ],
        maxOutputTokens: 700,
      });
      const finalText =
        botReply || "I couldn't generate a reply. Try rephrasing your question.";

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

  return (
    <LinearGradient
      colors={['#f0fdf4', '#ecfdf5', '#f0fdfa']} // Greenish gradient
      style={styles.container}
    >
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeArea}>

        {/* Header */}
        <Animated.View
          style={styles.header}
          entering={FadeInDown.duration(350)}
          layout={Layout.springify()}
        >
          <TouchableOpacity
            onPress={() => setIsSidebarOpen(true)}
            style={styles.headerIconButton}
            accessibilityLabel="Open menu"
          >
            <Ionicons name="menu" size={24} color="#064e3b" />
          </TouchableOpacity>

          <View>
            <View style={styles.titleRow}>
              <Ionicons name="leaf-outline" size={24} color="#059669" />
              <Text style={styles.title}>Plant Doctor</Text>
            </View>
            <Text style={styles.subtitle}>Disease Detection Scanner</Text>
          </View>

          <View style={styles.headerRight}>
            <Ionicons name="leaf-outline" size={24} color="#6ee7b7" />
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
                  <Ionicons name="close" size={24} color="#064e3b" />
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
              layout={Layout.springify()}
            >
              <Text style={styles.instructionTitle}>Upload Plant Photo</Text>
              <Text style={styles.instructionText}>
                Upload a clear photo of your plant. The app will analyze the full image.
              </Text>
            </Animated.View>
          )}

          {/* Image Preview Area */}
          <Animated.View
            style={styles.previewContainer}
            entering={FadeInUp.duration(350).delay(180)}
            layout={Layout.springify()}
          >
            {isAnalyzing ? (
              <View style={styles.loadingState}>
                <Ionicons name="scan-outline" size={64} color="#10b981" />
                <Text style={styles.loadingText}>Analyzing Image...</Text>
              </View>
            ) : selectedImage ? (
              <Animated.View
                style={styles.imageWrapper}
                entering={FadeInUp.duration(250)}
                exiting={FadeOut.duration(150)}
                layout={Layout.springify()}
              >
                <View style={styles.imageFrame} onLayout={handleImageLayout}>
                  <Image
                    source={{ uri: selectedImage }}
                    style={styles.image}
                    resizeMode="cover"
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
                {/* Overlay Button */}
                <TouchableOpacity onPress={removeImage} style={styles.retakeButton}>
                  <Ionicons name="trash-outline" size={20} color="white" />
                  <Text style={styles.retakeText}>Retake Photo</Text>
                </TouchableOpacity>

                {!analysisResult ? (
                  <TouchableOpacity
                    style={[
                      styles.analyzeButton,
                      isAnalyzing || isValidating || isPlantValid === false ? { opacity: 0.6 } : { opacity: 1 }
                    ]}
                    onPress={analyzePlantGrowth}
                    disabled={isAnalyzing || isValidating || isPlantValid === false}
                  >
                    <Ionicons name="scan-outline" size={20} color="white" />
                    <Text style={styles.analyzeText}>Analyze Plant</Text>
                  </TouchableOpacity>
                ) : null}

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
                    layout={Layout.springify()}
                  >
                    <Text style={styles.resultTitle}>Plant Report</Text>
                    {parsedReport && !Array.isArray((parsedReport as any).detections) ? (
                      <View style={styles.resultBody}>
                        <View style={styles.resultRow}>
                          <Text style={styles.resultLabel}>Plant</Text>
                          <Text style={styles.resultValue}>
                            {(parsedReport as ParsedPlantReport).plantTypeGuess}
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

                    {hasRequestedSuggestions &&
                    parsedReport &&
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
                        layout={Layout.springify()}
                      >
                        <Text style={styles.suggestionTitle}>Suggestions</Text>
                        {formattedSuggestions ? (
                          <View style={styles.suggestionList}>
                            {formattedSuggestions.map((item, idx) => (
                              <View key={`${idx}-${item}`} style={styles.suggestionItem}>
                                <View style={styles.suggestionDot} />
                                <Text style={styles.suggestionText}>{item}</Text>
                              </View>
                            ))}
                          </View>
                        ) : (
                          <Text style={styles.suggestionText}>{suggestionText}</Text>
                        )}
                      </Animated.View>
                    ) : null}
                  </Animated.View>
                ) : null}
                </View>
              </Animated.View>
            ) : (
              <Animated.View
                entering={FadeInUp.duration(250)}
                exiting={FadeOut.duration(150)}
                layout={Layout.springify()}
              >
                <TouchableOpacity onPress={pickImage} style={styles.placeholder}>
                  <View style={styles.iconCircle}>
                    <Ionicons name="leaf-outline" size={48} color="#10b981" />
                  </View>
                  <Text style={styles.placeholderText}>Tap to select a plant photo</Text>
                </TouchableOpacity>
              </Animated.View>
            )}
          </Animated.View>
        </ScrollView>

        {/* Bottom Actions */}
        <Animated.View
          style={styles.bottomBar}
          entering={FadeInUp.duration(350).delay(120)}
          layout={Layout.springify()}
        >
          <View style={styles.buttonGrid}>

            {/* Gallery Button */}
            <TouchableOpacity onPress={pickImage} style={styles.galleryButton}>
              <Ionicons name="images-outline" size={28} color="#047857" />
              <Text style={styles.galleryButtonText}>Gallery</Text>
            </TouchableOpacity>

            {/* Camera Button */}
            <TouchableOpacity onPress={takePhoto} style={styles.cameraButton}>
              <Ionicons name="camera" size={28} color="white" />
              <Text style={styles.cameraButtonText}>Open Camera</Text>
            </TouchableOpacity>

          </View>

          {analysisResult ? (
            <TouchableOpacity
              onPress={getSuggestions}
              style={[styles.suggestionButton, isSuggesting ? { opacity: 0.7 } : { opacity: 1 }]}
              disabled={isSuggesting}
            >
              <Ionicons name="bulb-outline" size={22} color="#064e3b" />
              <Text style={styles.suggestionButtonText}>Suggestions</Text>
            </TouchableOpacity>
          ) : null}
        </Animated.View>

        {analysisResult ? (
          <>
            {/* 🟢 NEW: FLOATING CHAT BUTTON */}
            <TouchableOpacity style={styles.fab} onPress={() => setIsChatOpen(true)}>
              <Ionicons name="sparkles-outline" size={28} color="#fff" />
            </TouchableOpacity>

            {/* 🟢 NEW: CHAT MODAL */}
            <Modal visible={isChatOpen} animationType="slide" transparent onRequestClose={() => setIsChatOpen(false)}>
              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.chatModalOverlay}>
                <View style={styles.chatContainer}>
                  {/* Chat Header */}
                  <View style={styles.chatHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Ionicons name="sparkles-outline" size={24} color="#064e3b" />
                      <Text style={styles.chatHeaderTitle}>AI Assistant</Text>
                    </View>
                    <TouchableOpacity onPress={() => setIsChatOpen(false)}>
                      <Ionicons name="close" size={24} color="#064e3b" />
                    </TouchableOpacity>
                  </View>

                  {/* Messages */}
                  <FlatList
                    ref={flatListRef}
                    data={chatMessages}
                    keyExtractor={item => item.id}
                    contentContainerStyle={{ padding: 16 }}
                    onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
                    renderItem={({ item }) => (
                      <View style={[styles.chatBubble, item.sender === 'user' ? styles.userBubble : styles.botBubble]}>
                        <Text style={[styles.chatText, item.sender === 'user' ? styles.userChatText : styles.botChatText]}>
                          {item.text}
                        </Text>
                      </View>
                    )}
                  />

                  {isChatLoading && <Text style={styles.typingText}>AI is typing...</Text>}

                  {/* Input */}
                  <View style={styles.chatInputContainer}>
                    <TextInput
                      style={styles.chatInput}
                      placeholder="Ask about plants..."
                      value={chatInput}
                      onChangeText={setChatInput}
                      placeholderTextColor="#9ca3af"
                    />
                    <TouchableOpacity onPress={handleSendChat} style={styles.sendButton}>
                      <Ionicons name="send" size={20} color="#fff" />
                    </TouchableOpacity>
                  </View>
                </View>
              </KeyboardAvoidingView>
            </Modal>
          </>
        ) : null}

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
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderBottomWidth: 1,
    borderBottomColor: '#d1fae5',
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
    backgroundColor: 'rgba(236, 253, 245, 0.9)',
    borderWidth: 1,
    borderColor: '#d1fae5',
  },
  headerRight: {
    width: 40,
    alignItems: 'flex-end',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#064e3b',
  },
  subtitle: {
    fontSize: 12,
    color: '#059669',
    marginTop: 2,
  },
  content: {
    padding: 24,
    flexGrow: 1,
  },
  contentImageMode: {
    padding: 0,
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
    color: '#4b5563',
    textAlign: 'center',
    fontSize: 14,
  },
  previewContainer: {
    alignItems: 'center',
    minHeight: 300,
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
    backgroundColor: '#000',
  },
  imageFrame: {
    width: '100%',
    position: 'relative',
    marginBottom: 0,
    backgroundColor: '#000',
  },
  image: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 0,
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
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 12,
  },
  retakeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ef4444',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginBottom: 16,
    gap: 8,
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  retakeText: {
    color: 'white',
    fontWeight: 'bold',
  },
  analyzeButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#059669',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
    opacity: 0.6, // Disabled look
  },
  analyzeText: {
    color: 'white',
    fontWeight: 'bold',
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
    color: '#064e3b',
    fontWeight: '600',
    textAlign: 'right',
  },
  metricsText: {
    color: '#064e3b',
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
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#d1fae5',
  },
  resultTitle: {
    color: '#064e3b',
    fontWeight: 'bold',
    marginBottom: 8,
    fontSize: 16,
  },
  resultText: {
    color: '#374151',
    lineHeight: 20,
  },
  leafList: {
    marginTop: 8,
    gap: 12,
  },
  leafCard: {
    backgroundColor: '#f7fffb',
    borderWidth: 1,
    borderColor: '#d1fae5',
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
    backgroundColor: 'rgba(236, 253, 245, 0.8)',
    borderWidth: 3,
    borderStyle: 'dashed',
    borderColor: '#6ee7b7',
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
    color: '#059669',
    fontWeight: '500',
  },
  bottomBar: {
    padding: 24,
    backgroundColor: 'rgba(255,255,255,0.9)',
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
    backgroundColor: '#f0fdf4',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    gap: 8,
  },
  galleryButtonText: {
    color: '#047857',
    fontWeight: 'bold',
    fontSize: 14,
  },
  cameraButton: {
    flex: 1,
    backgroundColor: '#059669',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    gap: 8,
    shadowColor: '#059669',
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
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  suggestionButtonText: {
    color: '#064e3b',
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
  suggestionText: {
    color: '#064e3b',
    lineHeight: 20,
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
    backgroundColor: '#10b981',
    marginTop: 6,
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
    backgroundColor: 'rgba(255,255,255,0.97)',
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
    color: '#064e3b',
  },
  sidebarUserCard: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
  },
  sidebarUserName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#064e3b',
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
    backgroundColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#059669',
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
    borderBottomColor: '#d1fae5',
  },
  chatHeaderTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#064e3b',
  },
  chatBubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 16,
    marginBottom: 10,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#059669',
    borderBottomRightRadius: 2,
  },
  botBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderBottomLeftRadius: 2,
    borderWidth: 1,
    borderColor: '#d1fae5',
  },
  chatText: {
    fontSize: 15,
    lineHeight: 22,
  },
  userChatText: {
    color: '#fff',
  },
  botChatText: {
    color: '#334155',
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
    color: '#334155',
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
  },
  typingText: {
    marginLeft: 20,
    marginBottom: 10,
    color: '#059669',
    fontStyle: 'italic',
    fontSize: 12,
  },
});

