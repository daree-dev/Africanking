/**
 * Configuración de los contratos de BeEnergy
 *
 * IMPORTANTE: Actualiza estas direcciones después de deployar los contratos
 *
 * Network endpoints are derived from the single validated configuration in
 * ./stellar-network so Horizon, RPC and the wallet always agree.
 */

import { APP_NETWORK } from "./stellar-network"

export const CONTRACTS = {
  // Energy token contract
  ENERGY_TOKEN: process.env.NEXT_PUBLIC_ENERGY_TOKEN_CONTRACT || "",

  // Distribution contract
  ENERGY_DISTRIBUTION: process.env.NEXT_PUBLIC_ENERGY_DISTRIBUTION_CONTRACT || "",

  // Governance contract
  COMMUNITY_GOVERNANCE: process.env.NEXT_PUBLIC_COMMUNITY_GOVERNANCE_CONTRACT || "",
}

export const STELLAR_CONFIG = {
  NETWORK: APP_NETWORK.network,
  RPC_URL: APP_NETWORK.rpcUrl,
  HORIZON_URL: APP_NETWORK.horizonUrl,
}

export const NETWORK_PASSPHRASE = APP_NETWORK.passphrase

export const ADMIN_ADDRESS = process.env.NEXT_PUBLIC_ADMIN_ADDRESS || ""
