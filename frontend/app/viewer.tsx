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
  ChevronUp,
  ChevronDown,
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
  Layers,
} from 'lucide-react-native';
import { useTheme } from './_layout';
import { fileStore } from '@/src/store/fileStore';
import { getDicomViewerHtml } from '@/src/utils/dicomViewerHtml';

let NativeWebView: any = null;
if (Platform.OS !== 'web') {
  NativeWebView = require('react-native-webview').WebView;
}

type ToolId = 'pan' | 'zoom' | 'wl' | 'measure' | 'rotate' | 'invert' | 'reset' | 'scroll';

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
  currentFrame?: number;
}

const BASE_TOOLS: { id: ToolId; icon: any; label: string }[] = [
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
  const params = useLocalSearchParams<{ fileName?: string; demo?: string; mode?: string }>();
  const nativeWebViewRef = useRef<any>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const [activeTool, setActiveTool] = useState<ToolId>('pan');
  const [metadata, setMetadata] = useState<DicomMetadata | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [measureToast, setMeasureToast] = useState<string | null>(null);
  const [wlValues, setWlValues] = useState({ center: 0, width: 0 });
  const [isReady, setIsReady] = useState(false);
  const [seriesTotal, setSeriesTotal] = useState(0);
  const [seriesCurrent, setSeriesCurrent] = useState(0);

  const toastOpacity = useRef(new Animated.Value(0)).current;
  const isDemo = params.demo === 'true';
  const fileMode = params.mode || 'single';
  const fileName = params.fileName || (isDemo ? 'Demo Series' : 'Unknown');
  const html = getDicomViewerHtml();
  const isSeries = seriesTotal > 1;

  // Build tools list - add Scroll tool if series
  const tools = isSeries
    ? [{ id: 'scroll' as ToolId, icon: Layers, label: 'Scroll' }, ...BASE_TOOLS]
    : BASE_TOOLS;

  useEffect(() => {
    if (!isDemo && !fileStore.hasData()) {
      router.replace('/');
    }
  }, []);

  // Web: listen for iframe messages
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        try {
          handleIncomingMessage(JSON.parse(event.data));
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
      return;
    }

    const mode = fileStore.getMode();

    if (mode === 'zip') {
      const data = fileStore.getData();
      if (!data) return;
      if (Platform.OS === 'web') {
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ type: 'loadZip', base64: data }), '*'
        );
      } else {
        nativeWebViewRef.current?.injectJavaScript(
          `window.handleCommand({ type: 'loadZip', base64: '${data}' }); true;`
        );
      }
    } else if (mode === 'multi') {
      const files = fileStore.getMultiData();
      if (!files.length) return;
      if (Platform.OS === 'web') {
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ type: 'loadMultiDicom', files }), '*'
        );
      } else {
        nativeWebViewRef.current?.injectJavaScript(
          `window.handleCommand(${JSON.stringify({ type: 'loadMultiDicom', files })}); true;`
        );
      }
    } else {
      const data = fileStore.getData();
      if (!data) return;
      if (Platform.OS === 'web') {
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ type: 'loadDicom', base64: data }), '*'
        );
      } else {
        nativeWebViewRef.current?.injectJavaScript(
          `window.handleCommand({ type: 'loadDicom', base64: '${data}' }); true;`
        );
      }
    }
  }, [isDemo, sendCommand]);

  const handleIncomingMessage = useCallback((msg: any) => {
    if (!msg?.type) return;
    switch (msg.type) {
      case 'ready':
        setIsReady(true);
        break;
      case 'metadata':
        setMetadata(msg.data);
        setWlValues({ center: msg.data.windowCenter, width: msg.data.windowWidth });
        setErrorMsg(null);
        if (msg.data.currentFrame !== undefined) setSeriesCurrent(msg.data.currentFrame - 1);
        break;
      case 'seriesLoaded':
        setSeriesTotal(msg.data.count);
        setSeriesCurrent(0);
        break;
      case 'seriesInfo':
        setSeriesTotal(msg.data.total);
        setSeriesCurrent(msg.data.current);
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
      handleIncomingMessage(JSON.parse(event.nativeEvent.data));
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

  const goNextSlice = () => sendCommand({ type: 'nextSlice' });
  const goPrevSlice = () => sendCommand({ type: 'prevSlice' });

  const formatDate = (d: string) => {
    if (!d || d === 'Unknown' || d.length < 8) return d;
    return d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
  };

  const s = styles;

  return (
    <SafeAreaView style={s.container}>
      {/* Top Bar */}
      <View style={s.topBar}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={s.topBtn} activeOpacity={0.7}>
          <ChevronLeft size={24} color="#fafafa" />
        </TouchableOpacity>
        <View style={s.topTitleWrap}>
          <Text style={s.topTitle} numberOfLines={1}>{fileName}</Text>
          {metadata && (
            <Text style={s.topSubtitle}>
              {metadata.modality} · {metadata.columns}×{metadata.rows}
              {isSeries ? ' · ' + seriesTotal + ' slices' : ''}
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

      {/* Viewer */}
      <View style={s.webViewContainer}>
        {Platform.OS === 'web' ? (
          <iframe
            ref={(el: any) => { iframeRef.current = el; }}
            srcDoc={html}
            data-testid="dicom-webview"
            style={{ width: '100%', height: '100%', border: 'none', backgroundColor: '#09090b' }}
            sandbox="allow-scripts allow-same-origin"
          />
        ) : NativeWebView ? (
          <NativeWebView
            ref={nativeWebViewRef}
            testID="dicom-webview"
            source={{ html }}
            onMessage={handleNativeMessage}
            style={s.webView}
            javaScriptEnabled domStorageEnabled scrollEnabled={false}
            bounces={false} overScrollMode="never"
            showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}
            originWhitelist={['*']} mixedContentMode="always"
            startInLoadingState={false} scalesPageToFit={false}
          />
        ) : (
          <View style={s.fallbackView}><Text style={s.fallbackText}>WebView not available</Text></View>
        )}

        {/* Series navigation on right edge */}
        {isSeries && (
          <View style={s.seriesNav}>
            <TouchableOpacity
              testID="prev-slice-btn"
              onPress={goPrevSlice}
              style={[s.sliceNavBtn, seriesCurrent <= 0 && s.sliceNavBtnDisabled]}
              activeOpacity={0.7}
              disabled={seriesCurrent <= 0}
            >
              <ChevronUp size={20} color={seriesCurrent > 0 ? '#06b6d4' : '#3f3f46'} />
            </TouchableOpacity>
            <View style={s.sliceCounter}>
              <Text style={s.sliceCounterText}>{seriesCurrent + 1}</Text>
              <View style={s.sliceDivider} />
              <Text style={s.sliceCounterTotal}>{seriesTotal}</Text>
            </View>
            <TouchableOpacity
              testID="next-slice-btn"
              onPress={goNextSlice}
              style={[s.sliceNavBtn, seriesCurrent >= seriesTotal - 1 && s.sliceNavBtnDisabled]}
              activeOpacity={0.7}
              disabled={seriesCurrent >= seriesTotal - 1}
            >
              <ChevronDown size={20} color={seriesCurrent < seriesTotal - 1 ? '#06b6d4' : '#3f3f46'} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Error Overlay */}
      {errorMsg && (
        <View style={s.errorOverlay}>
          <Text style={s.errorText}>{errorMsg}</Text>
          <TouchableOpacity testID="error-back-btn" onPress={() => router.back()} style={s.errorBtn}>
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
              ...(isSeries ? [['Slice', (seriesCurrent + 1) + ' / ' + seriesTotal]] : []),
              ['Bits', String(metadata.bitsAllocated)],
            ].map(([label, value]) => (
              <View key={label} style={s.infoRow}>
                <Text style={s.infoLabel}>{label}</Text>
                <Text style={s.infoValue} numberOfLines={1}>{value}</Text>
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
            <TouchableOpacity key={p.id} testID={`preset-${p.id}-btn`} onPress={() => handlePreset(p.id)} style={s.presetBtn} activeOpacity={0.7}>
              <Text style={s.presetBtnText}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Measure hint */}
      {activeTool === 'measure' && (
        <View style={s.presetsRow}>
          <TouchableOpacity testID="clear-measurements-btn" onPress={() => sendCommand({ type: 'clearMeasurements' })} style={[s.presetBtn, { flexDirection: 'row', gap: 6 }]} activeOpacity={0.7}>
            <Trash2 size={14} color="#22d3ee" />
            <Text style={s.presetBtnText}>Clear</Text>
          </TouchableOpacity>
          <View style={s.measureHint}>
            <Text style={s.measureHintText}>Tap two points to measure</Text>
          </View>
        </View>
      )}

      {/* Scroll hint */}
      {activeTool === 'scroll' && isSeries && (
        <View style={s.presetsRow}>
          <View style={s.measureHint}>
            <Text style={s.measureHintText}>Drag up/down or use arrows to scroll through slices</Text>
          </View>
        </View>
      )}

      {/* Toolbar */}
      <View style={s.toolbar}>
        <View style={s.toolbarInner}>
          {tools.map((tool) => {
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
                <IconComp size={20} color={isActive ? '#06b6d4' : '#71717a'} strokeWidth={isActive ? 2.5 : 2} />
                <Text style={[s.toolLabel, { color: isActive ? '#06b6d4' : '#52525b' }]}>{tool.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090b' },
  topBar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6,
    backgroundColor: 'rgba(9,9,11,0.92)', zIndex: 20, borderBottomWidth: 1, borderBottomColor: '#1a1a1e',
  },
  topBtn: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  topTitleWrap: { flex: 1, marginHorizontal: 8 },
  topTitle: { color: '#fafafa', fontSize: 15, fontWeight: '600' },
  topSubtitle: { color: '#71717a', fontSize: 12, marginTop: 1 },
  webViewContainer: { flex: 1, backgroundColor: '#09090b' },
  webView: { flex: 1, backgroundColor: 'transparent' },
  fallbackView: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fallbackText: { color: '#71717a', fontSize: 16 },
  seriesNav: {
    position: 'absolute', right: 8, top: '30%' as any,
    alignItems: 'center', gap: 4, zIndex: 15,
  },
  sliceNavBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(24,24,27,0.9)', borderWidth: 1, borderColor: '#27272a',
    alignItems: 'center', justifyContent: 'center',
  },
  sliceNavBtnDisabled: { opacity: 0.4 },
  sliceCounter: {
    backgroundColor: 'rgba(9,9,11,0.9)', borderWidth: 1, borderColor: '#27272a',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center',
  },
  sliceCounterText: { color: '#06b6d4', fontSize: 16, fontWeight: '700' },
  sliceDivider: { width: 16, height: 1, backgroundColor: '#27272a', marginVertical: 2 },
  sliceCounterTotal: { color: '#71717a', fontSize: 12, fontWeight: '600' },
  errorOverlay: {
    position: 'absolute', top: 70, left: 20, right: 20,
    backgroundColor: 'rgba(239,68,68,0.12)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)',
    borderRadius: 14, padding: 20, alignItems: 'center', zIndex: 30,
  },
  errorText: { color: '#fca5a5', fontSize: 14, textAlign: 'center', marginBottom: 14 },
  errorBtn: { backgroundColor: '#27272a', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  errorBtnText: { color: '#fafafa', fontSize: 14, fontWeight: '600' },
  infoPanel: { position: 'absolute', top: 56, left: 8, right: 8, zIndex: 25 },
  infoPanelInner: {
    backgroundColor: 'rgba(24,24,27,0.95)', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#27272a',
  },
  infoTitle: { color: '#06b6d4', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 12 },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5,
    borderBottomWidth: 1, borderBottomColor: 'rgba(39,39,42,0.5)',
  },
  infoLabel: { color: '#71717a', fontSize: 12, fontWeight: '500' },
  infoValue: { color: '#e4e4e7', fontSize: 12, fontWeight: '600', maxWidth: '60%' as any },
  measureToast: {
    position: 'absolute', top: 70, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(9,9,11,0.9)', borderWidth: 1, borderColor: '#06b6d4',
    borderRadius: 24, paddingHorizontal: 18, paddingVertical: 10, zIndex: 30,
  },
  measureToastText: { color: '#22d3ee', fontSize: 16, fontWeight: '700' },
  presetsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 8, backgroundColor: 'rgba(9,9,11,0.92)',
  },
  presetBtn: {
    backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, alignItems: 'center',
  },
  presetBtnText: { color: '#22d3ee', fontSize: 12, fontWeight: '600' },
  measureHint: { flex: 1, alignItems: 'flex-end' },
  measureHintText: { color: '#52525b', fontSize: 11, fontStyle: 'italic' },
  toolbar: {
    backgroundColor: 'rgba(9,9,11,0.95)', borderTopWidth: 1, borderTopColor: '#1a1a1e',
    paddingBottom: Platform.OS === 'ios' ? 4 : 8, paddingTop: 6,
  },
  toolbarInner: {
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingHorizontal: 4,
  },
  toolBtn: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 6, paddingHorizontal: 4, minWidth: 40, minHeight: 44, borderRadius: 10,
  },
  toolBtnActive: { backgroundColor: 'rgba(6,182,212,0.1)' },
  toolLabel: { fontSize: 9, fontWeight: '600', marginTop: 2 },
});
