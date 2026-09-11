import { startPreview } from './preview-server.mjs';
// Fixed local training scenario; no real credentials, RPC override or production transaction path.
const preview = await startPreview({ port: 64341, controlCenterTraining: true });
console.log(`Training Control Center: ${preview.url}/control-center\nTEST #44: one credit from a mock sacrifice, no learned skills. TEST #1: learned skills and one spare credit.\nDisposable chain 31337 only. No MetaMask or production burns.`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await preview.close(); process.exit(0); });
