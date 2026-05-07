import { useClerk, useUser } from '@clerk/clerk-expo';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import * as ExpoLinking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
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

// Types for Chat
interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'bot';
}

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
  const [isValidating, setIsValidating] = useState(false);
  const [isPlantValid, setIsPlantValid] = useState<boolean | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // --- NEW CHAT STATES ---
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { id: '1', text: 'Hello! I am your Plant Doctor Assistant. Ask me anything about plant health, watering, or pests!', sender: 'bot' }
  ]);
  const flatListRef = useRef<FlatList>(null);

  const parsedReport = (() => {
    if (!analysisResult) return null;
    try {
      const obj = JSON.parse(analysisResult);
      if (!obj || typeof obj !== 'object') return null;
      const stage = typeof (obj as any).stage === 'string' ? (obj as any).stage : null;
      const vitality = typeof (obj as any).vitality === 'string' ? (obj as any).vitality : null;
      const metrics = typeof (obj as any).metrics === 'string' ? (obj as any).metrics : null;
      if (!stage && !vitality && !metrics) return null;
      return { stage, vitality, metrics };
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
          'Gallery permission off hai. Settings me jaa kar Photos/Media permission allow karein.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
      } else {
        Alert.alert('Permission Denied', 'Gallery access chahiye photo select karne ke liye.');
      }
      return;
    }

    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1], // Square crop
      quality: 1,
    });

    if (!result.canceled) {
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
          'Camera permission off hai. Settings me jaa kar Camera permission allow karein.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
      } else {
        Alert.alert('Permission Denied', 'Camera access chahiye photo lene ke liye.');
      }
      return;
    }

    let result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });

    if (!result.canceled) {
      await processFile(result.assets[0].uri);
    }
  };

  // --- Processing Simulation ---
  const processFile = async (uri: string) => {
    setSelectedImage(uri);
    setAnalysisResult(null);
    setAnalysisError(null);
    setSuggestionText(null);
    setIsPlantValid(null);
    setIsChatOpen(false);
    setChatInput('');
    setChatMessages([
      {
        id: '1',
        text: 'Hello! I am your Plant Doctor Assistant. Ask me anything about plant health, watering, or pests!',
        sender: 'bot',
      },
    ]);

    const apiKey = "AIzaSyBv7CEqJKiG4Fvh2671VVXNXZqC74sSPh4";
    if (!apiKey) return;

    try {
      setIsValidating(true);

      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: 'base64',
      });

      const payload = {
        contents: [
          {
            role: 'user',
            parts: [
              {
                text:
                  'You are a strict bio-filter. Determine if the image contains a real plant/leaf as the main subject. Return ONLY raw JSON (no markdown, no extra text): {"isPlant": true/false, "reason": "short reason"}.',
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
      };

      const listRes = await fetch(
        `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
      );
      const listJson: any = await listRes.json();
      if (!listRes.ok) {
        setIsPlantValid(null);
        return;
      }

      const models: Array<{ name?: string; supportedGenerationMethods?: string[] }> =
        Array.isArray(listJson?.models) ? listJson.models : [];

      const supported = models
        .filter((m) => Array.isArray(m?.supportedGenerationMethods))
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => String(m?.name || ''))
        .filter(Boolean)
        .map((name) => name.replace(/^models\//, ''));

      if (supported.length === 0) {
        setIsPlantValid(null);
        return;
      }

      const preferred = [
        'gemini-2.5-flash',
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'gemini-2.5-pro',
      ];

      const selectedModel = preferred.find((m) => supported.includes(m)) || supported[0];

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/${selectedModel}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      const json: any = await res.json();
      const text =
        json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('\n') ||
        json?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!res.ok || !text) {
        setIsPlantValid(null);
        return;
      }

      let parsed: any = null;
      try {
        parsed = JSON.parse(String(text).trim());
      } catch {
        const s = String(text);
        const start = s.indexOf('{');
        const end = s.lastIndexOf('}');
        if (start >= 0 && end > start) {
          try {
            parsed = JSON.parse(s.slice(start, end + 1));
          } catch {
            parsed = null;
          }
        }
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
      Alert.alert('No Image', 'Pehle koi photo select karein.');
      return;
    }

    if (!analysisResult) {
      Alert.alert('No Report', 'Pehle Analyze Plant Growth run karein.');
      return;
    }

    const apiKey = "AIzaSyBv7CEqJKiG4Fvh2671VVXNXZqC74sSPh4";
    if (!apiKey) {
      Alert.alert(
        'Missing API Key',
        'EXPO_PUBLIC_GEMINI_API_KEY set nahi hai. .env me add karke app restart karein.'
      );
      return;
    }

    try {
      setIsSuggesting(true);
      setSuggestionText(null);

      const base64 = await FileSystem.readAsStringAsync(selectedImage, {
        encoding: 'base64',
      });

      const suggestionPrompt =
        'You are an agronomy assistant. Based on the provided plant image and the JSON growth/health report, give concise actionable suggestions in English.\n\nRules:\n- Use short bullet points (max 8).\n- Cover: disease/pest suspicion, immediate steps, watering, light, nutrition, and when to seek expert help.\n- Do not repeat the JSON.\n\nJSON Report:\n' +
        analysisResult;

      const payload = {
        contents: [
          {
            role: 'user',
            parts: [
              { text: suggestionPrompt },
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: base64,
                },
              },
            ],
          },
        ],
      };

      const listRes = await fetch(
        `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
      );
      const listJson: any = await listRes.json();
      if (!listRes.ok) {
        const msg = listJson?.error?.message || 'ListModels failed.';
        setSuggestionText(msg);
        return;
      }

      const models: Array<{ name?: string; supportedGenerationMethods?: string[] }> =
        Array.isArray(listJson?.models) ? listJson.models : [];

      const supported = models
        .filter((m) => Array.isArray(m?.supportedGenerationMethods))
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => String(m?.name || ''))
        .filter(Boolean)
        .map((name) => name.replace(/^models\//, ''));

      if (supported.length === 0) {
        setSuggestionText(
          'No Gemini model found for this API key that supports generateContent. Please enable the Generative Language API and ensure billing/permissions are set.'
        );
        return;
      }

      const preferred = [
        'gemini-2.5-flash',
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'gemini-2.5-pro',
      ];

      const selectedModel = preferred.find((m) => supported.includes(m)) || supported[0];

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/${selectedModel}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      const json: any = await res.json();
      const text =
        json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('\n') ||
        json?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!res.ok) {
        const msg = json?.error?.message || 'Gemini request failed.';
        setSuggestionText(msg);
        return;
      }

      if (!text) {
        setSuggestionText('No suggestion text received from Gemini.');
        return;
      }

      setSuggestionText(String(text).trim());
    } catch (e: any) {
      setSuggestionText(e?.message || 'Something went wrong while generating suggestions.');
    } finally {
      setIsSuggesting(false);
    }
  };

  const analyzePlantGrowth = async () => {
    if (!selectedImage) {
      Alert.alert('No Image', 'Pehle koi photo select karein.');
      return;
    }

    const apiKey = "AIzaSyBv7CEqJKiG4Fvh2671VVXNXZqC74sSPh4";
    if (!apiKey) {
      Alert.alert(
        'Missing API Key',
        'EXPO_PUBLIC_GEMINI_API_KEY set nahi hai. .env me add karke app restart karein.'
      );
      return;
    }

    try {
      setIsAnalyzing(true);
      setAnalysisError(null);
      setAnalysisResult(null);

      const base64 = await FileSystem.readAsStringAsync(selectedImage, {
        encoding: 'base64',
      });

      const payload = {
        contents: [
          {
            role: 'user',
            parts: [
              {
                text:
                  'Act strictly as an agronomy computer vision system. Analyze this plant image.\n\n1. If NOT a plant, return JSON:\n{ "stage": "Invalid Subject", "vitality": "0%", "metrics": "Object rejected by bio-filter." }\n\n2. If IT IS a plant, return JSON:\n{\n  "stage": "[Growth Stage: Seedling/Vegetative/Flowering/Fruiting]",\n  "vitality": "[Health Score: e.g. 95% Optimal]",\n  "metrics": "Leaf Area: [Normal/Low]\\nChlorophyll: [Estimate]\\nCondition: [Brief technical check]"\n}\n\nReturn ONLY raw JSON string. No Markdown.',
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
      };

      const listRes = await fetch(
        `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
      );

      const listJson: any = await listRes.json();

      if (!listRes.ok) {
        const msg = listJson?.error?.message || 'ListModels failed.';
        setAnalysisError(msg);
        return;
      }

      const models: Array<{ name?: string; supportedGenerationMethods?: string[] }> =
        Array.isArray(listJson?.models) ? listJson.models : [];

      const supported = models
        .filter((m) => Array.isArray(m?.supportedGenerationMethods))
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => String(m?.name || ''))
        .filter(Boolean)
        .map((name) => name.replace(/^models\//, ''));

      if (supported.length === 0) {
        setAnalysisError(
          'No Gemini model found for this API key that supports generateContent. Please enable the Generative Language API and ensure billing/permissions are set.'
        );
        return;
      }

      const preferred = [
        'gemini-2.5-flash',
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'gemini-2.5-pro',
      ];

      const selectedModel = preferred.find((m) => supported.includes(m)) || supported[0];

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/${selectedModel}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      const json: any = await res.json();

      const text =
        json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('\n') ||
        json?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!res.ok) {
        const msg = json?.error?.message || 'Gemini request failed.';
        setAnalysisError(msg);
        return;
      }

      if (!text) {
        setAnalysisError('No response text received from Gemini.');
        return;
      }

      setAnalysisResult(String(text).trim());
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

    const apiKey = "AIzaSyBv7CEqJKiG4Fvh2671VVXNXZqC74sSPh4"; // Reusing your key
    const userMsg: ChatMessage = { id: Date.now().toString(), text: chatInput, sender: 'user' };
    
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const systemPrompt =
        'You are a friendly expert botanist. Answer questions about plant health, farming tips, and growth stages briefly, clearly, and professionally. If the provided analysis report indicates disease or low vitality, give cautious and actionable advice. If unsure, ask 1 clarifying question.';

      const userPrompt =
        `Context: The user has analyzed a plant image. Here is the JSON report from the analysis:\n${analysisResult}\n\nUser question: ${chatInput}`;

      const extractGeminiText = (j: any) => {
        const parts = j?.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          return parts
            .map((p: any) => p?.text)
            .filter(Boolean)
            .join('\n')
            .trim();
        }
        const single = j?.candidates?.[0]?.content?.parts?.[0]?.text;
        return typeof single === 'string' ? single.trim() : '';
      };

      const historyContents = chatMessages
        .filter((m) => m.sender === 'user' || m.sender === 'bot')
        .filter((m) => m.text && m.text.trim().length > 0)
        .slice(-10)
        .map((m) => ({
          role: m.sender === 'user' ? 'user' : 'model',
          parts: [{ text: m.text }],
        }));

      const finalUserText = `${systemPrompt}\n\n${userPrompt}`;

      const payload = {
        contents: [
          ...historyContents,
          {
            role: 'user',
            parts: [{ text: finalUserText }],
          },
        ],
      };

      const listRes = await fetch(
        `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
      );
      const listJson: any = await listRes.json();

      const models: Array<{ name?: string; supportedGenerationMethods?: string[] }> =
        Array.isArray(listJson?.models) ? listJson.models : [];

      const supported = models
        .filter((m) => Array.isArray(m?.supportedGenerationMethods))
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => String(m?.name || ''))
        .filter(Boolean)
        .map((name) => name.replace(/^models\//, ''));

      if (supported.length === 0) {
        const msg = 'No Gemini model found for this API key that supports generateContent. Please enable the Generative Language API and ensure billing/permissions are set.';
        const botMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          text: msg,
          sender: 'bot',
        };
        setChatMessages((prev) => [...prev, botMsg]);
        return;
      }

      const preferred = [
        'gemini-2.5-flash',
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'gemini-2.5-pro',
      ];

      const selectedModel = preferred.find((m) => supported.includes(m)) || supported[0];

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/${selectedModel}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      const json: any = await res.json();

      if (!res.ok) {
        const msg =
          json?.error?.message ||
          json?.promptFeedback?.blockReason ||
          'Gemini request failed.';
        const botMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          text: String(msg),
          sender: 'bot',
        };
        setChatMessages((prev) => [...prev, botMsg]);
        return;
      }

      const botReply = extractGeminiText(json);
      const fallbackDetails =
        json?.promptFeedback?.blockReasonMessage ||
        json?.promptFeedback?.blockReason ||
        json?.candidates?.[0]?.finishReason;
      const finalText =
        botReply ||
        (fallbackDetails
          ? `I couldn't generate a reply (${String(fallbackDetails)}). Try rephrasing your question.`
          : "I couldn't generate a reply. Try rephrasing your question.");

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
              <MaterialCommunityIcons name="sprout" size={24} color="#059669" />
              <Text style={styles.title}>Plant Doctor</Text>
            </View>
            <Text style={styles.subtitle}>Disease Detection Scanner</Text>
          </View>

          <View style={styles.headerRight}>
            <MaterialCommunityIcons name="leaf" size={24} color="#6ee7b7" />
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

        <ScrollView contentContainerStyle={styles.content}>
          <Animated.View
            style={styles.instructionContainer}
            entering={FadeInUp.duration(350).delay(100)}
            layout={Layout.springify()}
          >
            <Text style={styles.instructionTitle}>Upload Leaf Photo</Text>
            <Text style={styles.instructionText}>
              Bimari pehchanne ke liye plant ke patte (leaf) ki saaf photo lein.
            </Text>
          </Animated.View>

          {/* Image Preview Area */}
          <Animated.View
            style={styles.previewContainer}
            entering={FadeInUp.duration(350).delay(180)}
            layout={Layout.springify()}
          >
            {isAnalyzing ? (
              <View style={styles.loadingState}>
                <MaterialCommunityIcons name="scan-helper" size={64} color="#10b981" />
                <Text style={styles.loadingText}>Analyzing Image...</Text>
              </View>
            ) : selectedImage ? (
              <Animated.View
                style={styles.imageWrapper}
                entering={FadeInUp.duration(250)}
                exiting={FadeOut.duration(150)}
                layout={Layout.springify()}
              >
                <Image source={{ uri: selectedImage }} style={styles.image} />
                
                {/* Overlay Button */}
                <TouchableOpacity onPress={removeImage} style={styles.retakeButton}>
                  <MaterialCommunityIcons name="trash-can-outline" size={20} color="white" />
                  <Text style={styles.retakeText}>Retake Photo</Text>
                </TouchableOpacity>

                {!analysisResult ? (
                  <TouchableOpacity
                    style={[styles.analyzeButton, isAnalyzing ? { opacity: 0.6 } : { opacity: 1 }]}
                    onPress={analyzePlantGrowth}
                    disabled={isAnalyzing || isValidating || isPlantValid !== true}
                  >
                    <MaterialCommunityIcons name="scan-helper" size={20} color="white" />
                    <Text style={styles.analyzeText}>Analyze Plant Growth</Text>
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
                    <Text style={styles.resultTitle}>Growth Report</Text>
                    {parsedReport ? (
                      <View style={styles.resultBody}>
                        {parsedReport.stage ? (
                          <View style={styles.resultRow}>
                            <Text style={styles.resultLabel}>Stage</Text>
                            <Text style={styles.resultValue}>{parsedReport.stage}</Text>
                          </View>
                        ) : null}

                        {parsedReport.vitality ? (
                          <View style={styles.resultRow}>
                            <Text style={styles.resultLabel}>Vitality</Text>
                            <Text style={styles.resultValue}>{parsedReport.vitality}</Text>
                          </View>
                        ) : null}

                        {parsedReport.metrics ? (
                          <View style={styles.resultRowColumn}>
                            <Text style={styles.resultLabel}>Metrics</Text>
                            <Text style={styles.metricsText}>{parsedReport.metrics}</Text>
                          </View>
                        ) : null}
                      </View>
                    ) : (
                      <Text style={styles.resultText}>{analysisResult}</Text>
                    )}

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
              </Animated.View>
            ) : (
              <Animated.View
                entering={FadeInUp.duration(250)}
                exiting={FadeOut.duration(150)}
                layout={Layout.springify()}
              >
                <TouchableOpacity onPress={pickImage} style={styles.placeholder}>
                  <View style={styles.iconCircle}>
                    <MaterialCommunityIcons name="leaf" size={48} color="#10b981" />
                  </View>
                  <Text style={styles.placeholderText}>Tap to select a leaf photo</Text>
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
              <MaterialCommunityIcons name="lightbulb-on-outline" size={22} color="#064e3b" />
              <Text style={styles.suggestionButtonText}>Suggestions</Text>
            </TouchableOpacity>
          ) : null}
        </Animated.View>

        {analysisResult ? (
          <>
            {/* 🟢 NEW: FLOATING CHAT BUTTON */}
            <TouchableOpacity style={styles.fab} onPress={() => setIsChatOpen(true)}>
              <MaterialCommunityIcons name="robot" size={28} color="#fff" />
            </TouchableOpacity>

            {/* 🟢 NEW: CHAT MODAL */}
            <Modal visible={isChatOpen} animationType="slide" transparent onRequestClose={() => setIsChatOpen(false)}>
              <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.chatModalOverlay}>
                <View style={styles.chatContainer}>
                    {/* Chat Header */}
                    <View style={styles.chatHeader}>
                        <View style={{flexDirection:'row', alignItems:'center', gap:10}}>
                            <MaterialCommunityIcons name="robot-happy" size={24} color="#064e3b" />
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
                        contentContainerStyle={{padding: 16}}
                        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
                        renderItem={({item}) => (
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
                            <MaterialCommunityIcons name="send" size={20} color="#fff" />
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
  },
  image: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 20,
    borderWidth: 4,
    borderColor: '#a7f3d0',
    marginBottom: 20,
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
