export function getDicomViewerHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">
<title>DentView DICOM Viewer</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:100%;height:100%;overflow:hidden;background:#09090b;touch-action:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;}
#canvas{display:block;width:100%;height:100%;}
#loading{position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#a1a1aa;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:16px;background:#09090b;z-index:100;flex-direction:column;gap:12px;}
#loading .spinner{width:36px;height:36px;border:3px solid #27272a;border-top-color:#06b6d4;border-radius:50%;animation:spin 0.8s linear infinite;}
@keyframes spin{to{transform:rotate(360deg);}}
.hidden{display:none!important;}
#sliceInfo{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);color:#06b6d4;font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:13px;font-weight:600;background:rgba(9,9,11,0.85);padding:4px 14px;border-radius:12px;border:1px solid #27272a;pointer-events:none;z-index:10;}
#progressBar{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:280px;background:rgba(24,24,27,0.95);border:1px solid #27272a;border-radius:12px;padding:20px;z-index:110;display:none;flex-direction:column;align-items:center;gap:10px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;}
#progressBar .bar{width:100%;height:6px;background:#27272a;border-radius:3px;overflow:hidden;}
#progressBar .fill{height:100%;background:#06b6d4;border-radius:3px;transition:width 0.15s;}
#progressBar .text{color:#a1a1aa;font-size:13px;text-align:center;}
#progressBar .subtext{color:#52525b;font-size:11px;text-align:center;}
</style>
</head>
<body>
<canvas id="canvas"></canvas>
<div id="loading"><div class="spinner"></div><span id="loadText">Initializing viewer...</span></div>
<div id="sliceInfo" class="hidden"></div>
<div id="progressBar"><div class="text" id="progText">Loading...</div><div class="subtext" id="progSub"></div><div class="bar"><div class="fill" id="progFill" style="width:0%"></div></div></div>
<script src="https://unpkg.com/dicom-parser@1.8.21/dist/dicomParser.min.js"></script>
<script src="https://unpkg.com/jszip@3.10.1/dist/jszip.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/jpeg-lossless-decoder-js/release/current/lossless.js"></script>
<script>
(function(){
'use strict';

/* ── State ── */
var series=[];
var seriesGroups={};     // { groupName: [parsed slices] }
var activeGroupName='';
var currentSlice=0;
var img=null;
var vp={zoom:1,panX:0,panY:0,rotation:0,inverted:false};
var wl={center:0,width:0};
var activeTool='pan';
var measurePts=[];
var allMeasures=[];
var pxSpaceX=1;
var pxSpaceY=1;

/* ── 3D Volume for MPR ── */
var volume=null;        // Int16Array: volume[z*volRows*volCols + y*volCols + x]
var volCols=0;          // width of each axial slice
var volRows=0;          // height of each axial slice
var volSlices=0;        // number of axial slices (depth)
var volSlope=1;
var volIntercept=0;
var volWL={center:500,width:2500};
var viewMode='axial';   // axial | coronal | sagittal | panoramic
var mprSlice=0;         // current position in coronal/sagittal/panoramic mode
var mprTotal=0;         // total slices in current MPR mode
var panoCache=null;     // cached panoramic reconstruction
var memoryWarned=false;  // only warn once about large volumes

/* ── DOM refs ── */
var canvas=document.getElementById('canvas');
var ctx=canvas.getContext('2d');
var loadingEl=document.getElementById('loading');
var loadText=document.getElementById('loadText');
var sliceInfoEl=document.getElementById('sliceInfo');
var progressBar=document.getElementById('progressBar');
var progText=document.getElementById('progText');
var progSub=document.getElementById('progSub');
var progFill=document.getElementById('progFill');

var offCanvas=document.createElement('canvas');
var offCtx=offCanvas.getContext('2d');

/* ── Init ── */
function init(){
  resize();
  window.addEventListener('resize',resize);
  setupInput();
  sendMsg('ready',{});
  loadText.textContent='Ready';
}

function resize(){
  canvas.width=window.innerWidth;
  canvas.height=window.innerHeight;
  if(img) drawFrame();
}

/* ── Progress UI ── */
function showProgress(text,pct,sub){
  progressBar.style.display='flex';
  progText.textContent=text;
  progFill.style.width=pct+'%';
  progSub.textContent=sub||'';
}
function hideProgress(){progressBar.style.display='none';}

/* ── Base64 → bytes ── */
function base64ToBytes(base64){
  try{
    var raw=atob(base64);
    var bytes=new Uint8Array(raw.length);
    for(var i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
    return bytes;
  }catch(e){
    throw new Error('Invalid base64 data: '+e.message);
  }
}

/* ── Natural numeric sort ── */
function naturalCompare(a,b){
  var re=/(\d+)/g;
  var aParts=a.split(re);
  var bParts=b.split(re);
  for(var i=0;i<Math.min(aParts.length,bParts.length);i++){
    if(aParts[i]!==bParts[i]){
      var aNum=parseInt(aParts[i]);
      var bNum=parseInt(bParts[i]);
      if(!isNaN(aNum)&&!isNaN(bNum)) return aNum-bNum;
      return aParts[i].localeCompare(bParts[i]);
    }
  }
  return aParts.length-bParts.length;
}

/* ── DICOM Parser ── */

/* ── Compressed Transfer Syntax Support ── */
var TS_IMPLICIT_VR_LE='1.2.840.10008.1.2';
var TS_EXPLICIT_VR_LE='1.2.840.10008.1.2.1';
var TS_EXPLICIT_VR_BE='1.2.840.10008.1.2.2';
var TS_DEFLATED='1.2.840.10008.1.2.1.99';
var TS_JPEG_BASELINE='1.2.840.10008.1.2.4.50';
var TS_JPEG_EXTENDED='1.2.840.10008.1.2.4.51';
var TS_JPEG_LOSSLESS_P14='1.2.840.10008.1.2.4.57';
var TS_JPEG_LOSSLESS='1.2.840.10008.1.2.4.70';
var TS_JPEG2K_LOSSLESS='1.2.840.10008.1.2.4.90';
var TS_JPEG2K='1.2.840.10008.1.2.4.91';
var TS_JPEGLS_LOSSLESS='1.2.840.10008.1.2.4.80';
var TS_JPEGLS='1.2.840.10008.1.2.4.81';
var TS_RLE='1.2.840.10008.1.2.5';

function isEncapsulatedTS(ts){
  if(!ts) return false;
  return ts!==TS_IMPLICIT_VR_LE && ts!==TS_EXPLICIT_VR_LE && ts!==TS_EXPLICIT_VR_BE && ts!==TS_DEFLATED;
}

function extractEncapsulatedFrame(ds,pixelDataEl){
  try{
    /* Use dicomParser built-in if available */
    if(pixelDataEl.fragments && pixelDataEl.fragments.length>0){
      if(typeof dicomParser.readEncapsulatedPixelDataFromFragments==='function'){
        return dicomParser.readEncapsulatedPixelDataFromFragments(ds,pixelDataEl,0,pixelDataEl.fragments.length);
      }
      /* Manual extraction */
      var totalLen=0;
      for(var i=0;i<pixelDataEl.fragments.length;i++) totalLen+=pixelDataEl.fragments[i].length;
      var result=new Uint8Array(totalLen);
      var off=0;
      for(var i=0;i<pixelDataEl.fragments.length;i++){
        var frag=pixelDataEl.fragments[i];
        var fragData=new Uint8Array(ds.byteArray.buffer,ds.byteArray.byteOffset+frag.position,frag.length);
        result.set(fragData,off);
        off+=frag.length;
      }
      return result;
    }
  }catch(e){}
  return null;
}

function decodeJPEGLossless(frameData,frameSize,bitsAlloc,pixelRep){
  if(typeof jpeg==='undefined'||!jpeg.lossless||!jpeg.lossless.Decoder){
    throw new Error('JPEG Lossless decoder not loaded. Check network connection.');
  }
  var decoder=new jpeg.lossless.Decoder();
  var output=decoder.decompress(new DataView(frameData.buffer,frameData.byteOffset,frameData.byteLength));
  if(!output) throw new Error('JPEG Lossless decode failed');
  if(bitsAlloc<=8) return new Uint8Array(output);
  if(pixelRep===1) return new Int16Array(output);
  return new Uint16Array(output);
}

function decodeJPEGBaseline(frameData,rows,cols,bitsAlloc,pixelRep,samplesPerPixel){
  /* For 8-bit lossy JPEG, the compressed data IS a standard JPEG.
   * Create a blob URL, load via Image, draw to canvas, extract pixels.
   * This is inherently async. We return a placeholder and schedule decode. */
  var blob=new Blob([frameData],{type:'image/jpeg'});
  var url=URL.createObjectURL(blob);
  
  /* We return a placeholder and schedule async decode */
  var placeholder=new Int16Array(rows*cols*samplesPerPixel);
  /* Mark as pending so parseSingleDicom uses sensible defaults */
  placeholder._jpegPending=true;
  
  var localImg=new Image();
  localImg.onload=function(){
    var tc=document.createElement('canvas');
    tc.width=cols;tc.height=rows;
    var tctx=tc.getContext('2d');
    tctx.drawImage(localImg,0,0,cols,rows);
    var idata=tctx.getImageData(0,0,cols,rows);
    var minV=Infinity,maxV=-Infinity;
    for(var i=0;i<rows*cols;i++){
      var v=idata.data[i*4]; /* R channel for grayscale */
      placeholder[i]=v;
      if(v<minV)minV=v;
      if(v>maxV)maxV=v;
    }
    placeholder._jpegPending=false;
    URL.revokeObjectURL(url);
    
    /* Update the current slice's imgData min/max if this is the active image */
    if(img && img.pixelData===placeholder){
      img.minVal=minV;
      img.maxVal=maxV;
      /* Recompute W/L from actual data if still using defaults */
      var newCenter=(minV+maxV)/2;
      var newWidth=Math.max(1,maxV-minV);
      wl.center=newCenter;
      wl.width=newWidth;
      sendMsg('wlUpdate',{center:Math.round(wl.center),width:Math.round(wl.width)});
    }
    /* Also update the series entry if it exists */
    for(var s=0;s<series.length;s++){
      if(series[s].imgData.pixelData===placeholder){
        series[s].imgData.minVal=minV;
        series[s].imgData.maxVal=maxV;
        series[s].wl.center=(minV+maxV)/2;
        series[s].wl.width=Math.max(1,maxV-minV);
        break;
      }
    }
    
    /* Re-render after async decode completes */
    renderWindowed();drawFrame();
  };
  localImg.onerror=function(){URL.revokeObjectURL(url);};
  localImg.src=url;
  return placeholder;
}

function decodeRLE(frameData,rows,cols,bitsAlloc,pixelRep,samplesPerPixel){
  if(frameData.length<64) throw new Error('RLE data too short');
  var view=new DataView(frameData.buffer,frameData.byteOffset,frameData.byteLength);
  var nSegments=view.getUint32(0,true);
  var offsets=[];
  for(var i=0;i<nSegments;i++) offsets.push(view.getUint32((i+1)*4,true));

  var bytesPerPixel=Math.ceil(bitsAlloc/8);
  var outputSize=rows*cols*samplesPerPixel*bytesPerPixel;
  var output=new Uint8Array(outputSize);

  for(var seg=0;seg<nSegments;seg++){
    var start=offsets[seg];
    var end=(seg+1<nSegments)?offsets[seg+1]:frameData.length;
    var outOffset=seg;
    var pos=start;
    while(pos<end && outOffset<outputSize){
      var n=frameData[pos++];
      if(n===undefined) break;
      if(n<=127){
        var count=n+1;
        for(var j=0;j<count && pos<end && outOffset<outputSize;j++){
          output[outOffset]=frameData[pos++];
          outOffset+=nSegments;
        }
      }else if(n>128){
        var count=257-n;
        var val=frameData[pos++];
        for(var j=0;j<count && outOffset<outputSize;j++){
          output[outOffset]=val;
          outOffset+=nSegments;
        }
      }
    }
  }
  if(bitsAlloc<=8) return output;
  if(pixelRep===1) return new Int16Array(output.buffer);
  return new Uint16Array(output.buffer);
}

function decodeCompressedFrame(frameData,ts,rows,cols,bitsAlloc,bitsStored,pixelRep,spp){
  /* JPEG Lossless (most common for dental CBCT) */
  if(ts===TS_JPEG_LOSSLESS || ts===TS_JPEG_LOSSLESS_P14){
    return decodeJPEGLossless(frameData,rows*cols*spp,bitsAlloc,pixelRep);
  }
  /* JPEG Baseline/Extended */
  if(ts===TS_JPEG_BASELINE || ts===TS_JPEG_EXTENDED){
    return decodeJPEGBaseline(frameData,rows,cols,bitsAlloc,pixelRep,spp);
  }
  /* RLE Lossless */
  if(ts===TS_RLE){
    return decodeRLE(frameData,rows,cols,bitsAlloc,pixelRep,spp);
  }
  /* JPEG 2000 */
  if(ts===TS_JPEG2K_LOSSLESS || ts===TS_JPEG2K){
    throw new Error('JPEG 2000 compressed DICOM detected. This format is not yet supported in DentView. Please export your scan as Uncompressed or JPEG Lossless from your CBCT software (Planmeca Romexis, Carestream, iCAT, etc).');
  }
  /* JPEG-LS */
  if(ts===TS_JPEGLS_LOSSLESS || ts===TS_JPEGLS){
    throw new Error('JPEG-LS compressed DICOM detected. This format is not yet supported. Please export as Uncompressed or JPEG Lossless.');
  }
  throw new Error('Unsupported transfer syntax: '+ts+'. Please export as Uncompressed DICOM.');
}
function parseSingleDicom(bytes){
  var ds=dicomParser.parseDicom(bytes);
  var rows=ds.uint16('x00280010');
  var cols=ds.uint16('x00280011');
  if(!rows||!cols) return null;

  var bitsAlloc=ds.uint16('x00280100')||16;
  var bitsStored=ds.uint16('x00280101')||bitsAlloc;
  var pixelRep=ds.uint16('x00280103')||0;
  var photometric=ds.string('x00280004')||'MONOCHROME2';
  var samplesPerPixel=ds.uint16('x00280002')||1;
  var rescaleSlope=1,rescaleIntercept=0;
  try{rescaleIntercept=parseFloat(ds.string('x00281052'))||0;}catch(e){}
  try{rescaleSlope=parseFloat(ds.string('x00281053'))||1;}catch(e){}

  var wcStr=null,wwStr=null;
  try{wcStr=ds.string('x00281050');}catch(e){}
  try{wwStr=ds.string('x00281051');}catch(e){}

  var psStr=null;
  try{psStr=ds.string('x00280030');}catch(e){}
  var psx=1,psy=1;
  if(psStr){
    var psParts=psStr.split(String.fromCharCode(92));
    psy=parseFloat(psParts[0])||1;
    psx=parseFloat(psParts[1])||psy;
  }

  var instanceNum=0;
  try{instanceNum=parseInt(ds.string('x00200013'))||0;}catch(e){}
  var sliceLoc=0;
  try{sliceLoc=parseFloat(ds.string('x00201041'))||0;}catch(e){}
  var imgPosStr=null;
  try{imgPosStr=ds.string('x00200032');}catch(e){}
  var zPos=null;  /* null means not available */
  var xPos=0,yPos=0;
  if(imgPosStr){
    var parts=imgPosStr.split(String.fromCharCode(92));
    xPos=parseFloat(parts[0])||0;
    yPos=parseFloat(parts[1])||0;
    if(parts.length>=3) zPos=parseFloat(parts[2]);
    if(isNaN(zPos)) zPos=null;
  }
  var sliceThickness=0;
  try{sliceThickness=parseFloat(ds.string('x00180050'))||0;}catch(e){}
  var imgOrientStr=null;
  try{imgOrientStr=ds.string('x00200037');}catch(e){}

  /* Transfer syntax detection */
  var transferSyntax='';
  try{transferSyntax=(ds.string('x00020010')||'').trim();}catch(e){}

  var pixelDataEl=ds.elements.x7fe00010;
  if(!pixelDataEl) return null;

  var pixelData;
  var isEncapsulated=!!(pixelDataEl.encapsulatedPixelData || 
    (pixelDataEl.fragments && pixelDataEl.fragments.length>0) ||
    (transferSyntax && isEncapsulatedTS(transferSyntax)));

  if(isEncapsulated && pixelDataEl.fragments && pixelDataEl.fragments.length>0){
    /* Compressed DICOM - extract and decode */
    var frameData=extractEncapsulatedFrame(ds,pixelDataEl);
    if(!frameData) return null;
    try{
      pixelData=decodeCompressedFrame(frameData,transferSyntax,rows,cols,bitsAlloc,bitsStored,pixelRep,samplesPerPixel);
    }catch(decodeErr){
      throw decodeErr; /* Propagate decode errors with helpful messages */
    }
    if(!pixelData) return null;
  }else{
    /* Uncompressed DICOM */
    if(bitsAlloc<=8){
      pixelData=new Uint8Array(ds.byteArray.buffer,pixelDataEl.dataOffset,pixelDataEl.length);
    }else if(bitsAlloc<=16){
      if(pixelRep===1){
        pixelData=new Int16Array(ds.byteArray.buffer,pixelDataEl.dataOffset,pixelDataEl.length/2);
      }else{
        pixelData=new Uint16Array(ds.byteArray.buffer,pixelDataEl.dataOffset,pixelDataEl.length/2);
      }
    }else{return null;}
  }

  var frameSize=rows*cols*samplesPerPixel;
  var minV=Infinity,maxV=-Infinity;
  /* For JPEG Baseline async decode, pixelData is zeroed initially */
  if(pixelData._jpegPending){
    /* Use 8-bit range defaults until async decode completes */
    minV=0;maxV=255;
  }else{
    for(var i=0;i<Math.min(pixelData.length,frameSize);i++){
      var v=pixelData[i]*rescaleSlope+rescaleIntercept;
      if(v<minV)minV=v;if(v>maxV)maxV=v;
    }
  }

  var patName='Unknown';try{patName=ds.string('x00100010')||'Unknown';}catch(e){}
  var studyDate='Unknown';try{studyDate=ds.string('x00080020')||'Unknown';}catch(e){}
  var modality='Unknown';try{modality=ds.string('x00080060')||'Unknown';}catch(e){}

  var wc=(minV+maxV)/2,ww=Math.max(1,maxV-minV);
  if(wcStr&&wwStr){
    wc=parseFloat(wcStr.split(String.fromCharCode(92))[0]);
    ww=parseFloat(wwStr.split(String.fromCharCode(92))[0]);
  }

  return {
    imgData:{
      pixelData:pixelData,rows:rows,columns:cols,
      bitsAllocated:bitsAlloc,bitsStored:bitsStored,pixelRep:pixelRep,
      photometric:photometric,rescaleSlope:rescaleSlope,rescaleIntercept:rescaleIntercept,
      minVal:minV,maxVal:maxV,samplesPerPixel:samplesPerPixel
    },
    wl:{center:wc,width:ww},
    pxSpaceX:psx,pxSpaceY:psy,
    /* Sort key priority: ImagePositionPatient Z > SliceLocation > InstanceNumber */
    sortKey:zPos!==null?zPos:(sliceLoc||instanceNum),
    zPos:zPos,
    sliceLoc:sliceLoc,
    instanceNum:instanceNum,
    sliceThickness:sliceThickness,
    meta:{
      patientName:patName,studyDate:studyDate,modality:modality,
      rows:rows,columns:cols,pixelSpacing:psStr||'N/A',
      windowCenter:Math.round(wc),windowWidth:Math.round(ww),
      frames:1,bitsAllocated:bitsAlloc,sliceThickness:sliceThickness
    }
  };
}

/* ── Single DICOM load ── */
function loadDicom(base64){
  try{
    loadingEl.className='';
    loadText.textContent='Parsing DICOM...';
    var bytes=base64ToBytes(base64);
    var parsed=parseSingleDicom(bytes);
    if(!parsed) throw new Error('Could not parse DICOM file. The file may be corrupted or not a valid DICOM.');
    series=[parsed];
    seriesGroups={};
    activeGroupName='';
    currentSlice=0;
    activateSlice(0);
    loadingEl.className='hidden';
  }catch(e){
    loadText.textContent='Error: '+e.message;
    sendMsg('error',{message:e.message});
  }
}

/* ── Load DICOM from ArrayBuffer (web path - no base64) ── */
function loadDicomFromBuffer(buffer){
  try{
    loadingEl.className='';
    loadText.textContent='Parsing DICOM...';
    var bytes=new Uint8Array(buffer);
    var parsed=parseSingleDicom(bytes);
    if(!parsed) throw new Error('Could not parse DICOM file.');
    series=[parsed];
    seriesGroups={};
    activeGroupName='';
    currentSlice=0;
    activateSlice(0);
    loadingEl.className='hidden';
  }catch(e){
    loadText.textContent='Error: '+e.message;
    sendMsg('error',{message:e.message});
  }
}

/* ── Load ZIP from ArrayBuffer (web path - no base64) ── */
function loadZipFromBuffer(buffer){
  loadingEl.className='';
  loadText.textContent='Extracting ZIP...';
  showProgress('Extracting ZIP...',0);

  JSZip.loadAsync(buffer).then(function(zip){
    processZipContents(zip);
  }).catch(function(e){
    hideProgress();
    loadText.textContent='Error reading ZIP: '+e.message;
    sendMsg('error',{message:'ZIP error: '+e.message});
  });
}

/* ── Activate slice ── */
function activateSlice(idx){
  if(idx<0||idx>=series.length) return;
  currentSlice=idx;
  var s=series[idx];
  img=s.imgData;
  wl={center:s.wl.center,width:s.wl.width};
  pxSpaceX=s.pxSpaceX;
  pxSpaceY=s.pxSpaceY;

  if(series.length===1){
    vp={zoom:1,panX:0,panY:0,rotation:0,inverted:false};
    measurePts=[];allMeasures=[];
  }

  fitToScreen();
  renderWindowed();
  drawFrame();
  updateSliceInfo();

  var meta=Object.assign({},s.meta);
  meta.frames=series.length;
  meta.currentFrame=idx+1;
  meta.windowCenter=Math.round(wl.center);
  meta.windowWidth=Math.round(wl.width);
  sendMsg('metadata',meta);
  var region=getSliceRegion(idx);
  sendMsg('seriesInfo',{total:series.length,current:idx,region:region.region,regionLabel:region.label});
}

function updateSliceInfo(){
  if(series.length>1){
    sliceInfoEl.textContent='Slice '+(currentSlice+1)+' / '+series.length;
    sliceInfoEl.className='';
  }else{
    sliceInfoEl.className='hidden';
  }
}

/* ── ZIP loading with progressive parsing ── */
function loadZip(base64){
  loadingEl.className='';
  loadText.textContent='Extracting ZIP...';
  showProgress('Extracting ZIP...',0);

  JSZip.loadAsync(base64, {base64: true}).then(function(zip){
    processZipContents(zip);
  }).catch(function(e){
    hideProgress();
    loadText.textContent='Error reading ZIP: '+e.message;
    sendMsg('error',{message:'ZIP error: '+e.message});
  });
}

/* ── Shared ZIP processing (used by both loadZip and loadZipFromBuffer) ── */
function processZipContents(zip){
    var dcmFiles=[];
    zip.forEach(function(path,entry){
      if(entry.dir) return;
      var lower=path.toLowerCase();
      var baseName=lower.split('/').pop()||'';
      if(baseName.startsWith('__')||baseName.startsWith('.')) return;
      if(lower.endsWith('.dcm')||lower.endsWith('.dicom')||
         (!baseName.includes('.'))){
        dcmFiles.push({path:path,entry:entry});
      }
    });

    if(dcmFiles.length===0){
      hideProgress();
      loadText.textContent='No DICOM files found in ZIP';
      sendMsg('error',{message:'No DICOM files found in ZIP archive'});
      return;
    }

    /* Sort files by natural numeric order for consistent slice ordering */
    dcmFiles.sort(function(a,b){ return naturalCompare(a.path,b.path); });

    showProgress('Found '+dcmFiles.length+' files...',5,'Parsing slices...');

    /* Group files by directory for series detection */
    var groups={};
    for(var g=0;g<dcmFiles.length;g++){
      var dir=dcmFiles[g].path.replace(/\\/[^\\/]*$/,'');
      /* Files in root of zip get the top-level folder name or 'Original' */
      var slashIdx=dir.indexOf('/');
      if(slashIdx===-1) dir='Original';
      else{
        var afterFirst=dir.substring(slashIdx+1);
        dir=afterFirst||'Original';
      }
      if(!groups[dir]) groups[dir]=[];
      groups[dir].push(dcmFiles[g]);
    }

    var groupNames=Object.keys(groups);
    /* Rename 'Original' group if it's the only root folder */
    if(groupNames.length>=2){
      /* If we have 'Original' and subdirs like 'VOL_MAR', label nicely */
      for(var gi=0;gi<groupNames.length;gi++){
        if(groupNames[gi]==='Original') groupNames[gi]='Original';
        else if(groupNames[gi].toUpperCase().indexOf('MAR')>=0) groupNames[gi]=groupNames[gi];
      }
    }

    /* Parse all groups progressively */
    var allGroupsParsed={};
    var totalFiles=dcmFiles.length;
    var totalDone=0;
    var firstSliceShown=false;

    function parseGroup(gIdx){
      if(gIdx>=groupNames.length){
        finalizeAllGroups(allGroupsParsed,groupNames);
        return;
      }
      var gName=groupNames[gIdx];
      var gFiles=groups[gName];
      var gParsed=[];

      function parseNext(fIdx){
        if(fIdx>=gFiles.length){
          allGroupsParsed[gName]=gParsed;
          setTimeout(function(){parseGroup(gIdx+1);},0);
          return;
        }

        gFiles[fIdx].entry.async('uint8array').then(function(data){
          try{
            var result=parseSingleDicom(data);
            if(result){
              result.fileName=gFiles[fIdx].path;
              gParsed.push(result);

              /* Show first slice immediately */
              if(!firstSliceShown&&gIdx===0&&gParsed.length===1){
                firstSliceShown=true;
                series=[result];
                currentSlice=0;
                vp={zoom:1,panX:0,panY:0,rotation:0,inverted:false};
                measurePts=[];allMeasures=[];
                loadingEl.className='hidden';
                activateSlice(0);
              }
            }
          }catch(e){}
          totalDone++;
          var pct=5+Math.round((totalDone/totalFiles)*90);
          showProgress('Parsing '+(totalDone)+'/'+totalFiles,pct,gName+' · '+(fIdx+1)+'/'+gFiles.length);

          /* Parse in batches to keep UI responsive */
          if(fIdx%5===4){
            setTimeout(function(){parseNext(fIdx+1);},0);
          }else{
            parseNext(fIdx+1);
          }
        }).catch(function(){
          totalDone++;
          parseNext(fIdx+1);
        });
      }
      parseNext(0);
    }
    parseGroup(0);
}

/* ── Finalize all series groups ── */
function finalizeAllGroups(allGroupsParsed,groupNames){
  hideProgress();

  /* Sort each group by ImagePositionPatient Z (primary), then SliceLocation, then filename */
  for(var g=0;g<groupNames.length;g++){
    var parsed=allGroupsParsed[groupNames[g]];
    parsed.sort(function(a,b){
      /* Primary: sortKey (IPP Z > SliceLocation > InstanceNumber) */
      if(a.sortKey!==b.sortKey) return a.sortKey-b.sortKey;
      /* Fallback: filename natural sort */
      if(a.fileName&&b.fileName) return naturalCompare(a.fileName,b.fileName);
      return 0;
    });
  }

  seriesGroups=allGroupsParsed;

  /* Default to first group (Original) */
  var defaultGroup=groupNames[0];
  activeGroupName=defaultGroup;
  series=seriesGroups[defaultGroup]||[];

  if(series.length===0){
    loadText.textContent='No valid DICOM images found';
    sendMsg('error',{message:'No valid DICOM images found'});
    return;
  }

  /* Reset viewport */
  vp={zoom:1,panX:0,panY:0,rotation:0,inverted:false};
  measurePts=[];allMeasures=[];

  /* Build 3D volume from all slices */
  buildVolume();

  loadingEl.className='hidden';

  /* Navigate to middle slice for CBCT */
  viewMode='axial';
  var midSlice=Math.floor(series.length/2);
  activateSlice(midSlice);

  /* Send series info */
  sendMsg('seriesLoaded',{count:series.length});
  sendMsg('volumeReady',{slices:volSlices,rows:volRows,cols:volCols,hasVolume:volume!==null});

  /* Send group info for series selector */
  if(groupNames.length>1){
    var groupInfo=[];
    for(var i=0;i<groupNames.length;i++){
      groupInfo.push({
        name:groupNames[i],
        count:(allGroupsParsed[groupNames[i]]||[]).length,
        active:groupNames[i]===defaultGroup
      });
    }
    sendMsg('seriesGroups',{groups:groupInfo,active:defaultGroup});
  }
}

/* ── Build 3D Volume metadata from parsed slices (no data copy) ── */
function buildVolume(){
  if(!series.length) return;
  var first=series[0].imgData;
  volCols=first.columns;
  volRows=first.rows;
  volSlices=series.length;
  volSlope=first.rescaleSlope;
  volIntercept=first.rescaleIntercept;
  volWL={center:series[Math.floor(series.length/2)].wl.center,width:series[Math.floor(series.length/2)].wl.width};

  /* Estimate memory usage */
  var bytesPerPixel=(first.bitsAllocated||16)/8;
  var sliceBytes=volCols*volRows*bytesPerPixel;
  var totalMB=Math.round((sliceBytes*volSlices)/(1024*1024));
  if(totalMB>400 && !memoryWarned){
    memoryWarned=true;
    sendMsg('memoryWarning',{totalMB:totalMB,slices:volSlices,suggestion:'Large volume ('+totalMB+'MB). Performance may be limited on this device.'});
  }

  /* Check all slices have same dimensions */
  for(var i=1;i<series.length;i++){
    if(series[i].imgData.columns!==volCols||series[i].imgData.rows!==volRows){
      volume=null;
      return; /* Mixed dimensions - can't build volume */
    }
  }

  /* No data copy — MPR functions read from series[z].imgData.pixelData directly */
  volume=true;  /* flag that volume is available */
  panoCache=null; /* invalidate panoramic cache */
  hideProgress();
}

/* ── Read a voxel from the series (no separate volume array) ── */
function getVoxel(x,y,z){
  if(z<0||z>=volSlices||y<0||y>=volRows||x<0||x>=volCols) return 0;
  return series[z].imgData.pixelData[y*volCols+x]||0;
}

/* ── MPR Reconstruction ── */
function reconstructCoronal(yPos){
  if(!volume) return null;
  /* Coronal: fixed Y, varies X and Z → image is cols × slices */
  var width=volCols;
  var height=volSlices;
  var pixelData=new Int16Array(width*height);
  var y=Math.max(0,Math.min(volRows-1,yPos));
  for(var z=0;z<height;z++){
    var slicePx=series[z].imgData.pixelData;
    var rowOff=y*volCols;
    for(var x=0;x<width;x++){
      pixelData[z*width+x]=slicePx[rowOff+x]||0;
    }
  }
  return {pixelData:pixelData,rows:height,columns:width,
    bitsAllocated:16,bitsStored:16,pixelRep:1,photometric:'MONOCHROME2',
    rescaleSlope:volSlope,rescaleIntercept:volIntercept,
    minVal:-1000,maxVal:3000,samplesPerPixel:1};
}

function reconstructSagittal(xPos){
  if(!volume) return null;
  /* Sagittal: fixed X, varies Y and Z → image is rows × slices */
  var width=volRows;
  var height=volSlices;
  var pixelData=new Int16Array(width*height);
  var x=Math.max(0,Math.min(volCols-1,xPos));
  for(var z=0;z<height;z++){
    var slicePx=series[z].imgData.pixelData;
    for(var y=0;y<width;y++){
      pixelData[z*width+y]=slicePx[y*volCols+x]||0;
    }
  }
  return {pixelData:pixelData,rows:height,columns:width,
    bitsAllocated:16,bitsStored:16,pixelRep:1,photometric:'MONOCHROME2',
    rescaleSlope:volSlope,rescaleIntercept:volIntercept,
    minVal:-1000,maxVal:3000,samplesPerPixel:1};
}

function reconstructPanoramic(){
  if(!volume) return null;
  /* Return cached version if available */
  if(panoCache) return panoCache;

  /* Panoramic: curved planar reformation along dental arch.
   * Step 1: Auto-detect arch center from a mid-axial slice
   * Step 2: Fit a smooth U-shaped curve to the high-density region
   * Step 3: Sample along the curve through all Z slices */

  /* Find arch parameters from mid-slice intensity distribution */
  var midZ=Math.floor(volSlices*0.45); /* crown level */
  var midSlice=series[midZ].imgData.pixelData;
  var slope=series[midZ].imgData.rescaleSlope||1;
  var intercept=series[midZ].imgData.rescaleIntercept||0;

  /* Compute row and column intensity profiles to find arch center */
  var colProfile=new Float32Array(volCols);
  var rowProfile=new Float32Array(volRows);
  for(var y=0;y<volRows;y++){
    for(var x=0;x<volCols;x++){
      var val=(midSlice[y*volCols+x]||0)*slope+intercept;
      if(val>200){ /* threshold above soft tissue */
        colProfile[x]+=val;
        rowProfile[y]+=val;
      }
    }
  }

  /* Find center of mass for X (arch center horizontal) */
  var sumX=0,weightX=0;
  for(var x=0;x<volCols;x++){sumX+=x*colProfile[x];weightX+=colProfile[x];}
  var cx=weightX>0?Math.round(sumX/weightX):Math.floor(volCols/2);

  /* Find center of mass for Y (arch center vertical — biased posterior) */
  var sumY=0,weightY=0;
  for(var y=Math.floor(volRows*0.3);y<Math.floor(volRows*0.8);y++){
    sumY+=y*rowProfile[y];weightY+=rowProfile[y];
  }
  var cy=weightY>0?Math.round(sumY/weightY):Math.floor(volRows*0.55);

  /* Estimate arch extent from high-intensity spread */
  var leftX=cx,rightX=cx;
  var threshold=weightX>0?(weightX/volCols)*0.15:0;
  for(var x=cx;x>=0;x--){if(colProfile[x]>threshold)leftX=x;else break;}
  for(var x=cx;x<volCols;x++){if(colProfile[x]>threshold)rightX=x;else break;}
  var archWidth=Math.max(Math.floor(volCols*0.25),Math.floor((rightX-leftX)*0.55));
  var archDepth=Math.max(Math.floor(volRows*0.15),Math.floor(archWidth*0.5));

  var numSamples=Math.floor(volCols*0.85);
  var panoWidth=numSamples;
  var panoHeight=volSlices;
  var pixelData=new Int16Array(panoWidth*panoHeight);

  /* Generate smooth arch curve — elliptical U-shape */
  var curvePoints=[];
  for(var i=0;i<numSamples;i++){
    var t=(i/numSamples)-0.5; /* -0.5 to 0.5 */
    var px=cx+Math.floor(t*2*archWidth);
    /* Elliptical shape: deeper on sides, flatter in front */
    var py=cy-Math.floor(archDepth*(1-4*t*t));
    px=Math.max(0,Math.min(volCols-1,px));
    py=Math.max(0,Math.min(volRows-1,py));
    curvePoints.push({x:px,y:py});
  }

  /* Sample perpendicular band along the curve for each Z */
  var thickness=9; /* wider band for better MIP-like effect */
  var halfT=Math.floor(thickness/2);
  for(var z=0;z<panoHeight;z++){
    var slicePx=series[z].imgData.pixelData;
    for(var s=0;s<panoWidth;s++){
      var cp=curvePoints[s];
      /* Use maximum intensity projection across the band instead of average */
      var maxVal=-99999;
      for(var d=-halfT;d<=halfT;d++){
        var sy=cp.y+d;
        if(sy>=0&&sy<volRows){
          var v=slicePx[sy*volCols+cp.x]||0;
          if(v>maxVal) maxVal=v;
        }
      }
      pixelData[z*panoWidth+s]=maxVal>-99999?maxVal:0;
    }
  }

  var result={pixelData:pixelData,rows:panoHeight,columns:panoWidth,
    bitsAllocated:16,bitsStored:16,pixelRep:1,photometric:'MONOCHROME2',
    rescaleSlope:volSlope,rescaleIntercept:volIntercept,
    minVal:-1000,maxVal:3000,samplesPerPixel:1};

  panoCache=result; /* Cache for instant re-access */
  return result;
}

/* ── Set View Mode ── */
function setViewMode(mode){
  if(!volume&&mode!=='axial'){
    sendMsg('error',{message:'Volume not available. Cannot switch to '+mode+' view.'});
    return;
  }
  viewMode=mode;
  vp={zoom:1,panX:0,panY:0,rotation:0,inverted:false};
  measurePts=[];allMeasures=[];

  if(mode==='axial'){
    mprTotal=series.length;
    mprSlice=Math.floor(mprTotal/2);
    activateSlice(mprSlice);
    sendMsg('viewModeChanged',{mode:'axial',total:mprTotal,current:mprSlice});
  }else if(mode==='coronal'){
    mprTotal=volRows;
    mprSlice=Math.floor(volRows/2);
    activateMPR();
    sendMsg('viewModeChanged',{mode:'coronal',total:mprTotal,current:mprSlice});
  }else if(mode==='sagittal'){
    mprTotal=volCols;
    mprSlice=Math.floor(volCols/2);
    activateMPR();
    sendMsg('viewModeChanged',{mode:'sagittal',total:mprTotal,current:mprSlice});
  }else if(mode==='panoramic'){
    mprTotal=1;  /* panoramic is a single reconstructed image */
    mprSlice=0;
    activateMPR();
    sendMsg('viewModeChanged',{mode:'panoramic',total:1,current:0});
  }
}

function activateMPR(){
  var reconstructed=null;
  if(viewMode==='coronal'){
    reconstructed=reconstructCoronal(mprSlice);
  }else if(viewMode==='sagittal'){
    reconstructed=reconstructSagittal(mprSlice);
  }else if(viewMode==='panoramic'){
    reconstructed=reconstructPanoramic();
  }
  if(!reconstructed){
    sendMsg('error',{message:'Could not reconstruct '+viewMode+' view'});
    return;
  }
  img=reconstructed;
  wl={center:volWL.center,width:volWL.width};
  fitToScreen();
  renderWindowed();
  drawFrame();
  updateSliceInfo();
  var region=getSliceRegion(viewMode==='axial'?currentSlice:mprSlice);
  sendMsg('seriesInfo',{total:mprTotal,current:mprSlice,region:region.region,regionLabel:region.label,viewMode:viewMode});
}

function navigateMPR(delta){
  if(viewMode==='panoramic') return;  /* panoramic has only 1 view */
  mprSlice=Math.max(0,Math.min(mprTotal-1,mprSlice+delta));
  activateMPR();
}

/* ── Switch between series groups ── */
function switchSeries(groupName){
  if(!seriesGroups[groupName]||groupName===activeGroupName) return;
  activeGroupName=groupName;
  series=seriesGroups[groupName];

  /* Keep same relative slice position */
  var relPos=series.length>1?currentSlice/Math.max(1,series.length-1):0;
  var newIdx=Math.min(Math.round(relPos*(series.length-1)),series.length-1);

  vp={zoom:1,panX:0,panY:0,rotation:0,inverted:false};
  measurePts=[];allMeasures=[];
  activateSlice(Math.max(0,newIdx));

  sendMsg('seriesLoaded',{count:series.length});

  /* Update group active states */
  var groupNames=Object.keys(seriesGroups);
  var groupInfo=[];
  for(var i=0;i<groupNames.length;i++){
    groupInfo.push({
      name:groupNames[i],
      count:seriesGroups[groupNames[i]].length,
      active:groupNames[i]===groupName
    });
  }
  sendMsg('seriesGroups',{groups:groupInfo,active:groupName});
}

/* ── Multi-DICOM loading ── */
var _multiChunkBuffer=[];

function loadMultiDicom(base64Array){
  loadingEl.className='';
  loadText.textContent='Parsing files...';
  showProgress('Parsing DICOM files...',0);

  var parsed=[];
  var total=base64Array.length;
  var firstShown=false;

  function parseNext(i){
    if(i>=total){
      finalizeSeries(parsed);
      return;
    }
    try{
      var bytes=base64ToBytes(base64Array[i].data);
      var result=parseSingleDicom(bytes);
      if(result){
        result.fileName=base64Array[i].name;
        parsed.push(result);

        /* Show first slice immediately */
        if(!firstShown){
          firstShown=true;
          series=[result];
          currentSlice=0;
          vp={zoom:1,panX:0,panY:0,rotation:0,inverted:false};
          measurePts=[];allMeasures=[];
          loadingEl.className='hidden';
          activateSlice(0);
        }
      }
    }catch(e){}
    var pct=Math.round(((i+1)/total)*90);
    showProgress('Parsing '+(i+1)+'/'+total+'...',pct);
    if(i%5===4){
      setTimeout(function(){parseNext(i+1);},0);
    }else{
      parseNext(i+1);
    }
  }
  parseNext(0);
}

function loadMultiDicomChunk(base64,name){
  _multiChunkBuffer.push({data:base64,name:name});
  loadingEl.className='';
  loadText.textContent='Receiving file '+_multiChunkBuffer.length+'...';
}

function loadMultiDicomFinalize(){
  if(_multiChunkBuffer.length===0){
    sendMsg('error',{message:'No files received'});
    return;
  }
  var files=_multiChunkBuffer.slice();
  _multiChunkBuffer=[];
  loadMultiDicom(files);
}

/* ── Finalize flat series (non-ZIP multi) ── */
function finalizeSeries(parsed){
  if(parsed.length===0){
    hideProgress();
    loadText.textContent='No valid DICOM images found';
    sendMsg('error',{message:'No valid DICOM images found'});
    return;
  }

  showProgress('Sorting '+parsed.length+' slices...',95);

  parsed.sort(function(a,b){\n    /* Primary: sortKey (IPP Z > SliceLocation > InstanceNumber) */\n    if(a.sortKey!==b.sortKey) return a.sortKey-b.sortKey;\n    /* Fallback: filename natural sort */\n    if(a.fileName&&b.fileName) return naturalCompare(a.fileName,b.fileName);\n    return 0;\n  });

  series=parsed;
  seriesGroups={};
  activeGroupName='';
  currentSlice=0;
  vp={zoom:1,panX:0,panY:0,rotation:0,inverted:false};
  measurePts=[];allMeasures=[];

  hideProgress();
  loadingEl.className='hidden';

  /* Navigate to middle slice for CBCT volumes */
  var midSlice=series.length>10?Math.floor(series.length/2):0;

  /* Build 3D volume for MPR views */
  buildVolume();
  viewMode='axial';

  activateSlice(midSlice);

  sendMsg('seriesLoaded',{count:series.length});
  sendMsg('volumeReady',{slices:volSlices,rows:volRows,cols:volCols,hasVolume:volume!==null});
}

/* ── Viewport helpers ── */
function fitToScreen(){
  if(!img)return;
  var scaleX=canvas.width/img.columns;
  var scaleY=canvas.height/img.rows;
  vp.zoom=Math.min(scaleX,scaleY)*0.92;
  vp.panX=0;vp.panY=0;
}

/* ── Demo ── */
function loadDemo(){
  loadingEl.className='';
  loadText.textContent='Generating demo...';
  var w=512,h=400;
  var slices=[];

  for(var s=0;s<12;s++){
    var data=new Int16Array(w*h);
    var sliceOffset=s*3-18;

    for(var y=0;y<h;y++){
      for(var x=0;x<w;x++){
        var idx=y*w+x;
        var val=150;
        var ex=(x-w/2)/(w*0.38);
        var ey=(y-h*0.45)/(h*0.42);
        var ed=ex*ex+ey*ey;
        if(ed<1) val+=350*(1-ed)*(1+sliceOffset*0.02);
        var jx=(x-w/2)/(w*0.32);
        var jy=(y-h*0.58)/(h*0.07);
        var jd=jx*jx+jy*jy;
        if(jd<1) val+=250*(1-jd);
        for(var t=-7;t<=7;t++){
          if(t===0)continue;
          var tx=w/2+t*17;
          var ty=h*0.46+Math.abs(t)*1.2;
          var tdx=(x-tx);var tdy=(y-ty);
          var toothSize=100+sliceOffset*3;
          var td=Math.sqrt(tdx*tdx/Math.max(30,toothSize)+tdy*tdy/225);
          if(td<1) val+=650*(1-td*td)*(0.8+s*0.03);
        }
        for(var t=-7;t<=7;t++){
          if(t===0)continue;
          var tx=w/2+t*16;
          var ty=h*0.59+Math.abs(t)*1.5;
          var tdx=(x-tx);var tdy=(y-ty);
          var toothSize=90+sliceOffset*2;
          var td=Math.sqrt(tdx*tdx/Math.max(30,toothSize)+tdy*tdy/200);
          if(td<1) val+=600*(1-td*td)*(0.8+s*0.03);
        }
        val+=(Math.random()-0.5)*40;
        data[idx]=Math.max(0,Math.min(2000,Math.round(val)));
      }
    }

    slices.push({
      imgData:{
        pixelData:data,rows:h,columns:w,
        bitsAllocated:16,bitsStored:12,pixelRep:0,
        photometric:'MONOCHROME2',
        rescaleSlope:1,rescaleIntercept:0,
        minVal:0,maxVal:2000,samplesPerPixel:1
      },
      wl:{center:700,width:1400},
      pxSpaceX:0.3,pxSpaceY:0.3,
      sortKey:s,instanceNum:s+1,
      fileName:'demo_slice_'+(s+1)+'.dcm',
      meta:{
        patientName:'DEMO, Patient',studyDate:'20240115',modality:'CT',
        rows:h,columns:w,pixelSpacing:'0.3 / 0.3 mm',
        windowCenter:700,windowWidth:1400,frames:12,bitsAllocated:16
      }
    });
  }

  series=slices;
  seriesGroups={};
  activeGroupName='';
  currentSlice=0;
  vp={zoom:1,panX:0,panY:0,rotation:0,inverted:false};
  measurePts=[];allMeasures=[];

  loadingEl.className='hidden';

  /* Build 3D volume for MPR views */
  buildVolume();
  viewMode='axial';

  activateSlice(0);
  sendMsg('seriesLoaded',{count:series.length});
  sendMsg('volumeReady',{slices:volSlices,rows:volRows,cols:volCols,hasVolume:volume!==null});
}

/* ── Rendering ── */
function renderWindowed(){
  if(!img)return;
  offCanvas.width=img.columns;
  offCanvas.height=img.rows;
  var idata=offCtx.createImageData(img.columns,img.rows);
  var frameSize=img.rows*img.columns;
  var lower=wl.center-wl.width/2;
  var range=Math.max(1,wl.width);
  var isMono1=img.photometric==='MONOCHROME1';
  var inv=vp.inverted;
  var slope=img.rescaleSlope;
  var intercept=img.rescaleIntercept;
  var spp=img.samplesPerPixel;
  if(spp===1){
    for(var i=0;i<frameSize;i++){
      var raw=img.pixelData[i];
      var val=raw*slope+intercept;
      var gray;
      if(val<=lower)gray=0;
      else if(val>=lower+range)gray=255;
      else gray=((val-lower)/range)*255;
      if(isMono1)gray=255-gray;
      if(inv)gray=255-gray;
      var p=i*4;
      idata.data[p]=gray;idata.data[p+1]=gray;idata.data[p+2]=gray;idata.data[p+3]=255;
    }
  }else{
    for(var i=0;i<frameSize;i++){
      var base=i*spp;
      var p=i*4;
      idata.data[p]=img.pixelData[base]||0;
      idata.data[p+1]=img.pixelData[base+1]||0;
      idata.data[p+2]=img.pixelData[base+2]||0;
      idata.data[p+3]=255;
    }
  }
  offCtx.putImageData(idata,0,0);
}

function drawFrame(){
  if(!img)return;
  ctx.fillStyle='#09090b';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.save();
  ctx.translate(canvas.width/2+vp.panX,canvas.height/2+vp.panY);
  ctx.rotate(vp.rotation*Math.PI/180);
  ctx.scale(vp.zoom,vp.zoom);
  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality='high';
  ctx.drawImage(offCanvas,-img.columns/2,-img.rows/2);
  ctx.restore();
  drawMeasurements();
}

/* ── Measurements ── */
function drawMeasurements(){
  for(var m=0;m<allMeasures.length;m++){
    var ms=allMeasures[m];
    var p1=imageToScreen(ms.x1,ms.y1);
    var p2=imageToScreen(ms.x2,ms.y2);
    drawMLine(p1,p2,ms.distance);
  }
  if(measurePts.length===1){
    var sp=imageToScreen(measurePts[0].x,measurePts[0].y);
    ctx.fillStyle='#06b6d4';
    ctx.beginPath();ctx.arc(sp.x,sp.y,7,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
  }
}

function drawMLine(p1,p2,dist){
  ctx.strokeStyle='#06b6d4';ctx.lineWidth=2.5;
  ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.stroke();
  ctx.fillStyle='#06b6d4';
  [p1,p2].forEach(function(p){
    ctx.beginPath();ctx.arc(p.x,p.y,6,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#ffffff';ctx.lineWidth=1.5;ctx.stroke();
  });
  var mx=(p1.x+p2.x)/2;
  var my=(p1.y+p2.y)/2-14;
  ctx.font='bold 13px -apple-system,BlinkMacSystemFont,sans-serif';
  ctx.textAlign='center';ctx.textBaseline='middle';
  var txt=dist+' mm';
  var tw=ctx.measureText(txt).width;
  ctx.fillStyle='rgba(9,9,11,0.85)';
  ctx.beginPath();
  roundRect(ctx,mx-tw/2-8,my-11,tw+16,22,6);
  ctx.fill();
  ctx.strokeStyle='#06b6d4';ctx.lineWidth=1;ctx.stroke();
  ctx.fillStyle='#22d3ee';
  ctx.fillText(txt,mx,my);
}

function roundRect(c,x,y,w,h,r){
  c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);
  c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);
  c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);
}

/* ── Coordinate transforms ── */
function screenToImage(sx,sy){
  var cx=canvas.width/2+vp.panX;var cy=canvas.height/2+vp.panY;
  var dx=sx-cx;var dy=sy-cy;
  var rad=-vp.rotation*Math.PI/180;
  var rx=dx*Math.cos(rad)-dy*Math.sin(rad);
  var ry=dx*Math.sin(rad)+dy*Math.cos(rad);
  return{x:rx/vp.zoom+img.columns/2,y:ry/vp.zoom+img.rows/2};
}
function imageToScreen(ix,iy){
  var dx=(ix-img.columns/2)*vp.zoom;var dy=(iy-img.rows/2)*vp.zoom;
  var rad=vp.rotation*Math.PI/180;
  var rx=dx*Math.cos(rad)-dy*Math.sin(rad);
  var ry=dx*Math.sin(rad)+dy*Math.cos(rad);
  return{x:rx+canvas.width/2+vp.panX,y:ry+canvas.height/2+vp.panY};
}

/* ── Touch / Mouse Input ── */
var touchState={active:false,lastX:0,lastY:0,lastDist:0,isPinch:false,startTime:0,startX:0,startY:0};

function setupInput(){
  canvas.addEventListener('touchstart',onTouchStart,{passive:false});
  canvas.addEventListener('touchmove',onTouchMove,{passive:false});
  canvas.addEventListener('touchend',onTouchEnd,{passive:false});
  canvas.addEventListener('mousedown',onMouseDown);
  canvas.addEventListener('mousemove',onMouseMove);
  canvas.addEventListener('mouseup',onMouseUp);
  canvas.addEventListener('wheel',onWheel,{passive:false});
}

function onTouchStart(e){
  e.preventDefault();if(!img)return;
  if(e.touches.length===2){
    var dx=e.touches[0].clientX-e.touches[1].clientX;
    var dy=e.touches[0].clientY-e.touches[1].clientY;
    touchState.lastDist=Math.sqrt(dx*dx+dy*dy);
    touchState.isPinch=true;return;
  }
  touchState.active=true;touchState.isPinch=false;
  touchState.lastX=e.touches[0].clientX;touchState.lastY=e.touches[0].clientY;
  touchState.startX=e.touches[0].clientX;touchState.startY=e.touches[0].clientY;
  touchState.startTime=Date.now();
}

function onTouchMove(e){
  e.preventDefault();if(!img)return;
  if(e.touches.length===2){
    var dx=e.touches[0].clientX-e.touches[1].clientX;
    var dy=e.touches[0].clientY-e.touches[1].clientY;
    var dist=Math.sqrt(dx*dx+dy*dy);
    if(touchState.lastDist>0){
      var scale=dist/touchState.lastDist;
      vp.zoom=Math.max(0.1,Math.min(30,vp.zoom*scale));
      drawFrame();sendMsg('viewportUpdate',{zoom:vp.zoom.toFixed(2)});
    }
    touchState.lastDist=dist;touchState.isPinch=true;return;
  }
  if(!touchState.active||e.touches.length!==1)return;
  var cx=e.touches[0].clientX;var cy=e.touches[0].clientY;
  var ddx=cx-touchState.lastX;var ddy=cy-touchState.lastY;
  handleDrag(ddx,ddy);
  touchState.lastX=cx;touchState.lastY=cy;
}

function onTouchEnd(e){
  if(!img)return;
  if(!touchState.isPinch&&touchState.active){
    var elapsed=Date.now()-touchState.startTime;
    var movedX=Math.abs(touchState.lastX-touchState.startX);
    var movedY=Math.abs(touchState.lastY-touchState.startY);
    if(elapsed<300&&movedX<10&&movedY<10&&activeTool==='measure'){
      var pt=screenToImage(touchState.lastX,touchState.lastY);
      addMeasurePoint(pt);
    }
  }
  touchState.active=false;touchState.isPinch=false;touchState.lastDist=0;
}

var mouseState={active:false,lastX:0,lastY:0};
function onMouseDown(e){
  if(!img)return;mouseState.active=true;
  mouseState.lastX=e.clientX;mouseState.lastY=e.clientY;
  if(activeTool==='measure'){var pt=screenToImage(e.clientX,e.clientY);addMeasurePoint(pt);}
}
function onMouseMove(e){
  if(!img||!mouseState.active)return;
  var ddx=e.clientX-mouseState.lastX;var ddy=e.clientY-mouseState.lastY;
  if(activeTool!=='measure') handleDrag(ddx,ddy);
  mouseState.lastX=e.clientX;mouseState.lastY=e.clientY;
}
function onMouseUp(){mouseState.active=false;}

function onWheel(e){
  e.preventDefault();if(!img)return;
  if(activeTool==='scroll'){
    var dir=e.deltaY>0?1:-1;
    if(viewMode==='axial'&&series.length>1){
      var next=currentSlice+dir;
      if(next>=0&&next<series.length){activateSlice(next);}
    }else if(viewMode!=='axial'&&viewMode!=='panoramic'){
      navigateMPR(dir);
    }
    return;
  }
  var delta=e.deltaY>0?0.92:1.08;
  vp.zoom=Math.max(0.1,Math.min(30,vp.zoom*delta));
  drawFrame();sendMsg('viewportUpdate',{zoom:vp.zoom.toFixed(2)});
}

function handleDrag(dx,dy){
  if(activeTool==='pan'){
    vp.panX+=dx;vp.panY+=dy;drawFrame();
  }else if(activeTool==='zoom'){
    vp.zoom=Math.max(0.1,Math.min(30,vp.zoom*(1-dy*0.005)));
    drawFrame();sendMsg('viewportUpdate',{zoom:vp.zoom.toFixed(2)});
  }else if(activeTool==='wl'){
    wl.width=Math.max(1,wl.width+dx*3);
    wl.center=wl.center-dy*3;
    renderWindowed();drawFrame();
    sendMsg('wlUpdate',{center:Math.round(wl.center),width:Math.round(wl.width)});
  }else if(activeTool==='scroll'){
    if(viewMode==='axial'&&series.length>1){
      var sensitivity=Math.max(1,Math.round(series.length/canvas.height*2));
      var sliceDelta=Math.round(dy*sensitivity*0.1);
      if(Math.abs(sliceDelta)>=1){
        var next=Math.max(0,Math.min(series.length-1,currentSlice+sliceDelta));
        if(next!==currentSlice) activateSlice(next);
      }
    }else if(viewMode!=='axial'&&viewMode!=='panoramic'){
      var mprSensitivity=Math.max(1,Math.round(mprTotal/canvas.height*2));
      var mprDelta=Math.round(dy*mprSensitivity*0.1);
      if(Math.abs(mprDelta)>=1){
        navigateMPR(mprDelta);
      }
    }
  }
}

/* ── Measurement ── */
function addMeasurePoint(pt){
  if(!img)return;
  if(pt.x<0||pt.x>=img.columns||pt.y<0||pt.y>=img.rows)return;
  measurePts.push(pt);
  if(measurePts.length===2){
    var dx=(measurePts[1].x-measurePts[0].x)*pxSpaceX;
    var dy=(measurePts[1].y-measurePts[0].y)*pxSpaceY;
    var dist=Math.sqrt(dx*dx+dy*dy).toFixed(1);
    allMeasures.push({x1:measurePts[0].x,y1:measurePts[0].y,x2:measurePts[1].x,y2:measurePts[1].y,distance:dist});
    measurePts=[];
    sendMsg('measurement',{distance:dist,unit:'mm'});
  }
  drawFrame();
}

/* ── Command Handler ── */
function handleCommand(cmd){
  if(!cmd||!cmd.type)return;
  switch(cmd.type){
    case 'loadDicom':loadDicom(cmd.base64);break;
    case 'loadDemo':loadDemo();break;
    case 'loadZip':loadZip(cmd.base64);break;
    case 'loadMultiDicom':loadMultiDicom(cmd.files);break;
    case 'loadMultiDicomChunk':loadMultiDicomChunk(cmd.base64,cmd.name);break;
    case 'loadMultiDicomFinalize':loadMultiDicomFinalize();break;
    case 'switchSeries':switchSeries(cmd.group);break;
    case 'setTool':
      activeTool=cmd.tool;
      if(cmd.tool!=='measure'){measurePts=[];if(img)drawFrame();}
      sendMsg('toolChanged',{tool:cmd.tool});
      break;
    case 'windowPreset':
      if(!img)break;
      if(cmd.preset==='dental'){wl.center=1500;wl.width=3000;}
      else if(cmd.preset==='bone'){wl.center=500;wl.width=2500;}
      else if(cmd.preset==='soft'){wl.center=50;wl.width=400;}
      else if(cmd.preset==='full'){wl.center=(img.minVal+img.maxVal)/2;wl.width=Math.max(1,img.maxVal-img.minVal);}
      renderWindowed();drawFrame();
      sendMsg('wlUpdate',{center:Math.round(wl.center),width:Math.round(wl.width)});
      break;
    case 'rotate':vp.rotation=(vp.rotation+90)%360;drawFrame();break;
    case 'invert':
      vp.inverted=!vp.inverted;renderWindowed();drawFrame();
      sendMsg('invertUpdate',{inverted:vp.inverted});
      break;
    case 'reset':
      vp={zoom:1,panX:0,panY:0,rotation:0,inverted:false};
      measurePts=[];allMeasures=[];
      if(img){fitToScreen();renderWindowed();drawFrame();}
      sendMsg('resetDone',{});break;
    case 'setSlice':
      if(viewMode==='axial'){
        if(cmd.index>=0&&cmd.index<series.length) activateSlice(cmd.index);
      }else{
        mprSlice=Math.max(0,Math.min(mprTotal-1,cmd.index));
        activateMPR();
      }
      break;
    case 'nextSlice':
      if(viewMode==='axial'){
        if(currentSlice<series.length-1) activateSlice(currentSlice+1);
      }else{
        navigateMPR(1);
      }
      break;
    case 'prevSlice':
      if(viewMode==='axial'){
        if(currentSlice>0) activateSlice(currentSlice-1);
      }else{
        navigateMPR(-1);
      }
      break;
    case 'clearMeasurements':
      measurePts=[];allMeasures=[];if(img)drawFrame();break;
    case 'loadZipBuffer':loadZipFromBuffer(cmd.buffer);break;
    case 'loadDicomBuffer':loadDicomFromBuffer(cmd.buffer);break;
    case 'navigateToTooth':navigateToTooth(cmd.tooth);break;
    case 'getRegionInfo':sendSliceRegionInfo();break;
    case 'setViewMode':setViewMode(cmd.mode);break;
    case 'setMPRSlice':
      mprSlice=Math.max(0,Math.min(mprTotal-1,cmd.index));
      if(viewMode!=='axial') activateMPR();
      break;
    case 'exportView':
      exportCurrentView();
      break;
  }
}

/* ── Export Current View ── */
function exportCurrentView(){
  if(!img) return;
  /* Create a high-res export canvas with annotations */
  var exportCanvas=document.createElement('canvas');
  exportCanvas.width=canvas.width;
  exportCanvas.height=canvas.height;
  var ectx=exportCanvas.getContext('2d');

  /* Draw background */
  ectx.fillStyle='#09090b';
  ectx.fillRect(0,0,exportCanvas.width,exportCanvas.height);

  /* Draw image with current viewport transforms */
  ectx.save();
  ectx.translate(exportCanvas.width/2+vp.panX,exportCanvas.height/2+vp.panY);
  ectx.rotate(vp.rotation*Math.PI/180);
  ectx.scale(vp.zoom,vp.zoom);
  ectx.imageSmoothingEnabled=true;
  ectx.imageSmoothingQuality='high';
  ectx.drawImage(offCanvas,-img.columns/2,-img.rows/2);
  ectx.restore();

  /* Draw measurements */
  for(var m=0;m<allMeasures.length;m++){
    var ms=allMeasures[m];
    var p1=imageToScreen(ms.x1,ms.y1);
    var p2=imageToScreen(ms.x2,ms.y2);
    ectx.strokeStyle='#06b6d4';ectx.lineWidth=2.5;
    ectx.beginPath();ectx.moveTo(p1.x,p1.y);ectx.lineTo(p2.x,p2.y);ectx.stroke();
    ectx.fillStyle='#06b6d4';
    [p1,p2].forEach(function(p){
      ectx.beginPath();ectx.arc(p.x,p.y,6,0,Math.PI*2);ectx.fill();
    });
    var mx=(p1.x+p2.x)/2;var my=(p1.y+p2.y)/2-14;
    ectx.font='bold 13px -apple-system,BlinkMacSystemFont,sans-serif';
    ectx.textAlign='center';ectx.textBaseline='middle';
    ectx.fillStyle='#22d3ee';
    ectx.fillText(ms.distance+' mm',mx,my);
  }

  /* Add info overlay text at bottom */
  var infoText='DentView';
  if(series.length>1) infoText+=' · Slice '+(currentSlice+1)+'/'+series.length;
  if(viewMode!=='axial') infoText+=' · '+viewMode.charAt(0).toUpperCase()+viewMode.slice(1);
  infoText+=' · WC:'+Math.round(wl.center)+' WW:'+Math.round(wl.width);
  ectx.font='11px -apple-system,BlinkMacSystemFont,monospace';
  ectx.fillStyle='rgba(255,255,255,0.5)';
  ectx.textAlign='left';ectx.textBaseline='bottom';
  ectx.fillText(infoText,8,exportCanvas.height-8);

  var dataUrl=exportCanvas.toDataURL('image/png');
  sendMsg('exportedView',{dataUrl:dataUrl});
}

/* ── Tooth Navigation ── */
/*
 * FDI tooth numbering:
 *   Upper right: 18-11  |  Upper left: 21-28
 *   Lower right: 48-41  |  Lower left: 31-38
 *
 * CBCT axial slices go from top (slice 0 = top of skull) to bottom (slice N = chin).
 * We divide the volume into anatomical zones based on percentage:
 *   0-15%: cranial/sinus region (above teeth)
 *   15-35%: maxillary roots (upper teeth roots)
 *   35-50%: crown level (where upper and lower teeth crowns meet)
 *   50-70%: mandibular roots (lower teeth roots)
 *   70-100%: sub-mandibular region (below teeth)
 *
 * Upper teeth (quad 1,2): navigate to ~25% of total slices (upper root zone)
 * Lower teeth (quad 3,4): navigate to ~60% of total slices (lower root zone)
 * Within a quadrant, anterior teeth are closer to the center/crown region.
 */
function navigateToTooth(toothNum){
  if(!series.length||series.length<10) return;
  var total=series.length;
  var quad=Math.floor(toothNum/10);  // 1=UR, 2=UL, 3=LL, 4=LR
  var pos=toothNum%10;  // 1=central, 8=third molar

  var slicePercent;
  if(quad===1||quad===2){
    // Upper jaw: roots at 15-35%, crowns at 35-50%
    // Anterior teeth (1-3) closer to crown level, posterior (6-8) closer to roots
    slicePercent = 0.20 + (pos - 1) * (-0.005);  // range: 0.20 (central) to 0.165 (3rd molar)
    // Adjust: anterior teeth slightly lower (toward crown), posterior higher (toward root tip)
    if(pos<=3) slicePercent=0.32;  // anteriors at crown area
    else if(pos<=5) slicePercent=0.27;  // premolars
    else slicePercent=0.22;  // molars (deeper roots)
  } else {
    // Lower jaw: roots at 50-70%, crowns at 35-50%
    if(pos<=3) slicePercent=0.52;  // anteriors near crown
    else if(pos<=5) slicePercent=0.57;  // premolars
    else slicePercent=0.63;  // molars (deeper roots)
  }

  var targetSlice=Math.round(total*slicePercent);
  targetSlice=Math.max(0,Math.min(total-1,targetSlice));
  activateSlice(targetSlice);
  sendMsg('toothNavigated',{tooth:toothNum,slice:targetSlice});
}

function getSliceRegion(idx){
  if(!series.length) return {region:'unknown',label:'Unknown'};
  var pct=idx/series.length;
  if(pct<0.12) return {region:'cranial',label:'Cranial'};
  if(pct<0.30) return {region:'maxilla',label:'Upper Jaw (Maxilla)'};
  if(pct<0.48) return {region:'crown',label:'Crown Level'};
  if(pct<0.68) return {region:'mandible',label:'Lower Jaw (Mandible)'};
  return {region:'submandibular',label:'Sub-mandibular'};
}

function sendSliceRegionInfo(){
  if(!series.length) return;
  var region=getSliceRegion(currentSlice);
  sendMsg('sliceRegion',{
    region:region.region,
    label:region.label,
    sliceIndex:currentSlice,
    totalSlices:series.length,
    percent:Math.round((currentSlice/series.length)*100)
  });
}

/* ── Messaging ── */
function sendMsg(type,data){
  var msg=JSON.stringify({type:type,data:data});
  try{
    if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(msg);}
    else{window.parent.postMessage(msg,'*');}
  }catch(e){}
}

document.addEventListener('message',function(e){
  try{handleCommand(JSON.parse(e.data));}catch(err){}
});
window.addEventListener('message',function(e){
  if(typeof e.data==='string'){
    try{handleCommand(JSON.parse(e.data));}catch(err){}
  } else if(typeof e.data==='object' && e.data !== null && e.data.type){
    // Handle structured clone messages (e.g. ArrayBuffer from parent)
    handleCommand(e.data);
  }
});

window.handleCommand=handleCommand;

if(typeof dicomParser!=='undefined'){
  init();
}else{
  var checkCount=0;
  var checkInterval=setInterval(function(){
    checkCount++;
    if(typeof dicomParser!=='undefined'){
      clearInterval(checkInterval);init();
    }else if(checkCount>50){
      clearInterval(checkInterval);
      loadText.textContent='Failed to load DICOM parser library';
      sendMsg('error',{message:'Failed to load DICOM parser'});
    }
  },200);
}

})();
</script>
</body>
</html>`;
}
