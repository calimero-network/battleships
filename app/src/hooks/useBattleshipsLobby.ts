import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useContexts,
  useCreateContext,
  useCreateGroup,
  useContextGroup,
  useInviteToContext,
  useJoinContext,
  useGroupMembers,
  useJoinGroupContext,
  useMero,
} from '@calimero-network/mero-react';
import type { GroupMember } from '@calimero-network/mero-react';

const SELECTED_LOBBY_KEY = 'battleships:selectedLobbyCtxId';
const KNOWN_LOBBIES_KEY = 'battleships:lobbyContextIds';

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

function loadKnownLobbies(): Map<string, string | undefined> {
  try {
    const raw = localStorage.getItem(KNOWN_LOBBIES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Support old format (string[]) and new format (Record<string, string|null>)
      if (Array.isArray(parsed)) {
        return new Map(parsed.map((id: string) => [id, undefined]));
      }
      if (typeof parsed === 'object' && parsed !== null) {
        return new Map(Object.entries(parsed).map(([k, v]) => [k, (v as string) || undefined]));
      }
    }
  } catch {
    // ignore
  }
  return new Map();
}

function addKnownLobby(contextId: string, alias?: string) {
  try {
    const lobbies = loadKnownLobbies();
    lobbies.set(contextId, alias);
    localStorage.setItem(KNOWN_LOBBIES_KEY, JSON.stringify(Object.fromEntries(lobbies)));
  } catch {
    // storage unavailable
  }
}

function hexToBase58(hex: string): string {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let num = 0n;
  for (const byte of bytes) {
    num = num * 256n + BigInt(byte);
  }
  let encoded = '';
  while (num > 0n) {
    encoded = ALPHABET[Number(num % 58n)] + encoded;
    num = num / 58n;
  }
  for (const byte of bytes) {
    if (byte === 0) {
      encoded = '1' + encoded;
    } else {
      break;
    }
  }
  return encoded || '1';
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

  const knownLobbies = loadKnownLobbies();
  const lobbies: LobbyRecord[] = allContexts
    .filter((c) => knownLobbies.has(c.contextId))
    .map((c) => ({ ...c, alias: knownLobbies.get(c.contextId) }));

  const [selectedLobbyId, setSelectedLobbyId] = useState<string | null>(loadSelectedLobbyId);
  const selectedLobby = lobbies.find((l) => l.contextId === selectedLobbyId) ?? null;

  const rawContextId = selectedLobby?.contextId ?? null;
  const lobbyContextId = rawContextId && /^[0-9a-fA-F]+$/.test(rawContextId)
    ? hexToBase58(rawContextId)
    : rawContextId;

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
  const { createGroup, loading: createGroupLoading, error: createGroupError } = useCreateGroup();
  const { inviteToContext, loading: inviteLoading } = useInviteToContext();
  const { joinContext, loading: joinContextLoading } = useJoinContext();

  const [lobbyJoined, setLobbyJoined] = useState(false);
  const [executorPublicKey, setExecutorPublicKey] = useState<string | null>(null);
  const autoJoinAttempted = useRef(false);

  // Auto-select: pick persisted lobby if valid, or fall back to first lobby
  useEffect(() => {
    if (lobbies.length === 0) return;

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
        if (contextIdentity) {
          if (!cancelled) setExecutorPublicKey(contextIdentity);
          return;
        }
        const { identities } = await mero.admin.getContextIdentitiesOwned(lobbyContextId);
        if (!cancelled && identities.length > 0) {
          setExecutorPublicKey(identities[0]);
        }
      } catch {
        // identity resolution will be retried on join
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

  const selectLobby = useCallback((contextId: string) => {
    setSelectedLobbyId(contextId);
    persistSelectedLobbyId(contextId);
  }, []);

  const clearLobby = useCallback(() => {
    setSelectedLobbyId(null);
    persistSelectedLobbyId(null);
  }, []);

  const createLobby = useCallback(async (name?: string) => {
    if (!applicationId) return null;

    // 1. Create a group first (invisible to user)
    const groupResult = await createGroup({
      applicationId,
      upgradePolicy: 'Automatic',
      alias: name || undefined,
    });
    if (!groupResult) return null;

    // 2. Create the lobby context inside that group
    const initParams = JSON.stringify({ context_type: 'Lobby' });
    const initBytes = Array.from(new TextEncoder().encode(initParams));

    const result = await createContext({
      applicationId,
      initializationParams: initBytes,
      groupId: groupResult.groupId,
      alias: name || 'lobby',
    });

    if (result) {
      const newCtxId = result.contextId;
      addKnownLobby(newCtxId, name || 'lobby');
      setSelectedLobbyId(newCtxId);
      persistSelectedLobbyId(newCtxId);
      await refetchContexts();
      return newCtxId;
    }
    return null;
  }, [applicationId, createGroup, createContext, refetchContexts]);

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
        addKnownLobby(result.contextId);
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
    createLobbyLoading: createGroupLoading || createContextLoading,
    createLobbyError: createGroupError || createContextError,

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
