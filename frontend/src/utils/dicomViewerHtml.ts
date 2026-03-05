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
</style>
</head>
<body>
<canvas id="canvas"></canvas>
<div id="loading"><div class="spinner"></div><span id="loadText">Initializing viewer...</span></div>
<script src="https://unpkg.com/dicom-parser@1.8.21/dist/dicomParser.min.js"></script>
<script>
(function(){
'use strict';

var img=null;
var vp={zoom:1,panX:0,panY:0,rotation:0,inverted:false};
var wl={center:0,width:0};
var activeTool='pan';
var measurePts=[];
var allMeasures=[];
var currentFrame=0;
var totalFrames=1;
var pxSpaceX=1;
var pxSpaceY=1;

var canvas=document.getElementById('canvas');
var ctx=canvas.getContext('2d');
var loadingEl=document.getElementById('loading');
var loadText=document.getElementById('loadText');

var offCanvas=document.createElement('canvas');
var offCtx=offCanvas.getContext('2d');

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

function loadDicom(base64){
  try{
    loadingEl.className='';
    loadText.textContent='Parsing DICOM...';

    var raw=atob(base64);
    var bytes=new Uint8Array(raw.length);
    for(var i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);

    var ds=dicomParser.parseDicom(bytes);

    var rows=ds.uint16('x00280010');
    var cols=ds.uint16('x00280011');
    if(!rows||!cols) throw new Error('Missing image dimensions');

    var bitsAlloc=ds.uint16('x00280100')||16;
    var bitsStored=ds.uint16('x00280101')||bitsAlloc;
    var pixelRep=ds.uint16('x00280103')||0;
    var photometric=ds.string('x00280004')||'MONOCHROME2';
    var samplesPerPixel=ds.uint16('x00280002')||1;
    var rescaleSlope=1;
    var rescaleIntercept=0;
    try{rescaleIntercept=parseFloat(ds.string('x00281052'))||0;}catch(e){}
    try{rescaleSlope=parseFloat(ds.string('x00281053'))||1;}catch(e){}

    var wcStr=null,wwStr=null;
    try{wcStr=ds.string('x00281050');}catch(e){}
    try{wwStr=ds.string('x00281051');}catch(e){}

    var psStr=null;
    try{psStr=ds.string('x00280030');}catch(e){}
    if(psStr){
      var psParts=psStr.split(String.fromCharCode(92));
      pxSpaceY=parseFloat(psParts[0])||1;
      pxSpaceX=parseFloat(psParts[1])||pxSpaceY;
    }else{pxSpaceX=1;pxSpaceY=1;}

    totalFrames=1;
    try{totalFrames=parseInt(ds.string('x00280008'))||1;}catch(e){}
    currentFrame=0;

    var pixelDataEl=ds.elements.x7fe00010;
    if(!pixelDataEl) throw new Error('No pixel data found in file');

    var pixelData;
    if(bitsAlloc<=8){
      pixelData=new Uint8Array(ds.byteArray.buffer,pixelDataEl.dataOffset,pixelDataEl.length);
    }else if(bitsAlloc<=16){
      if(pixelRep===1){
        pixelData=new Int16Array(ds.byteArray.buffer,pixelDataEl.dataOffset,pixelDataEl.length/2);
      }else{
        pixelData=new Uint16Array(ds.byteArray.buffer,pixelDataEl.dataOffset,pixelDataEl.length/2);
      }
    }else{
      throw new Error('Unsupported bits allocated: '+bitsAlloc);
    }

    var frameSize=rows*cols*samplesPerPixel;
    var frameData=totalFrames>1?pixelData.subarray(0,frameSize):pixelData;
    var minV=Infinity,maxV=-Infinity;
    for(var i=0;i<Math.min(frameData.length,frameSize);i++){
      var v=frameData[i]*rescaleSlope+rescaleIntercept;
      if(v<minV)minV=v;
      if(v>maxV)maxV=v;
    }

    img={
      pixelData:pixelData,rows:rows,columns:cols,
      bitsAllocated:bitsAlloc,bitsStored:bitsStored,pixelRep:pixelRep,
      photometric:photometric,rescaleSlope:rescaleSlope,rescaleIntercept:rescaleIntercept,
      minVal:minV,maxVal:maxV,samplesPerPixel:samplesPerPixel
    };

    if(wcStr&&wwStr){
      wl.center=parseFloat(wcStr.split(String.fromCharCode(92))[0]);
      wl.width=parseFloat(wwStr.split(String.fromCharCode(92))[0]);
    }else{
      wl.center=(minV+maxV)/2;
      wl.width=Math.max(1,maxV-minV);
    }

    vp={zoom:1,panX:0,panY:0,rotation:0,inverted:false};
    measurePts=[];allMeasures=[];

    fitToScreen();
    renderWindowed();
    drawFrame();

    var patName='Unknown';try{patName=ds.string('x00100010')||'Unknown';}catch(e){}
    var studyDate='Unknown';try{studyDate=ds.string('x00080020')||'Unknown';}catch(e){}
    var modality='Unknown';try{modality=ds.string('x00080060')||'Unknown';}catch(e){}

    sendMsg('metadata',{
      patientName:patName,studyDate:studyDate,modality:modality,
      rows:rows,columns:cols,pixelSpacing:psStr||'N/A',
      windowCenter:Math.round(wl.center),windowWidth:Math.round(wl.width),
      frames:totalFrames,bitsAllocated:bitsAlloc
    });

    loadingEl.className='hidden';
  }catch(e){
    loadText.textContent='Error: '+e.message;
    sendMsg('error',{message:e.message});
  }
}

function fitToScreen(){
  if(!img)return;
  var scaleX=canvas.width/img.columns;
  var scaleY=canvas.height/img.rows;
  vp.zoom=Math.min(scaleX,scaleY)*0.92;
  vp.panX=0;vp.panY=0;
}

function loadDemo(){
  loadingEl.className='';
  loadText.textContent='Generating demo...';

  var w=512,h=400;
  var data=new Int16Array(w*h);

  for(var y=0;y<h;y++){
    for(var x=0;x<w;x++){
      var idx=y*w+x;
      var val=150;

      var ex=(x-w/2)/(w*0.38);
      var ey=(y-h*0.45)/(h*0.42);
      var ed=ex*ex+ey*ey;
      if(ed<1) val+=350*(1-ed);

      var jx=(x-w/2)/(w*0.32);
      var jy=(y-h*0.58)/(h*0.07);
      var jd=jx*jx+jy*jy;
      if(jd<1) val+=250*(1-jd);

      for(var t=-7;t<=7;t++){
        if(t===0)continue;
        var tx=w/2+t*17;
        var ty=h*0.46+Math.abs(t)*1.2;
        var tdx=(x-tx);var tdy=(y-ty);
        var td=Math.sqrt(tdx*tdx/100+tdy*tdy/225);
        if(td<1) val+=650*(1-td*td);
      }
      for(var t=-7;t<=7;t++){
        if(t===0)continue;
        var tx=w/2+t*16;
        var ty=h*0.59+Math.abs(t)*1.5;
        var tdx=(x-tx);var tdy=(y-ty);
        var td=Math.sqrt(tdx*tdx/90+tdy*tdy/200);
        if(td<1) val+=600*(1-td*td);
      }

      val+=(Math.random()-0.5)*40;
      data[idx]=Math.max(0,Math.min(2000,Math.round(val)));
    }
  }

  img={
    pixelData:data,rows:h,columns:w,
    bitsAllocated:16,bitsStored:12,pixelRep:0,
    photometric:'MONOCHROME2',
    rescaleSlope:1,rescaleIntercept:0,
    minVal:0,maxVal:2000,samplesPerPixel:1
  };

  wl={center:700,width:1400};
  pxSpaceX=0.3;pxSpaceY=0.3;
  totalFrames=1;currentFrame=0;
  vp={zoom:1,panX:0,panY:0,rotation:0,inverted:false};
  measurePts=[];allMeasures=[];

  fitToScreen();
  renderWindowed();
  drawFrame();

  sendMsg('metadata',{
    patientName:'DEMO, Patient',studyDate:'20240115',modality:'PX',
    rows:h,columns:w,pixelSpacing:'0.3 / 0.3 mm',
    windowCenter:700,windowWidth:1400,frames:1,bitsAllocated:16
  });

  loadingEl.className='hidden';
}

function renderWindowed(){
  if(!img)return;
  offCanvas.width=img.columns;
  offCanvas.height=img.rows;

  var idata=offCtx.createImageData(img.columns,img.rows);
  var frameSize=img.rows*img.columns;
  var offset=currentFrame*frameSize;
  var lower=wl.center-wl.width/2;
  var range=Math.max(1,wl.width);
  var isMono1=img.photometric==='MONOCHROME1';
  var inv=vp.inverted;
  var slope=img.rescaleSlope;
  var intercept=img.rescaleIntercept;
  var spp=img.samplesPerPixel;

  if(spp===1){
    for(var i=0;i<frameSize;i++){
      var raw=img.pixelData[offset+i];
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
      var base=offset+i*spp;
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

function screenToImage(sx,sy){
  var cx=canvas.width/2+vp.panX;
  var cy=canvas.height/2+vp.panY;
  var dx=sx-cx;var dy=sy-cy;
  var rad=-vp.rotation*Math.PI/180;
  var rx=dx*Math.cos(rad)-dy*Math.sin(rad);
  var ry=dx*Math.sin(rad)+dy*Math.cos(rad);
  return{x:rx/vp.zoom+img.columns/2,y:ry/vp.zoom+img.rows/2};
}

function imageToScreen(ix,iy){
  var dx=(ix-img.columns/2)*vp.zoom;
  var dy=(iy-img.rows/2)*vp.zoom;
  var rad=vp.rotation*Math.PI/180;
  var rx=dx*Math.cos(rad)-dy*Math.sin(rad);
  var ry=dx*Math.sin(rad)+dy*Math.cos(rad);
  return{x:rx+canvas.width/2+vp.panX,y:ry+canvas.height/2+vp.panY};
}

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
  e.preventDefault();
  if(!img)return;

  if(e.touches.length===2){
    var dx=e.touches[0].clientX-e.touches[1].clientX;
    var dy=e.touches[0].clientY-e.touches[1].clientY;
    touchState.lastDist=Math.sqrt(dx*dx+dy*dy);
    touchState.isPinch=true;
    return;
  }

  touchState.active=true;
  touchState.isPinch=false;
  touchState.lastX=e.touches[0].clientX;
  touchState.lastY=e.touches[0].clientY;
  touchState.startX=e.touches[0].clientX;
  touchState.startY=e.touches[0].clientY;
  touchState.startTime=Date.now();
}

function onTouchMove(e){
  e.preventDefault();
  if(!img)return;

  if(e.touches.length===2){
    var dx=e.touches[0].clientX-e.touches[1].clientX;
    var dy=e.touches[0].clientY-e.touches[1].clientY;
    var dist=Math.sqrt(dx*dx+dy*dy);
    if(touchState.lastDist>0){
      var scale=dist/touchState.lastDist;
      vp.zoom=Math.max(0.1,Math.min(30,vp.zoom*scale));
      drawFrame();
      sendMsg('viewportUpdate',{zoom:vp.zoom.toFixed(2)});
    }
    touchState.lastDist=dist;
    touchState.isPinch=true;
    return;
  }

  if(!touchState.active||e.touches.length!==1)return;

  var cx=e.touches[0].clientX;
  var cy=e.touches[0].clientY;
  var ddx=cx-touchState.lastX;
  var ddy=cy-touchState.lastY;

  handleDrag(ddx,ddy);

  touchState.lastX=cx;
  touchState.lastY=cy;
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
  touchState.active=false;
  touchState.isPinch=false;
  touchState.lastDist=0;
}

var mouseState={active:false,lastX:0,lastY:0};

function onMouseDown(e){
  if(!img)return;
  mouseState.active=true;
  mouseState.lastX=e.clientX;
  mouseState.lastY=e.clientY;

  if(activeTool==='measure'){
    var pt=screenToImage(e.clientX,e.clientY);
    addMeasurePoint(pt);
  }
}

function onMouseMove(e){
  if(!img||!mouseState.active)return;
  var ddx=e.clientX-mouseState.lastX;
  var ddy=e.clientY-mouseState.lastY;
  if(activeTool!=='measure') handleDrag(ddx,ddy);
  mouseState.lastX=e.clientX;
  mouseState.lastY=e.clientY;
}

function onMouseUp(){mouseState.active=false;}

function onWheel(e){
  e.preventDefault();
  if(!img)return;
  var delta=e.deltaY>0?0.92:1.08;
  vp.zoom=Math.max(0.1,Math.min(30,vp.zoom*delta));
  drawFrame();
  sendMsg('viewportUpdate',{zoom:vp.zoom.toFixed(2)});
}

function handleDrag(dx,dy){
  if(activeTool==='pan'){
    vp.panX+=dx;vp.panY+=dy;
    drawFrame();
  }else if(activeTool==='zoom'){
    vp.zoom=Math.max(0.1,Math.min(30,vp.zoom*(1-dy*0.005)));
    drawFrame();
    sendMsg('viewportUpdate',{zoom:vp.zoom.toFixed(2)});
  }else if(activeTool==='wl'){
    wl.width=Math.max(1,wl.width+dx*3);
    wl.center=wl.center-dy*3;
    renderWindowed();drawFrame();
    sendMsg('wlUpdate',{center:Math.round(wl.center),width:Math.round(wl.width)});
  }
}

function addMeasurePoint(pt){
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

function handleCommand(cmd){
  if(!cmd||!cmd.type)return;
  switch(cmd.type){
    case 'loadDicom':loadDicom(cmd.base64);break;
    case 'loadDemo':loadDemo();break;
    case 'setTool':
      activeTool=cmd.tool;
      if(cmd.tool!=='measure'){measurePts=[];drawFrame();}
      sendMsg('toolChanged',{tool:cmd.tool});
      break;
    case 'windowPreset':
      if(!img)break;
      if(cmd.preset==='bone'){wl.center=500;wl.width=2500;}
      else if(cmd.preset==='soft'){wl.center=50;wl.width=400;}
      else if(cmd.preset==='full'){wl.center=(img.minVal+img.maxVal)/2;wl.width=Math.max(1,img.maxVal-img.minVal);}
      renderWindowed();drawFrame();
      sendMsg('wlUpdate',{center:Math.round(wl.center),width:Math.round(wl.width)});
      break;
    case 'rotate':
      vp.rotation=(vp.rotation+90)%360;
      drawFrame();break;
    case 'invert':
      vp.inverted=!vp.inverted;
      renderWindowed();drawFrame();
      sendMsg('invertUpdate',{inverted:vp.inverted});
      break;
    case 'reset':
      vp={zoom:1,panX:0,panY:0,rotation:0,inverted:false};
      measurePts=[];allMeasures=[];
      if(img){fitToScreen();renderWindowed();drawFrame();}
      sendMsg('resetDone',{});
      break;
    case 'setFrame':
      if(totalFrames>1&&cmd.frame>=0&&cmd.frame<totalFrames){
        currentFrame=cmd.frame;
        renderWindowed();drawFrame();
      }
      break;
    case 'clearMeasurements':
      measurePts=[];allMeasures=[];
      if(img)drawFrame();
      break;
  }
}

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
      clearInterval(checkInterval);
      init();
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
