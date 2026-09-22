import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { localWalletReferer } from '../scripts/lib/v2-local-wallet-config.mjs';

test('homepage aliases serve the V2 shell locally and retain bookmarked holder/recovery pages', async () => {
  const reservation=createServer();
  await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;
  await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['scripts/run-v2-local-demo.mjs'],{
    cwd:new URL('../',import.meta.url),env:{...process.env,GOGH_V2_DEMO_PORT:String(port)},stdio:['ignore','pipe','pipe']});
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('LOCAL_START_TIMEOUT')),15000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',code=>{clearTimeout(timer);reject(Error(`LOCAL_EXIT_${code}`));});
      child.stdout.on('data',chunk=>{if(String(chunk).includes('Gogh Punks V2 local demo:')){clearTimeout(timer);resolve();}});
    });
    const app=await readFile(new URL('../site/broker/v2/index.html',import.meta.url),'utf8');
    for(const path of ['/?tab=collection&tokenId=93','/index.html?tab=forge','/broker/v2/']){
      const response=await fetch(`http://127.0.0.1:${port}${path}`,{redirect:'error'});
      assert.equal(response.status,200);assert.equal(await response.text(),app);
    }
    for(const path of ['/broker/punk/93','/punk/93','/guide/']){
      const response=await fetch(`http://127.0.0.1:${port}${path}`,{redirect:'error'});
      assert.equal(response.status,200,`${path} remains accessible`);
    }
    assert.equal(localWalletReferer(`http://127.0.0.1:${port}/?tokenId=93`,port),`http://127.0.0.1:${port}`);
    assert.equal(localWalletReferer(`http://127.0.0.1:${port}/index.html`,port),`http://127.0.0.1:${port}`);
    assert.equal(localWalletReferer(`https://example.com:${port}/`,port),null);
    assert.equal(localWalletReferer(`http://127.0.0.1:${port}/untrusted`,port),null);
  } finally {
    const exited=new Promise(resolve=>child.once('exit',resolve));
    child.kill('SIGTERM');await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,1000))]);
  }
});
