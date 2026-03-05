import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { FontAwesome5 } from '@expo/vector-icons';
import {
  FolderOpen,
  Play,
  Shield,
  Sun,
  Moon,
  ChevronRight,
  Smartphone,
  Eye,
  Ruler,
  RotateCw,
} from 'lucide-react-native';
import { useTheme } from './_layout';
import { fileStore } from '@/src/store/fileStore';

export default function HomeScreen() {
  const { isDark, colors, toggle } = useTheme();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const pickFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/dicom', 'application/octet-stream', '*/*'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const file = result.assets[0];
      const ext = file.name?.toLowerCase().split('.').pop();
      if (ext !== 'dcm' && ext !== 'dicom') {
        Alert.alert(
          'File Type',
          'Selected file may not be a DICOM file. Attempting to open anyway.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open', onPress: () => loadFile(file.uri, file.name) },
          ]
        );
        return;
      }
      await loadFile(file.uri, file.name);
    } catch (err: any) {
      Alert.alert('Error', 'Could not pick file: ' + err.message);
    }
  }, []);

  const loadFile = async (uri: string, name: string) => {
    setLoading(true);
    try {
      let base64: string;
      if (Platform.OS === 'web') {
        const response = await fetch(uri);
        const blob = await response.blob();
        base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } else {
        base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      fileStore.setFile(base64, name);
      router.push({ pathname: '/viewer', params: { fileName: name } });
    } catch (err: any) {
      Alert.alert('Error', 'Could not read file: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const openDemo = useCallback(() => {
    fileStore.clear();
    router.push({ pathname: '/viewer', params: { demo: 'true' } });
  }, []);

  const s = getStyles(colors);

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <FontAwesome5
              name="tooth"
              size={22}
              color={colors.primary}
              testID="app-logo"
            />
            <Text style={[s.headerTitle, { color: colors.text }]}>DentView</Text>
          </View>
          <TouchableOpacity
            testID="theme-toggle-btn"
            onPress={toggle}
            style={[s.themeBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            activeOpacity={0.7}
          >
            {isDark ? (
              <Sun size={20} color={colors.textSecondary} />
            ) : (
              <Moon size={20} color={colors.textSecondary} />
            )}
          </TouchableOpacity>
        </View>

        {/* Hero Section */}
        <View style={s.heroSection}>
          <View style={[s.heroIconWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Eye size={48} color={colors.primary} strokeWidth={1.5} />
          </View>
          <Text style={[s.heroTitle, { color: colors.text }]}>
            Dental DICOM Viewer
          </Text>
          <Text style={[s.heroSubtitle, { color: colors.textSecondary }]}>
            Open and view dental X-rays directly on your phone.{'\n'}
            Zoom, measure, and adjust — all in your browser.
          </Text>
        </View>

        {/* Action Buttons */}
        <View style={s.actionSection}>
          <TouchableOpacity
            testID="open-file-btn"
            onPress={pickFile}
            style={[s.primaryBtn, { backgroundColor: colors.primary }]}
            activeOpacity={0.8}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <FolderOpen size={22} color="#fff" />
            )}
            <Text style={s.primaryBtnText}>
              {loading ? 'Reading file...' : 'Open DICOM File'}
            </Text>
            <ChevronRight size={18} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>

          <TouchableOpacity
            testID="load-demo-btn"
            onPress={openDemo}
            style={[s.secondaryBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            activeOpacity={0.8}
          >
            <Play size={20} color={colors.primary} />
            <Text style={[s.secondaryBtnText, { color: colors.text }]}>
              Load Demo Image
            </Text>
            <ChevronRight size={18} color={colors.muted} />
          </TouchableOpacity>
        </View>

        {/* Features */}
        <View style={s.featuresSection}>
          <Text style={[s.sectionLabel, { color: colors.muted }]}>FEATURES</Text>
          <View style={s.featuresGrid}>
            {[
              { icon: Eye, label: 'View X-Rays', desc: 'Open .dcm files' },
              { icon: Ruler, label: 'Measure', desc: 'Distance in mm' },
              { icon: Sun, label: 'Window/Level', desc: 'Bone & Soft presets' },
              { icon: RotateCw, label: 'Transform', desc: 'Rotate & invert' },
            ].map((f, i) => (
              <View
                key={i}
                style={[s.featureCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <f.icon size={24} color={colors.primary} strokeWidth={1.5} />
                <Text style={[s.featureLabel, { color: colors.text }]}>{f.label}</Text>
                <Text style={[s.featureDesc, { color: colors.muted }]}>{f.desc}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Privacy Badge */}
        <View style={[s.privacyBadge, { backgroundColor: isDark ? 'rgba(16,185,129,0.08)' : 'rgba(5,150,105,0.06)', borderColor: isDark ? 'rgba(16,185,129,0.2)' : 'rgba(5,150,105,0.15)' }]}>
          <Shield size={18} color={colors.success} />
          <View style={s.privacyTextWrap}>
            <Text style={[s.privacyTitle, { color: colors.success }]}>
              Files never leave your device
            </Text>
            <Text style={[s.privacyDesc, { color: colors.muted }]}>
              Zero server uploads · No cookies · No tracking
            </Text>
          </View>
        </View>

        {/* Supported Formats */}
        <View style={s.formatsSection}>
          <Text style={[s.sectionLabel, { color: colors.muted }]}>SUPPORTED</Text>
          <View style={s.formatsRow}>
            {['Panoramic', 'Periapical', 'Bitewing', 'CBCT'].map((f) => (
              <View
                key={f}
                style={[s.formatChip, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Text style={[s.formatText, { color: colors.textSecondary }]}>{f}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors: any) =>
  StyleSheet.create({
    container: { flex: 1 },
    scrollContent: { paddingHorizontal: 24, paddingTop: Platform.OS === 'android' ? 48 : 12 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 16,
    },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    headerTitle: { fontSize: 22, fontWeight: '700', letterSpacing: -0.5 },
    themeBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
    },
    heroSection: { alignItems: 'center', paddingTop: 32, paddingBottom: 36 },
    heroIconWrap: {
      width: 96,
      height: 96,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      marginBottom: 20,
    },
    heroTitle: { fontSize: 28, fontWeight: '800', letterSpacing: -0.8, marginBottom: 10 },
    heroSubtitle: { fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 300 },
    actionSection: { gap: 12, marginBottom: 36 },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      height: 58,
      borderRadius: 16,
      paddingHorizontal: 24,
      gap: 12,
      boxShadow: '0 4px 12px rgba(6, 182, 212, 0.3)',
      elevation: 6,
    },
    primaryBtnText: { fontSize: 17, fontWeight: '700', color: '#fff', flex: 1 },
    secondaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      height: 54,
      borderRadius: 14,
      paddingHorizontal: 24,
      gap: 12,
      borderWidth: 1,
    },
    secondaryBtnText: { fontSize: 16, fontWeight: '600', flex: 1 },
    featuresSection: { marginBottom: 28 },
    sectionLabel: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.5,
      marginBottom: 12,
    },
    featuresGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    featureCard: {
      width: '48%' as any,
      flexBasis: '47%',
      padding: 16,
      borderRadius: 14,
      borderWidth: 1,
      gap: 6,
    },
    featureLabel: { fontSize: 14, fontWeight: '600' },
    featureDesc: { fontSize: 12 },
    privacyBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      borderRadius: 14,
      borderWidth: 1,
      gap: 14,
      marginBottom: 28,
    },
    privacyTextWrap: { flex: 1 },
    privacyTitle: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
    privacyDesc: { fontSize: 12 },
    formatsSection: { marginBottom: 8 },
    formatsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    formatChip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
      borderWidth: 1,
    },
    formatText: { fontSize: 13, fontWeight: '500' },
  });
