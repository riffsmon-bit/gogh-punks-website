import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeAbiParameters, encodeEventTopics, keccak256, parseAbi } from 'viem';
import { readTrainingSettlement, serializeTrainingSettlement } from '../broker/src/v4/skill-forge/training-settlement.mjs';
import { durableTrainingTransaction } from '../broker/src/v4/skill-forge/durable-training-review.mjs';
import { durableReviewFixture, fixtureHash } from './fixtures/durable-training-review.mjs';

function fixture() {
  const review = durableReviewFixture(), base = BigInt(review.anchor.timestamp), code = '0x60006000';
  const anchor = { number: BigInt(review.anchor.number), hash: review.anchor.hash, timestamp: base };
  const included = { number: 110n, hash: fixtureHash('1'), timestamp: base + 2n };
  const finalized = { number: 150n, hash: fixtureHash('2'), timestamp: base + 80n };
  const head = { number: 200n, hash: fixtureHash('3'), timestamp: base + 100n };
  const hash = fixtureHash('e'), expected = durableTrainingTransaction(review);
  const transaction = { ...expected, input: expected.data, hash, nonce: Number(expected.nonce),
    gas: BigInt(expected.gas), value: 0n, maxFeePerGas: BigInt(expected.maxFeePerGas), maxPriorityFeePerGas: 0n,
    blockNumber: included.number, blockHash: included.hash };
  const abi = parseAbi(['event SkillEquipped(uint256 indexed tokenId,uint8 indexed slot,bytes32 indexed key)',
    'event TrainingReviewApplied(uint256 indexed tokenId,uint256 indexed nonce,uint8 operation)']);
  const logs = [
    { topics: encodeEventTopics({ abi, eventName: 'SkillEquipped', args: { tokenId: 93n, slot: 0, key: review.action.skillKey } }), data: '0x' },
    { topics: encodeEventTopics({ abi, eventName: 'TrainingReviewApplied', args: { tokenId: 93n, nonce: 2n } }), data: encodeAbiParameters([{type:'uint8'}], [2]) },
  ].map((log, logIndex) => ({ ...log, logIndex, address: review.progression, transactionHash: hash,
    blockNumber: included.number, blockHash: included.hash, removed: false }));
  const receipt = { transactionHash: hash, blockNumber: included.number, blockHash: included.hash,
    from: review.owner, to: review.progression, status: 'success', gasUsed: 50000n,
    effectiveGasPrice: 100000000n, logs };
  const clients = [0,1].map(() => ({
    getChainId: async () => review.chainId,
    getBlock: async ({blockTag,blockNumber}) => structuredClone(blockTag === 'latest' || blockNumber === head.number ? head
      : blockTag === 'finalized' || blockNumber === finalized.number ? finalized : blockNumber === anchor.number ? anchor : included),
    request: async ({method,params}) => {
      assert.equal(method, 'eth_getTransactionCount'); assert.deepEqual(params, [review.owner, '0x96']); return '0x9';
    },
    getTransaction: async () => structuredClone(transaction),
    getTransactionReceipt: async () => structuredClone(receipt),
    getCode: async () => code,
  }));
  const args = { clients, review, transactionHash: hash, expectedRuntimeHash: keccak256(code),
    expectedSnapshotHash: fixtureHash('f'), now: () => Number(base + 100n) * 1000 };
  return { args, review, clients, head, finalized, included, transaction, receipt, run: () => readTrainingSettlement(args) };
}

test('two providers verify a finalized action before releasing its reservation', async () => {
  const f = fixture(), result = await f.run();
  assert.equal(result.settlement.status, 'SETTLED_SUCCESS');
  assert.equal(result.settlement.receiptBlockHash, f.included.hash);
  assert.equal(result.settlement.finalizedBlockHash, f.finalized.hash);
  assert.equal(result.settlement.ownerNonce, '9');
  assert.deepEqual(result.settlement.sources, ['PUBLICNODE','ROBINHOOD']);
  assert.equal(Object.hasOwn(result.settlement, 'credits'), false);
  assert.equal(JSON.parse(serializeTrainingSettlement(result.settlement, f.review)).evidenceHash, result.settlement.evidenceHash);
});

test('finalized revert releases storage without reporting a learned skill', async () => {
  const f = fixture(); f.receipt.status = 'reverted'; f.receipt.logs = [];
  assert.equal((await f.run()).settlement.status, 'SETTLED_REVERT');
});

test('a lost hash can close only after the wallet nonce is finalized and the review expired', async () => {
  const f = fixture(); f.args.transactionHash = null;
  const result = await f.run();
  assert.equal(result.settlement.status, 'NONCE_CONSUMED');
  assert.equal(result.settlement.transactionHash, null); assert.equal(result.settlement.receiptBlockHash, null);
  f.finalized.timestamp = BigInt(f.review.guard.deadline);
  assert.equal((await f.run()).reason, 'WAITING_FOR_FINALIZED_REVIEW_EXPIRY');
  for (const client of f.clients) client.request = async () => '0x8';
  assert.equal((await f.run()).reason, 'WAITING_FOR_FINALIZED_NONCE');
});

test('dropped or replaced exact hash retains its binding and claims no successful training', async () => {
  const f = fixture();
  for (const client of f.clients) client.getTransaction = async () => { throw Object.assign(Error('missing'), {name:'TransactionNotFoundError'}); };
  const result = await f.run();
  assert.equal(result.settlement.status, 'NONCE_CONSUMED');
  assert.equal(result.settlement.transactionHash, f.transaction.hash);
});

test('known transaction with no receipt can close an expired consumed nonce without fabricating a receipt', async () => {
  const f = fixture();
  for (const client of f.clients) client.getTransactionReceipt = async () => { throw Object.assign(Error('missing'), {name:'TransactionReceiptNotFoundError'}); };
  const result = await f.run(); assert.equal(result.settlement.status, 'NONCE_CONSUMED');
  assert.equal(result.settlement.receiptBlockNumber, null);
});
test('an unused nonce releases only after finalized on-chain review expiry and both runtime checks',async()=>{
  const f=fixture();f.args.transactionHash=null;f.clients.forEach(client=>{client.request=async()=> '0x8';});
  const result=await f.run();assert.equal(result.settlement.status,'REVIEW_EXPIRED');assert.equal(result.settlement.ownerNonce,'8');
  assert.equal(result.settlement.receiptBlockNumber,null);
  f.clients[1].getCode=async()=> '0x6002';await assert.rejects(f.run,/UNVERIFIED/);
});
test('unused-nonce expiry never uses a browser clock, stale finalized timestamp, or unverifiable code',async()=>{
  for(const change of [f=>{f.finalized.timestamp=BigInt(f.review.guard.deadline);},
    f=>{f.clients[1].getCode=async()=>{throw Error('CODE_READ_UNAVAILABLE');};}]){
    const f=fixture();f.args.transactionHash=null;f.clients.forEach(client=>{client.request=async()=> '0x8';});change(f);
    try{const result=await f.run();assert.equal(result.settlement,null);assert.equal(result.reason,'WAITING_FOR_FINALIZED_NONCE');}
    catch(error){assert.match(error.message,/CODE_READ_UNAVAILABLE/);}
  }
});

for (const [name, change] of [
  ['wrong chain', f => { f.clients[1].getChainId = async () => 1; }],
  ['duplicate provider object', f => { f.args.clients = [f.clients[0],f.clients[0]]; }],
  ['unavailable finalized tag', f => { const original=f.clients[1].getBlock; f.clients[1].getBlock=async args=>{
    if(args.blockTag==='finalized')throw Error('FINALITY_UNAVAILABLE'); return original(args); }; }],
  ['stale latest head', f => { f.args.now = () => Number(f.head.timestamp + 121n) * 1000; }],
  ['future head', f => { f.args.now = () => Number(f.head.timestamp - 6n) * 1000; }],
  ['finalized height beyond latest', f => { f.finalized.number = 300n; }],
  ['different canonical finalized block', f => { const original=f.clients[1].getBlock; f.clients[1].getBlock=async args=>{
    const block=await original(args); return args.blockNumber===150n ? {...block,hash:fixtureHash('f')} : block; }; }],
  ['disagreeing finalized nonce', f => { f.clients[1].request=async()=> '0xa'; }],
  ['invalid nonce', f => { f.clients[1].request=async()=> '0x0009'; }],
  ['nonce overflow', f => { f.clients[1].request=async()=> '0x10000000000000000'; }],
  ['one missing transaction', f => { f.clients[1].getTransaction=async()=> {throw Object.assign(Error(),{name:'TransactionNotFoundError'});}; }],
  ['receipt provider outage', f => { f.clients[1].getTransactionReceipt=async()=> {throw Error('RPC_TIMEOUT');}; }],
  ['changed calldata', f => { f.transaction.input='0x'; }],
  ['changed code', f => { f.clients[1].getCode=async()=> '0x6001'; }],
  ['disagreeing receipt', f => { f.clients[1].getTransactionReceipt=async()=> ({...f.receipt,status:'reverted',logs:[]}); }],
]) test(`settlement rejects ${name}`, async () => { const f=fixture(); change(f); await assert.rejects(f.run); });

test('canonical change or finalized-tag regression during nonce work prevents release', async () => {
  for (const regress of [true,false]) {
    const f=fixture(); f.args.transactionHash=null;
    const original=f.clients[1].getBlock; let reads=0;
    f.clients[1].getBlock=async args=> {
      if(args.blockTag==='finalized') { reads++; if(regress && reads>1)return {...f.finalized,number:149n}; }
      const block=await original(args);
      return !regress && args.blockNumber===150n && reads>=1 && f.changed ? {...block,hash:fixtureHash('f')} : block;
    };
    f.clients[1].request=async()=> {f.changed=true;return '0x9';};
    await assert.rejects(f.run);
  }
});

test('altered proof, cross-review reuse and accessor inputs cannot release a record', async () => {
  const f=fixture(), {settlement}=await f.run();
  for(const field of ['status','reviewHash','ownerNonce','finalizedBlockHash','evidenceHash']) {
    assert.throws(()=>serializeTrainingSettlement({...settlement,[field]:'forged'},f.review));
  }
  assert.throws(()=>serializeTrainingSettlement(settlement,{...f.review,tokenId:'94'}));
  let read=false; const poisoned={...settlement};
  Object.defineProperty(poisoned,'status',{enumerable:true,get(){read=true;return settlement.status;}});
  assert.throws(()=>serializeTrainingSettlement(poisoned,f.review)); assert.equal(read,false);
});
