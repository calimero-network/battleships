import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useContexts,
  useCreateContext,
  useContextGroup,
  useGroupMembers,
  useCreateNamespaceInvitation,
  useJoinNamespace,
  useMero,
} from '@calimero-network/mero-react';
import type { GroupMember } from '@calimero-network/mero-react';

const SELECTED_LOBBY_KEY = 'battleships:selectedLobbyCtxId';

export interface LobbyRecord {
  contextId: string;
  applicationId: string;
  alias?: string;
}

export interface UseBattleshipsLobbyReturn {
  lobbies: LobbyRecord[];
  lobbiesLoading: boolean;
  lobbiesError: Error | null;
  selectedLobby: LobbyRecord | null;
  selectLobby: (contextId: string) => void;
  clearLobby: () => void;
  refetchLobbies: () => Promise<void>;

  createLobby: (name?: string) => Promise<string | null>;
  createLobbyLoading: boolean;
  createLobbyError: Error | null;

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

function loadSelectedLobbyId(): string | null {
  try {
    return localStorage.getItem(SELECTED_LOBBY_KEY);
  } catch {
    return null;
  }
}

function persistSelectedLobbyId(contextId: string | null) {
  try {
    if (contextId) {
      localStorage.setItem(SELECTED_LOBBY_KEY, contextId);
    } else {
      localStorage.removeItem(SELECTED_LOBBY_KEY);
    }
  } catch {
    // storage unavailable
  }
}

const ENV_APPLICATION_ID = import.meta.env.VITE_APPLICATION_ID?.trim() || null;

export function useBattleshipsLobby(): UseBattleshipsLobbyReturn {
  const { applicationId: authApplicationId, mero, contextIdentity } = useMero();
  const applicationId = authApplicationId || ENV_APPLICATION_ID;

  const {
    contexts: allContexts,
    loading: contextsLoading,
    error: contextsError,
    refetch: refetchContexts,
  } = useContexts(applicationId);

  const lobbies: LobbyRecord[] = allContexts;

  const [selectedLobbyId, setSelectedLobbyId] = useState<string | null>(loadSelectedLobbyId);
  const selectedLobby = lobbies.find((l) => l.contextId === selectedLobbyId) ?? null;

  const rawContextId = selectedLobby?.contextId ?? null;
  const lobbyContextId = rawContextId;

  const {
    groupId,
    loading: groupLoading,
  } = useContextGroup(rawContextId);

  const {
    members,
    selfIdentity,
    loading: membersLoading,
  } = useGroupMembers(groupId);

  const { createContext, loading: createContextLoading, error: createContextError } = useCreateContext();
  const { createNamespaceInvitation, loading: inviteLoading } = useCreateNamespaceInvitation();
  const { joinNamespace, loading: joinNamespaceLoading } = useJoinNamespace();

  const [lobbyJoined, setLobbyJoined] = useState(false);
  const [executorPublicKey, setExecutorPublicKey] = useState<string | null>(null);

  // Auto-select: pick persisted lobby if valid, or fall back to first lobby
  // Skip if user explicitly cleared the selection (Switch Lobby)
  useEffect(() => {
    if (lobbies.length === 0) return;
    if (userCleared.current) return;

    // If current selection is valid, keep it
    if (selectedLobbyId && lobbies.some((l) => l.contextId === selectedLobbyId)) return;

    // Try persisted value
    const persisted = loadSelectedLobbyId();
    const match = persisted ? lobbies.find((l) => l.contextId === persisted) : null;
    if (match) {
      setSelectedLobbyId(match.contextId);
      return;
    }

    // Fall back to first lobby
    setSelectedLobbyId(lobbies[0].contextId);
    persistSelectedLobbyId(lobbies[0].contextId);
  }, [lobbies, selectedLobbyId]);

  useEffect(() => {
    setLobbyJoined(false);
    setExecutorPublicKey(null);
  }, [selectedLobbyId]);

  useEffect(() => {
    if (!lobbyContextId || !mero) return;

    let cancelled = false;

    (async () => {
      try {
        // Always prefer context-specific owned identity (has private key on this node)
        const { identities } = await mero.admin.getContextIdentitiesOwned(lobbyContextId);
        if (!cancelled && identities.length > 0) {
          setExecutorPublicKey(identities[0]);
          return;
        }
        // Fall back to provider-level identity
        if (!cancelled && contextIdentity) {
          setExecutorPublicKey(contextIdentity);
        }
      } catch (err) {
        console.log('[lobby-hook] getContextIdentitiesOwned error:', err);
        if (!cancelled && contextIdentity) {
          setExecutorPublicKey(contextIdentity);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [lobbyContextId, mero, contextIdentity]);

  useEffect(() => {
    if (lobbyContextId && executorPublicKey && !lobbyJoined) {
      setLobbyJoined(true);
    }
  }, [lobbyContextId, executorPublicKey, lobbyJoined]);

  const isAdmin = selfIdentity !== null
    && members.some((m) => m.identity === selfIdentity && m.role === 'Admin');

  const userCleared = useRef(false);

  const selectLobby = useCallback((contextId: string) => {
    userCleared.current = false;
    setSelectedLobbyId(contextId);
    persistSelectedLobbyId(contextId);
  }, []);

  const clearLobby = useCallback(() => {
    userCleared.current = true;
    setSelectedLobbyId(null);
    persistSelectedLobbyId(null);
  }, []);

  const createLobby = useCallback(async (name?: string) => {
    if (!applicationId) return null;

    // Create lobby context without groupId — core auto-creates the group
    const initParams = JSON.stringify({ context_type: 'Lobby' });
    const initBytes = Array.from(new TextEncoder().encode(initParams));

    const result = await createContext({
      applicationId,
      initializationParams: initBytes,
      alias: name || 'lobby',
    });

    if (result) {
      const newCtxId = result.contextId;
      // Use the memberPublicKey returned by createContext — this is the identity
      // that core created with a private key for this context
      setExecutorPublicKey(result.memberPublicKey);
      setLobbyJoined(true);

      setSelectedLobbyId(newCtxId);
      persistSelectedLobbyId(newCtxId);
      await refetchContexts();
      return newCtxId;
    }
    return null;
  }, [applicationId, createContext, refetchContexts]);

  const invitePlayer = useCallback(async (_validForSeconds = 86400) => {
    // TODO(Phase 1): Wire namespaceId from namespace-first lobby flow
    // For now, use groupId as the namespace (root group) if available
    if (!groupId) return null;
    return createNamespaceInvitation(groupId, { recursive: true });
  }, [groupId, createNamespaceInvitation]);

  const joinLobbyViaInvitation = useCallback(async (invitationJson: string): Promise<boolean> => {
    if (!mero) return false;
    try {
      const parsed = JSON.parse(invitationJson);

      // Support both single invitation and recursive invitation formats.
      // Recursive: { invitations: [{ groupId, invitation }, ...] }
      // Single:    { invitation: { groupId: number[], ... }, inviterSignature }
      let namespaceId: string | null = null;
      let invitation = parsed;

      if (Array.isArray(parsed?.invitations) && parsed.invitations.length > 0) {
        // Recursive invitation — first entry is the namespace root
        const first = parsed.invitations[0];
        namespaceId = first.groupId;
        invitation = first.invitation;
      } else if (parsed?.invitation?.groupId) {
        // Single invitation — groupId is a byte array, convert to hex
        const gid = parsed.invitation.groupId;
        namespaceId = Array.isArray(gid)
          ? gid.map((b: number) => b.toString(16).padStart(2, '0')).join('')
          : String(gid);
      }

      if (!namespaceId) {
        throw new Error('Invalid invitation: cannot determine namespace ID');
      }

      const result = await joinNamespace(namespaceId, { invitation });

      if (result) {
        await refetchContexts();
        return true;
      }
      return false;
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('already')) return true;
      throw err;
    }
  }, [mero, joinNamespace, refetchContexts]);

  return {
    lobbies,
    lobbiesLoading: contextsLoading,
    lobbiesError: contextsError,
    selectedLobby,
    selectLobby,
    clearLobby,
    refetchLobbies: refetchContexts,

    createLobby,
    createLobbyLoading: createContextLoading,
    createLobbyError: createContextError,

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
