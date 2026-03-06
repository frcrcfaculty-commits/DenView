export type FileMode = 'single' | 'zip' | 'multi';

let _fileData: string | null = null;
let _blobData: Blob | null = null;  // Raw blob for web (avoids base64 for large files)
let _multiFileData: { data: string; name: string }[] = [];
let _multiBlobData: { data: Blob; name: string }[] = [];
let _fileName: string | null = null;
let _mode: FileMode = 'single';

export const fileStore = {
  setFile(data: string, name: string) {
    _fileData = data;
    _blobData = null;
    _fileName = name;
    _multiFileData = [];
    _multiBlobData = [];
    _mode = 'single';
  },
  setFileBlob(data: Blob, name: string) {
    _fileData = null;
    _blobData = data;
    _fileName = name;
    _multiFileData = [];
    _multiBlobData = [];
    _mode = 'single';
  },
  setZip(data: string, name: string) {
    _fileData = data;
    _blobData = null;
    _fileName = name;
    _multiFileData = [];
    _multiBlobData = [];
    _mode = 'zip';
  },
  setZipBlob(data: Blob, name: string) {
    _fileData = null;
    _blobData = data;
    _fileName = name;
    _multiFileData = [];
    _multiBlobData = [];
    _mode = 'zip';
  },
  setMultiFiles(files: { data: string; name: string }[]) {
    _fileData = null;
    _blobData = null;
    _multiFileData = files;
    _multiBlobData = [];
    _fileName = files.length + ' DICOM files';
    _mode = 'multi';
  },
  setMultiFileBlobs(files: { data: Blob; name: string }[]) {
    _fileData = null;
    _blobData = null;
    _multiFileData = [];
    _multiBlobData = files;
    _fileName = files.length + ' DICOM files';
    _mode = 'multi';
  },
  getData() {
    return _fileData;
  },
  getBlobData() {
    return _blobData;
  },
  getMultiData() {
    return _multiFileData;
  },
  getMultiBlobData() {
    return _multiBlobData;
  },
  getName() {
    return _fileName;
  },
  getMode(): FileMode {
    return _mode;
  },
  hasData() {
    return _fileData !== null || _blobData !== null || _multiFileData.length > 0 || _multiBlobData.length > 0;
  },
  clear() {
    _fileData = null;
    _blobData = null;
    _fileName = null;
    _multiFileData = [];
    _multiBlobData = [];
    _mode = 'single';
  },
};
