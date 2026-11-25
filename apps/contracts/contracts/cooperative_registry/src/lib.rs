#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Vec};

/// Storage keys for the cooperative registry.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Address of the authorized factory allowed to register cooperatives.
    Factory,
    /// Registered cooperative record keyed by cooperative id.
    Cooperative(u64),
    /// Ordered list of registered cooperative ids for bounded discovery.
    CooperativeIds,
}

/// A registered cooperative and its associated contract addresses.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CooperativeRecord {
    pub token: Address,
    pub distribution: Address,
    pub governance: Address,
}

#[contracterror]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RegistryError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    DuplicateCooperative = 4,
    NotFound = 5,
}

/// Version tag emitted with registration events so indexers can evolve safely.
const EVENT_VERSION: u32 = 1;

#[contract]
pub struct CooperativeRegistry;

#[contractimpl]
impl CooperativeRegistry {
    /// Initialize the registry with the authorized factory address.
    pub fn initialize(env: Env, factory: Address) -> Result<(), RegistryError> {
        if env.storage().instance().has(&DataKey::Factory) {
            return Err(RegistryError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Factory, &factory);
        Ok(())
    }

    /// Register a cooperative. Only the authorized factory may call this.
    /// Rejects duplicate cooperative ids without overwriting existing entries.
    pub fn register(
        env: Env,
        cooperative_id: u64,
        token: Address,
        distribution: Address,
        governance: Address,
    ) -> Result<(), RegistryError> {
        let factory: Address = env
            .storage()
            .instance()
            .get(&DataKey::Factory)
            .ok_or(RegistryError::NotInitialized)?;
        factory.require_auth();

        let key = DataKey::Cooperative(cooperative_id);
        if env.storage().persistent().has(&key) {
            return Err(RegistryError::DuplicateCooperative);
        }

        let record = CooperativeRecord {
            token: token.clone(),
            distribution: distribution.clone(),
            governance: governance.clone(),
        };
        env.storage().persistent().set(&key, &record);

        let mut ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::CooperativeIds)
            .unwrap_or_else(|| Vec::new(&env));
        ids.push_back(cooperative_id);
        env.storage().persistent().set(&DataKey::CooperativeIds, &ids);

        env.events().publish(
            (soroban_sdk::symbol_short!("register"), EVENT_VERSION),
            (cooperative_id, token, distribution, governance),
        );
        Ok(())
    }

    /// Public lookup of a cooperative's token, distribution, and governance addresses.
    pub fn get_cooperative(env: Env, cooperative_id: u64) -> Result<CooperativeRecord, RegistryError> {
        env.storage()
            .persistent()
            .get(&DataKey::Cooperative(cooperative_id))
            .ok_or(RegistryError::NotFound)
    }

    /// Public lookup of the token address for a cooperative.
    pub fn get_token(env: Env, cooperative_id: u64) -> Result<Address, RegistryError> {
        Ok(Self::get_cooperative(env, cooperative_id)?.token)
    }

    /// Public lookup of the distribution address for a cooperative.
    pub fn get_distribution(env: Env, cooperative_id: u64) -> Result<Address, RegistryError> {
        Ok(Self::get_cooperative(env, cooperative_id)?.distribution)
    }

    /// Public lookup of the governance address for a cooperative.
    pub fn get_governance(env: Env, cooperative_id: u64) -> Result<Address, RegistryError> {
        Ok(Self::get_cooperative(env, cooperative_id)?.governance)
    }

    /// Total number of registered cooperatives.
    pub fn cooperative_count(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get::<DataKey, Vec<u64>>(&DataKey::CooperativeIds)
            .map(|ids| ids.len())
            .unwrap_or(0)
    }

    /// Bounded discovery: return up to `limit` cooperative ids starting at `start`.
    pub fn list_cooperatives(env: Env, start: u32, limit: u32) -> Vec<u64> {
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&DataKey::CooperativeIds)
            .unwrap_or_else(|| Vec::new(&env));
        let total = ids.len();
        let mut out = Vec::new(&env);
        if start >= total || limit == 0 {
            return out;
        }
        let end = core::cmp::min(start.saturating_add(limit), total);
        let mut i = start;
        while i < end {
            out.push_back(ids.get_unchecked(i));
            i += 1;
        }
        out
    }
}

#[cfg(test)]
mod test;
