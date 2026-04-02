import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useContexts,
  useCreateContext,
  useContextGroup,
  useInviteToContext,
  useJoinContext,
  useGroupMembers,
  useJoinGroupContext,
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

  const {
    joinGroupContext,
    loading: joinGroupContextLoading,
  } = useJoinGroupContext();

  const { createContext, loading: createContextLoading, error: createContextError } = useCreateContext();
  const { inviteToContext, loading: inviteLoading } = useInviteToContext();
  const { joinContext, loading: joinContextLoading } = useJoinContext();

  const [lobbyJoined, setLobbyJoined] = useState(false);
  const [executorPublicKey, setExecutorPublicKey] = useState<string | null>(null);
  const autoJoinAttempted = useRef(false);

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
    autoJoinAttempted.current = false;
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

  useEffect(() => {
    if (!groupId || !lobbyContextId || lobbyJoined || autoJoinAttempted.current || joinGroupContextLoading) return;
    autoJoinAttempted.current = true;

    (async () => {
      try {
        const result = await joinGroupContext(groupId, lobbyContextId);
        if (result) {
          setLobbyJoined(true);
          if (result.memberPublicKey) setExecutorPublicKey(result.memberPublicKey);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        if (message.includes('already')) {
          setLobbyJoined(true);
        }
      }
    })();
  }, [groupId, lobbyContextId, lobbyJoined, joinGroupContextLoading, joinGroupContext]);

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

  const invitePlayer = useCallback(async (validForSeconds = 86400) => {
    if (!lobbyContextId || !executorPublicKey) return null;
    return inviteToContext({
      contextId: lobbyContextId,
      inviterId: executorPublicKey,
      validForSeconds,
    });
  }, [lobbyContextId, executorPublicKey, inviteToContext]);

  const joinLobbyViaInvitation = useCallback(async (invitationJson: string): Promise<boolean> => {
    if (!mero) return false;
    try {
      const parsed = JSON.parse(invitationJson);

      // Use existing context identity or generate a new one
      let memberPk = contextIdentity;
      if (!memberPk) {
        const generated = await mero.admin.generateContextIdentity();
        memberPk = generated.publicKey;
      }

      const result = await joinContext({
        invitation: parsed,
        newMemberPublicKey: memberPk,
      });

      if (result) {
        setSelectedLobbyId(result.contextId);
        persistSelectedLobbyId(result.contextId);
        await refetchContexts();
        return true;
      }
      return false;
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('already')) return true;
      throw err;
    }
  }, [mero, contextIdentity, joinContext, refetchContexts]);

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
    joinLoading: joinContextLoading,

    refetchContexts,
  };
}
