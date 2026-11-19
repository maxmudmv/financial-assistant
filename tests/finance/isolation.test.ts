import { describe, expect, it } from 'vitest';
import {
  canUserAccessAccount,
  canUserMutateTransaction,
  canUserViewTransaction,
  type AccountAccessRecord,
  type TransactionAccessRecord,
} from '../../server/finance/access';

describe('Account visibility, private transactions & cross-workspace isolation', () => {
  const familyWorkspaceId = 'ws-family-1';
  const otherWorkspaceId = 'ws-other-2';

  const sharedAccount: AccountAccessRecord = {
    id: 'acc-shared',
    workspace_id: familyWorkspaceId,
    owner_user_id: 'user-owner',
    visibility: 'workspace',
    allowed_member_ids: [],
  };

  const privateAccount: AccountAccessRecord = {
    id: 'acc-private',
    workspace_id: familyWorkspaceId,
    owner_user_id: 'user-owner',
    visibility: 'private',
    allowed_member_ids: [],
  };

  const restrictedAccount: AccountAccessRecord = {
    id: 'acc-selected',
    workspace_id: familyWorkspaceId,
    owner_user_id: 'user-owner',
    visibility: 'selected_members',
    allowed_member_ids: ['user-spouse'],
  };

  it('blocks access to accounts belonging to another workspace', () => {
    expect(canUserAccessAccount(sharedAccount, 'user-owner', otherWorkspaceId)).toBe(false);
  });

  it('enforces private and selected_members account visibility inside family workspaces', () => {
    expect(canUserAccessAccount(privateAccount, 'user-owner', familyWorkspaceId)).toBe(true);
    expect(canUserAccessAccount(privateAccount, 'user-spouse', familyWorkspaceId)).toBe(false);

    expect(canUserAccessAccount(restrictedAccount, 'user-owner', familyWorkspaceId)).toBe(true);
    expect(canUserAccessAccount(restrictedAccount, 'user-spouse', familyWorkspaceId)).toBe(true);
    expect(canUserAccessAccount(restrictedAccount, 'user-child', familyWorkspaceId)).toBe(false);
  });

  it('keeps private transactions confidential even on workspace-visible accounts', () => {
    const privateTx: TransactionAccessRecord = {
      id: 'tx-1',
      workspace_id: familyWorkspaceId,
      account_id: sharedAccount.id,
      created_by: 'user-owner',
      is_private: true,
    };

    expect(canUserViewTransaction(privateTx, sharedAccount, 'user-owner', familyWorkspaceId)).toBe(
      true,
    );
    expect(canUserViewTransaction(privateTx, sharedAccount, 'user-spouse', familyWorkspaceId)).toBe(
      false,
    );
  });

  it('enforces RBAC mutation rules: read_only cannot mutate, admins cannot edit private transactions', () => {
    const sharedTx: TransactionAccessRecord = {
      id: 'tx-shared',
      workspace_id: familyWorkspaceId,
      account_id: sharedAccount.id,
      created_by: 'user-member',
      is_private: false,
    };
    const privateTx: TransactionAccessRecord = {
      ...sharedTx,
      id: 'tx-priv',
      is_private: true,
    };

    expect(canUserMutateTransaction(sharedTx, 'user-member', 'read_only')).toBe(false);
    expect(canUserMutateTransaction(sharedTx, 'user-member', 'member')).toBe(true);
    expect(canUserMutateTransaction(sharedTx, 'user-admin', 'admin')).toBe(true);
    expect(canUserMutateTransaction(sharedTx, 'user-other-member', 'member')).toBe(false);

    // Even workspace admin cannot mutate another user's private transaction
    expect(canUserMutateTransaction(privateTx, 'user-admin', 'admin')).toBe(false);
    expect(canUserMutateTransaction(privateTx, 'user-member', 'member')).toBe(true);
  });
});
