import test from 'node:test';import assert from 'node:assert/strict';
import {createSkillAdminCancellationReview,verifySkillAdminSelfCallCode} from '../broker/src/v4/skill-forge/skill-admin-cancellation.mjs';
import {skillAdminFixture,ADMIN,REGISTRY}from'./fixtures/skill-admin.mjs';
const setup=()=>{const f=skillAdminFixture(),row={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',administrator:ADMIN,registry:REGISTRY,status:'WALLET_REQUESTED',preparation:f.preparation};
  return{...f,row,review:createSkillAdminCancellationReview(f)};};
test('cancellation uses only the original nonce, empty self call and bounded replacement fee',async()=>{
  const{row,review}=setup(),p=await review.prepare({row});assert.equal(p.transaction.from,ADMIN);assert.equal(p.transaction.to,ADMIN);
  assert.equal(p.transaction.nonce,'0x7');assert.equal(p.transaction.data,'0x');assert.equal(p.transaction.value,'0x0');assert.equal(p.accountCode,'0x');
  assert.equal(p.walletConfirmationRequired,true);assert.equal(p.registryActionRepeated,false);assert.equal(p.assetValueWei,'0');
  assert.equal(BigInt(p.maximumNetworkFeeWei),BigInt(p.transaction.gas)*BigInt(p.transaction.gasPrice));
  assert.equal(p.replacementBaseGasPrice,'0x64');assert.ok(BigInt(p.maximumNetworkFeeWei)<=100000000000000n);
});
for(const kind of ['resolved','wrong_chain','stale_block','code_disagreement','unknown_delegate','changed_implementation','insufficient_funds','fee_ceiling','simulation_revert','nonce_race'])test(`cancellation fails closed: ${kind}`,async()=>{
  const f=setup();
  if(kind==='resolved')f.row.status='CONFIRMED';
  if(kind==='wrong_chain')f.clients[0].getChainId=async()=>1;
  if(kind==='stale_block')for(const client of f.clients){const get=client.getBlock;client.getBlock=async()=>({...await get(),timestamp:1n});}
  if(kind==='code_disagreement')f.clients[0].getCode=async()=> '0x1234';
  if(kind==='unknown_delegate')for(const client of f.clients)client.getCode=async()=> '0xef01001234567890123456789012345678901234567890';
  if(kind==='changed_implementation')for(const client of f.clients)client.getCode=async({address})=>address===ADMIN?'0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b':'0x6000';
  if(kind==='insufficient_funds')f.clients[1].getBalance=async()=>0n;
  if(kind==='fee_ceiling')f.clients[1].getGasPrice=async()=>10n**18n;
  if(kind==='simulation_revert')f.clients[1].call=async()=>{throw Error('revert');};
  if(kind==='nonce_race'){let reads=0;f.clients[0].getTransactionCount=async()=>++reads===1?7:8;}
  await assert.rejects(f.review.prepare({row:f.row}));
});

for(const[description,malformed]of [['null',null],['false',false],['empty string',''],['number zero',0],['object',{}],['array',[]],['odd hex','0x0'],['nonhex','0xzz'],['unprefixed','ef0100']])test(`malformed account code blocks cancellation even if another provider reports no code: ${description}`,async()=>{
  const f=setup();f.clients[0].getCode=async()=>undefined;f.clients[1].getCode=async()=>malformed;
  await assert.rejects(f.review.prepare({row:f.row}),/SELF_CALL_NOT_REVIEWED/);
  await assert.rejects(verifySkillAdminSelfCallCode(f.clients[1],malformed,100n),/SELF_CALL_NOT_REVIEWED/);
});
test('only documented undefined and exact empty bytecode normalize to the same empty account proof',async()=>{
  const f=setup();f.clients[0].getCode=async()=>undefined;f.clients[1].getCode=async()=> '0x';
  assert.equal((await f.review.prepare({row:f.row})).accountCode,'0x');
  for(const value of [undefined,'0x'])assert.equal(await verifySkillAdminSelfCallCode(f.clients[0],value,100n),'0x');
});
for(const malformed of [undefined,null,false,'','0x','0x0','0xzz'])test(`known delegation with malformed implementation data remains blocked: ${String(malformed)}`,async()=>{
  const f=setup(),delegation='0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b';
  f.clients[0].getCode=async()=>malformed;
  await assert.rejects(verifySkillAdminSelfCallCode(f.clients[0],delegation,100n),/SELF_CALL_NOT_REVIEWED/);
});
