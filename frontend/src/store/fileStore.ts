let _fileData: string | null = null;
let _fileName: string | null = null;

export const fileStore = {
  setFile(data: string, name: string) {
    _fileData = data;
    _fileName = name;
  },
  getData() {
    return _fileData;
  },
  getName() {
    return _fileName;
  },
  clear() {
    _fileData = null;
    _fileName = null;
  },
};
