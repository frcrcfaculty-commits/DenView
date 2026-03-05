# DentView - Dental DICOM Viewer

## Product Overview
DentView is a mobile-first DICOM file viewer for dentists to open and view dental X-rays on their phones. All processing happens client-side — files never leave the device.

## Architecture
- **Frontend**: Expo React Native (SDK 54) with WebView/iframe for DICOM rendering
- **Backend**: Minimal FastAPI (health check only)
- **DICOM Engine**: dicomParser.js loaded in WebView, custom canvas rendering
- **Storage**: Client-side only (fileStore module for in-memory file data)
- **Auth**: None (privacy-first, no login required)

## Core Features (MVP)
1. **Home Screen**: File picker (expo-document-picker), demo mode, privacy badge, theme toggle
2. **DICOM Viewer**: WebView-based rendering with dicomParser
3. **Tools**: Pan, Zoom, Window/Level (Bone/Soft/Full presets), Measure, Rotate, Invert, Reset, Scroll (series)
4. **DICOM Info Panel**: Patient name, study date, modality, image size, pixel spacing, W/C/W, slice info
5. **Dark/Light Theme**: Dark mode default with toggle
6. **ZIP Support**: Open .zip archives, extract .dcm files, present as scrollable series (JSZip)
7. **Multi-file Selection**: Select multiple .dcm files and view as a series
8. **Series Navigation**: Prev/Next buttons, slice counter, Scroll tool for CBCT-style viewing
9. **Demo Series**: 12 synthetic dental slices for demonstration

## Tech Stack
- Expo Router (file-based routing)
- react-native-webview (native) / iframe (web)
- dicomParser.js (CDN-loaded in WebView)
- expo-document-picker + expo-file-system
- lucide-react-native (icons)
- FastAPI (minimal backend)

## File Structure
```
frontend/
  app/
    _layout.tsx        - Stack navigator, ThemeContext
    index.tsx          - Home screen
    viewer.tsx         - DICOM viewer with toolbar
  src/
    constants/colors.ts - Dark/Light theme colors
    store/fileStore.ts  - In-memory file data store
    utils/dicomViewerHtml.ts - WebView HTML with DICOM viewer
backend/
  server.py            - Health check endpoint
```

## Privacy
- Zero server uploads
- No cookies or tracking
- All DICOM processing in browser/WebView
- "Files never leave your device" badge on home screen

## Future Enhancements
- Side-by-side image comparison
- Annotation tools (arrows, circles, text)
- Export current view as PNG/JPEG
- CBCT series scrolling with frame slider
- PWA support for offline use
- Cloud link support (Google Drive, Dropbox)
