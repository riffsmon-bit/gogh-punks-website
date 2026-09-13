// Preparation only. No signer, nonce reservation or transaction broadcaster.
import { writeFile } from 'node:fs/promises';
import { encodeFunctionData, parseAbi, keccak256, stringToHex } from 'viem';
import { loadResearchSkillCatalog } from '../broker/src/v4/skill-forge/research-runtime.mjs';
import { skillKey } from '../broker/src/v4/skill-forge/capability-resolver.mjs';
import release from '../deployments/robinhood-forge-training.json' with { type: 'json' };
import evidence from '../docs/v2-hardening/forge-completion-live.json' with { type: 'json' };
if(process.argv.length!==3||process.argv[2]!=='--prepare-only')throw Error('Requires --prepare-only');
const packages=await loadResearchSkillCatalog(),pack=packages.find(p=>p.slug==='contract-detective'&&p.manifest.version===1);
if(!pack||pack.manifest.walletAuthority!=='NONE'||pack.manifest.requiredWalletCapabilities.length||pack.manifest.requiredExecutorCapabilities.length
 ||JSON.stringify(pack.manifest.capabilities)!=='["CONTRACT_READ"]'||JSON.stringify(pack.manifest.requiredMcpTools)!=='["inspect_contract"]')throw Error('READ_ONLY_PACKAGE_REQUIRED');
const key=skillKey(pack.manifest.skillId,pack.manifest.version),prior=evidence.packages.find(p=>p.key===key);
if(!prior||prior.registered||prior.manifestHash!==pack.manifestHash||prior.instructionHash!==pack.instructionHash)throw Error('FRESH_REGISTRATION_REVIEW_REQUIRED');
const abi=parseAbi(['function register(uint32,uint16,bytes32,bytes32,bytes32,uint256,uint8)','function setStatus(bytes32,uint8,bytes32)','function setEmergencyControls(bool,uint256)']);
const zero='0x'+'0'.repeat(64),transaction=(label,functionName,args)=>({label,from:release.allowedOwners[0],to:release.registry,chainId:4663,value:'0',data:encodeFunctionData({abi,functionName,args})});
const report={schema:'GOGH_RESEARCH_SKILL_REGISTRATION_REVIEW_V1',status:'PREPARED_NOT_AUTHORIZED_FOR_BROADCAST',preparedAt:new Date().toISOString(),
 basedOnRead:evidence.anchor,package:{name:pack.manifest.name,key,version:1,manifestHash:pack.manifestHash,instructionHash:pack.instructionHash,implementation:pack.manifest.implementation,implementationSha256:pack.manifest.implementationSha256},
 registry:release.registry,registryCodeHash:release.registryCodeHash,walletAuthority:'NONE',capabilities:['CONTRACT_READ'],tools:['inspect_contract'],
 preparation:[transaction('Register the immutable Contract Detective v1 package','register',[3,1,pack.manifestHash,pack.instructionHash,zero,1n,0]),transaction('Mark it TESTING, with no execution or learning readiness attestation','setStatus',[key,3,zero])],
 activationBlockedUntil:['Independent security review approves the exact adapter and evidence','Copied-chain learned/equipped inspect_contract proof passes','Owner reviews fresh contract state, exact fee, nonce and the READY attestation','A separately reviewed release adds this exact package to the training allowlist','Owner reviews expanding the enabled research mask from Rarity Eye alone to Rarity Eye plus Contract Detective'],
 readyStatusTransaction:null,enableCapabilityTransaction:null,feeEstimate:null,
 note:'The prepared register/TESTING calldata is not a current wallet review. It has no nonce, fee or expiry, and cannot be submitted by this script. READY and capability activation are deliberately omitted until acceptance.',publicTransactions:0,productionManifestChanged:false};
await writeFile(new URL('../docs/v2-hardening/contract-detective-registration-review.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,key,manifestHash:pack.manifestHash,preparedTransactions:2,publicTransactions:0}));
