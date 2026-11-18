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

module.exports={latestSnapshot,SNAPSHOT_NAME,MAX_DOWNLOAD_BYTES};
