use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

fn setup() -> (Env, CooperativeRegistryClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CooperativeRegistry);
    let client = CooperativeRegistryClient::new(&env, &contract_id);
    let factory = Address::generate(&env);
    client.initialize(&factory);
    (env, client, factory)
}

#[test]
fn registers_and_looks_up_addresses() {
    let (env, client, _factory) = setup();
    let token = Address::generate(&env);
    let distribution = Address::generate(&env);
    let governance = Address::generate(&env);

    client.register(&1, &token, &distribution, &governance);

    let record = client.get_cooperative(&1);
    assert_eq!(record.token, token);
    assert_eq!(record.distribution, distribution);
    assert_eq!(record.governance, governance);
    assert_eq!(client.get_token(&1), token);
    assert_eq!(client.get_distribution(&1), distribution);
    assert_eq!(client.get_governance(&1), governance);
}

#[test]
fn rejects_duplicate_without_overwriting() {
    let (env, client, _factory) = setup();
    let token = Address::generate(&env);
    let distribution = Address::generate(&env);
    let governance = Address::generate(&env);
    client.register(&1, &token, &distribution, &governance);

    let other = Address::generate(&env);
    let result = client.try_register(&1, &other, &other, &other);
    assert_eq!(result, Err(Ok(RegistryError::DuplicateCooperative)));

    let record = client.get_cooperative(&1);
    assert_eq!(record.token, token);
    assert_eq!(client.cooperative_count(), 1);
}

#[test]
fn rejects_unauthorized_caller() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CooperativeRegistry);
    let client = CooperativeRegistryClient::new(&env, &contract_id);
    let factory = Address::generate(&env);
    client.initialize(&factory);

    let token = Address::generate(&env);
    let distribution = Address::generate(&env);
    let governance = Address::generate(&env);

    // No auth mocked: factory auth requirement fails.
    let result = client.try_register(&1, &token, &distribution, &governance);
    assert!(result.is_err());
}

#[test]
fn rejects_register_before_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CooperativeRegistry);
    let client = CooperativeRegistryClient::new(&env, &contract_id);
    let addr = Address::generate(&env);
    let result = client.try_register(&1, &addr, &addr, &addr);
    assert_eq!(result, Err(Ok(RegistryError::NotInitialized)));
}

#[test]
fn lookup_missing_returns_not_found() {
    let (_env, client, _factory) = setup();
    let result = client.try_get_cooperative(&99);
    assert_eq!(result, Err(Ok(RegistryError::NotFound)));
}

#[test]
fn emits_versioned_registration_event() {
    let (env, client, _factory) = setup();
    let token = Address::generate(&env);
    let distribution = Address::generate(&env);
    let governance = Address::generate(&env);
    client.register(&7, &token, &distribution, &governance);

    let events = env.events().all();
    assert!(!events.is_empty());
}

#[test]
fn bounded_discovery_paginates() {
    let (env, client, _factory) = setup();
    let addr = Address::generate(&env);
    for id in 0..5u64 {
        client.register(&id, &addr, &addr, &addr);
    }
    assert_eq!(client.cooperative_count(), 5);

    let page = client.list_cooperatives(&1, &2);
    assert_eq!(page.len(), 2);
    assert_eq!(page.get(0), Some(1));
    assert_eq!(page.get(1), Some(2));

    let tail = client.list_cooperatives(&4, &10);
    assert_eq!(tail.len(), 1);
    assert_eq!(tail.get(0), Some(4));

    let empty = client.list_cooperatives(&10, &5);
    assert_eq!(empty.len(), 0);
}
