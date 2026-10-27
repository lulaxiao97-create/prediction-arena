import type { Page } from "@playwright/test";

/**
 * A headless EIP-1193 wallet + a deterministic Base RPC.
 *
 * The wallet answers accounts/chain/sendTransaction and announces itself through EIP-6963 so
 * RainbowKit lists it like any other installed wallet. The RPC route answers the handful of methods
 * the app calls, which makes receipt polling instant instead of "poll the real chain until the
 * timeout".
 *
 * Balance is deliberately ZERO: that is the exact state that must never disable the submit button.
 */
export const TEST_ACCOUNT = "0x7F3bA1c9d2E4f6A8b0C1d2E3f4A5b6C7d8E9f0A1" as const;

type RpcRequest = { id?: number; method: string; params?: unknown[] };


/* ── minimal ABI helpers for the Multicall3 path ───────────────────────────────
 * Every read in the app goes through Multicall3.aggregate3, so a stubbed eth_call has to decode
 * the nested calls and answer with a well-formed (bool, bytes)[] — a zeroed blob decodes as an
 * empty array and viem then throws "position out of bounds" instead of showing the form.
 */
const hexBody = (h: string) => (h.startsWith("0x") ? h.slice(2) : h);
const word = (h: string, i: number) => BigInt("0x" + (hexBody(h).slice(i * 64, i * 64 + 64) || "0"));

function decodeAggregate3(data: string): { target: string; callData: string }[] {
  const body = hexBody(data).slice(8); // strip the selector
  const arr = body.slice(Number(word(body, 0)) * 2);
  const len = Number(word(arr, 0));
  const out: { target: string; callData: string }[] = [];
  for (let i = 0; i < len; i += 1) {
    const item = arr.slice((32 + Number(word(arr, 1 + i))) * 2);
    const target = "0x" + item.slice(24, 64);
    const cd = item.slice(Number(word(item, 2)) * 2);
    const cdLen = Number(word(cd, 0));
    out.push({ target, callData: "0x" + cd.slice(64, 64 + cdLen * 2) });
  }
  return out;
}

function encodeAggregate3Result(rows: { success: boolean; data: string }[]): string {
  const items = rows.map((r) => {
    const d = hexBody(r.data);
    const bytes = d.length / 2;
    return (
      (r.success ? "1" : "0").padStart(64, "0") +
      (64).toString(16).padStart(64, "0") +
      bytes.toString(16).padStart(64, "0") +
      d.padEnd(Math.ceil(d.length / 64) * 64, "0")
    );
  });
  let acc = rows.length * 32;
  const offsets = items.map((it) => {
    const o = acc;
    acc += it.length / 2;
    return o.toString(16).padStart(64, "0");
  });
  const arr = rows.length.toString(16).padStart(64, "0") + offsets.join("") + items.join("");
  return "0x" + (32).toString(16).padStart(64, "0") + arr;
}

/** What a single nested call should return. */
function stubCall(target: string, callData: string): { success: boolean; data: string } {
  const sel = callData.slice(0, 10).toLowerCase();
  if (target.toLowerCase() === ARENA) return { success: false, data: "0x" }; // no pools on chain
  if (sel === "0x313ce567") return { success: true, data: "0x" + (6).toString(16).padStart(64, "0") };
  if (sel === "0x95d89b41" || sel === "0x06fdde03") return { success: true, data: abiString("USDC") };
  return { success: true, data: "0x" + "0".repeat(64) };
}

/** ABI-encoded `string` return value. */
function abiString(value: string): string {
  const hex = Buffer.from(value, "utf8").toString("hex");
  const len = (value.length).toString(16).padStart(64, "0");
  const body = hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");
  return "0x" + (32).toString(16).padStart(64, "0") + len + body;
}

/** The deployed arena. Calls to it revert (an arena with no pools), everything else answers zeros. */
const ARENA = (process.env.NEXT_PUBLIC_ARENA_ADDRESS ?? "0x961872d75ea6E7A2859B9b04C6C7B1C73CF510b5").toLowerCase();

function rpcResult(method: string, params: unknown[]): unknown {
  switch (method) {
    case "eth_chainId":
      return "0x2105"; // Base mainnet
    case "net_version":
      return "8453";
    case "eth_blockNumber":
    case "eth_getTransactionCount":
      return "0x1";
    case "eth_gasPrice":
      return "0x3b9aca00"; // 1 gwei
    case "eth_estimateGas":
      return "0x186a0";
    case "eth_getBalance":
      return "0x0"; // zero ETH on purpose
    case "eth_call": {
      const call = (params[0] ?? {}) as { to?: string; data?: string };
      const to = (call.to ?? "").toLowerCase();
      const data = (call.data ?? "").toLowerCase();

      if (data.startsWith("0x82ad56cb")) {
        const nested = decodeAggregate3(data).map((c) => stubCall(c.target, c.callData));
        return encodeAggregate3Result(nested);
      }
      // decimals() → 6, everything else on a token → zeroed word (a wallet with 0 USDC and 0
      // allowance). Pool reads against the arena revert, exactly like an arena that holds no pools:
      // the board falls back to its manifest rows and the drawer opens on demo depth.
      if (to === ARENA) throw Object.assign(new Error("execution reverted"), { code: 3, data: "0x" });
      if (data.startsWith("0x313ce567")) return "0x" + (6).toString(16).padStart(64, "0"); // decimals()
      // symbol() / name() must decode as ABI strings, not as a zeroed word: viem throws
      // "position out of bounds" on a malformed string and the drawer shows that instead of the form.
      if (data.startsWith("0x95d89b41") || data.startsWith("0x06fdde03")) return abiString("USDC");
      return "0x" + "0".repeat(64);
    }
    case "eth_sendRawTransaction":
    case "eth_sendTransaction":
      return "0x" + "ab".repeat(32);
    case "eth_maxPriorityFeePerGas":
      return "0x3b9aca00";
    case "eth_feeHistory":
      return {
        oldestBlock: "0x1",
        baseFeePerGas: ["0x3b9aca00", "0x3b9aca00"],
        gasUsedRatio: [0.5],
        reward: [["0x3b9aca00"]],
      };
    case "eth_getTransactionByHash":
      return {
        hash: "0x" + "ab".repeat(32),
        nonce: "0x0",
        blockHash: "0x" + "cd".repeat(32),
        blockNumber: "0x1",
        transactionIndex: "0x0",
        from: TEST_ACCOUNT,
        to: "0x" + "00".repeat(20),
        value: "0x0",
        gas: "0x186a0",
        gasPrice: "0x3b9aca00",
        input: "0x",
        type: "0x2",
        chainId: "0x2105",
        v: "0x0",
        r: "0x" + "00".repeat(32),
        s: "0x" + "00".repeat(32),
      };
    case "eth_syncing":
      return false;
    case "net_listening":
      return true;
    case "web3_clientVersion":
      return "e2e-stub/1.0";
    case "eth_getTransactionReceipt":
      return {
        transactionHash: "0x" + "ab".repeat(32),
        transactionIndex: "0x0",
        blockHash: "0x" + "cd".repeat(32),
        blockNumber: "0x1",
        from: TEST_ACCOUNT,
        to: "0x" + "00".repeat(20),
        cumulativeGasUsed: "0x5208",
        gasUsed: "0x5208",
        effectiveGasPrice: "0x3b9aca00",
        contractAddress: null,
        logs: [],
        logsBloom: "0x" + "00".repeat(256),
        status: "0x1",
        type: "0x2",
      };
    case "eth_getBlockByNumber":
      return {
        number: "0x1",
        hash: "0x" + "cd".repeat(32),
        parentHash: "0x" + "00".repeat(32),
        nonce: "0x0000000000000000",
        sha3Uncles: "0x" + "00".repeat(32),
        logsBloom: "0x" + "00".repeat(256),
        transactionsRoot: "0x" + "00".repeat(32),
        stateRoot: "0x" + "00".repeat(32),
        receiptsRoot: "0x" + "00".repeat(32),
        miner: "0x" + "00".repeat(20),
        difficulty: "0x0",
        totalDifficulty: "0x0",
        extraData: "0x",
        size: "0x0",
        gasLimit: "0x1c9c380",
        gasUsed: "0x0",
        timestamp: "0x65f00000",
        transactions: [],
        uncles: [],
        baseFeePerGas: "0x3b9aca00",
      };
    default:
      return null;
  }
}

/** Route every JSON-RPC POST (single object or batch array) to the stub above. */
export type RpcStats = { calls: number; byMethod: Record<string, number> };

export async function mockBaseRpc(page: Page): Promise<RpcStats> {
  const stats: RpcStats = { calls: 0, byMethod: {} };
  const count = (m: string) => {
    stats.calls += 1;
    stats.byMethod[m] = (stats.byMethod[m] ?? 0) + 1;
  };

  await page.route("**/*", async (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.fallback();

    // Match on the payload, not the host: the app's transport has moved between public Base RPCs
    // (mainnet.base.org, Tenderly's gateway, …) and a host allowlist silently misses whichever one
    // is live, which turns receipt polling into a 60-second timeout against the real chain.
    let body: unknown;
    try {
      body = JSON.parse(req.postData() ?? "{}");
    } catch {
      return route.fallback();
    }
    const isRpc = Array.isArray(body)
      ? body.some((m) => m && typeof m === "object" && "method" in (m as object))
      : Boolean(body && typeof body === "object" && "method" in (body as object));
    if (!isRpc) return route.fallback();

    const answer = (msg: RpcRequest) => {
      count(msg.method);
      try {
        return {
          jsonrpc: "2.0" as const,
          id: msg.id ?? 1,
          result: rpcResult(msg.method, msg.params ?? []),
        };
      } catch (e) {
        const err = e as { message?: string; code?: number; data?: string };
        return {
          jsonrpc: "2.0" as const,
          id: msg.id ?? 1,
          error: { code: err.code ?? -32000, message: err.message ?? "execution reverted", data: err.data },
        };
      }
    };

    const payload = Array.isArray(body) ? body.map(answer) : answer(body as RpcRequest);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
    return;
  });

  return stats;
}

/** Announce an EIP-6963 wallet with a zero balance. */
export async function installMockWallet(page: Page, address: string = TEST_ACCOUNT) {
  await page.addInitScript((addr) => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

    const emit = (event: string, ...args: unknown[]) => {
      listeners.get(event)?.forEach((fn) => fn(...args));
    };

    const provider = {
      isMetaMask: false,
      isMockWallet: true,
      chainId: "0x2105",
      selectedAddress: addr,
      async request({ method }: { method: string; params?: unknown[] }) {
        switch (method) {
          case "eth_requestAccounts":
          case "eth_accounts":
            return [addr];
          case "eth_chainId":
            return "0x2105";
          case "wallet_switchEthereumChain":
          case "wallet_addEthereumChain":
          case "wallet_watchAsset":
            return null;
          case "eth_sendTransaction":
            return "0x" + "ab".repeat(32);
          case "personal_sign":
          case "eth_sign":
            return "0x" + "11".repeat(65);
          default:
            throw Object.assign(new Error(`mock wallet: unsupported ${method}`), { code: 4200 });
        }
      },
      on(event: string, fn: (...args: unknown[]) => void) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(fn);
        return provider;
      },
      once(event: string, fn: (...args: unknown[]) => void) {
        return provider.on(event, fn);
      },
      removeListener(event: string, fn: (...args: unknown[]) => void) {
        listeners.get(event)?.delete(fn);
        return provider;
      },
      // legacy no-ops some connectors still poke at
      enable: async () => [addr],
      send: async () => [addr],
      _emit: emit,
    };

    (window as unknown as { ethereum: unknown }).ethereum = provider;

    const info = {
      uuid: "6d1f9b4e-6d1b-4f6e-9a1a-000000000001",
      name: "Mock Wallet",
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
      rdns: "io.predictionarena.mock",
    };
    const detail = { info, provider };

    window.addEventListener("eip6963:requestProvider", () => {
      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
    });
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  }, address);
}
