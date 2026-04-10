import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useNamespacesForApplication,
  useGroupContexts,
  useGroupMembers,
  useCreateNamespaceInvitation,
  useJoinNamespace,
  useMero,
} from '@calimero-network/mero-react';
import type { GroupMember } from '@calimero-network/mero-react';
import { useNamespaceBootstrap } from './useNamespaceBootstrap';

const SELECTED_NS_KEY = 'battleships:selectedNamespaceId';

export interface LobbyRecord {
  namespaceId: string;
  lobbyContextId: string | null;
  applicationId: string;
  alias?: string;
}

export interface UseBattleshipsLobbyReturn {
  lobbies: LobbyRecord[];
  lobbiesLoading: boolean;
  lobbiesError: Error | null;
  selectedLobby: LobbyRecord | null;
  selectLobby: (namespaceId: string) => void;
  clearLobby: () => void;
  refetchLobbies: () => Promise<void>;

  createLobby: (name?: string) => Promise<string | null>;
  createLobbyLoading: boolean;
  createLobbyError: Error | null;

  namespaceId: string | null;
  groupId: string | null;
  groupLoading: boolean;

  members: GroupMember[];
  selfIdentity: string | null;
  membersLoading: boolean;
  isAdmin: boolean;

  lobbyJoined: boolean;
  executorPublicKey: string | null;
  lobbyContextId: string | null;

  invitePlayer: (validForSeconds?: number) => Promise<unknown>;
  inviteLoading: boolean;

  joinLobby: (invitationJson: string) => Promise<boolean>;
  joinLoading: boolean;

  refetchContexts: () => Promise<void>;
}

function loadSelectedNamespaceId(): string | null {
  try {
    return localStorage.getItem(SELECTED_NS_KEY);
  } catch {
    return null;
  }
}

function persistSelectedNamespaceId(nsId: string | null) {
  try {
    if (nsId) {
      localStorage.setItem(SELECTED_NS_KEY, nsId);
    } else {
      localStorage.removeItem(SELECTED_NS_KEY);
    }
  } catch {
    // storage unavailable
  }
}

const ENV_APPLICATION_ID = import.meta.env.VITE_APPLICATION_ID?.trim() || null;

export function useBattleshipsLobby(): UseBattleshipsLobbyReturn {
  const { applicationId: authApplicationId, mero, contextIdentity } = useMero();
  const applicationId = authApplicationId || ENV_APPLICATION_ID;

  // --- Namespace listing ---
  const {
    namespaces,
    loading: namespacesLoading,
    error: namespacesError,
    refetch: refetchNamespaces,
  } = useNamespacesForApplication(applicationId);

  const lobbies: LobbyRecord[] = namespaces.map((ns) => ({
    namespaceId: ns.namespaceId,
    lobbyContextId: null, // resolved below for the selected namespace
    applicationId: ns.targetApplicationId,
    alias: ns.alias,
  }));

  // --- Namespace selection ---
  const [selectedNsId, setSelectedNsId] = useState<string | null>(loadSelectedNamespaceId);
  const selectedLobby = lobbies.find((l) => l.namespaceId === selectedNsId) ?? null;
  const namespaceId = selectedLobby?.namespaceId ?? null;

  // The namespace IS the root group — groupId === namespaceId
  const groupId = namespaceId;

  // --- Derive lobby context from namespace's root group contexts ---
  const {
    contexts: namespaceContexts,
    loading: contextsLoading,
    refetch: refetchGroupContexts,
  } = useGroupContexts(namespaceId);

  const groupLoading = namespacesLoading || contextsLoading;

  // The lobby context is the first context in the namespace root group
  const lobbyContextId = namespaceContexts.length > 0
    ? namespaceContexts[0].contextId
    : null;

  // Patch the lobbyContextId into the selected lobby record
  if (selectedLobby && lobbyContextId) {
    selectedLobby.lobbyContextId = lobbyContextId;
  }

  // --- Members of the namespace root group ---
  const {
    members,
    selfIdentity,
    loading: membersLoading,
  } = useGroupMembers(namespaceId);

  // --- Mutations ---
  const { createNamespaceInvitation, loading: inviteLoading } = useCreateNamespaceInvitation();
  const { joinNamespace, loading: joinNamespaceLoading } = useJoinNamespace();
  const {
    createNamespaceWithLobby,
    loading: createLobbyLoading,
    error: createLobbyError,
  } = useNamespaceBootstrap(applicationId);

  // --- Lobby join state ---
  const [lobbyJoined, setLobbyJoined] = useState(false);
  const [executorPublicKey, setExecutorPublicKey] = useState<string | null>(null);

  // Auto-select: pick persisted namespace if valid, or fall back to first
  const userCleared = useRef(false);

  useEffect(() => {
    if (lobbies.length === 0) return;
    if (userCleared.current) return;

    if (selectedNsId && lobbies.some((l) => l.namespaceId === selectedNsId)) return;

    const persisted = loadSelectedNamespaceId();
    const match = persisted ? lobbies.find((l) => l.namespaceId === persisted) : null;
    if (match) {
      setSelectedNsId(match.namespaceId);
      return;
    }

    setSelectedNsId(lobbies[0].namespaceId);
    persistSelectedNamespaceId(lobbies[0].namespaceId);
  }, [lobbies, selectedNsId]);

  // Reset join state when namespace changes
  useEffect(() => {
    setLobbyJoined(false);
    setExecutorPublicKey(null);
  }, [selectedNsId]);

  // Resolve executor identity from the lobby context
  useEffect(() => {
    if (!lobbyContextId || !mero) return;

    let cancelled = false;

    (async () => {
      try {
        const { identities } = await mero.admin.getContextIdentitiesOwned(lobbyContextId);
        if (!cancelled && identities.length > 0) {
          setExecutorPublicKey(identities[0]);
          return;
        }
        if (!cancelled && contextIdentity) {
          setExecutorPublicKey(contextIdentity);
        }
      } catch {
        if (!cancelled && contextIdentity) {
          setExecutorPublicKey(contextIdentity);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [lobbyContextId, mero, contextIdentity]);

  // Mark lobby as joined once we have identity
  useEffect(() => {
    if (lobbyContextId && executorPublicKey && !lobbyJoined) {
      setLobbyJoined(true);
    }
  }, [lobbyContextId, executorPublicKey, lobbyJoined]);

  const isAdmin = selfIdentity !== null
    && members.some((m) => m.identity === selfIdentity && m.role === 'Admin');

  // --- Callbacks ---

  const selectLobby = useCallback((nsId: string) => {
    userCleared.current = false;
    setSelectedNsId(nsId);
    persistSelectedNamespaceId(nsId);
  }, []);

  const clearLobby = useCallback(() => {
    userCleared.current = true;
    setSelectedNsId(null);
    persistSelectedNamespaceId(null);
  }, []);

  const createLobby = useCallback(async (name?: string) => {
    const result = await createNamespaceWithLobby(name || 'lobby');
    if (result) {
      setExecutorPublicKey(result.memberPublicKey);
      setLobbyJoined(true);
      setSelectedNsId(result.namespaceId);
      persistSelectedNamespaceId(result.namespaceId);
      await refetchNamespaces();
      return result.namespaceId;
    }
    return null;
  }, [createNamespaceWithLobby, refetchNamespaces]);

  const invitePlayer = useCallback(async (_validForSeconds = 86400) => {
    if (!namespaceId) return null;
    return createNamespaceInvitation(namespaceId, { recursive: true });
  }, [namespaceId, createNamespaceInvitation]);

  const joinLobbyViaInvitation = useCallback(async (invitationJson: string): Promise<boolean> => {
    if (!mero) return false;
    try {
      const parsed = JSON.parse(invitationJson);

      // Support both single invitation and recursive invitation formats.
      // Recursive: { invitations: [{ groupId, invitation }, ...] }
      // Single:    { invitation: { groupId: number[], ... }, inviterSignature }
      let nsId: string | null = null;
      let invitation = parsed;

      if (Array.isArray(parsed?.invitations) && parsed.invitations.length > 0) {
        const first = parsed.invitations[0];
        nsId = first.groupId;
        invitation = first.invitation;
      } else if (parsed?.invitation?.groupId) {
        const gid = parsed.invitation.groupId;
        nsId = Array.isArray(gid)
          ? gid.map((b: number) => b.toString(16).padStart(2, '0')).join('')
          : String(gid);
      }

      if (!nsId) {
        throw new Error('Invalid invitation: cannot determine namespace ID');
      }

      const result = await joinNamespace(nsId, { invitation });

      if (result) {
        await refetchNamespaces();
        return true;
      }
      return false;
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('already')) return true;
      throw err;
    }
  }, [mero, joinNamespace, refetchNamespaces]);

  const refetchContexts = useCallback(async () => {
    await refetchNamespaces();
    await refetchGroupContexts();
  }, [refetchNamespaces, refetchGroupContexts]);

  return {
    lobbies,
    lobbiesLoading: namespacesLoading || contextsLoading,
    lobbiesError: namespacesError,
    selectedLobby,
    selectLobby,
    clearLobby,
    refetchLobbies: refetchNamespaces,

    createLobby,
    createLobbyLoading: createLobbyLoading,
    createLobbyError: createLobbyError,

    namespaceId,
    groupId,
    groupLoading,

    members,
    selfIdentity,
    membersLoading,
    isAdmin,

    lobbyJoined,
    executorPublicKey,
    lobbyContextId,

    invitePlayer,
    inviteLoading,

    joinLobby: joinLobbyViaInvitation,
    joinLoading: joinNamespaceLoading,

    refetchContexts,
  };
}
