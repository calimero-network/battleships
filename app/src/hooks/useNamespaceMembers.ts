import { useCallback, useEffect, useRef, useState } from 'react';
import { useMero } from '@calimero-network/mero-react';
import type { GroupMember } from '@calimero-network/mero-react';

// Local replacement for mero-react's `useGroupMembers`. The mero-js SDK at
// v2.0.0 (and mero-react v2.2.0 transitively) declares the
// `listGroupMembers` response as `{ data: GroupMember[], selfIdentity? }`,
// but the merod admin API actually returns `{ members, selfIdentity }`.
// The hook in mero-react reads `response.data ?? []`, which is always
// undefined → empty array, so the lobby UI shows "0 members online" even
// when the user is the sole admin.
//
// Upstream fixes are filed in mero-js + mero-react. Until those land and
// we bump the deps, this hook reads `members` directly. The shape it
// returns matches mero-react's `useGroupMembers` so swapping back is a
// one-line change.
export interface UseNamespaceMembersReturn {
  members: GroupMember[];
  selfIdentity: string | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

interface ListMembersResponse {
  members?: GroupMember[];
  selfIdentity?: string;
  // Some older builds of merod returned `data`; tolerate it as a fallback.
  data?: GroupMember[];
}

const toError = (err: unknown): Error =>
  err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Unknown error');

export function useNamespaceMembers(groupId?: string | null): UseNamespaceMembersReturn {
  const { mero } = useMero();
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [selfIdentity, setSelfIdentity] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refetch = useCallback(async () => {
    if (!mero || !groupId) {
      if (mountedRef.current) {
        setMembers([]);
        setSelfIdentity(null);
        setError(null);
        setLoading(false);
      }
      return;
    }
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
    }
    try {
      // Cast: the SDK's typed shape (`data`) doesn't match what merod
      // actually serializes (`members`), so we receive the raw payload
      // and read both fields defensively.
      const response = (await mero.admin.listGroupMembers(groupId)) as unknown as ListMembersResponse;
      if (mountedRef.current) {
        setMembers(response.members ?? response.data ?? []);
        setSelfIdentity(response.selfIdentity ?? null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(toError(err));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [groupId, mero]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { members, selfIdentity, loading, error, refetch };
}
