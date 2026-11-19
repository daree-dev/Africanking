#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec};

/// Version tag emitted with every registry event so indexers can evolve safely.
pub const REGISTRY_EVENT_VERSION: u32 = 1;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CooperativeRecord {
    pub cooperative_id: String,
    pub token: Address,
    pub distribution: Address,
    pub governance: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegistrationEvent {
    pub version: u32,
    pub cooperative_id: String,
    pub token: Address,
    pub distribution: Address,
    pub governance: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Factory,
    Count,
    Record(String),
    IdAt(u32),
}

#[contract]
pub struct CooperativeRegistry;

#[contractimpl]
impl CooperativeRegistry {
    /// One-time initialization binding the registry to the authorized factory.
    pub fn initialize(env: Env, factory: Address) {
        if env.storage().instance().has(&DataKey::Factory) {
            panic!("registry already initialized");
        }
        env.storage().instance().set(&DataKey::Factory, &factory);
        env.storage().instance().set(&DataKey::Count, &0u32);
    }

    /// Register a cooperative. Only the authorized factory may call this.
    /// Duplicate cooperative IDs are rejected without overwriting existing entries.
    pub fn register(
        env: Env,
        cooperative_id: String,
        token: Address,
        distribution: Address,
        governance: Address,
    ) {
        let factory: Address = env
            .storage()
            .instance()
            .get(&DataKey::Factory)
            .expect("registry not initialized");
        factory.require_auth();

        let key = DataKey::Record(cooperative_id.clone());
        if env.storage().persistent().has(&key) {
            panic!("cooperative already registered");
        }

        let record = CooperativeRecord {
            cooperative_id: cooperative_id.clone(),
            token: token.clone(),
            distribution: distribution.clone(),
            governance: governance.clone(),
        };
        env.storage().persistent().set(&key, &record);

        let count: u32 = env.storage().instance().get(&DataKey::Count).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::IdAt(count), &cooperative_id);
        env.storage().instance().set(&DataKey::Count, &(count + 1));

        env.events().publish(
            (String::from_str(&env, "cooperative_registered"), REGISTRY_EVENT_VERSION),
            RegistrationEvent {
                version: REGISTRY_EVENT_VERSION,
                cooperative_id,
                token,
                distribution,
                governance,
            },
        );
    }

    /// Public lookup of a registered cooperative record.
    pub fn get(env: Env, cooperative_id: String) -> Option<CooperativeRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::Record(cooperative_id))
    }

    pub fn token_of(env: Env, cooperative_id: String) -> Option<Address> {
        Self::get(env, cooperative_id).map(|r| r.token)
    }

    pub fn distribution_of(env: Env, cooperative_id: String) -> Option<Address> {
        Self::get(env, cooperative_id).map(|r| r.distribution)
    }

    pub fn governance_of(env: Env, cooperative_id: String) -> Option<Address> {
        Self::get(env, cooperative_id).map(|r| r.governance)
    }

    pub fn is_registered(env: Env, cooperative_id: String) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Record(cooperative_id))
    }

    pub fn count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Count).unwrap_or(0)
    }

    /// Bounded discovery: list cooperative IDs in [start, start + limit).
    /// `limit` is capped to keep reads bounded.
    pub fn list(env: Env, start: u32, limit: u32) -> Vec<String> {
        const MAX_LIMIT: u32 = 50;
        let total = Self::count(env.clone());
        let mut out = Vec::new(&env);
        if start >= total {
            return out;
        }
        let capped = if limit > MAX_LIMIT { MAX_LIMIT } else { limit };
        let end = if start + capped > total {
            total
        } else {
            start + capped
        };
        let mut i = start;
        while i < end {
            if let Some(id) = env
                .storage()
                .persistent()
                .get::<DataKey, String>(&DataKey::IdAt(i))
            {
                out.push_back(id);
            }
            i += 1;
        }
        out
    }
}
