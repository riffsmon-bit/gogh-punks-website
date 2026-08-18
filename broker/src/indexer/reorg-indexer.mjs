export function logId(chainId, log) {
  return `${chainId}:${String(log.transactionHash).toLowerCase()}:${Number(BigInt(log.logIndex))}`;
}

export class ReorgAwareIndexer {
  constructor({
    chainId,
    source,
    repository,
    confirmations = 20,
    batchSize = 1_000,
    reorgWindow = 64,
    startBlock = 0,
    maximumBlocksPerRun = 50_000,
  }) {
    if (!source || !repository) throw new TypeError("source and repository are required");
    this.chainId = chainId;
    this.source = source;
    this.repository = repository;
    this.confirmations = BigInt(confirmations);
    this.batchSize = BigInt(batchSize);
    this.reorgWindow = BigInt(reorgWindow);
    this.startBlock = BigInt(startBlock);
    this.maximumBlocksPerRun = BigInt(maximumBlocksPerRun);
    if (this.confirmations < 0n) throw new RangeError("confirmations cannot be negative");
    if (this.batchSize <= 0n) throw new RangeError("batchSize must be positive");
    if (this.reorgWindow < 0n) throw new RangeError("reorgWindow cannot be negative");
    if (this.startBlock < 0n) throw new RangeError("startBlock cannot be negative");
    if (this.maximumBlocksPerRun <= 0n) {
      throw new RangeError("maximumBlocksPerRun must be positive");
    }
  }

  async run(stream) {
    const head = BigInt(await this.source.blockNumber());
    const safeHead = head > this.confirmations ? head - this.confirmations : 0n;
    const checkpoint = await this.repository.checkpoint(this.chainId, stream);
    let start = checkpoint ? BigInt(checkpoint.blockNumber) + 1n : this.startBlock;
    if (checkpoint) {
      const canonicalHash = await this.source.blockHash(BigInt(checkpoint.blockNumber));
      if (canonicalHash.toLowerCase() !== checkpoint.blockHash.toLowerCase()) {
        const rewindStart = BigInt(checkpoint.blockNumber) > this.reorgWindow
          ? BigInt(checkpoint.blockNumber) - this.reorgWindow
          : 0n;
        start = rewindStart > this.startBlock ? rewindStart : this.startBlock;
        await this.repository.rewind(this.chainId, stream, start);
      }
    }
    let inserted = 0;
    const boundedHead = start + this.maximumBlocksPerRun - 1n;
    const runHead = boundedHead < safeHead ? boundedHead : safeHead;
    for (let from = start; from <= runHead; from += this.batchSize) {
      const to = from + this.batchSize - 1n < runHead ? from + this.batchSize - 1n : runHead;
      const logs = await this.source.logs(stream, from, to);
      if (typeof this.source.blockHeaders !== "function") {
        throw new TypeError("source must provide blockHeaders for timestamp provenance");
      }
      const headers = await this.source.blockHeaders([
        ...logs.map((log) => log.blockNumber),
        to,
      ]);
      const headersByBlock = new Map(headers.map((header) => [header.number, header]));
      const checkpointHeader = headersByBlock.get(to.toString());
      if (!checkpointHeader) throw new Error("checkpoint block header is unavailable");
      const records = logs.map((log) => ({
        ...log,
        blockTimestamp: (() => {
          const header = headersByBlock.get(BigInt(log.blockNumber).toString());
          if (!header || header.hash !== String(log.blockHash).toLowerCase()) {
            throw new Error("log block provenance does not match its canonical header");
          }
          return header.timestamp;
        })(),
        id: `${stream}:${logId(this.chainId, log)}`,
      }));
      inserted += await this.repository.insertLogs(this.chainId, stream, records, {
        checkpoint: {
          blockNumber: checkpointHeader.number,
          blockHash: checkpointHeader.hash,
        },
      });
    }
    return Object.freeze({
      head: head.toString(),
      safeHead: safeHead.toString(),
      processedThrough: start > safeHead ? checkpoint?.blockNumber ?? null : runHead.toString(),
      caughtUp: start > safeHead || runHead === safeHead,
      inserted,
    });
  }
}
