"use client";

import {
  ISupportedWallet,
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
} from "@creit.tech/stellar-wallets-kit";
import { Horizon } from "@stellar/stellar-sdk";
import { storage } from "./storage"
import { networkPassphrase, stellarNetwork, horizonUrl } from "./stellar-config";

export interface LiveWalletInfo {
  address: string | null
  network: string | null
  networkPassphrase: string | null
}

/**
 * Ask the wallet extension directly for its current account and network,
 * bypassing cached localStorage state. Used to revalidate around signing.
 */
export const getLiveWalletInfo = async (): Promise<LiveWalletInfo> => {
  const kit = getKit();
  let address: string | null = null;
  try {
    address = (await kit.getAddress()).address || null;
  } catch {
    address = null;
  }
  try {
    const net = await kit.getNetwork();
    return { address, network: net.network || null, networkPassphrase: net.networkPassphrase || null };
  } catch {
    return { address, network: null, networkPassphrase: null };
  }
};

// Initialize Stellar Wallets Kit
let kitInstance: StellarWalletsKit | null = null;

function getKit(): StellarWalletsKit {
  if (typeof window === "undefined") {
    throw new Error("StellarWalletsKit can only be initialized in the browser");
  }

  if (!kitInstance) {
    kitInstance = new StellarWalletsKit({
      network: networkPassphrase as WalletNetwork,
      modules: allowAllModules(),
    });
  }

  return kitInstance;
}

export type MappedBalances = Record<string, Horizon.HorizonApi.BalanceLine>;

export interface ConnectResult {
  address: string
  network: string
  networkPassphrase: string
}

export const connectWallet = async (): Promise<ConnectResult | null> => {
  const kit = getKit();
  let resolveResult: (r: ConnectResult | null) => void;
  const resultPromise = new Promise<ConnectResult | null>((resolve) => {
    resolveResult = resolve;
  });

  await kit.openModal({
    modalTitle: "Conectar Wallet",
    onWalletSelected: (option: ISupportedWallet) => {
      const selectedId = option.id;
      kit.setWallet(selectedId);

      kit.getAddress().then(async (addrResult) => {
        if (!addrResult.address) {
          storage.setItem("walletId", "");
          storage.setItem("walletAddress", "");
          resolveResult(null);
          return;
        }

        storage.setItem("walletId", selectedId);
        storage.setItem("walletAddress", addrResult.address);

        let networkStr = "";
        let passphraseStr = "";
        try {
          const netResult = await kit.getNetwork();
          networkStr = netResult.network || "";
          storage.setItem("walletNetwork", networkStr);
          passphraseStr = netResult.networkPassphrase || "";
          storage.setItem("networkPassphrase", passphraseStr);
        } catch {
          // Wallet doesn't report its network. Leave it empty rather than
          // assuming the configured network: write actions then rely on the
          // signature check, and the UI shows the network as unverified.
          storage.setItem("walletNetwork", "");
          storage.setItem("networkPassphrase", "");
        }

        resolveResult({ address: addrResult.address, network: networkStr, networkPassphrase: passphraseStr });
      }).catch(() => {
        resolveResult(null);
      });
    },
  });

  return resultPromise;
};

export const disconnectWallet = async (): Promise<void> => {
  const kit = getKit();
  await kit.disconnect();
  storage.removeItem("walletId");
  storage.removeItem("walletAddress");
  storage.removeItem("walletNetwork");
  storage.removeItem("networkPassphrase");
};

// Create Horizon server instance — same configured endpoint as activity history
const horizon = new Horizon.Server(horizonUrl, {
  allowHttp: stellarNetwork === "LOCAL",
});

const formatter = new Intl.NumberFormat();

export const fetchBalances = async (address: string): Promise<MappedBalances> => {
  try {
    const { balances } = await horizon.accounts().accountId(address).call();
    const mapped = balances.reduce((acc, b) => {
      b.balance = formatter.format(Number(b.balance));
      const key =
        b.asset_type === "native"
          ? "xlm"
          : b.asset_type === "liquidity_pool_shares"
            ? b.liquidity_pool_id
            : `${b.asset_code}:${b.asset_issuer}`;
      acc[key] = b;
      return acc;
    }, {} as MappedBalances);
    return mapped;
  } catch (err) {
    if (!(err instanceof Error && err.message.match(/not found/i))) {
      console.error(err);
    }
    return {};
  }
};

export const wallet = () => getKit();