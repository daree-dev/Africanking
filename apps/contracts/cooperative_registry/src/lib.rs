#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, String};

const INSTANCE_TTL_THRESHOLD: u32 = 50_000;
const INSTANCE_TTL_EXTEND_TO: u32 = 100_000;
const PERSISTENT_TTL_THRESHOLD: u32 = 50_000;
const PERSISTENT_TTL_EXTEND_TO: u32 = 5_000_000;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CooperativeInfo {
    pub cooperative_id: String,
    pub token_contract: Address,
    pub distribution_contract: Address,
    pub governance_contract: Address,
}

#[contracttype]
enum DataKey {
    Admin,
    Factory,
    Cooperative(String),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum RegistryError {
    FactoryAlreadySet = 1,
    FactoryNotSet = 2,
    UnauthorizedFactory = 3,
    CooperativeAlreadyRegistered = 4,
}

#[contract]
pub struct CooperativeRegistry;

#[contractimpl]
impl CooperativeRegistry {
    pub fn __constructor(env: &Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
    }

    pub fn set_factory(env: Env, factory: Address) -> Result<(), RegistryError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not initialized");
        admin.require_auth();

        if env.storage().instance().has(&DataKey::Factory) {
            return Err(RegistryError::FactoryAlreadySet);
        }

        env.storage().instance().set(&DataKey::Factory, &factory);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
        Ok(())
    }

    pub fn register_cooperative(
        env: Env,
        cooperative_id: String,
        token_contract: Address,
        distribution_contract: Address,
        governance_contract: Address,
    ) -> Result<(), RegistryError> {
        let factory: Address = env
            .storage()
            .instance()
            .get(&DataKey::Factory)
            .ok_or(RegistryError::FactoryNotSet)?;

        if env.invoker() != factory {
            return Err(RegistryError::UnauthorizedFactory);
        }

        let key = DataKey::Cooperative(cooperative_id.clone());
        if env.storage().persistent().has(&key) {
            return Err(RegistryError::CooperativeAlreadyRegistered);
        }

        env.storage().persistent().set(
            &key,
            &CooperativeInfo {
                cooperative_id,
                token_contract,
                distribution_contract,
                governance_contract,
            },
        );
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);

        Ok(())
    }

    pub fn get_cooperative(env: Env, cooperative_id: String) -> Option<CooperativeInfo> {
        let key = DataKey::Cooperative(cooperative_id);
        let value = env.storage().persistent().get(&key);
        if value.is_some() {
            env.storage().persistent().extend_ttl(
                &key,
                PERSISTENT_TTL_THRESHOLD,
                PERSISTENT_TTL_EXTEND_TO,
            );
        }
        value
    }

    pub fn get_factory(env: Env) -> Option<Address> {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
        env.storage().instance().get(&DataKey::Factory)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn only_configured_factory_can_register_cooperatives() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let factory = Address::generate(&env);
        let registry_id = env.register(CooperativeRegistry, (&admin,));
        let registry = CooperativeRegistryClient::new(&env, &registry_id);

        registry.set_factory(&factory);
        let result = registry.try_register_cooperative(
            &String::from_str(&env, "sample-coop"),
            &admin,
            &admin,
            &admin,
        );
        assert_eq!(result, Err(Ok(RegistryError::UnauthorizedFactory)));

        let token = Address::generate(&env);
        let distribution = Address::generate(&env);
        let governance = Address::generate(&env);
        env.as_contract(&factory, || {
            registry.register_cooperative(
                &String::from_str(&env, "sample-coop"),
                &token,
                &distribution,
                &governance,
            );
        });

        let entry = registry
            .get_cooperative(&String::from_str(&env, "sample-coop"))
            .unwrap();
        assert_eq!(entry.token_contract, token);
        assert_eq!(entry.distribution_contract, distribution);
        assert_eq!(entry.governance_contract, governance);
    }
}
