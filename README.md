# DentView — Mobile DICOM Viewer for Dental Radiology

A mobile-first DICOM viewer built for maxillofacial radiologists to view dental X-rays and CBCT scans directly on their phones. All processing happens client-side — **files never leave your device**.

## Features

- **DICOM Viewing** — Open single `.dcm` files, multiple files, or ZIP archives containing DICOM series
- **Compressed DICOM Support** — JPEG 2000 (lossless + lossy), JPEG Lossless, JPEG Baseline, and RLE transfer syntaxes
- **Works Offline** — all decoders are bundled into the app; no CDN or network request at runtime
- **CBCT Series Navigation** — Scroll through hundreds of slices with a smooth scrubber/slider
- **MPR Reconstruction** — Axial, Coronal, Sagittal, and Panoramic views from volumetric CBCT data
- **Panoramic Reconstruction** — Auto-detects dental arch shape with maximum intensity projection
- **Window/Level Presets** — Dental, Bone, Soft Tissue, and Full Range presets
- **Measurement Tool** — Tap two points to measure distance in mm (uses DICOM pixel spacing)
- **FDI Tooth Chart** — Interactive tooth map with navigation to anatomical regions
- **Image Export** — Save current view as PNG with annotations for sharing
- **Dark/Light Theme** — Dark mode default with toggle
- **Privacy-First** — Zero server uploads, no cookies, no tracking, no login required

## Tech Stack

- **Frontend**: Expo SDK 54, React Native, Expo Router
- **DICOM Engine**: dicomParser.js in WebView with custom canvas rendering
- **Compression**: OpenJPEG (WebAssembly, inlined as base64, via @cornerstonejs/codec-openjpeg) for JPEG 2000, jpeg-lossless-decoder-js, native browser JPEG, custom RLE decoder
- **ZIP Support**: JSZip for `.zip` archive extraction
- **Backend**: Minimal FastAPI health check

## Project Structure

```
frontend/
├── app/
│   ├── _layout.tsx             # Root layout, theme context
│   ├── index.tsx               # Home screen — file picker, demo mode
│   └── viewer.tsx              # DICOM viewer — toolbar, slider, info panel
├── src/
│   ├── constants/colors.ts     # Dark/Light theme color tokens
│   ├── store/fileStore.ts      # In-memory file data store
│   └── utils/
│       └── dicomViewerHtml.ts  # WebView HTML — DICOM parser, renderer, tools
backend/
├── server.py                   # FastAPI health endpoint
└── requirements.txt
```

## Getting Started

```bash
cd frontend
npm install
npx expo start
```

### Running on device
```bash
npx expo start --android
npx expo start --ios
npx expo start --web
```

## Supported DICOM Transfer Syntaxes

| Transfer Syntax | Status |
|---|---|
| Implicit/Explicit VR Little Endian | Supported |
| JPEG Lossless (1.2.840.10008.1.2.4.70) | Supported |
| JPEG Lossless Process 14 | Supported |
| JPEG Baseline | Supported |
| RLE Lossless | Supported |
| JPEG 2000 Lossless (1.2.840.10008.1.2.4.90) | Supported |
| JPEG 2000 (1.2.840.10008.1.2.4.91) | Supported |
| JPEG-LS | Not yet — re-export as JPEG Lossless |

## Architecture

DICOM rendering runs in a WebView/iframe. dicomParser, JSZip and the decoders are vendored in `frontend/scripts/vendor/` and inlined into the WebView HTML by `node scripts/vendor-libs.js` (generates `src/utils/vendorLibs.ts`), so the viewer needs no network. React Native handles file picking, theme, and native UI. Communication via postMessage.

## Testing

```bash
node tests/viewer-e2e.mjs   # renders the real viewer offline in headless Edge/Chrome and decodes every fixture
cd frontend && npx tsc --noEmit && npx expo-doctor
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, expo-doctor, the offline end-to-end test and a web export on every push.

## Building an Android APK

```bash
cd frontend
npx eas-cli login
npx eas-cli build -p android --profile preview   # installable APK, built in Expo's cloud
```

## Privacy

All DICOM processing is on-device. No patient data touches any server.

## License

MIT
