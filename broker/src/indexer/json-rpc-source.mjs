import { Buffer } from "node:buffer";
import { normalizeAddress } from "../config.mjs";

function hex(value) {
  return `0x${BigInt(value).toString(16)}`;
}

async function boundedJson(response, maximumBytes) {
  const declaredLength = Number(response.headers?.get?.("content-length") ?? 0);
  if (declaredLength > maximumBytes) throw new RangeError("JSON-RPC response is too large");
  if (!response.body?.getReader) {
    const value = await response.text();
    if (Buffer.byteLength(value, "utf8") > maximumBytes) {
      throw new RangeError("JSON-RPC response is too large");
    }
    return JSON.parse(value);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let value = "";
  while (true) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    total += chunk.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new RangeError("JSON-RPC response is too large");
    }
    value += decoder.decode(chunk, { stream: true });
  }
  return JSON.parse(value + decoder.decode());
}

export class JsonRpcError extends Error {
  constructor(method, code = "RPC_ERROR") {
    super(`${method} failed`);
    this.name = "JsonRpcError";
    this.code = code;
    this.method = method;
  }
}

export class RobinhoodJsonRpcSource {
  constructor({
    rpcUrl,
    streams,
    fetchImpl = fetch,
    timeoutMs = 12_000,
    maximumResponseBytes = 5_000_000,
  }) {
    const parsed = new URL(rpcUrl);
    if (parsed.protocol !== "https:") throw new TypeError("rpcUrl must use HTTPS");
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
      throw new RangeError("timeoutMs must be between 1 and 60000");
    }
    if (
      !Number.isSafeInteger(maximumResponseBytes)
      || maximumResponseBytes < 1_000
      || maximumResponseBytes > 20_000_000
    ) throw new RangeError("maximumResponseBytes must be between 1000 and 20000000");
    this.rpcUrl = parsed.toString();
    this.streams = streams ?? {};
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maximumResponseBytes = maximumResponseBytes;
    this.requestId = 0;
  }

  async call(method, params) {
    const requestId = ++this.requestId;
    const response = await this.fetchImpl(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new JsonRpcError(method, `HTTP_${response.status}`);
    const payload = await boundedJson(response, this.maximumResponseBytes);
    if (payload?.jsonrpc !== "2.0" || payload?.id !== requestId) {
      throw new JsonRpcError(method, "MISMATCHED_RESPONSE");
    }
    if (payload.error || payload.result === undefined) {
      throw new JsonRpcError(method, String(payload.error?.code ?? "INVALID_RESPONSE"));
    }
    return payload.result;
  }

  async blockNumber() {
    return BigInt(await this.call("eth_blockNumber", []));
  }

  async blockHash(blockNumber) {
    return (await this.blockHeader(blockNumber)).hash;
  }

  async blockHeader(blockNumber) {
    const requested = BigInt(blockNumber);
    const block = await this.call("eth_getBlockByNumber", [hex(requested), false]);
    if (
      !block
      || BigInt(block.number) !== requested
      || !/^0x[0-9a-fA-F]{64}$/.test(block.hash ?? "")
    ) throw new JsonRpcError("eth_getBlockByNumber", "INVALID_BLOCK");
    const timestamp = BigInt(block.timestamp);
    if (timestamp < 0n) throw new JsonRpcError("eth_getBlockByNumber", "INVALID_TIMESTAMP");
    return Object.freeze({
      number: requested.toString(),
      hash: block.hash.toLowerCase(),
      timestamp: timestamp.toString(),
    });
  }

  async blockHeaders(blockNumbers, { concurrency = 4 } = {}) {
    if (!Array.isArray(blockNumbers)) throw new TypeError("blockNumbers must be an array");
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) {
      throw new RangeError("block header concurrency must be between 1 and 8");
    }
    const unique = [...new Set(blockNumbers.map((value) => BigInt(value).toString()))];
    const headers = new Array(unique.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < unique.length) {
        const index = cursor;
        cursor += 1;
        headers[index] = await this.blockHeader(unique[index]);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, unique.length) }, () => worker()),
    );
    return headers;
  }

  async logs(streamName, fromBlock, toBlock) {
    const stream = this.streams[streamName];
    if (!stream) throw new TypeError(`unknown indexer stream ${streamName}`);
    const filter = {
      fromBlock: hex(fromBlock),
      toBlock: hex(toBlock),
      topics: stream.topics,
    };
    if (stream.address) filter.address = normalizeAddress(stream.address);
    const logs = await this.call("eth_getLogs", [filter]);
    return logs.map((log) => {
      const address = normalizeAddress(log.address);
      if (filter.address && address !== filter.address) {
        throw new JsonRpcError("eth_getLogs", "FILTER_ADDRESS_MISMATCH");
      }
      return {
        address,
        blockNumber: BigInt(log.blockNumber).toString(),
        blockHash: log.blockHash.toLowerCase(),
        transactionHash: log.transactionHash.toLowerCase(),
        logIndex: log.logIndex,
        topics: log.topics.map((topic) => topic.toLowerCase()),
        data: log.data.toLowerCase(),
      };
    });
  }

  streamDefinition(streamName) {
    return this.streams[streamName] ?? null;
  }
}
