# Wallet signing guard

Every browser-wallet contract write (`mintEnergy`, `burnEnergy`, `transfer`, `recordGeneration`) runs through `executeContractWrite` in `apps/web/lib/wallet/contract-write.ts`, which calls these steps in order:

1. **Preflight** with *live* wallet state (`kit.getAddress()` / `kit.getNetwork()`, not cached localStorage). It refuses when:
   - the app's network configuration is invalid
   - no wallet is connected
   - the wallet reports a different network or passphrase
   - the target contract isn't configured
   - no cooperative is selected
   - the amount is not a positive number
2. **Build and simulate** (`prepareTransaction`), so contract errors surface before the user is asked anything.
3. **Intent review**: `TransactionIntentProvider` shows cooperative, operation, energy amount (kWh = HDROP), target contract and function, recipient, signer and network. The wallet is asked to sign only after the user confirms. Cancelling never reaches the wallet.
4. **Signature** with the configured passphrase and the approved signer address.
5. **Revalidation** after the wallet interaction:
   - the wallet must still be on the same account and network
   - the signed envelope's hash must equal the approved transaction's hash, so the wallet can't change it
   - the signature must verify for the configured network passphrase, which catches wallets that don't report their network but signed for another one
6. **Submit and confirm**: success is reported only after RPC returns `SUCCESS`. Polling is bounded, and a timeout returns the hash so the user can check before retrying.

Errors are `WalletWriteError` with a `code` (`wrong_network`, `user_cancelled`, `signature_rejected`, `account_changed`, `network_changed`, `tx_tampered`, `tx_failed`, `confirmation_timeout`, …). Nothing is submitted for any error raised before step 6.

## Breaking change for callers

The write methods now take a cooperative reference: `mintEnergy(to, kwh, { id, name })`, `burnEnergy(kwh, coop)`, `transfer(to, kwh, coop)`, `recordGeneration(kwh, coop)`. The admin mint panel now asks for a cooperative, limited to cooperatives the session administers (all for super admins).

## Rollout notes

- No data migration.
- Wallets that don't implement `getNetwork` were previously recorded as "on the configured network". They are now recorded as "unverified": the review dialog warns, and the signature check enforces the network.
- `recordGeneration` now rounds kWh to stroops like the mint path, instead of truncating.
