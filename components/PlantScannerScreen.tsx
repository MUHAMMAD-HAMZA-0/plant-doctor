import React, { startTransition, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  LayoutChangeEvent,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import {
  Asset,
  ImageLibraryOptions,
  launchCamera,
  launchImageLibrary,
} from 'react-native-image-picker';

type LeafReport = {
  status: 'Healthy' | 'Infected' | 'Unknown' | string;
  diseaseName: string;
  details: string;
  remedy: string;
};

type LeafResult = {
  leafId: string;
  polygon: number[][];
  report: LeafReport;
};

type AnalyzeResponse = {
  success: boolean;
  imageWidth: number;
  imageHeight: number;
  leaves: LeafResult[];
};

type SelectedImage = {
  uri: string;
  fileName: string;
  type: string;
  width: number;
  height: number;
};

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || 'http://127.0.0.1:8000';

const PICKER_OPTIONS: ImageLibraryOptions = {
  mediaType: 'photo',
  selectionLimit: 1,
  quality: 1,
};

function normalizeAsset(asset?: Asset): SelectedImage | null {
  if (!asset?.uri) return null;
  return {
    uri: asset.uri,
    fileName: asset.fileName || `plant-${Date.now()}.jpg`,
    type: asset.type || 'image/jpeg',
    width: asset.width || 1,
    height: asset.height || 1,
  };
}

function getStatusPalette(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'healthy') {
    return {
      fill: 'rgba(34, 197, 94, 0.22)',
      stroke: '#15803d',
      chip: '#dcfce7',
      chipText: '#166534',
      cardBorder: '#86efac',
    };
  }
  return {
    fill: 'rgba(249, 115, 22, 0.22)',
    stroke: '#c2410c',
    chip: '#ffedd5',
    chipText: '#9a3412',
    cardBorder: '#fdba74',
  };
}

export default function PlantScannerScreen() {
  const [selectedImage, setSelectedImage] = useState<SelectedImage | null>(null);
  const [results, setResults] = useState<AnalyzeResponse | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [imageFrame, setImageFrame] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!selectedImage) {
      setResults(null);
      setErrorMessage(null);
      setImageFrame({ width: 0, height: 0 });
    }
  }, [selectedImage]);

  async function chooseImage(source: 'gallery' | 'camera') {
    const result =
      source === 'camera'
        ? await launchCamera(PICKER_OPTIONS)
        : await launchImageLibrary(PICKER_OPTIONS);

    if (result.didCancel) return;
    if (result.errorMessage) {
      Alert.alert('Image Picker Error', result.errorMessage);
      return;
    }

    const nextImage = normalizeAsset(result.assets?.[0]);
    if (!nextImage) {
      Alert.alert('Image Error', 'Selected image could not be loaded.');
      return;
    }

    startTransition(() => {
      setSelectedImage(nextImage);
      setResults(null);
      setErrorMessage(null);
    });
  }

  async function detectAndAnalyze() {
    if (!selectedImage) {
      Alert.alert('No image', 'Select or capture a plant image first.');
      return;
    }

    try {
      setIsUploading(true);
      setErrorMessage(null);

      const formData = new FormData();
      formData.append('image', {
        uri: selectedImage.uri,
        type: selectedImage.type,
        name: selectedImage.fileName,
      } as any);

      const response = await fetch(`${API_BASE_URL}/api/analyze-plant`, {
        method: 'POST',
        body: formData,
      });

      const payload = (await response.json()) as AnalyzeResponse | { detail?: string };
      if (!response.ok) {
        throw new Error(
          typeof (payload as { detail?: string }).detail === 'string'
            ? (payload as { detail?: string }).detail
            : 'Analysis failed.'
        );
      }

      startTransition(() => {
        setResults(payload as AnalyzeResponse);
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to analyze the selected image.';
      setErrorMessage(message);
    } finally {
      setIsUploading(false);
    }
  }

  function handleImageLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setImageFrame({ width, height });
  }

  function renderOverlay() {
    if (!selectedImage || !results || imageFrame.width <= 0 || imageFrame.height <= 0) {
      return null;
    }

    const scaleX = imageFrame.width / results.imageWidth;
    const scaleY = imageFrame.height / results.imageHeight;

    return (
      <Svg style={StyleSheet.absoluteFill} width={imageFrame.width} height={imageFrame.height}>
        {results.leaves.map((leaf) => {
          const palette = getStatusPalette(leaf.report.status);
          const points = leaf.polygon
            .map(([x, y]) => `${x * scaleX},${y * scaleY}`)
            .join(' ');

          return (
            <Polygon
              key={leaf.leafId}
              points={points}
              fill={palette.fill}
              stroke={palette.stroke}
              strokeWidth={2}
            />
          );
        })}
      </Svg>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Plant Disease Scanner</Text>
          <Text style={styles.title}>Mask every visible leaf, then classify in one backend pass.</Text>
          <Text style={styles.subtitle}>
            Mobile upload, backend segmentation, batch Gemini vision analysis, and per-leaf reports.
          </Text>
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => chooseImage('gallery')}>
            <Text style={styles.secondaryButtonText}>Pick From Gallery</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => chooseImage('camera')}>
            <Text style={styles.secondaryButtonText}>Open Camera</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.primaryButton, (!selectedImage || isUploading) && styles.buttonDisabled]}
          onPress={detectAndAnalyze}
          disabled={!selectedImage || isUploading}
        >
          <Text style={styles.primaryButtonText}>
            {isUploading ? 'Analyzing Leaves...' : 'Detect & Analyze'}
          </Text>
        </TouchableOpacity>

        {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

        <View style={styles.previewCard}>
          {selectedImage ? (
            <View
              style={[
                styles.imageStage,
                { aspectRatio: selectedImage.width / Math.max(selectedImage.height, 1) },
              ]}
              onLayout={handleImageLayout}
            >
              <Image source={{ uri: selectedImage.uri }} style={styles.image} resizeMode="contain" />
              {renderOverlay()}
              {isUploading ? (
                <View style={styles.loadingOverlay}>
                  <ActivityIndicator size="large" color="#ffffff" />
                  <Text style={styles.loadingText}>Backend is segmenting and classifying leaves</Text>
                </View>
              ) : null}
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No plant image selected</Text>
              <Text style={styles.emptyCopy}>
                Choose a clear leaf photo. The backend will detect polygons and return per-leaf reports.
              </Text>
            </View>
          )}
        </View>

        {results?.leaves?.length ? (
          <View style={styles.resultsSection}>
            <View style={styles.resultsHeader}>
              <Text style={styles.resultsTitle}>Leaf Reports</Text>
              <Text style={styles.resultsCount}>{results.leaves.length} leaves analyzed</Text>
            </View>
            {results.leaves.map((leaf, index) => {
              const palette = getStatusPalette(leaf.report.status);
              return (
                <View
                  key={leaf.leafId}
                  style={[styles.reportCard, { borderColor: palette.cardBorder }]}
                >
                  <View style={styles.reportTopRow}>
                    <Text style={styles.reportTitle}>Leaf {index + 1}</Text>
                    <View style={[styles.statusChip, { backgroundColor: palette.chip }]}>
                      <Text style={[styles.statusChipText, { color: palette.chipText }]}>
                        {leaf.report.status}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.reportLabel}>Disease</Text>
                  <Text style={styles.reportValue}>{leaf.report.diseaseName}</Text>

                  <Text style={styles.reportLabel}>Details</Text>
                  <Text style={styles.reportBody}>{leaf.report.details}</Text>

                  <Text style={styles.reportLabel}>Remedy</Text>
                  <Text style={styles.reportBody}>{leaf.report.remedy}</Text>
                </View>
              );
            })}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f5f8ee',
  },
  scrollContent: {
    padding: 18,
    paddingBottom: 42,
    gap: 18,
  },
  hero: {
    backgroundColor: '#123524',
    borderRadius: 28,
    padding: 22,
    gap: 10,
  },
  eyebrow: {
    color: '#b7f7d1',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  title: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 34,
  },
  subtitle: {
    color: '#d7f1df',
    fontSize: 14,
    lineHeight: 20,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  primaryButton: {
    backgroundColor: '#0f9f6e',
    paddingVertical: 16,
    borderRadius: 18,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderColor: '#d6e8d8',
    borderWidth: 1,
    paddingVertical: 15,
    borderRadius: 18,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#103b28',
    fontSize: 14,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  previewCard: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 14,
    borderWidth: 1,
    borderColor: '#dcead8',
    overflow: 'hidden',
  },
  imageStage: {
    position: 'relative',
    width: '100%',
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#dfe8d6',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(18, 53, 36, 0.58)',
    gap: 12,
    paddingHorizontal: 18,
  },
  loadingText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyState: {
    minHeight: 240,
    borderRadius: 18,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#c6d8c4',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 22,
    gap: 8,
    backgroundColor: '#f8fbf3',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#183729',
  },
  emptyCopy: {
    fontSize: 14,
    lineHeight: 20,
    color: '#587062',
    textAlign: 'center',
  },
  errorText: {
    color: '#b42318',
    fontSize: 14,
    fontWeight: '600',
  },
  resultsSection: {
    gap: 12,
  },
  resultsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  resultsTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#173427',
  },
  resultsCount: {
    fontSize: 13,
    color: '#5c7367',
    fontWeight: '700',
  },
  reportCard: {
    backgroundColor: '#fffef9',
    borderRadius: 22,
    borderWidth: 1.5,
    padding: 18,
    gap: 8,
  },
  reportTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  reportTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#173427',
  },
  statusChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  statusChipText: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  reportLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#6a7d70',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  reportValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1f3c2d',
  },
  reportBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#365242',
  },
});
