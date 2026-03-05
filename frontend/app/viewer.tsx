import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Platform,
  Animated,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  ChevronLeft,
  Move,
  ZoomIn,
  SunDim,
  Ruler,
  RotateCw,
  Contrast,
  RefreshCw,
  Info,
  X,
  Trash2,
} from 'lucide-react-native';
import { useTheme } from './_layout';
import { fileStore } from '@/src/store/fileStore';
import { getDicomViewerHtml } from '@/src/utils/dicomViewerHtml';

// Conditionally import WebView for native only
let NativeWebView: any = null;
if (Platform.OS !== 'web') {
  NativeWebView = require('react-native-webview').WebView;
}

type ToolId = 'pan' | 'zoom' | 'wl' | 'measure' | 'rotate' | 'invert' | 'reset';

interface DicomMetadata {
  patientName: string;
  studyDate: string;
  modality: string;
  rows: number;
  columns: number;
  pixelSpacing: string;
  windowCenter: number;
  windowWidth: number;
  frames: number;
  bitsAllocated: number;
}

const TOOLS: { id: ToolId; icon: any; label: string }[] = [
  { id: 'pan', icon: Move, label: 'Pan' },
  { id: 'zoom', icon: ZoomIn, label: 'Zoom' },
  { id: 'wl', icon: SunDim, label: 'W/L' },
  { id: 'measure', icon: Ruler, label: 'Measure' },
  { id: 'rotate', icon: RotateCw, label: 'Rotate' },
  { id: 'invert', icon: Contrast, label: 'Invert' },
  { id: 'reset', icon: RefreshCw, label: 'Reset' },
];

const WL_PRESETS = [
  { id: 'bone', label: 'Bone' },
  { id: 'soft', label: 'Soft Tissue' },
  { id: 'full', label: 'Full Range' },
];

export default function ViewerScreen() {
  const { isDark, colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ fileName?: string; demo?: string }>();
  const nativeWebViewRef = useRef<any>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const [activeTool, setActiveTool] = useState<ToolId>('pan');
  const [metadata, setMetadata] = useState<DicomMetadata | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [measureToast, setMeasureToast] = useState<string | null>(null);
  const [wlValues, setWlValues] = useState({ center: 0, width: 0 });
  const [isReady, setIsReady] = useState(false);

  const toastOpacity = useRef(new Animated.Value(0)).current;
  const isDemo = params.demo === 'true';
  const fileName = params.fileName || (isDemo ? 'Demo Image' : 'Unknown');
  const html = getDicomViewerHtml();

  useEffect(() => {
    if (!isDemo && !fileStore.getData()) {
      router.replace('/');
    }
  }, []);

  // Web platform: Listen for iframe messages
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          handleIncomingMessage(msg);
        } catch {}
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const sendCommand = useCallback((cmd: any) => {
    if (Platform.OS === 'web') {
      iframeRef.current?.contentWindow?.postMessage(JSON.stringify(cmd), '*');
    } else {
      nativeWebViewRef.current?.injectJavaScript(
        `window.handleCommand(${JSON.stringify(cmd)}); true;`
      );
    }
  }, []);

  const sendFileData = useCallback(() => {
    if (isDemo) {
      sendCommand({ type: 'loadDemo' });
    } else {
      const data = fileStore.getData();
      if (data) {
        if (Platform.OS === 'web') {
          iframeRef.current?.contentWindow?.postMessage(
            JSON.stringify({ type: 'loadDicom', base64: data }),
            '*'
          );
        } else {
          nativeWebViewRef.current?.injectJavaScript(
            `window.handleCommand({ type: 'loadDicom', base64: '${data}' }); true;`
          );
        }
      }
    }
  }, [isDemo, sendCommand]);

  const handleIncomingMessage = useCallback((msg: any) => {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'ready':
        setIsReady(true);
        break;
      case 'metadata':
        setMetadata(msg.data);
        setWlValues({ center: msg.data.windowCenter, width: msg.data.windowWidth });
        setErrorMsg(null);
        break;
      case 'error':
        setErrorMsg(msg.data.message);
        break;
      case 'measurement':
        showMeasureToastFn(msg.data.distance + ' ' + msg.data.unit);
        break;
      case 'wlUpdate':
        setWlValues({ center: msg.data.center, width: msg.data.width });
        break;
    }
  }, []);

  const handleNativeMessage = useCallback((event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      handleIncomingMessage(msg);
    } catch {}
  }, [handleIncomingMessage]);

  useEffect(() => {
    if (isReady) {
      setTimeout(() => sendFileData(), 200);
    }
  }, [isReady, sendFileData]);

  const showMeasureToastFn = (text: string) => {
    setMeasureToast(text);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(2500),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setMeasureToast(null));
  };

  const handleToolPress = (toolId: ToolId) => {
    if (toolId === 'rotate') {
      sendCommand({ type: 'rotate' });
    } else if (toolId === 'invert') {
      sendCommand({ type: 'invert' });
    } else if (toolId === 'reset') {
      sendCommand({ type: 'reset' });
      setActiveTool('pan');
    } else {
      setActiveTool(toolId);
      sendCommand({ type: 'setTool', tool: toolId });
    }
  };

  const handlePreset = (preset: string) => {
    sendCommand({ type: 'windowPreset', preset });
  };

  const formatDate = (d: string) => {
    if (!d || d === 'Unknown' || d.length < 8) return d;
    return d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
  };

  const onIframeLoad = useCallback(() => {
    // The iframe's HTML will send 'ready' message on init
  }, []);

  const s = getStyles(colors, isDark);

  return (
    <SafeAreaView style={[s.container, { backgroundColor: '#09090b' }]}>
      {/* Top Bar */}
      <View style={s.topBar}>
        <TouchableOpacity
          testID="back-btn"
          onPress={() => router.back()}
          style={s.topBtn}
          activeOpacity={0.7}
        >
          <ChevronLeft size={24} color="#fafafa" />
        </TouchableOpacity>
        <View style={s.topTitleWrap}>
          <Text style={s.topTitle} numberOfLines={1}>
            {fileName}
          </Text>
          {metadata && (
            <Text style={s.topSubtitle}>
              {metadata.modality} · {metadata.columns}×{metadata.rows}
            </Text>
          )}
        </View>
        <TouchableOpacity
          testID="info-toggle-btn"
          onPress={() => setShowInfo(!showInfo)}
          style={[s.topBtn, showInfo && { backgroundColor: 'rgba(6,182,212,0.15)' }]}
          activeOpacity={0.7}
        >
          {showInfo ? <X size={20} color="#06b6d4" /> : <Info size={20} color="#a1a1aa" />}
        </TouchableOpacity>
      </View>

      {/* Viewer Area */}
      <View style={s.webViewContainer}>
        {Platform.OS === 'web' ? (
          <iframe
            ref={(el: any) => { iframeRef.current = el; }}
            srcDoc={html}
            onLoad={onIframeLoad}
            data-testid="dicom-webview"
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              backgroundColor: '#09090b',
            }}
            sandbox="allow-scripts allow-same-origin"
          />
        ) : NativeWebView ? (
          <NativeWebView
            ref={nativeWebViewRef}
            testID="dicom-webview"
            source={{ html }}
            onMessage={handleNativeMessage}
            style={s.webView}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            originWhitelist={['*']}
            mixedContentMode="always"
            startInLoadingState={false}
            scalesPageToFit={false}
          />
        ) : (
          <View style={s.fallbackView}>
            <Text style={s.fallbackText}>WebView not available</Text>
          </View>
        )}
      </View>

      {/* Error Overlay */}
      {errorMsg && (
        <View style={s.errorOverlay}>
          <Text style={s.errorText}>{errorMsg}</Text>
          <TouchableOpacity
            testID="error-back-btn"
            onPress={() => router.back()}
            style={s.errorBtn}
          >
            <Text style={s.errorBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Info Panel */}
      {showInfo && metadata && (
        <View style={s.infoPanel}>
          <View style={s.infoPanelInner}>
            <Text style={s.infoTitle}>DICOM Info</Text>
            {[
              ['Patient', metadata.patientName],
              ['Date', formatDate(metadata.studyDate)],
              ['Modality', metadata.modality],
              ['Size', metadata.columns + ' × ' + metadata.rows + ' px'],
              ['Pixel Spacing', metadata.pixelSpacing],
              ['Window C/W', wlValues.center + ' / ' + wlValues.width],
              ['Frames', String(metadata.frames)],
              ['Bits', String(metadata.bitsAllocated)],
            ].map(([label, value]) => (
              <View key={label} style={s.infoRow}>
                <Text style={s.infoLabel}>{label}</Text>
                <Text style={s.infoValue} numberOfLines={1}>
                  {value}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Measurement Toast */}
      {measureToast && (
        <Animated.View style={[s.measureToast, { opacity: toastOpacity }]}>
          <Ruler size={16} color="#22d3ee" />
          <Text style={s.measureToastText}>{measureToast}</Text>
        </Animated.View>
      )}

      {/* W/L Presets */}
      {activeTool === 'wl' && (
        <View style={s.presetsRow}>
          {WL_PRESETS.map((p) => (
            <TouchableOpacity
              key={p.id}
              testID={`preset-${p.id}-btn`}
              onPress={() => handlePreset(p.id)}
              style={s.presetBtn}
              activeOpacity={0.7}
            >
              <Text style={s.presetBtnText}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Measure info */}
      {activeTool === 'measure' && (
        <View style={s.presetsRow}>
          <TouchableOpacity
            testID="clear-measurements-btn"
            onPress={() => sendCommand({ type: 'clearMeasurements' })}
            style={[s.presetBtn, { flexDirection: 'row', gap: 6 }]}
            activeOpacity={0.7}
          >
            <Trash2 size={14} color="#22d3ee" />
            <Text style={s.presetBtnText}>Clear</Text>
          </TouchableOpacity>
          <View style={s.measureHint}>
            <Text style={s.measureHintText}>Tap two points to measure</Text>
          </View>
        </View>
      )}

      {/* Toolbar */}
      <View style={s.toolbar}>
        <View style={s.toolbarInner}>
          {TOOLS.map((tool) => {
            const isActive =
              tool.id === activeTool &&
              tool.id !== 'rotate' &&
              tool.id !== 'invert' &&
              tool.id !== 'reset';
            const IconComp = tool.icon;
            return (
              <TouchableOpacity
                key={tool.id}
                testID={`${tool.id}-tool-btn`}
                onPress={() => handleToolPress(tool.id)}
                style={[s.toolBtn, isActive && s.toolBtnActive]}
                activeOpacity={0.7}
              >
                <IconComp
                  size={20}
                  color={isActive ? '#06b6d4' : '#71717a'}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                <Text
                  style={[
                    s.toolLabel,
                    { color: isActive ? '#06b6d4' : '#52525b' },
                  ]}
                >
                  {tool.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}

const getStyles = (colors: any, isDark: boolean) =>
  StyleSheet.create({
    container: { flex: 1 },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      paddingVertical: 6,
      backgroundColor: 'rgba(9,9,11,0.92)',
      zIndex: 20,
      borderBottomWidth: 1,
      borderBottomColor: '#1a1a1e',
    },
    topBtn: {
      width: 44,
      height: 44,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    topTitleWrap: { flex: 1, marginHorizontal: 8 },
    topTitle: { color: '#fafafa', fontSize: 15, fontWeight: '600' },
    topSubtitle: { color: '#71717a', fontSize: 12, marginTop: 1 },
    webViewContainer: { flex: 1, backgroundColor: '#09090b' },
    webView: { flex: 1, backgroundColor: 'transparent' },
    fallbackView: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    fallbackText: { color: '#71717a', fontSize: 16 },
    errorOverlay: {
      position: 'absolute',
      top: 70,
      left: 20,
      right: 20,
      backgroundColor: 'rgba(239,68,68,0.12)',
      borderWidth: 1,
      borderColor: 'rgba(239,68,68,0.3)',
      borderRadius: 14,
      padding: 20,
      alignItems: 'center',
      zIndex: 30,
    },
    errorText: { color: '#fca5a5', fontSize: 14, textAlign: 'center', marginBottom: 14 },
    errorBtn: {
      backgroundColor: '#27272a',
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: 10,
    },
    errorBtnText: { color: '#fafafa', fontSize: 14, fontWeight: '600' },
    infoPanel: {
      position: 'absolute',
      top: 56,
      left: 8,
      right: 8,
      zIndex: 25,
    },
    infoPanelInner: {
      backgroundColor: 'rgba(24,24,27,0.95)',
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: '#27272a',
    },
    infoTitle: {
      color: '#06b6d4',
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.5,
      marginBottom: 12,
    },
    infoRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 5,
      borderBottomWidth: 1,
      borderBottomColor: 'rgba(39,39,42,0.5)',
    },
    infoLabel: { color: '#71717a', fontSize: 12, fontWeight: '500' },
    infoValue: { color: '#e4e4e7', fontSize: 12, fontWeight: '600', maxWidth: '60%' as any },
    measureToast: {
      position: 'absolute',
      top: 70,
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: 'rgba(9,9,11,0.9)',
      borderWidth: 1,
      borderColor: '#06b6d4',
      borderRadius: 24,
      paddingHorizontal: 18,
      paddingVertical: 10,
      zIndex: 30,
    },
    measureToastText: { color: '#22d3ee', fontSize: 16, fontWeight: '700' },
    presetsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 8,
      backgroundColor: 'rgba(9,9,11,0.92)',
    },
    presetBtn: {
      backgroundColor: '#18181b',
      borderWidth: 1,
      borderColor: '#27272a',
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
      alignItems: 'center',
    },
    presetBtnText: { color: '#22d3ee', fontSize: 12, fontWeight: '600' },
    measureHint: { flex: 1, alignItems: 'flex-end' },
    measureHintText: { color: '#52525b', fontSize: 11, fontStyle: 'italic' },
    toolbar: {
      backgroundColor: 'rgba(9,9,11,0.95)',
      borderTopWidth: 1,
      borderTopColor: '#1a1a1e',
      paddingBottom: Platform.OS === 'ios' ? 4 : 8,
      paddingTop: 6,
    },
    toolbarInner: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      alignItems: 'center',
      paddingHorizontal: 4,
    },
    toolBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 6,
      paddingHorizontal: 6,
      minWidth: 44,
      minHeight: 44,
      borderRadius: 10,
    },
    toolBtnActive: {
      backgroundColor: 'rgba(6,182,212,0.1)',
    },
    toolLabel: { fontSize: 9, fontWeight: '600', marginTop: 2 },
  });
