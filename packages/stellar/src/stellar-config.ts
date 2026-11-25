import { WalletNetwork } from "@creit.tech/stellar-wallets-kit";

export type NetworkType = "mainnet" | "testnet" | "futurenet" | "custom";

export interface Network {
  id: NetworkType;
  label: string;
  passphrase: string;
  rpcUrl: string;
  horizonUrl: string;
}

// Next.js only inlines NEXT_PUBLIC_* values for literal `process.env.X`
// access, so a dynamic `process.env[key]` is always undefined in the browser.
// Keep these reads literal.
const PUBLIC_ENV: Record<string, string | undefined> = {
  NEXT_PUBLIC_STELLAR_NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
  NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE: process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE,
  NEXT_PUBLIC_STELLAR_RPC_URL: process.env.NEXT_PUBLIC_STELLAR_RPC_URL,
  NEXT_PUBLIC_STELLAR_HORIZON_URL: process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL,
};

const getEnvVar = (key: string, fallback: string): string => PUBLIC_ENV[key] || fallback;

export const stellarNetwork = getEnvVar("NEXT_PUBLIC_STELLAR_NETWORK", "TESTNET") as
  | "PUBLIC"
  | "FUTURENET"
  | "TESTNET"
  | "LOCAL";

const passphraseForNetwork = (network: string): string => {
  switch (network) {
    case "PUBLIC":
      return WalletNetwork.PUBLIC;
    case "FUTURENET":
      return WalletNetwork.FUTURENET;
    case "LOCAL":
      return WalletNetwork.STANDALONE;
    default:
      return WalletNetwork.TESTNET;
  }
};

// Derive the passphrase from the configured network so the wallet kit can
// never default to TESTNET while the app is configured for another network.
export const networkPassphrase = getEnvVar(
  "NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE",
  passphraseForNetwork(stellarNetwork)
);

export const rpcUrl = getEnvVar("NEXT_PUBLIC_STELLAR_RPC_URL", getRpcHost(stellarNetwork));

export const horizonUrl = getEnvVar("NEXT_PUBLIC_STELLAR_HORIZON_URL", getHorizonHost(stellarNetwork));

const networkToId = (network: string): NetworkType => {
  switch (network) {
    case "PUBLIC":
      return "mainnet";
    case "TESTNET":
      return "testnet";
    case "FUTURENET":
      return "futurenet";
    default:
      return "custom";
  }
};

export const network: Network = {
  id: networkToId(stellarNetwork),
  label: stellarNetwork.toLowerCase(),
  passphrase: networkPassphrase,
  rpcUrl: rpcUrl,
  horizonUrl: horizonUrl,
};

export function getHorizonHost(mode: string): string {
  switch (mode) {
    case "LOCAL":
      return "http://localhost:8000";
    case "FUTURENET":
      return "https://horizon-futurenet.stellar.org";
    case "TESTNET":
      return "https://horizon-testnet.stellar.org";
    case "PUBLIC":
      return "https://horizon.stellar.org";
    default:
      return "https://horizon-testnet.stellar.org";
  }
}

export function getRpcHost(mode: string): string {
  switch (mode) {
    case "LOCAL":
      return "http://localhost:8000/rpc";
    case "FUTURENET":
      return "https://rpc-futurenet.stellar.org";
    case "TESTNET":
      return "https://soroban-testnet.stellar.org";
    case "PUBLIC":
      return "https://soroban.stellar.org";
    default:
      return "https://soroban-testnet.stellar.org";
  }
}