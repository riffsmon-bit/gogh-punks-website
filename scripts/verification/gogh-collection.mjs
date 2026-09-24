// Public-source verification only. No signer, wallet, deployment or chain writes.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { keccak256, toBytes, decodeAbiParameters, encodeAbiParameters } from 'viem';

const ADDRESS = '0xe0f92b3b0e6ded3654177fe3809cd300e5ffadf6';
const TX = '0x7cd34483503c65b37e7130d73197d399922b7a1cca40318f2a9276e02c38b991';
const RENDERER = '0xce586aa467f6351bf819dbf134bc69947125cd92';
const OWNER = '0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6';
const RUNTIME_HASH = '0x3222e4925f77909e6370e17fe071d2774d43e191f6bc72c3a97c97209c6e2e93';
const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const API = 'https://api.etherscan.io/v2/api';
const COMPILER = 'v0.8.17+commit.8df45f5f';
const TARGET = 'src/GoghPunksOnchain.sol:GoghPunksOnchain';
const args = process.argv.slice(2), mode = args.shift();
const allowed = new Set(['--source-root','--artifact','--directory','--guid']), options = {};
while (args.length) {
  const key = args.shift(); if (!allowed.has(key) || !args.length || options[key]) throw Error('Invalid verification option.');
  options[key] = args.shift();
}
const directory = resolve(options['--directory'] ?? 'docs/verification/gogh-collection');
const sha = text => createHash('sha256').update(text).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const assert = (value, message) => { if (!value) throw Error(message); };
const read = name => readFile(resolve(directory, name), 'utf8');
async function request(url, body) {
  let response;
  try { response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': body instanceof URLSearchParams
    ? 'application/x-www-form-urlencoded' : 'application/json' }, body: body === undefined ? undefined : body instanceof URLSearchParams ? body : JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(20_000) }); }
  catch { throw Error('Verification read/submission transport unavailable. No blockchain transaction was sent.'); }
  assert(response.ok, 'Verification endpoint rejected the HTTP request.');
  try { return await response.json(); } catch { throw Error('Verification endpoint returned a non-JSON response.'); }
}
let requestId = 0;
async function rpc(method, params = []) {
  assert(['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_getTransactionByHash','eth_getTransactionReceipt'].includes(method), 'Read-only RPC method required.');
  const id = ++requestId, result = await request(RPC, { jsonrpc: '2.0', id, method, params });
  assert(result.jsonrpc === '2.0' && result.id === id && !result.error, 'Public chain read failed.'); return result.result;
}
async function chainProof(compiled) {
  const [chainId, head, tx, receipt] = await Promise.all([rpc('eth_chainId'), rpc('eth_getBlockByNumber',['latest',false]),
    rpc('eth_getTransactionByHash',[TX]), rpc('eth_getTransactionReceipt',[TX])]);
  assert(BigInt(chainId) === 4663n && head?.hash && head?.number, 'Wrong or missing Robinhood chain state.');
  assert(tx?.hash?.toLowerCase() === TX && tx.to === null && tx.from?.toLowerCase() === OWNER
    && BigInt(tx.value) === 0n && tx.input?.toLowerCase() === (compiled.creationBytecode + compiled.constructorArguments).toLowerCase(), 'Deployment transaction input does not match.');
  assert(receipt?.status === '0x1' && receipt.contractAddress?.toLowerCase() === ADDRESS
    && receipt.transactionHash?.toLowerCase() === TX && receipt.blockHash === tx.blockHash, 'Collection deployment receipt does not match.');
  const runtime = await rpc('eth_getCode',[ADDRESS,head.number]);
  assert(runtime?.toLowerCase() === compiled.deployedRuntime.toLowerCase() && keccak256(runtime) === RUNTIME_HASH, 'Deployed collection runtime does not match the verified package.');
  const canonical = await rpc('eth_getBlockByNumber',[head.number,false]);
  assert(canonical?.hash === head.hash, 'Chain changed during the read. Recheck before submission.');
  return { checkedAt: new Date().toISOString(), chainId: 4663, address: ADDRESS, blockNumber: BigInt(head.number).toString(),
    blockHash: head.hash, deploymentTransaction: TX, deploymentBlock: BigInt(receipt.blockNumber).toString(),
    deploymentInputExactMatch: true, runtimeExactMatch: true, runtimeBytes: (runtime.length-2)/2, runtimeKeccak256: RUNTIME_HASH };
}
async function prepare() {
  assert(options['--source-root'] && options['--artifact'], 'prepare requires --source-root and --artifact.');
  const sourceRoot = resolve(options['--source-root']), artifactText = await readFile(resolve(options['--artifact']),'utf8');
  const artifact = JSON.parse(artifactText), metadata = typeof artifact.metadata === 'string' ? JSON.parse(artifact.metadata) : artifact.metadata;
  assert('v'+metadata.compiler.version === COMPILER && metadata.settings.compilationTarget['src/GoghPunksOnchain.sol'] === 'GoghPunksOnchain', 'Compiler or source target mismatch.');
  const sources = {};
  for (const [name, entry] of Object.entries(metadata.sources)) {
    const path = resolve(sourceRoot,name); assert(!relative(sourceRoot,path).startsWith('..'), 'Source escapes original repository.');
    const content = await readFile(path,'utf8'); assert(keccak256(toBytes(content)) === entry.keccak256, `Source hash mismatch: ${name}`);
    sources[name] = { content };
  }
  const settings = { ...metadata.settings }; delete settings.compilationTarget;
  settings.outputSelection = { '*': { '*': ['abi','evm.bytecode','evm.deployedBytecode'] } };
  const input = { language:'Solidity',sources,settings };
  const broadcast = JSON.parse(await readFile(resolve(sourceRoot,'broadcast/DeployOnchainToken.s.sol/4663/run-latest.json'),'utf8'));
  const deployment = broadcast.transactions.find(item => item.hash?.toLowerCase() === TX);
  const creationBytecode = artifact.bytecode.object;
  assert(deployment?.transaction.input?.startsWith(creationBytecode), 'Original deployment input does not begin with compiled bytecode.');
  const constructorArguments = deployment.transaction.input.slice(creationBytecode.length);
  const constructor = artifact.abi.find(item => item.type === 'constructor');
  const values = decodeAbiParameters(constructor.inputs, '0x'+constructorArguments);
  assert(encodeAbiParameters(constructor.inputs,values).slice(2) === constructorArguments
    && values[0].toLowerCase() === RENDERER && values[2].toLowerCase() === OWNER, 'Constructor does not match the original public deployment.');
  let deployedRuntime = artifact.deployedBytecode.object;
  const immutables = Object.values(artifact.deployedBytecode.immutableReferences);
  assert(immutables.length === 1, 'Unexpected immutable fields.');
  for (const range of immutables[0]) {
    assert(range.length === 32, 'Unexpected renderer immutable width.'); const offset = 2+range.start*2;
    deployedRuntime = deployedRuntime.slice(0,offset)+RENDERER.slice(2).padStart(64,'0')+deployedRuntime.slice(offset+64);
  }
  const compiled = { compiler:COMPILER,target:TARGET,creationBytecode,constructorArguments,deployedRuntime };
  const proof = await chainProof(compiled);
  const parameters = { chainid:'4663',module:'contract',action:'verifysourcecode',contractaddress:ADDRESS,
    contractname:TARGET,compilerversion:COMPILER,codeformat:'solidity-standard-json-input',optimizationUsed:'1',runs:'200',
    constructorArguments,evmVersion:settings.evmVersion };
  await mkdir(directory,{recursive:true});
  const files = { 'compiler-input.json':json(input),'metadata.json':json(metadata),'constructor-arguments.txt':constructorArguments+'\n',
    'parameters.json':json(parameters),'compiled-evidence.json':json(compiled),'chain-evidence.json':json(proof) };
  for (const [name,content] of Object.entries(files)) await writeFile(resolve(directory,name),content);
  await writeFile(resolve(directory,'checksums.json'),json(Object.fromEntries(Object.entries(files).map(([name,content])=>[name,sha(content)]))));
  console.log(json({status:'PACKAGE_PREPARED_NOT_SUBMITTED',directory,sourceCount:Object.keys(sources).length,...proof}));
}
async function bundle() {
  const sums = JSON.parse(await read('checksums.json'));
  for (const [name,hash] of Object.entries(sums)) {
    assert(!name.includes('/') && sha(await read(name)) === hash, 'Package checksum mismatch.');
  }
  return { input:await read('compiler-input.json'),parameters:JSON.parse(await read('parameters.json')),compiled:JSON.parse(await read('compiled-evidence.json')) };
}
async function explorer(parameters) {
  const key = process.env.ETHERSCAN_API_KEY;
  assert(key && key.trim(), 'ETHERSCAN_API_KEY is required. No verification was submitted.');
  const url = new URL(API); url.searchParams.set('chainid','4663'); url.searchParams.set('module','contract'); url.searchParams.set('apikey',key);
  url.searchParams.set('action',parameters.action);
  if(parameters.action !== 'verifysourcecode') {
    for(const [name,value] of Object.entries(parameters)) url.searchParams.set(name,value);
    return request(url);
  }
  return request(url,new URLSearchParams(parameters));
}
async function verification() {
  const prepared = await bundle();
  assert(prepared.parameters.contractaddress === ADDRESS && prepared.parameters.contractname === TARGET
    && prepared.parameters.compilerversion === COMPILER, 'Wrong verification package.');
  if(mode==='status') {
    assert(/^[a-zA-Z0-9]{1,100}$/.test(options['--guid']??''), 'status requires the returned --guid.');
    const response = await explorer({action:'checkverifystatus',guid:options['--guid']});
    const passed=response.status==='1'&&/pass.*verified/i.test(response.result??'');
    console.log(json({status:passed?'EXPLORER_VERIFICATION_PASSED':'NOT_CONFIRMED',apiStatus:response.status})); return;
  }
  const source = await explorer({action:'getsourcecode',address:ADDRESS});
  assert(source.status === '1' && Array.isArray(source.result), 'Explorer source status unavailable; check the API key and chain support.');
  if (source.result[0]?.SourceCode) { console.log(json({status:'ALREADY_VERIFIED',contractName:source.result[0].ContractName})); return; }
  if(mode==='check') { console.log(json({status:'SOURCE_NOT_VERIFIED'})); return; }
  await chainProof(prepared.compiled);
  const response = await explorer({...prepared.parameters,sourceCode:prepared.input});
  assert(response.status === '1' && /^[a-zA-Z0-9]{1,100}$/.test(response.result??''), 'Explorer did not accept verification. No blockchain transaction was sent.');
  const result={status:'SUBMITTED_PENDING_EXPLORER_VERIFICATION',guid:response.result,address:ADDRESS,chainId:4663,submittedAt:new Date().toISOString()};
  await writeFile(resolve(directory,'submission.json'),json(result));console.log(json(result));
}
try {
  if(mode==='prepare') await prepare();
  else if(['check','submit','status'].includes(mode)) await verification();
  else throw Error('Choose prepare, check, submit or status.');
} catch(error) { console.error(error.message); process.exitCode=1; }
