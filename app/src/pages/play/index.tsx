import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';

/**
 * Legacy play page — redirects to the unified match flow.
 *
 * All gameplay now lives in MatchPage (/match). This page preserves
 * `match_id` and `context_id` query params so old bookmarks still work.
 */
export default function PlayPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useMero();

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/', { replace: true });
      return;
    }

    const params = new URLSearchParams(location.search);
    const matchId = params.get('match_id');
    const contextId = params.get('context_id');

    if (matchId && contextId) {
      navigate(
        `/match?match_id=${encodeURIComponent(matchId)}&context_id=${encodeURIComponent(contextId)}`,
        { replace: true },
      );
    } else {
      navigate('/lobby', { replace: true });
    }
  }, [isAuthenticated, location.search, navigate]);

  return null;
}
