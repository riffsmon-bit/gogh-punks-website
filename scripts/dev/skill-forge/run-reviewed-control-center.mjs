import { startPreview } from './preview-server.mjs';
// A separate chain and journal; never resets the owner's earlier practice session.
const preview = await startPreview({ port: 64342, controlCenterTraining: true, reviewedTraining: true });
console.log(`Reviewed Training Control Center: ${preview.url}/control-center?testPunk=44\nOn-chain expiry and single-use training reviews. Disposable chain 31337 only. No MetaMask or production burns.`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await preview.close(); process.exit(0); });
