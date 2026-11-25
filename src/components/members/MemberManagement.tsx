'use client';

import { useMemo, useState } from 'react';

export type MembershipState =
  | 'invited'
  | 'active'
  | 'suspended'
  | 'departed';

export type MemberRole = 'member' | 'steward' | 'coordinator';

export interface MemberLifecycleEvent {
  id: string;
  memberId: string;
  type: 'join' | 'role-change' | 'suspension' | 'departure';
  fromState: MembershipState | null;
  toState: MembershipState;
  fromRole: MemberRole | null;
  toRole: MemberRole | null;
  effectiveDate: string;
  recordedAt: string;
  actor: string;
  note?: string;
}

export interface Member {
  id: string;
  name: string;
  state: MembershipState;
  role: MemberRole;
  effectiveDate: string;
  history: MemberLifecycleEvent[];
}

const PERMITTED_TRANSITIONS: Record<MembershipState, MembershipState[]> = {
  invited: ['active', 'departed'],
  active: ['suspended', 'departed'],
  suspended: ['active', 'departed'],
  departed: [],
};

export function canTransition(
  from: MembershipState,
  to: MembershipState,
): boolean {
  return PERMITTED_TRANSITIONS[from].includes(to);
}

const STATE_LABELS: Record<MembershipState, string> = {
  invited: 'Invited',
  active: 'Active',
  suspended: 'Suspended',
  departed: 'Departed',
};

const ROLE_LABELS: Record<MemberRole, string> = {
  member: 'Member',
  steward: 'Steward',
  coordinator: 'Coordinator',
};

const ALL_STATES: MembershipState[] = [
  'invited',
  'active',
  'suspended',
  'departed',
];

const ALL_ROLES: MemberRole[] = ['member', 'steward', 'coordinator'];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function makeEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const INITIAL_MEMBERS: Member[] = [
  {
    id: 'm1',
    name: 'Ada Rivera',
    state: 'active',
    role: 'coordinator',
    effectiveDate: '2024-01-15',
    history: [
      {
        id: 'evt_m1_join',
        memberId: 'm1',
        type: 'join',
        fromState: null,
        toState: 'active',
        fromRole: null,
        toRole: 'coordinator',
        effectiveDate: '2024-01-15',
        recordedAt: '2024-01-15T09:00:00.000Z',
        actor: 'cooperative-admin',
      },
    ],
  },
  {
    id: 'm2',
    name: 'Ben Okafor',
    state: 'active',
    role: 'member',
    effectiveDate: '2024-02-01',
    history: [
      {
        id: 'evt_m2_join',
        memberId: 'm2',
        type: 'join',
        fromState: null,
        toState: 'active',
        fromRole: null,
        toRole: 'member',
        effectiveDate: '2024-02-01',
        recordedAt: '2024-02-01T09:00:00.000Z',
        actor: 'cooperative-admin',
      },
    ],
  },
];

export default function MemberManagement() {
  const [members, setMembers] = useState<Member[]>(INITIAL_MEMBERS);
  const [selectedId, setSelectedId] = useState<string>(INITIAL_MEMBERS[0].id);
  const [targetState, setTargetState] = useState<MembershipState>('active');
  const [targetRole, setTargetRole] = useState<MemberRole>('member');
  const [effectiveDate, setEffectiveDate] = useState<string>(todayIso());
  const [note, setNote] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => members.find((m) => m.id === selectedId) ?? null,
    [members, selectedId],
  );

  function applyTransition(
    member: Member,
    nextState: MembershipState,
    nextRole: MemberRole,
    date: string,
    noteText: string,
  ): Member {
    const stateChanged = nextState !== member.state;
    const roleChanged = nextRole !== member.role;

    let type: MemberLifecycleEvent['type'];
    if (member.state === 'invited' && nextState === 'active') {
      type = 'join';
    } else if (nextState === 'departed') {
      type = 'departure';
    } else if (nextState === 'suspended') {
      type = 'suspension';
    } else if (roleChanged) {
      type = 'role-change';
    } else {
      type = 'role-change';
    }

    const event: MemberLifecycleEvent = {
      id: makeEventId(),
      memberId: member.id,
      type,
      fromState: member.state,
      toState: nextState,
      fromRole: member.role,
      toRole: nextRole,
      effectiveDate: date,
      recordedAt: new Date().toISOString(),
      actor: 'current-user',
      note: noteText.trim() ? noteText.trim() : undefined,
    };

    return {
      ...member,
      state: stateChanged ? nextState : member.state,
      role: roleChanged ? nextRole : member.role,
      effectiveDate: stateChanged || roleChanged ? date : member.effectiveDate,
      history: [...member.history, event],
    };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!selected) {
      setError('Select a member first.');
      return;
    }

    if (!effectiveDate) {
      setError('An effective date is required.');
      return;
    }

    if (effectiveDate < selected.effectiveDate) {
      setError(
        `Effective date cannot precede the member's current effective date (${selected.effectiveDate}).`,
      );
      return;
    }

    const stateChanged = targetState !== selected.state;
    const roleChanged = targetRole !== selected.role;

    if (!stateChanged && !roleChanged) {
      setError('No change requested.');
      return;
    }

    if (stateChanged && !canTransition(selected.state, targetState)) {
      setError(
        `Cannot move from ${STATE_LABELS[selected.state]} to ${STATE_LABELS[targetState]}.`,
      );
      return;
    }

    if (selected.state === 'departed') {
      setError('Departed members cannot be modified; history is preserved.');
      return;
    }

    setMembers((prev) =>
      prev.map((m) =>
        m.id === selected.id
          ? applyTransition(m, targetState, targetRole, effectiveDate, note)
          : m,
      ),
    );
    setNote('');
  }

  return (
    <section className="member-management">
      <header>
        <h2>Member lifecycle</h2>
        <p>
          Generation credits are assigned to cooperative members. Historical
          allocations and reports remain stable when a member becomes inactive.
        </p>
      </header>

      <div className="member-management__layout">
        <ul className="member-management__list">
          {members.map((member) => (
            <li key={member.id}>
              <button
                type="button"
                aria-pressed={member.id === selectedId}
                onClick={() => {
                  setSelectedId(member.id);
                  setTargetState(member.state);
                  setTargetRole(member.role);
                  setEffectiveDate(member.effectiveDate);
                  setError(null);
                }}
              >
                <span className="member-management__name">{member.name}</span>
                <span className="member-management__meta">
                  {STATE_LABELS[member.state]} · {ROLE_LABELS[member.role]}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {selected && (
          <div className="member-management__detail">
            <h3>{selected.name}</h3>
            <p>
              Current: {STATE_LABELS[selected.state]} ·{' '}
              {ROLE_LABELS[selected.role]} (effective {selected.effectiveDate})
            </p>

            <form onSubmit={handleSubmit}>
              <label>
                Membership state
                <select
                  value={targetState}
                  onChange={(e) =>
                    setTargetState(e.target.value as MembershipState)
                  }
                >
                  {ALL_STATES.map((state) => (
                    <option key={state} value={state}>
                      {STATE_LABELS[state]}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Role
                <select
                  value={targetRole}
                  onChange={(e) =>
                    setTargetRole(e.target.value as MemberRole)
                  }
                >
                  {ALL_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Effective date
                <input
                  type="date"
                  value={effectiveDate}
                  min={selected.effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                />
              </label>

              <label>
                Note (optional)
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>

              {error && (
                <p role="alert" className="member-management__error">
                  {error}
                </p>
              )}

              <button type="submit">Record change</button>
            </form>

            <h4>Audit history</h4>
            <ol className="member-management__history">
              {selected.history.map((event) => (
                <li key={event.id}>
                  <strong>{event.type}</strong> — effective {event.effectiveDate}
                  {event.fromState && event.toState !== event.fromState
                    ? ` · ${STATE_LABELS[event.fromState]} → ${STATE_LABELS[event.toState]}`
                    : ''}
                  {event.fromRole && event.toRole !== event.fromRole
                    ? ` · ${ROLE_LABELS[event.fromRole]} → ${ROLE_LABELS[event.toRole]}`
                    : ''}
                  {event.note ? ` · ${event.note}` : ''}
                  <span className="member-management__recorded">
                    {' '}
                    (recorded {event.recordedAt} by {event.actor})
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
