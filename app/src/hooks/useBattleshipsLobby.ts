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
const KNOWN_LOBBIES_KEY = 'battleships:lobbyContextIds';

export interface LobbyRecord {
  contextId: string;
  applicationId: string;
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

function loadKnownLobbyIds(): Set<string> {
  try {
    const raw = localStorage.getItem(KNOWN_LOBBIES_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr);
    }
  } catch {
    // ignore
  }
  return new Set();
}

function addKnownLobbyId(contextId: string) {
  try {
    const ids = loadKnownLobbyIds();
    ids.add(contextId);
    localStorage.setItem(KNOWN_LOBBIES_KEY, JSON.stringify([...ids]));
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

  const knownIds = loadKnownLobbyIds();
  const lobbies: LobbyRecord[] = allContexts.filter((c) => knownIds.has(c.contextId));

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

  const { createContext, loading: createLobbyLoading, error: createLobbyError } = useCreateContext();
  const { inviteToContext, loading: inviteLoading } = useInviteToContext();
  const { joinContext, loading: joinContextLoading } = useJoinContext();

  const [lobbyJoined, setLobbyJoined] = useState(false);
  const [executorPublicKey, setExecutorPublicKey] = useState<string | null>(null);
  const autoJoinAttempted = useRef(false);

  useEffect(() => {
    if (!selectedLobbyId && lobbies.length > 0) {
      const persisted = loadSelectedLobbyId();
      const match = persisted ? lobbies.find((l) => l.contextId === persisted) : null;
      if (match) {
        setSelectedLobbyId(match.contextId);
      }
    }
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

    const initParams = JSON.stringify({ context_type: 'Lobby' });
    const initBytes = Array.from(new TextEncoder().encode(initParams));

    const result = await createContext({
      applicationId,
      initializationParams: initBytes,
      alias: name || 'lobby',
    });

    if (result) {
      const newCtxId = result.contextId;
      addKnownLobbyId(newCtxId);
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

      let memberPk = contextIdentity;

      if (!memberPk) {
        try {
          const { identities } = await mero.admin.getContextIdentitiesOwned(
            parsed?.invitation?.context_id ?? '',
          );
          if (identities.length > 0) memberPk = identities[0];
        } catch {
          // ignore
        }
      }

      if (!memberPk) {
        const generated = await mero.admin.generateContextIdentity();
        memberPk = generated.publicKey;
      }

      const result = await joinContext({
        invitation: parsed,
        newMemberPublicKey: memberPk,
      });

      if (result) {
        addKnownLobbyId(result.contextId);
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
    createLobbyLoading: createLobbyLoading,
    createLobbyError: createLobbyError,

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
