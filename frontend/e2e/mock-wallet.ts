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
      const call = (params[0] ?? {}) as { data?: string };
      const data = (call.data ?? "").toLowerCase();
      // decimals() → 6, everything else (balanceOf / allowance / pool reads) → zeroed word
      if (data.startsWith("0x313ce567")) return "0x" + (6).toString(16).padStart(64, "0");
      return "0x" + "0".repeat(64);
    }
    case "eth_sendRawTransaction":
    case "eth_sendTransaction":
      return "0x" + "ab".repeat(32);
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
export async function mockBaseRpc(page: Page) {
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = req.url();
    const isRpc = req.method() === "POST" && /base\.org|llamarpc|ankr|\.quiknode|alchemy/i.test(url);
    if (!isRpc) return route.fallback();

    let body: unknown;
    try {
      body = JSON.parse(req.postData() ?? "{}");
    } catch {
      return route.fallback();
    }

    const answer = (msg: RpcRequest) => ({
      jsonrpc: "2.0" as const,
      id: msg.id ?? 1,
      result: rpcResult(msg.method, msg.params ?? []),
    });

    const payload = Array.isArray(body) ? body.map(answer) : answer(body as RpcRequest);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
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
