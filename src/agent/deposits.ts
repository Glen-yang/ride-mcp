import QRCode from "qrcode";
import { Contract, JsonRpcProvider, FetchRequest } from "ethers";
import { AgentError } from "./contracts.js";
import { cash, D, uid, now } from "./domain.js";

export interface Deposit {
  id: string;
  market: "perps" | "prediction";
  asset: "USDC" | "USDT";
  network: string;
  address: string;
  provider: "wallet" | "polymarket_bridge";
  created_at: number;
  baseline_wallet_usdc?: string;
  amount_usdc?: string;
  asset_contracts?: string[];
}
const chains: Record<string, string> = {
  Ethereum: "1",
  Arbitrum: "42161",
  Base: "8453",
  Polygon: "137",
};
const bridgeUrl = "https://bridge.polymarket.com";
const validAddress = (value: unknown): value is string =>
  typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
export class DepositReads {
  constructor(
    private core: (operation: string, input: unknown) => Promise<any>,
    private network: "mainnet" | "testnet",
    private request = fetch,
  ) {}
  private async bridge(path: string, body?: unknown): Promise<any> {
    const response = await this.request(`${bridgeUrl}/${path}`, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(12000),
      redirect: "error",
    });
    if (!response.ok)
      throw new AgentError(
        "DEPOSIT_PROVIDER_UNAVAILABLE",
        "Deposit provider did not return verified funding details.",
        true,
        503,
      );
    return response.json();
  }
  async options() {
    const routes: any[] =
      this.network === "mainnet"
        ? [
            {
              market: "perps",
              asset: "USDC",
              network: "Arbitrum",
              destination: "Ride funding wallet",
              activation_required: true,
            },
          ]
        : [];
    const supported = await this.bridge("supported-assets");
    for (const item of supported.supportedAssets ??
      supported.supported_assets ??
      []) {
      const symbol = item.token?.symbol ?? item.symbol,
        chain = String(item.chainId ?? item.chain_id);
      const network = Object.keys(chains).find((n) => chains[n] === chain);
      if (
        network &&
        ["USDC", "USDT"].includes(symbol) &&
        validAddress(item.token?.address)
      )
        routes.push({
          market: "prediction",
          asset: symbol,
          network,
          min_deposit_usd: item.minCheckoutUsd ?? item.min_deposit_usd ?? null,
          destination: "Prediction account",
          activation_required: false,
        });
    }
    return {
      routes,
      notes: [
        "Only verified provider routes are offered. Sending to a funding wallet does not fund Hyperliquid until the existing Ride deposit step is completed.",
      ],
    };
  }
  private async walletBalance(address: string): Promise<string> {
    const request = new FetchRequest(
      process.env.RIDE_AGENT_ARBITRUM_RPC_URL ?? "https://arb1.arbitrum.io/rpc",
    );
    request.timeout = 12000;
    const rpc = new JsonRpcProvider(request, 42161, { staticNetwork: true });
    try {
      if (Number(await rpc.send("eth_chainId", [])) !== 42161)
        throw new AgentError(
          "DEPOSIT_NETWORK_MISMATCH",
          "Funding RPC returned a different chain; no deposit address is shown.",
          true,
          503,
        );
      const token = new Contract(
        "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        ["function balanceOf(address) view returns (uint256)"],
        rpc,
      );
      const balance = await token.balanceOf(address);
      return cash(D(balance.toString()).div(1e6));
    } finally {
      rpc.destroy();
    }
  }
  async address(
    user: string,
    input: any,
    portfolioId?: string,
  ): Promise<Deposit> {
    if (input.market === "perps") {
      if (
        this.network !== "mainnet" ||
        input.asset !== "USDC" ||
        input.network !== "Arbitrum"
      )
        throw new AgentError(
          "UNSUPPORTED_DEPOSIT_ROUTE",
          "Perps funding currently accepts native USDC on Arbitrum into the Ride funding wallet; complete the venue deposit in Ride.",
          false,
          400,
        );
      const owned = await this.core("perps_wallet", { user_id: user });
      if (!validAddress(owned.master))
        throw new AgentError(
          "ACCOUNT_NOT_READY",
          "Prepare your existing Ride trading account before requesting an address.",
        );
      return {
        id: uid("deposit"),
        market: "perps",
        asset: "USDC",
        network: "Arbitrum",
        address: owned.master,
        provider: "wallet",
        created_at: now(),
        baseline_wallet_usdc: await this.walletBalance(owned.master),
        ...(input.amount_usdc ? { amount_usdc: cash(input.amount_usdc) } : {}),
      };
    }
    const supported = await this.bridge("supported-assets");
    const assetContracts = (supported.supportedAssets ?? [])
      .filter(
        (item: any) =>
          String(item.chainId) === chains[input.network] &&
          item.token?.symbol === input.asset &&
          validAddress(item.token?.address),
      )
      .map((item: any) => item.token.address.toLowerCase());
    const route = (await this.options()).routes.find(
      (r) =>
        r.market === input.market &&
        r.asset === input.asset &&
        r.network === input.network,
    );
    if (!route)
      throw new AgentError(
        "UNSUPPORTED_DEPOSIT_ROUTE",
        "This asset/network route is not currently supported by the provider.",
        false,
        400,
      );
    if (
      input.amount_usdc &&
      route.min_deposit_usd &&
      D(input.amount_usdc).lt(route.min_deposit_usd)
    )
      throw new AgentError(
        "DEPOSIT_BELOW_MINIMUM",
        "The amount is below the provider's current deposit minimum.",
        false,
        400,
      );
    const owned = await this.core("prediction_wallet", {
      user_id: user,
      portfolio_id: portfolioId ?? null,
    });
    if (!validAddress(owned.wallet))
      throw new AgentError(
        "ACCOUNT_NOT_READY",
        "Prepare your existing prediction account in Ride first.",
      );
    const response = await this.bridge("deposit", { address: owned.wallet });
    const address = response.address?.evm ?? response.addresses?.evm;
    if (!validAddress(address))
      throw new AgentError(
        "DEPOSIT_PROVIDER_UNAVAILABLE",
        "The provider returned an invalid deposit address.",
        true,
        503,
      );
    return {
      id: uid("deposit"),
      market: "prediction",
      asset: input.asset,
      network: input.network,
      address,
      provider: "polymarket_bridge",
      asset_contracts: assetContracts,
      created_at: now(),
      ...(input.amount_usdc ? { amount_usdc: cash(input.amount_usdc) } : {}),
    };
  }
  async status(deposit: Deposit) {
    if (deposit.provider === "wallet") {
      const balance = await this.walletBalance(deposit.address),
        received = D(balance).minus(deposit.baseline_wallet_usdc ?? balance);
      return {
        deposit_id: deposit.id,
        status: received.gt(0)
          ? "wallet_balance_increased"
          : "awaiting_deposit",
        received_usdc: received.gt(0) ? cash(received) : null,
        available_to_copy: false,
        next_action:
          "Open Ride to complete the Arbitrum wallet-to-Hyperliquid deposit, then refresh your saved plan. Wallet balance changes alone do not prove a specific transfer or trading credit.",
      };
    }
    const response = await this.bridge(`status/${deposit.address}`);
    const transactions = (response.transactions ?? [])
      .filter(
        (t: any) =>
          Number(t.createdTimeMs) >= deposit.created_at &&
          String(t.fromChainId) === chains[deposit.network] &&
          !!deposit.asset_contracts?.includes(
            String(t.fromTokenAddress).toLowerCase(),
          ),
      )
      .map((t: any) => ({
        status: String(t.status),
        at: Number(t.createdTimeMs),
        transaction_hash: /^0x[a-fA-F0-9]{64}$/.test(t.txHash)
          ? t.txHash
          : null,
      }));
    return {
      deposit_id: deposit.id,
      status: transactions.some((t: any) => t.status === "COMPLETED")
        ? "provider_completed"
        : transactions.some((t: any) => t.status === "FAILED")
          ? "failed"
          : transactions.length
            ? "processing"
            : "awaiting_deposit",
      transactions,
      available_to_copy: null,
      next_action:
        "Refresh the saved plan; only verified available account collateral can authorize copying.",
    };
  }
}
export async function depositView(deposit: Deposit) {
  return {
    ...deposit,
    baseline_wallet_usdc: undefined,
    asset_contracts: undefined,
    qr_data_url: await QRCode.toDataURL(deposit.address, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 240,
    }),
    activation_required: deposit.provider === "wallet",
    destination:
      deposit.provider === "wallet"
        ? "Ride funding wallet"
        : "Prediction bridge",
    instructions:
      deposit.provider === "wallet"
        ? "Send only native USDC on Arbitrum to this owned funding wallet. Complete the venue deposit in Ride before copying."
        : "Use only the selected supported asset and network. Check provider status before refreshing available collateral.",
  };
}
