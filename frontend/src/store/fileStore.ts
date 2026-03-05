export type FileMode = 'single' | 'zip' | 'multi';

let _fileData: string | null = null;
let _multiFileData: { data: string; name: string }[] = [];
let _fileName: string | null = null;
let _mode: FileMode = 'single';

export const fileStore = {
  setFile(data: string, name: string) {
    _fileData = data;
    _fileName = name;
    _multiFileData = [];
    _mode = 'single';
  },
  setZip(data: string, name: string) {
    _fileData = data;
    _fileName = name;
    _multiFileData = [];
    _mode = 'zip';
  },
  setMultiFiles(files: { data: string; name: string }[]) {
    _fileData = null;
    _multiFileData = files;
    _fileName = files.length + ' DICOM files';
    _mode = 'multi';
  },
  getData() {
    return _fileData;
  },
  getMultiData() {
    return _multiFileData;
  },
  getName() {
    return _fileName;
  },
  getMode(): FileMode {
    return _mode;
  },
  hasData() {
    return _fileData !== null || _multiFileData.length > 0;
  },
  clear() {
    _fileData = null;
    _fileName = null;
    _multiFileData = [];
    _mode = 'single';
  },
};
