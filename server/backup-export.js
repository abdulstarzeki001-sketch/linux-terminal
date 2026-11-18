'use strict';
const fs=require('node:fs');
const path=require('node:path');

// Only accept archives created by the persistent CLI. Never accept user input
// as a path and never follow symlinks under the backup directory.
const SNAPSHOT_NAME=/^star-home-[0-9]{8}T[0-9]{6}Z-[0-9]+\.tgz$/;
const MAX_DOWNLOAD_BYTES=80*1024*1024;

function latestSnapshot(dir,fsImpl=fs) {
  let items;
  try { items=fsImpl.readdirSync(dir,{withFileTypes:true}); }
  catch (error) {
    if(error?.code==='ENOENT')return null;
    throw error;
  }
  const valid=[];
  for(const entry of items) {
    if(!entry.isFile() || !SNAPSHOT_NAME.test(entry.name)) continue;
    const fullPath=path.join(dir,entry.name);
    let stat;
    try{stat=fsImpl.lstatSync(fullPath);}catch(_){continue;}
    if(!stat.isFile() || stat.size<=0 || stat.size>MAX_DOWNLOAD_BYTES)continue;
    let checksum;
    try{checksum=fsImpl.lstatSync(fullPath+'.sha256');}catch(_){continue;}
    if(!checksum.isFile() || checksum.size<=0 || checksum.size>512)continue;
    valid.push({name:entry.name,fullPath,size:stat.size,mtimeMs:stat.mtimeMs});
  }
  valid.sort((a,b)=>b.mtimeMs-a.mtimeMs||b.name.localeCompare(a.name));
  return valid[0]||null;
}

async function verifySnapshot(snapshot) {
  if(!snapshot || !SNAPSHOT_NAME.test(snapshot.name))return false;
  let data;
  try {data=await fs.promises.readFile(snapshot.fullPath+'.sha256','utf8');}
  catch (_) {return false;}
  const expected=data.match(/^([0-9a-f]{64})[ \t]+/)?.[1];
  if(!expected)return false;
  const actual=await new Promise((resolve,reject)=>{
    const crypto=require('node:crypto');
    const hash=crypto.createHash('sha256');
    const stream=fs.createReadStream(snapshot.fullPath);
    stream.on('data',chunk=>hash.update(chunk));
    stream.on('error',reject);
    stream.on('end',()=>resolve(hash.digest('hex')));
  });
  return expected===actual;
}

module.exports={latestSnapshot,verifySnapshot,SNAPSHOT_NAME,MAX_DOWNLOAD_BYTES};
