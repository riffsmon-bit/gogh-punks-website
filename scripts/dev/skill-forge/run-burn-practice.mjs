import { startPreview } from './preview-server.mjs';
if (process.argv.length !== 3 || process.argv[2] !== '--local-only') throw Error('Requires --local-only');
const preview = await startPreview({ port: 64343, controlCenterTraining: true, reviewedTraining: true, burnPractice: true });
console.log(`Burn-to-training practice: ${preview.url}/burn-practice\nSeparate disposable chain 31337. Test #7 → Test #44. Existing practice port 64342 is untouched. Restarting discards this chain and its reviews.`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await preview.close(); process.exit(0); });
